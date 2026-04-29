const bcrypt = require('bcrypt');
const Merchant = require('../models/Merchant');
const User = require('../models/User');

function buildSessionUser(user) {
    return {
        id: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        glintsBalance: user.glints_balance || 0
    };
}

function showLogin(req, res) {
    if (req.session.user) {
        return res.redirect('/profile');
    }

    const error = req.session.loginError;
    const form = req.session.loginForm || {};
    req.session.loginError = null;
    req.session.loginForm = null;

    return res.render('login', {
        title: 'Log In',
        error,
        form
    });
}

function loginUser(req, res) {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1) {
        req.session.loginError = 'Please enter a valid email and password.';
        req.session.loginForm = { email };
        return res.redirect('/login');
    }

    return User.findByEmail(email, (lookupError, user) => {
        if (lookupError) {
            console.error(lookupError);
            req.session.loginError = 'Login failed. Please try again.';
            req.session.loginForm = { email };
            return res.redirect('/login');
        }

        if (!user) {
            req.session.loginError = 'No account was found with that email.';
            req.session.loginForm = { email };
            return res.redirect('/login');
        }

        return bcrypt.compare(password, user.password, (compareError, passwordMatches) => {
            if (compareError) {
                console.error(compareError);
                req.session.loginError = 'Login failed. Please try again.';
                req.session.loginForm = { email };
                return res.redirect('/login');
            }

            if (!passwordMatches) {
                req.session.loginError = 'Incorrect email or password.';
                req.session.loginForm = { email };
                return res.redirect('/login');
            }

            req.session.user = buildSessionUser(user);
            req.session.profile = {
                name: user.name,
                email: user.email,
                phone: user.phone || ''
            };
            req.session.profileSuccess = 'You are logged in.';

            return res.redirect('/profile');
        });
    });
}

function showSignup(req, res) {
    if (req.session.user) {
        return res.redirect('/profile');
    }

    const error = req.session.signupError;
    const form = req.session.signupForm || {};
    req.session.signupError = null;
    req.session.signupForm = null;

    return res.render('signup', {
        title: 'Sign Up',
        error,
        form
    });
}

function signupUser(req, res) {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const password = req.body.password || '';
    const confirmPassword = req.body.confirmPassword || '';

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[689]\d{7}$/.test(phone)) {
        req.session.signupError = 'Please enter a valid name, email, and 8-digit Singapore handphone number.';
        req.session.signupForm = { name, email, phone };
        return res.redirect('/signup');
    }

    if (password.length < 4 || password !== confirmPassword) {
        req.session.signupError = 'Password must be at least 4 characters and match the confirmation.';
        req.session.signupForm = { name, email, phone };
        return res.redirect('/signup');
    }

    return User.findByEmail(email, (lookupError, existingUser) => {
        if (lookupError) {
            console.error(lookupError);
            req.session.signupError = 'Account could not be created. Please try again.';
            req.session.signupForm = { name, email, phone };
            return res.redirect('/signup');
        }

        if (existingUser) {
            req.session.signupError = 'An account already exists with that email.';
            req.session.signupForm = { name, email, phone };
            return res.redirect('/signup');
        }

        return bcrypt.hash(password, 10, (hashError, passwordHash) => {
            if (hashError) {
                console.error(hashError);
                req.session.signupError = 'Account could not be created. Please try again.';
                req.session.signupForm = { name, email, phone };
                return res.redirect('/signup');
            }

            return User.create({ name, email, password: passwordHash }, (createError, result) => {
                if (createError) {
                    console.error(createError);
                    req.session.signupError = createError.code === 'ER_DUP_ENTRY'
                        ? 'An account already exists with that email.'
                        : 'Account could not be created. Please try again.';
                    req.session.signupForm = { name, email, phone };
                    return res.redirect('/signup');
                }

                req.session.user = {
                    id: result.insertId,
                    name,
                    email,
                    phone,
                    role: 'customer',
                    glintsBalance: 0
                };
                req.session.profile = { name, email, phone };
                req.session.profileSuccess = 'Account created successfully.';

                return res.redirect('/profile');
            });
        });
    });
}

function showProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const favouriteIds = req.session.favouriteMerchantIds || [];
    const favourites = favouriteIds
        .map((merchantId) => Merchant.findById(merchantId))
        .filter(Boolean);
    const cart = req.session.cart || [];
    const profile = req.session.profile || {
        name: req.session.user.name,
        email: req.session.user.email,
        phone: ''
    };
    const rewardPoints = favourites.length * 50 + cart.length * 20;
    const cashbackBalance = (rewardPoints / 100).toFixed(2);

    const success = req.session.profileSuccess;
    const error = req.session.profileError;
    req.session.profileSuccess = null;
    req.session.profileError = null;

    return res.render('profile', {
        title: 'Profile',
        profile,
        favourites,
        cartCount: cart.length,
        rewardPoints,
        cashbackBalance,
        success,
        error
    });
}

function updateProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        req.session.profileError = 'Please enter a valid name and email.';
        return res.redirect('/profile');
    }

    return User.updateProfile(req.session.user.id, { name, email }, (error) => {
        if (error) {
            console.error(error);
            req.session.profileError = error.code === 'ER_DUP_ENTRY'
                ? 'Another account already uses that email.'
                : 'Profile could not be updated. Please try again.';
            return res.redirect('/profile');
        }

        req.session.profile = { name, email, phone };
        req.session.user = {
            ...req.session.user,
            name,
            email,
            phone
        };
        req.session.profileSuccess = 'Profile updated successfully.';

        return res.redirect('/profile');
    });
}

function logoutUser(req, res) {
    req.session.destroy(() => {
        res.redirect('/login');
    });
}

module.exports = {
    showLogin,
    loginUser,
    showSignup,
    signupUser,
    showProfile,
    updateProfile,
    logoutUser
};
