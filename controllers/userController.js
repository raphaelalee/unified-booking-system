const bcrypt = require('bcrypt');
const Merchant = require('../models/Merchant');
const RewardShop = require('../models/RewardShop');
const User = require('../models/User');
const Loyalty = require('../models/Loyalty');
const PurchaseHistory = require('../models/PurchaseHistory');
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
        referralCode: user.referral_code || '',
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

function generateReferralCode(userId) {
    return `VANI${String(userId).padStart(4, '0')}`;
}

function buildCustomerReferral(member, referralCode) {
    const reward = member.tier === 'Platinum' ? 135 : member.tier === 'Gold' ? 105 : member.tier === 'Silver' ? 80 : 60;
    const discount = member.tier === 'Platinum' ? 15 : 10;
    const mailSubject = encodeURIComponent('Join Vaniday with my referral code');
    const mailBody = encodeURIComponent(`Use my Vaniday referral code ${referralCode} to get $${discount} off your first booking.`);

    return {
        code: referralCode,
        link: `https://www.vaniday.com/ref/${referralCode}`,
        reward,
        discount,
        mailto: `mailto:?subject=${mailSubject}&body=${mailBody}`
    };
}

function buildCustomerProfileExtras(req, accountUser, callback) {
    const favouriteIds = req.session.favouriteMerchantIds || [];
    const favourites = favouriteIds
        .map((merchantId) => Merchant.findById(merchantId))
        .filter(Boolean);
    const cart = req.session.cart || [];
    const cartItemCount = getCartItemCount(cart);
    const referralCode = accountUser.referral_code || generateReferralCode(accountUser.user_id);

    function finishWithWallet(walletError, loyalty = null) {
        const wallet = loyalty?.wallet || {};
        const rewardPoints = walletError
            ? 0
            : Number(wallet.pointsBalance || 0);
        const member = buildMember(rewardPoints);
        const customerExtras = {
            favourites,
            cartItemCount,
            rewardPoints,
            cashbackBalance: walletError
                ? '0.00'
                : Number(wallet.cashbackBalance || 0).toFixed(2),
            member,
            loyalty,
            referral: buildCustomerReferral(member, referralCode)
        };

        if (accountUser.referral_code) {
            callback(walletError, customerExtras);
            return;
        }

        User.updateReferralCode(accountUser.user_id, referralCode, (error) => {
            if (error) {
                callback(error, customerExtras);
                return;
            }

            req.session.user.referralCode = referralCode;
            callback(walletError, customerExtras);
        });
    }

    function loadWallet() {
        Loyalty.getWalletView(accountUser.user_id, finishWithWallet);
    }

    PurchaseHistory.getByUserId(accountUser.user_id, (historyError, rows = []) => {
        if (historyError) {
            console.error(historyError);
            loadWallet();
            return;
        }

        const receipts = rows.map(PurchaseHistory.mapReceipt).filter(Boolean);
        let index = 0;

        function awardNext() {
            if (index >= receipts.length) {
                loadWallet();
                return;
            }

            const receipt = receipts[index];
            index += 1;
            Loyalty.awardForReceipt(receipt, (awardError) => {
                if (awardError) {
                    console.error(awardError);
                }

                awardNext();
            });
        }

        awardNext();
    });
}

function getEmptyCustomerExtras() {
    return {
        favourites: [],
        cartItemCount: 0,
        rewardPoints: 0,
        cashbackBalance: '0.00',
        member: buildMember(0),
        loyalty: null,
        referral: null
    };
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidOptionalPhone(phone) {
    return phone === '' || /^[689]\d{7}$/.test(phone);
}

function getDashboardPath(role) {
    if (role === 'admin') return '/admin';
    if (role === 'merchant') return '/merchant';
    return '/profile';
}

function getRoleLabel(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'merchant') return 'Merchant';
    return 'Customer';
}

function getRewardShopOffers() {
    return [
        {
            id: 'glints-1000',
            glintsCost: 1000,
            voucherValue: 1,
            title: '$1 Off Booking',
            detail: 'Best for stacking up small cashback-style redemptions.'
        },
        {
            id: 'glints-5000',
            glintsCost: 5000,
            voucherValue: 5,
            title: '$5 Off Booking',
            detail: 'A stronger offset for weekday treatments and quick services.'
        },
        {
            id: 'glints-10000',
            glintsCost: 10000,
            voucherValue: 10,
            title: '$10 Off Booking',
            detail: 'Ideal for premium facials, massages, and bundled appointments.'
        },
        {
            id: 'glints-15000',
            glintsCost: 15000,
            voucherValue: 15,
            title: '$15 Off Booking',
            detail: 'Higher-value reward for larger bookings and platform promos.'
        }
    ];
}

function getDailyRewardTrack(wallet) {
    const values = RewardShop.DAILY_REWARD_VALUES;
    const currentDay = Number(wallet?.currentDay || 0);

    return values.map((points, index) => ({
        points,
        label: index === 0 ? 'Today' : `Day ${index + 1}`,
        isClaimed: index < currentDay,
        isCurrent: index === currentDay
    }));
}

function validateNewPassword(password) {
    const errors = [];

    if (password.length < 8) {
        errors.push('New password must be at least 8 characters.');
    }

    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        errors.push('New password must include at least one letter and one number.');
    }

    return errors;
}

function showLogin(req, res) {
    if (req.session.user) {
        return res.redirect(getDashboardPath(req.session.user.role));
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

    if (!isValidEmail(email) || password.length < 1) {
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
                return res.redirect('/merchant');
            }

            return res.redirect('/profile');
        });
    });
}

function showSignup(req, res) {
    if (req.session.user) {
        return res.redirect(getDashboardPath(req.session.user.role));
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

    if (name.length < 2 || !isValidEmail(email) || !/^[689]\d{7}$/.test(phone)) {
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

            return User.create({ name, email, phone, password: passwordHash }, (createError, result) => {
                if (createError) {
                    console.error(createError);
                    req.session.signupError = createError.code === 'ER_DUP_ENTRY'
                        ? 'An account already exists with that email.'
                        : 'Account could not be created. Please try again.';
                    req.session.signupForm = { name, email, phone };
                    return res.redirect('/signup');
                }

                const referralCode = generateReferralCode(result.insertId);
                req.session.user = {
                    id: result.insertId,
                    name,
                    email,
                    phone,
                    referralCode,
                    role: 'customer',
                    glintsBalance: 0
                };
                req.session.profile = { name, email, phone };

                return User.updateReferralCode(result.insertId, referralCode, (referralError) => {
                    if (referralError) {
                        console.error(referralError);
                        req.session.user.referralCode = '';
                        req.session.profileSuccess = 'Account created successfully. Your referral code will be prepared from your profile page.';
                        return res.redirect('/profile');
                    }

                    return RewardShop.initializeForUser(result.insertId, (rewardError) => {
                        if (rewardError) {
                            console.error(rewardError);
                        }

                        req.session.profileSuccess = 'Account created successfully.';
                        return res.redirect('/profile');
                    });
                });
            });
        });
    });
}

function showProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return User.findById(req.session.user.id, (lookupError, accountUser) => {
        if (lookupError) {
            console.error(lookupError);
        }

        const sessionProfile = req.session.profile || {};
        const profile = {
            name: accountUser?.name || sessionProfile.name || req.session.user.name,
            email: accountUser?.email || sessionProfile.email || req.session.user.email,
            phone: accountUser?.phone || sessionProfile.phone || '',
            glintsBalance: Number(accountUser?.glints_balance ?? req.session.user.glintsBalance ?? 0)
        };

        if (accountUser) {
            req.session.user = buildSessionUser(accountUser);
            req.session.profile = profile;
        }

        const isCustomer = req.session.user.role === 'customer';
        const renderProfile = (customerExtras, customerExtraError = null) => {
            const success = req.session.profileSuccess;
            const error = req.session.profileError || req.session.loyaltyError
                || (lookupError ? 'Account details could not be refreshed from the database.' : null)
                || (customerExtraError ? 'Referral details could not be saved yet. Please refresh and try again.' : null);
            req.session.profileSuccess = null;
            req.session.profileError = null;
            req.session.loyaltyError = null;
            const loyaltySuccess = req.session.loyaltySuccess;
            req.session.loyaltySuccess = null;

            return res.render('profile', {
                title: 'Profile',
                profile,
                favourites: customerExtras.favourites,
                cartCount: customerExtras.cartItemCount,
                rewardPoints: customerExtras.rewardPoints,
                cashbackBalance: customerExtras.cashbackBalance,
                member: customerExtras.member,
                loyalty: customerExtras.loyalty,
                referral: customerExtras.referral,
                isCustomer,
                dashboardPath: getDashboardPath(req.session.user.role),
                roleLabel: getRoleLabel(req.session.user.role),
                success: success || loyaltySuccess,
                error
            });
        };

        if (!isCustomer || !accountUser) {
            return renderProfile(getEmptyCustomerExtras());
        }

        return buildCustomerProfileExtras(req, accountUser, (customerExtraError, customerExtras) => {
            if (customerExtraError) {
                console.error(customerExtraError);
            }

            return renderProfile(customerExtras, customerExtraError);
        });
    });
}

function showRewardShop(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return User.findById(req.session.user.id, (lookupError, accountUser) => {
        if (lookupError || !accountUser) {
            if (lookupError) {
                console.error(lookupError);
            }

            return res.status(500).render('error', {
                title: 'Reward Shop Error',
                message: 'Your reward balance could not be loaded.'
            });
        }

        req.session.user = buildSessionUser(accountUser);
        const glintsBalance = Number(accountUser.glints_balance || 0);
        return RewardShop.getWallet(req.session.user.id, (walletError, rewardWallet) => {
            if (walletError) {
                console.error(walletError);
                return res.status(500).render('error', {
                    title: 'Reward Shop Error',
                    message: 'Your daily reward details could not be loaded.'
                });
            }

            const offers = getRewardShopOffers().map((offer) => ({
                ...offer,
                canRedeem: glintsBalance >= offer.glintsCost,
                remaining: Math.max(offer.glintsCost - glintsBalance, 0)
            }));
            const success = req.session.rewardShopSuccess || null;
            const error = req.session.rewardShopError || null;
            req.session.rewardShopSuccess = null;
            req.session.rewardShopError = null;

            return res.render('reward-shop', {
                title: 'Reward Shop',
                glintsBalance,
                offers,
                success,
                error,
                rewardWallet,
                dailyRewards: getDailyRewardTrack(rewardWallet)
            });
        });
    });
}

function claimRewardShopDaily(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return RewardShop.claimDailyReward(req.session.user.id, (error, result) => {
        if (error) {
            console.error(error);
            req.session.rewardShopError = 'Daily VaniGlints could not be claimed. Please try again.';
            return res.redirect('/reward-shop');
        }

        if (result.alreadyClaimed) {
            req.session.rewardShopError = 'You already claimed today. Next claim is tomorrow.';
            return res.redirect('/reward-shop');
        }

        req.session.user.glintsBalance = Number(req.session.user.glintsBalance || 0) + Number(result.rewardValue || 0);
        req.session.rewardShopSuccess = `Claimed ${result.rewardValue} VaniGlints for today.`;
        return res.redirect('/reward-shop');
    });
}

function updateProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();

    if (name.length < 2 || !isValidEmail(email) || !isValidOptionalPhone(phone)) {
        req.session.profileError = 'Please enter a valid name, email, and Singapore handphone number.';
        return res.redirect('/profile');
    }

    return User.updateProfile(req.session.user.id, { name, email, phone }, (error) => {
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

function updatePassword(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const currentPassword = req.body.currentPassword || '';
    const newPassword = req.body.newPassword || '';
    const confirmPassword = req.body.confirmPassword || '';
    const passwordErrors = validateNewPassword(newPassword);

    req.session.passwordChangeAttempts = req.session.passwordChangeAttempts || 0;

    if (req.session.passwordChangeAttempts >= 5) {
        req.session.profileError = 'Too many failed password attempts. Please log out and log in again before trying to change your password.';
        return res.redirect('/profile');
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
        req.session.profileError = 'Please complete all password fields.';
        return res.redirect('/profile');
    }

    if (newPassword !== confirmPassword) {
        req.session.profileError = 'New password and confirmation do not match.';
        return res.redirect('/profile');
    }

    if (passwordErrors.length > 0) {
        req.session.profileError = passwordErrors.join(' ');
        return res.redirect('/profile');
    }

    if (currentPassword === newPassword) {
        req.session.profileError = 'New password must be different from your current password.';
        return res.redirect('/profile');
    }

    return User.findById(req.session.user.id, (lookupError, user) => {
        if (lookupError || !user) {
            console.error(lookupError);
            req.session.profileError = 'Your account could not be verified. Please log in again.';
            return res.redirect('/profile');
        }

        return bcrypt.compare(currentPassword, user.password, (compareError, currentMatches) => {
            if (compareError) {
                console.error(compareError);
                req.session.profileError = 'Password could not be checked. Please try again.';
                return res.redirect('/profile');
            }

            if (!currentMatches) {
                req.session.passwordChangeAttempts += 1;
                req.session.profileError = 'Current password is incorrect.';
                return res.redirect('/profile');
            }

            return bcrypt.hash(newPassword, 12, (hashError, passwordHash) => {
                if (hashError) {
                    console.error(hashError);
                    req.session.profileError = 'Password could not be secured. Please try again.';
                    return res.redirect('/profile');
                }

                return User.updatePassword(req.session.user.id, passwordHash, (updateError) => {
                    if (updateError) {
                        console.error(updateError);
                        req.session.profileError = 'Password could not be updated. Please try again.';
                        return res.redirect('/profile');
                    }

                    req.session.passwordChangeAttempts = 0;
                    req.session.profileSuccess = 'Password updated successfully.';
                    return res.redirect('/profile');
                });
            });
        });
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
    showRewardShop,
    claimRewardShopDaily,
    updateProfile,
    updatePassword,
    logoutUser
};
