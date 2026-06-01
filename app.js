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
const gameController = require('./controllers/gameController');
const receiptController = require('./controllers/receiptController');
const profileController = require('./controllers/profileController');
const loyaltyController = require('./controllers/loyaltyController');
const merchantDashboardController = require('./controllers/merchantDashboardController');
const bookingController = require('./controllers/bookingController');
const notificationController = require('./controllers/notificationController');
const helpCenterController = require('./controllers/helpCenterController');
const whatsappController = require('./controllers/whatsappController');
const { uploadReviewMedia } = require('./utils/reviewUpload');
const { uploadSupportScreenshot } = require('./utils/supportUpload');
const { uploadProductImage } = require('./utils/productUpload');
const { startSmsReminderScheduler } = require('./services/smsAutomation');
const { startWhatsAppReminderScheduler } = require('./services/whatsappAutomation');
const {
    allowGuestOrCustomer,
    allowBookingViewer,
    createRateLimiter,
    ensureCsrfToken,
    requireCustomer,
    requireLogin,
    requireRole,
    setSecurityHeaders,
    verifyCsrfToken
} = require('./middleware');
const Product = require('./models/Product');
const Review = require('./models/Review');
const Notification = require('./models/Notification');
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
app.use(bodyParser.json({ limit: '100kb', verify: captureRawBody }));
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
app.use(passport.initialize());
app.use(ensureCsrfToken);

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

        next();
    });
});

app.use(verifyCsrfToken);

const authRateLimit = createRateLimiter({
    namespace: 'auth',
    windowMs: 15 * 60 * 1000,
    max: 20,
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
        res.redirect('/profile#bookings');
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
        res.redirect('/profile/history?type=products');
    });
}

function handleSupportScreenshotUpload(req, res, next) {
    uploadSupportScreenshot(req, res, (error) => {
        if (!error) {
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
app.post('/help-center/requests/:requestId/send-to-merchant', requireRole('admin'), helpCenterController.adminSendToMerchant);
app.post('/help-center/requests/:requestId/merchant-response', requireRole('merchant'), helpCenterController.merchantRespond);
app.post('/help-center/requests/:requestId/admin-resolution', requireRole('admin'), helpCenterController.adminResolve);
app.post('/help-center/orders/:transactionId/delivery-status', requireRole('merchant', 'admin'), helpCenterController.updateOrderDeliveryStatus);
app.get('/profile/history', requireCustomer, profileController.showHistory);
app.get('/reward-shop', requireCustomer, userController.showRewardShop);
app.post('/reward-shop/claim', requireCustomer, userController.claimRewardShopDaily);
app.post('/reward-shop/vouchers/:voucherId/redeem', requireCustomer, userController.redeemRewardShopVoucher);
app.get('/membership', requireCustomer, (req, res) => {
    res.redirect('/profile#membership');
});
app.post('/profile', userController.updateProfile);
app.post('/profile/password', userController.updatePassword);
app.post('/profile/bookings/:bookingId/cancel', requireCustomer, bookingController.cancelBooking);
app.get('/profile/bookings/:bookingId/reschedule-suggestions', requireCustomer, bookingController.getRescheduleSuggestions);
app.post('/profile/bookings/:bookingId/reschedule', requireCustomer, bookingController.rescheduleBooking);
app.post('/profile/bookings/:bookingId/review', requireCustomer, handleReviewMediaUpload, bookingController.submitReview);
app.post('/profile/orders/:receiptId/products/:productId/review', requireCustomer, handleHistoryReviewMediaUpload, profileController.submitProductReview);
app.get('/rewards-game', requireCustomer, gameController.showCustomerGame);
app.post('/rewards-game/play', requireCustomer, gameController.playCustomerGame);
app.get('/rewards-game/flappy', requireCustomer, gameController.showFlappyGame);
app.post('/rewards-game/flappy/finish', requireCustomer, gameController.finishFlappyGame);
app.get('/login', userController.showLogin);
app.post('/login', authRateLimit, userController.loginUser);
app.get('/auth/google', userController.startGoogleLogin);
app.get('/auth/google/callback', userController.handleGoogleCallback);
app.get('/webhooks/whatsapp', whatsappController.getWebhook);
app.post('/webhooks/whatsapp', whatsappController.postWebhook);
app.post('/webhooks/hitpay', merchantController.handleHitPayWebhook);
app.get('/signup', userController.showSignup);
app.get('/ref/:referralCode', userController.openReferralSignup);
app.post('/signup', authRateLimit, userController.signupUser);
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
app.get('/merchants/:merchantId/qr', requireRole('merchant'), merchantController.showMerchantQr);
app.get('/m/:merchantSlug', allowGuestOrCustomer, merchantController.showMerchantStorefront);
app.post('/m/:merchantSlug', allowGuestOrCustomer, merchantController.saveStorefrontBooking);
app.get('/scan/:merchantId', allowGuestOrCustomer, merchantController.showSecureScanBooking);
app.post('/scan/:merchantId', allowGuestOrCustomer, merchantController.saveSecureScanBooking);
app.get('/book/:serviceId', allowGuestOrCustomer, bookingController.showBookFallback);
app.post('/book/:serviceId', allowGuestOrCustomer, bookingController.createBooking);
app.get('/checking/:signedToken', bookingController.showCheckIn);
app.post('/checking/:signedToken', bookingController.confirmCheckIn);
app.get('/checkin/:signedToken', bookingController.showCheckIn);
app.post('/checkin/:signedToken', bookingController.confirmCheckIn);
app.get('/booking/confirm/:bookingId', bookingController.confirmBooking);
app.get('/booking/:merchantId/available-slots', allowGuestOrCustomer, merchantController.getBookingAvailability);
app.get('/booking/:merchantId/:qrToken', allowBookingViewer, merchantController.showBookingPage);
app.post('/booking/:merchantId/:qrToken', allowGuestOrCustomer, merchantController.saveQrBooking);
app.get('/booking/:merchantId', allowBookingViewer, merchantController.showBookingPage);
app.post('/booking/:merchantId', allowGuestOrCustomer, merchantController.saveQrBooking);
app.get('/merchants/:id', allowGuestOrCustomer, merchantController.showMerchant);
app.post('/merchants/:id/book', allowGuestOrCustomer, merchantController.createBooking);
app.get('/api/ai/booking-options', aiRateLimit, allowGuestOrCustomer, aiController.getGuidedBookingOptions);
app.get('/api/ai/booking-slots', aiRateLimit, allowGuestOrCustomer, aiController.getGuidedBookingSlots);
app.get('/api/ai/customer-bookings', aiRateLimit, requireCustomer, aiController.getGuidedCustomerBookings);
app.post('/api/ai/chat', aiRateLimit, allowGuestOrCustomer, aiController.getBeautyAdvice);
app.post('/api/ai/product-copy', aiRateLimit, requireMerchantJson, aiController.generateProductCopy);
app.get('/merchant', requireRole('merchant'), (req, res) => res.redirect('/merchant/dashboard'));
app.get('/merchant/dashboard', requireRole('merchant'), merchantDashboardController.showDashboard);
app.get('/merchant/bookings', requireRole('merchant'), merchantDashboardController.showBookings);
app.get('/merchant/orders', requireRole('merchant'), merchantDashboardController.showOrders);
app.post('/merchant/orders/:transactionId/status', requireRole('merchant'), merchantDashboardController.updateOrderStatus);
app.get('/merchant/customers', requireRole('merchant'), merchantDashboardController.showCustomers);
app.get('/merchant/analytics', requireRole('merchant'), merchantDashboardController.showAnalytics);
app.get('/merchant/support', requireRole('merchant'), merchantDashboardController.showSupport);
app.get('/merchant/profile', requireRole('merchant'), merchantDashboardController.showProfile);
app.post('/merchant/profile', requireRole('merchant'), merchantDashboardController.updateProfile);
app.get('/merchant/loyalty', requireRole('merchant'), merchantDashboardController.showLoyaltySettings);
app.post('/merchant/loyalty', requireRole('merchant'), merchantDashboardController.updateLoyaltySettings);
app.get('/merchant/cashback', requireRole('merchant'), merchantDashboardController.listCashbackCampaigns);
app.get('/merchant/cashback/new', requireRole('merchant'), merchantDashboardController.showNewCashbackCampaign);
app.post('/merchant/cashback', requireRole('merchant'), merchantDashboardController.createCashbackCampaign);
app.get('/merchant/cashback/:campaignId/edit', requireRole('merchant'), merchantDashboardController.showEditCashbackCampaign);
app.post('/merchant/cashback/:campaignId', requireRole('merchant'), merchantDashboardController.updateCashbackCampaign);
app.post('/merchant/cashback/:campaignId/delete', requireRole('merchant'), merchantDashboardController.deleteCashbackCampaign);
app.get('/merchant/schedule', requireRole('merchant'), merchantDashboardController.showSchedule);
app.get('/merchant/check-in/:token', requireRole('merchant'), merchantController.showBookingCheckIn);
app.post('/merchant/check-in/:token', requireRole('merchant'), merchantController.confirmBookingCheckIn);
app.get('/merchant/services', requireRole('merchant'), merchantDashboardController.showServices);
app.post('/merchant/generate-qr', requireRole('merchant'), merchantDashboardController.generateQr);
app.post('/merchant/bookings/:bookingId/status', requireRole('merchant'), merchantDashboardController.updateBookingStatus);
app.get('/merchant/bookings/:bookingId/status', requireRole('merchant'), (req, res) => res.redirect('/merchant/bookings'));
app.get('/merchant/reschedule-settings', requireRole('merchant'), (req, res) => res.redirect('/merchant/bookings'));
app.post('/merchant/reschedule-settings', requireRole('merchant'), merchantDashboardController.updateRescheduleSettings);
app.post('/merchant/reschedule-requests/:requestId/review', requireRole('merchant'), merchantDashboardController.reviewRescheduleRequest);
app.get('/merchant/services/new', requireRole('merchant'), merchantDashboardController.showNewService);
app.post('/merchant/services', requireRole('merchant'), merchantDashboardController.createService);
app.get('/merchant/services/:serviceId/edit', requireRole('merchant'), merchantDashboardController.showEditService);
app.post('/merchant/services/:serviceId', requireRole('merchant'), merchantDashboardController.updateService);
app.post('/merchant/services/:serviceId/delete', requireRole('merchant'), merchantDashboardController.deleteService);
app.post('/merchant/services/:serviceId/feature', requireRole('merchant'), merchantDashboardController.featureService);
app.post('/merchant/services/:serviceId/unfeature', requireRole('merchant'), merchantDashboardController.unfeatureService);
app.get('/merchant/products', requireRole('merchant'), merchantDashboardController.listProducts);
app.get('/merchant/products/new', requireRole('merchant'), merchantDashboardController.showNewProduct);
app.post('/merchant/products', requireRole('merchant'), handleProductImageUpload, merchantDashboardController.createProduct);
app.get('/merchant/products/:productId/edit', requireRole('merchant'), merchantDashboardController.showEditProduct);
app.get('/merchant/products/:productId', requireRole('merchant'), redirectMerchantProductDetail);
app.post('/merchant/products/:productId', requireRole('merchant'), handleProductImageUpload, merchantDashboardController.updateProduct);
app.post('/merchant/products/:productId/restock', requireRole('merchant'), merchantDashboardController.restockProduct);
app.post('/merchant/products/:productId/delete', requireRole('merchant'), merchantDashboardController.deleteProduct);
app.post('/merchant/products/:productId/feature', requireRole('merchant'), merchantDashboardController.featureProduct);
app.post('/merchant/products/:productId/unfeature', requireRole('merchant'), merchantDashboardController.unfeatureProduct);
app.get('/merchant/promotions', requireRole('merchant'), merchantDashboardController.listPromotions);
app.get('/merchant/promotions/new', requireRole('merchant'), merchantDashboardController.showNewPromotion);
app.post('/merchant/promotions', requireRole('merchant'), merchantDashboardController.createPromotion);
app.get('/merchant/promotions/:promotionId/edit', requireRole('merchant'), merchantDashboardController.showEditPromotion);
app.post('/merchant/promotions/:promotionId', requireRole('merchant'), merchantDashboardController.updatePromotion);
app.post('/merchant/promotions/:promotionId/delete', requireRole('merchant'), merchantDashboardController.deletePromotion);
app.get('/merchant/vouchers', requireRole('merchant'), merchantDashboardController.listVouchers);
app.get('/merchant/vouchers/new', requireRole('merchant'), merchantDashboardController.showNewVoucher);
app.post('/merchant/vouchers', requireRole('merchant'), merchantDashboardController.createVoucher);
app.get('/merchant/vouchers/:voucherId/edit', requireRole('merchant'), merchantDashboardController.showEditVoucher);
app.post('/merchant/vouchers/:voucherId', requireRole('merchant'), merchantDashboardController.updateVoucher);
app.post('/merchant/vouchers/:voucherId/delete', requireRole('merchant'), merchantDashboardController.deleteVoucher);
app.get('/merchant/rewards-game', requireRole('merchant'), gameController.showMerchantGame);
app.get('/merchant/rewards-game/prizes/new', requireRole('merchant'), gameController.showNewMerchantPrize);
app.post('/merchant/rewards-game/prizes', requireRole('merchant'), gameController.createMerchantPrize);
app.get('/merchant/rewards-game/prizes/:prizeId/edit', requireRole('merchant'), gameController.showEditMerchantPrize);
app.post('/merchant/rewards-game/prizes/:prizeId', requireRole('merchant'), gameController.updateMerchantPrize);
app.post('/merchant/rewards-game/prizes/:prizeId/delete', requireRole('merchant'), gameController.deleteMerchantPrize);
app.get('/merchant/:merchantId', allowGuestOrCustomer, merchantController.showPublicMerchantBooking);
app.get('/admin', requireRole('admin'), (req, res) => res.redirect('/admin/overview'));
app.get('/admin/overview', requireRole('admin'), adminController.showOverview);
app.get('/admin/bookings', requireRole('admin'), adminController.showBookings);
app.get('/admin/merchants', requireRole('admin'), adminController.showMerchants);
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
app.get('/admin/game-control', requireRole('admin'), (req, res) => res.redirect('/admin/rewards-game'));
app.get('/admin/merchants/new', requireRole('admin'), adminController.showNewMerchant);
app.post('/admin/merchants', requireRole('admin'), adminController.createMerchant);
app.post('/admin/merchants/:salonId/commission', requireRole('admin'), adminController.updateMerchantCommission);
app.post('/admin/merchants/:salonId/feature', requireRole('admin'), adminController.featureMerchant);
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
app.get('/admin/rewards-game', requireRole('admin'), gameController.showAdminGame);
app.get('/admin/loyalty', requireRole('admin'), loyaltyController.showAdminRules);
app.post('/admin/loyalty', requireRole('admin'), loyaltyController.updateAdminRules);
app.post('/admin/rewards-game/settings', requireRole('admin'), gameController.updateAdminSettings);
app.get('/admin/rewards-game/prizes/new', requireRole('admin'), gameController.showNewAdminPrize);
app.post('/admin/rewards-game/prizes', requireRole('admin'), gameController.createAdminPrize);
app.get('/admin/rewards-game/prizes/:prizeId/edit', requireRole('admin'), gameController.showEditAdminPrize);
app.post('/admin/rewards-game/prizes/:prizeId', requireRole('admin'), gameController.updateAdminPrize);
app.post('/admin/rewards-game/prizes/:prizeId/delete', requireRole('admin'), gameController.deleteAdminPrize);

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
        summary: 'These prototype terms explain how Vaniday booking, rewards, and merchant services should be used.',
        sections: [
            { title: 'Bookings', copy: 'Customers are responsible for selecting accurate service, date, and contact details. Merchants may review, confirm, reschedule, or cancel bookings according to their availability policies.' },
            { title: 'Accounts', copy: 'Keep your login details private and update your profile information when it changes. Vaniday may protect accounts from suspicious or abusive activity.' },
            { title: 'Rewards and Payments', copy: 'Promotions, points, cashback, vouchers, and refunds are subject to eligibility checks and merchant or admin review where applicable.' }
        ]
    });
});

app.get('/privacy', allowGuestOrCustomer, (req, res) => {
    res.render('legal', {
        title: 'Privacy Policy',
        heading: 'Privacy Policy',
        summary: 'This prototype privacy policy describes how Vaniday uses account, booking, and location-related data.',
        sections: [
            { title: 'Account Data', copy: 'We use your name, email, phone number, and profile details to manage bookings, receipts, rewards, support requests, and notifications.' },
            { title: 'Location Data', copy: 'Browser location is used only in your current session to sort nearby salons when you choose to allow it. Browsing remains available if permission is denied.' },
            { title: 'Service Providers', copy: 'Booking confirmations and reminders may use configured email, SMS, WhatsApp, payment, and QR services.' }
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

app.get('/products', allowGuestOrCustomer, (req, res) => {
    Product.getAll(async (error, products = []) => {
        if (error) {
            console.error(error);
        }

        const enrichedProducts = await Promise.all((error ? [] : products).map(async (product) => ({
            ...product,
            campaignCashback: Number(product.stockQuantity || 0) > 0 ? await estimateProductCampaign(product) : { total: 0, breakdown: [] }
        })));

        res.render('products', {
            title: 'Products',
            products: enrichedProducts,
            showChatbot: true
        });
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
app.get('/payment/hitpay/return', requireCustomer, merchantController.handleHitPayReturn);
app.get('/payment/hitpay/status/:requestId', requireCustomer, merchantController.getHitPayStatus);
app.get('/stripe/success', requireCustomer, merchantController.handleStripeReturn);
app.get('/stripe/cancel', requireCustomer, merchantController.handleStripeCancel);
app.get('/payment/stripe/success', requireCustomer, merchantController.handleStripeReturn);
app.get('/payment/stripe/cancel', requireCustomer, merchantController.handleStripeCancel);
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

app.get('/wallet', requireCustomer, loyaltyController.showWallet);
app.get('/customer/wallet', requireCustomer, loyaltyController.showWallet);
app.post('/wallet/redeem', requireCustomer, loyaltyController.redeemPoints);
app.post('/customer/wallet/redeem', requireCustomer, loyaltyController.redeemPoints);
app.post('/customer/checkout/apply-cashback', requireCustomer, loyaltyController.applyCashback);
app.get('/cashback', requireCustomer, (req, res) => res.redirect('/profile#wallet'));

app.get('/giftcards', requireCustomer, (req, res) => {
    const success = req.session.success;
    req.session.success = null;
    res.render('giftcards', { title: 'Gift Cards', success });
});
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

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    startWhatsAppReminderScheduler();
    startSmsReminderScheduler();
});
