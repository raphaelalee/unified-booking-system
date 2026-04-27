const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const merchantController = require('./controllers/merchantController');
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

app.get('/', merchantController.showHome);
app.get('/merchants', merchantController.listMerchants);
app.get('/merchants/:id', merchantController.showMerchant);
app.post('/merchants/:id/book', merchantController.createBooking);

app.get('/about', (req, res) => {
    res.render('about', { title: 'About Vaniday' });
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
