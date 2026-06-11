const bcrypt = require('bcrypt');
const db = require('../db');

let customerDetailsSchemaReady = false;
let customerDetailsSchemaPending = false;
let customerDetailsSchemaQueue = [];

function flushCustomerDetailsSchema(error) {
    const queue = customerDetailsSchemaQueue;
    customerDetailsSchemaQueue = [];
    customerDetailsSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureCustomerDetailsSchema(callback) {
    if (customerDetailsSchemaReady) {
        callback(null);
        return;
    }

    customerDetailsSchemaQueue.push(callback);

    if (customerDetailsSchemaPending) {
        return;
    }

    customerDetailsSchemaPending = true;

    db.query('SHOW COLUMNS FROM users', (columnError, columns = []) => {
        if (columnError) {
            flushCustomerDetailsSchema(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('age')) {
            alters.push('ADD COLUMN age INT DEFAULT NULL AFTER phone');
        }

        if (!fields.has('birthday')) {
            alters.push('ADD COLUMN birthday DATE DEFAULT NULL AFTER age');
        }

        if (!fields.has('gender')) {
            alters.push("ADD COLUMN gender ENUM('female','male','non_binary','prefer_not_to_say','other') DEFAULT NULL AFTER birthday");
        }

        if (!fields.has('postal_code')) {
            alters.push('ADD COLUMN postal_code VARCHAR(6) DEFAULT NULL AFTER gender');
        }

        if (!fields.has('preferred_contact_method')) {
            alters.push("ADD COLUMN preferred_contact_method ENUM('email','phone','whatsapp') DEFAULT NULL AFTER postal_code");
        }

        if (!fields.has('referral_code')) {
            alters.push('ADD COLUMN referral_code VARCHAR(50) DEFAULT NULL AFTER preferred_contact_method');
        }

        if (!fields.has('referred_by_code')) {
            alters.push('ADD COLUMN referred_by_code VARCHAR(50) DEFAULT NULL AFTER referral_code');
        }

        if (!fields.has('account_status')) {
            alters.push("ADD COLUMN account_status ENUM('active','terminated') DEFAULT 'active' AFTER role");
        }

        if (alters.length === 0) {
            customerDetailsSchemaReady = true;
            flushCustomerDetailsSchema(null);
            return;
        }

        db.query(`ALTER TABLE users ${alters.join(', ')}`, (alterError) => {
            if (!alterError) {
                customerDetailsSchemaReady = true;
            }

            flushCustomerDetailsSchema(alterError);
        });
    });
}

function create(user, callback) {
    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO users (name, email, phone, age, birthday, gender, postal_code, preferred_contact_method, password, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            user.name,
            user.email,
            user.phone || null,
            user.age || null,
            user.birthday || null,
            user.gender || null,
            user.postalCode || null,
            user.preferredContactMethod || null,
            user.password,
            user.role || 'customer'
        ], callback);
    });
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
    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT user_id, name, email, phone, age, birthday, gender, postal_code, preferred_contact_method, profile_image, referral_code, referred_by_code, password, role, glints_balance, account_status, created_at
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
    });
}

function findById(userId, callback) {
    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT user_id, name, email, phone, age, birthday, gender, postal_code, preferred_contact_method, profile_image, referral_code, referred_by_code, password, role, glints_balance, account_status, created_at
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
    });
}

function findCustomerByPhone(phone, callback) {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    const localPhone = digits.startsWith('65') && digits.length === 10
        ? digits.slice(2)
        : digits;
    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT user_id, name, email, phone, age, birthday, gender, postal_code, preferred_contact_method, profile_image, referral_code, referred_by_code, password, role, glints_balance, account_status, created_at
            FROM users
            WHERE role = 'customer'
                AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') IN (?, ?)
            LIMIT 1
        `;

        db.query(sql, [digits, localPhone], (error, results) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, results[0] || null);
        });
    });
}

function findByRole(role, callback) {
    const sql = `
        SELECT user_id, name, email, phone, role
        FROM users
        WHERE role = ?
        ORDER BY created_at DESC, user_id DESC
    `;

    db.query(sql, [role], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results || []);
    });
}

function updateProfile(userId, profile, callback) {
    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE users
            SET name = ?, email = ?, phone = ?, age = ?, birthday = ?, gender = ?, postal_code = ?, preferred_contact_method = ?, profile_image = ?
            WHERE user_id = ?
        `;

        db.query(sql, [
            profile.name,
            profile.email,
            profile.phone || null,
            profile.age || null,
            profile.birthday || null,
            profile.gender || null,
            profile.postalCode || null,
            profile.preferredContactMethod || null,
            profile.profileImage || null,
            userId
        ], callback);
    });
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
            SELECT user_id, name, email, phone, age, birthday, gender, postal_code, preferred_contact_method, glints_balance, created_at
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

function getAllUsers(callback) {
    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT user_id, name, email, phone, age, birthday, gender, postal_code, preferred_contact_method, role, glints_balance, account_status, created_at
            FROM users
            ORDER BY created_at DESC, user_id DESC
        `;

        db.query(sql, (error, results) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, results || []);
        });
    });
}

function terminateById(userId, callback) {
    const terminatedEmail = `terminated+${userId}@vaniday.disabled`;
    const terminatedPassword = bcrypt.hashSync(`${Date.now()}-${Math.random()}`, 10);
    const sql = `
        UPDATE users
        SET account_status = 'terminated', email = ?, password = ?, phone = NULL, preferred_contact_method = NULL
        WHERE user_id = ? AND role != 'admin'
    `;

    return ensureCustomerDetailsSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(sql, [terminatedEmail, terminatedPassword, userId], callback);
    });
}

function deleteById(userId, callback) {
    const sql = `DELETE FROM users WHERE user_id = ? AND role != 'admin'`;
    db.query(sql, [userId], callback);
}

ensureCustomerDetailsSchema((error) => {
    if (error) {
        console.error('Customer details schema could not be prepared:', error.message || error);
    }
});

module.exports = {
    create,
    ensureCustomerDetailsSchema,
    findByReferralCode,
    findByEmail,
    findCustomerByPhone,
    findById,
    findByRole,
    getAllUsers,
    terminateById,
    deleteById,
    updateProfile,
    updatePassword,
    updateReferralCode,
    setReferredByCode,
    getReferralStats,
    getDashboardSummary
};
