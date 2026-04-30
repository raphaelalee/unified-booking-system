const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
require('dotenv').config();
const merchantController = require('./controllers/merchantController');
const userController = require('./controllers/userController');
const aiController = require('./controllers/aiController');
const adminController = require('./controllers/adminController');
const merchantDashboardController = require('./controllers/merchantDashboardController');
const { allowBookingViewer, allowGuestOrCustomer, requireCustomer, requireRole } = require('./middleware');
const Product = require('./models/Product');
const { getCartItemCount } = require('./utils/cart');

const app = express();

// Set up EJS for your Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public'), { redirect: false })); // For CSS, Images, JS
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'vaniday_secret_key',
    resave: false,
    saveUninitialized: true
}));

app.use((req, res, next) => {
    res.locals.cartCount = getCartItemCount(req.session.cart || []);
    res.locals.currentUser = req.session.user || null;
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
app.get('/membership', requireCustomer, (req, res) => {
    res.redirect('/profile#membership');
});
app.post('/profile', userController.updateProfile);
app.post('/profile/password', userController.updatePassword);
app.get('/login', userController.showLogin);
app.post('/login', userController.loginUser);
app.get('/signup', userController.showSignup);
app.post('/signup', userController.signupUser);
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
app.get('/scan/:merchantId', allowBookingViewer, merchantController.showSecureScanBooking);
app.post('/scan/:merchantId', requireCustomer, merchantController.saveSecureScanBooking);
app.get('/booking/:merchantId/:qrToken', allowBookingViewer, merchantController.showBookingPage);
app.post('/booking/:merchantId/:qrToken', requireCustomer, merchantController.saveQrBooking);
app.get('/booking/:merchantId', allowBookingViewer, merchantController.showBookingPage);
app.post('/booking/:merchantId', requireCustomer, merchantController.saveQrBooking);
app.get('/merchants/:id', allowGuestOrCustomer, merchantController.showMerchant);
app.post('/merchants/:id/book', requireCustomer, merchantController.createBooking);
app.post('/api/ai/chat', allowGuestOrCustomer, aiController.getBeautyAdvice);
app.get('/merchant', requireRole('merchant'), merchantDashboardController.showServices);
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
app.post('/merchant/products/:productId/delete', requireRole('merchant'), merchantDashboardController.deleteProduct);
app.get('/merchant/:merchantId', allowGuestOrCustomer, merchantController.showPublicMerchantBooking);
app.get('/admin', requireRole('admin'), adminController.showDashboard);
app.get('/admin/merchants/new', requireRole('admin'), adminController.showNewMerchant);
app.post('/admin/merchants', requireRole('admin'), adminController.createMerchant);
app.get('/admin/services', requireRole('admin'), adminController.listServices);
app.get('/admin/services/new', requireRole('admin'), adminController.showNewService);
app.post('/admin/services', requireRole('admin'), adminController.createService);
app.get('/admin/services/:serviceId/edit', requireRole('admin'), adminController.showEditService);
app.post('/admin/services/:serviceId', requireRole('admin'), adminController.updateService);
app.post('/admin/services/:serviceId/delete', requireRole('admin'), adminController.deleteService);

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
            products: error ? Product.getAll() : products,
            showChatbot: true
        });
    });
});

app.post('/checkout', requireCustomer, merchantController.checkout);
app.get('/payment', requireCustomer, merchantController.showPayment);
app.post('/payment', requireCustomer, merchantController.confirmPayment);
app.get('/payment/success', requireCustomer, merchantController.showPaymentSuccess);
app.post('/nets/complete', requireCustomer, merchantController.completeNetsPayment);
app.post('/nets/complete-fail', requireCustomer, merchantController.failNetsPayment);
app.get('/nets-qr/fail', requireCustomer, merchantController.showNetsFail);
app.get('/sse/payment-status/:txnRetrievalRef', requireCustomer, merchantController.streamNetsPaymentStatus);

app.get('/cashback', requireCustomer, (req, res) => {
    res.render('cashback', { title: 'Cashback' });
});

app.get('/giftcards', requireCustomer, (req, res) => {
    res.render('giftcards', { title: 'Gift Cards' });
});

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
});
