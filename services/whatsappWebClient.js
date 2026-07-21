const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

let webClient = null;
let webClientReady = false;
let webClientStarting = false;
let inboundMessageHandler = null;
const identityPhoneMap = new Map();
const processedInboundMessages = new Map();
const INBOUND_DEDUPE_TTL_MS = 10 * 1000;

function getProvider() {
    return String(process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();
}

function isWhatsAppEnabled() {
    return String(process.env.WHATSAPP_NOTIFICATIONS_ENABLED || process.env.WHATSAPP_AUTOMATION_ENABLED || 'true').toLowerCase() !== 'false';
}

function isWhatsAppWebProvider() {
    const provider = getProvider();
    return provider === 'whatsapp_web' || provider === 'whatsapp-web' || provider === 'web';
}

function normalizePhone(value) {
    return String(value || '').replace(/[^\d]/g, '');
}

function getDefaultCountryCode() {
    const digits = normalizePhone(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '65');
    return digits || '65';
}

function normalizeRecipientPhone(phone) {
    let digits = normalizePhone(phone);

    if (!digits) {
        return '';
    }

    // Some forms include a local leading 0 (e.g. 091234567).
    if (/^0\d{8}$/.test(digits)) {
        digits = digits.slice(1);
    }

    // Accept Singapore-style local mobile numbers and prepend the default country code.
    if (/^[689]\d{7}$/.test(digits)) {
        return `${getDefaultCountryCode()}${digits}`;
    }

    // Accept local 8-digit format even if it does not match mobile prefixes.
    if (/^\d{8}$/.test(digits)) {
        return `${getDefaultCountryCode()}${digits}`;
    }

    return digits;
}

function getPhoneCandidates(phone) {
    const rawDigits = normalizePhone(phone);
    const normalized = normalizeRecipientPhone(phone);
    const candidates = [];

    [normalized, rawDigits].forEach((value) => {
        const digits = String(value || '').trim();
        if (!digits || candidates.includes(digits)) {
            return;
        }

        candidates.push(digits);

        // Support 00-prefixed international numbers.
        if (digits.startsWith('00')) {
            const withoutZeroZero = digits.slice(2);
            if (withoutZeroZero && !candidates.includes(withoutZeroZero)) {
                candidates.push(withoutZeroZero);
            }
        }

        // For SG numbers entered with country code, also try local form.
        if (digits.startsWith('65') && digits.length === 10) {
            const local = digits.slice(2);
            if (local && !candidates.includes(local)) {
                candidates.push(local);
            }
        }

        // For local 8-digit numbers, try with default country code.
        if (/^\d{8}$/.test(digits)) {
            const withCountry = `${getDefaultCountryCode()}${digits}`;
            if (!candidates.includes(withCountry)) {
                candidates.push(withCountry);
            }
        }
    });

    return candidates;
}

function toWhatsAppWebChatId(phone) {
    const digits = normalizeRecipientPhone(phone);
    return digits ? `${digits}@c.us` : '';
}

function getChatIdCandidates(phone) {
    const ids = [];

    getPhoneCandidates(phone).forEach((digits) => {
        [`${digits}@c.us`, `${digits}@s.whatsapp.net`].forEach((id) => {
            if (!ids.includes(id)) {
                ids.push(id);
            }
        });
    });

    return ids;
}

function isMatchingIdentity(identity, phoneCandidates = []) {
    const userPart = getIdentityUserPart(identity);
    if (!userPart) {
        return false;
    }

    return phoneCandidates.some((candidate) => {
        const digits = String(candidate || '').trim();
        if (!digits) {
            return false;
        }

        if (userPart === digits) {
            return true;
        }

        // Match local SG format (last 8 digits) against country-code identities.
        if (digits.length >= 8 && userPart.endsWith(digits.slice(-8))) {
            return true;
        }

        return false;
    });
}

async function getKnownChatTargets(phoneCandidates = []) {
    if (!webClient || !webClientReady) {
        return [];
    }

    const targets = [];
    const chats = await webClient.getChats().catch(() => []);

    chats.forEach((chat) => {
        const identity = String(chat?.id?._serialized || '');
        if (!identity) {
            return;
        }

        if (!isMatchingIdentity(identity, phoneCandidates)) {
            return;
        }

        if (!targets.includes(identity)) {
            targets.push(identity);
        }
    });

    return targets;
}

function getIdentityUserPart(identity) {
    return String(identity || '').split('@')[0];
}

function rememberIdentityPhone(identity, phone) {
    const userPart = getIdentityUserPart(identity);
    const normalizedPhone = normalizeRecipientPhone(phone);

    if (!userPart || !normalizedPhone) {
        return;
    }

    identityPhoneMap.set(userPart, normalizedPhone);
}

function cleanupProcessedInboundMessages(now = Date.now()) {
    processedInboundMessages.forEach((processedAt, key) => {
        if (now - processedAt > INBOUND_DEDUPE_TTL_MS) {
            processedInboundMessages.delete(key);
        }
    });
}

function claimInboundMessage(keys = []) {
    const now = Date.now();
    cleanupProcessedInboundMessages(now);
    const normalizedKeys = keys.map((key) => String(key || '').trim()).filter(Boolean);

    if (normalizedKeys.some((key) => processedInboundMessages.has(key))) {
        return false;
    }

    normalizedKeys.forEach((key) => processedInboundMessages.set(key, now));
    return true;
}

function extractPhoneFromContact(contact) {
    if (!contact) {
        return '';
    }

    // contact.id.user can be a privacy-preserving LID rather than a phone
    // number. Prefer the dedicated number field and never accept an @lid ID
    // as a customer telephone number.
    const contactDomain = String(contact.id?._serialized || '').split('@')[1]?.toLowerCase();
    const contactNumber = normalizeRecipientPhone(contact.number || '');
    const lidNumber = normalizeRecipientPhone(contact.id?.user || '');
    const candidate = (contactDomain === 'lid' && contactNumber === lidNumber ? '' : contactNumber)
        || (contactDomain && contactDomain !== 'lid' ? contact.id?.user : '');
    return normalizeRecipientPhone(candidate);
}

async function resolveLidPhone(identity) {
    if (!webClient || !/@lid$/i.test(String(identity || ''))) {
        return '';
    }

    try {
        const mappings = await webClient.getContactLidAndPhone([String(identity)]);
        const match = Array.isArray(mappings)
            ? mappings.find((entry) => String(entry?.lid || '').toLowerCase() === String(identity).toLowerCase())
                || mappings[0]
            : null;
        const phoneIdentity = String(match?.pn || '');
        const phoneDomain = String(phoneIdentity.split('@')[1] || '').toLowerCase();

        if (!phoneIdentity || phoneDomain === 'lid') {
            return '';
        }

        return normalizeRecipientPhone(getIdentityUserPart(phoneIdentity));
    } catch (error) {
        console.warn(`WhatsApp LID could not be resolved to a phone number: ${identity}`, error.message);
        return '';
    }
}

async function startWhatsAppWebClient(options = {}) {
    if (!isWhatsAppWebProvider() || !isWhatsAppEnabled()) {
        return { skipped: true };
    }

    if (typeof options.onMessage === 'function') {
        inboundMessageHandler = options.onMessage;
    }

    if (webClient) {
        return { started: true, ready: webClientReady };
    }

    if (webClientStarting) {
        return { started: false, ready: webClientReady };
    }

    webClientStarting = true;

    try {
        webClient = new Client({
            authStrategy: new LocalAuth({
                clientId: process.env.WHATSAPP_WEB_CLIENT_ID || 'vaniday'
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        webClient.on('qr', (qr) => {
            console.log('WhatsApp Web QR received. Scan with your WhatsApp app to connect.');
            qrcodeTerminal.generate(qr, { small: true });
        });

        webClient.on('ready', () => {
            webClientReady = true;
            console.log('WhatsApp Web client is ready.');
        });

        webClient.on('authenticated', () => {
            console.log('WhatsApp Web client authenticated.');
        });

        webClient.on('auth_failure', (message) => {
            webClientReady = false;
            console.error('WhatsApp Web authentication failed:', message || 'unknown reason');
        });

        webClient.on('disconnected', (reason) => {
            webClientReady = false;
            console.error('WhatsApp Web client disconnected:', reason || 'unknown reason');
        });

        webClient.on('message', async (message) => {
            const fromRaw = String(message.from || '');
            const fromUser = getIdentityUserPart(fromRaw);
            const fromDomain = String(fromRaw.split('@')[1] || '').toLowerCase();
            const text = message.body || '';
            const messageId = String(message.id?._serialized || message.id?.id || '');

            if (!fromRaw || !text || message.fromMe) {
                return;
            }

            let resolvedPhone = '';

            if (fromDomain === 'c.us') {
                resolvedPhone = normalizeRecipientPhone(fromUser);
            }

            if (!resolvedPhone && identityPhoneMap.has(fromUser)) {
                resolvedPhone = identityPhoneMap.get(fromUser);
            }

            if (!resolvedPhone && fromDomain === 'lid') {
                resolvedPhone = await resolveLidPhone(fromRaw);
            }

            if (!resolvedPhone) {
                const contact = await message.getContact().catch(() => null);
                resolvedPhone = extractPhoneFromContact(contact);

                if (!resolvedPhone && typeof contact?.getFormattedNumber === 'function') {
                    const formattedNumber = await contact.getFormattedNumber().catch(() => '');
                    const normalizedFormatted = normalizeRecipientPhone(formattedNumber);
                    resolvedPhone = fromDomain === 'lid' && normalizedFormatted === normalizeRecipientPhone(fromUser)
                        ? ''
                        : normalizedFormatted;
                }
            }

            if (!resolvedPhone) {
                console.warn(`WhatsApp inbound sender could not be resolved to phone: ${fromRaw}`);
                return;
            }

            rememberIdentityPhone(fromRaw, resolvedPhone);

            const normalizedText = String(text).trim().replace(/\s+/g, ' ').toLowerCase();
            const fingerprint = `${resolvedPhone}:${normalizedText}`;
            if (!claimInboundMessage([
                messageId ? `id:${messageId}` : '',
                `content:${fingerprint}`
            ])) {
                console.log(`Duplicate WhatsApp inbound message ignored: ${messageId || fingerprint}`);
                return;
            }

            if (typeof inboundMessageHandler === 'function') {
                Promise.resolve(inboundMessageHandler({
                    from: resolvedPhone,
                    text,
                    type: 'text',
                    messageId
                })).catch((error) => {
                    console.error('WhatsApp Web inbound handler failed:', error);
                });
            }
        });

        await webClient.initialize();
        return { started: true, ready: webClientReady };
    } finally {
        webClientStarting = false;
    }
}

async function sendWhatsAppWebText(phone, message) {
    if (!isWhatsAppWebProvider()) {
        return { skipped: true, reason: 'whatsapp_web_provider_disabled' };
    }

    if (!isWhatsAppEnabled()) {
        return { skipped: true, reason: 'whatsapp_disabled' };
    }

    const normalizedPhone = normalizeRecipientPhone(phone);
    const phoneCandidates = getPhoneCandidates(phone);
    const body = String(message || '').trim();

    if (!normalizedPhone) {
        return { skipped: true, reason: 'invalid_phone' };
    }

    if (!body) {
        return { skipped: true, reason: 'empty_message' };
    }

    if (!webClient || !webClientReady) {
        return {
            skipped: true,
            reason: 'whatsapp_web_client_not_ready'
        };
    }

    const resolvedIds = [];

    for (const candidatePhone of phoneCandidates) {
        const numberId = await webClient.getNumberId(candidatePhone).catch((error) => {
            const message = String(error?.message || '');

            if (/No LID/i.test(message)) {
                return null;
            }

            throw error;
        });

        if (numberId?._serialized && !resolvedIds.includes(numberId._serialized)) {
            resolvedIds.push(numberId._serialized);
            rememberIdentityPhone(numberId._serialized, candidatePhone);
        }
    }

    const knownChatTargets = await getKnownChatTargets(phoneCandidates);
    const target = resolvedIds[0] || knownChatTargets[0] || toWhatsAppWebChatId(normalizedPhone);

    const sent = await webClient.sendMessage(target, body.slice(0, 4000)).catch((error) => {
        const message = String(error?.message || '');

        if (/No LID/i.test(message)) {
            return null;
        }

        throw error;
    });

    if (!sent) {
        return {
            skipped: true,
            reason: resolvedIds.length ? 'whatsapp_send_no_lid' : 'whatsapp_number_not_found'
        };
    }

    return {
        provider: 'whatsapp_web',
        messageId: sent?.id?._serialized || null
    };
}

module.exports = {
    isWhatsAppWebProvider,
    sendWhatsAppWebText,
    startWhatsAppWebClient
};
