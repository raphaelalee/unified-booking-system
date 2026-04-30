const mysql = require('mysql2');
require('dotenv').config(); // Load variables from .env

// Create a pool (recommended for most apps)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vaniday_booking_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Export the callback-style pool (models use callbacks)
module.exports = pool;
