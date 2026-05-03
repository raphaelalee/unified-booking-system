const db = require('../db');

const productDetails = {
    'skin-serum': {
        ingredients: 'Hyaluronic acid, niacinamide, aloe vera, glycerin, green tea extract.',
        howToUse: 'Apply 2-3 drops to clean skin after toner. Use morning or evening before moisturiser.'
    },
    'hair-mask': {
        ingredients: 'Shea butter, argan oil, keratin protein, panthenol, coconut oil.',
        howToUse: 'Apply from mid-lengths to ends after shampoo. Leave for 5-10 minutes, then rinse well.'
    },
    'body-oil': {
        ingredients: 'Sweet almond oil, jojoba oil, vitamin E, lavender oil, chamomile extract.',
        howToUse: 'Massage onto damp skin after showering or after a spa treatment.'
    },
    'lip-tint': {
        ingredients: 'Jojoba oil, rosehip oil, shea butter, vitamin E, mineral pigments.',
        howToUse: 'Swipe directly onto lips. Add another layer for stronger colour.'
    },
    'cream-cleanser': {
        ingredients: 'Aloe vera, oat extract, glycerin, chamomile, mild coconut-derived cleansers.',
        howToUse: 'Massage onto damp skin for 30 seconds, then rinse with lukewarm water.'
    },
    'room-mist': {
        ingredients: 'Purified water, botanical fragrance blend, lavender, bergamot, cedarwood.',
        howToUse: 'Mist 2-3 sprays into the air or onto linens from a distance.'
    }
};

const fallbackProducts = [
    { id: 'skin-serum', name: 'Hydrating Glow Serum', category: 'Skincare', price: 38, description: 'Best after facial treatments', ...productDetails['skin-serum'] },
    { id: 'hair-mask', name: 'Repair Hair Mask', category: 'Haircare', price: 32, description: 'For coloured or dry hair', ...productDetails['hair-mask'] },
    { id: 'body-oil', name: 'Calming Body Oil', category: 'Bodycare', price: 28, description: 'Spa-inspired daily care', ...productDetails['body-oil'] },
    { id: 'lip-tint', name: 'Soft Rose Lip Tint', category: 'Makeup', price: 18, description: 'Lightweight everyday colour', ...productDetails['lip-tint'] },
    { id: 'cream-cleanser', name: 'Gentle Cream Cleanser', category: 'Skincare', price: 24, description: 'For daily cleansing after facials', ...productDetails['cream-cleanser'] },
    { id: 'room-mist', name: 'Botanical Room Mist', category: 'Wellness', price: 22, description: 'Calm spa scent for home', ...productDetails['room-mist'] }
];

function getDefaultDetails(product) {
    const text = `${product.name || ''} ${product.category || ''}`.toLowerCase();

    if (text.includes('hair')) return productDetails['hair-mask'];
    if (text.includes('body') || text.includes('oil')) return productDetails['body-oil'];
    if (text.includes('lip') || text.includes('makeup')) return productDetails['lip-tint'];
    if (text.includes('cleanser')) return productDetails['cream-cleanser'];
    if (text.includes('mist') || text.includes('wellness') || text.includes('fragrance')) return productDetails['room-mist'];
    return productDetails['skin-serum'];
}

function withDetails(product) {
    return {
        ...product,
        ...getDefaultDetails(product),
        ingredients: product.ingredients || getDefaultDetails(product).ingredients,
        howToUse: product.howToUse || getDefaultDetails(product).howToUse
    };
}

function mapRow(row) {
    return withDetails({
        id: row.product_id,
        productId: row.product_id,
        salonId: row.salon_id,
        salonName: row.salon_name || 'Vaniday Merchant',
        category: row.salon_name || 'Merchant Product',
        name: row.name,
        price: Number(row.price),
        stockQuantity: Number(row.stock_quantity || 0),
        imageUrl: row.image_url || '',
        description: row.description || (row.salon_name
            ? `Available from ${row.salon_name}`
            : `Stock: ${Number(row.stock_quantity || 0)}`),
        ingredients: row.ingredients || '',
        howToUse: row.how_to_use || ''
    });
}

function getFallbackAll() {
    return fallbackProducts.map((product) => withDetails(product));
}

function getAll(callback) {
    if (!callback) {
        return getFallbackAll();
    }

    const sql = `
        SELECT products.product_id, products.salon_id, products.name, products.price,
            products.stock_quantity, products.image_url, products.description,
            products.ingredients, products.how_to_use, salons.salon_name
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
            products.stock_quantity, products.image_url, products.description,
            products.ingredients, products.how_to_use, salons.salon_name
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
            products.stock_quantity, products.image_url, products.description,
            products.ingredients, products.how_to_use, salons.salon_name
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
            products.stock_quantity, products.image_url, products.description,
            products.ingredients, products.how_to_use, salons.salon_name
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
        INSERT INTO products (salon_id, name, price, stock_quantity, image_url, description, ingredients, how_to_use)
        SELECT salon_id, ?, ?, ?, ?, ?, ?, ?
        FROM salons
        WHERE merchant_id = ?
        LIMIT 1
    `;

    db.query(sql, [
        product.name,
        product.price,
        product.stockQuantity,
        product.imageUrl || null,
        product.description,
        product.ingredients,
        product.howToUse,
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
            products.image_url = ?,
            products.description = ?,
            products.ingredients = ?,
            products.how_to_use = ?
        WHERE products.product_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [
        product.name,
        product.price,
        product.stockQuantity,
        product.imageUrl || null,
        product.description,
        product.ingredients,
        product.howToUse,
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
