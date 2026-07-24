const express = require('express');
require('dotenv').config();
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const passport = require('passport');
const merchantController = require('./controllers/merchantController');
const userController = require('./controllers/userController');
const aiController = require('./controllers/aiController');
const adminController = require('./controllers/adminController');
const routineFinderController = require('./controllers/routineFinderController');
const spinDiscoverController = require('./controllers/spinDiscoverController');
const SpinDiscover = require('./models/SpinDiscover');
const receiptController = require('./controllers/receiptController');
const profileController = require('./controllers/profileController');
const loyaltyController = require('./controllers/loyaltyController');
const walletController = require('./controllers/walletController');
const merchantDashboardController = require('./controllers/merchantDashboardController');
const bookingController = require('./controllers/bookingController');
const notificationController = require('./controllers/notificationController');
const helpCenterController = require('./controllers/helpCenterController');
const whatsappController = require('./controllers/whatsappController');
const aiRoutes = require('./routes/aiRoutes');
const Booking = require('./models/Booking');
const Review = require('./models/Review');
const CashbackCampaign = require('./models/CashbackCampaign');
const { uploadReviewMedia } = require('./utils/reviewUpload');
const { uploadSupportScreenshot } = require('./utils/supportUpload');
const { uploadProductImage } = require('./utils/productUpload');
const { uploadProfileImage } = require('./utils/profileUpload');
const { startBookingAutoCompletionScheduler } = require('./services/bookingAutoCompletion');
const { startSmsReminderScheduler } = require('./services/smsAutomation');
const { startWhatsAppReminderScheduler } = require('./services/whatsappAutomation');
const { startWhatsAppWebClient } = require('./services/whatsappWebClient');
const {
    allowGuestOrCustomer,
    allowBookingViewer,
    createRateLimiter,
    ensureCsrfToken,
    requireCustomer,
    requireLogin,
    requireApprovedMerchant,
    requireRole,
    setSecurityHeaders,
    verifyCsrfToken
} = require('./middleware');
const Product = require('./models/Product');
const Notification = require('./models/Notification');
const FavouriteMerchant = require('./models/FavouriteMerchant');
const CustomerCart = require('./models/CustomerCart');
const Promotion = require('./models/Promotion');
const Loyalty = require('./models/Loyalty');
const { getCartItemCount } = require('./utils/cart');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'dev-only-vaniday-session-secret-change-me';

if (isProduction && sessionSecret === 'dev-only-vaniday-session-secret-change-me') {
    throw new Error('SESSION_SECRET must be set in production.');
}

app.set('trust proxy', 1);

function captureRawBody(req, res, buffer) {
    if (buffer?.length) {
        req.rawBody = buffer.toString('utf8');
    }
}

// Set up EJS for your Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(setSecurityHeaders);
app.use(express.static(path.join(__dirname, 'public'), {
    redirect: false,
    maxAge: isProduction ? '7d' : 0
})); // For CSS, Images, JS
app.use(bodyParser.urlencoded({ extended: true, limit: '100kb', verify: captureRawBody }));
app.use(bodyParser.json({ limit: '7mb', verify: captureRawBody }));
app.use(session({
    name: 'vaniday.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 8
    }
}));
app.use((req, res, next) => {
    const isHttpsRequest = req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';

    if (isHttpsRequest) {
        req.session.cookie.secure = true;
        req.session.cookie.sameSite = 'none';
    }

    next();
});
app.use(passport.initialize());
app.use(ensureCsrfToken);

app.use((req, res, next) => {
    const userId = req.session.user?.id;

    if (!userId || req.session.cartLoadedForUserId === userId) {
        req.initialCartJson = JSON.stringify(req.session.cart || []);
        next();
        return;
    }

    CustomerCart.load(userId, (error, storedCart = []) => {
        if (error) {
            console.error('Customer cart could not be loaded:', error);
        } else if (!Array.isArray(req.session.cart) || req.session.cart.length === 0) {
            req.session.cart = storedCart;
        }

        req.session.cartLoadedForUserId = userId;
        req.initialCartJson = JSON.stringify(req.session.cart || []);
        next();
    });
});

app.use((req, res, next) => {
    res.on('finish', () => {
        const userId = req.session?.user?.id;

        if (!userId || JSON.stringify(req.session.cart || []) === req.initialCartJson) return;

        CustomerCart.save(userId, req.session.cart || [], (error) => {
            if (error) console.error('Customer cart could not be saved:', error);
        });
    });

    next();
});

app.use((req, res, next) => {
    if (!req.session.user || req.session.favouritesLoadedForUserId === req.session.user.id) {
        next();
        return;
    }

    FavouriteMerchant.getMerchantIds(req.session.user.id, (error, merchantIds = []) => {
        if (error) {
            console.error('Favourite merchants could not be loaded:', error);
        } else {
            req.session.favouriteMerchantIds = merchantIds;
            req.session.favouritesLoadedForUserId = req.session.user.id;
        }

        next();
    });
});

app.use((req, res, next) => {
    res.locals.cartCount = getCartItemCount(req.session.cart || []);
    res.locals.currentUser = req.session.user || null;
    res.locals.currentPath = req.path;
    res.locals.showQrDebug = process.env.NODE_ENV === 'development';

    if (!req.session.user) {
        res.locals.notificationUnreadCount = 0;
        next();
        return;
    }

    Notification.countUnread(req.session.user.id, (error, count) => {
        if (error) {
            console.error(error);
            res.locals.notificationUnreadCount = 0;
        } else {
            res.locals.notificationUnreadCount = count;
        }

        // Also expose whether there are any active public promotions so templates can
        // conditionally render a Promotions item in the Services dropdown.
        Promotion.getActivePublic((promoError, promoRows = []) => {
            if (promoError) {
                console.error('Promotion check failed:', promoError);
                res.locals.hasPublicPromotions = false;
            } else {
                res.locals.hasPublicPromotions = Array.isArray(promoRows) && promoRows.length > 0;
            }

            next();
        });
    });
});

app.use(verifyCsrfToken);

const authRateLimit = createRateLimiter({
    namespace: 'auth',
    windowMs: 15 * 60 * 1000,
    max: 6,
    message: 'Too many sign-in attempts. Please wait a few minutes and try again.'
});
const aiRateLimit = createRateLimiter({
    namespace: 'ai',
    windowMs: 60 * 1000,
    max: 25,
    message: 'The assistant is receiving too many requests. Please try again shortly.'
});
const writeRateLimit = createRateLimiter({
    namespace: 'writes',
    windowMs: 60 * 1000,
    max: 120
});
app.use((req, res, next) => {
    if (req.method === 'POST') {
        return writeRateLimit(req, res, next);
    }

    return next();
});

function requireMerchantJson(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Please log in as a merchant before using the AI helper.'
        });
    }

    if (req.session.user.role !== 'merchant') {
        return res.status(403).json({
            success: false,
            message: 'Only merchant accounts can use the product AI helper.'
        });
    }

    return next();
}

function handleReviewMediaUpload(req, res, next) {
    uploadReviewMedia(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        console.error(error);
        req.session.profileError = error.message || 'Review media could not be uploaded.';
        res.redirect('/profile#history');
    });
}

function handleHistoryReviewMediaUpload(req, res, next) {
    uploadReviewMedia(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        console.error(error);
        req.session.profileError = error.message || 'Review media could not be uploaded.';
        res.redirect('/profile#history');
    });
}

function handleSupportScreenshotUpload(req, res, next) {
    uploadSupportScreenshot(req, res, (error) => {
        if (!error) {
            const uploaded = req.files
                ? Object.values(req.files).flat()
                : [];
            req.file = uploaded[0] || req.file;
            next();
            return;
        }

        console.error(error);
        req.session.helpCenterFlash = {
            type: 'error',
            message: error.message || 'Support screenshot could not be uploaded.'
        };
        res.redirect('/help-center');
    });
}

function handleProductImageUpload(req, res, next) {
    uploadProductImage(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        req.session.merchantError = error.message || 'Product photo could not be uploaded.';
        const editMatch = req.originalUrl.match(/^\/merchant\/products\/(\d+)/);
        res.redirect(editMatch ? `/merchant/products/${editMatch[1]}/edit` : '/merchant/products/new');
    });
}

function handleProfileImageUpload(req, res, next) {
    uploadProfileImage(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        req.session.profileError = error.message || 'Profile photo could not be uploaded.';
        res.redirect('/profile');
    });
}

function redirectMerchantProductDetail(req, res) {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId < 1) {
        req.session.merchantError = 'Product could not be found.';
        return res.redirect('/merchant/products');
    }

    return res.redirect(`/merchant/products/${productId}/edit`);
}

function getWhatsAppWidgetUrl() {
    const rawPhone = process.env.WHATSAPP_BOOKING_PHONE || process.env.TWILIO_WHATSAPP_FROM || '';
    const phone = String(rawPhone).replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');

    if (!phone) {
        return '';
    }

    const message = encodeURIComponent('BOOK');
    return `https://wa.me/${phone}?text=${message}`;
}

app.use((req, res, next) => {
    res.locals.whatsappWidgetUrl = getWhatsAppWidgetUrl();
    next();
});

app.get('/', allowGuestOrCustomer, merchantController.showHome);
app.get('/portal', allowGuestOrCustomer, (req, res) => {
    const query = new URLSearchParams(req.query).toString();
    res.redirect(`/services${query ? `?${query}` : ''}`);
});
app.get('/services', allowGuestOrCustomer, merchantController.showServices);
app.get('/routine-finder/book/:merchantId', requireCustomer, routineFinderController.continueBooking);
app.get('/routine-finder', allowGuestOrCustomer, routineFinderController.showFinder);
app.post('/routine-finder', allowGuestOrCustomer, routineFinderController.showResults);
app.post('/routine-finder/save', requireCustomer, routineFinderController.saveRoutine);
app.get('/beauty-routine-finder', allowGuestOrCustomer, (req, res) => {
    res.redirect('/routine-finder');
});
app.get('/promotions', allowGuestOrCustomer, merchantController.showPromotions);
app.get('/promotions/first-trial', allowGuestOrCustomer, merchantController.showFirstTrial);
app.get('/promotions/happy-hour', allowGuestOrCustomer, merchantController.showHappyHour);
app.get('/promotions/1-for-1', allowGuestOrCustomer, merchantController.showOneForOne);
app.get('/promotions/one-for-one', allowGuestOrCustomer, (req, res) => {
    res.redirect('/promotions/1-for-1');
});
app.get('/promotions/featured-salons', allowGuestOrCustomer, merchantController.showFeaturedSalons);
app.get('/merchants', allowGuestOrCustomer, merchantController.listMerchants);
app.get('/profile', userController.showProfile);
app.get('/notifications', requireLogin, notificationController.showNotifications);
app.get('/notifications/:notificationId/open', requireLogin, notificationController.openNotification);
app.post('/notifications/:notificationId/read', requireLogin, notificationController.markNotificationRead);
app.post('/notifications/:notificationId/delete', requireLogin, notificationController.deleteNotification);
app.post('/notifications/read-all', requireLogin, notificationController.markAllRead);
app.post('/notifications/clear-read', requireLogin, notificationController.clearReadNotifications);
app.get('/help-center', requireLogin, helpCenterController.showHelpCenter);
app.post('/help-center/requests', requireCustomer, handleSupportScreenshotUpload, helpCenterController.createRequest);
app.post('/help-center/requests/:requestId/replies', requireLogin, handleSupportScreenshotUpload, helpCenterController.replyToRequest);
app.post('/help-center/requests/:requestId/merchant-refund-preview', requireApprovedMerchant, helpCenterController.merchantRefundPreview);
app.post('/help-center/requests/:requestId/merchant-response', requireApprovedMerchant, helpCenterController.merchantRespond);
app.post('/help-center/orders/:transactionId/delivery-status', requireRole('merchant', 'admin'), helpCenterController.updateOrderDeliveryStatus);
app.get('/profile/history', requireCustomer, profileController.showHistory);
app.get('/reward-shop', requireCustomer, userController.showRewardShop);
app.post('/reward-shop/claim', requireCustomer, userController.claimRewardShopDaily);
app.post('/reward-shop/vouchers/:voucherId/redeem', requireCustomer, userController.redeemRewardShopVoucher);
app.get('/membership', requireCustomer, (req, res) => {
    res.redirect('/profile#membership');
});
app.post('/profile', handleProfileImageUpload, userController.updateProfile);
app.post('/profile/password', userController.updatePassword);
app.post('/profile/bookings/:bookingId/cancel', requireCustomer, bookingController.cancelBooking);
app.get('/profile/bookings/:bookingId/reschedule-suggestions', requireCustomer, bookingController.getRescheduleSuggestions);
app.post('/profile/bookings/:bookingId/reschedule', requireCustomer, bookingController.rescheduleBooking);
app.post('/profile/bookings/:bookingId/review', requireCustomer, handleReviewMediaUpload, bookingController.submitReview);
app.post('/profile/orders/:receiptId/products/:productId/review', requireCustomer, handleHistoryReviewMediaUpload, profileController.submitProductReview);
app.get('/spin-discover', allowGuestOrCustomer, spinDiscoverController.showSpinDiscover);
app.post('/spin-discover/spin', requireCustomer, spinDiscoverController.spin);
app.get('/rewards-game', allowGuestOrCustomer, (req, res) => res.redirect('/spin-discover'));
app.post('/rewards-game/play', requireCustomer, (req, res) => res.redirect('/spin-discover'));
app.get('/rewards-game/flappy', allowGuestOrCustomer, (req, res) => res.redirect('/spin-discover'));
app.post('/rewards-game/flappy/finish', requireCustomer, (req, res) => res.status(410).json({
    ok: false,
    message: 'Flappy Rewards has been replaced by Spin & Discover.',
    redirectPath: '/spin-discover'
}));
app.get('/login', userController.showLogin);
app.post('/login', authRateLimit, userController.loginUser);
app.get('/login/verify-otp', userController.showLoginOtp);
app.post('/login/verify-otp', authRateLimit, userController.verifyLoginOtp);
app.post('/login/otp-method', authRateLimit, userController.changeLoginOtpMethod);
app.get('/auth/google', userController.startGoogleLogin);
app.get('/auth/google/callback', userController.handleGoogleCallback);
app.get('/webhooks/whatsapp', whatsappController.getWebhook);
app.post('/webhooks/whatsapp', whatsappController.postWebhook);
app.post('/webhooks/hitpay', merchantController.handleHitPayWebhook);
app.get('/signup', userController.showSignup);
app.get('/merchant/signup', userController.showMerchantSignup);
app.get('/ref/:referralCode', userController.openReferralSignup);
app.post('/signup', authRateLimit, userController.signupUser);
app.post('/merchant/signup', authRateLimit, userController.signupMerchant);
app.post('/logout', userController.logoutUser);
app.get('/cart', requireCustomer, merchantController.showCart);
app.post('/cart/add/:merchantId', requireCustomer, merchantController.addToCart);
app.get('/cart/product/:productId', allowGuestOrCustomer, (req, res) => {
    res.redirect('/products');
});
app.post('/cart/product/:productId', requireCustomer, merchantController.addProductToCart);
app.post('/cart/update/:itemId', requireCustomer, merchantController.updateCartItem);
app.post('/cart/remove/:itemId', requireCustomer, merchantController.removeFromCart);
app.post('/cart/delete-selected', requireCustomer, merchantController.deleteSelectedCartItems);
app.post('/merchants/:merchantId/favourite', requireCustomer, merchantController.toggleFavouriteMerchant);
app.get('/merchants/:merchantId/qr', requireApprovedMerchant, merchantController.showMerchantQr);
app.get('/m/:merchantSlug', allowGuestOrCustomer, merchantController.showMerchantStorefront);
app.post('/m/:merchantSlug', requireCustomer, merchantController.saveStorefrontBooking);
app.get('/scan/:merchantId', requireCustomer, merchantController.showSecureScanBooking);
app.post('/scan/:merchantId', requireCustomer, merchantController.saveSecureScanBooking);
app.get('/book/:serviceId', requireCustomer, bookingController.showBookFallback);
app.post('/book/:serviceId', requireCustomer, bookingController.createBooking);
app.get('/checking/:signedToken', bookingController.showCheckIn);
app.post('/checking/:signedToken', bookingController.confirmCheckIn);
app.get('/checkin/:signedToken', bookingController.showCheckIn);
app.post('/checkin/:signedToken', bookingController.confirmCheckIn);
app.get('/booking/confirm/:bookingId', bookingController.confirmBooking);
app.get('/booking/:merchantId/available-slots', allowGuestOrCustomer, merchantController.getBookingAvailability);
app.get('/booking/:merchantId/:qrToken', requireCustomer, merchantController.showBookingPage);
app.post('/booking/:merchantId/:qrToken', requireCustomer, merchantController.saveQrBooking);
app.get('/booking/:merchantId', requireCustomer, merchantController.showBookingPage);
app.post('/booking/:merchantId', requireCustomer, merchantController.saveQrBooking);
app.get('/merchants/:id', allowGuestOrCustomer, merchantController.showMerchant);
app.post('/merchants/:id/book', requireCustomer, merchantController.createBooking);
app.get('/api/ai/booking-options', aiRateLimit, allowGuestOrCustomer, aiController.getGuidedBookingOptions);
app.get('/api/ai/booking-slots', aiRateLimit, allowGuestOrCustomer, aiController.getGuidedBookingSlots);
app.get('/api/ai/customer-bookings', aiRateLimit, requireCustomer, aiController.getGuidedCustomerBookings);
app.post('/api/ai/chat', aiRateLimit, allowGuestOrCustomer, aiController.getBeautyAdvice);
app.use('/api/ai', aiRateLimit, aiRoutes);
app.use('/api/ai', (err, req, res, next) => {
    console.error('AI API route error:', {
        path: req.path,
        code: err?.code,
        status: err?.status || err?.statusCode,
        message: err?.message,
        sqlMessage: err?.sqlMessage,
        sqlState: err?.sqlState
    });

    if (res.headersSent) {
        return next(err);
    }

    if (req.path.includes('/ask-analytics')) {
        return res.status(200).json({
            success: false,
            error: err?.code || 'AI_ANALYTICS_QUESTION_FAILED',
            message: 'AI could not complete this analytics question right now, so a limited fallback answer was shown.',
            fallback: {
                fallback: true,
                answer: 'I could not load the live AI analytics answer for this request. Your dashboard data is still available, so refresh the page and try again.',
                supportingEvidence: ['The assistant recovered from an internal analytics error.'],
                suggestedNextSteps: ['Refresh the dashboard.', 'Try a shorter question.', 'Use the visible analytics cards while AI recovers.'],
                limitations: ['This fallback does not include live chart-level reasoning.']
            }
        });
    }

    if (req.path.includes('/business-insights') || req.path.includes('/platform-insights')) {
        return res.status(200).json({
            success: false,
            error: err?.code || 'AI_INSIGHTS_FAILED',
            message: 'AI insights could not be fully generated right now, so a limited fallback summary was shown.',
            fallback: {
                fallback: true,
                summary: 'AI insights are temporarily unavailable. Your dashboard metrics are still visible and unchanged.',
                executiveSummary: 'AI insights are temporarily unavailable. Your dashboard metrics are still visible and unchanged.',
                topOpportunities: ['Refresh the dashboard and generate insights again.'],
                risks: ['Live AI analysis could not be completed for this request.'],
                recommendedActions: ['Use the dashboard cards and charts while AI recovers.'],
                confidence: 'Low'
            },
            summary: {
                period: { key: 'last30', label: 'Last 30 days' },
                currency: 'SGD',
                metrics: {}
            }
        });
    }

    return res.status(err?.status || err?.statusCode || 500).json({
        success: false,
        error: err?.code || 'AI_REQUEST_FAILED',
        message: err?.message || 'AI request could not be completed.'
    });
});
app.post('/api/ai/product-copy', aiRateLimit, requireMerchantJson, aiController.generateProductCopy);
app.post('/api/ai/service-setup', aiRateLimit, requireApprovedMerchant, aiController.generateServiceSetup);
app.get('/merchant', requireRole('merchant'), (req, res) => res.redirect('/merchant/dashboard'));
app.get('/merchant/onboarding', requireRole('merchant'), merchantDashboardController.showOnboarding);
app.post('/merchant/onboarding', requireRole('merchant'), merchantDashboardController.updateOnboarding);
app.get('/merchant/dashboard', requireApprovedMerchant, merchantDashboardController.showDashboard);
app.get('/merchant/ai-executive-summary', requireApprovedMerchant, merchantDashboardController.showAiExecutiveSummary);
app.get('/merchant/bookings', requireApprovedMerchant, merchantDashboardController.showBookings);
app.get('/merchant/orders', requireApprovedMerchant, merchantDashboardController.showOrders);
app.post('/merchant/orders/:transactionId/status', requireApprovedMerchant, merchantDashboardController.updateOrderStatus);
app.get('/merchant/customers', requireApprovedMerchant, merchantDashboardController.showCustomers);
app.get('/merchant/analytics', requireApprovedMerchant, merchantDashboardController.showAnalytics);
app.post('/merchant/analytics/export', requireApprovedMerchant, merchantDashboardController.exportAnalytics);
app.get('/merchant/support', requireRole('merchant'), merchantDashboardController.showSupport);
app.get('/merchant/profile', requireRole('merchant'), merchantDashboardController.showProfile);
app.post('/merchant/profile', requireRole('merchant'), merchantDashboardController.updateProfile);
app.get('/merchant/loyalty', requireApprovedMerchant, merchantDashboardController.showLoyaltySettings);
app.post('/merchant/loyalty', requireApprovedMerchant, merchantDashboardController.updateLoyaltySettings);
app.get('/merchant/cashback', requireApprovedMerchant, merchantDashboardController.listCashbackCampaigns);
app.get('/merchant/cashback/new', requireApprovedMerchant, merchantDashboardController.showNewCashbackCampaign);
app.post('/merchant/cashback', requireApprovedMerchant, merchantDashboardController.createCashbackCampaign);
app.get('/merchant/cashback/:campaignId/edit', requireApprovedMerchant, merchantDashboardController.showEditCashbackCampaign);
app.post('/merchant/cashback/:campaignId', requireApprovedMerchant, merchantDashboardController.updateCashbackCampaign);
app.post('/merchant/cashback/:campaignId/delete', requireApprovedMerchant, merchantDashboardController.deleteCashbackCampaign);
app.get('/merchant/schedule', requireApprovedMerchant, merchantDashboardController.showSchedule);
app.get('/merchant/check-in/:token', requireApprovedMerchant, merchantController.showBookingCheckIn);
app.post('/merchant/check-in/:token', requireApprovedMerchant, merchantController.confirmBookingCheckIn);
app.get('/merchant/services', requireApprovedMerchant, merchantDashboardController.showServices);
app.post('/merchant/generate-qr', requireApprovedMerchant, merchantDashboardController.generateQr);
app.post('/merchant/bookings/:bookingId/status', requireApprovedMerchant, merchantDashboardController.updateBookingStatus);
app.get('/merchant/bookings/:bookingId/status', requireApprovedMerchant, (req, res) => res.redirect('/merchant/bookings'));
app.get('/merchant/reschedule-settings', requireApprovedMerchant, (req, res) => res.redirect('/merchant/bookings'));
app.post('/merchant/reschedule-settings', requireApprovedMerchant, merchantDashboardController.updateRescheduleSettings);
app.post('/merchant/reschedule-requests/:requestId/review', requireApprovedMerchant, merchantDashboardController.reviewRescheduleRequest);
app.post('/merchant/reviews/:reviewId/reply', requireApprovedMerchant, merchantDashboardController.saveReviewReply);
app.get('/merchant/services/new', requireApprovedMerchant, merchantDashboardController.showNewService);
app.post('/merchant/services', requireApprovedMerchant, merchantDashboardController.createService);
app.get('/merchant/services/:serviceId/edit', requireApprovedMerchant, merchantDashboardController.showEditService);
app.post('/merchant/services/:serviceId', requireApprovedMerchant, merchantDashboardController.updateService);
app.post('/merchant/services/:serviceId/delete', requireApprovedMerchant, merchantDashboardController.deleteService);
app.post('/merchant/services/:serviceId/feature', requireApprovedMerchant, merchantDashboardController.featureService);
app.post('/merchant/services/:serviceId/unfeature', requireApprovedMerchant, merchantDashboardController.unfeatureService);
app.get('/merchant/products', requireApprovedMerchant, merchantDashboardController.listProducts);
app.get('/merchant/products/new', requireApprovedMerchant, merchantDashboardController.showNewProduct);
app.post('/merchant/products', requireApprovedMerchant, handleProductImageUpload, merchantDashboardController.createProduct);
app.get('/merchant/products/:productId/edit', requireApprovedMerchant, merchantDashboardController.showEditProduct);
app.get('/merchant/products/:productId', requireApprovedMerchant, redirectMerchantProductDetail);
app.post('/merchant/products/:productId', requireApprovedMerchant, handleProductImageUpload, merchantDashboardController.updateProduct);
app.post('/merchant/products/:productId/restock', requireApprovedMerchant, merchantDashboardController.restockProduct);
app.post('/merchant/products/:productId/delete', requireApprovedMerchant, merchantDashboardController.deleteProduct);
app.post('/merchant/products/:productId/feature', requireApprovedMerchant, merchantDashboardController.featureProduct);
app.post('/merchant/products/:productId/unfeature', requireApprovedMerchant, merchantDashboardController.unfeatureProduct);
app.get('/merchant/promotions', requireApprovedMerchant, merchantDashboardController.listPromotions);
app.get('/merchant/promotions/new', requireApprovedMerchant, merchantDashboardController.showNewPromotion);
app.post('/merchant/promotions', requireApprovedMerchant, merchantDashboardController.createPromotion);
app.get('/merchant/promotions/:promotionId/edit', requireApprovedMerchant, merchantDashboardController.showEditPromotion);
app.post('/merchant/promotions/:promotionId', requireApprovedMerchant, merchantDashboardController.updatePromotion);
app.post('/merchant/promotions/:promotionId/delete', requireApprovedMerchant, merchantDashboardController.deletePromotion);
app.get('/merchant/vouchers', requireApprovedMerchant, merchantDashboardController.listVouchers);
app.get('/merchant/vouchers/new', requireApprovedMerchant, merchantDashboardController.showNewVoucher);
app.post('/merchant/vouchers', requireApprovedMerchant, merchantDashboardController.createVoucher);
app.get('/merchant/vouchers/:voucherId/edit', requireApprovedMerchant, merchantDashboardController.showEditVoucher);
app.post('/merchant/vouchers/:voucherId', requireApprovedMerchant, merchantDashboardController.updateVoucher);
app.post('/merchant/vouchers/:voucherId/delete', requireApprovedMerchant, merchantDashboardController.deleteVoucher);
app.get('/merchant/spin-discover', requireApprovedMerchant, merchantDashboardController.showSpinDiscover);
app.post('/merchant/spin-discover/:sourceType/:rewardId', requireApprovedMerchant, merchantDashboardController.updateSpinReward);
app.get('/merchant/rewards-game', requireApprovedMerchant, (req, res) => res.redirect('/merchant/spin-discover'));
app.get('/merchant/rewards-game/prizes/new', requireApprovedMerchant, (req, res) => res.redirect('/merchant/spin-discover'));
app.post('/merchant/rewards-game/prizes', requireApprovedMerchant, (req, res) => res.redirect('/merchant/spin-discover'));
app.get('/merchant/rewards-game/prizes/:prizeId/edit', requireApprovedMerchant, (req, res) => res.redirect('/merchant/spin-discover'));
app.post('/merchant/rewards-game/prizes/:prizeId', requireApprovedMerchant, (req, res) => res.redirect('/merchant/spin-discover'));
app.post('/merchant/rewards-game/prizes/:prizeId/delete', requireApprovedMerchant, (req, res) => res.redirect('/merchant/spin-discover'));
app.get('/merchant/:merchantId', requireCustomer, merchantController.showPublicMerchantBooking);
app.get('/admin', requireRole('admin'), (req, res) => res.redirect('/admin/overview'));
app.get('/admin/overview', requireRole('admin'), adminController.showOverview);
app.get('/admin/ai-executive-summary', requireRole('admin'), adminController.showAiExecutiveSummary);
app.get('/admin/bookings', requireRole('admin'), adminController.showBookings);
app.get('/admin/merchants', requireRole('admin'), adminController.showMerchants);
app.get('/admin/users', requireRole('admin'), adminController.showUsers);
app.get('/admin/reviews', requireRole('admin'), adminController.showReviews);
app.get('/admin/analytics', requireRole('admin'), adminController.showAnalytics);
app.get('/admin/audit-trail', requireRole('admin'), adminController.showAuditTrail);
app.get('/admin/platform-health', requireRole('admin'), adminController.showPlatformHealth);
app.get('/admin/dashboard', requireRole('admin'), (req, res) => res.redirect('/admin/overview'));
app.get('/admin/customers', requireRole('admin'), (req, res) => res.redirect('/admin/overview'));
app.get('/admin/suspended-accounts', requireRole('admin'), (req, res) => res.redirect('/admin/platform-health'));
app.get('/admin/bookings/active', requireRole('admin'), (req, res) => res.redirect('/admin/bookings'));
app.get('/admin/bookings/pending', requireRole('admin'), (req, res) => res.redirect('/admin/bookings'));
app.get('/admin/refund-disputes', requireRole('admin'), (req, res) => res.redirect('/admin/platform-health'));
app.get('/admin/escalated-issues', requireRole('admin'), (req, res) => res.redirect('/admin/platform-health'));
app.get('/admin/categories', requireRole('admin'), (req, res) => res.redirect('/admin/services'));
app.get('/admin/qr-analytics', requireRole('admin'), (req, res) => res.redirect('/admin/analytics'));
app.get('/admin/merchant-reports', requireRole('admin'), (req, res) => res.redirect('/admin/reviews'));
app.get('/admin/abuse-monitoring', requireRole('admin'), (req, res) => res.redirect('/admin/platform-health'));
app.get('/admin/ai-automation-logs', requireRole('admin'), (req, res) => res.redirect('/admin/audit-trail'));
app.get('/admin/settings', requireRole('admin'), (req, res) => res.redirect('/admin/loyalty'));
app.get('/admin/profile', requireRole('admin'), (req, res) => res.redirect('/admin/overview'));
app.get('/admin/help-center', requireRole('admin'), (req, res) => res.redirect('/help-center'));
app.get('/admin/add-service', requireRole('admin'), (req, res) => res.redirect('/admin/services/new'));
app.get('/admin/add-merchant', requireRole('admin'), (req, res) => res.redirect('/admin/merchants/new'));
app.get('/admin/manage-services', requireRole('admin'), (req, res) => res.redirect('/admin/services'));
app.get('/admin/manage-products', requireRole('admin'), (req, res) => res.redirect('/admin/products'));
app.get('/admin/manage-promotions', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.get('/admin/game-control', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.get('/admin/merchants/new', requireRole('admin'), adminController.showNewMerchant);
app.post('/admin/merchants', requireRole('admin'), adminController.createMerchant);
app.post('/admin/merchants/:salonId/approval', requireRole('admin'), adminController.updateMerchantApproval);
app.post('/admin/merchants/:salonId/commission', requireRole('admin'), adminController.updateMerchantCommission);
app.post('/admin/merchants/:salonId/feature', requireRole('admin'), adminController.featureMerchant);
app.post('/admin/users/:userId/terminate', requireRole('admin'), adminController.terminateUser);
app.post('/admin/users/:userId/delete', requireRole('admin'), adminController.deleteUser);
app.post('/admin/merchants/:salonId/unfeature', requireRole('admin'), adminController.unfeatureMerchant);
app.get('/admin/services', requireRole('admin'), adminController.listServices);
app.get('/admin/products', requireRole('admin'), adminController.listProducts);
app.get('/admin/products/new', requireRole('admin'), adminController.showNewProduct);
app.post('/admin/products', requireRole('admin'), adminController.createProduct);
app.get('/admin/products/:productId/edit', requireRole('admin'), adminController.showEditProduct);
app.post('/admin/products/:productId', requireRole('admin'), adminController.updateProduct);
app.post('/admin/products/:productId/delete', requireRole('admin'), adminController.deleteProduct);
app.get('/admin/promotions', requireRole('admin'), adminController.listPromotions);
app.get('/admin/promotions/new', requireRole('admin'), adminController.showNewPromotion);
app.get('/admin/services/new', requireRole('admin'), adminController.showNewService);
app.post('/admin/promotions', requireRole('admin'), adminController.createPromotion);
app.post('/admin/services', requireRole('admin'), adminController.createService);
app.get('/admin/services/:serviceId/edit', requireRole('admin'), adminController.showEditService);
app.post('/admin/services/:serviceId', requireRole('admin'), adminController.updateService);
app.post('/admin/services/:serviceId/delete', requireRole('admin'), adminController.deleteService);
app.get('/admin/promotions/:promotionId/edit', requireRole('admin'), adminController.showEditPromotion);
app.post('/admin/promotions/:promotionId', requireRole('admin'), adminController.updatePromotion);
app.post('/admin/promotions/:promotionId/delete', requireRole('admin'), adminController.deletePromotion);
app.get('/admin/cashback', requireRole('admin'), adminController.listCashbackCampaigns);
app.get('/admin/cashback/new', requireRole('admin'), adminController.showNewCashbackCampaign);
app.post('/admin/cashback', requireRole('admin'), adminController.createCashbackCampaign);
app.get('/admin/cashback/:campaignId/edit', requireRole('admin'), adminController.showEditCashbackCampaign);
app.post('/admin/cashback/:campaignId', requireRole('admin'), adminController.updateCashbackCampaign);
app.post('/admin/cashback/:campaignId/delete', requireRole('admin'), adminController.deleteCashbackCampaign);
app.get('/admin/reward-shop', requireRole('admin'), adminController.listRewardVouchers);
app.get('/admin/reward-shop/new', requireRole('admin'), adminController.showNewRewardVoucher);
app.post('/admin/reward-shop', requireRole('admin'), adminController.createRewardVoucher);
app.post('/admin/reward-shop/daily-rewards', requireRole('admin'), adminController.updateDailyRewards);
app.get('/admin/reward-shop/:voucherId/edit', requireRole('admin'), adminController.showEditRewardVoucher);
app.post('/admin/reward-shop/:voucherId', requireRole('admin'), adminController.updateRewardVoucher);
app.post('/admin/reward-shop/:voucherId/delete', requireRole('admin'), adminController.deleteRewardVoucher);
app.get('/admin/rewards-game', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.get('/admin/loyalty', requireRole('admin'), loyaltyController.showAdminRules);
app.post('/admin/loyalty', requireRole('admin'), loyaltyController.updateAdminRules);
app.post('/admin/rewards-game/settings', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.get('/admin/rewards-game/prizes/new', requireRole('admin'), (req, res) => res.redirect('/admin/promotions/new'));
app.post('/admin/rewards-game/prizes', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.get('/admin/rewards-game/prizes/:prizeId/edit', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.post('/admin/rewards-game/prizes/:prizeId', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));
app.post('/admin/rewards-game/prizes/:prizeId/delete', requireRole('admin'), (req, res) => res.redirect('/admin/promotions'));

app.get('/about', allowGuestOrCustomer, (req, res) => {
    res.render('about', { title: 'About Us' });
});

app.get('/contact', allowGuestOrCustomer, (req, res) => {
    res.render('contact', { title: 'Contact Us' });
});

app.get('/terms', allowGuestOrCustomer, (req, res) => {
    res.render('legal', {
        title: 'Terms of Service',
        heading: 'Terms of Service',
        summary: 'These terms explain the rules for using Vaniday accounts, bookings, rewards, payments, merchant services, and support tools.',
        updatedAt: '24 July 2026',
        intro: [
            'Please read these Terms of Service carefully before using Vaniday. By creating an account, making a booking, buying products, using rewards, applying as a merchant, or continuing to use the platform, you agree to these terms.',
            'Vaniday is a beauty and wellness booking and commerce platform. Some services and products are supplied by independent merchants, salons, spas, wellness providers, payment processors, messaging providers, and other third parties. These terms do not remove any non-excludable rights you may have under applicable law.'
        ],
        sections: [
            {
                title: '1. Who We Are',
                paragraphs: [
                    'Vaniday provides account, discovery, booking, payment, rewards, QR check-in, merchant-management, customer-support, and notification features for beauty and wellness services and related products.',
                    'Unless a service is expressly described as provided directly by Vaniday, merchants remain responsible for their own service descriptions, professional standards, licences, premises, staff, availability, pricing, fulfilment, hygiene practices, and customer interactions.'
                ]
            },
            {
                title: '2. Eligibility and Accounts',
                items: [
                    'You must provide accurate, current, and complete account, contact, booking, and payment information.',
                    'You are responsible for keeping your password, one-time passwords, device access, and account session secure.',
                    'You must update your profile if your email, phone number, preferred contact method, birthday, postal code, or other relevant details change.',
                    'You must not create accounts using another person\'s details, impersonate someone else, bypass security controls, or use automated scripts to misuse the platform.',
                    'Vaniday may suspend, restrict, or terminate accounts where we reasonably believe there is fraud, abuse, security risk, repeated no-shows, chargeback misuse, unlawful conduct, or breach of these terms.'
                ]
            },
            {
                title: '3. Bookings, Rescheduling, and Cancellations',
                items: [
                    'Customers are responsible for choosing the correct merchant, service, date, time, add-ons, contact details, and special requests before submitting a booking.',
                    'A booking may be pending, confirmed, rescheduled, completed, cancelled, rejected, or otherwise updated depending on merchant availability and platform rules.',
                    'Merchants may review, accept, reject, reschedule, or cancel bookings where a service is unavailable, the customer cannot be reached, payment fails, required details are missing, or the customer breaches merchant rules.',
                    'You should arrive on time and follow reasonable merchant instructions, safety requirements, age restrictions, patch-test requirements, medical disclosure requests, and house rules.',
                    'Cancellation, late-arrival, no-show, refund, and rescheduling outcomes may depend on the merchant policy, timing of the request, payment status, platform refund eligibility rules, and any applicable law.',
                    'QR check-in, receipts, emails, SMS, WhatsApp messages, and notification records may be used to help verify attendance, completion, cancellation timing, and support requests.'
                ]
            },
            {
                title: '4. Products, Prices, Payments, and Refunds',
                items: [
                    'Prices, availability, promotions, taxes, fees, delivery or pickup options, and product information may change before checkout or merchant confirmation.',
                    'Payments may be processed by third-party payment providers. Vaniday does not store full card numbers where payment providers handle card processing.',
                    'A successful payment confirmation does not guarantee a service or product if there is a listing error, stock issue, fraud concern, payment reversal, merchant rejection, or other operational problem.',
                    'Refunds may be full, partial, declined, delayed, or adjusted for administrative fees, payment-provider charges, delivered items, used services, voucher use, cashback, loyalty points, or merchant findings where allowed by policy and law.',
                    'Chargebacks, duplicate refund requests, false claims, or abuse of support workflows may lead to account restrictions and recovery of amounts owed.'
                ]
            },
            {
                title: '5. Rewards, Vouchers, Promotions, and Wallet Features',
                items: [
                    'Points, cashback, spin rewards, referral benefits, gift cards, vouchers, and promotional offers are subject to eligibility checks, availability, expiry dates, campaign rules, and anti-abuse controls.',
                    'Rewards have no cash value unless expressly stated. They may not be sold, transferred, exchanged, duplicated, or used with other offers unless the offer says so.',
                    'Vaniday may correct, reverse, expire, withhold, or cancel rewards that were issued by mistake, obtained through abuse, linked to cancelled or refunded transactions, or inconsistent with campaign rules.',
                    'Wallet balances, reward histories, and redemption records are maintained for account, audit, support, fraud-prevention, and refund-calculation purposes.'
                ]
            },
            {
                title: '6. Health, Beauty, and Service Results',
                paragraphs: [
                    'Beauty, grooming, spa, wellness, skincare, haircare, nail, massage, and related services can produce different results for different people. Service descriptions, recommendations, AI suggestions, routine guidance, reviews, and promotional content are informational only and are not medical advice.',
                    'Tell the merchant about allergies, sensitivities, injuries, pregnancy, medical conditions, recent procedures, medications, and other relevant matters before receiving a service or using a product. Seek professional medical advice where needed.'
                ]
            },
            {
                title: '7. Customer Content and Reviews',
                items: [
                    'You are responsible for reviews, support messages, uploaded images, profile content, merchant communications, and other content you submit.',
                    'Do not submit content that is false, defamatory, discriminatory, threatening, obscene, infringing, misleading, promotional spam, or that exposes another person\'s private information.',
                    'Vaniday may moderate, hide, edit formatting, refuse, or remove content where reasonably necessary for safety, legal compliance, platform integrity, or policy enforcement.',
                    'By submitting content, you allow Vaniday to host, display, process, and use it to operate, improve, investigate, support, and promote the platform, subject to the Privacy Policy.'
                ]
            },
            {
                title: '8. Merchant Responsibilities',
                items: [
                    'Merchants must keep business details, licences, service descriptions, prices, schedules, product stock, refund policies, contact details, and fulfilment information accurate.',
                    'Merchants are responsible for service quality, safety, staff conduct, hygiene, professional qualifications, product authenticity, customer disputes, and compliance with applicable laws.',
                    'Merchants must not manipulate reviews, create fake bookings, mislead customers, misuse customer data, avoid platform fees, or offer unlawful, unsafe, or infringing services or products.',
                    'Vaniday may remove listings, pause merchant access, withhold features, or escalate issues where merchant conduct creates customer risk, legal risk, fraud risk, or repeated complaints.'
                ]
            },
            {
                title: '9. Communications and Notifications',
                paragraphs: [
                    'Vaniday and merchants may contact you about accounts, bookings, payments, receipts, check-in, support, refunds, rewards, merchant operations, security alerts, and service updates through email, SMS, WhatsApp, in-app notifications, or phone where relevant.',
                    'You are responsible for charges, settings, blocking, filtering, or delivery failures from your email provider, mobile carrier, messaging app, or device.'
                ]
            },
            {
                title: '10. Prohibited Use',
                items: [
                    'Do not break the law, violate another person\'s rights, interfere with platform security, scrape data, overload services, reverse engineer restricted features, upload malware, or attempt unauthorised access.',
                    'Do not use Vaniday to harass staff, customers, merchants, support teams, or other users.',
                    'Do not submit fake evidence, false refund claims, fraudulent payment information, misleading merchant listings, or content intended to deceive customers or the platform.'
                ]
            },
            {
                title: '11. Third-Party Services',
                paragraphs: [
                    'Vaniday may rely on third-party services for maps, payments, email, SMS, WhatsApp, analytics, AI features, cloud hosting, file storage, QR codes, fraud controls, and merchant tools. Third-party terms, privacy notices, outages, and processing rules may apply.',
                    'Vaniday is not responsible for third-party services except to the extent required by law or expressly stated in a written agreement.'
                ]
            },
            {
                title: '12. Intellectual Property',
                paragraphs: [
                    'Vaniday owns or licenses the platform design, software, branding, text, workflows, databases, graphics, and other platform materials. You may use the platform only for its intended booking, shopping, merchant, support, and account purposes.',
                    'You must not copy, sell, sublicense, frame, reproduce, or commercially exploit Vaniday materials without permission.'
                ]
            },
            {
                title: '13. Disclaimers and Liability Limits',
                paragraphs: [
                    'The platform is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, Vaniday does not guarantee uninterrupted access, error-free operation, exact search ranking, merchant availability, message delivery, third-party processing times, or that all listing information is always complete or current.',
                    'To the fullest extent permitted by law, Vaniday is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, loss of profits, loss of goodwill, lost data, service dissatisfaction, or third-party conduct.',
                    'Where liability cannot be excluded, Vaniday\'s liability will be limited to the maximum extent allowed by law. Nothing in these terms excludes liability that cannot legally be excluded, including rights under applicable consumer-protection laws.'
                ]
            },
            {
                title: '14. Indemnity',
                paragraphs: [
                    'You agree to indemnify and hold Vaniday, its officers, employees, contractors, and partners harmless from claims, losses, liabilities, damages, costs, and expenses arising from your breach of these terms, misuse of the platform, unlawful conduct, inaccurate information, content submissions, merchant obligations, or infringement of another person\'s rights.'
                ]
            },
            {
                title: '15. Disputes, Governing Law, and Notices',
                paragraphs: [
                    'These terms are governed by the laws of Singapore, unless mandatory law requires otherwise. Before starting a formal claim, you agree to contact Vaniday and give us a reasonable opportunity to investigate and resolve the issue.',
                    'Customer disputes may involve Vaniday, the merchant, a payment provider, or another third party depending on the issue. We may ask for booking records, receipts, QR check-in records, photos, delivery evidence, payment records, merchant notes, and other relevant information.',
                    'Legal notices and account-related notices may be sent to the email address in your account, shown in-app, or sent through other contact channels you provided.'
                ]
            },
            {
                title: '16. Changes to These Terms',
                paragraphs: [
                    'Vaniday may update these terms when features, laws, business practices, payment methods, merchant rules, rewards, or support processes change. The updated version will apply from the stated effective date. If a change materially affects your rights, we will take reasonable steps to notify you.'
                ]
            },
            {
                title: '17. Contact',
                paragraphs: [
                    'Questions about these terms can be sent to support@vaniday.example or raised through the Vaniday support channels. Replace this placeholder address with the real business contact before production use.'
                ]
            }
        ]
    });
});

app.get('/privacy', allowGuestOrCustomer, (req, res) => {
    res.render('legal', {
        title: 'Privacy Policy',
        heading: 'Privacy Policy',
        summary: 'This policy explains what personal data Vaniday collects, why we use it, who we share it with, and how users can exercise privacy rights.',
        updatedAt: '24 July 2026',
        intro: [
            'This Privacy Policy applies to Vaniday customers, guests, merchants, administrators, support contacts, and other users of the website, booking flows, merchant tools, wallet, rewards, QR check-in, notifications, and support features.',
            'Vaniday is designed for Singapore beauty and wellness bookings. This policy is written with Singapore PDPA-style privacy obligations in mind, including notification, consent, purpose limitation, protection, retention, access, correction, withdrawal of consent, and breach handling. It should be reviewed by qualified legal counsel before production use.'
        ],
        sections: [
            {
                title: '1. Personal Data We Collect',
                items: [
                    'Account details: name, email address, phone number, password hash, role, login status, account preferences, profile image, and account history.',
                    'Customer profile details: birthday, age, gender, postal code, preferred contact method, referral code, loyalty status, reward records, voucher records, wallet activity, and purchase history.',
                    'Booking and order details: selected services or products, merchant, date, time, add-ons, price, payment status, cancellation or refund status, receipts, QR check-in tokens, booking references, delivery or pickup records, and customer notes.',
                    'Merchant details: salon name, owner name, business email, owner phone, business address, operating hours, service listings, product listings, promotions, order records, customer communications, merchant notes, analytics, and support records.',
                    'Support and dispute data: refund reasons, cancellation reasons, photos or files uploaded as evidence, messages, internal notes, review decisions, timestamps, and investigation outcomes.',
                    'Technical data: IP address, browser or device information, session cookies, security events, authentication attempts, error logs, page activity needed to operate the site, and approximate or precise location if you choose to share it.',
                    'Communications data: emails, SMS, WhatsApp messages, in-app notifications, OTP delivery records, contact preferences, and whether messages were sent, skipped, failed, or received where available.',
                    'AI and recommendation inputs: routine-finder answers, search terms, support messages, analytics prompts, generated recommendations, and related context used to provide automated assistance.'
                ]
            },
            {
                title: '2. How We Collect Data',
                items: [
                    'Directly from you when you sign up, log in, book, buy, review, contact support, upload files, update your profile, use merchant tools, or submit forms.',
                    'Automatically when the platform records sessions, security events, bookings, QR check-ins, payment statuses, rewards, referrals, notifications, and operational logs.',
                    'From merchants, administrators, payment providers, messaging providers, delivery or pickup workflows, fraud-prevention tools, and other service providers involved in the transaction or support process.',
                    'From your browser or device when you allow location access, accept cookies, interact with forms, or use features that require device permissions.'
                ]
            },
            {
                title: '3. Why We Use Personal Data',
                items: [
                    'Create, authenticate, protect, maintain, suspend, or terminate accounts.',
                    'Process bookings, check availability, send confirmations, support QR check-in, manage rescheduling, cancellations, refunds, receipts, and attendance records.',
                    'Process product orders, pickup or delivery records, payment status updates, wallet activity, vouchers, cashback, loyalty points, referrals, gift cards, promotions, and campaign eligibility.',
                    'Allow merchants to manage listings, orders, bookings, customers, support requests, promotions, refunds, analytics, and operational workflows.',
                    'Send service messages, OTPs, reminders, support updates, refund outcomes, account notices, security alerts, and transactional notifications through your selected or available contact channels.',
                    'Investigate fraud, abuse, duplicate accounts, suspicious payments, false claims, chargebacks, security incidents, policy breaches, and legal requests.',
                    'Improve platform reliability, accessibility, user experience, ranking, search, recommendations, merchant quality, customer support, and business reporting.',
                    'Comply with laws, court orders, regulator requests, tax, accounting, audit, recordkeeping, consumer-protection, data-protection, and dispute-resolution obligations.'
                ]
            },
            {
                title: '4. Consent, Withdrawal, and Required Data',
                paragraphs: [
                    'Where consent is required, we ask for it before collecting, using, or disclosing personal data for the stated purposes. Some data is required to provide the service, such as contact details for bookings, payment-related details for purchases, and security data for account protection.',
                    'You may withdraw consent by contacting us, changing browser permissions, unsubscribing from optional marketing where available, or updating account settings. Withdrawal may mean we cannot provide certain features, process bookings, send reminders, verify identity, complete refunds, or maintain merchant access.',
                    'We may continue using or retaining data after withdrawal where permitted or required for legal, audit, security, dispute, fraud-prevention, accounting, or legitimate business purposes.'
                ]
            },
            {
                title: '5. Location Data',
                paragraphs: [
                    'If you allow browser location access, Vaniday may use location data during your current session to sort nearby salons, show distance-related information, improve discovery, or support map features.',
                    'You can deny or disable location permission in your browser or device settings. Core browsing remains available without precise location, although nearby sorting and map convenience may be limited.'
                ]
            },
            {
                title: '6. Cookies, Sessions, and Security Logs',
                paragraphs: [
                    'Vaniday uses cookies and similar technologies for login sessions, CSRF protection, cart state, security, fraud prevention, preferences, and basic site operation. Some cookies are essential for the platform to function.',
                    'Security logs may record login attempts, OTP events, rate limits, device or browser signals, IP addresses, suspicious activity, administrative actions, payment updates, support actions, and other events needed to protect users and the platform.'
                ]
            },
            {
                title: '7. Sharing Personal Data',
                items: [
                    'With merchants so they can provide booked services, manage orders, contact customers about appointments, process service issues, and respond to support or refund requests.',
                    'With payment providers so they can process payments, refunds, disputes, chargebacks, fraud checks, and payment confirmations.',
                    'With email, SMS, WhatsApp, QR, hosting, storage, analytics, AI, and technical service providers that help operate Vaniday.',
                    'With administrators, support staff, contractors, and professional advisers who need access to operate, investigate, secure, improve, or legally support the platform.',
                    'With regulators, courts, law enforcement, payment networks, counterparties, or other parties where required or permitted by law, to enforce terms, protect rights, investigate harm, or respond to legal process.',
                    'With another organisation if Vaniday is involved in a merger, acquisition, financing, restructuring, sale of assets, or similar business transaction, subject to appropriate safeguards.'
                ]
            },
            {
                title: '8. Overseas Transfers',
                paragraphs: [
                    'Some service providers may process or store data outside Singapore. Where personal data is transferred overseas, Vaniday will take reasonable steps to ensure comparable protection through contracts, provider safeguards, technical measures, or other legally recognised mechanisms where required.'
                ]
            },
            {
                title: '9. Retention',
                paragraphs: [
                    'We keep personal data only as long as reasonably needed for the purposes described in this policy, including account operation, booking records, receipts, rewards, audit logs, tax or accounting records, support history, legal claims, fraud prevention, and security.',
                    'Retention periods may differ by data type. For example, support and refund records may be kept while a dispute may arise; transaction records may be kept for accounting and audit; security logs may be kept for investigation; inactive account data may be deleted, anonymised, or archived when no longer needed.',
                    'When data is no longer needed for business or legal purposes, we will delete it, anonymise it, or securely restrict access where deletion is not immediately practical.'
                ]
            },
            {
                title: '10. Security',
                paragraphs: [
                    'Vaniday uses reasonable administrative, technical, and organisational measures to protect personal data against unauthorised access, collection, use, disclosure, copying, modification, disposal, loss, and similar risks.',
                    'No online platform can guarantee perfect security. You should use a strong password, keep OTPs private, log out from shared devices, keep your contact details current, and contact us promptly if you suspect unauthorised account access.'
                ]
            },
            {
                title: '11. Access, Correction, and Questions',
                paragraphs: [
                    'You may request access to personal data that Vaniday holds about you, information about recent use or disclosure, or correction of inaccurate or incomplete data. We may need to verify your identity before responding.',
                    'Some requests may be limited by law, security, confidentiality, technical feasibility, legal privilege, another person\'s privacy, ongoing investigations, or other permitted exceptions.',
                    'Privacy questions, access requests, correction requests, withdrawal requests, and complaints can be sent to support@vaniday.example with the subject "Data Protection Request". Replace this placeholder address with the real Data Protection Officer or business contact before production use.'
                ]
            },
            {
                title: '12. Marketing and Preferences',
                paragraphs: [
                    'We may send optional marketing, promotions, loyalty updates, merchant offers, or product recommendations where permitted. You can opt out of optional marketing using unsubscribe options or account settings where available.',
                    'Even if you opt out of marketing, we may still send transactional or service messages such as OTPs, booking confirmations, payment notices, refund outcomes, policy updates, security alerts, and support replies.'
                ]
            },
            {
                title: '13. Children and Minors',
                paragraphs: [
                    'Vaniday is not intended for children who cannot legally consent to use the platform or receive services without a parent or guardian. Merchants may apply age restrictions for certain services. If you believe a minor has provided personal data without appropriate consent, contact us so we can review the account or record.'
                ]
            },
            {
                title: '14. Data Breaches',
                paragraphs: [
                    'If a data breach occurs, Vaniday will assess the incident, take reasonable containment and remediation steps, and notify affected individuals or regulators where required by law.'
                ]
            },
            {
                title: '15. Changes to This Policy',
                paragraphs: [
                    'Vaniday may update this policy when our features, service providers, legal obligations, data practices, or business operations change. The updated version will apply from the stated effective date. If a change materially affects how we use personal data, we will take reasonable steps to notify affected users.'
                ]
            }
        ]
    });
});

function estimateProductCampaign(product) {
    return new Promise((resolve) => {
        Loyalty.estimateCampaignCashback({
            id: 'product-estimate',
            type: 'order',
            userId: 0,
            paymentStatus: 'paid',
            items: [{
                type: 'Product',
                merchantId: product.salonId,
                merchantName: product.salonName,
                lineTotal: Number(product.price || 0)
            }]
        }, (error, estimate) => {
            if (error) {
                console.error(error);
                resolve({ total: 0, breakdown: [] });
                return;
            }

            resolve(estimate || { total: 0, breakdown: [] });
        });
    });
}

const productCategorySlugs = {
    hair: 'Haircare',
    haircare: 'Haircare',
    nails: 'Nailcare',
    nailcare: 'Nailcare',
    spa: 'Wellness',
    massage: 'Wellness',
    sets: 'Sets',
    skincare: 'Skincare',
    bodycare: 'Bodycare',
    wellness: 'Wellness',
    makeup: 'Makeup'
};

function renderProductListingPage(req, res, categoryName = null) {
    const loadProducts = categoryName
        ? (callback) => Product.getAllByCategory(categoryName, callback)
        : Product.getAll;

    loadProducts(async (error, products = []) => {
        if (error) {
            console.error(error);
        }

        const enrichedProducts = await Promise.all((error ? [] : products).map(async (product) => ({
            ...product,
            campaignCashback: Number(product.stockQuantity || 0) > 0 ? await estimateProductCampaign(product) : { total: 0, breakdown: [] }
        })));

        res.render('products', {
            title: categoryName ? `${categoryName} Products` : 'Products',
            products: enrichedProducts,
            showChatbot: true,
            categoryName
        });
    });
}

app.get('/products', allowGuestOrCustomer, (req, res) => {
    renderProductListingPage(req, res);
});

['hair','haircare','nails','nailcare','spa','massage','sets','skincare','bodycare','wellness','makeup'].forEach((slug) => {
    app.get(`/products/${slug}`, allowGuestOrCustomer, (req, res) => {
        const categoryName = productCategorySlugs[slug];
        renderProductListingPage(req, res, categoryName);
    });
});

app.get('/products/:productId', allowGuestOrCustomer, (req, res) => {
    Product.findById(req.params.productId, (error, product) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Product Error',
                message: 'Product details could not be loaded.'
            });
        }

        if (!product) {
            return res.status(404).render('error', {
                title: 'Product Not Found',
                message: 'The product could not be found.'
            });
        }

        return Review.getSummaryByProductId(product.id, (summaryError, reviewSummary) => {
            if (summaryError) {
                console.error(summaryError);
            }

            return Review.listByProductId(product.id, 8, (reviewsError, reviews = []) => {
                if (reviewsError) {
                    console.error(reviewsError);
                }

                return estimateProductCampaign(product).then((campaignCashback) => res.render('product-detail', {
                    title: product.name,
                    product: { ...product, campaignCashback },
                    reviews: reviewsError ? [] : reviews,
                    reviewSummary: reviewSummary || { averageRating: null, reviewCount: 0 }
                }));
            });
        });
    });
});

app.get('/checkout', requireCustomer, (req, res) => res.redirect('/cart'));
app.post('/checkout', requireCustomer, merchantController.checkout);
app.get('/payment', requireCustomer, merchantController.showPayment);
app.post('/payment', requireCustomer, merchantController.confirmPayment);
app.post('/api/paypal/create-order', requireCustomer, merchantController.createPayPalOrder);
app.post('/api/paypal/capture-order', requireCustomer, merchantController.capturePayPalOrder);
app.get('/payment/hitpay/return', merchantController.handleHitPayReturn);
app.get('/payment/hitpay/status/:requestId', merchantController.getHitPayStatus);
app.get('/stripe/success', merchantController.handleStripeReturn);
app.get('/stripe/cancel', merchantController.handleStripeCancel);
app.get('/payment/stripe/success', merchantController.handleStripeReturn);
app.get('/payment/stripe/cancel', merchantController.handleStripeCancel);
app.get('/payment/success', requireCustomer, merchantController.showPaymentSuccess);
app.get('/receipt/:id', receiptController.showReceipt);
app.get('/receipt/:id/pdf', receiptController.downloadReceiptPdf);
app.get('/receipt/:id/google-calendar', receiptController.openBookingGoogleCalendar);
app.get('/receipt/:id/calendar.ics', receiptController.downloadBookingCalendar);
app.get('/pickup-verify/order/:id', receiptController.verifyPickup);
app.post('/pickup-verify/order/:id/confirm', receiptController.confirmPickup);
app.get('/receipt-checkin/:id', receiptController.checkIn);
app.post('/nets/complete', requireCustomer, merchantController.completeNetsPayment);
app.post('/nets/complete-fail', requireCustomer, merchantController.failNetsPayment);
app.get('/nets-qr/fail', requireCustomer, merchantController.showNetsFail);
app.get('/sse/payment-status/:txnRetrievalRef', requireCustomer, merchantController.streamNetsPaymentStatus);

app.get('/profile/wallet', requireCustomer, walletController.showWallet);
app.post('/profile/wallet/topup', requireCustomer, walletController.topupWallet);
app.get('/profile/wallet/topup/verify', requireCustomer, walletController.showTopup2faVerify);
app.post('/profile/wallet/topup/verify', requireCustomer, walletController.verifyTopup2fa);
app.get('/profile/wallet/success', walletController.handleWalletSuccess);
app.get('/profile/wallet/cancel', requireCustomer, walletController.handleWalletCancel);
app.get('/profile/wallet/paypal/return', requireCustomer, walletController.handlePaypalReturn);
app.get('/profile/wallet/paypal/cancel', requireCustomer, walletController.handlePaypalCancel);
app.post('/profile/wallet/nets/complete', requireCustomer, walletController.completeNetsTopup);
app.post('/profile/wallet/nets/fail', requireCustomer, walletController.failNetsTopup);
app.get('/wallet', requireCustomer, loyaltyController.showWallet);
app.get('/customer/wallet', requireCustomer, loyaltyController.showWallet);
app.post('/wallet/redeem', requireCustomer, loyaltyController.redeemPoints);
app.post('/customer/wallet/redeem', requireCustomer, loyaltyController.redeemPoints);
app.post('/customer/checkout/apply-cashback', requireCustomer, loyaltyController.applyCashback);
app.get('/cashback', requireCustomer, (req, res) => res.redirect('/profile#wallet'));

app.get('/giftcards', requireCustomer, merchantController.showGiftCards);
app.get('/giftcards/redeem', requireCustomer, merchantController.redeemGiftCard);
app.post('/giftcards/redeem', requireCustomer, merchantController.redeemGiftCard);
app.get('/giftcards/add', requireCustomer, (req, res) => {
    res.redirect('/giftcards');
});
app.post('/giftcards/add', requireCustomer, merchantController.addGiftCardToCart);

app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', {
        title: 'Server Error',
        message: 'Something went wrong. Please try again later.'
    });
});

function initializeDatabaseSchemas(callback) {
    Booking.ensureBookingManagementSchema((bookingError) => {
        if (bookingError) {
            callback(bookingError);
            return;
        }

        Review.ensureReviewSchema((reviewError) => {
            if (reviewError) {
                callback(reviewError);
                return;
            }

            SpinDiscover.ensureSchema((spinError) => {
                if (spinError) {
                    callback(spinError);
                    return;
                }

                CashbackCampaign.ensureSchema((cashbackError) => {
                    callback(cashbackError);
                });
            });
        });
    });
}

// Start Server
const PORT = process.env.PORT || 3000;
initializeDatabaseSchemas((schemaError) => {
    if (schemaError) {
        console.error('Database schema initialization failed:', schemaError);
        process.exit(1);
        return;
    }

    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        startWhatsAppWebClient({ onMessage: whatsappController.handleIncomingMessage }).catch((error) => {
            console.error('WhatsApp Web client startup failed:', error.message || error);
        });
        startBookingAutoCompletionScheduler();
        startWhatsAppReminderScheduler();
        startSmsReminderScheduler();
    });
});
