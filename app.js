const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const merchantController = require('./controllers/merchantController');
const Merchant = require('./models/Merchant');
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
app.get('/profile', merchantController.showProfile);
app.post('/profile', merchantController.updateProfile);
app.get('/login', merchantController.showLogin);
app.post('/login', merchantController.loginUser);
app.get('/signup', merchantController.showSignup);
app.post('/signup', merchantController.signupUser);
app.post('/logout', merchantController.logoutUser);
app.get('/cart', merchantController.showCart);
app.post('/cart/add/:merchantId', merchantController.addToCart);
app.post('/cart/remove/:itemId', merchantController.removeFromCart);
app.post('/merchants/:merchantId/favourite', merchantController.toggleFavouriteMerchant);
app.get('/merchants/:merchantId/qr', merchantController.showMerchantQr);
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
    const favouriteIds = req.session.favouriteMerchantIds || [];

    res.render('services', {
        title: 'Services',
        merchants: Merchant.getAll(),
        favouriteIds
    });
});

app.get('/products', (req, res) => {
    res.render('products', { title: 'Products' });
});

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
