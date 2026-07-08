const EWallet = require('../models/EWallet');
const stripe = require('../services/stripe');
const paypal = require('../services/paypal');
const hitpay = require('../services/hitpay');
const nets = require('../services/nets');
const PaymentAttempt = require('../models/PaymentAttempt');
const crypto = require('crypto');

const TOPUP_2FA_TTL_MS = 5 * 60 * 1000;

function getPublicBaseUrl(req) {
    return String(process.env.BASE_URL || process.env.APP_URL || `http://${req.get('host') || 'localhost'}`).replace(/\/$/, '');
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

function getProviderLabel(method) {
    switch (method) {
        case 'paypal': return 'PayPal';
        case 'hitpay': return 'PayNow/HitPay';
        case 'nets': return 'NETS QR';
        case 'stripe':
        default: return 'Stripe';
    }
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

function startTopup2fa(req, amount, paymentMethod) {
    const code = generateTopup2faCode();
    req.session.walletTopup2fa = {
        amount,
        paymentMethod,
        codeHash: hashTopupCode(code),
        createdAt: Date.now(),
        attempts: 0
    };

    console.log(`[Wallet2FA] Top-up OTP for user ${req.session.user?.id}: ${code} (expires in 5 minutes)`);
}

async function startTopupPayment(req, res, amount, paymentMethod) {
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
            successUrl: `${baseUrl}/profile/wallet/success?transactionId=${topup.transactionId}`,
            cancelUrl: `${baseUrl}/profile/wallet/cancel?transactionId=${topup.transactionId}`,
            paymentMethodTypes: ['card']
        });
        return res.redirect(session.url);
    }

    if (paymentMethod === 'paypal') {
        const baseUrl = getPublicBaseUrl(req);
        const order = await paypal.createOrder({
            amount,
            currencyCode: 'SGD',
            referenceId: `wallet-${topup.transactionId}`,
            description: `Wallet top-up via PayPal (${formatAmount(amount)})`
        });
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
        return res.redirect(`/api/paypal/checkout?orderId=${encodeURIComponent(order.id)}`);
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
        const txnId = nets.createSandboxTxnId();
        const qrData = await nets.requestNetsQr(amount, txnId);
        if (!nets.isQrSuccess(qrData)) {
            throw new Error('NETS QR request was not accepted.');
        }
        await new Promise((resolve, reject) => {
            EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', 'Wallet top-up via NETS QR', qrData.txn_retrieval_ref, (error) => error ? reject(error) : resolve());
        });
        req.session.walletPendingNets = {
            transactionId: topup.transactionId,
            txnRetrievalRef: qrData.txn_retrieval_ref,
            amount,
            paymentMethod
        };
        return res.render('netsQR', {
            title: 'NETS QR Wallet Top-Up',
            total: amount,
            qrCodeUrl: await (async () => {
                const payload = qrData.qr_code;
                if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(payload))) {
                    return payload;
                }
                if (/^https:\/\//i.test(String(payload))) {
                    return payload;
                }
                return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(String(payload))}`;
            })(),
            txnRetrievalRef: qrData.txn_retrieval_ref,
            isPrototypeQr: false,
            netsErrorMessage: null,
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
            ]
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

    startTopup2fa(req, amount, paymentMethod);
    setWalletSuccess(req, 'A sample verification code was sent to the server terminal. Enter it to continue.');
    return res.redirect('/profile/wallet/topup/verify');
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
        setWalletError(req, 'Please enter the 6-digit verification code from the terminal.');
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

    try {
        if (paymentMethod === 'stripe') {
            const baseUrl = getPublicBaseUrl(req);
            const session = await stripe.createWalletTopupSession({
                amount,
                successUrl: `${baseUrl}/profile/wallet/success?transactionId=${topup.transactionId}`,
                cancelUrl: `${baseUrl}/profile/wallet/cancel?transactionId=${topup.transactionId}`,
                paymentMethodTypes: ['card']
            });
            return res.redirect(session.url);
        }

        if (paymentMethod === 'paypal') {
            const baseUrl = getPublicBaseUrl(req);
            const order = await paypal.createOrder({
                amount,
                currencyCode: 'SGD',
                referenceId: `wallet-${topup.transactionId}`,
                description: `Wallet top-up via PayPal (${formatAmount(amount)})`
            });
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
                EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', `Wallet top-up via PayPal`, order.id, (error) => error ? reject(error) : resolve());
            });
            return res.redirect(`/api/paypal/checkout?orderId=${encodeURIComponent(order.id)}`);
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
                EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', `Wallet top-up via PayNow/HitPay`, request.id, (error) => error ? reject(error) : resolve());
            });
            return res.redirect(request.url);
        }

        if (paymentMethod === 'nets') {
            const txnId = nets.createSandboxTxnId();
            const qrData = await nets.requestNetsQr(amount, txnId);
            if (!nets.isQrSuccess(qrData)) {
                throw new Error('NETS QR request was not accepted.');
            }
            await new Promise((resolve, reject) => {
                EWallet.updateTransactionStatus(topup.transactionId, req.session.user.id, 'PENDING', `Wallet top-up via NETS QR`, qrData.txn_retrieval_ref, (error) => error ? reject(error) : resolve());
            });
            req.session.walletPendingNets = {
                transactionId: topup.transactionId,
                txnRetrievalRef: qrData.txn_retrieval_ref,
                amount,
                paymentMethod
            };
            return res.render('netsQR', {
                title: 'NETS QR Wallet Top-Up',
                total: amount,
                qrCodeUrl: await (async () => {
                    const payload = qrData.qr_code;
                    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(payload))) {
                        return payload;
                    }
                    if (/^https:\/\//i.test(String(payload))) {
                        return payload;
                    }
                    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(String(payload))}`;
                })(),
                txnRetrievalRef: qrData.txn_retrieval_ref,
                isPrototypeQr: false,
                netsErrorMessage: null,
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
    } catch (error) {
        console.error(error);
        setWalletError(req, error.message || 'Wallet top-up could not be started.');
        return res.redirect('/profile/wallet');
    }
}

async function handleWalletSuccess(req, res) {
    const transactionId = Number(req.query.transactionId || req.query.txnRetrievalRef || 0);
    const referenceId = String(req.query.providerReference || req.query.referenceId || '').trim();
    const userId = req.session.user?.id;

    if (!userId) {
        return res.redirect('/login');
    }

    try {
        let pendingTransaction = null;
        if (transactionId) {
            pendingTransaction = await new Promise((resolve, reject) => {
                EWallet.getTransactionById(transactionId, userId, (error, result) => error ? reject(error) : resolve(result));
            });
        }

        if (!pendingTransaction) {
            setWalletSuccess(req, 'Your wallet was updated successfully.');
            return res.redirect('/profile/wallet');
        }

        const completed = await new Promise((resolve, reject) => {
            EWallet.completePendingTransaction(pendingTransaction.transactionId, userId, {
                description: `Wallet top-up completed via ${getProviderLabel(normalizePaymentMethod(req.query.paymentMethod || req.query.provider || 'stripe'))}`,
                providerReference: referenceId || pendingTransaction.referenceId || ''
            }, (error, result) => error ? reject(error) : resolve(result));
        });

        if (completed && completed.status === 'COMPLETED') {
            setWalletSuccess(req, 'Your wallet was topped up successfully.');
            return res.redirect('/profile/wallet');
        }

        setWalletError(req, 'Your wallet top-up could not be completed.');
        return res.redirect('/profile/wallet');
    } catch (error) {
        console.error(error);
        setWalletError(req, 'Your wallet top-up could not be completed.');
        return res.redirect('/profile/wallet');
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
    completeNetsTopup,
    failNetsTopup,
    getStatusBadge,
    getStatusLabel,
    formatAmount
};
