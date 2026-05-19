const db = require('../db');

function ensureTable(callback) {
    const sql = `
        CREATE TABLE IF NOT EXISTS audit_logs (
            audit_log_id INT NOT NULL AUTO_INCREMENT,
            actor_user_id INT DEFAULT NULL,
            actor_role VARCHAR(30) DEFAULT NULL,
            action VARCHAR(80) NOT NULL,
            entity_type VARCHAR(80) NOT NULL,
            entity_id VARCHAR(80) DEFAULT NULL,
            details_json LONGTEXT DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (audit_log_id),
            KEY idx_audit_created (created_at),
            KEY idx_audit_entity (entity_type, entity_id)
        )
    `;

    db.query(sql, callback);
}

function log(entry = {}, callback = () => {}) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            INSERT INTO audit_logs
                (actor_user_id, actor_role, action, entity_type, entity_id, details_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            entry.actorUserId || null,
            entry.actorRole || null,
            String(entry.action || '').slice(0, 80),
            String(entry.entityType || '').slice(0, 80),
            entry.entityId ? String(entry.entityId).slice(0, 80) : null,
            JSON.stringify(entry.details || {})
        ], callback);
    });
}

function listRecent(limit = 50, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT
                audit_logs.*,
                users.name AS actor_name
            FROM audit_logs
            LEFT JOIN users ON users.user_id = audit_logs.actor_user_id
            ORDER BY audit_logs.audit_log_id DESC
            LIMIT ?
        `;

        db.query(sql, [Math.max(1, Math.min(Number(limit || 50), 100))], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => ({
                id: row.audit_log_id,
                actorUserId: row.actor_user_id,
                actorName: row.actor_name || row.actor_role || 'System',
                actorRole: row.actor_role || '',
                action: row.action,
                entityType: row.entity_type,
                entityId: row.entity_id,
                details: (() => {
                    try {
                        return JSON.parse(row.details_json || '{}');
                    } catch (parseError) {
                        return {};
                    }
                })(),
                createdAt: row.created_at
            })));
        });
    });
}

module.exports = {
    listRecent,
    log
};
