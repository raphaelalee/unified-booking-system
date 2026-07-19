const crypto = require('crypto');

const PAYPAL_CLIENT_ID = String(process.env.PAYPAL_CLIENT_ID || '').trim();
const PAYPAL_CLIENT_SECRET = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
const PAYPAL_API_BASE = String(process.env.PAYPAL_API || 'https://api-m.sandbox.paypal.com').trim().replace(/\/$/, '');
const PAYPAL_TIMEOUT_MS = 15000;

function isConfigured() {
    return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

function getClientId() {
    return PAYPAL_CLIENT_ID;
}

function getApiBase() {
    return PAYPAL_API_BASE;
}

function assertConfigured() {
    if (!isConfigured()) {
        throw new Error('PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
    }
}

async function paypalRequest(path, { method = 'GET', headers = {}, body = null, timeoutMs = PAYPAL_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${PAYPAL_API_BASE}${path}`, {
            method,
            headers,
            body,
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = data?.message
                || data?.error_description
                || data?.name
                || `PayPal request failed with status ${response.status}.`;
            const error = new Error(message);
            error.status = response.status;
            error.payload = data;
            throw error;
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

async function getAccessToken() {
    assertConfigured();

    const basicAuth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const data = await paypalRequest('/v1/oauth2/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    if (!data?.access_token) {
        throw new Error('PayPal access token was not returned.');
    }

    return data.access_token;
}

async function createOrder({ amount, currencyCode = 'SGD', referenceId, description, returnUrl, cancelUrl }) {
    const accessToken = await getAccessToken();
    const value = Number(amount || 0);

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error('PayPal order amount is invalid.');
    }

    const body = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                reference_id: String(referenceId || `ref-${Date.now()}`),
                description: String(description || 'Vaniday payment').slice(0, 127),
                amount: {
                    currency_code: currencyCode,
                    value: value.toFixed(2)
                }
            }
        ]
    };

    if (returnUrl && cancelUrl) {
        body.application_context = {
            return_url: String(returnUrl),
            cancel_url: String(cancelUrl),
            user_action: 'PAY_NOW'
        };
    }

    return paypalRequest('/v2/checkout/orders', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            'PayPal-Request-Id': crypto.randomUUID()
        },
        body: JSON.stringify(body)
    });
}

async function captureOrder(orderId) {
    const accessToken = await getAccessToken();

    if (!orderId || !String(orderId).trim()) {
        throw new Error('PayPal order ID is required.');
    }

    return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(String(orderId).trim())}/capture`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            'PayPal-Request-Id': crypto.randomUUID()
        },
        body: '{}'
    });
}

async function refundCapture(captureId, { amount, currencyCode = 'SGD', reason = '' } = {}) {
    const accessToken = await getAccessToken();
    const value = Number(amount || 0);

    if (!captureId || !String(captureId).trim()) {
        throw new Error('PayPal capture ID is required.');
    }

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error('PayPal refund amount is invalid.');
    }

    return paypalRequest(`/v2/payments/captures/${encodeURIComponent(String(captureId).trim())}/refund`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            'PayPal-Request-Id': crypto.randomUUID()
        },
        body: JSON.stringify({
            amount: {
                currency_code: currencyCode,
                value: value.toFixed(2)
            },
            note_to_payer: String(reason || 'Vaniday refund').slice(0, 255)
        })
    });
}

function extractCaptureDetails(order = {}) {
    const purchaseUnit = Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
    const payments = purchaseUnit?.payments || {};
    const capture = Array.isArray(payments.captures) ? payments.captures[0] : null;

    return {
        orderId: order.id || '',
        status: order.status || '',
        captureId: capture?.id || '',
        captureStatus: capture?.status || '',
        currencyCode: capture?.amount?.currency_code || purchaseUnit?.amount?.currency_code || '',
        value: Number(capture?.amount?.value || purchaseUnit?.amount?.value || 0),
        payerEmail: order?.payer?.email_address || '',
        payerId: order?.payer?.payer_id || ''
    };
}

module.exports = {
    isConfigured,
    getClientId,
    getApiBase,
    createOrder,
    captureOrder,
    refundCapture,
    extractCaptureDetails
};
