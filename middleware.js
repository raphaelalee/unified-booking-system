const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const rateLimitBuckets = new Map();

function wantsJson(req) {
    return req.xhr
        || req.path.startsWith('/api/')
        || (req.get('accept') || '').includes('application/json');
}

function sendForbidden(req, res, message) {
    if (wantsJson(req)) {
        return res.status(403).json({ success: false, message });
    }

    return res.status(403).render('error', {
        title: 'Request Blocked',
        message
    });
}

function setSecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (req.secure || req.get('x-forwarded-proto') === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    return next();
}

function ensureCsrfToken(req, res, next) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    res.locals.csrfToken = req.session.csrfToken;
    return next();
}

function verifyCsrfToken(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
        return next();
    }

    const submittedToken = req.body?._csrf || req.get('x-csrf-token');

    if (submittedToken && req.session.csrfToken && submittedToken === req.session.csrfToken) {
        return next();
    }

    return sendForbidden(req, res, 'This request could not be verified. Please refresh the page and try again.');
}

function rotateCsrfToken(req) {
    if (req.session) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
}

function getClientKey(req, namespace) {
    return `${namespace}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function createRateLimiter({ windowMs = 60000, max = 60, namespace = 'default', message = 'Too many requests. Please wait a moment and try again.' } = {}) {
    return (req, res, next) => {
        const now = Date.now();
        const key = getClientKey(req, namespace);
        const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };

        if (bucket.resetAt <= now) {
            bucket.count = 0;
            bucket.resetAt = now + windowMs;
        }

        bucket.count += 1;
        rateLimitBuckets.set(key, bucket);

        if (bucket.count > max) {
            res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));

            if (wantsJson(req)) {
                return res.status(429).json({ success: false, message });
            }

            return res.status(429).render('error', {
                title: 'Slow Down',
                message
            });
        }

        return next();
    };
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return next();
}

function getRoleHome(role) {
    if (role === 'admin') return '/admin';
    if (role === 'merchant') return '/merchant';
    return '/';
}

function allowGuestOrCustomer(req, res, next) {
    if (!req.session.user || req.session.user.role === 'customer') {
        return next();
    }

    return res.redirect(getRoleHome(req.session.user.role));
}

function allowBookingViewer(req, res, next) {
    if (!req.session.user || req.session.user.role === 'customer' || req.session.user.role === 'merchant') {
        return next();
    }

    return res.redirect(getRoleHome(req.session.user.role));
}

function requireCustomer(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    if (req.session.user.role !== 'customer') {
        return res.status(403).render('error', {
            title: 'Customer Access Only',
            message: 'This feature is only available to customer accounts.'
        });
    }

    return next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }

        if (!roles.includes(req.session.user.role)) {
            return res.status(403).render('error', {
                title: 'Access Denied',
                message: 'You do not have permission to access this page.'
            });
        }

        return next();
    };
}

module.exports = {
    allowBookingViewer,
    allowGuestOrCustomer,
    createRateLimiter,
    getRoleHome,
    ensureCsrfToken,
    requireCustomer,
    requireLogin,
    requireRole,
    rotateCsrfToken,
    setSecurityHeaders,
    verifyCsrfToken
};
