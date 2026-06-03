const db = require('../db');

const DEFAULT_REWARD_VOUCHERS = [
    {
        id: 'glints-1000',
        voucherId: null,
        glintsCost: 1000,
        pointsRequired: 1000,
        voucherValue: 1,
        discountType: 'fixed',
        discountValue: 1,
        minimumSpend: 0,
        title: '$1 Off Booking',
        detail: 'Best for stacking up small cashback-style redemptions.',
        status: 'active',
        sortOrder: 10,
        voucherSource: 'platform',
        merchantId: null,
        merchantName: '',
        usageLimitPerUser: null,
        usageLimitTotal: null,
        redemptionCount: 0,
        createdBy: null,
        startDate: null,
        expiryDate: null,
        isDefault: true
    },
    {
        id: 'glints-5000',
        voucherId: null,
        glintsCost: 5000,
        pointsRequired: 5000,
        voucherValue: 5,
        discountType: 'fixed',
        discountValue: 5,
        minimumSpend: 0,
        title: '$5 Off Booking',
        detail: 'A stronger offset for weekday treatments and quick services.',
        status: 'active',
        sortOrder: 20,
        voucherSource: 'platform',
        merchantId: null,
        merchantName: '',
        usageLimitPerUser: null,
        usageLimitTotal: null,
        redemptionCount: 0,
        createdBy: null,
        startDate: null,
        expiryDate: null,
        isDefault: true
    },
    {
        id: 'glints-10000',
        voucherId: null,
        glintsCost: 10000,
        pointsRequired: 10000,
        voucherValue: 10,
        discountType: 'fixed',
        discountValue: 10,
        minimumSpend: 0,
        title: '$10 Off Booking',
        detail: 'Ideal for premium facials, massages, and bundled appointments.',
        status: 'active',
        sortOrder: 30,
        voucherSource: 'platform',
        merchantId: null,
        merchantName: '',
        usageLimitPerUser: null,
        usageLimitTotal: null,
        redemptionCount: 0,
        createdBy: null,
        startDate: null,
        expiryDate: null,
        isDefault: true
    },
    {
        id: 'glints-15000',
        voucherId: null,
        glintsCost: 15000,
        pointsRequired: 15000,
        voucherValue: 15,
        discountType: 'fixed',
        discountValue: 15,
        minimumSpend: 0,
        title: '$15 Off Booking',
        detail: 'Higher-value reward for larger bookings and platform promos.',
        status: 'active',
        sortOrder: 40,
        voucherSource: 'platform',
        merchantId: null,
        merchantName: '',
        usageLimitPerUser: null,
        usageLimitTotal: null,
        redemptionCount: 0,
        createdBy: null,
        startDate: null,
        expiryDate: null,
        isDefault: true
    }
];

const STATUSES = ['active', 'inactive'];
const VOUCHER_SOURCES = ['platform', 'merchant'];
const DISCOUNT_TYPES = ['fixed', 'percentage'];
const LINKED_ITEM_TYPES = ['service', 'product'];

let schemaReady = false;
let schemaPending = false;
let schemaQueue = [];

function flushQueue(error) {
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

    const createSql = `
        CREATE TABLE IF NOT EXISTS reward_shop_vouchers (
            voucher_id INT NOT NULL AUTO_INCREMENT,
            glints_cost INT NOT NULL,
            voucher_value DECIMAL(10,2) NOT NULL,
            title VARCHAR(120) NOT NULL,
            detail VARCHAR(255) NOT NULL,
            status ENUM('active','inactive') NOT NULL DEFAULT 'active',
            sort_order INT NOT NULL DEFAULT 0,
            voucher_source VARCHAR(20) NOT NULL DEFAULT 'platform',
            merchant_id INT DEFAULT NULL,
            discount_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
            discount_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            minimum_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            points_required INT DEFAULT NULL,
            start_date DATETIME DEFAULT NULL,
            expiry_date DATETIME DEFAULT NULL,
            usage_limit_per_user INT DEFAULT NULL,
            usage_limit_total INT DEFAULT NULL,
            redemption_count INT NOT NULL DEFAULT 0,
            created_by INT DEFAULT NULL,
            applies_to_booking TINYINT(1) NOT NULL DEFAULT 1,
            linked_service_id INT DEFAULT NULL,
            linked_product_id INT DEFAULT NULL,
            linked_item_type VARCHAR(20) DEFAULT NULL,
            linked_item_id INT DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (voucher_id),
            KEY idx_reward_shop_vouchers_status_sort (status, sort_order, glints_cost),
            KEY idx_reward_shop_vouchers_source_merchant (voucher_source, merchant_id),
            KEY idx_reward_shop_vouchers_expiry (expiry_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(createSql, (createError) => {
        if (createError) {
            flushQueue(createError);
            return;
        }

        db.query('SHOW COLUMNS FROM reward_shop_vouchers', (columnError, columns = []) => {
            if (columnError) {
                flushQueue(columnError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('voucher_source')) {
                alters.push("ADD COLUMN voucher_source VARCHAR(20) NOT NULL DEFAULT 'platform' AFTER sort_order");
            }

            if (!fields.has('merchant_id')) {
                alters.push('ADD COLUMN merchant_id INT DEFAULT NULL AFTER voucher_source');
            }

            if (!fields.has('discount_type')) {
                alters.push("ADD COLUMN discount_type VARCHAR(20) NOT NULL DEFAULT 'fixed' AFTER merchant_id");
            }

            if (!fields.has('discount_value')) {
                alters.push('ADD COLUMN discount_value DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount_type');
            }

            if (!fields.has('minimum_spend')) {
                alters.push('ADD COLUMN minimum_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount_value');
            }

            if (!fields.has('points_required')) {
                alters.push('ADD COLUMN points_required INT DEFAULT NULL AFTER minimum_spend');
            }

            if (!fields.has('start_date')) {
                alters.push('ADD COLUMN start_date DATETIME DEFAULT NULL AFTER points_required');
            }

            if (!fields.has('expiry_date')) {
                alters.push('ADD COLUMN expiry_date DATETIME DEFAULT NULL AFTER start_date');
            }

            if (!fields.has('usage_limit_per_user')) {
                alters.push('ADD COLUMN usage_limit_per_user INT DEFAULT NULL AFTER expiry_date');
            }

            if (!fields.has('usage_limit_total')) {
                alters.push('ADD COLUMN usage_limit_total INT DEFAULT NULL AFTER usage_limit_per_user');
            }

            if (!fields.has('redemption_count')) {
                alters.push('ADD COLUMN redemption_count INT NOT NULL DEFAULT 0 AFTER usage_limit_total');
            }

            if (!fields.has('created_by')) {
                alters.push('ADD COLUMN created_by INT DEFAULT NULL AFTER redemption_count');
            }

            if (!fields.has('applies_to_booking')) {
                alters.push('ADD COLUMN applies_to_booking TINYINT(1) NOT NULL DEFAULT 1 AFTER created_by');
            }

            if (!fields.has('linked_service_id')) {
                alters.push('ADD COLUMN linked_service_id INT DEFAULT NULL AFTER applies_to_booking');
            }

            if (!fields.has('linked_product_id')) {
                alters.push('ADD COLUMN linked_product_id INT DEFAULT NULL AFTER linked_service_id');
            }

            if (!fields.has('linked_item_type')) {
                alters.push('ADD COLUMN linked_item_type VARCHAR(20) DEFAULT NULL AFTER linked_product_id');
            }

            if (!fields.has('linked_item_id')) {
                alters.push('ADD COLUMN linked_item_id INT DEFAULT NULL AFTER linked_item_type');
            }

            if (alters.length === 0) {
                db.query(
                    `
                        UPDATE reward_shop_vouchers
                        SET points_required = COALESCE(points_required, glints_cost),
                            discount_value = CASE
                                WHEN COALESCE(discount_value, 0) > 0 THEN discount_value
                                ELSE voucher_value
                            END,
                            applies_to_booking = CASE
                                WHEN linked_item_type = 'product' THEN 0
                                ELSE COALESCE(applies_to_booking, 1)
                            END,
                            linked_service_id = CASE
                                WHEN linked_item_type = 'service' AND linked_service_id IS NULL THEN linked_item_id
                                ELSE linked_service_id
                            END,
                            linked_product_id = CASE
                                WHEN linked_item_type = 'product' AND linked_product_id IS NULL THEN linked_item_id
                                ELSE linked_product_id
                            END,
                            status = CASE
                                WHEN status = 'inactive' THEN 'inactive'
                                ELSE status
                            END
                    `,
                    () => {
                        schemaReady = true;
                        flushQueue(null);
                    }
                );
                return;
            }

            db.query(`ALTER TABLE reward_shop_vouchers ${alters.join(', ')}`, (alterError) => {
                if (alterError) {
                    flushQueue(alterError);
                    return;
                }

                db.query(
                    `
                        UPDATE reward_shop_vouchers
                        SET points_required = COALESCE(points_required, glints_cost),
                            discount_type = COALESCE(NULLIF(discount_type, ''), 'fixed'),
                            discount_value = CASE
                                WHEN COALESCE(discount_value, 0) > 0 THEN discount_value
                                ELSE voucher_value
                            END,
                            applies_to_booking = CASE
                                WHEN linked_item_type = 'product' THEN 0
                                ELSE COALESCE(applies_to_booking, 1)
                            END,
                            linked_service_id = CASE
                                WHEN linked_item_type = 'service' AND linked_service_id IS NULL THEN linked_item_id
                                ELSE linked_service_id
                            END,
                            linked_product_id = CASE
                                WHEN linked_item_type = 'product' AND linked_product_id IS NULL THEN linked_item_id
                                ELSE linked_product_id
                            END,
                            voucher_source = COALESCE(NULLIF(voucher_source, ''), 'platform')
                    `,
                    (seedError) => {
                        if (seedError) {
                            flushQueue(seedError);
                            return;
                        }

                        schemaReady = true;
                        flushQueue(null);
                    }
                );
            });
        });
    });
}

function isMissingTable(error) {
    return error && error.code === 'ER_NO_SUCH_TABLE';
}

function mapVoucher(row) {
    if (!row) {
        return null;
    }

    const discountType = row.discount_type || row.discountType || 'fixed';
    const discountValue = Number(
        row.discount_value !== undefined && row.discount_value !== null
            ? row.discount_value
            : (discountType === 'percentage'
                ? row.discount_percent || 0
                : row.voucher_value || row.voucherValue || 0)
    );

    const pointsRequired = Number(
        row.points_required !== undefined && row.points_required !== null
            ? row.points_required
            : (row.glints_cost || row.glintsCost || 0)
    );

    const voucherValue = discountType === 'fixed'
        ? discountValue
        : Number(row.voucher_value || row.voucherValue || 0);

    return {
        id: row.voucher_id || row.id,
        voucherId: row.voucher_id || row.id,
        glintsCost: Number(row.glints_cost || row.glintsCost || pointsRequired || 0),
        pointsRequired,
        voucherValue,
        title: row.title || '',
        detail: row.detail || '',
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || row.sortOrder || 0),
        voucherSource: row.voucher_source || row.voucherSource || 'platform',
        merchantId: row.merchant_id ? Number(row.merchant_id) : null,
        merchantName: row.merchant_name || row.merchantName || '',
        discountType,
        discountValue,
        minimumSpend: Number(row.minimum_spend || row.minimumSpend || 0),
        startDate: row.start_date || row.startDate || null,
        expiryDate: row.expiry_date || row.expiryDate || null,
        usageLimitPerUser: row.usage_limit_per_user === null || row.usage_limit_per_user === undefined
            ? null
            : Number(row.usage_limit_per_user),
        usageLimitTotal: row.usage_limit_total === null || row.usage_limit_total === undefined
            ? null
            : Number(row.usage_limit_total),
        redemptionCount: Number(row.redemption_count || row.redemptionCount || 0),
        createdBy: row.created_by || row.createdBy || null,
        appliesToBooking: Boolean(Number(row.applies_to_booking ?? row.appliesToBooking ?? (row.linked_item_type === 'product' ? 0 : 1))),
        linkedServiceId: row.linked_service_id ? Number(row.linked_service_id) : (row.linked_item_type === 'service' && row.linked_item_id ? Number(row.linked_item_id) : null),
        linkedServiceName: row.linked_service_name || row.linkedServiceName || '',
        linkedServiceSalonId: row.linked_service_salon_id ? Number(row.linked_service_salon_id) : null,
        linkedProductId: row.linked_product_id ? Number(row.linked_product_id) : (row.linked_item_type === 'product' && row.linked_item_id ? Number(row.linked_item_id) : null),
        linkedProductName: row.linked_product_name || row.linkedProductName || '',
        linkedProductSalonId: row.linked_product_salon_id ? Number(row.linked_product_salon_id) : null,
        linkedItemType: row.linked_item_type || row.linkedItemType || '',
        linkedItemId: row.linked_item_id ? Number(row.linked_item_id) : null,
        linkedItemName: row.linked_item_name || row.linkedItemName || '',
        isDefault: false,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function buildSelectSql(whereClause = '', orderBy = 'v.sort_order ASC, COALESCE(v.points_required, v.glints_cost) ASC, v.voucher_id ASC') {
    return `
        SELECT
            v.voucher_id,
            v.glints_cost,
            v.voucher_value,
            v.title,
            v.detail,
            v.status,
            v.sort_order,
            v.voucher_source,
            v.merchant_id,
            v.discount_type,
            v.discount_value,
            v.minimum_spend,
            v.points_required,
            v.start_date,
            v.expiry_date,
            v.usage_limit_per_user,
            v.usage_limit_total,
            v.redemption_count,
            v.created_by,
            v.applies_to_booking,
            v.linked_service_id,
            v.linked_product_id,
            v.linked_item_type,
            v.linked_item_id,
            v.created_at,
            v.updated_at,
            s.salon_name AS merchant_name,
            svc.service_name AS linked_service_name,
            svc.salon_id AS linked_service_salon_id,
            prod.name AS linked_product_name,
            prod.salon_id AS linked_product_salon_id,
            CASE
                WHEN v.linked_item_type = 'service' THEN svc.service_name
                WHEN v.linked_item_type = 'product' THEN prod.name
                ELSE NULL
            END AS linked_item_name
        FROM reward_shop_vouchers v
        LEFT JOIN salons s
            ON s.salon_id = v.merchant_id
        LEFT JOIN services svc
            ON svc.service_id = COALESCE(v.linked_service_id, CASE WHEN v.linked_item_type = 'service' THEN v.linked_item_id ELSE NULL END)
        LEFT JOIN products prod
            ON prod.product_id = COALESCE(v.linked_product_id, CASE WHEN v.linked_item_type = 'product' THEN v.linked_item_id ELSE NULL END)
        ${whereClause}
        ORDER BY ${orderBy}
    `;
}

function getActive(callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            if (isMissingTable(schemaError)) {
                callback(null, DEFAULT_REWARD_VOUCHERS);
                return;
            }

            callback(schemaError);
            return;
        }

        const sql = buildSelectSql(`
            WHERE v.status = 'active'
                AND (v.start_date IS NULL OR v.start_date <= CURRENT_TIMESTAMP)
                AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_TIMESTAMP)
                AND (
                    v.usage_limit_total IS NULL
                    OR COALESCE(v.redemption_count, 0) < v.usage_limit_total
                )
        `);

        db.query(sql, (error, rows) => {
            if (isMissingTable(error)) {
                callback(null, DEFAULT_REWARD_VOUCHERS);
                return;
            }

            if (error) {
                callback(error);
                return;
            }

            callback(null, (rows || []).map(mapVoucher));
        });
    });
}

function getActivePlatform(callback) {
    getActive((error, vouchers = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, vouchers.filter((voucher) => voucher.voucherSource === 'platform'));
    });
}

function getActiveMerchant(callback) {
    getActive((error, vouchers = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, vouchers.filter((voucher) => voucher.voucherSource === 'merchant'));
    });
}

function getAll(callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            if (isMissingTable(schemaError)) {
                callback(null, DEFAULT_REWARD_VOUCHERS);
                return;
            }

            callback(schemaError);
            return;
        }

        db.query(buildSelectSql(), (error, rows) => {
            if (isMissingTable(error)) {
                callback(null, DEFAULT_REWARD_VOUCHERS);
                return;
            }

            if (error) {
                callback(error);
                return;
            }

            callback(null, (rows || []).map(mapVoucher));
        });
    });
}

function findById(voucherId, callback) {
    const defaultVoucher = DEFAULT_REWARD_VOUCHERS.find((voucher) => String(voucher.id) === String(voucherId));

    if (defaultVoucher) {
        callback(null, defaultVoucher);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = buildSelectSql('WHERE v.voucher_id = ?');

        db.query(sql, [voucherId], (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, mapVoucher(rows[0]));
        });
    });
}

function buildCreateParams(voucher = {}) {
    const voucherSource = VOUCHER_SOURCES.includes(voucher.voucherSource) ? voucher.voucherSource : 'platform';
    const discountType = DISCOUNT_TYPES.includes(voucher.discountType) ? voucher.discountType : 'fixed';
    const discountValue = Number(
        voucher.discountValue !== undefined && voucher.discountValue !== null
            ? voucher.discountValue
            : voucher.voucherValue || 0
    );
    const pointsRequired = Number(
        voucher.pointsRequired !== undefined && voucher.pointsRequired !== null
            ? voucher.pointsRequired
            : voucher.glintsCost || 0
    );
    const appliesToBooking = voucher.appliesToBooking === undefined ? true : Boolean(voucher.appliesToBooking);
    const linkedServiceId = Number(voucher.linkedServiceId || 0) || null;
    const linkedProductId = Number(voucher.linkedProductId || 0) || null;
    const linkedItemType = LINKED_ITEM_TYPES.includes(voucher.linkedItemType) ? voucher.linkedItemType : null;

    return [
        Number(voucher.glintsCost || pointsRequired || 0),
        Number(voucher.voucherValue || (discountType === 'fixed' ? discountValue : 0)),
        voucher.title,
        voucher.detail,
        voucher.status,
        Number(voucher.sortOrder || 0),
        voucherSource,
        voucher.merchantId || null,
        discountType,
        discountValue,
        Number(voucher.minimumSpend || 0),
        pointsRequired,
        voucher.startDate || null,
        voucher.expiryDate || null,
        voucher.usageLimitPerUser || null,
        voucher.usageLimitTotal || null,
        Number(voucher.redemptionCount || 0),
        voucher.createdBy || null,
        appliesToBooking ? 1 : 0,
        linkedServiceId,
        linkedProductId,
        linkedItemType,
        linkedItemType ? (voucher.linkedItemId || null) : null
    ];
}

function create(voucher, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO reward_shop_vouchers
                (glints_cost, voucher_value, title, detail, status, sort_order, voucher_source, merchant_id, discount_type,
                    discount_value, minimum_spend, points_required, start_date, expiry_date, usage_limit_per_user,
                    usage_limit_total, redemption_count, created_by, applies_to_booking, linked_service_id, linked_product_id,
                    linked_item_type, linked_item_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, buildCreateParams(voucher), callback);
    });
}

function update(voucherId, voucher, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE reward_shop_vouchers
            SET glints_cost = ?,
                voucher_value = ?,
                title = ?,
                detail = ?,
                status = ?,
                sort_order = ?,
                voucher_source = ?,
                merchant_id = ?,
                discount_type = ?,
                discount_value = ?,
                minimum_spend = ?,
                points_required = ?,
                start_date = ?,
                expiry_date = ?,
                usage_limit_per_user = ?,
                usage_limit_total = ?,
                redemption_count = ?,
                created_by = ?,
                applies_to_booking = ?,
                linked_service_id = ?,
                linked_product_id = ?,
                linked_item_type = ?,
                linked_item_id = ?
            WHERE voucher_id = ?
        `;

        db.query(sql, [...buildCreateParams(voucher), voucherId], callback);
    });
}

function deleteById(voucherId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query('DELETE FROM reward_shop_vouchers WHERE voucher_id = ?', [voucherId], callback);
    });
}

function getByMerchantUserId(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = buildSelectSql(`
            WHERE v.voucher_source = 'merchant'
                AND s.merchant_id = ?
        `, 'v.sort_order ASC, v.voucher_id DESC');

        db.query(sql, [userId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapVoucher));
        });
    });
}

function findForMerchant(userId, voucherId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = buildSelectSql(`
            WHERE v.voucher_source = 'merchant'
                AND s.merchant_id = ?
                AND v.voucher_id = ?
        `);

        db.query(sql, [userId, voucherId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] ? mapVoucher(rows[0]) : null);
        });
    });
}

function createForMerchant(userId, voucher, callback) {
    create({
        ...voucher,
        voucherSource: 'merchant',
        createdBy: userId
    }, callback);
}

function updateForMerchant(userId, voucherId, voucher, callback) {
    findForMerchant(userId, voucherId, (lookupError, existingVoucher) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (!existingVoucher) {
            callback(null, { affectedRows: 0 });
            return;
        }

        update(voucherId, {
            ...existingVoucher,
            ...voucher,
            voucherSource: 'merchant',
            createdBy: existingVoucher.createdBy || userId
        }, callback);
    });
}

function deleteForMerchant(userId, voucherId, callback) {
    findForMerchant(userId, voucherId, (lookupError, existingVoucher) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (!existingVoucher) {
            callback(null, { affectedRows: 0 });
            return;
        }

        deleteById(voucherId, callback);
    });
}

module.exports = {
    DEFAULT_REWARD_VOUCHERS,
    STATUSES,
    VOUCHER_SOURCES,
    DISCOUNT_TYPES,
    LINKED_ITEM_TYPES,
    ensureSchema,
    getActive,
    getActivePlatform,
    getActiveMerchant,
    getAll,
    getByMerchantUserId,
    findById,
    findForMerchant,
    create,
    createForMerchant,
    update,
    updateForMerchant,
    deleteById,
    deleteForMerchant
};
