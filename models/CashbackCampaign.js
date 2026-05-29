const db = require('../db');

const CAMPAIGN_STATUSES = ['draft', 'active', 'inactive', 'expired'];
const APPLICABLE_TYPES = ['products', 'services', 'both'];

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function normalizePercent(value, fallback = 0) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.round(numeric * 100) / 100;
}

function normalizeDateTime(value) {
    if (!value) {
        return '';
    }

    return String(value).trim().replace('T', ' ');
}

function mapCampaign(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.campaign_id,
        campaignId: row.campaign_id,
        salonId: row.salon_id,
        salonName: row.salon_name || '',
        merchantUserId: row.merchant_id || null,
        merchantName: row.merchant_name || '',
        title: row.title,
        cashbackPercent: Number(row.cashback_percent || 0),
        minimumSpend: Number(row.minimum_spend || 0),
        startAt: row.start_at,
        endAt: row.end_at,
        status: row.status,
        applicableType: row.applicable_type,
        createdByUserId: row.created_by_user_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function buildCampaignPayload(form = {}) {
    return {
        salonId: Number(form.salonId || form.salon_id || 0),
        title: String(form.title || '').trim(),
        cashbackPercent: normalizePercent(form.cashbackPercent ?? form.cashback_percent),
        minimumSpend: roundMoney(form.minimumSpend ?? form.minimum_spend),
        startAt: normalizeDateTime(form.startAt || form.start_at || form.startDate || form.start_date),
        endAt: normalizeDateTime(form.endAt || form.end_at || form.endDate || form.end_date),
        status: String(form.status || 'draft').trim(),
        applicableType: String(form.applicableType || form.applicable_type || 'both').trim(),
        createdByUserId: form.createdByUserId || form.created_by_user_id || null
    };
}

function validateCampaign(campaign = {}, options = {}) {
    const errors = [];
    const requireSalonId = options.requireSalonId !== false;
    const title = String(campaign.title || '').trim();
    const cashbackPercent = Number(campaign.cashbackPercent);
    const minimumSpend = Number(campaign.minimumSpend);
    const startAt = normalizeDateTime(campaign.startAt);
    const endAt = normalizeDateTime(campaign.endAt);
    const startDate = startAt ? new Date(startAt) : null;
    const endDate = endAt ? new Date(endAt) : null;

    if (requireSalonId && !Number(campaign.salonId)) {
        errors.push('Salon is required.');
    }

    if (title.length < 3 || title.length > 120) {
        errors.push('Campaign title must be between 3 and 120 characters.');
    }

    if (!Number.isFinite(cashbackPercent) || cashbackPercent <= 0 || cashbackPercent > 100) {
        errors.push('Cashback percentage must be greater than 0 and no more than 100.');
    }

    if (!Number.isFinite(minimumSpend) || minimumSpend < 0) {
        errors.push('Minimum spend must be 0 or more.');
    }

    if (!startAt || !startDate || Number.isNaN(startDate.getTime())) {
        errors.push('Start date and time is required.');
    }

    if (!endAt || !endDate || Number.isNaN(endDate.getTime())) {
        errors.push('End date and time is required.');
    }

    if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate <= startDate) {
        errors.push('End date and time must be after the start date and time.');
    }

    if (!CAMPAIGN_STATUSES.includes(campaign.status)) {
        errors.push('Campaign status is invalid.');
    }

    if (!APPLICABLE_TYPES.includes(campaign.applicableType)) {
        errors.push('Applicable type is invalid.');
    }

    return errors;
}

function ensureSchema(callback) {
    const tableSql = `
        CREATE TABLE IF NOT EXISTS merchant_cashback_campaigns (
            campaign_id INT NOT NULL AUTO_INCREMENT,
            salon_id INT NOT NULL,
            title VARCHAR(120) NOT NULL,
            cashback_percent DECIMAL(5,2) NOT NULL,
            minimum_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            start_at DATETIME NOT NULL,
            end_at DATETIME NOT NULL,
            status ENUM('draft','active','inactive','expired') NOT NULL DEFAULT 'draft',
            applicable_type ENUM('products','services','both') NOT NULL DEFAULT 'both',
            created_by_user_id INT DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (campaign_id),
            KEY idx_cashback_campaign_salon_status_dates (salon_id, status, start_at, end_at),
            KEY idx_cashback_campaign_lookup (salon_id, status, applicable_type, minimum_spend),
            KEY idx_cashback_campaign_creator (created_by_user_id),
            CONSTRAINT fk_cashback_campaign_salon FOREIGN KEY (salon_id) REFERENCES salons (salon_id) ON DELETE CASCADE,
            CONSTRAINT fk_cashback_campaign_creator FOREIGN KEY (created_by_user_id) REFERENCES users (user_id) ON DELETE SET NULL
        )
    `;

    db.query(tableSql, (tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query('SHOW COLUMNS FROM loyalty_transactions', (columnError, columns = []) => {
            if (columnError) {
                callback(columnError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('campaign_id')) {
                alters.push('ADD COLUMN campaign_id INT NULL AFTER source_receipt_id');
            }

            if (!fields.has('salon_id')) {
                alters.push('ADD COLUMN salon_id INT NULL AFTER campaign_id');
            }

            if (!alters.length) {
                callback(null);
                return;
            }

            db.query(`ALTER TABLE loyalty_transactions ${alters.join(', ')}`, callback);
        });
    });
}

const SELECT_FIELDS = `
    merchant_cashback_campaigns.*,
    salons.salon_name,
    salons.merchant_id,
    users.name AS merchant_name
`;

const FROM_JOIN = `
    FROM merchant_cashback_campaigns
    INNER JOIN salons ON salons.salon_id = merchant_cashback_campaigns.salon_id
    LEFT JOIN users ON users.user_id = salons.merchant_id
`;

function getAll(callback) {
    const sql = `
        SELECT ${SELECT_FIELDS}
        ${FROM_JOIN}
        ORDER BY merchant_cashback_campaigns.start_at DESC, merchant_cashback_campaigns.campaign_id DESC
    `;

    db.query(sql, (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapCampaign));
    });
}

function getByMerchantUserId(userId, callback) {
    const sql = `
        SELECT ${SELECT_FIELDS}
        ${FROM_JOIN}
        WHERE salons.merchant_id = ?
        ORDER BY merchant_cashback_campaigns.start_at DESC, merchant_cashback_campaigns.campaign_id DESC
    `;

    db.query(sql, [userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapCampaign));
    });
}

function findById(campaignId, callback) {
    const sql = `
        SELECT ${SELECT_FIELDS}
        ${FROM_JOIN}
        WHERE merchant_cashback_campaigns.campaign_id = ?
        LIMIT 1
    `;

    db.query(sql, [campaignId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapCampaign(rows[0]));
    });
}

function findForMerchant(userId, campaignId, callback) {
    const sql = `
        SELECT ${SELECT_FIELDS}
        ${FROM_JOIN}
        WHERE salons.merchant_id = ?
            AND merchant_cashback_campaigns.campaign_id = ?
        LIMIT 1
    `;

    db.query(sql, [userId, campaignId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapCampaign(rows[0]));
    });
}

function createForMerchant(userId, campaign, callback) {
    const sql = `
        INSERT INTO merchant_cashback_campaigns (
            salon_id,
            title,
            cashback_percent,
            minimum_spend,
            start_at,
            end_at,
            status,
            applicable_type,
            created_by_user_id
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
            ?
        FROM salons
        WHERE salons.merchant_id = ?
            AND salons.salon_id = ?
        LIMIT 1
    `;

    db.query(sql, [
        campaign.title,
        campaign.cashbackPercent,
        campaign.minimumSpend,
        campaign.startAt,
        campaign.endAt,
        campaign.status,
        campaign.applicableType,
        campaign.createdByUserId || userId,
        userId,
        campaign.salonId
    ], callback);
}

function createAsAdmin(campaign, callback) {
    const sql = `
        INSERT INTO merchant_cashback_campaigns (
            salon_id,
            title,
            cashback_percent,
            minimum_spend,
            start_at,
            end_at,
            status,
            applicable_type,
            created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        campaign.salonId,
        campaign.title,
        campaign.cashbackPercent,
        campaign.minimumSpend,
        campaign.startAt,
        campaign.endAt,
        campaign.status,
        campaign.applicableType,
        campaign.createdByUserId || null
    ], callback);
}

function updateForMerchant(userId, campaignId, campaign, callback) {
    const sql = `
        UPDATE merchant_cashback_campaigns
        INNER JOIN salons ON salons.salon_id = merchant_cashback_campaigns.salon_id
        SET
            merchant_cashback_campaigns.title = ?,
            merchant_cashback_campaigns.cashback_percent = ?,
            merchant_cashback_campaigns.minimum_spend = ?,
            merchant_cashback_campaigns.start_at = ?,
            merchant_cashback_campaigns.end_at = ?,
            merchant_cashback_campaigns.status = ?,
            merchant_cashback_campaigns.applicable_type = ?
        WHERE merchant_cashback_campaigns.campaign_id = ?
            AND salons.merchant_id = ?
            AND merchant_cashback_campaigns.salon_id = ?
    `;

    db.query(sql, [
        campaign.title,
        campaign.cashbackPercent,
        campaign.minimumSpend,
        campaign.startAt,
        campaign.endAt,
        campaign.status,
        campaign.applicableType,
        campaignId,
        userId,
        campaign.salonId
    ], callback);
}

function updateAsAdmin(campaignId, campaign, callback) {
    const sql = `
        UPDATE merchant_cashback_campaigns
        SET
            salon_id = ?,
            title = ?,
            cashback_percent = ?,
            minimum_spend = ?,
            start_at = ?,
            end_at = ?,
            status = ?,
            applicable_type = ?
        WHERE campaign_id = ?
    `;

    db.query(sql, [
        campaign.salonId,
        campaign.title,
        campaign.cashbackPercent,
        campaign.minimumSpend,
        campaign.startAt,
        campaign.endAt,
        campaign.status,
        campaign.applicableType,
        campaignId
    ], callback);
}

function deleteForMerchant(userId, campaignId, callback) {
    const sql = `
        DELETE merchant_cashback_campaigns
        FROM merchant_cashback_campaigns
        INNER JOIN salons ON salons.salon_id = merchant_cashback_campaigns.salon_id
        WHERE merchant_cashback_campaigns.campaign_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [campaignId, userId], callback);
}

function deleteAsAdmin(campaignId, callback) {
    db.query('DELETE FROM merchant_cashback_campaigns WHERE campaign_id = ?', [campaignId], callback);
}

function findActiveForSpend(criteria = {}, callback) {
    const salonId = Number(criteria.salonId || 0);
    const spend = roundMoney(criteria.spend ?? criteria.subtotal ?? criteria.amount);
    const applicableType = APPLICABLE_TYPES.includes(criteria.applicableType) ? criteria.applicableType : 'both';
    const at = normalizeDateTime(criteria.at) || new Date();

    if (!salonId || spend <= 0) {
        callback(null, null);
        return;
    }

    const sql = `
        SELECT ${SELECT_FIELDS}
        ${FROM_JOIN}
        WHERE merchant_cashback_campaigns.salon_id = ?
            AND merchant_cashback_campaigns.status = 'active'
            AND merchant_cashback_campaigns.start_at <= ?
            AND merchant_cashback_campaigns.end_at >= ?
            AND merchant_cashback_campaigns.minimum_spend <= ?
            AND merchant_cashback_campaigns.applicable_type IN (?, 'both')
        ORDER BY merchant_cashback_campaigns.cashback_percent DESC,
            merchant_cashback_campaigns.start_at DESC,
            merchant_cashback_campaigns.campaign_id DESC
        LIMIT 1
    `;

    db.query(sql, [salonId, at, at, spend, applicableType], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapCampaign(rows[0]));
    });
}

function calculateCashback(amount, campaign) {
    const spend = roundMoney(amount);

    if (!campaign || spend < Number(campaign.minimumSpend || 0)) {
        return 0;
    }

    return roundMoney(spend * (Number(campaign.cashbackPercent || 0) / 100));
}

module.exports = {
    APPLICABLE_TYPES,
    CAMPAIGN_STATUSES,
    buildCampaignPayload,
    calculateCashback,
    createAsAdmin,
    createForMerchant,
    deleteAsAdmin,
    deleteForMerchant,
    ensureSchema,
    findActiveForSpend,
    findById,
    findForMerchant,
    getAll,
    getByMerchantUserId,
    mapCampaign,
    updateAsAdmin,
    updateForMerchant,
    validateCampaign
};
