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

function signBookingCheckInToken(bookingId) {
    const id = String(bookingId);
    const signature = crypto
        .createHmac('sha256', getSecret())
        .update(`booking-check-in:${id}`)
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

function verifyBookingCheckInToken(token) {
    if (!token) {
        return null;
    }

    const [bookingId] = String(token).split('.');

    if (!bookingId || !/^\d+$/.test(bookingId)) {
        return null;
    }

    const expected = signBookingCheckInToken(bookingId);
    const expectedBuffer = Buffer.from(expected);
    const tokenBuffer = Buffer.from(String(token));

    if (
        expectedBuffer.length !== tokenBuffer.length
        || !crypto.timingSafeEqual(expectedBuffer, tokenBuffer)
    ) {
        return null;
    }

    return bookingId;
}

function getPublicBaseUrl(req) {
    const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    return BASE_URL.replace(/\/$/, '');
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'merchant';
}

function getMerchantStorefrontSlug(merchant) {
    const merchantId = merchant?.id || merchant?.salonId || merchant;
    if (merchant?.slug) {
        return String(merchant.slug);
    }

    if (merchant?.qrToken) {
        return `${merchant.qrToken}-${merchantId}`;
    }

    const base = typeof merchant === 'object' ? slugify(merchant.name || merchant.salonName) : 'merchant';
    return `${base}-${merchantId}`;
}

function parseMerchantStorefrontSlug(slug) {
    const match = String(slug || '').match(/-(\d+)$/);
    return match ? match[1] : null;
}

function getMerchantStorefrontPath(merchant) {
    return `/m/${encodeURIComponent(getMerchantStorefrontSlug(merchant))}`;
}

function getMerchantStorefrontUrl(req, merchant) {
    return `${getPublicBaseUrl(req)}${getMerchantStorefrontPath(merchant)}`;
}

function getMerchantScanPath(merchantId) {
    return `/scan/${merchantId}?token=${encodeURIComponent(signMerchantToken(merchantId))}`;
}

function getMerchantScanUrl(req, merchantId) {
    return `${getPublicBaseUrl(req)}${getMerchantScanPath(merchantId)}`;
}

function getBookingCheckInPath(bookingId) {
    return `/checking/${encodeURIComponent(signBookingCheckInToken(bookingId))}`;
}

function getBookingCheckInUrl(req, bookingId) {
    return `${getPublicBaseUrl(req)}${getBookingCheckInPath(bookingId)}`;
}

module.exports = {
    getBookingCheckInPath,
    getBookingCheckInUrl,
    getMerchantStorefrontPath,
    getMerchantStorefrontUrl,
    getMerchantStorefrontSlug,
    getMerchantScanPath,
    getMerchantScanUrl,
    getPublicBaseUrl,
    parseMerchantStorefrontSlug,
    signMerchantToken,
    signBookingCheckInToken,
    verifyBookingCheckInToken,
    verifyMerchantToken
};
