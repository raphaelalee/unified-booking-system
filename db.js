const mysql = require('mysql2');
require('dotenv').config(); // Load variables from .env

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
};

// Create a pool (recommended for most apps)
const pool = mysql.createPool(dbConfig);
pool.vanidayDbConfig = {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    connectTimeout: dbConfig.connectTimeout
};

// Export the callback-style pool (models use callbacks)
module.exports = pool;
