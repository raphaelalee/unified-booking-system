const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();

const merchants = [
    {
        id: 1,
        name: 'Vaniday Beauty Studio',
        category: 'Beauty & Wellness',
        location: 'Orchard',
        rating: '4.8',
        promotion: '20% off first booking',
        description: 'Hair styling, facials, and beauty treatments from trusted Vaniday merchants.',
        services: [
            { id: 101, name: 'Hair Cut & Styling', duration: '60 mins', price: 45, slots: ['10:00 AM', '2:00 PM', '5:00 PM'] },
            { id: 102, name: 'Express Facial', duration: '45 mins', price: 55, slots: ['11:00 AM', '3:30 PM'] },
            { id: 103, name: 'Manicure', duration: '40 mins', price: 35, slots: ['12:00 PM', '4:00 PM'] }
        ]
    },
    {
        id: 2,
        name: 'FreshGlow Spa',
        category: 'Spa',
        location: 'Tampines',
        rating: '4.6',
        promotion: 'Free add-on massage for bookings above $80',
        description: 'Relaxing spa services with simple online booking and clear appointment slots.',
        services: [
            { id: 201, name: 'Aromatherapy Massage', duration: '90 mins', price: 98, slots: ['9:30 AM', '1:00 PM', '6:00 PM'] },
            { id: 202, name: 'Body Scrub', duration: '60 mins', price: 72, slots: ['10:30 AM', '4:30 PM'] }
        ]
    },
    {
        id: 3,
        name: 'Urban Groom Barbers',
        category: 'Barber',
        location: 'Woodlands',
        rating: '4.7',
        promotion: '$5 student discount',
        description: 'Fast grooming services for walk-in style retail merchants using digital booking.',
        services: [
            { id: 301, name: 'Classic Haircut', duration: '30 mins', price: 28, slots: ['10:00 AM', '1:30 PM', '7:00 PM'] },
            { id: 302, name: 'Beard Trim', duration: '20 mins', price: 18, slots: ['11:30 AM', '3:00 PM'] }
        ]
    }
];

function findMerchant(id) {
    return merchants.find((merchant) => merchant.id === Number(id));
}

function findService(merchant, serviceId) {
    return merchant.services.find((service) => service.id === Number(serviceId));
}

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

app.get('/', (req, res) => {
    res.render('home', {
        title: 'Vaniday',
        merchants,
        success: req.session.success
    });
    req.session.success = null;
});

app.get('/merchants', (req, res) => {
    const search = (req.query.search || '').trim().toLowerCase();
    const filteredMerchants = merchants.filter((merchant) => {
        return !search
            || merchant.name.toLowerCase().includes(search)
            || merchant.category.toLowerCase().includes(search)
            || merchant.location.toLowerCase().includes(search);
    });

    res.render('merchants', {
        title: 'Merchants',
        merchants: filteredMerchants,
        search: req.query.search || ''
    });
});

app.get('/merchants/:id', (req, res) => {
    const merchant = findMerchant(req.params.id);

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be found.'
        });
    }

    return res.render('merchant-detail', {
        title: merchant.name,
        merchant,
        errors: [],
        form: {}
    });
});

app.post('/merchants/:id/book', (req, res) => {
    const merchant = findMerchant(req.params.id);

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be found.'
        });
    }

    const { customerName, email, serviceId, bookingDate, bookingTime } = req.body;
    const service = findService(merchant, serviceId);
    const errors = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = bookingDate ? new Date(bookingDate) : null;

    if (!customerName || customerName.trim().length < 2) {
        errors.push('Please enter your full name.');
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Please enter a valid email address.');
    }

    if (!service) {
        errors.push('Please select a valid service.');
    }

    if (!bookingDate || Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
        errors.push('Please choose today or a future booking date.');
    }

    if (!bookingTime || !service || !service.slots.includes(bookingTime)) {
        errors.push('Please select an available time slot.');
    }

    if (errors.length > 0) {
        return res.status(400).render('merchant-detail', {
            title: merchant.name,
            merchant,
            errors,
            form: req.body
        });
    }

    req.session.success = `Booking request received for ${service.name} at ${merchant.name} on ${bookingDate}, ${bookingTime}.`;
    return res.redirect('/');
});

app.get('/about', (req, res) => {
    res.render('about', { title: 'About Vaniday' });
});

app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
