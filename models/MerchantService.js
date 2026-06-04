const db = require('../db');

const productCategoryOptions = [
    { name: 'Haircare', order: 10 },
    { name: 'Skincare', order: 20 },
    { name: 'Bodycare', order: 30 },
    { name: 'Wellness', order: 40 },
    { name: 'Makeup', order: 50 },
    { name: 'Nailcare', order: 60 },
    { name: 'Sets', order: 70 }
];

ensureServiceSchema((error) => {
    if (error) {
        console.error('Service package schema could not be prepared:', error.message || error);
    }
});

ensureCategorySchema((error) => {
    if (error) {
        console.error('Service category schema could not be prepared:', error.message || error);
    }
});

ensureSalonCommissionSchema((error) => {
    if (error) {
        console.error('Salon commission schema could not be prepared:', error.message || error);
    }
});

ensureMerchantProfileSchema((error) => {
    if (error) {
        console.error('Merchant profile schema could not be prepared:', error.message || error);
    }
});

ensureMerchantFeaturedSchema((error) => {
    if (error) {
        console.error('Merchant featured schema could not be prepared:', error.message || error);
    }
});

ensureServiceInventorySchema((error) => {
    if (error) {
        console.error('Service inventory schema could not be prepared:', error.message || error);
    }
});

function formatTimeSlot(value) {
    if (!value) {
        return '';
    }

    if (typeof value === 'string') {
        return value.slice(0, 5);
    }

    return value;
}

function parseSlots(slots) {
    return String(slots || '')
        .split(',')
        .map((slot) => slot.trim())
        .filter(Boolean);
}

function getPackageFields(row) {
    const sessionCount = Number(row.package_sessions || 0);
    const packagePrice = Number(row.package_price || 0);
    const enabled = Boolean(row.package_enabled) && sessionCount > 0 && packagePrice > 0;

    return {
        packageEnabled: enabled,
        packageSessions: enabled ? sessionCount : 0,
        packagePrice: enabled ? packagePrice : 0,
        packageLabel: enabled ? `${sessionCount}-session package` : ''
    };
}

function ensureServiceSchema(callback) {
    db.query('SHOW COLUMNS FROM services', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('package_enabled')) {
            alters.push('ADD COLUMN package_enabled TINYINT(1) NOT NULL DEFAULT 0');
        }

        if (!fields.has('package_sessions')) {
            alters.push('ADD COLUMN package_sessions INT NOT NULL DEFAULT 0');
        }

        if (!fields.has('package_price')) {
            alters.push('ADD COLUMN package_price DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }

        if (!fields.has('gender_target')) {
            alters.push("ADD COLUMN gender_target ENUM('male','female','unisex') NOT NULL DEFAULT 'unisex'");
        }

        if (!fields.has('display_order')) {
            alters.push('ADD COLUMN display_order INT NOT NULL DEFAULT 999');
        }

        if (!fields.has('short_description')) {
            alters.push('ADD COLUMN short_description VARCHAR(255) DEFAULT NULL');
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

        if (alters.length === 0) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE services ${alters.join(', ')}`, callback);
    });
}

function ensureMerchantFeaturedSchema(callback) {
    db.query('SHOW COLUMNS FROM salons', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('is_featured')) alters.push('ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0');
        if (!fields.has('featured_type')) alters.push('ADD COLUMN featured_type VARCHAR(50) DEFAULT NULL');
        if (!fields.has('featured_order')) alters.push('ADD COLUMN featured_order INT NOT NULL DEFAULT 0');
        if (!fields.has('featured_start_date')) alters.push('ADD COLUMN featured_start_date DATE DEFAULT NULL');
        if (!fields.has('featured_end_date')) alters.push('ADD COLUMN featured_end_date DATE DEFAULT NULL');
        if (!fields.has('featured_score')) alters.push('ADD COLUMN featured_score DECIMAL(10,2) NOT NULL DEFAULT 0.00');

        if (!alters.length) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE salons ${alters.join(', ')}`, callback);
    });
}

function getFeaturedWindowCondition(tableName) {
    return `(
        ${tableName}.is_featured = 1
        AND (${tableName}.featured_start_date IS NULL OR ${tableName}.featured_start_date <= CURDATE())
        AND (${tableName}.featured_end_date IS NULL OR ${tableName}.featured_end_date >= CURDATE())
    )`;
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
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return Math.max(0, Math.floor(numeric));
}

function normalizeFeaturedType(value) {
    const allowed = new Set(['featured_month', 'sponsored', 'trending', 'top_rated']);
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.has(normalized) ? normalized : null;
}

function getServiceFeaturedFields(row) {
    return {
        isFeatured: Boolean(row.is_featured),
        featuredOrder: Number(row.featured_order || 0),
        featuredStartDate: row.featured_start_date || null,
        featuredEndDate: row.featured_end_date || null
    };
}

function getMerchantFeaturedFields(row) {
    return {
        isFeatured: Boolean(row.is_featured),
        featuredType: row.featured_type || '',
        featuredOrder: Number(row.featured_order || 0),
        featuredStartDate: row.featured_start_date || null,
        featuredEndDate: row.featured_end_date || null,
        featuredScore: Number(row.featured_score || 0)
    };
}

function ensureCategorySchema(callback) {
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

        const continueSetup = () => ensureProductCategoryRows(callback);

        if (alters.length === 0) {
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

function ensureProductCategoryRows(callback) {
    let index = 0;

    function next(error) {
        if (error || index >= productCategoryOptions.length) {
            callback(error || null);
            return;
        }

        const category = productCategoryOptions[index];
        index += 1;

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
    }

    next();
}

function ensureSalonCommissionSchema(callback) {
    db.query('SHOW COLUMNS FROM salons', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));

        if (fields.has('commission_rate')) {
            callback(null);
            return;
        }

        db.query(
            'ALTER TABLE salons ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 15.00',
            callback
        );
    });
}

function ensureMerchantProfileSchema(callback) {
    db.query('SHOW COLUMNS FROM salons', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('business_category')) alters.push("ADD COLUMN business_category VARCHAR(80) DEFAULT NULL AFTER salon_name");
        if (!fields.has('uen')) alters.push('ADD COLUMN uen VARCHAR(20) DEFAULT NULL AFTER business_category');
        if (!fields.has('years_in_business')) alters.push('ADD COLUMN years_in_business INT DEFAULT NULL AFTER uen');
        if (!fields.has('staff_count')) alters.push('ADD COLUMN staff_count INT DEFAULT NULL AFTER years_in_business');

        if (!alters.length) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE salons ${alters.join(', ')}`, callback);
    });
}

function ensureServiceInventorySchema(callback) {
    const sql = `
        CREATE TABLE IF NOT EXISTS service_inventory_links (
            service_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity_required INT NOT NULL DEFAULT 1,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (service_id),
            KEY idx_service_inventory_product (product_id),
            CONSTRAINT fk_service_inventory_service FOREIGN KEY (service_id) REFERENCES services (service_id) ON DELETE CASCADE,
            CONSTRAINT fk_service_inventory_product FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, callback);
}

function decorateServiceInventory(items, callback) {
    const collection = Array.isArray(items) ? items : [];
    const serviceIds = collection
        .map((service) => Number(service?.id || service?.serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0);

    if (!serviceIds.length) {
        callback(null, collection);
        return;
    }

    ensureServiceInventorySchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const placeholders = serviceIds.map(() => '?').join(', ');
        const sql = `
            SELECT
                service_inventory_links.service_id,
                service_inventory_links.product_id,
                service_inventory_links.quantity_required,
                products.name AS product_name,
                products.stock_quantity
            FROM service_inventory_links
            INNER JOIN products ON products.product_id = service_inventory_links.product_id
            WHERE service_inventory_links.service_id IN (${placeholders})
        `;

        db.query(sql, serviceIds, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            const inventoryMap = rows.reduce((map, row) => {
                const quantityRequired = Math.max(1, Number(row.quantity_required || 1));
                const stockQuantity = Math.max(0, Number(row.stock_quantity || 0));

                map[String(row.service_id)] = {
                    inventoryProductId: Number(row.product_id),
                    inventoryProductName: row.product_name || 'Linked product',
                    inventoryQuantityRequired: quantityRequired,
                    inventoryStockQuantity: stockQuantity,
                    inventoryBlocked: stockQuantity < quantityRequired
                };
                return map;
            }, {});

            callback(null, collection.map((service) => {
                const inventory = inventoryMap[String(service.id || service.serviceId)] || {};

                return {
                    ...service,
                    inventoryProductId: inventory.inventoryProductId || null,
                    inventoryProductName: inventory.inventoryProductName || '',
                    inventoryQuantityRequired: inventory.inventoryQuantityRequired || 0,
                    inventoryStockQuantity: inventory.inventoryStockQuantity || 0,
                    inventoryBlocked: Boolean(inventory.inventoryBlocked),
                    isActiveFrontend: !inventory.inventoryBlocked
                };
            }));
        });
    });
}

function setInventoryLink(connection, serviceId, productId, quantityRequired, callback) {
    const normalizedProductId = Number(productId);
    const normalizedQuantity = Math.max(1, Number(quantityRequired || 1));

    if (!Number.isInteger(normalizedProductId) || normalizedProductId < 1) {
        connection.query('DELETE FROM service_inventory_links WHERE service_id = ?', [serviceId], callback);
        return;
    }

    const sql = `
        INSERT INTO service_inventory_links (service_id, product_id, quantity_required)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
            product_id = VALUES(product_id),
            quantity_required = VALUES(quantity_required)
    `;

    connection.query(sql, [serviceId, normalizedProductId, normalizedQuantity], callback);
}

function mapMerchantRows(rows) {
    if (!rows || rows.length === 0) {
        return null;
    }

    const first = rows[0];
    const servicesById = new Map();

    rows.forEach((row) => {
        if (!row.service_id) {
            return;
        }

        if (!servicesById.has(row.service_id)) {
            servicesById.set(row.service_id, {
                id: row.service_id,
                serviceId: row.service_id,
                salonId: row.salon_id,
                categoryId: row.category_id,
                category: row.category_name,
                categoryDisplayOrder: Number(row.category_display_order || 999),
                name: row.service_name,
                description: row.description || '',
                shortDescription: row.short_description || '',
                genderTarget: String(row.gender_target || 'unisex'),
                durationMins: row.duration_mins,
                duration: `${row.duration_mins} mins`,
                price: Number(row.price),
                displayOrder: Number(row.display_order || 999),
                ...getServiceFeaturedFields(row),
                ...getPackageFields(row),
                slots: []
            });
        }

        if (row.timeslot) {
            servicesById.get(row.service_id).slots.push(formatTimeSlot(row.timeslot));
        }
    });

    return {
        id: first.salon_id,
        salonId: first.salon_id,
        merchantUserId: first.merchant_id,
        name: first.salon_name,
        location: first.address || 'No address set',
        description: first.salon_description || '',
        ownerName: first.owner_name || '',
        ownerEmail: first.owner_email || '',
        ownerPhone: first.owner_phone || '',
        businessCategory: first.business_category || '',
        uen: first.uen || '',
        yearsInBusiness: first.years_in_business === null ? '' : Number(first.years_in_business),
        staffCount: first.staff_count === null ? '' : Number(first.staff_count),
        commissionRate: Number(first.commission_rate || 15),
        ...getMerchantFeaturedFields(first),
        category: 'Merchant',
        services: Array.from(servicesById.values())
    };
}

function getMerchantByUserId(userId, callback) {
    const sql = `
        SELECT
            salons.salon_id,
            salons.merchant_id,
            salons.salon_name,
            salons.address,
            salons.description AS salon_description,
            salons.business_category,
            salons.uen,
            salons.years_in_business,
            salons.staff_count,
            salons.commission_rate,
            salons.is_featured,
            salons.featured_type,
            salons.featured_order,
            salons.featured_start_date,
            salons.featured_end_date,
            salons.featured_score,
            users.name AS owner_name,
            users.email AS owner_email,
            users.phone AS owner_phone,
            services.service_id,
            services.category_id,
            services.service_name,
            services.description,
            services.duration_mins,
            services.price,
            services.package_enabled,
            services.package_sessions,
            services.package_price,
            services.is_featured,
            services.featured_order,
            services.featured_start_date,
            services.featured_end_date,
            categories.category_name,
            categories.display_order AS category_display_order,
            services.gender_target,
            services.display_order,
            services.short_description,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS timeslot
        FROM salons
        INNER JOIN users ON users.user_id = salons.merchant_id
        LEFT JOIN services ON services.salon_id = salons.salon_id
        LEFT JOIN categories ON categories.category_id = services.category_id
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        WHERE salons.merchant_id = ?
        ORDER BY categories.display_order, services.display_order, services.service_name, service_slots.timeslot
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        const merchant = mapMerchantRows(rows);

        if (!merchant || !Array.isArray(merchant.services) || merchant.services.length === 0) {
            callback(null, merchant);
            return;
        }

        decorateServiceInventory(merchant.services, (inventoryError, services) => {
            if (inventoryError) {
                callback(inventoryError);
                return;
            }

            callback(null, {
                ...merchant,
                services
            });
        });
    });
}

function getMerchantBySalonId(salonId, callback) {
    const sql = `
        SELECT
            salons.salon_id,
            salons.merchant_id,
            salons.salon_name,
            salons.address,
            salons.description AS salon_description,
            salons.business_category,
            salons.uen,
            salons.years_in_business,
            salons.staff_count,
            salons.commission_rate,
            salons.is_featured,
            salons.featured_type,
            salons.featured_order,
            salons.featured_start_date,
            salons.featured_end_date,
            salons.featured_score,
            users.name AS owner_name,
            users.email AS owner_email,
            users.phone AS owner_phone,
            services.service_id,
            services.category_id,
            services.service_name,
            services.description,
            services.duration_mins,
            services.price,
            services.package_enabled,
            services.package_sessions,
            services.package_price,
            services.is_featured,
            services.featured_order,
            services.featured_start_date,
            services.featured_end_date,
            categories.category_name,
            categories.display_order AS category_display_order,
            services.gender_target,
            services.display_order,
            services.short_description,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS timeslot
        FROM salons
        INNER JOIN users ON users.user_id = salons.merchant_id
        LEFT JOIN services ON services.salon_id = salons.salon_id
        LEFT JOIN categories ON categories.category_id = services.category_id
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        WHERE salons.salon_id = ?
        ORDER BY categories.display_order, services.display_order, services.service_name, service_slots.timeslot
    `;

    db.query(sql, [salonId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        const merchant = mapMerchantRows(rows);

        if (!merchant || !Array.isArray(merchant.services) || merchant.services.length === 0) {
            callback(null, merchant);
            return;
        }

        decorateServiceInventory(merchant.services, (inventoryError, services) => {
            if (inventoryError) {
                callback(inventoryError);
                return;
            }

            callback(null, {
                ...merchant,
                services
            });
        });
    });
}

function getCategories(callback) {
    ensureCategorySchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT category_id, category_name, display_order
            FROM categories
            WHERE category_scope = 'service'
            ORDER BY display_order, category_name
        `;

        db.query(sql, callback);
    });
}

function getProductCategories(callback) {
    ensureCategorySchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT category_id, category_name
            FROM categories
            WHERE category_scope = 'product'
            ORDER BY display_order, category_name
        `;

        db.query(sql, callback);
    });
}

function getSalons(callback) {
    const sql = `
        SELECT salons.salon_id, salons.salon_name, salons.address, salons.business_category, users.email AS owner_email
        FROM salons
        INNER JOIN users ON users.user_id = salons.merchant_id
        ORDER BY salons.salon_name
    `;

    db.query(sql, callback);
}

function getAllServices(callback) {
    const sql = `
        SELECT
            services.service_id,
            services.salon_id,
            services.category_id,
            services.service_name,
            services.description,
            services.duration_mins,
            services.price,
            services.gender_target,
            services.package_enabled,
            services.package_sessions,
            services.package_price,
            services.is_featured,
            services.featured_order,
            services.featured_start_date,
            services.featured_end_date,
            categories.category_name,
            salons.salon_name,
            salons.address,
            salons.is_featured AS merchant_is_featured,
            salons.featured_type AS merchant_featured_type,
            salons.featured_score AS merchant_featured_score,
            users.email AS owner_email,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS timeslot
        FROM services
        INNER JOIN salons ON salons.salon_id = services.salon_id
        INNER JOIN users ON users.user_id = salons.merchant_id
        LEFT JOIN categories ON categories.category_id = services.category_id
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        ORDER BY salons.salon_name, categories.display_order, services.display_order, services.service_name, service_slots.timeslot
    `;

    db.query(sql, (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        const servicesById = new Map();

        rows.forEach((row) => {
            if (!servicesById.has(row.service_id)) {
                servicesById.set(row.service_id, {
                    id: row.service_id,
                    serviceId: row.service_id,
                    salonId: row.salon_id,
                    salonName: row.salon_name,
                    salonAddress: row.address || '',
                    ownerEmail: row.owner_email,
                    categoryId: row.category_id,
                    category: row.category_name,
                    name: row.service_name,
                    description: row.description || '',
                    durationMins: row.duration_mins,
                    duration: `${row.duration_mins} mins`,
                    price: Number(row.price),
                    genderTarget: String(row.gender_target || 'unisex'),
                    ...getServiceFeaturedFields(row),
                    merchantIsFeatured: Boolean(row.merchant_is_featured),
                    merchantFeaturedType: row.merchant_featured_type || '',
                    merchantFeaturedScore: Number(row.merchant_featured_score || 0),
                    ...getPackageFields(row),
                    slots: []
                });
            }

            if (row.timeslot) {
                servicesById.get(row.service_id).slots.push(formatTimeSlot(row.timeslot));
            }
        });

        decorateServiceInventory(Array.from(servicesById.values()), callback);
    });
}

function findServiceForMerchant(userId, serviceId, callback) {
    const sql = `
        SELECT
            services.service_id,
            services.salon_id,
            services.category_id,
            services.service_name,
            services.description,
            services.duration_mins,
            services.price,
            services.package_enabled,
            services.package_sessions,
            services.package_price,
            services.gender_target,
            services.display_order,
            services.short_description,
            categories.category_name,
            categories.display_order AS category_display_order,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS timeslot
        FROM services
        INNER JOIN salons ON salons.salon_id = services.salon_id
        LEFT JOIN categories ON categories.category_id = services.category_id
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        WHERE salons.merchant_id = ?
            AND services.service_id = ?
        ORDER BY service_slots.timeslot
    `;

    db.query(sql, [userId, serviceId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        if (rows.length === 0) {
            callback(null, null);
            return;
        }

        const first = rows[0];

        decorateServiceInventory([{
            id: first.service_id,
            serviceId: first.service_id,
            salonId: first.salon_id,
            categoryId: first.category_id,
            category: first.category_name,
            name: first.service_name,
            description: first.description || '',
            durationMins: first.duration_mins,
            duration: `${first.duration_mins} mins`,
            price: Number(first.price),
            ...getServiceFeaturedFields(first),
            ...getPackageFields(first),
            slots: rows.map((row) => formatTimeSlot(row.timeslot)).filter(Boolean)
        }], (inventoryError, services) => {
            if (inventoryError) {
                callback(inventoryError);
                return;
            }

            callback(null, services[0] || null);
        });
    });
}

function findServiceById(serviceId, callback) {
    const sql = `
        SELECT
            services.service_id,
            services.salon_id,
            services.category_id,
            services.service_name,
            services.description,
            services.duration_mins,
            services.price,
            services.package_enabled,
            services.package_sessions,
            services.package_price,
            services.gender_target,
            services.display_order,
            services.short_description,
            categories.category_name,
            categories.display_order AS category_display_order,
            salons.salon_name,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS timeslot
        FROM services
        INNER JOIN salons ON salons.salon_id = services.salon_id
        LEFT JOIN categories ON categories.category_id = services.category_id
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        WHERE services.service_id = ?
        ORDER BY service_slots.timeslot
    `;

    db.query(sql, [serviceId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        if (rows.length === 0) {
            callback(null, null);
            return;
        }

        const first = rows[0];

        decorateServiceInventory([{
            id: first.service_id,
            serviceId: first.service_id,
            salonId: first.salon_id,
            salonName: first.salon_name,
            categoryId: first.category_id,
            category: first.category_name,
            name: first.service_name,
            description: first.description || '',
            durationMins: first.duration_mins,
            duration: `${first.duration_mins} mins`,
            price: Number(first.price),
            ...getServiceFeaturedFields(first),
            ...getPackageFields(first),
            slots: rows.map((row) => formatTimeSlot(row.timeslot)).filter(Boolean)
        }], (inventoryError, services) => {
            if (inventoryError) {
                callback(inventoryError);
                return;
            }

            callback(null, services[0] || null);
        });
    });
}

function replaceSlots(connection, serviceId, slots, callback) {
    connection.query('DELETE FROM service_slots WHERE service_id = ?', [serviceId], (deleteError) => {
        if (deleteError) {
            callback(deleteError);
            return;
        }

        const parsedSlots = parseSlots(slots);

        if (parsedSlots.length === 0) {
            callback(null);
            return;
        }

        const values = parsedSlots.map((slot) => [serviceId, slot]);
        connection.query('INSERT INTO service_slots (service_id, timeslot) VALUES ?', [values], callback);
    });
}

function createService(userId, serviceData, callback) {
    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const salonSql = 'SELECT salon_id FROM salons WHERE merchant_id = ? LIMIT 1';

            connection.query(salonSql, [userId], (salonError, salons) => {
                if (salonError || salons.length === 0) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(salonError || new Error('No salon is assigned to this merchant account.'));
                    });
                }

                const insertSql = `
                    INSERT INTO services (salon_id, category_id, service_name, description, duration_mins, price, package_enabled, package_sessions, package_price)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const values = [
                    salons[0].salon_id,
                    serviceData.categoryId,
                    serviceData.name,
                    serviceData.description,
                    serviceData.durationMins,
                    serviceData.price,
                    serviceData.packageEnabled ? 1 : 0,
                    serviceData.packageSessions || 0,
                    serviceData.packagePrice || 0
                ];

                connection.query(insertSql, values, (insertError, result) => {
                    if (insertError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(insertError);
                        });
                    }

                    replaceSlots(connection, result.insertId, serviceData.slots, (slotError) => {
                        if (slotError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(slotError);
                            });
                        }

                        setInventoryLink(connection, result.insertId, serviceData.inventoryProductId, serviceData.inventoryQuantityRequired, (inventoryError) => {
                            if (inventoryError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(inventoryError);
                                });
                            }

                            connection.commit((commitError) => {
                                connection.release();
                                callback(commitError, result.insertId);
                            });
                        });
                    });
                });
            });
        });
    });
}

function createServiceForSalon(serviceData, callback) {
    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const insertSql = `
                INSERT INTO services (salon_id, category_id, service_name, description, duration_mins, price, package_enabled, package_sessions, package_price, gender_target, display_order, short_description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [
                serviceData.salonId,
                serviceData.categoryId,
                serviceData.name,
                serviceData.description,
                serviceData.durationMins,
                serviceData.price,
                serviceData.packageEnabled ? 1 : 0,
                serviceData.packageSessions || 0,
                serviceData.packagePrice || 0,
                serviceData.genderTarget || 'unisex',
                serviceData.displayOrder || 999,
                serviceData.shortDescription || null
            ];

            connection.query(insertSql, values, (insertError, result) => {
                if (insertError) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(insertError);
                    });
                }

                replaceSlots(connection, result.insertId, serviceData.slots, (slotError) => {
                    if (slotError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(slotError);
                        });
                    }

                    connection.commit((commitError) => {
                        connection.release();
                        callback(commitError, result.insertId);
                    });
                });
            });
        });
    });
}

function updateService(userId, serviceId, serviceData, callback) {
    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const updateSql = `
                UPDATE services
                INNER JOIN salons ON salons.salon_id = services.salon_id
                SET services.category_id = ?,
                    services.service_name = ?,
                    services.description = ?,
                    services.duration_mins = ?,
                    services.price = ?,
                    services.package_enabled = ?,
                    services.package_sessions = ?,
                    services.package_price = ?,
                    services.gender_target = ?,
                    services.display_order = ?,
                    services.short_description = ?
                WHERE services.service_id = ?
                    AND salons.merchant_id = ?
            `;
            const values = [
                serviceData.categoryId,
                serviceData.name,
                serviceData.description,
                serviceData.durationMins,
                serviceData.price,
                serviceData.packageEnabled ? 1 : 0,
                serviceData.packageSessions || 0,
                serviceData.packagePrice || 0,
                serviceData.genderTarget || 'unisex',
                serviceData.displayOrder || 999,
                serviceData.shortDescription || null,
                serviceId,
                userId
            ];

            connection.query(updateSql, values, (updateError, result) => {
                if (updateError || result.affectedRows === 0) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(updateError || new Error('Service not found for this merchant account.'));
                    });
                }

                replaceSlots(connection, serviceId, serviceData.slots, (slotError) => {
                    if (slotError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(slotError);
                        });
                    }

                    setInventoryLink(connection, serviceId, serviceData.inventoryProductId, serviceData.inventoryQuantityRequired, (inventoryError) => {
                        if (inventoryError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(inventoryError);
                            });
                        }

                        connection.commit((commitError) => {
                            connection.release();
                            callback(commitError);
                        });
                    });
                });
            });
        });
    });
}

function updateServiceAsAdmin(serviceId, serviceData, callback) {
    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const updateSql = `
                UPDATE services
                SET salon_id = ?,
                    category_id = ?,
                    service_name = ?,
                    description = ?,
                    duration_mins = ?,
                    price = ?,
                    package_enabled = ?,
                    package_sessions = ?,
                    package_price = ?,
                    gender_target = ?,
                    display_order = ?,
                    short_description = ?
                WHERE service_id = ?
            `;
            const values = [
                serviceData.salonId,
                serviceData.categoryId,
                serviceData.name,
                serviceData.description,
                serviceData.durationMins,
                serviceData.price,
                serviceData.packageEnabled ? 1 : 0,
                serviceData.packageSessions || 0,
                serviceData.packagePrice || 0,
                serviceData.genderTarget || 'unisex',
                serviceData.displayOrder || 999,
                serviceData.shortDescription || null,
                serviceId
            ];

            connection.query(updateSql, values, (updateError, result) => {
                if (updateError || result.affectedRows === 0) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(updateError || new Error('Service not found.'));
                    });
                }

                replaceSlots(connection, serviceId, serviceData.slots, (slotError) => {
                    if (slotError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(slotError);
                        });
                    }

                    connection.commit((commitError) => {
                        connection.release();
                        callback(commitError);
                    });
                });
            });
        });
    });
}

function deleteService(userId, serviceId, callback) {
    const sql = `
        DELETE services
        FROM services
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE services.service_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [serviceId, userId], (error, result) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, result.affectedRows > 0);
    });
}

function deleteServiceAsAdmin(serviceId, callback) {
    db.query('DELETE FROM services WHERE service_id = ?', [serviceId], (error, result) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, result.affectedRows > 0);
    });
}

function getAdminOverview(callback) {
    ensureMerchantFeaturedSchema((featuredSchemaError) => {
        if (featuredSchemaError) {
            callback(featuredSchemaError);
            return;
        }

    ensureMerchantProfileSchema((profileSchemaError) => {
        if (profileSchemaError) {
            callback(profileSchemaError);
            return;
        }

        ensureSalonCommissionSchema((schemaError) => {
            if (schemaError) {
                callback(schemaError);
                return;
            }

        const sql = `
            SELECT
                users.user_id AS merchant_user_id,
                users.name AS owner_name,
                users.email AS owner_email,
                users.phone AS owner_phone,
                salons.salon_id,
                salons.salon_name,
                salons.business_category,
                salons.uen,
                salons.years_in_business,
                salons.staff_count,
                salons.address,
                salons.description,
                salons.commission_rate,
                salons.is_featured,
                salons.featured_type,
                salons.featured_order,
                salons.featured_start_date,
                salons.featured_end_date,
                salons.featured_score,
                COUNT(services.service_id) AS service_count
            FROM salons
            INNER JOIN users ON users.user_id = salons.merchant_id
            LEFT JOIN services ON services.salon_id = salons.salon_id
            GROUP BY users.user_id, users.name, users.email, users.phone, salons.salon_id, salons.salon_name, salons.business_category, salons.uen, salons.years_in_business, salons.staff_count, salons.address, salons.description, salons.commission_rate, salons.is_featured, salons.featured_type, salons.featured_order, salons.featured_start_date, salons.featured_end_date, salons.featured_score
            ORDER BY salons.salon_id
        `;

            db.query(sql, callback);
        });
    });
    });
}

function getFeaturedMerchants(callback) {
    ensureMerchantFeaturedSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                salons.salon_id,
                salons.merchant_id,
                salons.salon_name,
                salons.address,
                salons.description,
                salons.business_category,
                salons.image_url,
                salons.is_featured,
                salons.featured_type,
                salons.featured_order,
                salons.featured_start_date,
                salons.featured_end_date,
                salons.featured_score,
                COALESCE(AVG(reviews.rating), 0) AS average_rating,
                COUNT(DISTINCT reviews.review_id) AS review_count
            FROM salons
            LEFT JOIN reviews ON reviews.merchant_id = salons.salon_id
            WHERE ${getFeaturedWindowCondition('salons')}
            GROUP BY salons.salon_id, salons.merchant_id, salons.salon_name, salons.address, salons.description, salons.business_category, salons.image_url, salons.is_featured, salons.featured_type, salons.featured_order, salons.featured_start_date, salons.featured_end_date, salons.featured_score
            ORDER BY salons.featured_order, salons.featured_score DESC, average_rating DESC, salons.salon_name
        `;

        db.query(sql, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => ({
                id: row.salon_id,
                salonId: row.salon_id,
                merchantUserId: row.merchant_id,
                name: row.salon_name,
                location: row.address || 'Singapore',
                description: row.description || '',
                category: row.business_category || 'Merchant',
                imageUrl: row.image_url || '',
                rating: Number(row.average_rating || 0).toFixed(1),
                reviewCount: Number(row.review_count || 0),
                ...getMerchantFeaturedFields(row)
            })));
        });
    });
}

function getFeaturedServices(callback) {
    ensureServiceSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        getAllServices((error, services = []) => {
            if (error) {
                callback(error);
                return;
            }

            const today = new Date().toISOString().slice(0, 10);
            const featuredServices = services
                .filter((service) => service.isFeatured)
                .filter((service) => !service.featuredStartDate || String(service.featuredStartDate).slice(0, 10) <= today)
                .filter((service) => !service.featuredEndDate || String(service.featuredEndDate).slice(0, 10) >= today)
                .sort((left, right) => {
                    if (left.featuredOrder !== right.featuredOrder) {
                        return left.featuredOrder - right.featuredOrder;
                    }

                    return Number(right.merchantFeaturedScore || 0) - Number(left.merchantFeaturedScore || 0);
                });

            callback(null, featuredServices);
        });
    });
}

function getFeaturedServicesByMerchant(merchantId, callback) {
    const salonId = Number(merchantId);

    if (!Number.isInteger(salonId) || salonId < 1) {
        callback(null, []);
        return;
    }

    getMerchantBySalonId(salonId, (error, merchant) => {
        if (error) {
            callback(error);
            return;
        }

        const services = Array.isArray(merchant?.services) ? merchant.services : [];
        const today = new Date().toISOString().slice(0, 10);
        callback(null, services.filter((service) => {
            return service.isFeatured
                && (!service.featuredStartDate || String(service.featuredStartDate).slice(0, 10) <= today)
                && (!service.featuredEndDate || String(service.featuredEndDate).slice(0, 10) >= today);
        }).sort((left, right) => left.featuredOrder - right.featuredOrder));
    });
}

function countFeaturedServicesByMerchant(userId, callback) {
    const sql = `
        SELECT COUNT(*) AS total
        FROM services
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE salons.merchant_id = ?
            AND services.is_featured = 1
    `;

    db.query(sql, [userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, Number(rows[0]?.total || 0));
    });
}

function markServiceFeatured(userId, serviceId, payload, callback) {
    const normalizedServiceId = Number(serviceId);
    const { error: dateError, startDate, endDate } = validateFeaturedDates(payload?.featuredStartDate, payload?.featuredEndDate);

    if (!Number.isInteger(normalizedServiceId) || normalizedServiceId < 1) {
        callback(new Error('Invalid service selected.'));
        return;
    }

    if (dateError) {
        callback(new Error(dateError));
        return;
    }

    findServiceForMerchant(userId, normalizedServiceId, (lookupError, service) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (!service) {
            callback(new Error('This service does not belong to your merchant account.'));
            return;
        }

        countFeaturedServicesByMerchant(userId, (countError, featuredCount) => {
            if (countError) {
                callback(countError);
                return;
            }

            if (!service.isFeatured && featuredCount >= 3) {
                callback(new Error('You can feature at most 3 services at a time.'));
                return;
            }

            const sql = `
                UPDATE services
                INNER JOIN salons ON salons.salon_id = services.salon_id
                SET services.is_featured = 1,
                    services.featured_order = ?,
                    services.featured_start_date = ?,
                    services.featured_end_date = ?
                WHERE services.service_id = ?
                    AND salons.merchant_id = ?
            `;

            db.query(sql, [
                normalizeFeaturedOrder(payload?.featuredOrder),
                startDate,
                endDate,
                normalizedServiceId,
                userId
            ], callback);
        });
    });
}

function removeServiceFeatured(userId, serviceId, callback) {
    const sql = `
        UPDATE services
        INNER JOIN salons ON salons.salon_id = services.salon_id
        SET services.is_featured = 0,
            services.featured_order = 0,
            services.featured_start_date = NULL,
            services.featured_end_date = NULL
        WHERE services.service_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [serviceId, userId], callback);
}

function markMerchantFeatured(salonId, payload, callback) {
    const normalizedSalonId = Number(salonId);
    const { error: dateError, startDate, endDate } = validateFeaturedDates(payload?.featuredStartDate, payload?.featuredEndDate);

    if (!Number.isInteger(normalizedSalonId) || normalizedSalonId < 1) {
        callback(new Error('Invalid merchant selected.'));
        return;
    }

    if (dateError) {
        callback(new Error(dateError));
        return;
    }

    db.query(
        `
            UPDATE salons
            SET is_featured = 1,
                featured_type = ?,
                featured_order = ?,
                featured_start_date = ?,
                featured_end_date = ?
            WHERE salon_id = ?
        `,
        [
            normalizeFeaturedType(payload?.featuredType) || 'featured_month',
            normalizeFeaturedOrder(payload?.featuredOrder),
            startDate,
            endDate,
            normalizedSalonId
        ],
        callback
    );
}

function removeMerchantFeatured(salonId, callback) {
    db.query(
        `
            UPDATE salons
            SET is_featured = 0,
                featured_type = NULL,
                featured_order = 0,
                featured_start_date = NULL,
                featured_end_date = NULL
            WHERE salon_id = ?
        `,
        [salonId],
        callback
    );
}

function calculateFeaturedScore(callback) {
    const sql = `
        SELECT
            salons.salon_id,
            COUNT(DISTINCT bookings.booking_id) AS booking_count,
            COALESCE(AVG(reviews.rating), 0) AS average_rating,
            COALESCE(SUM(CASE WHEN transactions.payment_status = 'paid' THEN transactions.total_amount ELSE 0 END), 0) AS revenue,
            COUNT(DISTINCT CASE WHEN repeat_bookings.booking_total > 1 THEN repeat_bookings.user_id END) AS repeat_customers
        FROM salons
        LEFT JOIN bookings ON bookings.merchant_id = salons.salon_id
        LEFT JOIN reviews ON reviews.merchant_id = salons.salon_id
        LEFT JOIN transactions ON transactions.booking_id = bookings.booking_id
        LEFT JOIN (
            SELECT merchant_id, user_id, COUNT(*) AS booking_total
            FROM bookings
            WHERE user_id IS NOT NULL
            GROUP BY merchant_id, user_id
        ) repeat_bookings ON repeat_bookings.merchant_id = salons.salon_id
        GROUP BY salons.salon_id
    `;

    db.query(sql, (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        const maxima = rows.reduce((accumulator, row) => ({
            bookingCount: Math.max(accumulator.bookingCount, Number(row.booking_count || 0)),
            averageRating: Math.max(accumulator.averageRating, Number(row.average_rating || 0)),
            revenue: Math.max(accumulator.revenue, Number(row.revenue || 0)),
            repeatCustomers: Math.max(accumulator.repeatCustomers, Number(row.repeat_customers || 0))
        }), {
            bookingCount: 0,
            averageRating: 0,
            revenue: 0,
            repeatCustomers: 0
        });

        if (!rows.length) {
            callback(null, []);
            return;
        }

        const updates = rows.map((row) => {
            const bookingScore = maxima.bookingCount ? Number(row.booking_count || 0) / maxima.bookingCount : 0;
            const ratingScore = maxima.averageRating ? Number(row.average_rating || 0) / maxima.averageRating : 0;
            const revenueScore = maxima.revenue ? Number(row.revenue || 0) / maxima.revenue : 0;
            const repeatScore = maxima.repeatCustomers ? Number(row.repeat_customers || 0) / maxima.repeatCustomers : 0;
            const weightedScore = ((bookingScore * 0.4) + (ratingScore * 0.3) + (revenueScore * 0.2) + (repeatScore * 0.1)) * 100;

            return {
                salonId: Number(row.salon_id),
                featuredScore: Number(weightedScore.toFixed(2))
            };
        });

        let remaining = updates.length;

        updates.forEach((entry) => {
            db.query(
                'UPDATE salons SET featured_score = ? WHERE salon_id = ?',
                [entry.featuredScore, entry.salonId],
                (updateError) => {
                    if (updateError) {
                        callback(updateError);
                        callback = () => {};
                        return;
                    }

                    remaining -= 1;

                    if (remaining === 0) {
                        callback(null, updates);
                    }
                }
            );
        });
    });
}

function createMerchant(merchantData, callback) {
    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const userSql = `
                INSERT INTO users (name, email, phone, password, role, glints_balance)
                VALUES (?, ?, ?, ?, 'merchant', 0)
            `;
            const userValues = [
                merchantData.ownerName,
                merchantData.email,
                merchantData.ownerPhone || null,
                merchantData.passwordHash
            ];

            connection.query(userSql, userValues, (userError, userResult) => {
                if (userError) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(userError);
                    });
                }

                const salonSql = `
                    INSERT INTO salons (merchant_id, salon_name, business_category, uen, years_in_business, staff_count, address, description, image_url, commission_rate)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 15.00)
                `;
                const salonValues = [
                    userResult.insertId,
                    merchantData.salonName,
                    merchantData.businessCategory || null,
                    merchantData.uen || null,
                    merchantData.yearsInBusiness || null,
                    merchantData.staffCount || null,
                    merchantData.address,
                    merchantData.description,
                    merchantData.imageUrl || null
                ];

                connection.query(salonSql, salonValues, (salonError, salonResult) => {
                    if (salonError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(salonError);
                        });
                    }

                    connection.commit((commitError) => {
                        connection.release();

                        if (commitError) {
                            callback(commitError);
                            return;
                        }

                        callback(null, {
                            userId: userResult.insertId,
                            salonId: salonResult.insertId
                        });
                    });
                });
            });
        });
    });
}

function updateCommissionRate(salonId, commissionRate, callback) {
    ensureSalonCommissionSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            'UPDATE salons SET commission_rate = ? WHERE salon_id = ?',
            [commissionRate, salonId],
            (error, result) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, result.affectedRows > 0);
            }
        );
    });
}

function updateMerchantProfile(userId, merchantData, callback) {
    return ensureMerchantProfileSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.getConnection((connectionError, connection) => {
            if (connectionError) {
                callback(connectionError);
                return;
            }

            connection.beginTransaction((transactionError) => {
                if (transactionError) {
                    connection.release();
                    callback(transactionError);
                    return;
                }

                connection.query(
                    'UPDATE users SET name = ?, phone = ? WHERE user_id = ? AND role = ?',
                    [merchantData.ownerName, merchantData.ownerPhone || null, userId, 'merchant'],
                    (userError) => {
                        if (userError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(userError);
                            });
                        }

                        const salonSql = `
                            UPDATE salons
                            SET salon_name = ?,
                                business_category = ?,
                                uen = ?,
                                years_in_business = ?,
                                staff_count = ?,
                                address = ?,
                                description = ?
                            WHERE merchant_id = ?
                        `;

                        connection.query(salonSql, [
                            merchantData.salonName,
                            merchantData.businessCategory || null,
                            merchantData.uen || null,
                            merchantData.yearsInBusiness || null,
                            merchantData.staffCount || null,
                            merchantData.address,
                            merchantData.description || null,
                            userId
                        ], (salonError, result) => {
                            if (salonError || result.affectedRows === 0) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(salonError || new Error('Merchant salon profile was not found.'));
                                });
                            }

                            connection.commit((commitError) => {
                                connection.release();
                                callback(commitError, result);
                            });
                        });
                    }
                );
            });
        });
    });
}

module.exports = {
    getMerchantByUserId,
    getMerchantBySalonId,
    getCategories,
    getProductCategories,
    getSalons,
    getAllServices,
    getFeaturedMerchants,
    getFeaturedServices,
    getFeaturedServicesByMerchant,
    countFeaturedServicesByMerchant,
    markServiceFeatured,
    removeServiceFeatured,
    markMerchantFeatured,
    removeMerchantFeatured,
    calculateFeaturedScore,
    findServiceForMerchant,
    findServiceById,
    createService,
    createServiceForSalon,
    updateService,
    updateServiceAsAdmin,
    deleteService,
    deleteServiceAsAdmin,
    getAdminOverview,
    createMerchant,
    updateCommissionRate,
    updateMerchantProfile
};
