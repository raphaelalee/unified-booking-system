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
            review_type VARCHAR(20) NOT NULL DEFAULT 'service',
            booking_id INT NULL,
            receipt_id VARCHAR(64) NULL,
            user_id INT NOT NULL,
            merchant_id INT NOT NULL,
            service_id INT NULL,
            product_id INT NULL,
            rating TINYINT NOT NULL,
            comment TEXT NULL,
            image_path VARCHAR(255) NULL,
            video_path VARCHAR(255) NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (review_id),
            UNIQUE KEY uq_reviews_booking (booking_id),
            UNIQUE KEY uq_reviews_receipt_product (receipt_id, product_id),
            KEY idx_reviews_merchant_created (merchant_id, created_at),
            KEY idx_reviews_user_created (user_id, created_at),
            KEY idx_reviews_product_created (product_id, created_at)
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
            const bookingColumn = rows.find((row) => row.Field === 'booking_id');
            const serviceColumn = rows.find((row) => row.Field === 'service_id');

            if (!fields.has('image_path')) {
                alters.push('ADD COLUMN image_path VARCHAR(255) NULL AFTER comment');
            }

            if (!fields.has('video_path')) {
                alters.push('ADD COLUMN video_path VARCHAR(255) NULL AFTER image_path');
            }

            if (!fields.has('review_type')) {
                alters.push("ADD COLUMN review_type VARCHAR(20) NOT NULL DEFAULT 'service' AFTER review_id");
            }

            if (!fields.has('receipt_id')) {
                alters.push('ADD COLUMN receipt_id VARCHAR(64) NULL AFTER booking_id');
            }

            if (!fields.has('product_id')) {
                alters.push('ADD COLUMN product_id INT NULL AFTER service_id');
            }

            if (!fields.has('merchant_reply')) {
                alters.push('ADD COLUMN merchant_reply TEXT NULL AFTER video_path');
            }

            if (!fields.has('merchant_reply_at')) {
                alters.push('ADD COLUMN merchant_reply_at DATETIME NULL AFTER merchant_reply');
            }

            if (bookingColumn && String(bookingColumn.Null).toUpperCase() !== 'YES') {
                alters.push('MODIFY COLUMN booking_id INT NULL');
            }

            if (serviceColumn && String(serviceColumn.Null).toUpperCase() !== 'YES') {
                alters.push('MODIFY COLUMN service_id INT NULL');
            }

            const runIndexCheck = (alterError) => {
                if (alterError) {
                    flushReviewSchema(alterError);
                    return;
                }

                db.query('SHOW INDEX FROM reviews', (indexError, indexes = []) => {
                    if (indexError) {
                        flushReviewSchema(indexError);
                        return;
                    }

                    const indexNames = new Set(indexes.map((row) => row.Key_name));
                    const indexAlters = [];

                    if (!indexNames.has('uq_reviews_receipt_product')) {
                        indexAlters.push('ADD UNIQUE KEY uq_reviews_receipt_product (receipt_id, product_id)');
                    }

                    if (!indexNames.has('idx_reviews_product_created')) {
                        indexAlters.push('ADD KEY idx_reviews_product_created (product_id, created_at)');
                    }

                    if (!indexAlters.length) {
                        reviewSchemaReady = true;
                        flushReviewSchema(null);
                        return;
                    }

                    db.query(`ALTER TABLE reviews ${indexAlters.join(', ')}`, (indexAlterError) => {
                        if (!indexAlterError) {
                            reviewSchemaReady = true;
                        }

                        flushReviewSchema(indexAlterError);
                    });
                });
            };

            if (!alters.length) {
                runIndexCheck(null);
                return;
            }

            db.query(`ALTER TABLE reviews ${alters.join(', ')}`, (alterError) => {
                runIndexCheck(alterError);
            });
        });
    });
}

function mapRow(row = {}) {
    return {
        id: row.id,
        reviewType: row.review_type || 'service',
        bookingId: row.booking_id,
        receiptId: row.receipt_id || '',
        userId: row.user_id,
        merchantId: row.merchant_id,
        serviceId: row.service_id,
        productId: row.product_id,
        merchantName: row.merchant_name,
        customerName: row.customer_name,
        serviceName: row.service_name || row.product_name,
        productName: row.product_name || '',
        itemName: row.service_name || row.product_name || '',
        rating: Number(row.rating || 0),
        comment: row.comment || '',
        imagePath: row.image_path || '',
        videoPath: row.video_path || '',
        merchantReply: row.merchant_reply || '',
        merchantReplyAt: row.merchant_reply_at || null,
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
                (review_type, booking_id, receipt_id, user_id, merchant_id, service_id, product_id, rating, comment, image_path, video_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            data.reviewType || 'service',
            data.bookingId || null,
            data.receiptId || null,
            data.userId,
            data.merchantId,
            data.serviceId || null,
            data.productId || null,
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
            `SELECT review_id AS id, review_type, booking_id, receipt_id, user_id, merchant_id, service_id, product_id, rating, comment, image_path, video_path, merchant_reply, merchant_reply_at, created_at FROM reviews WHERE review_type = 'service' AND booking_id = ? LIMIT 1`,
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

function findByReceiptAndProduct(receiptId, productId, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `SELECT review_id AS id, review_type, booking_id, receipt_id, user_id, merchant_id, service_id, product_id, rating, comment, image_path, video_path, merchant_reply, merchant_reply_at, created_at
             FROM reviews
             WHERE review_type = 'product' AND receipt_id = ? AND product_id = ?
             LIMIT 1`,
            [String(receiptId), Number(productId)],
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
            SELECT review_id AS id, review_type, booking_id, receipt_id, user_id, merchant_id, service_id, product_id, rating, comment, image_path, video_path, merchant_reply, merchant_reply_at, created_at
            FROM reviews
            WHERE review_type = 'service' AND booking_id IN (${placeholders})
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

function getByReceiptIds(receiptIds, callback) {
    const ids = Array.isArray(receiptIds)
        ? receiptIds.map((value) => String(value || '').trim()).filter(Boolean)
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
            SELECT review_id AS id, review_type, booking_id, receipt_id, user_id, merchant_id, service_id, product_id, rating, comment, image_path, video_path, merchant_reply, merchant_reply_at, created_at
            FROM reviews
            WHERE review_type = 'product' AND receipt_id IN (${placeholders})
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

function findByIdForMerchant(reviewId, merchantId, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                reviews.review_id AS id,
                reviews.review_type,
                reviews.booking_id,
                reviews.receipt_id,
                reviews.user_id,
                reviews.merchant_id,
                reviews.service_id,
                reviews.product_id,
                reviews.rating,
                reviews.comment,
                reviews.image_path,
                reviews.video_path,
                reviews.merchant_reply,
                reviews.merchant_reply_at,
                reviews.created_at,
                users.name AS customer_name,
                services.service_name,
                products.name AS product_name,
                salons.salon_name AS merchant_name,
                salons.business_category AS merchant_category
            FROM reviews
            INNER JOIN users ON users.user_id = reviews.user_id
            LEFT JOIN services ON services.service_id = reviews.service_id
            LEFT JOIN products ON products.product_id = reviews.product_id
            LEFT JOIN salons ON salons.salon_id = reviews.merchant_id
            WHERE reviews.review_id = ?
                AND reviews.merchant_id = ?
            LIMIT 1
        `;

        db.query(sql, [Number(reviewId), Number(merchantId)], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] ? mapRow(rows[0]) : null);
        });
    });
}

function updateMerchantReply(reviewId, merchantId, reply, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `UPDATE reviews
             SET merchant_reply = ?, merchant_reply_at = CURRENT_TIMESTAMP
             WHERE review_id = ? AND merchant_id = ?`,
            [String(reply || '').trim(), Number(reviewId), Number(merchantId)],
            callback
        );
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
                reviews.review_type,
                reviews.booking_id,
                reviews.receipt_id,
                reviews.user_id,
                reviews.merchant_id,
                reviews.service_id,
                reviews.product_id,
                reviews.rating,
                reviews.comment,
                reviews.image_path,
                reviews.video_path,
                reviews.merchant_reply,
                reviews.merchant_reply_at,
                reviews.created_at,
                users.name AS customer_name,
                services.service_name,
                products.name AS product_name
            FROM reviews
            INNER JOIN users ON users.user_id = reviews.user_id
            LEFT JOIN services ON services.service_id = reviews.service_id
            LEFT JOIN products ON products.product_id = reviews.product_id
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

function getSummaryByProductId(productId, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `
                SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 1) AS average_rating
                FROM reviews
                WHERE review_type = 'product' AND product_id = ?
            `,
            [productId],
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

function listByProductId(productId, limit, callback) {
    ensureReviewSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const rowLimit = Math.max(1, Math.min(Number(limit) || 6, 20));
        const sql = `
            SELECT
                reviews.review_id AS id,
                reviews.review_type,
                reviews.booking_id,
                reviews.receipt_id,
                reviews.user_id,
                reviews.merchant_id,
                reviews.service_id,
                reviews.product_id,
                reviews.rating,
                reviews.comment,
                reviews.image_path,
                reviews.video_path,
                reviews.merchant_reply,
                reviews.merchant_reply_at,
                reviews.created_at,
                users.name AS customer_name,
                products.name AS product_name
            FROM reviews
            INNER JOIN users ON users.user_id = reviews.user_id
            INNER JOIN products ON products.product_id = reviews.product_id
            WHERE reviews.review_type = 'product' AND reviews.product_id = ?
            ORDER BY reviews.created_at DESC
            LIMIT ${rowLimit}
        `;

        db.query(sql, [productId], (error, rows = []) => {
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
            WHERE reviews.review_type = 'service'
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
                reviews.review_type,
                reviews.booking_id,
                reviews.receipt_id,
                reviews.user_id,
                reviews.merchant_id,
                reviews.service_id,
                reviews.product_id,
                reviews.rating,
                reviews.comment,
                reviews.image_path,
                reviews.video_path,
                reviews.merchant_reply,
                reviews.merchant_reply_at,
                reviews.created_at,
                users.name AS customer_name,
                services.service_name,
                products.name AS product_name,
                salons.salon_name AS merchant_name
            FROM reviews
            INNER JOIN users ON users.user_id = reviews.user_id
            LEFT JOIN services ON services.service_id = reviews.service_id
            LEFT JOIN products ON products.product_id = reviews.product_id
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
    findByIdForMerchant,
    findByBookingId,
    findByReceiptAndProduct,
    getByBookingIds,
    getByReceiptIds,
    getSummaryByMerchantId,
    getSummaryByProductId,
    listByMerchantId,
    listByProductId,
    getPlatformSummary,
    getMerchantLeaderboard,
    listAll,
    updateMerchantReply,
    ensureReviewSchema
};
