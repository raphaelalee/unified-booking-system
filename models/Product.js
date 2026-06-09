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

const productCategories = [
    { name: 'Sets', order: 70, keywords: ['bundle', 'set', 'kit', 'collection'] },
    { name: 'Haircare', order: 10, keywords: ['hair', 'shampoo', 'conditioner', 'scalp', 'keratin'] },
    { name: 'Skincare', order: 20, keywords: ['serum', 'cleanser', 'face wash', 'facial', 'skin', 'pore', 'foam', 'toner', 'moisturiser', 'sunscreen', 'mask sheet', 'face mask'] },
    { name: 'Bodycare', order: 30, keywords: ['body', 'oil', 'lotion', 'scrub', 'butter'] },
    { name: 'Wellness', order: 40, keywords: ['room mist', 'mist', 'fragrance', 'scent', 'aroma', 'candle', 'diffuser', 'linen'] },
    { name: 'Makeup', order: 50, keywords: ['lip', 'tint', 'makeup', 'colour', 'mascara', 'blush'] },
    { name: 'Nailcare', order: 60, keywords: ['nail', 'polish', 'manicure', 'pedicure', 'gel'] }
];

const productImageFallbacks = [
    {
        keywords: ['anua', 'cleansing foam', 'face wash', 'cleanser'],
        url: '/images/anua.2.webp'
    },
    {
        keywords: ['hair care bundle', 'bundle set', 'hair bundle'],
        url: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['scalp', 'hair growth'],
        url: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['effaclar', 'concentrated serum', 'treatment serum'],
        url: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['massage oil', 'body oil', 'aromatherapy'],
        url: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['face mask', 'hydrating mask', 'facial mask'],
        url: 'https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['nail polish', 'gel nail', 'polish'],
        url: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['shampoo', 'conditioner'],
        url: 'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['lip tint', 'makeup', 'lipstick'],
        url: 'https://images.unsplash.com/photo-1588689489981-df0979a21e9f?auto=format&fit=crop&w=900&q=80'
    },
    {
        keywords: ['room mist', 'fragrance', 'diffuser', 'candle'],
        url: '/images/product-room-mist.svg'
    }
];

const categoryImageFallbacks = {
    Bodycare: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=900&q=80',
    Haircare: 'https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?auto=format&fit=crop&w=900&q=80',
    Makeup: 'https://images.unsplash.com/photo-1588689489981-df0979a21e9f?auto=format&fit=crop&w=900&q=80',
    Nailcare: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=80',
    Sets: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=900&q=80',
    Skincare: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=900&q=80',
    Wellness: '/images/product-room-mist.svg'
};

function getFeaturedWindowCondition(tableName) {
    return `(
        ${tableName}.is_featured = 1
        AND (${tableName}.featured_start_date IS NULL OR ${tableName}.featured_start_date <= CURDATE())
        AND (${tableName}.featured_end_date IS NULL OR ${tableName}.featured_end_date >= CURDATE())
    )`;
}

function runSequential(tasks, callback) {
    let index = 0;

    function next(error) {
        if (error || index >= tasks.length) {
            callback(error || null);
            return;
        }

        const task = tasks[index];
        index += 1;
        task(next);
    }

    next();
}

function classifyProductCategory(product) {
    const text = `${product?.name || ''} ${product?.description || ''}`.toLowerCase();
    const category = productCategories.find((entry) => entry.keywords.some((keyword) => text.includes(keyword)));
    return category?.name || 'Skincare';
}

function getFallbackImageUrl(product) {
    const text = `${product?.name || ''} ${product?.description || ''} ${product?.category || ''}`.toLowerCase();
    const productMatch = productImageFallbacks.find((entry) => entry.keywords.some((keyword) => text.includes(keyword)));

    if (productMatch) {
        return productMatch.url;
    }

    return categoryImageFallbacks[product?.category] || categoryImageFallbacks.Skincare;
}

function validateFeaturedDates(startDate, endDate) {
    const normalizedStart = String(startDate || '').trim() || null;
    const normalizedEnd = String(endDate || '').trim() || null;

    if (normalizedStart && Number.isNaN(new Date(normalizedStart).getTime())) {
        return { error: 'Please enter a valid featured start date.' };
    }

    if (normalizedEnd && Number.isNaN(new Date(normalizedEnd).getTime())) {
        return { error: 'Please enter a valid featured end date.' };
    }

    if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
        return { error: 'Featured end date must be on or after the featured start date.' };
    }

    return {
        startDate: normalizedStart,
        endDate: normalizedEnd
    };
}

function normalizeFeaturedOrder(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function ensureProductSchema(callback) {
    db.query('SHOW COLUMNS FROM products', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        const imageUrlColumn = columns.find((column) => column.Field === 'image_url');

        if (!fields.has('description')) {
            alters.push('ADD COLUMN description TEXT');
        }

        if (!fields.has('ingredients')) {
            alters.push('ADD COLUMN ingredients TEXT');
        }

        if (!fields.has('how_to_use')) {
            alters.push('ADD COLUMN how_to_use TEXT');
        }

        if (!fields.has('category_id')) {
            alters.push('ADD COLUMN category_id INT DEFAULT NULL');
        }

        if (!fields.has('created_at')) {
            alters.push('ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
        }

        if (!fields.has('updated_at')) {
            alters.push('ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
        }

        if (!fields.has('image_url')) {
            alters.push('ADD COLUMN image_url TEXT');
        } else if (!String(imageUrlColumn.Type || '').toLowerCase().includes('text')) {
            alters.push('MODIFY COLUMN image_url TEXT');
        }

        if (!fields.has('is_featured')) {
            alters.push('ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0');
        }

        if (!fields.has('featured_order')) {
            alters.push('ADD COLUMN featured_order INT NOT NULL DEFAULT 0');
        }

        if (!fields.has('featured_start_date')) {
            alters.push('ADD COLUMN featured_start_date DATE DEFAULT NULL');
        }

        if (!fields.has('featured_end_date')) {
            alters.push('ADD COLUMN featured_end_date DATE DEFAULT NULL');
        }

        const continueSetup = () => ensureProductCategories(callback);

        if (alters.length === 0) {
            continueSetup();
            return;
        }

        db.query(`ALTER TABLE products ${alters.join(', ')}`, (alterError) => {
            if (alterError) {
                callback(alterError);
                return;
            }

            continueSetup();
        });
    });
}

function ensureProductCategories(callback) {
    db.query('SHOW COLUMNS FROM categories', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('display_order')) {
            alters.push('ADD COLUMN display_order INT NOT NULL DEFAULT 999');
        }

        if (!fields.has('category_scope')) {
            alters.push("ADD COLUMN category_scope VARCHAR(20) NOT NULL DEFAULT 'service'");
        }

        const continueSetup = () => {
            const tasks = productCategories.map((category) => (next) => {
                db.query(
                    `
                        INSERT INTO categories (category_name, display_order, category_scope)
                        SELECT ?, ?, 'product'
                        FROM DUAL
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM categories
                            WHERE category_name = ?
                                AND category_scope = 'product'
                        )
                    `,
                    [category.name, category.order, category.name],
                    (insertError) => {
                        if (insertError) {
                            next(insertError);
                            return;
                        }

                        db.query(
                            `
                                UPDATE categories
                                SET display_order = ?
                                WHERE category_name = ?
                                    AND category_scope = 'product'
                            `,
                            [category.order, category.name],
                            next
                        );
                    }
                );
            });

            tasks.push((next) => autoCategorizeProducts(next));
            runSequential(tasks, callback);
        };

        if (!alters.length) {
            continueSetup();
            return;
        }

        db.query(`ALTER TABLE categories ${alters.join(', ')}`, (alterError) => {
            if (alterError) {
                callback(alterError);
                return;
            }

            continueSetup();
        });
    });
}

function autoCategorizeProducts(callback) {
    const sql = `
        SELECT products.product_id, products.name, products.description,
            categories.category_name, categories.category_scope
        FROM products
        LEFT JOIN categories ON categories.category_id = products.category_id
    `;

    db.query(sql, (error, rows = []) => {
        if (error || !rows.length) {
            callback(error || null);
            return;
        }

        const tasks = rows.map((row) => (next) => {
            const categoryName = classifyProductCategory(row);

            if (row.category_scope === 'product' && row.category_name === categoryName) {
                next();
                return;
            }

            db.query(
                `
                    UPDATE products
                    INNER JOIN categories
                        ON categories.category_name = ?
                        AND categories.category_scope = 'product'
                    SET products.category_id = categories.category_id
                    WHERE products.product_id = ?
                `,
                [categoryName, row.product_id],
                next
            );
        });

        runSequential(tasks, callback);
    });
}

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
    const fallbackImageUrl = getFallbackImageUrl(product);

    return {
        ...product,
        ...getDefaultDetails(product),
        ingredients: product.ingredients || getDefaultDetails(product).ingredients,
        howToUse: product.howToUse || getDefaultDetails(product).howToUse,
        fallbackImageUrl
    };
}

function mapRow(row) {
    return withDetails({
        id: row.product_id,
        productId: row.product_id,
        salonId: row.salon_id,
        salonName: row.salon_name || 'Vaniday Merchant',
        categoryId: row.category_id || null,
        category: row.category_name || 'Uncategorised',
        name: row.name,
        price: Number(row.price),
        stockQuantity: Number(row.stock_quantity || 0),
        imageUrl: row.image_url || '',
        description: row.description || (row.salon_name
            ? `Available from ${row.salon_name}`
            : `Stock: ${Number(row.stock_quantity || 0)}`),
        ingredients: row.ingredients || '',
        howToUse: row.how_to_use || '',
        isFeatured: Boolean(row.is_featured),
        featuredOrder: Number(row.featured_order || 0),
        featuredStartDate: row.featured_start_date || null,
        featuredEndDate: row.featured_end_date || null
    });
}

function getFallbackAll() {
    return [];
}

function getFallbackByCategory(categoryName) {
    const normalizedCategory = String(categoryName || '').trim().toLowerCase();
    return getFallbackAll().filter((product) => String(product.category || '').toLowerCase() === normalizedCategory);
}

function getAll(callback) {
    if (!callback) {
        return getFallbackAll();
    }

    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id,
                products.name, products.price, products.stock_quantity,
                products.image_url, products.description, products.ingredients,
                products.how_to_use, products.is_featured, products.featured_order,
                products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            ORDER BY products.is_featured DESC, products.featured_order, products.product_id DESC
        `;

        db.query(sql, (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            const databaseProducts = rows.map(mapRow);
            callback(null, databaseProducts.length > 0 ? databaseProducts : getFallbackAll());
        });
    });
}

function getAllByCategory(categoryName, callback) {
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id,
                products.name, products.price, products.stock_quantity,
                products.image_url, products.description, products.ingredients,
                products.how_to_use, products.is_featured, products.featured_order,
                products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            WHERE LOWER(categories.category_name) = ?
                AND categories.category_scope = 'product'
            ORDER BY products.is_featured DESC, products.featured_order, products.product_id DESC
        `;

        db.query(sql, [String(categoryName || '').trim().toLowerCase()], (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            const databaseProducts = rows.map(mapRow);
            callback(null, databaseProducts.length > 0 ? databaseProducts : getFallbackByCategory(categoryName));
        });
    });
}

function getAllMerchantProducts(callback) {
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id, products.name, products.price,
                products.stock_quantity, products.image_url, products.description,
                products.ingredients, products.how_to_use, products.is_featured,
                products.featured_order, products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            INNER JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            ORDER BY salons.salon_name, products.is_featured DESC, products.featured_order, products.product_id DESC
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

function findById(id, callback) {
    if (!callback) {
        return null;
    }

    if (!Number.isInteger(Number(id))) {
        callback(null, null);
        return;
    }

    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id,
                products.name, products.price, products.stock_quantity,
                products.image_url, products.description, products.ingredients,
                products.how_to_use, products.is_featured, products.featured_order,
                products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            WHERE products.product_id = ?
            LIMIT 1
        `;

        db.query(sql, [id], (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] ? mapRow(rows[0]) : null);
        });
    });
}

function findMerchantProductById(id, callback) {
    const productId = Number(id);

    if (!Number.isInteger(productId) || productId < 1) {
        callback(null, null);
        return;
    }

    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id,
                products.name, products.price, products.stock_quantity,
                products.image_url, products.description, products.ingredients,
                products.how_to_use, products.is_featured, products.featured_order,
                products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            WHERE products.product_id = ?
            LIMIT 1
        `;

        db.query(sql, [productId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] ? mapRow(rows[0]) : null);
        });
    });
}

function getByMerchantUserId(userId, callback) {
    const sql = `
            SELECT products.product_id, products.salon_id, products.category_id,
                products.name, products.price, products.stock_quantity,
                products.image_url, products.description, products.ingredients,
                products.how_to_use, products.is_featured, products.featured_order,
                products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            INNER JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
        ORDER BY products.is_featured DESC, products.featured_order, products.product_id DESC
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
        SELECT products.product_id, products.salon_id, products.category_id,
            products.name, products.price, products.stock_quantity,
            products.image_url, products.description, products.ingredients,
            products.how_to_use, products.is_featured, products.featured_order,
            products.featured_start_date, products.featured_end_date,
            salons.salon_name, categories.category_name
        FROM products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        LEFT JOIN categories ON categories.category_id = products.category_id
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
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO products (salon_id, name, price, stock_quantity, image_url, description, ingredients, how_to_use, category_id)
            SELECT salon_id, ?, ?, ?, ?, ?, ?, ?, ?
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
            product.categoryId !== undefined ? product.categoryId : null,
            userId
        ], callback);
    });
}

function createAsAdmin(product, callback) {
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO products (salon_id, name, price, stock_quantity, image_url, description, ingredients, how_to_use)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            product.salonId,
            product.name,
            product.price,
            product.stockQuantity,
            product.imageUrl || null,
            product.description,
            product.ingredients,
            product.howToUse
        ], callback);
    });
}

function updateForMerchant(userId, productId, product, callback) {
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE products
            INNER JOIN salons ON salons.salon_id = products.salon_id
            SET products.name = ?,
                products.price = ?,
                products.stock_quantity = ?,
                products.image_url = ?,
                products.description = ?,
                products.ingredients = ?,
                products.how_to_use = ?,
                products.category_id = ?
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
            product.categoryId !== undefined ? product.categoryId : null,
            productId,
            userId
        ], callback);
    });
}

function updateAsAdmin(productId, product, callback) {
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE products
            SET salon_id = ?,
                name = ?,
                price = ?,
                stock_quantity = ?,
                image_url = ?,
                description = ?,
                ingredients = ?,
                how_to_use = ?
            WHERE product_id = ?
        `;

        db.query(sql, [
            product.salonId,
            product.name,
            product.price,
            product.stockQuantity,
            product.imageUrl || null,
            product.description,
            product.ingredients,
            product.howToUse,
            productId
        ], callback);
    });
}

function restockForMerchant(userId, productId, quantity, callback) {
    const restockQuantity = Math.max(1, Math.min(Math.floor(Number(quantity || 1)), 999));
    const sql = `
        UPDATE products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        SET products.stock_quantity = products.stock_quantity + ?
        WHERE products.product_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [restockQuantity, productId, userId], callback);
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

function deleteAsAdmin(productId, callback) {
    db.query('DELETE FROM products WHERE product_id = ?', [productId], (error, result) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, result.affectedRows > 0);
    });
}

function getFeaturedProducts(callback) {
    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id, products.name, products.price,
                products.stock_quantity, products.image_url, products.description,
                products.ingredients, products.how_to_use, products.is_featured,
                products.featured_order, products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            WHERE ${getFeaturedWindowCondition('products')}
            ORDER BY products.featured_order, products.product_id DESC
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

function getFeaturedProductsByMerchant(merchantId, callback) {
    const salonId = Number(merchantId);

    if (!Number.isInteger(salonId) || salonId < 1) {
        callback(null, []);
        return;
    }

    return ensureProductSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT products.product_id, products.salon_id, products.category_id, products.name, products.price,
                products.stock_quantity, products.image_url, products.description,
                products.ingredients, products.how_to_use, products.is_featured,
                products.featured_order, products.featured_start_date, products.featured_end_date,
                salons.salon_name, categories.category_name
            FROM products
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            LEFT JOIN categories ON categories.category_id = products.category_id
            WHERE products.salon_id = ?
                AND ${getFeaturedWindowCondition('products')}
            ORDER BY products.featured_order, products.product_id DESC
        `;

        db.query(sql, [salonId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapRow));
        });
    });
}

function countFeaturedProductsByMerchant(userId, callback) {
    const sql = `
        SELECT COUNT(*) AS total
        FROM products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        WHERE salons.merchant_id = ?
            AND products.is_featured = 1
    `;

    db.query(sql, [userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, Number(rows[0]?.total || 0));
    });
}

function markProductFeatured(userId, productId, payload, callback) {
    const normalizedProductId = Number(productId);
    const { error: dateError, startDate, endDate } = validateFeaturedDates(payload?.featuredStartDate, payload?.featuredEndDate);

    if (!Number.isInteger(normalizedProductId) || normalizedProductId < 1) {
        callback(new Error('Invalid product selected.'));
        return;
    }

    if (dateError) {
        callback(new Error(dateError));
        return;
    }

    findForMerchant(userId, normalizedProductId, (lookupError, product) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (!product) {
            callback(new Error('This product does not belong to your merchant account.'));
            return;
        }

        countFeaturedProductsByMerchant(userId, (countError, featuredCount) => {
            if (countError) {
                callback(countError);
                return;
            }

            if (!product.isFeatured && featuredCount >= 3) {
                callback(new Error('You can feature at most 3 products at a time.'));
                return;
            }

            const sql = `
                UPDATE products
                INNER JOIN salons ON salons.salon_id = products.salon_id
                SET products.is_featured = 1,
                    products.featured_order = ?,
                    products.featured_start_date = ?,
                    products.featured_end_date = ?
                WHERE products.product_id = ?
                    AND salons.merchant_id = ?
            `;

            db.query(sql, [
                normalizeFeaturedOrder(payload?.featuredOrder),
                startDate,
                endDate,
                normalizedProductId,
                userId
            ], callback);
        });
    });
}

function removeProductFeatured(userId, productId, callback) {
    const sql = `
        UPDATE products
        INNER JOIN salons ON salons.salon_id = products.salon_id
        SET products.is_featured = 0,
            products.featured_order = 0,
            products.featured_start_date = NULL,
            products.featured_end_date = NULL
        WHERE products.product_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [productId, userId], callback);
}

module.exports = {
    getAll,
    getAllByCategory,
    getAllMerchantProducts,
    getFeaturedProducts,
    getFeaturedProductsByMerchant,
    countFeaturedProductsByMerchant,
    markProductFeatured,
    removeProductFeatured,
    findById,
    findMerchantProductById,
    getByMerchantUserId,
    findForMerchant,
    createAsAdmin,
    createForMerchant,
    updateAsAdmin,
    updateForMerchant,
    restockForMerchant,
    deleteAsAdmin,
    deleteForMerchant
};
