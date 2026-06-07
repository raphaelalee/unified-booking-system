const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    db.query(`
        CREATE TABLE IF NOT EXISTS customer_carts (
            user_id INT NOT NULL,
            cart_json LONGTEXT NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id),
            CONSTRAINT fk_customer_carts_user
                FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, (error) => {
        if (!error) schemaReady = true;
        callback(error);
    });
}

function load(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query('SELECT cart_json FROM customer_carts WHERE user_id = ? LIMIT 1', [userId], (error, rows = []) => {
            if (error) return callback(error);

            try {
                callback(null, rows.length ? JSON.parse(rows[0].cart_json || '[]') : []);
            } catch (parseError) {
                callback(parseError);
            }
        });
    });
}

function save(userId, cart, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(`
            INSERT INTO customer_carts (user_id, cart_json)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE cart_json = VALUES(cart_json)
        `, [userId, JSON.stringify(Array.isArray(cart) ? cart : [])], callback);
    });
}

module.exports = { load, save };
