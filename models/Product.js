const db = require('../db');

const fallbackProducts = [
    { id: 'skin-serum', name: 'Hydrating Glow Serum', category: 'Skincare', price: 38, description: 'Best after facial treatments' },
    { id: 'hair-mask', name: 'Repair Hair Mask', category: 'Haircare', price: 32, description: 'For coloured or dry hair' },
    { id: 'body-oil', name: 'Calming Body Oil', category: 'Bodycare', price: 28, description: 'Spa-inspired daily care' },
    { id: 'lip-tint', name: 'Soft Rose Lip Tint', category: 'Makeup', price: 18, description: 'Lightweight everyday colour' },
    { id: 'cream-cleanser', name: 'Gentle Cream Cleanser', category: 'Skincare', price: 24, description: 'For daily cleansing after facials' },
    { id: 'room-mist', name: 'Botanical Room Mist', category: 'Wellness', price: 22, description: 'Calm spa scent for home' }
];

function mapRow(row) {
    return {
        id: row.product_id,
        productId: row.product_id,
        salonId: row.salon_id,
        salonName: row.salon_name || 'Vaniday Merchant',
        category: row.salon_name || 'Merchant Product',
        name: row.name,
        price: Number(row.price),
        stockQuantity: Number(row.stock_quantity || 0),
        imageUrl: row.image_url || '',
        description: row.salon_name
            ? `Available from ${row.salon_name}`
            : `Stock: ${Number(row.stock_quantity || 0)}`
    };
}

function getFallbackAll() {
    return fallbackProducts.map((product) => ({ ...product }));
}

function getAll(callback) {
    if (!callback) {
        return getFallbackAll();
    }

    const sql = `
        SELECT products.product_id, products.salon_id, products.name, products.price,
            products.stock_quantity, products.image_url, salons.salon_name
        FROM products
        LEFT JOIN salons ON salons.salon_id = products.salon_id
        ORDER BY products.product_id DESC
    `;

    db.query(sql, (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, [
            ...rows.map(mapRow),
            ...getFallbackAll()
        ]);
    });
}

function findById(id, callback) {
    if (!callback) {
        return fallbackProducts.find((product) => String(product.id) === String(id)) || null;
    }

    if (!Number.isInteger(Number(id))) {
        callback(null, findById(id));
        return;
    }

    const sql = `
        SELECT products.product_id, products.salon_id, products.name, products.price,
            products.stock_quantity, products.image_url, salons.salon_name
        FROM products
        LEFT JOIN salons ON salons.salon_id = products.salon_id
        WHERE products.product_id = ?
        LIMIT 1
    `;

    db.query(sql, [id], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] ? mapRow(rows[0]) : findById(id));
    });
}

function getByMerchantUserId(userId, callback) {
    const sql = `
        SELECT products.product_id, products.salon_id, products.name, products.price,
            products.stock_quantity, products.image_url, salons.salon_name
        FROM products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        WHERE salons.merchant_id = ?
        ORDER BY products.product_id DESC
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapRow));
    });
}

function findForMerchant(userId, productId, callback) {
    const sql = `
        SELECT products.product_id, products.salon_id, products.name, products.price,
            products.stock_quantity, products.image_url, salons.salon_name
        FROM products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        WHERE salons.merchant_id = ?
            AND products.product_id = ?
        LIMIT 1
    `;

    db.query(sql, [userId, productId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] ? mapRow(rows[0]) : null);
    });
}

function createForMerchant(userId, product, callback) {
    const sql = `
        INSERT INTO products (salon_id, name, price, stock_quantity, image_url)
        SELECT salon_id, ?, ?, ?, ?
        FROM salons
        WHERE merchant_id = ?
        LIMIT 1
    `;

    db.query(sql, [
        product.name,
        product.price,
        product.stockQuantity,
        product.imageUrl || null,
        userId
    ], callback);
}

function updateForMerchant(userId, productId, product, callback) {
    const sql = `
        UPDATE products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        SET products.name = ?,
            products.price = ?,
            products.stock_quantity = ?,
            products.image_url = ?
        WHERE products.product_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [
        product.name,
        product.price,
        product.stockQuantity,
        product.imageUrl || null,
        productId,
        userId
    ], callback);
}

function deleteForMerchant(userId, productId, callback) {
    const sql = `
        DELETE products
        FROM products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        WHERE products.product_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [productId, userId], (error, result) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, result.affectedRows > 0);
    });
}

module.exports = {
    getAll,
    findById,
    getByMerchantUserId,
    findForMerchant,
    createForMerchant,
    updateForMerchant,
    deleteForMerchant
};
