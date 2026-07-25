const EWallet = require('../models/EWallet');
const stripe = require('../services/stripe');
const paypal = require('../services/paypal');
const hitpay = require('../services/hitpay');
const nets = require('../services/nets');
const PaymentAttempt = require('../models/PaymentAttempt');
const User = require('../models/User');
const { sendWalletTopupOtpEmail } = require('../utils/emailNotifications');
const { sendWhatsAppText } = require('../utils/whatsappNotifications');
const crypto = require('crypto');
const QRCode = require('qrcode');

const TOPUP_2FA_TTL_MS = 5 * 60 * 1000;
const MAX_TOPUP_AMOUNT = 1000;

function getPublicBaseUrl(req) {
    const explicitWalletBase = String(process.env.WALLET_PUBLIC_BASE_URL || '').trim();
    if (explicitWalletBase) {
        return explicitWalletBase.replace(/\/$/, '');
    }

    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const host = req.get('host') || 'localhost:3000';
    let protocol = forwardedProto || req.protocol || 'http';

    if (protocol === 'http' && /(?:ngrok-free\.app|ngrok\.io|trycloudflare\.com)$/i.test(host.split(':')[0])) {
        protocol = 'https';
    }

    return `${protocol}://${host}`.replace(/\/$/, '');
}

function setWalletSuccess(req, message) {
    req.session.walletSuccess = message;
}

function setWalletError(req, message) {
    req.session.walletError = message;
}

function normalizePaymentMethod(method) {
    const normalized = String(method || '').trim().toLowerCase();
    if (normalized.includes('paypal')) return 'paypal';
    if (normalized.includes('paynow') || normalized.includes('hitpay')) return 'hitpay';
    if (normalized.includes('nets')) return 'nets';
    if (normalized.includes('stripe')) return 'stripe';
    return 'stripe';
}

function formatAmount(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

function cents(value) {
    return Math.round(Number(value || 0) * 100);
}

function isStripePaymentConfirmed(session) {
    const paymentIntent = session?.payment_intent;
    const paymentStatus = String(session?.payment_status || '').toLowerCase();
    const intentStatus = typeof paymentIntent === 'string' ? '' : String(paymentIntent?.status || '').toLowerCase();

    return paymentStatus === 'paid' && (!intentStatus || intentStatus === 'succeeded');
}

function getStripeMetadata(session = {}) {
    return {
        transactionId: Number(session.metadata?.walletTransactionId || 0),
        userId: Number(session.metadata?.userId || 0)
    };
}

function assertStripeTopupMatches(session, transaction, userId) {
    const metadata = getStripeMetadata(session);

    if (metadata.transactionId && metadata.transactionId !== Number(transaction.transactionId)) {
        throw new Error('Stripe wallet top-up transaction mismatch.');
    }

    if (metadata.userId && metadata.userId !== Number(userId)) {
        throw new Error('Stripe wallet top-up customer mismatch.');
    }

    const expectedAmount = cents(transaction.amount);
    const paidAmount = Number(session.amount_total || 0);
    const currency = String(session.currency || '').toLowerCase();

    if (paidAmount !== expectedAmount || currency !== 'sgd') {
        throw new Error('Stripe wallet top-up amount mismatch.');
    }
}

function getHitPayStatus(paymentRequest = {}) {
    return String(paymentRequest.status || paymentRequest.payment_status || '').trim().toLowerCase();
}

function getHitPayAmount(paymentRequest = {}) {
    const directAmount = Number(paymentRequest.amount ?? paymentRequest.amount_total ?? paymentRequest.total_amount);

    if (Number.isFinite(directAmount) && directAmount > 0) {
        return directAmount;
    }

    const centAmount = Number(paymentRequest.amount_cents ?? paymentRequest.total_amount_cents);
    if (Number.isFinite(centAmount) && centAmount > 0) {
        return centAmount / 100;
    }

    return null;
}

function assertHitPayTopupMatches(paymentRequest, transaction) {
    const actualAmount = getHitPayAmount(paymentRequest);

    if (actualAmount !== null && Math.abs(actualAmount - Number(transaction.amount || 0)) > 0.001) {
        throw new Error('HitPay wallet top-up amount mismatch.');
    }
}

async function completeVerifiedTopup(transaction, userId, providerReference, description) {
    return new Promise((resolve, reject) => {
        EWallet.completePendingTransaction(transaction.transactionId, userId, {
            description,
            providerReference: providerReference || transaction.referenceId || ''
        }, (error, result) => error ? reject(error) : resolve(result));
    });
}

async function verifyAndCompleteStripeTopup(transaction, userId, sessionId = '') {
    const reference = String(sessionId || transaction.referenceId || '').trim();

    if (!reference) {
        throw new Error('Stripe wallet top-up reference is missing.');
    }

    const session = await stripe.retrieveCheckoutSession(reference);

    if (!isStripePaymentConfirmed(session)) {
        return { completed: false, status: String(session?.payment_status || 'pending') };
    }

    assertStripeTopupMatches(session, transaction, userId);

    const paymentIntent = session.payment_intent;
    const providerReference = typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id || reference);
    const completed = await completeVerifiedTopup(transaction, userId, providerReference, 'Wallet top-up completed via Stripe');

    return { completed: completed?.status === 'COMPLETED', transaction: completed };
}

async function verifyAndCompleteHitPayTopup(transaction, userId, requestId = '') {
    const reference = String(requestId || transaction.referenceId || '').trim();

    if (!reference) {
        throw new Error('HitPay wallet top-up reference is missing.');
    }

    const paymentRequest = await hitpay.getPaymentRequest(reference);
    const status = getHitPayStatus(paymentRequest);

    if (status !== 'completed') {
        return { completed: false, status };
    }

    assertHitPayTopupMatches(paymentRequest, transaction);

    const completed = await completeVerifiedTopup(transaction, userId, reference, 'Wallet top-up completed via PayNow/HitPay');

    return { completed: completed?.status === 'COMPLETED', transaction: completed };
}

async function reconcilePendingTopups(userId) {
    const pendingTopups = await new Promise((resolve, reject) => {
        EWallet.getPendingTopups(userId, (error, rows = []) => error ? reject(error) : resolve(rows));
    });

    let completedCount = 0;

    for (const transaction of pendingTopups) {
        const method = String(transaction.paymentMethod || '').toUpperCase();

        try {
            let result = null;

            if (method === 'STRIPE') {
                result = await verifyAndCompleteStripeTopup(transaction, userId);
            } else if (method === 'PAYNOW') {
                result = await verifyAndCompleteHitPayTopup(transaction, userId);
            }

            if (result?.completed) {
                completedCount += 1;
            }
        } catch (error) {
            console.error('Pending wallet top-up reconciliation failed:', {
                transactionId: transaction.transactionId,
                method,
                message: error.message || error
            });
        }
    }

    return completedCount;
}

function getProviderLabel(method) {
    switch (method) {
        case 'paypal': return 'PayPal';
        case 'hitpay': return 'PayNow/HitPay';
        case 'nets': return 'NETS QR';
        case 'stripe':
        default: return 'Stripe';
    }
}

function getNetsImageDataUrl(value) {
    const compact = String(value || '').replace(/\s/g, '');
    if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
        return null;
    }

    const buffer = Buffer.from(compact, 'base64');
    const signature = buffer.subarray(0, 8).toString('hex');

    if (signature === '89504e470d0a1a0a') {
        return `data:image/png;base64,${compact}`;
    }

    if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
        return `data:image/jpeg;base64,${compact}`;
    }

    return null;
}

async function buildNetsQrCodeUrl(qrPayload) {
    const payload = typeof qrPayload === 'string' ? qrPayload.trim() : '';

    if (!payload) {
        throw new Error('NETS did not return a QR payload.');
    }

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(payload) || /^https:\/\//i.test(payload)) {
        return payload;
    }

    const imageDataUrl = getNetsImageDataUrl(payload);
    if (imageDataUrl) {
        return imageDataUrl;
    }

    return QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280
    });
}

function getStatusBadge(status) {
    const normalized = String(status || '').toUpperCase();
    switch (normalized) {
        case 'COMPLETED': return 'success';
        case 'FAILED': return 'error';
        case 'CANCELLED': return 'muted';
        default: return 'pending';
    }
}

function getStatusLabel(status) {
    const normalized = String(status || '').toUpperCase();
    switch (normalized) {
        case 'COMPLETED': return 'Completed';
        case 'FAILED': return 'Failed';
        case 'CANCELLED': return 'Cancelled';
        default: return 'Pending';
    }
}

function hashTopupCode(code) {
    return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function maskEmail(email) {
    const [name, domain] = String(email || '').split('@');

    if (!name || !domain) {
        return 'your email';
    }

    const visibleName = name.length <= 2
        ? `${name[0] || '*'}*`
        : `${name.slice(0, 2)}${'*'.repeat(Math.min(name.length - 2, 4))}`;

    return `${visibleName}@${domain}`;
}

function maskPhone(phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');

    if (digits.length < 4) {
        return 'your WhatsApp number';
    }

    return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

function normalizeContactMethod(method) {
    const normalized = String(method || '').trim().toLowerCase();

    if (normalized === 'whatsapp') return 'whatsapp';
    if (normalized === 'email') return 'email';
    return 'email';
}

function getTopupOtpDeliveryError(method, reason = '') {
    if (method === 'whatsapp') {
        if (reason === 'missing_phone') {
            return 'Your profile has no phone number. Add a phone number first, or change preferred contact to email.';
        }

        if (reason === 'invalid_phone') {
            return 'Your profile phone number format is invalid for WhatsApp. Update your phone number and try again.';
        }

        if (reason === 'whatsapp_web_client_not_ready') {
            return 'WhatsApp Web is not ready yet. Scan the WhatsApp QR code in the server terminal, then try again.';
        }

        if (reason === 'whatsapp_number_not_found' || reason === 'whatsapp_send_no_lid') {
            return 'WhatsApp OTP could not be sent because this phone number is not reachable on WhatsApp.';
        }

        if (reason === 'whatsapp_web_provider_disabled' || reason === 'whatsapp_disabled') {
            return 'WhatsApp OTP is disabled in configuration. Enable WhatsApp Web notifications and try again.';
        }

        if (reason === 'twilio_send_failed' || reason === 'twilio_not_configured') {
            return 'WhatsApp OTP could not be delivered through Twilio fallback. Check Twilio WhatsApp setup and try again.';
        }

        return 'WhatsApp OTP could not be sent. Please check your profile phone number or WhatsApp setup, or change preferred contact to email.';
    }

    if (reason === 'missing_email') {
        return 'Your profile has no email address. Add an email address first, or change preferred contact to WhatsApp.';
    }

    if (reason === 'smtp_auth_failed') {
        return 'Email OTP could not be sent because SMTP login failed. Check the Gmail app password in SMTP_PASS.';
    }

    if (reason === 'smtp_not_configured' || reason === 'not_configured') {
        return 'Email OTP is not configured. Check SMTP_HOST, SMTP_USER, SMTP_PASS, and EMAIL_FROM.';
    }

    return 'Email OTP could not be sent. Please check your profile email or SMTP configuration.';
}

function getTopupOtpSuccessMessage(method, destination) {
    if (method === 'whatsapp') {
        return `A 6-digit verification code was sent via WhatsApp to ${destination}.`;
    }

    return `A 6-digit verification code was sent via email to ${destination}.`;
}

async function getTopup2faUser(req) {
    const userId = req.session.user?.id;

    if (!userId) {
        return null;
    }

    const user = await new Promise((resolve, reject) => {
        User.findById(userId, (error, result) => error ? reject(error) : resolve(result));
    });

    return user || null;
}

async function sendTopup2faCode(user, method, code) {
    if (method === 'whatsapp') {
        const phone = String(user?.phone || '').trim();
        if (!phone) {
            return { sent: false, reason: 'missing_phone' };
        }

        const message = `Your Vaniday wallet top-up code is ${code}. It expires in 5 minutes.`;
        let result;

        try {
            result = await sendWhatsAppText(phone, message);
        } catch (error) {
            return {
                sent: false,
                reason: 'whatsapp_send_failed',
                errorMessage: error.message || String(error)
            };
        }

        if (result?.skipped) {
            return {
                sent: false,
                reason: result.reason || 'not_configured',
                fallbackReason: result.fallbackReason || null,
                errorMessage: result.errorMessage || null
            };
        }

        return {
            sent: true,
            method: 'whatsapp',
            destination: maskPhone(phone)
        };
    }

    const email = String(user?.email || '').trim();
    if (!email) {
        return { sent: false, reason: 'missing_email' };
    }

    let result;

    try {
        result = await sendWalletTopupOtpEmail({
            email,
            name: user?.name || 'there',
            code
        });
    } catch (error) {
        return {
            sent: false,
            reason: 'smtp_send_failed',
            errorMessage: error.message || String(error)
        };
    }

    if (result?.skipped) {
        return { sent: false, reason: result.reason || 'smtp_not_configured' };
    }

    return {
        sent: true,
        method: 'email',
        destination: maskEmail(email)
    };
}

function generateTopup2faCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function clearTopup2fa(req) {
    req.session.walletTopup2fa = null;
}

function getTopup2faChallenge(req) {
    const challenge = req.session.walletTopup2fa || null;

    if (!challenge) {
        return null;
    }

    const createdAt = Number(challenge.createdAt || 0);
    if (!createdAt || (Date.now() - createdAt) > TOPUP_2FA_TTL_MS) {
        clearTopup2fa(req);
        return null;
    }

    return challenge;
}

function storeTopup2fa(req, amount, paymentMethod, code, delivery) {
    req.session.walletTopup2fa = {
        amount,
        paymentMethod,
        codeHash: hashTopupCode(code),
        createdAt: Date.now(),
        attempts: 0,
        deliveryMethod: delivery?.method || 'email',
        deliveryDestination: delivery?.destination || 'your contact channel'
    };
}

async function startTopupPayment(req, res, amount, paymentMethod) {
    if (!Number.isFinite(amount) || amount < 1 || amount > MAX_TOPUP_AMOUNT) {
        throw new Error(`Top-up amount must be between $1.00 and $${MAX_TOPUP_AMOUNT.toFixed(2)}.`);
    }

    const topup = await new Promise((resolve, reject) => {
        EWallet.createPendingTopup({
            userId: req.session.user.id,
            amount,
            paymentMethod: paymentMethod.toUpperCase(),
            description: `Wallet top-up via ${getProviderLabel(paymentMethod)}`
        }, (error, result) => error ? reject(error) : resolve(result));
    });

    const attemptId = `wallet-${req.session.user.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const attemptPayload = {
        userId: req.session.user.id,
        amount,
        paymentMethod,
        transactionId: topup.transactionId,
        walletTransactionId: topup.transactionId,
        description: `Wallet top-up via ${getProviderLabel(paymentMethod)}`
    };

    await new Promise((resolve, reject) => {
        PaymentAttempt.save({
            attemptId,
            userId: req.session.user.id,
            provider: paymentMethod === 'hitpay' ? 'hitpay' : paymentMethod,
            providerReference: null,
            payment: attemptPayload
        }, (error) => error ? reject(error) : resolve());
    });

    await new Promise((resolve, reject) => {
        EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', `Wallet top-up via ${getProviderLabel(paymentMethod)}`, '', (error) => error ? reject(error) : resolve());
    });

    if (paymentMethod === 'stripe') {
        const baseUrl = getPublicBaseUrl(req);
        const session = await stripe.createWalletTopupSession({
            amount,
            successUrl: `${baseUrl}/profile/wallet/success?transactionId=${topup.transactionId}&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}/profile/wallet/cancel?transactionId=${topup.transactionId}&session_id={CHECKOUT_SESSION_ID}`,
            paymentMethodTypes: ['card'],
            metadata: {
                walletTransactionId: String(topup.transactionId),
                userId: String(req.session.user.id)
            }
        });

        await new Promise((resolve, reject) => {
            PaymentAttempt.save({
                attemptId: session.id,
                userId: req.session.user.id,
                provider: 'stripe',
                providerReference: session.id,
                payment: { ...attemptPayload, providerReference: session.id, stripeSessionId: session.id }
            }, (error) => error ? reject(error) : resolve());
        });
        await new Promise((resolve, reject) => {
            EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', 'Wallet top-up via Stripe', session.id, (error) => error ? reject(error) : resolve());
        });

        return res.redirect(session.url);
    }

    if (paymentMethod === 'paypal') {
        const baseUrl = getPublicBaseUrl(req);
        const order = await paypal.createOrder({
            amount,
            currencyCode: 'SGD',
            referenceId: `wallet-${topup.transactionId}`,
            description: `Wallet top-up via PayPal (${formatAmount(amount)})`,
            returnUrl: `${baseUrl}/profile/wallet/paypal/return`,
            cancelUrl: `${baseUrl}/profile/wallet/paypal/cancel`
        });
        const approvalUrl = Array.isArray(order.links)
            ? order.links.find((link) => link.rel === 'approve')?.href
            : '';
        if (!approvalUrl) {
            throw new Error('PayPal did not return an approval link.');
        }
        await new Promise((resolve, reject) => {
            PaymentAttempt.save({
                attemptId: order.id,
                userId: req.session.user.id,
                provider: 'paypal',
                providerReference: order.id,
                payment: { ...attemptPayload, providerReference: order.id }
            }, (error) => error ? reject(error) : resolve());
        });
        await new Promise((resolve, reject) => {
            EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', 'Wallet top-up via PayPal', order.id, (error) => error ? reject(error) : resolve());
        });
        req.session.walletPendingPaypal = {
            orderId: order.id,
            transactionId: topup.transactionId,
            amount
        };
        return res.redirect(approvalUrl);
    }

    if (paymentMethod === 'hitpay') {
        const baseUrl = getPublicBaseUrl(req);
        const request = await hitpay.createPaymentRequest({
            amount: amount.toFixed(2),
            currency: 'SGD',
            payment_methods: ['paynow_online'],
            email: req.session.user?.email || '',
            name: req.session.user?.name || 'Customer',
            purpose: `Wallet top-up ${formatAmount(amount)}`,
            reference_number: `wallet-${topup.transactionId}`,
            redirect_url: `${baseUrl}/profile/wallet/success?transactionId=${topup.transactionId}`,
            send_email: false,
            send_sms: false
        });
        await new Promise((resolve, reject) => {
            PaymentAttempt.save({
                attemptId: request.id,
                userId: req.session.user.id,
                provider: 'hitpay',
                providerReference: request.id,
                payment: { ...attemptPayload, providerReference: request.id }
            }, (error) => error ? reject(error) : resolve());
        });
        await new Promise((resolve, reject) => {
            EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', 'Wallet top-up via PayNow/HitPay', request.id, (error) => error ? reject(error) : resolve());
        });
        return res.redirect(request.url);
    }

    if (paymentMethod === 'nets') {
        let qrData;
        let isPrototypeQr = false;
        let netsErrorMessage = null;

        try {
            const txnId = nets.createSandboxTxnId();
            qrData = await nets.requestNetsQr(amount, txnId);
            if (!nets.isQrSuccess(qrData)) {
                throw new Error('NETS QR request was not accepted.');
            }
        } catch (error) {
            console.error('NETS wallet top-up QR request failed:', error.message);
            qrData = nets.createPrototypeNetsQr(amount, `wallet-${topup.transactionId}-${Date.now()}`);
            isPrototypeQr = true;
            netsErrorMessage = error.message;
        }
        await new Promise((resolve, reject) => {
            EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', 'Wallet top-up via NETS QR', qrData.txn_retrieval_ref, (error) => error ? reject(error) : resolve());
        });
        req.session.walletPendingNets = {
            transactionId: topup.transactionId,
            txnRetrievalRef: qrData.txn_retrieval_ref,
            amount,
            paymentMethod,
            isPrototypeQr
        };
        return res.render('netsQR', {
            title: 'NETS QR Wallet Top-Up',
            total: amount,
            qrCodeUrl: await buildNetsQrCodeUrl(qrData.qr_code),
            txnRetrievalRef: qrData.txn_retrieval_ref,
            isPrototypeQr,
            netsErrorMessage,
            completeUrl: '/profile/wallet/nets/complete',
            failCompleteUrl: '/profile/wallet/nets/fail',
            successRedirect: '/profile/wallet/success?transactionId=' + topup.transactionId,
            failRedirect: '/profile/wallet/cancel?transactionId=' + topup.transactionId,
            backPrimaryUrl: '/profile/wallet',
            backPrimaryLabel: 'Back to wallet',
            backSecondaryUrl: '/profile',
            backSecondaryLabel: 'Back to profile'
        });
    }

    throw new Error('Unsupported payment method.');
}

async function ensureWallet(req) {
    const userId = req.session.user?.id;
    if (!userId) {
        return null;
    }

    const wallet = await new Promise((resolve, reject) => {
        EWallet.ensureWalletForUser(userId, (error, result) => error ? reject(error) : resolve(result));
    });

    return wallet;
}

async function showWallet(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const wallet = await ensureWallet(req);
        await reconcilePendingTopups(req.session.user.id);
        const walletSummary = await new Promise((resolve, reject) => {
            EWallet.getWalletSummary(req.session.user.id, (error, result) => error ? reject(error) : resolve(result));
        });
        const success = req.session.walletSuccess || null;
        const error = req.session.walletError || null;
        req.session.walletSuccess = null;
        req.session.walletError = null;

        return res.render('e-wallet', {
            title: 'E-Wallet',
            wallet: walletSummary.wallet || wallet,
            transactions: (walletSummary.transactions || []).map((entry) => ({
                ...entry,
                badgeClass: getStatusBadge(entry.status),
                statusLabel: getStatusLabel(entry.status),
                amountLabel: formatAmount(entry.amount),
                createdLabel: entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) : 'Pending'
            })),
            recentTransactions: (walletSummary.recentTransactions || []).map((entry) => ({
                ...entry,
                badgeClass: getStatusBadge(entry.status),
                statusLabel: getStatusLabel(entry.status),
                amountLabel: formatAmount(entry.amount),
                createdLabel: entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) : 'Pending'
            })),
            success,
            error,
            paymentProviders: [
                { key: 'stripe', label: 'Stripe' },
                { key: 'paypal', label: 'PayPal' },
                { key: 'hitpay', label: 'PayNow/HitPay' },
                { key: 'nets', label: 'NETS QR' }
            ],
            maxTopupAmount: MAX_TOPUP_AMOUNT
        });
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Wallet Error',
            message: 'Your e-wallet could not be loaded right now.'
        });
    }
}

async function topupWallet(req, res) {
    if (!req.session.user) {
        setWalletError(req, 'Please log in to add funds to your wallet.');
        return res.redirect('/profile');
    }

    const amount = Number(req.body.amount || 0);
    const paymentMethod = normalizePaymentMethod(req.body.payment_method || req.body.paymentMethod || 'stripe');

    if (!Number.isFinite(amount) || amount <= 0) {
        setWalletError(req, 'Please enter a valid top-up amount.');
        return res.redirect('/profile/wallet');
    }

    if (amount < 1) {
        setWalletError(req, 'Minimum top-up amount is $1.00.');
        return res.redirect('/profile/wallet');
    }

    if (amount > MAX_TOPUP_AMOUNT) {
        setWalletError(req, `Top-up amount cannot exceed $${MAX_TOPUP_AMOUNT.toFixed(2)}.`);
        return res.redirect('/profile/wallet');
    }

    try {
        const user = await getTopup2faUser(req);
        if (!user) {
            setWalletError(req, 'Please log in to add funds to your wallet.');
            return res.redirect('/login');
        }

        const preferredContactMethod = normalizeContactMethod(
            user.preferred_contact_method || user.preferredContactMethod || req.session.user?.preferredContactMethod
        );
        const code = generateTopup2faCode();
        const delivery = await sendTopup2faCode(user, preferredContactMethod, code);

        if (!delivery.sent) {
            console.warn('Wallet top-up OTP delivery failed', {
                userId: user.user_id,
                method: preferredContactMethod,
                reason: delivery.reason || 'unknown',
                fallbackReason: delivery.fallbackReason || null,
                errorMessage: delivery.errorMessage || null
            });
            setWalletError(req, getTopupOtpDeliveryError(preferredContactMethod, delivery.reason));
            return res.redirect('/profile/wallet');
        }

        req.session.user.preferredContactMethod = preferredContactMethod;
        req.session.user.email = user.email || req.session.user.email;
        req.session.user.phone = user.phone || req.session.user.phone;

        storeTopup2fa(req, amount, paymentMethod, code, delivery);
        setWalletSuccess(req, getTopupOtpSuccessMessage(delivery.method, delivery.destination));
        return res.redirect('/profile/wallet/topup/verify');
    } catch (error) {
        console.error(error);
        setWalletError(req, 'Top-up verification code could not be sent. Please try again.');
        return res.redirect('/profile/wallet');
    }
}

function showTopup2faVerify(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const challenge = getTopup2faChallenge(req);
    if (!challenge) {
        setWalletError(req, 'Top-up verification expired. Please start your top-up again.');
        return res.redirect('/profile/wallet');
    }

    const remainingMs = Math.max(0, TOPUP_2FA_TTL_MS - (Date.now() - Number(challenge.createdAt || 0)));
    const success = req.session.walletSuccess || null;
    const error = req.session.walletError || null;
    req.session.walletSuccess = null;
    req.session.walletError = null;

    return res.render('wallet-topup-2fa', {
        title: 'Verify Wallet Top-Up',
        amount: Number(challenge.amount || 0),
        paymentMethodLabel: getProviderLabel(challenge.paymentMethod),
        deliveryMethodLabel: String(challenge.deliveryMethod || 'email').toLowerCase() === 'whatsapp' ? 'WhatsApp' : 'Email',
        deliveryDestination: challenge.deliveryDestination || 'your contact channel',
        expiresInSeconds: Math.ceil(remainingMs / 1000),
        success,
        error
    });
}

async function verifyTopup2fa(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const challenge = getTopup2faChallenge(req);
    if (!challenge) {
        setWalletError(req, 'Top-up verification expired. Please start your top-up again.');
        return res.redirect('/profile/wallet');
    }

    const code = String(req.body.topup2faCode || '').trim();
    if (!/^\d{6}$/.test(code)) {
        setWalletError(req, 'Please enter the 6-digit verification code sent to you.');
        return res.redirect('/profile/wallet/topup/verify');
    }

    const attempts = Number(challenge.attempts || 0) + 1;
    req.session.walletTopup2fa = {
        ...challenge,
        attempts
    };

    if (hashTopupCode(code) !== challenge.codeHash) {
        if (attempts >= 5) {
            clearTopup2fa(req);
            setWalletError(req, 'Too many failed attempts. Please start top-up again.');
            return res.redirect('/profile/wallet');
        }

        setWalletError(req, 'Incorrect verification code. Please try again.');
        return res.redirect('/profile/wallet/topup/verify');
    }

    try {
        const amount = Number(challenge.amount || 0);
        const paymentMethod = normalizePaymentMethod(challenge.paymentMethod);
        clearTopup2fa(req);
        return await startTopupPayment(req, res, amount, paymentMethod);
    } catch (error) {
        console.error(error);
        setWalletError(req, error.message || 'Wallet top-up could not be started.');
        return res.redirect('/profile/wallet');
    }
}

async function handleWalletSuccess(req, res) {
    let transactionId = Number(req.query.transactionId || req.query.txnRetrievalRef || 0);
    const sessionId = String(req.query.session_id || '').trim();
    let referenceId = String(req.query.providerReference || req.query.referenceId || '').trim();
    let userId = req.session.user?.id ? Number(req.session.user.id) : 0;

    try {
        let stripeSession = null;
        if (sessionId) {
            stripeSession = await stripe.retrieveCheckoutSession(sessionId);
            const metadata = getStripeMetadata(stripeSession);

            if (!isStripePaymentConfirmed(stripeSession)) {
                throw new Error('Stripe did not confirm a successful wallet top-up.');
            }

            if (metadata.transactionId && transactionId && metadata.transactionId !== transactionId) {
                throw new Error('Stripe wallet top-up details do not match this transaction.');
            }

            if (metadata.userId && userId && metadata.userId !== userId) {
                throw new Error('Stripe wallet top-up belongs to a different customer.');
            }

            transactionId = transactionId || metadata.transactionId;
            userId = userId || metadata.userId;
            referenceId = referenceId || sessionId;
        }

        if (!userId) {
            return res.redirect('/login?returnTo=' + encodeURIComponent('/profile/wallet'));
        }

        if (!transactionId) {
            throw new Error('Wallet top-up transaction is missing.');
        }

        const pendingTransaction = await new Promise((resolve, reject) => {
            EWallet.getTransactionById(transactionId, userId, (error, result) => error ? reject(error) : resolve(result));
        });

        if (!pendingTransaction) {
            throw new Error('Wallet top-up transaction could not be found.');
        }

        if (String(pendingTransaction.status || '').toUpperCase() === 'COMPLETED') {
            setWalletSuccess(req, 'Your wallet was topped up successfully.');
            return req.session.user ? res.redirect('/profile/wallet') : res.redirect('/login?returnTo=' + encodeURIComponent('/profile/wallet'));
        }

        const method = String(pendingTransaction.paymentMethod || '').toUpperCase();
        let completion = null;

        if (method === 'STRIPE') {
            completion = await verifyAndCompleteStripeTopup(pendingTransaction, userId, referenceId || sessionId);
        } else if (method === 'PAYNOW') {
            completion = await verifyAndCompleteHitPayTopup(pendingTransaction, userId, referenceId);
        } else {
            throw new Error(`Wallet top-up method ${method || 'UNKNOWN'} must be completed by its own payment flow.`);
        }

        if (!completion?.completed) {
            setWalletError(req, 'Payment has not been confirmed by the provider yet. Refresh your wallet in a moment.');
            return req.session.user ? res.redirect('/profile/wallet') : res.redirect('/login?returnTo=' + encodeURIComponent('/profile/wallet'));
        }

        setWalletSuccess(req, 'Your wallet was topped up successfully.');
        return req.session.user ? res.redirect('/profile/wallet') : res.redirect('/login?returnTo=' + encodeURIComponent('/profile/wallet'));
    } catch (error) {
        console.error(error);
        setWalletError(req, 'Your wallet top-up could not be completed.');
        return req.session.user ? res.redirect('/profile/wallet') : res.redirect('/login?returnTo=' + encodeURIComponent('/profile/wallet'));
    }
}

async function handleWalletCancel(req, res) {
    const transactionId = Number(req.query.transactionId || 0);
    const userId = req.session.user?.id;

    if (!userId) {
        return res.redirect('/login');
    }

    try {
        if (transactionId) {
            await new Promise((resolve, reject) => {
                EWallet.updateTransactionStatus(transactionId, userId, 'CANCELLED', 'Wallet top-up cancelled.', '', (error) => error ? reject(error) : resolve());
            });
        }
        setWalletError(req, 'Your wallet top-up was cancelled.');
        return res.redirect('/profile/wallet');
    } catch (error) {
        console.error(error);
        setWalletError(req, 'Your wallet top-up could not be cancelled.');
        return res.redirect('/profile/wallet');
    }
}

async function handlePaypalReturn(req, res) {
    const pending = req.session.walletPendingPaypal;
    const returnedOrderId = String(req.query.token || '').trim();

    if (!pending || !returnedOrderId || returnedOrderId !== pending.orderId) {
        setWalletError(req, 'Your PayPal top-up session is missing or expired.');
        return res.redirect('/profile/wallet');
    }

    try {
        const capturedOrder = await paypal.captureOrder(returnedOrderId);
        const capture = paypal.extractCaptureDetails(capturedOrder);

        if (capture.captureStatus !== 'COMPLETED'
            || capture.currencyCode !== 'SGD'
            || Math.abs(capture.value - Number(pending.amount)) > 0.001) {
            throw new Error('PayPal did not confirm the expected top-up amount.');
        }

        await new Promise((resolve, reject) => {
            EWallet.completePendingTransaction(pending.transactionId, req.session.user.id, {
                description: 'Wallet top-up completed via PayPal',
                providerReference: capture.captureId || returnedOrderId
            }, (error, result) => error ? reject(error) : resolve(result));
        });

        req.session.walletPendingPaypal = null;
        setWalletSuccess(req, 'Your wallet was topped up successfully.');
        return res.redirect('/profile/wallet');
    } catch (error) {
        console.error('PayPal wallet top-up capture failed:', error.payload || error.message);
        setWalletError(req, error.message || 'Your PayPal top-up could not be completed.');
        return res.redirect('/profile/wallet');
    }
}

async function handlePaypalCancel(req, res) {
    const pending = req.session.walletPendingPaypal;
    req.session.walletPendingPaypal = null;

    if (pending?.transactionId) {
        try {
            await new Promise((resolve, reject) => {
                EWallet.updateTransactionStatus(
                    pending.transactionId,
                    req.session.user.id,
                    'CANCELLED',
                    'Wallet top-up cancelled in PayPal.',
                    pending.orderId || '',
                    (error) => error ? reject(error) : resolve()
                );
            });
        } catch (error) {
            console.error('PayPal wallet top-up cancellation failed:', error.message);
        }
    }

    setWalletError(req, 'Your PayPal top-up was cancelled.');
    return res.redirect('/profile/wallet');
}

async function completeNetsTopup(req, res) {
    const pending = req.session.walletPendingNets;
    if (!pending) {
        return res.json({ ok: false, message: 'No pending NETS top-up was found.' });
    }

    try {
        await new Promise((resolve, reject) => {
            EWallet.completePendingTransaction(pending.transactionId, req.session.user.id, {
                description: 'Wallet top-up completed via NETS QR',
                providerReference: pending.txnRetrievalRef
            }, (error) => error ? reject(error) : resolve());
        });
        req.session.walletPendingNets = null;
        return res.json({ ok: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: error.message || 'NETS top-up could not be completed.' });
    }
}

function failNetsTopup(req, res) {
    req.session.walletPendingNets = null;
    return res.json({ ok: true });
}

module.exports = {
    showWallet,
    topupWallet,
    showTopup2faVerify,
    verifyTopup2fa,
    handleWalletSuccess,
    handleWalletCancel,
    handlePaypalReturn,
    handlePaypalCancel,
    completeNetsTopup,
    failNetsTopup,
    getStatusBadge,
    getStatusLabel,
    formatAmount
};
