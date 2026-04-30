const db = require('../db');

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
                name: row.service_name,
                description: row.description || '',
                durationMins: row.duration_mins,
                duration: `${row.duration_mins} mins`,
                price: Number(row.price),
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
            services.service_id,
            services.category_id,
            services.service_name,
            services.description,
            services.duration_mins,
            services.price,
            categories.category_name,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS timeslot
        FROM salons
        LEFT JOIN services ON services.salon_id = salons.salon_id
        LEFT JOIN categories ON categories.category_id = services.category_id
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        WHERE salons.merchant_id = ?
        ORDER BY services.service_id, service_slots.timeslot
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapMerchantRows(rows));
    });
}

function getCategories(callback) {
    const sql = `
        SELECT category_id, category_name
        FROM categories
        ORDER BY category_name
    `;

    db.query(sql, callback);
}

function getSalons(callback) {
    const sql = `
        SELECT salons.salon_id, salons.salon_name, salons.address, users.email AS owner_email
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
        ORDER BY salons.salon_name, services.service_id, service_slots.timeslot
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
                    slots: []
                });
            }

            if (row.timeslot) {
                servicesById.get(row.service_id).slots.push(formatTimeSlot(row.timeslot));
            }
        });

        callback(null, Array.from(servicesById.values()));
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
            categories.category_name,
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

        callback(null, {
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
            slots: rows.map((row) => formatTimeSlot(row.timeslot)).filter(Boolean)
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
            categories.category_name,
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

        callback(null, {
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
            slots: rows.map((row) => formatTimeSlot(row.timeslot)).filter(Boolean)
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
                    INSERT INTO services (salon_id, category_id, service_name, description, duration_mins, price)
                    VALUES (?, ?, ?, ?, ?, ?)
                `;
                const values = [
                    salons[0].salon_id,
                    serviceData.categoryId,
                    serviceData.name,
                    serviceData.description,
                    serviceData.durationMins,
                    serviceData.price
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
                INSERT INTO services (salon_id, category_id, service_name, description, duration_mins, price)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            const values = [
                serviceData.salonId,
                serviceData.categoryId,
                serviceData.name,
                serviceData.description,
                serviceData.durationMins,
                serviceData.price
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
                    services.price = ?
                WHERE services.service_id = ?
                    AND salons.merchant_id = ?
            `;
            const values = [
                serviceData.categoryId,
                serviceData.name,
                serviceData.description,
                serviceData.durationMins,
                serviceData.price,
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

                    connection.commit((commitError) => {
                        connection.release();
                        callback(commitError);
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
                    price = ?
                WHERE service_id = ?
            `;
            const values = [
                serviceData.salonId,
                serviceData.categoryId,
                serviceData.name,
                serviceData.description,
                serviceData.durationMins,
                serviceData.price,
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
    const sql = `
        SELECT
            users.user_id AS merchant_user_id,
            users.name AS owner_name,
            users.email AS owner_email,
            salons.salon_id,
            salons.salon_name,
            salons.address,
            salons.description,
            COUNT(services.service_id) AS service_count
        FROM salons
        INNER JOIN users ON users.user_id = salons.merchant_id
        LEFT JOIN services ON services.salon_id = salons.salon_id
        GROUP BY users.user_id, users.name, users.email, salons.salon_id, salons.salon_name, salons.address, salons.description
        ORDER BY salons.salon_id
    `;

    db.query(sql, callback);
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
                INSERT INTO users (name, email, password, role, glints_balance)
                VALUES (?, ?, ?, 'merchant', 0)
            `;
            const userValues = [
                merchantData.ownerName,
                merchantData.email,
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
                    INSERT INTO salons (merchant_id, salon_name, address, description, image_url)
                    VALUES (?, ?, ?, ?, ?)
                `;
                const salonValues = [
                    userResult.insertId,
                    merchantData.salonName,
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

module.exports = {
    getMerchantByUserId,
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
    createMerchant
};
