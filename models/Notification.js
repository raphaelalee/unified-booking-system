const db = require('../db');

let schemaReady = false;
let schemaPending = false;
let schemaQueue = [];

function flushSchemaQueue(error) {
    const queue = schemaQueue;
    schemaQueue = [];
    schemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    schemaQueue.push(callback);

    if (schemaPending) {
        return;
    }

    schemaPending = true;

    const sql = `
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id INT NOT NULL AUTO_INCREMENT,
            recipient_user_id INT NOT NULL,
            recipient_role VARCHAR(20) NOT NULL,
            actor_user_id INT DEFAULT NULL,
            notification_type VARCHAR(80) NOT NULL DEFAULT 'general',
            title VARCHAR(180) NOT NULL,
            message TEXT NOT NULL,
            link_url VARCHAR(255) DEFAULT NULL,
            status ENUM('unread','read') NOT NULL DEFAULT 'unread',
            dedupe_key VARCHAR(180) DEFAULT NULL,
            metadata TEXT,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            read_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (notification_id),
            UNIQUE KEY uq_notifications_dedupe_key (dedupe_key),
            KEY idx_notifications_user_status (recipient_user_id, status, created_at),
            KEY idx_notifications_role (recipient_role, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (!error) {
            schemaReady = true;
        }

        flushSchemaQueue(error);
    });
}

function serializeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    try {
        return JSON.stringify(metadata);
    } catch (error) {
        return null;
    }
}

function normalizeNotification(notification = {}) {
    return {
        recipientUserId: Number(notification.recipientUserId || notification.recipient_user_id),
        recipientRole: String(notification.recipientRole || notification.recipient_role || 'customer').trim(),
        actorUserId: notification.actorUserId || notification.actor_user_id || null,
        type: String(notification.type || notification.notificationType || notification.notification_type || 'general').trim(),
        title: String(notification.title || 'Notification').trim().slice(0, 180),
        message: String(notification.message || '').trim(),
        linkUrl: String(notification.linkUrl || notification.link_url || '/notifications').trim().slice(0, 255),
        dedupeKey: notification.dedupeKey || notification.dedupe_key || null,
        metadata: serializeMetadata(notification.metadata)
    };
}

function create(notification, callback = () => {}) {
    const payload = normalizeNotification(notification);

    if (!payload.recipientUserId || !payload.recipientRole || !payload.message) {
        callback(null, null);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT IGNORE INTO notifications
                (recipient_user_id, recipient_role, actor_user_id, notification_type, title, message, link_url, dedupe_key, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            payload.recipientUserId,
            payload.recipientRole,
            payload.actorUserId,
            payload.type,
            payload.title,
            payload.message,
            payload.linkUrl || '/notifications',
            payload.dedupeKey,
            payload.metadata
        ], callback);
    });
}

function createMany(notifications = [], callback = () => {}) {
    const items = notifications.filter(Boolean);

    if (items.length === 0) {
        callback(null, []);
        return;
    }

    let remaining = items.length;
    const results = [];
    let firstError = null;

    items.forEach((notification, index) => {
        create(notification, (error, result) => {
            if (error && !firstError) {
                firstError = error;
            }

            results[index] = result || null;
            remaining -= 1;

            if (remaining === 0) {
                callback(firstError, results);
            }
        });
    });
}

function createForRole(role, notification, callback = () => {}) {
    const roleValue = String(role || '').trim();

    if (!roleValue) {
        callback(null, []);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            'SELECT user_id, role FROM users WHERE role = ? ORDER BY user_id DESC',
            [roleValue],
            (userError, users = []) => {
                if (userError) {
                    callback(userError);
                    return;
                }

                const notifications = users.map((user) => ({
                    ...notification,
                    recipientUserId: user.user_id,
                    recipientRole: user.role || roleValue,
                    dedupeKey: notification.dedupeKey
                        ? `${notification.dedupeKey}-${user.user_id}`
                        : null
                }));

                createMany(notifications, callback);
            }
        );
    });
}

function countUnread(userId, callback) {
    if (!userId) {
        callback(null, 0);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `SELECT COUNT(*) AS unread_count
             FROM notifications
             WHERE recipient_user_id = ? AND status = 'unread'`,
            [userId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, Number(rows[0]?.unread_count || 0));
            }
        );
    });
}

function getForUser(user, callback) {
    if (!user?.id) {
        callback(null, []);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                notification_id AS id,
                recipient_user_id AS recipientUserId,
                recipient_role AS recipientRole,
                actor_user_id AS actorUserId,
                notification_type AS type,
                title,
                message,
                link_url AS linkUrl,
                status,
                metadata,
                created_at AS createdAt,
                read_at AS readAt
            FROM notifications
            WHERE recipient_user_id = ?
            ORDER BY
                CASE status WHEN 'unread' THEN 0 ELSE 1 END,
                created_at DESC,
                notification_id DESC
            LIMIT 80
        `;

        db.query(sql, [user.id], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows);
        });
    });
}

function getOneForUser(userId, notificationId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `SELECT notification_id AS id, link_url AS linkUrl
             FROM notifications
             WHERE notification_id = ? AND recipient_user_id = ?
             LIMIT 1`,
            [notificationId, userId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, rows[0] || null);
            }
        );
    });
}

function markRead(userId, notificationId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `UPDATE notifications
             SET status = 'read', read_at = CURRENT_TIMESTAMP
             WHERE notification_id = ? AND recipient_user_id = ?`,
            [notificationId, userId],
            callback
        );
    });
}

function markAllRead(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `UPDATE notifications
             SET status = 'read', read_at = CURRENT_TIMESTAMP
             WHERE recipient_user_id = ? AND status = 'unread'`,
            [userId],
            callback
        );
    });
}

module.exports = {
    create,
    createMany,
    createForRole,
    countUnread,
    getForUser,
    getOneForUser,
    markRead,
    markAllRead
};
