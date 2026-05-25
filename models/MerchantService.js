const db = require('../db');

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

        if (alters.length === 0) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE services ${alters.join(', ')}`, callback);
    });
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

        if (alters.length === 0) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE categories ${alters.join(', ')}`, callback);
    });
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
            categories.category_name,
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
            categories.category_name,
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
    const sql = `
        SELECT category_id, category_name, display_order
        FROM categories
        ORDER BY display_order, category_name
    `;

    db.query(sql, callback);
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
            services.package_enabled,
            services.package_sessions,
            services.package_price,
            categories.category_name,
            salons.salon_name,
            salons.address,
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
                COUNT(services.service_id) AS service_count
            FROM salons
            INNER JOIN users ON users.user_id = salons.merchant_id
            LEFT JOIN services ON services.salon_id = salons.salon_id
            GROUP BY users.user_id, users.name, users.email, users.phone, salons.salon_id, salons.salon_name, salons.business_category, salons.uen, salons.years_in_business, salons.staff_count, salons.address, salons.description, salons.commission_rate
            ORDER BY salons.salon_id
        `;

            db.query(sql, callback);
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
    getSalons,
    getAllServices,
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
