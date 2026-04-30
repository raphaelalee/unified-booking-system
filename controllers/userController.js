const bcrypt = require('bcrypt');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const { getCartItemCount } = require('../utils/cart');

const membershipTiers = [
    { name: 'Bronze', points: '0+', detail: 'Entry level', className: 'bronze' },
    { name: 'Silver', points: '2,000+', detail: 'Bonus rewards', className: 'silver' },
    { name: 'Gold', points: '5,000+', detail: 'Priority perks', className: 'gold' },
    { name: 'Platinum', points: '10,000+', detail: 'VIP benefits', className: 'platinum' }
];

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

function getMemberTier(points) {
    if (points >= 10000) return 'Platinum';
    if (points >= 5000) return 'Gold';
    if (points >= 2000) return 'Silver';
    return 'Bronze';
}

function buildMember(points) {
    return {
        points,
        tier: getMemberTier(points),
        progress: Math.min((points / 10000) * 100, 100),
        next: Math.max(10000 - points, 0),
        tiers: membershipTiers
    };
}

function buildReferral(profile, user, member) {
    const reward = member.tier === 'Platinum' ? 135 : member.tier === 'Gold' ? 105 : member.tier === 'Silver' ? 80 : 60;
    const prefix = ((profile.name || 'vaniday').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'vani').toUpperCase();
    const userId = String((user && user.id) || 0).padStart(4, '0');
    const code = `${prefix}${userId}`;
    const discount = member.tier === 'Platinum' ? 15 : 10;
    const mailSubject = encodeURIComponent('Join Vaniday with my referral code');
    const mailBody = encodeURIComponent(`Use my Vaniday referral code ${code} to get $${discount} off your first booking.`);

    return {
        reward,
        code,
        discount,
        mailto: `mailto:?subject=${mailSubject}&body=${mailBody}`
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

            if (req.session.user.role === 'admin') {
                return res.redirect('/admin');
            }

            if (req.session.user.role === 'merchant') {
                return res.redirect('/merchant/services');
            }

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
    const cartItemCount = getCartItemCount(cart);
    const profile = req.session.profile || {
        name: req.session.user.name,
        email: req.session.user.email,
        phone: ''
    };
    const rewardPoints = favourites.length * 50 + cartItemCount * 20;
    const cashbackBalance = (rewardPoints / 100).toFixed(2);
    const member = buildMember(rewardPoints);
    const referral = buildReferral(profile, req.session.user, member);

    const success = req.session.profileSuccess;
    const error = req.session.profileError;
    req.session.profileSuccess = null;
    req.session.profileError = null;

    return res.render('profile', {
        title: 'Profile',
        profile,
        favourites,
        cartCount: cartItemCount,
        rewardPoints,
        cashbackBalance,
        member,
        referral,
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
