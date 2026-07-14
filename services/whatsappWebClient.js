const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

let webClient = null;
let webClientReady = false;
let webClientStarting = false;
let inboundMessageHandler = null;
const identityPhoneMap = new Map();

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

function toWhatsAppWebChatId(phone) {
    const digits = normalizeRecipientPhone(phone);
    return digits ? `${digits}@c.us` : '';
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

function extractPhoneFromContact(contact) {
    if (!contact) {
        return '';
    }

    const candidate = normalizeRecipientPhone(contact.number || contact.id?.user || '');
    return candidate;
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

            if (!resolvedPhone) {
                const contact = await message.getContact().catch(() => null);
                resolvedPhone = extractPhoneFromContact(contact);
            }

            if (!resolvedPhone) {
                console.warn(`WhatsApp inbound sender could not be resolved to phone: ${fromRaw}`);
                return;
            }

            rememberIdentityPhone(fromRaw, resolvedPhone);

            if (typeof inboundMessageHandler === 'function') {
                Promise.resolve(inboundMessageHandler({
                    from: resolvedPhone,
                    text,
                    type: 'text'
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
    if (!isWhatsAppWebProvider() || !isWhatsAppEnabled()) {
        return { skipped: true };
    }

    const normalizedPhone = normalizeRecipientPhone(phone);
    const chatId = toWhatsAppWebChatId(normalizedPhone);
    const body = String(message || '').trim();

    if (!normalizedPhone || !chatId || !body) {
        return { skipped: true };
    }

    if (!webClient || !webClientReady) {
        return {
            skipped: true,
            reason: 'whatsapp_web_client_not_ready'
        };
    }

    const numberId = await webClient.getNumberId(normalizedPhone).catch((error) => {
        const message = String(error?.message || '');

        if (/No LID/i.test(message)) {
            return null;
        }

        throw error;
    });

    if (!numberId?._serialized) {
        return {
            skipped: true,
            reason: 'whatsapp_number_not_found'
        };
    }

    rememberIdentityPhone(numberId._serialized, normalizedPhone);

    const sent = await webClient.sendMessage(numberId._serialized, body.slice(0, 4000)).catch((error) => {
        const message = String(error?.message || '');

        if (/No LID/i.test(message)) {
            return null;
        }

        throw error;
    });

    if (!sent) {
        return {
            skipped: true,
            reason: 'whatsapp_send_no_lid'
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
