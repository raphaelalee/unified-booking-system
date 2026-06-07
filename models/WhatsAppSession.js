const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) return callback(null);

    db.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_conversation_sessions (
            phone VARCHAR(30) NOT NULL,
            session_json LONGTEXT NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (phone),
            KEY idx_whatsapp_conversation_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, (error) => {
        if (!error) schemaReady = true;
        callback(error);
    });
}

function load(phone, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query(
            `SELECT session_json
             FROM whatsapp_conversation_sessions
             WHERE phone = ? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE)
             LIMIT 1`,
            [phone],
            (error, rows = []) => {
                if (error) return callback(error);
                try {
                    callback(null, rows.length ? JSON.parse(rows[0].session_json || '{}') : null);
                } catch (parseError) {
                    callback(parseError);
                }
            }
        );
    });
}

function save(phone, session, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query(`
            INSERT INTO whatsapp_conversation_sessions (phone, session_json)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE session_json = VALUES(session_json)
        `, [phone, JSON.stringify(session || {})], callback);
    });
}

function remove(phone, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query('DELETE FROM whatsapp_conversation_sessions WHERE phone = ?', [phone], callback);
    });
}

module.exports = { load, remove, save };
