const db = require('../db');

function create(user, callback) {
    const sql = `
        INSERT INTO users (name, email, password, role)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [
        user.name,
        user.email,
        user.password,
        user.role || 'customer'
    ], callback);
}

function findByEmail(email, callback) {
    const sql = `
        SELECT user_id, name, email, password, role, glints_balance, created_at
        FROM users
        WHERE email = ?
        LIMIT 1
    `;

    db.query(sql, [email], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results[0] || null);
    });
}

function updateProfile(userId, profile, callback) {
    const sql = `
        UPDATE users
        SET name = ?, email = ?
        WHERE user_id = ?
    `;

    db.query(sql, [profile.name, profile.email, userId], callback);
}

module.exports = {
    create,
    findByEmail,
    updateProfile
};
