const db = require('../db');

const PROMOTION_TYPES = ['first_trial', 'happy_hour', 'one_for_one', 'featured'];
const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'fixed_price', 'tag_only'];
const PROMOTION_STATUSES = ['draft', 'active', 'inactive', 'expired'];

function mapPromotion(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.promotion_id,
        promotionId: row.promotion_id,
        salonId: row.salon_id,
        salonName: row.salon_name || '',
        serviceId: row.service_id,
        serviceName: row.service_name || '',
        title: row.title,
        type: row.type,
        discountType: row.discount_type,
        discountValue: row.discount_value === null || row.discount_value === undefined ? null : Number(row.discount_value),
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        description: row.description || '',
        terms: row.terms || ''
    };
}

function getAll(callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.status,
            promotions.description,
            promotions.terms,
            services.service_name,
            salons.salon_name
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        ORDER BY promotions.type, promotions.start_date DESC, promotions.promotion_id DESC
    `;

    db.query(sql, (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, (rows || []).map(mapPromotion));
    });
}

function getActivePublic(callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.status,
            promotions.description,
            promotions.terms,
            salons.salon_name,
            salons.address,
            salons.description AS salon_description
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        WHERE promotions.status = 'active'
            AND promotions.start_date <= NOW()
            AND promotions.end_date >= NOW()
        ORDER BY promotions.type, promotions.start_date DESC, promotions.promotion_id DESC
    `;

    db.query(sql, (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, (rows || []).map((row) => ({
            ...mapPromotion(row),
            address: row.address || '',
            salonDescription: row.salon_description || ''
        })));
    });
}

function getByMerchantUserId(userId, callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.status,
            promotions.description,
            promotions.terms,
            services.service_name
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        WHERE salons.merchant_id = ?
        ORDER BY promotions.start_date DESC, promotions.promotion_id DESC
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, (rows || []).map(mapPromotion));
    });
}

function findById(promotionId, callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.status,
            promotions.description,
            promotions.terms,
            services.service_name,
            salons.salon_name
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        WHERE promotions.promotion_id = ?
        LIMIT 1
    `;

    db.query(sql, [promotionId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapPromotion(rows[0]));
    });
}

function findForMerchant(userId, promotionId, callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.status,
            promotions.description,
            promotions.terms,
            services.service_name
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        WHERE salons.merchant_id = ?
            AND promotions.promotion_id = ?
        LIMIT 1
    `;

    db.query(sql, [userId, promotionId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapPromotion(rows[0]));
    });
}

function createForMerchant(userId, promotion, callback) {
    const sql = `
        INSERT INTO promotions (
            salon_id,
            service_id,
            title,
            type,
            discount_type,
            discount_value,
            start_date,
            end_date,
            status,
            description,
            terms
        )
        SELECT
            salons.salon_id,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        FROM salons
        WHERE salons.merchant_id = ?
        LIMIT 1
    `;

    const params = [
        promotion.serviceId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.status,
        promotion.description,
        promotion.terms,
        userId
    ];

    db.query(sql, params, callback);
}

function createAsAdmin(promotion, callback) {
    const sql = `
        INSERT INTO promotions (
            salon_id,
            service_id,
            title,
            type,
            discount_type,
            discount_value,
            start_date,
            end_date,
            status,
            description,
            terms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        promotion.salonId,
        promotion.serviceId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.status,
        promotion.description,
        promotion.terms
    ];

    db.query(sql, params, callback);
}

function updateForMerchant(userId, promotionId, promotion, callback) {
    const sql = `
        UPDATE promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        SET
            promotions.service_id = ?,
            promotions.title = ?,
            promotions.type = ?,
            promotions.discount_type = ?,
            promotions.discount_value = ?,
            promotions.start_date = ?,
            promotions.end_date = ?,
            promotions.status = ?,
            promotions.description = ?,
            promotions.terms = ?
        WHERE promotions.promotion_id = ?
            AND salons.merchant_id = ?
    `;

    const params = [
        promotion.serviceId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.status,
        promotion.description,
        promotion.terms,
        promotionId,
        userId
    ];

    db.query(sql, params, callback);
}

function updateAsAdmin(promotionId, promotion, callback) {
    const sql = `
        UPDATE promotions
        SET
            salon_id = ?,
            service_id = ?,
            title = ?,
            type = ?,
            discount_type = ?,
            discount_value = ?,
            start_date = ?,
            end_date = ?,
            status = ?,
            description = ?,
            terms = ?
        WHERE promotion_id = ?
    `;

    const params = [
        promotion.salonId,
        promotion.serviceId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.status,
        promotion.description,
        promotion.terms,
        promotionId
    ];

    db.query(sql, params, callback);
}

function deleteForMerchant(userId, promotionId, callback) {
    const sql = `
        DELETE promotions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        WHERE promotions.promotion_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [promotionId, userId], callback);
}

function deleteAsAdmin(promotionId, callback) {
    db.query('DELETE FROM promotions WHERE promotion_id = ?', [promotionId], callback);
}

module.exports = {
    PROMOTION_TYPES,
    DISCOUNT_TYPES,
    PROMOTION_STATUSES,
    getAll,
    getActivePublic,
    getByMerchantUserId,
    findById,
    findForMerchant,
    createAsAdmin,
    createForMerchant,
    updateForMerchant,
    updateAsAdmin,
    deleteForMerchant,
    deleteAsAdmin
};
