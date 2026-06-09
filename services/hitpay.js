const HITPAY_API_KEY = String(process.env.HITPAY_API_KEY || '').trim();
const HITPAY_API_BASE = String(process.env.HITPAY_URL || process.env.HITPAY_BASE_URL || 'https://api.sandbox.hit-pay.com').trim().replace(/\/$/, '');

function isConfigured() {
    return Boolean(HITPAY_API_KEY && HITPAY_API_BASE);
}

function assertConfigured() {
    if (!isConfigured()) {
        throw new Error('HitPay is not configured. Set HITPAY_API_KEY and HITPAY_URL.');
    }
}

async function hitpayRequest(path, { method = 'GET', body = null } = {}) {
    assertConfigured();

    const response = await fetch(`${HITPAY_API_BASE}${path}`, {
        method,
        headers: {
            'X-BUSINESS-API-KEY': HITPAY_API_KEY,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message
            || data?.error
            || data?.errors?.[0]?.message
            || `HitPay request failed with status ${response.status}.`;
        const error = new Error(message);
        error.status = response.status;
        error.payload = data;
        throw error;
    }

    return data;
}

async function createPaymentRequest(payload) {
    return hitpayRequest('/v1/payment-requests', {
        method: 'POST',
        body: payload
    });
}

async function getPaymentRequest(requestId) {
    if (!requestId || !String(requestId).trim()) {
        throw new Error('HitPay request ID is required.');
    }

    return hitpayRequest(`/v1/payment-requests/${encodeURIComponent(String(requestId).trim())}`);
}

module.exports = {
    isConfigured,
    createPaymentRequest,
    getPaymentRequest
};
