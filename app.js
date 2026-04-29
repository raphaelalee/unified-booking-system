const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const merchantController = require('./controllers/merchantController');
const userController = require('./controllers/userController');
const Merchant = require('./models/Merchant');
const Product = require('./models/Product');
require('dotenv').config();

const app = express();

// Set up EJS for your Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public'))); // For CSS, Images, JS
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'vaniday_secret_key',
    resave: false,
    saveUninitialized: true
}));

app.use((req, res, next) => {
    res.locals.cartCount = req.session.cart ? req.session.cart.length : 0;
    res.locals.currentUser = req.session.user || null;
    next();
});

app.get('/', merchantController.showHome);
app.get('/merchants', merchantController.listMerchants);
app.get('/profile', userController.showProfile);
app.get('/membership', merchantController.showMembership);
app.post('/profile', userController.updateProfile);
app.get('/login', userController.showLogin);
app.post('/login', userController.loginUser);
app.get('/signup', userController.showSignup);
app.post('/signup', userController.signupUser);
app.post('/logout', userController.logoutUser);
app.get('/cart', merchantController.showCart);
app.post('/cart/add/:merchantId', merchantController.addToCart);
app.get('/cart/product/:productId', merchantController.addProductToCart);
app.post('/cart/product/:productId', merchantController.addProductToCart);
app.post('/cart/remove/:itemId', merchantController.removeFromCart);
app.post('/merchants/:merchantId/favourite', merchantController.toggleFavouriteMerchant);
app.get('/merchants/:merchantId/qr', merchantController.showMerchantQr);
app.get('/booking/:merchantId/:qrToken', merchantController.showBookingPage);
app.post('/booking/:merchantId/:qrToken', merchantController.saveQrBooking);
app.get('/booking/:merchantId', merchantController.showBookingPage);
app.post('/booking/:merchantId', merchantController.saveQrBooking);
app.get('/merchants/:id', merchantController.showMerchant);
app.post('/merchants/:id/book', merchantController.createBooking);

app.get('/about', (req, res) => {
    res.render('about', { title: 'About Us' });
});

app.get('/contact', (req, res) => {
    res.render('contact', { title: 'Contact Us' });
});

app.get('/services', (req, res) => {
    const search = req.query.search || '';
    const favouriteIds = req.session.favouriteMerchantIds || [];
    const allMerchants = Merchant.getAll();
    const serviceCatalog = allMerchants.flatMap((merchant) => {
        return merchant.services.map((service) => ({
            ...service,
            merchantId: merchant.id,
            merchantName: merchant.name,
            merchantQrToken: merchant.qrToken,
            serviceBookingPath: `/booking/${merchant.id}/${merchant.qrToken}?serviceId=${service.id}`,
            serviceBookingUrl: `${req.protocol}://${req.get('host')}/booking/${merchant.id}/${merchant.qrToken}?serviceId=${service.id}`,
            merchantLocation: merchant.location,
            merchantCategory: merchant.category
        }));
    });

    res.render('services', {
        title: 'Services',
        merchants: Merchant.getAll(search),
        favouriteIds,
        serviceCatalog,
        search
    });
});

app.get('/products', (req, res) => {
    res.render('products', {
        title: 'Products',
        products: Product.getAll()
    });
});

app.get('/payment', merchantController.showPayment);
app.post('/payment', merchantController.confirmPayment);

app.get('/cashback', (req, res) => {
    res.render('cashback', { title: 'Cashback' });
});

app.get('/giftcards', (req, res) => {
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
