const crypto = require('crypto');

function getSecret() {
    return process.env.QR_TOKEN_SECRET || process.env.SESSION_SECRET || 'vaniday_secret_key';
}

function signMerchantToken(merchantId) {
    const id = String(merchantId);
    const signature = crypto
        .createHmac('sha256', getSecret())
        .update(id)
        .digest('base64url');

    return `${id}.${signature}`;
}

function verifyMerchantToken(merchantId, token) {
    if (!merchantId || !token) {
        return false;
    }

    const expected = signMerchantToken(merchantId);
    const expectedBuffer = Buffer.from(expected);
    const tokenBuffer = Buffer.from(String(token));

    return expectedBuffer.length === tokenBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, tokenBuffer);
}

function getPublicBaseUrl(req) {
    const configuredUrl = process.env.PUBLIC_BASE_URL;

    if (configuredUrl) {
        return configuredUrl.replace(/\/$/, '');
    }

    return `${req.protocol}://${req.get('host')}`;
}

function getMerchantScanPath(merchantId) {
    return `/scan/${merchantId}?token=${encodeURIComponent(signMerchantToken(merchantId))}`;
}

function getMerchantScanUrl(req, merchantId) {
    return `${getPublicBaseUrl(req)}${getMerchantScanPath(merchantId)}`;
}

module.exports = {
    getMerchantScanPath,
    getMerchantScanUrl,
    signMerchantToken,
    verifyMerchantToken
};
