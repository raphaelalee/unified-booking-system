const db = require('../db');

let reviewSchemaReady = false;
let reviewSchemaPending = false;
let reviewSchemaQueue = [];

function flushReviewSchema(error) {
    const queue = reviewSchemaQueue;
    reviewSchemaQueue = [];
    reviewSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureReviewSchema(callback) {
    if (reviewSchemaReady) {
        callback(null);
        return;
    }

    reviewSchemaQueue.push(callback);

    if (reviewSchemaPending) {
        return;
    }

    reviewSchemaPending = true;

    const sql = `
        CREATE TABLE IF NOT EXISTS reviews (
            review_id INT NOT NULL AUTO_INCREMENT,
            booking_id INT NOT NULL,
            user_id INT NOT NULL,
            merchant_id INT NOT NULL,
            service_id INT NOT NULL,
            rating TINYINT NOT NULL,
            comment TEXT NULL,
            image_path VARCHAR(255) NULL,
            video_path VARCHAR(255) NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (review_id),
            UNIQUE KEY uq_reviews_booking (booking_id),
            KEY idx_reviews_merchant_created (merchant_id, created_at),
            KEY idx_reviews_user_created (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (error) {
            flushReviewSchema(error);
            return;
        }

        db.query('SHOW COLUMNS FROM reviews', (columnError, rows = []) => {
            if (columnError) {
                flushReviewSchema(columnError);
                return;
            }

            const fields = new Set(rows.map((row) => row.Field));
            const alters = [];

            if (!fields.has('image_path')) {
                alters.push('ADD COLUMN image_path VARCHAR(255) NULL AFTER comment');
            }

            if (!fields.has('video_path')) {
                alters.push('ADD COLUMN video_path VARCHAR(255) NULL AFTER image_path');
            }

            if (!alters.length) {
                reviewSchemaReady = true;
                flushReviewSchema(null);
                return;
            }

            db.query(`ALTER TABLE reviews ${alters.join(', ')}`, (alterError) => {
                if (!alterError) {
                    reviewSchemaReady = true;
                }

                flushReviewSchema(alterError);
            });
        });
    });
}

function mapRow(row = {}) {
    return {
        id: row.id,
        bookingId: row.booking_id,
        userId: row.user_id,
        merchantId: row.merchant_id,
        serviceId: row.service_id,
        merchantName: row.merchant_name,
        customerName: row.customer_name,
        serviceName: row.service_name,
        rating: Number(row.rating || 0),
        comment: row.comment || '',
        imagePath: row.image_path || '',
        videoPath: row.video_path || '',
        createdAt: row.created_at
    };
}

function create(data, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO reviews
                (booking_id, user_id, merchant_id, service_id, rating, comment, image_path, video_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            data.bookingId,
            data.userId,
            data.merchantId,
            data.serviceId,
            data.rating,
            data.comment || null,
            data.imagePath || null,
            data.videoPath || null
        ], callback);
    });
}

function findByBookingId(bookingId, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `SELECT review_id AS id, booking_id, user_id, merchant_id, service_id, rating, comment, image_path, video_path, created_at FROM reviews WHERE booking_id = ? LIMIT 1`,
            [bookingId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, rows[0] ? mapRow(rows[0]) : null);
            }
        );
    });
}

function getByBookingIds(bookingIds, callback) {
    const ids = Array.isArray(bookingIds)
        ? bookingIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [];

    if (!ids.length) {
        callback(null, []);
        return;
    }

    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const placeholders = ids.map(() => '?').join(', ');
        const sql = `
            SELECT review_id AS id, booking_id, user_id, merchant_id, service_id, rating, comment, image_path, video_path, created_at
            FROM reviews
            WHERE booking_id IN (${placeholders})
        `;

        db.query(sql, ids, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapRow));
        });
    });
}

function getSummaryByMerchantId(merchantId, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `
                SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 1) AS average_rating
                FROM reviews
                WHERE merchant_id = ?
            `,
            [merchantId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                const row = rows[0] || {};
                callback(null, {
                    reviewCount: Number(row.review_count || 0),
                    averageRating: row.average_rating === null ? null : Number(row.average_rating)
                });
            }
        );
    });
}

function listByMerchantId(merchantId, limit, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const rowLimit = Math.max(1, Math.min(Number(limit) || 6, 20));
        const sql = `
            SELECT
                reviews.review_id AS id,
                reviews.booking_id,
                reviews.user_id,
                reviews.merchant_id,
                reviews.service_id,
                reviews.rating,
                reviews.comment,
                reviews.image_path,
                reviews.video_path,
                reviews.created_at,
                users.name AS customer_name,
                services.service_name
            FROM reviews
            INNER JOIN users ON users.user_id = reviews.user_id
            INNER JOIN services ON services.service_id = reviews.service_id
            WHERE reviews.merchant_id = ?
            ORDER BY reviews.created_at DESC
            LIMIT ${rowLimit}
        `;

        db.query(sql, [merchantId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapRow));
        });
    });
}

function getPlatformSummary(callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                COUNT(*) AS review_count,
                ROUND(AVG(rating), 1) AS average_rating,
                SUM(CASE WHEN image_path IS NOT NULL OR video_path IS NOT NULL THEN 1 ELSE 0 END) AS media_review_count,
                COUNT(DISTINCT merchant_id) AS merchant_count
            FROM reviews
        `;

        db.query(sql, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            const row = rows[0] || {};
            callback(null, {
                reviewCount: Number(row.review_count || 0),
                averageRating: row.average_rating === null ? null : Number(row.average_rating),
                mediaReviewCount: Number(row.media_review_count || 0),
                merchantCount: Number(row.merchant_count || 0)
            });
        });
    });
}

function getMerchantLeaderboard(limit, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const rowLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
        const sql = `
            SELECT
                reviews.merchant_id,
                salons.salon_name AS merchant_name,
                COUNT(*) AS review_count,
                ROUND(AVG(reviews.rating), 1) AS average_rating,
                SUM(CASE WHEN reviews.image_path IS NOT NULL OR reviews.video_path IS NOT NULL THEN 1 ELSE 0 END) AS media_review_count
            FROM reviews
            LEFT JOIN salons ON salons.salon_id = reviews.merchant_id
            GROUP BY reviews.merchant_id, salons.salon_name
            ORDER BY average_rating DESC, review_count DESC, merchant_name ASC
            LIMIT ${rowLimit}
        `;

        db.query(sql, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => ({
                merchantId: row.merchant_id,
                merchantName: row.merchant_name || 'Merchant',
                reviewCount: Number(row.review_count || 0),
                averageRating: row.average_rating === null ? null : Number(row.average_rating),
                mediaReviewCount: Number(row.media_review_count || 0)
            })));
        });
    });
}

function listAll(limit, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const rowLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
        const sql = `
            SELECT
                reviews.review_id AS id,
                reviews.booking_id,
                reviews.user_id,
                reviews.merchant_id,
                reviews.service_id,
                reviews.rating,
                reviews.comment,
                reviews.image_path,
                reviews.video_path,
                reviews.created_at,
                users.name AS customer_name,
                services.service_name,
                salons.salon_name AS merchant_name
            FROM reviews
            INNER JOIN users ON users.user_id = reviews.user_id
            INNER JOIN services ON services.service_id = reviews.service_id
            LEFT JOIN salons ON salons.salon_id = reviews.merchant_id
            ORDER BY reviews.created_at DESC
            LIMIT ${rowLimit}
        `;

        db.query(sql, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapRow));
        });
    });
}

module.exports = {
    create,
    findByBookingId,
    getByBookingIds,
    getSummaryByMerchantId,
    listByMerchantId,
    getPlatformSummary,
    getMerchantLeaderboard,
    listAll
};
