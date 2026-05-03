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
    getRoleHome,
    requireCustomer,
    requireLogin,
    requireRole
};
