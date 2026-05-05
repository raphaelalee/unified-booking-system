const db = require('../db');

const DEFAULT_REWARD_VOUCHERS = [
    {
        id: 'glints-1000',
        voucherId: null,
        glintsCost: 1000,
        voucherValue: 1,
        title: '$1 Off Booking',
        detail: 'Best for stacking up small cashback-style redemptions.',
        status: 'active',
        sortOrder: 10,
        isDefault: true
    },
    {
        id: 'glints-5000',
        voucherId: null,
        glintsCost: 5000,
        voucherValue: 5,
        title: '$5 Off Booking',
        detail: 'A stronger offset for weekday treatments and quick services.',
        status: 'active',
        sortOrder: 20,
        isDefault: true
    },
    {
        id: 'glints-10000',
        voucherId: null,
        glintsCost: 10000,
        voucherValue: 10,
        title: '$10 Off Booking',
        detail: 'Ideal for premium facials, massages, and bundled appointments.',
        status: 'active',
        sortOrder: 30,
        isDefault: true
    },
    {
        id: 'glints-15000',
        voucherId: null,
        glintsCost: 15000,
        voucherValue: 15,
        title: '$15 Off Booking',
        detail: 'Higher-value reward for larger bookings and platform promos.',
        status: 'active',
        sortOrder: 40,
        isDefault: true
    }
];

const STATUSES = ['active', 'inactive'];

function isMissingTable(error) {
    return error && error.code === 'ER_NO_SUCH_TABLE';
}

function mapVoucher(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.voucher_id || row.id,
        voucherId: row.voucher_id || row.id,
        glintsCost: Number(row.glints_cost || row.glintsCost || 0),
        voucherValue: Number(row.voucher_value || row.voucherValue || 0),
        title: row.title || '',
        detail: row.detail || '',
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || row.sortOrder || 0),
        isDefault: false,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function getActive(callback) {
    const sql = `
        SELECT voucher_id, glints_cost, voucher_value, title, detail, status, sort_order, created_at, updated_at
        FROM reward_shop_vouchers
        WHERE status = 'active'
        ORDER BY sort_order ASC, glints_cost ASC, voucher_id ASC
    `;

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
}

function getAll(callback) {
    const sql = `
        SELECT voucher_id, glints_cost, voucher_value, title, detail, status, sort_order, created_at, updated_at
        FROM reward_shop_vouchers
        ORDER BY sort_order ASC, glints_cost ASC, voucher_id ASC
    `;

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
}

function findById(voucherId, callback) {
    const sql = `
        SELECT voucher_id, glints_cost, voucher_value, title, detail, status, sort_order, created_at, updated_at
        FROM reward_shop_vouchers
        WHERE voucher_id = ?
        LIMIT 1
    `;

    db.query(sql, [voucherId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapVoucher(rows[0]));
    });
}

function create(voucher, callback) {
    const sql = `
        INSERT INTO reward_shop_vouchers
            (glints_cost, voucher_value, title, detail, status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        voucher.glintsCost,
        voucher.voucherValue,
        voucher.title,
        voucher.detail,
        voucher.status,
        voucher.sortOrder
    ], callback);
}

function update(voucherId, voucher, callback) {
    const sql = `
        UPDATE reward_shop_vouchers
        SET glints_cost = ?,
            voucher_value = ?,
            title = ?,
            detail = ?,
            status = ?,
            sort_order = ?
        WHERE voucher_id = ?
    `;

    db.query(sql, [
        voucher.glintsCost,
        voucher.voucherValue,
        voucher.title,
        voucher.detail,
        voucher.status,
        voucher.sortOrder,
        voucherId
    ], callback);
}

function deleteById(voucherId, callback) {
    db.query('DELETE FROM reward_shop_vouchers WHERE voucher_id = ?', [voucherId], callback);
}

module.exports = {
    DEFAULT_REWARD_VOUCHERS,
    STATUSES,
    getActive,
    getAll,
    findById,
    create,
    update,
    deleteById
};
