function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
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
    requireLogin,
    requireRole
};
