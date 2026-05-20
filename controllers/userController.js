const bcrypt = require('bcrypt');
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Booking = require('../models/Booking');
const Merchant = require('../models/Merchant');
const Review = require('../models/Review');
const RewardShop = require('../models/RewardShop');
const RewardVoucher = require('../models/RewardVoucher');
const UserVoucher = require('../models/UserVoucher');
const SupportRequest = require('../models/SupportRequest');
const User = require('../models/User');
const Loyalty = require('../models/Loyalty');
const PurchaseHistory = require('../models/PurchaseHistory');
const Notification = require('../models/Notification');
const { getCartItemCount } = require('../utils/cart');
const { rotateCsrfToken } = require('../middleware');
const { getBirthdayPromotionContext } = require('../utils/birthdayPromotions');

const membershipTiers = [
    { name: 'Bronze', points: '0+', detail: 'Entry level', className: 'bronze' },
    { name: 'Silver', points: '2,000+', detail: 'Bonus rewards', className: 'silver' },
    { name: 'Gold', points: '5,000+', detail: 'Priority perks', className: 'gold' },
    { name: 'Platinum', points: '10,000+', detail: 'VIP benefits', className: 'platinum' }
];

const genderOptions = [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
    { value: 'non_binary', label: 'Non-binary' },
    { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    { value: 'other', label: 'Other' }
];

const allowedGenderValues = new Set(genderOptions.map((option) => option.value));

function logNotificationError(error) {
    if (error) {
        console.error('Notification error:', error.message || error);
    }
}

function buildSessionUser(user) {
    return {
        id: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        age: user.age || '',
        birthday: formatDateInputValue(user.birthday),
        gender: user.gender || '',
        postalCode: user.postal_code || user.postalCode || '',
        preferredContactMethod: user.preferred_contact_method || user.preferredContactMethod || '',
        referralCode: user.referral_code || '',
        role: user.role,
        glintsBalance: user.glints_balance || 0
    };
}

function formatDateInputValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value).slice(0, 10);
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
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

function buildCustomerReferral(member, referralCode, stats = {}) {
    const reward = member.tier === 'Platinum' ? 135 : member.tier === 'Gold' ? 105 : member.tier === 'Silver' ? 80 : 60;
    const discount = member.tier === 'Platinum' ? 15 : 10;
    const successfulReferrals = Number(stats.successfulReferrals || 0);
    const mailSubject = encodeURIComponent('Join Vaniday with my referral code');
    const mailBody = encodeURIComponent(`Use my Vaniday referral code ${referralCode} to get $${discount} off your first booking.`);

    return {
        code: referralCode,
        link: `https://www.vaniday.com/ref/${referralCode}`,
        reward,
        discount,
        successfulReferrals,
        earnedGlints: successfulReferrals * reward,
        nextReward: reward,
        mailto: `mailto:?subject=${mailSubject}&body=${mailBody}`
    };
}

function buildReferralVoucherStatus(accountUser, vouchers = []) {
    const usedReferralCode = Boolean(accountUser?.referred_by_code);
    const referralVoucher = vouchers.find((voucher) => String(voucher.sourceType || '').toLowerCase() === 'referral');

    if (referralVoucher && referralVoucher.status === 'active' && Number(referralVoucher.remainingValue || 0) > 0) {
        return {
            tone: 'success',
            message: `Referral voucher active: ${referralVoucher.title} (${referralVoucher.code}) is ready in your rewards vouchers.`
        };
    }

    if (referralVoucher) {
        return {
            tone: 'muted',
            message: `Referral voucher issued earlier: ${referralVoucher.title} (${referralVoucher.code}) has already been used or is no longer active.`
        };
    }

    if (usedReferralCode) {
        return {
            tone: 'warning',
            message: 'This account used a referral code, but there is no referral voucher in your wallet. If this was an older signup before the voucher flow was added, it was not backfilled automatically.'
        };
    }

    return {
        tone: 'muted',
        message: 'This account was not created with someone else’s referral code.'
    };
}

function buildBirthdayPromotion(accountUser, vouchers = []) {
    const context = getBirthdayPromotionContext(accountUser?.birthday);
    const currentBirthdayVoucher = vouchers.find((voucher) => {
        return String(voucher.sourceType || '').toLowerCase() === 'birthday'
            && String(voucher.sourceReference || '') === `birthday-${context.rewardYear}`;
    }) || null;

    return {
        hasBirthday: context.hasBirthday,
        isBirthdayMonth: context.isBirthdayMonth,
        monthName: context.monthName,
        monthEndLabel: context.monthEndLabel,
        voucher: currentBirthdayVoucher,
        pointsMultiplier: context.isBirthdayMonth ? 2 : 1
    };
}

function ensureReferralVoucherForExistingAccount(accountUser, vouchers = [], callback) {
    const usedReferralCode = String(accountUser?.referred_by_code || '').trim();
    const existingReferralVoucher = vouchers.find((voucher) => String(voucher.sourceType || '').toLowerCase() === 'referral');

    if (!usedReferralCode || existingReferralVoucher) {
        callback(null, vouchers);
        return;
    }

    UserVoucher.issueReferralVoucher(accountUser.user_id, usedReferralCode, (error) => {
        if (error) {
            callback(error, vouchers);
            return;
        }

        UserVoucher.getByUserId(accountUser.user_id, callback);
    });
}

function mapWalletHistoryRow(row) {
    return {
        id: row.receipt_id.replace(/^order-/, ''),
        receiptId: row.receipt_id,
        type: row.purchase_type === 'booking' ? 'Booking' : 'Order',
        itemNames: row.item_names,
        totalAmount: Number(row.total_amount || 0),
        paymentMethod: row.payment_method || 'paid',
        paymentStatus: row.payment_status || 'paid',
        createdAt: row.created_at
    };
}

function isCompletedProductOrder(receipt = {}) {
    const deliveryStatus = String(receipt.deliveryStatus || '').toLowerCase();
    const pickupStatus = String(receipt.pickupStatus || '').toLowerCase();

    return deliveryStatus === 'delivered' || ['picked_up', 'collected', 'delivered'].includes(pickupStatus);
}

function sortReviewEntries(entries = []) {
    return [...entries].sort((left, right) => {
        return new Date(right.reviewDate || right.createdAt || 0) - new Date(left.reviewDate || left.createdAt || 0);
    });
}

function buildProductReviewEntries(receipts = [], reviews = []) {
    const reviewMap = reviews.reduce((map, review) => {
        map[`${review.receiptId}:${review.productId}`] = review;
        return map;
    }, {});

    const reviewable = [];
    const reviewed = [];

    receipts.forEach((receipt) => {
        if (!receipt || receipt.type !== 'order' || !isCompletedProductOrder(receipt)) {
            return;
        }

        (Array.isArray(receipt.items) ? receipt.items : []).forEach((item) => {
            const productId = Number(item.serviceId || item.productId || 0);

            if (!Number.isInteger(productId) || productId <= 0) {
                return;
            }

            const review = reviewMap[`${receipt.id}:${productId}`] || null;
            const entry = {
                reviewItemType: 'product',
                id: `${receipt.id}:${productId}`,
                receiptId: receipt.id,
                productId,
                product_name: item.name || 'Product',
                merchant_name: item.merchantName || receipt.merchantName || 'Vaniday merchant',
                booking_date: receipt.paidAt,
                reviewDate: receipt.paidAt,
                status: receipt.pickupStatus || receipt.deliveryStatus || receipt.paymentStatus || 'delivered',
                fulfilment: receipt.fulfilment || '',
                quantity: Number(item.quantity || 1),
                review
            };

            if (review) {
                reviewed.push(entry);
                return;
            }

            reviewable.push(entry);
        });
    });

    return {
        reviewable,
        reviewed
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
    let upcomingBookings = [];
    let pastBookings = [];
    let cancelledBookings = [];
    let walletHistory = [];
    let reviewableBookings = [];
    let reviewedBookings = [];
        let bookingAvailability = {};
        let userVouchers = [];
        let birthdayPromotion = buildBirthdayPromotion(accountUser, []);

    function finishWithWallet(walletError, loyalty = null) {
        const wallet = loyalty?.wallet || {};
        const rewardPoints = walletError
            ? 0
            : Number(wallet.pointsBalance || 0);
        const member = buildMember(rewardPoints);
        User.getReferralStats(referralCode, (statsError, referralStats = {}) => {
            if (statsError) {
                console.error(statsError);
            }

            const customerExtras = {
                favourites,
                cartItemCount,
                rewardPoints,
                cashbackBalance: walletError
                    ? '0.00'
                    : Number(wallet.cashbackBalance || 0).toFixed(2),
                member,
                loyalty,
                walletHistory,
                userVouchers,
                referral: buildCustomerReferral(member, referralCode, referralStats),
                referralVoucherStatus: buildReferralVoucherStatus(accountUser, userVouchers),
                birthdayPromotion,
                upcomingBookings,
                pastBookings,
                cancelledBookings,
                bookingAvailability,
                reviewableBookings,
                reviewedBookings
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

        UserVoucher.getByUserId(accountUser.user_id, (voucherError, vouchers = []) => {
            if (voucherError) {
                console.error(voucherError);
            }
            
            ensureReferralVoucherForExistingAccount(accountUser, vouchers, (backfillError, hydratedVouchers = vouchers) => {
                if (backfillError) {
                    console.error(backfillError);
                }

                const continueWithBirthdayVouchers = (currentVouchers) => {
                    userVouchers = currentVouchers;
                    birthdayPromotion = buildBirthdayPromotion(accountUser, currentVouchers);

                    const receipts = rows.map(PurchaseHistory.mapReceipt).filter(Boolean);
                    walletHistory = rows.map(mapWalletHistoryRow);
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

                    Booking.getByUserId(accountUser.user_id, (bookingError, bookings = []) => {
                        if (bookingError) {
                            console.error(bookingError);
                            awardNext();
                            return;
                        }

                        const supportByBookingId = {};
                        const supportIssueTypes = new Set([
                            'booking_refund',
                            'refund_dispute',
                            'merchant_rejection',
                            'payment_issue',
                            'technical_issue'
                        ]);

                        const continueWithSupport = (supportRequests = []) => {
                            supportRequests.forEach((request) => {
                                if (request.targetType !== 'booking' || !supportIssueTypes.has(request.requestType)) {
                                    return;
                                }

                                supportByBookingId[String(request.targetId)] = request;
                            });

                            upcomingBookings = bookings.filter((booking) => booking.booking_group === 'upcoming');
                            cancelledBookings = bookings
                                .filter((booking) => String(booking.status || '').toLowerCase() === 'cancelled')
                                .map((booking) => ({
                                    ...booking,
                                    supportEscalation: supportByBookingId[String(booking.id)] || null
                                }));
                            pastBookings = bookings.filter((booking) => (
                                booking.booking_group === 'past'
                                && String(booking.status || '').toLowerCase() !== 'cancelled'
                            ));
                            const bookingIds = pastBookings.map((booking) => booking.id);

                            Review.getByBookingIds(bookingIds, (reviewError, reviews = []) => {
                                if (reviewError) {
                                    console.error(reviewError);
                                } else {
                                    const reviewMap = reviews.reduce((map, review) => {
                                        map[String(review.bookingId)] = review;
                                        return map;
                                    }, {});

                                    pastBookings = pastBookings.map((booking) => ({
                                        ...booking,
                                        review: reviewMap[String(booking.id)] || null
                                    }));
                                }

                                const serviceReviewedBookings = pastBookings
                                    .filter((booking) => booking.review)
                                    .map((booking) => ({
                                        ...booking,
                                        reviewItemType: 'service',
                                        reviewDate: booking.booking_date
                                    }));
                                const serviceReviewableBookings = pastBookings
                                    .filter((booking) => (
                                    ['completed', 'checked_in'].includes(String(booking.status || '').toLowerCase()) && !booking.review
                                    ))
                                    .map((booking) => ({
                                        ...booking,
                                        reviewItemType: 'service',
                                        reviewDate: booking.booking_date
                                    }));
                                pastBookings = pastBookings.filter((booking) => !booking.review && !(
                                    ['completed', 'checked_in'].includes(String(booking.status || '').toLowerCase()) && !booking.review
                                ));

                                const productReceipts = receipts.filter((receipt) => receipt && receipt.type === 'order');
                                const productReceiptIds = productReceipts.map((receipt) => String(receipt.id || '').trim()).filter(Boolean);

                                Review.getByReceiptIds(productReceiptIds, (productReviewError, productReviews = []) => {
                                    if (productReviewError) {
                                        console.error(productReviewError);
                                    }

                                    const productEntries = buildProductReviewEntries(productReceipts, productReviews);
                                    reviewedBookings = sortReviewEntries([
                                        ...serviceReviewedBookings,
                                        ...productEntries.reviewed
                                    ]);
                                    reviewableBookings = sortReviewEntries([
                                        ...serviceReviewableBookings,
                                        ...productEntries.reviewable
                                    ]);

                                    const upcomingIds = upcomingBookings.map((booking) => booking.id);
                                    Booking.getAvailabilityByBookingIds(accountUser.user_id, upcomingIds, (availabilityError, availabilityMap = {}) => {
                                        if (availabilityError) {
                                            console.error(availabilityError);
                                        } else {
                                            bookingAvailability = availabilityMap;
                                        }

                                        awardNext();
                                    });
                                });
                            });
                        };

                        SupportRequest.getForCustomer(accountUser.user_id, (supportError, supportRequests = []) => {
                            if (supportError) {
                                console.error(supportError);
                                continueWithSupport([]);
                                return;
                            }

                            continueWithSupport(supportRequests);
                        });
                    });
                };

                return UserVoucher.ensureBirthdayVoucherForUser(accountUser, (birthdayVoucherError) => {
                    if (birthdayVoucherError) {
                        console.error(birthdayVoucherError);
                    }

                    return UserVoucher.getByUserId(accountUser.user_id, (refreshedVoucherError, refreshedVouchers = hydratedVouchers) => {
                        if (refreshedVoucherError) {
                            console.error(refreshedVoucherError);
                            continueWithBirthdayVouchers(hydratedVouchers);
                            return;
                        }

                        continueWithBirthdayVouchers(refreshedVouchers);
                    });
                });
            });
        });
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
        walletHistory: [],
        userVouchers: [],
        referral: null,
        referralVoucherStatus: null,
        birthdayPromotion: {
            hasBirthday: false,
            isBirthdayMonth: false,
            monthName: '',
            monthEndLabel: '',
            voucher: null,
            pointsMultiplier: 1
        },
        upcomingBookings: [],
        pastBookings: [],
        cancelledBookings: [],
        bookingAvailability: {},
        reviewableBookings: [],
        reviewedBookings: []
    };
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidOptionalPhone(phone) {
    return phone === '' || /^[689]\d{7}$/.test(phone);
}

function getCustomerDetailsForm(body = {}) {
    return {
        age: String(body.age || '').trim(),
        birthday: String(body.birthday || '').trim(),
        gender: String(body.gender || '').trim(),
        postalCode: String(body.postalCode || '').trim(),
        preferredContactMethod: String(body.preferredContactMethod || '').trim()
    };
}

function validateCustomerDetails(form, { required = false } = {}) {
    const errors = [];
    const age = Number(form.age);
    const birthday = form.birthday ? new Date(`${form.birthday}T00:00:00`) : null;

    if (required || form.age) {
        if (!Number.isInteger(age) || age < 1 || age > 120) {
            errors.push('Please enter a valid age from 1 to 120.');
        }
    }

    if (required || form.birthday) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!birthday || Number.isNaN(birthday.getTime()) || birthday > today) {
            errors.push('Please enter a valid birthday that is not in the future.');
        }
    }

    if (required || form.gender) {
        if (!allowedGenderValues.has(form.gender)) {
            errors.push('Please select a valid gender.');
        }
    }

    if (required || form.postalCode) {
        if (!/^\d{6}$/.test(form.postalCode)) {
            errors.push('Please enter a valid 6-digit postal code.');
        }
    }

    if (required || form.preferredContactMethod) {
        if (!['email', 'phone', 'whatsapp'].includes(form.preferredContactMethod)) {
            errors.push('Please select a valid preferred contact method.');
        }
    }

    return errors;
}

function buildCustomerDetailsPayload(form) {
    return {
        age: form.age ? Number(form.age) : null,
        birthday: form.birthday || null,
        gender: form.gender || null,
        postalCode: form.postalCode || null,
        preferredContactMethod: form.preferredContactMethod || null
    };
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

function setAuthenticatedSession(req, user, message, callback) {
    const preserved = {
        cart: req.session.cart,
        favouriteMerchantIds: req.session.favouriteMerchantIds
    };

    req.session.regenerate((sessionError) => {
        if (sessionError) {
            callback(sessionError);
            return;
        }

        if (preserved.cart) {
            req.session.cart = preserved.cart;
        }

        if (preserved.favouriteMerchantIds) {
            req.session.favouriteMerchantIds = preserved.favouriteMerchantIds;
        }

        rotateCsrfToken(req);
        req.session.user = buildSessionUser(user);
        req.session.profile = {
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            age: user.age || '',
            birthday: formatDateInputValue(user.birthday),
            gender: user.gender || '',
            postalCode: user.postal_code || user.postalCode || '',
            preferredContactMethod: user.preferred_contact_method || user.preferredContactMethod || ''
        };
        req.session.profileSuccess = message || 'You are logged in.';
        callback(null);
    });
}

function completeLogin(req, res, user, message = 'You are logged in.') {
    return setAuthenticatedSession(req, user, message, (sessionError) => {
        if (sessionError) {
            console.error(sessionError);
            req.session.loginError = 'Login failed. Please try again.';
            return res.redirect('/login');
        }

        return res.redirect(getDashboardPath(req.session.user.role));
    });
}

let googleAuthConfigured = false;

function hasGoogleAuthConfig() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function createGoogleCustomer(profile, callback) {
    const email = String(profile.emails?.[0]?.value || '').trim().toLowerCase();
    const name = profile.displayName || email.split('@')[0] || 'Vaniday Customer';
    const randomPassword = crypto.randomBytes(32).toString('hex');

    return bcrypt.hash(randomPassword, 12, (hashError, passwordHash) => {
        if (hashError) {
            callback(hashError);
            return;
        }

        return User.create({ name, email, phone: null, password: passwordHash, role: 'customer' }, (createError, result) => {
            if (createError) {
                if (createError.code === 'ER_DUP_ENTRY') {
                    return User.findByEmail(email, callback);
                }

                callback(createError);
                return;
            }

            const referralCode = generateReferralCode(result.insertId);
            return User.updateReferralCode(result.insertId, referralCode, (referralError) => {
                if (referralError) {
                    callback(referralError);
                    return;
                }

                return RewardShop.initializeForUser(result.insertId, (rewardError) => {
                    if (rewardError) {
                        callback(rewardError);
                        return;
                    }

                    return User.findById(result.insertId, callback);
                });
            });
        });
    });
}

function configureGoogleAuth() {
    if (googleAuthConfigured || !hasGoogleAuthConfig()) {
        return;
    }

    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        state: true
    }, (accessToken, refreshToken, profile, done) => {
        const email = String(profile.emails?.[0]?.value || '').trim().toLowerCase();
        const isVerified = profile.emails?.[0]?.verified !== false
            && profile._json?.email_verified !== false;

        if (!email || !isVerified) {
            done(null, false, { message: 'Google did not return a verified email address.' });
            return;
        }

        return User.findByEmail(email, (lookupError, user) => {
            if (lookupError) {
                done(lookupError);
                return;
            }

            if (user) {
                done(null, user);
                return;
            }

            return createGoogleCustomer(profile, done);
        });
    }));

    googleAuthConfigured = true;
}

function getDailyRewardTrack(wallet) {
    const values = Array.isArray(wallet?.rewardValues) && wallet.rewardValues.length > 0
        ? wallet.rewardValues
        : RewardShop.DEFAULT_DAILY_REWARD_VALUES;
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
            req.session.loginError = 'Incorrect email or password.';
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

            return completeLogin(req, res, user);
        });
    });
}

function startGoogleLogin(req, res, next) {
    configureGoogleAuth();

    if (!hasGoogleAuthConfig()) {
        req.session.loginError = 'Google login is not configured yet.';
        return res.redirect('/login');
    }

    return passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account',
        session: false
    })(req, res, next);
}

function handleGoogleCallback(req, res, next) {
    configureGoogleAuth();

    if (!hasGoogleAuthConfig()) {
        req.session.loginError = 'Google login is not configured yet.';
        return res.redirect('/login');
    }

    return passport.authenticate('google', { session: false }, (error, user, info) => {
        if (error) {
            console.error(error);
            req.session.loginError = 'Google login failed. Please try again.';
            return res.redirect('/login');
        }

        if (!user) {
            req.session.loginError = info?.message || 'Google login failed. Please try again.';
            return res.redirect('/login');
        }

        return completeLogin(req, res, user, 'You are logged in with Google.');
    })(req, res, next);
}

function showSignup(req, res) {
    const referralCodeFromQuery = String(req.query.ref || '').trim().toUpperCase();

    if (req.session.user && !referralCodeFromQuery) {
        return res.redirect(getDashboardPath(req.session.user.role));
    }

    const error = req.session.signupError;
    const form = {
        ...(req.session.signupForm || {}),
        referralCode: req.session.signupForm?.referralCode || referralCodeFromQuery
    };
    req.session.signupError = null;
    req.session.signupForm = null;

    return res.render('signup', {
        title: 'Sign Up',
        error,
        form
    });
}

function openReferralSignup(req, res) {
    const referralCode = String(req.params.referralCode || '').trim().toUpperCase();
    return res.redirect(`/signup${referralCode ? `?ref=${encodeURIComponent(referralCode)}` : ''}`);
}

function signupUser(req, res) {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const password = req.body.password || '';
    const confirmPassword = req.body.confirmPassword || '';
    const enteredReferralCode = (req.body.referralCode || '').trim().toUpperCase();
    const customerDetailsForm = getCustomerDetailsForm(req.body);
    const signupForm = { name, email, phone, ...customerDetailsForm, referralCode: enteredReferralCode };

    if (name.length < 2 || !isValidEmail(email) || !/^[689]\d{7}$/.test(phone)) {
        req.session.signupError = 'Please enter a valid name, email, and 8-digit Singapore handphone number.';
        req.session.signupForm = signupForm;
        return res.redirect('/signup');
    }

    const customerDetailErrors = validateCustomerDetails(customerDetailsForm, { required: true });

    if (customerDetailErrors.length > 0) {
        req.session.signupError = customerDetailErrors.join(' ');
        req.session.signupForm = signupForm;
        return res.redirect('/signup');
    }

    const passwordErrors = validateNewPassword(password);

    if (passwordErrors.length > 0 || password !== confirmPassword) {
        req.session.signupError = password !== confirmPassword
            ? 'Password and confirmation must match.'
            : passwordErrors.join(' ');
        req.session.signupForm = signupForm;
        return res.redirect('/signup');
    }

    return User.findByEmail(email, (lookupError, existingUser) => {
        if (lookupError) {
            console.error(lookupError);
            req.session.signupError = 'Account could not be created. Please try again.';
            req.session.signupForm = signupForm;
            return res.redirect('/signup');
        }

        if (existingUser) {
            req.session.signupError = 'An account already exists with that email.';
            req.session.signupForm = signupForm;
            return res.redirect('/signup');
        }

        return bcrypt.hash(password, 12, (hashError, passwordHash) => {
            if (hashError) {
                console.error(hashError);
                req.session.signupError = 'Account could not be created. Please try again.';
                req.session.signupForm = signupForm;
                return res.redirect('/signup');
            }

            return User.create({
                name,
                email,
                phone,
                ...buildCustomerDetailsPayload(customerDetailsForm),
                password: passwordHash
            }, (createError, result) => {
                if (createError) {
                    console.error(createError);
                    req.session.signupError = createError.code === 'ER_DUP_ENTRY'
                        ? 'An account already exists with that email.'
                        : 'Account could not be created. Please try again.';
                    req.session.signupForm = signupForm;
                    return res.redirect('/signup');
                }

                const newUser = {
                    user_id: result.insertId,
                    name,
                    email,
                    phone,
                    ...buildCustomerDetailsPayload(customerDetailsForm),
                    referral_code: '',
                    role: 'customer',
                    glints_balance: 0
                };
                const referralCode = generateReferralCode(result.insertId);

                return User.updateReferralCode(result.insertId, referralCode, (referralError) => {
                    if (referralError) {
                        console.error(referralError);
                        return setAuthenticatedSession(req, {
                            ...newUser,
                            referral_code: ''
                        }, 'Account created successfully. Your referral code will be prepared from your profile page.', (sessionError) => {
                            if (sessionError) {
                                console.error(sessionError);
                                req.session.signupError = 'Account was created, but login failed. Please log in.';
                                return res.redirect('/login');
                            }

                            return res.redirect('/profile');
                        });
                    }

                    const finishSignup = () => RewardShop.initializeForUser(result.insertId, (rewardError) => {
                        if (rewardError) {
                            console.error(rewardError);
                        }

                        return setAuthenticatedSession(req, {
                            ...newUser,
                            referral_code: referralCode
                        }, 'Account created successfully.', (sessionError) => {
                            if (sessionError) {
                                console.error(sessionError);
                                req.session.signupError = 'Account was created, but login failed. Please log in.';
                                return res.redirect('/login');
                            }

                            return res.redirect('/profile');
                        });
                    });

                    if (!enteredReferralCode || enteredReferralCode === referralCode) {
                        return finishSignup();
                    }

                    return User.findByReferralCode(enteredReferralCode, (lookupReferralError, referrer) => {
                        if (lookupReferralError) {
                            console.error(lookupReferralError);
                            return finishSignup();
                        }

                        if (!referrer || Number(referrer.user_id) === Number(result.insertId)) {
                            return finishSignup();
                        }

                        return User.setReferredByCode(result.insertId, enteredReferralCode, (trackReferralError) => {
                            if (trackReferralError) {
                                console.error(trackReferralError);
                                return finishSignup();
                            }

                            return UserVoucher.issueReferralVoucher(result.insertId, enteredReferralCode, (voucherError) => {
                                if (voucherError) {
                                    console.error(voucherError);
                                }

                                return finishSignup();
                            });
                        });
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
            age: accountUser?.age ?? sessionProfile.age ?? req.session.user.age ?? '',
            birthday: formatDateInputValue(accountUser?.birthday ?? sessionProfile.birthday ?? req.session.user.birthday),
            gender: accountUser?.gender || sessionProfile.gender || req.session.user.gender || '',
            postalCode: accountUser?.postal_code || sessionProfile.postalCode || req.session.user.postalCode || '',
            preferredContactMethod: accountUser?.preferred_contact_method || sessionProfile.preferredContactMethod || req.session.user.preferredContactMethod || '',
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
                walletHistory: customerExtras.walletHistory,
                userVouchers: customerExtras.userVouchers,
                referral: customerExtras.referral,
                referralVoucherStatus: customerExtras.referralVoucherStatus,
                birthdayPromotion: customerExtras.birthdayPromotion,
                upcomingBookings: customerExtras.upcomingBookings,
                pastBookings: customerExtras.pastBookings,
                cancelledBookings: customerExtras.cancelledBookings,
                bookingAvailability: customerExtras.bookingAvailability,
                reviewableBookings: customerExtras.reviewableBookings,
                reviewedBookings: customerExtras.reviewedBookings,
                isCustomer,
                genderOptions,
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

            return RewardVoucher.getActive((voucherError, voucherOffers = []) => {
                if (voucherError) {
                    console.error(voucherError);
                }

                return UserVoucher.getActiveForUser(req.session.user.id, (ownedVoucherError, ownedVouchers = []) => {
                    if (ownedVoucherError) {
                        console.error(ownedVoucherError);
                    }

                    const offers = (voucherError ? RewardVoucher.DEFAULT_REWARD_VOUCHERS : voucherOffers).map((offer) => ({
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
                        ownedVoucherCount: ownedVouchers.length,
                        success,
                        error,
                        rewardWallet,
                        dailyRewards: getDailyRewardTrack(rewardWallet)
                    });
                });
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
        Notification.create({
            recipientUserId: req.session.user.id,
            recipientRole: 'customer',
            actorUserId: null,
            type: 'reward_update',
            title: 'Daily reward claimed',
            message: `${result.rewardValue} VaniGlints were added to your reward balance.`,
            linkUrl: '/reward-shop',
            dedupeKey: `customer-daily-reward-${req.session.user.id}-${new Date().toISOString().slice(0, 10)}`
        }, logNotificationError);
        return res.redirect('/reward-shop');
    });
}

function redeemRewardShopVoucher(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return RewardVoucher.findById(req.params.voucherId, (lookupError, offer) => {
        if (lookupError) {
            console.error(lookupError);
            req.session.rewardShopError = 'That voucher could not be loaded.';
            return res.redirect('/reward-shop');
        }

        if (!offer || String(offer.status || 'active') !== 'active') {
            req.session.rewardShopError = 'That voucher is no longer available.';
            return res.redirect('/reward-shop');
        }

        return UserVoucher.redeemRewardShopVoucher(req.session.user.id, offer, (redeemError, voucher) => {
            if (redeemError) {
                console.error(redeemError);
                req.session.rewardShopError = redeemError.message || 'Voucher could not be redeemed.';
                return res.redirect('/reward-shop');
            }

            req.session.user.glintsBalance = Math.max(0, Number(req.session.user.glintsBalance || 0) - Number(offer.glintsCost || 0));
            req.session.rewardShopSuccess = `${voucher.title} redeemed successfully. It is now stored under Rewards on your profile.`;
            Notification.create({
                recipientUserId: req.session.user.id,
                recipientRole: 'customer',
                actorUserId: null,
                type: 'reward_update',
                title: 'Voucher redeemed',
                message: `${voucher.title} was added to your profile vouchers.`,
                linkUrl: '/profile#membership',
                dedupeKey: `reward-voucher-redeemed-${req.session.user.id}-${voucher.id}`
            }, logNotificationError);
            return res.redirect('/reward-shop');
        });
    });
}

function updateProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const customerDetailsForm = getCustomerDetailsForm(req.body);
    const customerDetailErrors = validateCustomerDetails(customerDetailsForm);

    if (name.length < 2 || !isValidEmail(email) || !isValidOptionalPhone(phone)) {
        req.session.profileError = 'Please enter a valid name, email, and Singapore handphone number.';
        return res.redirect('/profile');
    }

    if (customerDetailErrors.length > 0) {
        req.session.profileError = customerDetailErrors.join(' ');
        return res.redirect('/profile');
    }

    const customerDetails = buildCustomerDetailsPayload(customerDetailsForm);

    return User.updateProfile(req.session.user.id, { name, email, phone, ...customerDetails }, (error) => {
        if (error) {
            console.error(error);
            req.session.profileError = error.code === 'ER_DUP_ENTRY'
                ? 'Another account already uses that email.'
                : 'Profile could not be updated. Please try again.';
            return res.redirect('/profile');
        }

        req.session.profile = { name, email, phone, ...customerDetails };
        req.session.user = {
            ...req.session.user,
            name,
            email,
            phone,
            ...customerDetails
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
    startGoogleLogin,
    handleGoogleCallback,
    showSignup,
    openReferralSignup,
    signupUser,
    showProfile,
    showRewardShop,
    claimRewardShopDaily,
    redeemRewardShopVoucher,
    updateProfile,
    updatePassword,
    logoutUser
};
