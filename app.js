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
const Notification = require('./models/Notification');
const { getCartItemCount } = require('./utils/cart');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'dev-only-vaniday-session-secret-change-me';

if (isProduction && sessionSecret === 'dev-only-vaniday-session-secret-change-me') {
    throw new Error('SESSION_SECRET must be set in production.');
}

app.set('trust proxy', 1);

// Set up EJS for your Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(setSecurityHeaders);
app.use(express.static(path.join(__dirname, 'public'), {
    redirect: false,
    maxAge: isProduction ? '7d' : 0
})); // For CSS, Images, JS
app.use(bodyParser.urlencoded({ extended: true, limit: '100kb' }));
app.use(bodyParser.json({ limit: '100kb' }));
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
app.post('/notifications/read-all', requireLogin, notificationController.markAllRead);
app.get('/help-center', requireLogin, helpCenterController.showHelpCenter);
app.post('/help-center/requests', requireCustomer, helpCenterController.createRequest);
app.post('/help-center/requests/:requestId/send-to-merchant', requireRole('admin'), helpCenterController.adminSendToMerchant);
app.post('/help-center/requests/:requestId/merchant-response', requireRole('merchant'), helpCenterController.merchantRespond);
app.post('/help-center/requests/:requestId/admin-resolution', requireRole('admin'), helpCenterController.adminResolve);
app.post('/help-center/orders/:transactionId/delivery-status', requireRole('merchant', 'admin'), helpCenterController.updateOrderDeliveryStatus);
app.get('/profile/history', requireCustomer, profileController.showHistory);
app.get('/reward-shop', requireCustomer, userController.showRewardShop);
app.post('/reward-shop/claim', requireCustomer, userController.claimRewardShopDaily);
app.get('/membership', requireCustomer, (req, res) => {
    res.redirect('/profile#membership');
});
app.post('/profile', userController.updateProfile);
app.post('/profile/password', userController.updatePassword);
app.post('/profile/bookings/:bookingId/cancel', requireCustomer, bookingController.cancelBooking);
app.post('/profile/bookings/:bookingId/reschedule', requireCustomer, bookingController.rescheduleBooking);
app.post('/profile/bookings/:bookingId/review', requireCustomer, handleReviewMediaUpload, bookingController.submitReview);
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
app.get('/scan/:merchantId', allowGuestOrCustomer, merchantController.showSecureScanBooking);
app.post('/scan/:merchantId', requireCustomer, merchantController.saveSecureScanBooking);
app.get('/book/:serviceId', requireCustomer, bookingController.showBookFallback);
app.post('/book/:serviceId', requireCustomer, bookingController.createBooking);
app.get('/booking/confirm/:bookingId', bookingController.confirmBooking);
app.get('/booking/:merchantId/:qrToken', allowBookingViewer, merchantController.showBookingPage);
app.post('/booking/:merchantId/:qrToken', requireCustomer, merchantController.saveQrBooking);
app.get('/booking/:merchantId', allowBookingViewer, merchantController.showBookingPage);
app.post('/booking/:merchantId', requireCustomer, merchantController.saveQrBooking);
app.get('/merchants/:id', allowGuestOrCustomer, merchantController.showMerchant);
app.post('/merchants/:id/book', requireCustomer, merchantController.createBooking);
app.post('/api/ai/chat', aiRateLimit, allowGuestOrCustomer, aiController.getBeautyAdvice);
app.post('/api/ai/product-copy', aiRateLimit, requireMerchantJson, aiController.generateProductCopy);
app.get('/merchant', requireRole('merchant'), merchantDashboardController.showServices);
app.get('/merchant/schedule', requireRole('merchant'), merchantDashboardController.showSchedule);
app.get('/merchant/check-in/:token', requireRole('merchant'), merchantController.showBookingCheckIn);
app.post('/merchant/check-in/:token', requireRole('merchant'), merchantController.confirmBookingCheckIn);
app.get('/merchant/services', requireRole('merchant'), merchantDashboardController.showServices);
app.post('/merchant/generate-qr', requireRole('merchant'), merchantDashboardController.generateQr);
app.get('/merchant/services/new', requireRole('merchant'), merchantDashboardController.showNewService);
app.post('/merchant/services', requireRole('merchant'), merchantDashboardController.createService);
app.get('/merchant/services/:serviceId/edit', requireRole('merchant'), merchantDashboardController.showEditService);
app.post('/merchant/services/:serviceId', requireRole('merchant'), merchantDashboardController.updateService);
app.post('/merchant/services/:serviceId/delete', requireRole('merchant'), merchantDashboardController.deleteService);
app.get('/merchant/products', requireRole('merchant'), merchantDashboardController.listProducts);
app.get('/merchant/products/new', requireRole('merchant'), merchantDashboardController.showNewProduct);
app.post('/merchant/products', requireRole('merchant'), merchantDashboardController.createProduct);
app.get('/merchant/products/:productId/edit', requireRole('merchant'), merchantDashboardController.showEditProduct);
app.post('/merchant/products/:productId', requireRole('merchant'), merchantDashboardController.updateProduct);
app.post('/merchant/products/:productId/restock', requireRole('merchant'), merchantDashboardController.restockProduct);
app.post('/merchant/products/:productId/delete', requireRole('merchant'), merchantDashboardController.deleteProduct);
app.get('/merchant/promotions', requireRole('merchant'), merchantDashboardController.listPromotions);
app.get('/merchant/promotions/new', requireRole('merchant'), merchantDashboardController.showNewPromotion);
app.post('/merchant/promotions', requireRole('merchant'), merchantDashboardController.createPromotion);
app.get('/merchant/promotions/:promotionId/edit', requireRole('merchant'), merchantDashboardController.showEditPromotion);
app.post('/merchant/promotions/:promotionId', requireRole('merchant'), merchantDashboardController.updatePromotion);
app.post('/merchant/promotions/:promotionId/delete', requireRole('merchant'), merchantDashboardController.deletePromotion);
app.get('/merchant/rewards-game', requireRole('merchant'), gameController.showMerchantGame);
app.get('/merchant/rewards-game/prizes/new', requireRole('merchant'), gameController.showNewMerchantPrize);
app.post('/merchant/rewards-game/prizes', requireRole('merchant'), gameController.createMerchantPrize);
app.get('/merchant/rewards-game/prizes/:prizeId/edit', requireRole('merchant'), gameController.showEditMerchantPrize);
app.post('/merchant/rewards-game/prizes/:prizeId', requireRole('merchant'), gameController.updateMerchantPrize);
app.post('/merchant/rewards-game/prizes/:prizeId/delete', requireRole('merchant'), gameController.deleteMerchantPrize);
app.get('/merchant/:merchantId', allowGuestOrCustomer, merchantController.showPublicMerchantBooking);
app.get('/admin', requireRole('admin'), adminController.showDashboard);
app.get('/admin/merchants/new', requireRole('admin'), adminController.showNewMerchant);
app.post('/admin/merchants', requireRole('admin'), adminController.createMerchant);
app.get('/admin/services', requireRole('admin'), adminController.listServices);
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

app.get('/products', allowGuestOrCustomer, (req, res) => {
    Product.getAll((error, products) => {
        if (error) {
            console.error(error);
        }

        res.render('products', {
            title: 'Products',
            products: error ? [] : products,
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

        return res.render('product-detail', {
            title: product.name,
            product
        });
    });
});

app.post('/checkout', requireCustomer, merchantController.checkout);
app.get('/payment', requireCustomer, merchantController.showPayment);
app.post('/payment', requireCustomer, merchantController.confirmPayment);
app.get('/payment/success', requireCustomer, merchantController.showPaymentSuccess);
app.get('/receipt/:id', requireCustomer, receiptController.showReceipt);
app.get('/receipt/:id/pdf', requireCustomer, receiptController.downloadReceiptPdf);
app.get('/checkin/:id', receiptController.checkIn);
app.post('/nets/complete', requireCustomer, merchantController.completeNetsPayment);
app.post('/nets/complete-fail', requireCustomer, merchantController.failNetsPayment);
app.get('/nets-qr/fail', requireCustomer, merchantController.showNetsFail);
app.get('/sse/payment-status/:txnRetrievalRef', requireCustomer, merchantController.streamNetsPaymentStatus);

app.get('/wallet', requireCustomer, loyaltyController.showWallet);
app.post('/wallet/redeem', requireCustomer, loyaltyController.redeemPoints);
app.get('/cashback', requireCustomer, loyaltyController.showCashback);

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
});
