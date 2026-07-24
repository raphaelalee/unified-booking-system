const db = require('../db');

const PROMOTION_TYPES = ['first_trial', 'happy_hour', 'one_for_one', 'featured'];
const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'fixed_price', 'tag_only'];
const PROMOTION_STATUSES = ['draft', 'active', 'inactive', 'expired'];
const SPIN_REWARD_TYPES = ['service_discount', 'product_discount', 'promotion', 'cashback'];
const REDEMPTION_JOIN = `
    LEFT JOIN (
        SELECT
            promotion_id,
            COUNT(*) AS total_redemptions,
            SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_redemptions
        FROM promotion_redemptions
        GROUP BY promotion_id
    ) redemption_stats ON redemption_stats.promotion_id = promotions.promotion_id
`;
const SPIN_RESULTS_JOIN = `
    LEFT JOIN (
        SELECT
            reward_source_id AS promotion_id,
            COUNT(*) AS spin_win_count,
            SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS spin_claim_count
        FROM spin_results
        WHERE reward_source_type = 'promotion'
        GROUP BY reward_source_id
    ) spin_stats ON spin_stats.promotion_id = promotions.promotion_id
`;

ensurePromotionSchema((error) => {
    if (error) {
        console.error('Promotion discovery schema could not be prepared:', error.message || error);
    }
});

function ensurePromotionSchema(callback) {
    db.query('SHOW COLUMNS FROM promotions', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('product_id')) {
            alters.push('ADD COLUMN product_id INT DEFAULT NULL AFTER service_id');
        }

        if (fields.has('type')) {
            alters.push('MODIFY COLUMN type VARCHAR(80) NOT NULL');
        }

        if (!fields.has('spin_eligible')) {
            alters.push('ADD COLUMN spin_eligible TINYINT(1) NOT NULL DEFAULT 0 AFTER terms');
        }

        if (!fields.has('spin_reward_type')) {
            alters.push("ADD COLUMN spin_reward_type ENUM('service_discount','product_discount','promotion','cashback') DEFAULT NULL AFTER spin_eligible");
        } else {
            alters.push("MODIFY COLUMN spin_reward_type ENUM('service_discount','product_discount','promotion','cashback') DEFAULT NULL");
        }

        if (!fields.has('minimum_spend')) {
            alters.push('ADD COLUMN minimum_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER spin_reward_type');
        }

        if (!fields.has('usage_limit')) {
            alters.push('ADD COLUMN usage_limit INT DEFAULT NULL AFTER minimum_spend');
        }

        if (!fields.has('spin_claim_limit')) {
            alters.push('ADD COLUMN spin_claim_limit INT DEFAULT NULL AFTER usage_limit');
        }

        if (!fields.has('spin_inventory_remaining')) {
            alters.push('ADD COLUMN spin_inventory_remaining INT DEFAULT NULL AFTER spin_claim_limit');
        }

        if (!fields.has('show_in_flash_deals')) {
            alters.push('ADD COLUMN show_in_flash_deals TINYINT(1) NOT NULL DEFAULT 0 AFTER spin_inventory_remaining');
        }

        if (!alters.length) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE promotions ${alters.join(', ')}`, callback);
    });
}

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
        productId: row.product_id,
        serviceName: row.service_name || '',
        productName: row.product_name || '',
        title: row.title,
        type: row.type,
        discountType: row.discount_type,
        discountValue: row.discount_value === null || row.discount_value === undefined ? null : Number(row.discount_value),
        startDate: row.start_date,
        endDate: row.end_date,
        allowedSlots: row.allowed_slots || '',
        slotList: String(row.allowed_slots || '').split(',').map((slot) => slot.trim()).filter(Boolean),
        status: row.status,
        description: row.description || '',
        terms: row.terms || '',
        spinEligible: Boolean(Number(row.spin_eligible || 0)),
        spinRewardType: row.spin_reward_type || '',
        minimumSpend: Number(row.minimum_spend || 0),
        usageLimit: row.usage_limit === null || row.usage_limit === undefined ? null : Number(row.usage_limit),
        spinClaimLimit: row.spin_claim_limit === null || row.spin_claim_limit === undefined ? null : Number(row.spin_claim_limit),
        spinInventoryRemaining: row.spin_inventory_remaining === null || row.spin_inventory_remaining === undefined ? null : Number(row.spin_inventory_remaining),
        showInFlashDeals: Boolean(Number(row.show_in_flash_deals || 0)),
        spinWinCount: Number(row.spin_win_count || 0),
        spinClaimCount: Number(row.spin_claim_count || 0),
        redemptionCount: Number(row.used_redemptions || 0),
        totalRedemptions: Number(row.total_redemptions || 0)
    };
}

function getAll(callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.product_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.allowed_slots,
            promotions.status,
            promotions.description,
            promotions.terms,
            promotions.spin_eligible,
            promotions.spin_reward_type,
            promotions.minimum_spend,
            promotions.usage_limit,
            promotions.spin_claim_limit,
            promotions.spin_inventory_remaining,
            promotions.show_in_flash_deals,
            services.service_name,
            products.name AS product_name,
            salons.salon_name,
            COALESCE(spin_stats.spin_win_count, 0) AS spin_win_count,
            COALESCE(spin_stats.spin_claim_count, 0) AS spin_claim_count,
            COALESCE(redemption_stats.total_redemptions, 0) AS total_redemptions,
            COALESCE(redemption_stats.used_redemptions, 0) AS used_redemptions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        LEFT JOIN products ON products.product_id = promotions.product_id
        ${REDEMPTION_JOIN}
        ${SPIN_RESULTS_JOIN}
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

function getActivePublic(options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    const includeExpired = Boolean(options?.includeExpired);
    const publicDateCondition = includeExpired
        ? ''
        : `AND promotions.status = 'active'
            AND promotions.start_date <= NOW()
            AND promotions.end_date >= NOW()`;
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.product_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.allowed_slots,
            promotions.status,
            promotions.description,
            promotions.terms,
            promotions.spin_eligible,
            promotions.spin_reward_type,
            promotions.minimum_spend,
            promotions.usage_limit,
            promotions.spin_claim_limit,
            promotions.spin_inventory_remaining,
            promotions.show_in_flash_deals,
            salons.salon_name,
            salons.address,
            salons.description AS salon_description,
            services.service_name,
            products.name AS product_name,
            COALESCE(spin_stats.spin_win_count, 0) AS spin_win_count,
            COALESCE(spin_stats.spin_claim_count, 0) AS spin_claim_count,
            COALESCE(redemption_stats.total_redemptions, 0) AS total_redemptions,
            COALESCE(redemption_stats.used_redemptions, 0) AS used_redemptions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        LEFT JOIN products ON products.product_id = promotions.product_id
        ${REDEMPTION_JOIN}
        ${SPIN_RESULTS_JOIN}
        WHERE salons.approval_status = 'approved'
            ${publicDateCondition}
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
            promotions.product_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.allowed_slots,
            promotions.status,
            promotions.description,
            promotions.terms,
            promotions.spin_eligible,
            promotions.spin_reward_type,
            promotions.minimum_spend,
            promotions.usage_limit,
            promotions.spin_claim_limit,
            promotions.spin_inventory_remaining,
            promotions.show_in_flash_deals,
            services.service_name,
            products.name AS product_name,
            COALESCE(spin_stats.spin_win_count, 0) AS spin_win_count,
            COALESCE(spin_stats.spin_claim_count, 0) AS spin_claim_count,
            COALESCE(redemption_stats.total_redemptions, 0) AS total_redemptions,
            COALESCE(redemption_stats.used_redemptions, 0) AS used_redemptions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        LEFT JOIN products ON products.product_id = promotions.product_id
        ${REDEMPTION_JOIN}
        ${SPIN_RESULTS_JOIN}
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
            promotions.product_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.allowed_slots,
            promotions.status,
            promotions.description,
            promotions.terms,
            promotions.spin_eligible,
            promotions.spin_reward_type,
            promotions.minimum_spend,
            promotions.usage_limit,
            promotions.spin_claim_limit,
            promotions.spin_inventory_remaining,
            promotions.show_in_flash_deals,
            services.service_name,
            products.name AS product_name,
            salons.salon_name,
            COALESCE(spin_stats.spin_win_count, 0) AS spin_win_count,
            COALESCE(spin_stats.spin_claim_count, 0) AS spin_claim_count,
            COALESCE(redemption_stats.total_redemptions, 0) AS total_redemptions,
            COALESCE(redemption_stats.used_redemptions, 0) AS used_redemptions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        LEFT JOIN products ON products.product_id = promotions.product_id
        ${REDEMPTION_JOIN}
        ${SPIN_RESULTS_JOIN}
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
            promotions.product_id,
            promotions.title,
            promotions.type,
            promotions.discount_type,
            promotions.discount_value,
            promotions.start_date,
            promotions.end_date,
            promotions.allowed_slots,
            promotions.status,
            promotions.description,
            promotions.terms,
            promotions.spin_eligible,
            promotions.spin_reward_type,
            promotions.minimum_spend,
            promotions.usage_limit,
            promotions.spin_claim_limit,
            promotions.spin_inventory_remaining,
            promotions.show_in_flash_deals,
            services.service_name,
            products.name AS product_name,
            COALESCE(spin_stats.spin_win_count, 0) AS spin_win_count,
            COALESCE(spin_stats.spin_claim_count, 0) AS spin_claim_count,
            COALESCE(redemption_stats.total_redemptions, 0) AS total_redemptions,
            COALESCE(redemption_stats.used_redemptions, 0) AS used_redemptions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        LEFT JOIN products ON products.product_id = promotions.product_id
        ${REDEMPTION_JOIN}
        ${SPIN_RESULTS_JOIN}
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
            product_id,
            title,
            type,
            discount_type,
            discount_value,
            start_date,
            end_date,
            allowed_slots,
            status,
            description,
            terms,
            spin_eligible,
            spin_reward_type,
            minimum_spend,
            usage_limit,
            spin_claim_limit,
            spin_inventory_remaining
            ,
            show_in_flash_deals
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
        promotion.productId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.allowedSlots || null,
        promotion.status,
        promotion.description,
        promotion.terms,
        promotion.spinEligible ? 1 : 0,
        promotion.spinRewardType || null,
        Number(promotion.minimumSpend || 0),
        promotion.usageLimit || null,
        promotion.spinClaimLimit || null,
        promotion.spinInventoryRemaining ?? promotion.spinClaimLimit ?? null,
        promotion.showInFlashDeals ? 1 : 0,
        userId
    ];

    db.query(sql, params, callback);
}

function createAsAdmin(promotion, callback) {
    const sql = `
        INSERT INTO promotions (
            salon_id,
            service_id,
            product_id,
            title,
            type,
            discount_type,
            discount_value,
            start_date,
            end_date,
            allowed_slots,
            status,
            description,
            terms,
            spin_eligible,
            spin_reward_type,
            minimum_spend,
            usage_limit,
            spin_claim_limit,
            spin_inventory_remaining,
            show_in_flash_deals
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        promotion.salonId,
        promotion.serviceId || null,
        promotion.productId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.allowedSlots || null,
        promotion.status,
        promotion.description,
        promotion.terms,
        promotion.spinEligible ? 1 : 0,
        promotion.spinRewardType || null,
        Number(promotion.minimumSpend || 0),
        promotion.usageLimit || null,
        promotion.spinClaimLimit || null,
        promotion.spinInventoryRemaining ?? promotion.spinClaimLimit ?? null,
        promotion.showInFlashDeals ? 1 : 0
    ];

    db.query(sql, params, callback);
}

function updateForMerchant(userId, promotionId, promotion, callback) {
    const sql = `
        UPDATE promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        SET
            promotions.service_id = ?,
            promotions.product_id = ?,
            promotions.title = ?,
            promotions.type = ?,
            promotions.discount_type = ?,
            promotions.discount_value = ?,
            promotions.start_date = ?,
            promotions.end_date = ?,
            promotions.allowed_slots = ?,
            promotions.status = ?,
            promotions.description = ?,
            promotions.terms = ?,
            promotions.spin_eligible = ?,
            promotions.spin_reward_type = ?,
            promotions.minimum_spend = ?,
            promotions.usage_limit = ?,
            promotions.spin_claim_limit = ?,
            promotions.spin_inventory_remaining = ?,
            promotions.show_in_flash_deals = ?
        WHERE promotions.promotion_id = ?
            AND salons.merchant_id = ?
    `;

    const params = [
        promotion.serviceId || null,
        promotion.productId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.allowedSlots || null,
        promotion.status,
        promotion.description,
        promotion.terms,
        promotion.spinEligible ? 1 : 0,
        promotion.spinRewardType || null,
        Number(promotion.minimumSpend || 0),
        promotion.usageLimit || null,
        promotion.spinClaimLimit || null,
        promotion.spinInventoryRemaining ?? promotion.spinClaimLimit ?? null,
        promotion.showInFlashDeals ? 1 : 0,
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
            product_id = ?,
            title = ?,
            type = ?,
            discount_type = ?,
            discount_value = ?,
            start_date = ?,
            end_date = ?,
            allowed_slots = ?,
            status = ?,
            description = ?,
            terms = ?,
            spin_eligible = ?,
            spin_reward_type = ?,
            minimum_spend = ?,
            usage_limit = ?,
            spin_claim_limit = ?,
            spin_inventory_remaining = ?,
            show_in_flash_deals = ?
        WHERE promotion_id = ?
    `;

    const params = [
        promotion.salonId,
        promotion.serviceId || null,
        promotion.productId || null,
        promotion.title,
        promotion.type,
        promotion.discountType,
        promotion.discountValue,
        promotion.startDate,
        promotion.endDate,
        promotion.allowedSlots || null,
        promotion.status,
        promotion.description,
        promotion.terms,
        promotion.spinEligible ? 1 : 0,
        promotion.spinRewardType || null,
        Number(promotion.minimumSpend || 0),
        promotion.usageLimit || null,
        promotion.spinClaimLimit || null,
        promotion.spinInventoryRemaining ?? promotion.spinClaimLimit ?? null,
        promotion.showInFlashDeals ? 1 : 0,
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

function findActivePublicById(promotionId, callback) {
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
            salons.description AS salon_description,
            services.service_name,
            COALESCE(redemption_stats.total_redemptions, 0) AS total_redemptions,
            COALESCE(redemption_stats.used_redemptions, 0) AS used_redemptions
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        ${REDEMPTION_JOIN}
        WHERE promotions.promotion_id = ?
            AND promotions.status = 'active'
            AND promotions.start_date <= NOW()
            AND promotions.end_date >= NOW()
            AND salons.approval_status = 'approved'
        LIMIT 1
    `;

    db.query(sql, [promotionId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        if (!rows || rows.length === 0) {
            callback(null, null);
            return;
        }

        callback(null, {
            ...mapPromotion(rows[0]),
            address: rows[0].address || '',
            salonDescription: rows[0].salon_description || ''
        });
    });
}

function hasUserRedeemedPromotion(userId, promotionId, callback) {
    const sql = `
        SELECT redemption_id
        FROM promotion_redemptions
        WHERE user_id = ?
            AND promotion_id = ?
            AND status IN ('reserved', 'used')
        LIMIT 1
    `;

    db.query(sql, [userId, promotionId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.length > 0);
    });
}

function createRedemption(redemption, callback) {
    const sql = `
        INSERT INTO promotion_redemptions
            (promotion_id, user_id, booking_id, status)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [
        redemption.promotionId,
        redemption.userId,
        redemption.bookingId || null,
        redemption.status || 'used'
    ], callback);
}

module.exports = {
    PROMOTION_TYPES,
    DISCOUNT_TYPES,
    PROMOTION_STATUSES,
    SPIN_REWARD_TYPES,
    ensurePromotionSchema,
    getAll,
    getActivePublic,
    getByMerchantUserId,
    findById,
    findActivePublicById,
    findForMerchant,
    hasUserRedeemedPromotion,
    createRedemption,
    createAsAdmin,
    createForMerchant,
    updateForMerchant,
    updateAsAdmin,
    deleteForMerchant,
    deleteAsAdmin
};
