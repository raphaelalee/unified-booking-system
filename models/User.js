const db = require('../db');

function create(user, callback) {
    const sql = `
        INSERT INTO users (name, email, phone, password, role)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        user.name,
        user.email,
        user.phone || null,
        user.password,
        user.role || 'customer'
    ], callback);
}

function findByReferralCode(referralCode, callback) {
    const sql = `
        SELECT user_id, referral_code
        FROM users
        WHERE referral_code = ? AND role = 'customer'
        LIMIT 1
    `;

    db.query(sql, [referralCode], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results[0] || null);
    });
}

function findByEmail(email, callback) {
    const sql = `
        SELECT user_id, name, email, phone, referral_code, password, role, glints_balance, created_at
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

function findById(userId, callback) {
    const sql = `
        SELECT user_id, name, email, phone, referral_code, password, role, glints_balance, created_at
        FROM users
        WHERE user_id = ?
        LIMIT 1
    `;

    db.query(sql, [userId], (error, results) => {
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
        SET name = ?, email = ?, phone = ?
        WHERE user_id = ?
    `;

    db.query(sql, [profile.name, profile.email, profile.phone || null, userId], callback);
}

function updatePassword(userId, passwordHash, callback) {
    const sql = `
        UPDATE users
        SET password = ?
        WHERE user_id = ?
    `;

    db.query(sql, [passwordHash, userId], callback);
}

function updateReferralCode(userId, referralCode, callback) {
    const sql = `
        UPDATE users
        SET referral_code = ?
        WHERE user_id = ? AND role = 'customer'
    `;

    db.query(sql, [referralCode, userId], callback);
}

function setReferredByCode(userId, referralCode, callback) {
    const sql = `
        UPDATE users
        SET referred_by_code = ?
        WHERE user_id = ? AND role = 'customer'
    `;

    db.query(sql, [referralCode || null, userId], (error, result) => {
        if (error && error.code === 'ER_BAD_FIELD_ERROR') {
            callback(null, result);
            return;
        }

        callback(error, result);
    });
}

function getReferralStats(referralCode, callback) {
    const sql = `
        SELECT COUNT(*) AS successful_referrals
        FROM users
        WHERE referred_by_code = ?
    `;

    db.query(sql, [referralCode], (error, rows) => {
        if (error && error.code === 'ER_BAD_FIELD_ERROR') {
            callback(null, { successfulReferrals: 0 });
            return;
        }

        if (error) {
            callback(error);
            return;
        }

        callback(null, {
            successfulReferrals: Number(rows[0]?.successful_referrals || 0)
        });
    });
}

function getDashboardSummary(callback) {
    const roleSql = `
        SELECT role, COUNT(*) AS count, COALESCE(SUM(glints_balance), 0) AS glints_total
        FROM users
        GROUP BY role
    `;

    db.query(roleSql, (roleError, roleRows) => {
        if (roleError) {
            callback(roleError);
            return;
        }

        const customerSql = `
            SELECT user_id, name, email, phone, glints_balance, created_at
            FROM users
            WHERE role = 'customer'
            ORDER BY created_at DESC
            LIMIT 6
        `;

        db.query(customerSql, (customerError, customers) => {
            if (customerError) {
                callback(customerError);
                return;
            }

            callback(null, {
                roleCounts: roleRows.reduce((counts, row) => {
                    counts[row.role] = Number(row.count || 0);
                    return counts;
                }, {}),
                totalGlints: roleRows.reduce((sum, row) => sum + Number(row.glints_total || 0), 0),
                recentCustomers: customers
            });
        });
    });
}

module.exports = {
    create,
    findByReferralCode,
    findByEmail,
    findById,
    updateProfile,
    updatePassword,
    updateReferralCode,
    setReferredByCode,
    getReferralStats,
    getDashboardSummary
};
