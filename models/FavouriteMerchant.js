const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    const sql = `
        CREATE TABLE IF NOT EXISTS favourite_merchants (
            user_id INT NOT NULL,
            merchant_id INT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, merchant_id),
            KEY idx_favourite_merchants_merchant (merchant_id),
            CONSTRAINT fk_favourite_merchants_user
                FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
            CONSTRAINT fk_favourite_merchants_merchant
                FOREIGN KEY (merchant_id) REFERENCES salons (salon_id) ON DELETE CASCADE
        )
    `;

    db.query(sql, (error) => {
        if (!error) {
            schemaReady = true;
        }

        callback(error);
    });
}

function getMerchantIds(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            'SELECT merchant_id FROM favourite_merchants WHERE user_id = ? ORDER BY created_at DESC',
            [userId],
            (error, rows = []) => {
                callback(error, rows.map((row) => Number(row.merchant_id)));
            }
        );
    });
}

function toggle(userId, merchantId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            'SELECT 1 FROM favourite_merchants WHERE user_id = ? AND merchant_id = ? LIMIT 1',
            [userId, merchantId],
            (lookupError, rows = []) => {
                if (lookupError) {
                    callback(lookupError);
                    return;
                }

                if (rows.length > 0) {
                    db.query(
                        'DELETE FROM favourite_merchants WHERE user_id = ? AND merchant_id = ?',
                        [userId, merchantId],
                        (deleteError) => callback(deleteError, false)
                    );
                    return;
                }

                db.query(
                    'INSERT INTO favourite_merchants (user_id, merchant_id) VALUES (?, ?)',
                    [userId, merchantId],
                    (insertError) => callback(insertError, true)
                );
            }
        );
    });
}

module.exports = {
    getMerchantIds,
    toggle
};
