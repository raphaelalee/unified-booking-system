const db = require('../db');
const User = require('./User');
const CashbackCampaign = require('./CashbackCampaign');
const { isBirthdayMonthForDate } = require('../utils/birthdayPromotions');

const DEFAULT_RULES = {
    pointsPerDollar: 10,
    cashbackPercent: 5,
    minPointsToRedeem: 100,
    pointsToCashRate: 0.01,
    maxDiscountPercent: 20,
    pointsExpiryDays: 365,
    isEnabled: true
};

const DEFAULT_MERCHANT_RULES = {
    isEnabled: true,
    maxDiscountPercent: null,
    promotionLabel: '',
    promotionMultiplier: 1
};

const ACTIVITY_TYPES = {
    EARNED: 'EARNED',
    REDEEMED: 'REDEEMED',
    POINTS_USED: 'POINTS_USED',
    CASHBACK_USED: 'CASHBACK_USED',
    CASHBACK_EARNED: 'CASHBACK_EARNED',
    CASHBACK_REVERSED: 'CASHBACK_REVERSED',
    REVIEW_BONUS: 'REVIEW_BONUS',
    SPIN_REWARD: 'SPIN_REWARD',
    REFERRAL_REWARD: 'REFERRAL_REWARD',
    BOOKING_REWARD: 'BOOKING_REWARD',
    PRODUCT_ORDER_REWARD: 'PRODUCT_ORDER_REWARD',
    EXPIRY: 'EXPIRY',
    MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
    REFUND_REVERSAL: 'REFUND_REVERSAL'
};

const LEGACY_TYPE_MAP = {
    earn: ACTIVITY_TYPES.EARNED,
    earned: ACTIVITY_TYPES.EARNED,
    points_earned: ACTIVITY_TYPES.EARNED,
    redeem_points: ACTIVITY_TYPES.REDEEMED,
    points_redeemed: ACTIVITY_TYPES.REDEEMED,
    redeem: ACTIVITY_TYPES.CASHBACK_USED,
    cashback_used: ACTIVITY_TYPES.CASHBACK_USED,
    cashback_earned: ACTIVITY_TYPES.CASHBACK_EARNED,
    cashback_reversed: ACTIVITY_TYPES.CASHBACK_REVERSED,
    campaign_reversed: ACTIVITY_TYPES.CASHBACK_REVERSED,
    review_bonus: ACTIVITY_TYPES.REVIEW_BONUS,
    spin: ACTIVITY_TYPES.SPIN_REWARD,
    spin_reward: ACTIVITY_TYPES.SPIN_REWARD,
    referral: ACTIVITY_TYPES.REFERRAL_REWARD,
    referral_reward: ACTIVITY_TYPES.REFERRAL_REWARD,
    referral_bonus: ACTIVITY_TYPES.REFERRAL_REWARD,
    booking_reward: ACTIVITY_TYPES.BOOKING_REWARD,
    product_order_reward: ACTIVITY_TYPES.PRODUCT_ORDER_REWARD,
    order_reward: ACTIVITY_TYPES.PRODUCT_ORDER_REWARD,
    expired: ACTIVITY_TYPES.EXPIRY,
    expiry: ACTIVITY_TYPES.EXPIRY,
    points_expired: ACTIVITY_TYPES.EXPIRY,
    adjustment: ACTIVITY_TYPES.MANUAL_ADJUSTMENT,
    manual_adjustment: ACTIVITY_TYPES.MANUAL_ADJUSTMENT,
    admin_adjustment: ACTIVITY_TYPES.MANUAL_ADJUSTMENT,
    refund: ACTIVITY_TYPES.REFUND_REVERSAL,
    refunded: ACTIVITY_TYPES.REFUND_REVERSAL,
    reversal: ACTIVITY_TYPES.REFUND_REVERSAL,
    reversed: ACTIVITY_TYPES.REFUND_REVERSAL
};

const DISPLAY_TYPE_LABELS = {
    EARNED: 'Rewards Earned',
    CASHBACK_USED: 'Cashback Used',
    REDEEMED: 'Points Redeemed',
    POINTS_USED: 'Points Redeemed',
    CASHBACK_EARNED: 'Cashback Earned',
    CASHBACK_REVERSED: 'Cashback Reversed',
    REVIEW_BONUS: 'Review Bonus',
    SPIN_REWARD: 'Spin Reward',
    REFERRAL_REWARD: 'Referral Reward',
    BOOKING_REWARD: 'Booking Reward',
    PRODUCT_ORDER_REWARD: 'Order Reward',
    EXPIRY: 'Points Expired',
    MANUAL_ADJUSTMENT: 'Wallet Adjustment',
    REFUND_REVERSAL: 'Refund Reversal'
};

function runSeries(tasks, callback) {
    let index = 0;

    function next(error) {
        if (error || index >= tasks.length) {
            callback(error);
            return;
        }

        const task = tasks[index];
        index += 1;
        task(next);
    }

    next();
}

function ensureColumns(tableName, definitions, callback) {
    db.query(`SHOW COLUMNS FROM ${tableName}`, (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = Object.entries(definitions)
            .filter(([field]) => !fields.has(field))
            .map(([, definition]) => `ADD COLUMN ${definition}`);

        if (!alters.length) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE ${tableName} ${alters.join(', ')}`, callback);
    });
}

function ensureTables(callback) {
    const walletSql = `
        CREATE TABLE IF NOT EXISTS loyalty_wallets (
            user_id INT NOT NULL,
            points_balance INT NOT NULL DEFAULT 0,
            cashback_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
            lifetime_points INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id)
        )
    `;
    const transactionSql = `
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            loyalty_transaction_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            source_receipt_id VARCHAR(80) DEFAULT NULL,
            transaction_type VARCHAR(20) NOT NULL,
            points_delta INT NOT NULL DEFAULT 0,
            cashback_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
            description VARCHAR(255) NOT NULL,
            expires_at DATETIME DEFAULT NULL,
            booking_reference VARCHAR(80) DEFAULT NULL,
            merchant_name VARCHAR(120) DEFAULT NULL,
            reward_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (loyalty_transaction_id),
            UNIQUE KEY uniq_loyalty_source_type (source_receipt_id, transaction_type),
            KEY idx_loyalty_user_created (user_id, created_at)
        )
    `;
    const rulesSql = `
        CREATE TABLE IF NOT EXISTS loyalty_rules (
            rule_id INT NOT NULL,
            points_per_dollar DECIMAL(10,2) NOT NULL DEFAULT 10,
            cashback_percent DECIMAL(5,2) NOT NULL DEFAULT 5,
            min_points_to_redeem INT NOT NULL DEFAULT 100,
            points_to_cash_rate DECIMAL(10,4) NOT NULL DEFAULT 0.01,
            max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 20,
            points_expiry_days INT NOT NULL DEFAULT 365,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (rule_id)
        )
    `;
    const merchantRulesSql = `
        CREATE TABLE IF NOT EXISTS merchant_loyalty_rules (
            merchant_id INT NOT NULL,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            max_discount_percent DECIMAL(5,2) DEFAULT NULL,
            promotion_label VARCHAR(120) DEFAULT NULL,
            promotion_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (merchant_id)
        )
    `;
    const merchantServicesSql = `
        CREATE TABLE IF NOT EXISTS merchant_loyalty_services (
            merchant_id INT NOT NULL,
            service_id INT NOT NULL,
            redemption_enabled TINYINT(1) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (merchant_id, service_id),
            KEY idx_merchant_loyalty_service (service_id)
        )
    `;
    const seedRulesSql = `
        INSERT INTO loyalty_rules
            (rule_id, points_per_dollar, cashback_percent, min_points_to_redeem, points_to_cash_rate, max_discount_percent, points_expiry_days, is_enabled)
        VALUES (1, 10, 5, 100, 0.01, 20, 365, 1)
        ON DUPLICATE KEY UPDATE rule_id = rule_id
    `;

    runSeries([
        (next) => db.query(walletSql, next),
        (next) => db.query(transactionSql, next),
        (next) => ensureColumns('loyalty_transactions', {
            order_id: 'order_id INT NULL AFTER user_id',
            campaign_id: 'campaign_id INT NULL AFTER source_receipt_id',
            salon_id: 'salon_id INT NULL AFTER campaign_id',
            expires_at: 'expires_at DATETIME DEFAULT NULL AFTER description',
            booking_reference: 'booking_reference VARCHAR(80) DEFAULT NULL AFTER expires_at',
            merchant_name: 'merchant_name VARCHAR(120) DEFAULT NULL AFTER booking_reference',
            reward_discount: 'reward_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER merchant_name'
        }, next),
        (next) => db.query(rulesSql, next),
        (next) => ensureColumns('loyalty_rules', {
            max_discount_percent: 'max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 20 AFTER points_to_cash_rate',
            points_expiry_days: 'points_expiry_days INT NOT NULL DEFAULT 365 AFTER max_discount_percent'
        }, next),
        (next) => db.query(merchantRulesSql, next),
        (next) => ensureColumns('merchant_loyalty_rules', {
            promotion_label: 'promotion_label VARCHAR(120) DEFAULT NULL AFTER max_discount_percent',
            promotion_multiplier: 'promotion_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1 AFTER promotion_label'
        }, next),
        (next) => db.query(merchantServicesSql, next),
        (next) => db.query(seedRulesSql, next)
    ], callback);
}

function mapRules(row = {}) {
    return {
        pointsPerDollar: Number(row.points_per_dollar ?? DEFAULT_RULES.pointsPerDollar),
        cashbackPercent: Number(row.cashback_percent ?? DEFAULT_RULES.cashbackPercent),
        minPointsToRedeem: Number(row.min_points_to_redeem ?? DEFAULT_RULES.minPointsToRedeem),
        pointsToCashRate: Number(row.points_to_cash_rate ?? DEFAULT_RULES.pointsToCashRate),
        maxDiscountPercent: Number(row.max_discount_percent ?? DEFAULT_RULES.maxDiscountPercent),
        pointsExpiryDays: Number(row.points_expiry_days ?? DEFAULT_RULES.pointsExpiryDays),
        isEnabled: row.is_enabled === undefined ? DEFAULT_RULES.isEnabled : Boolean(Number(row.is_enabled))
    };
}

function mapMerchantRules(row = {}) {
    return {
        merchantId: row.merchant_id ? Number(row.merchant_id) : null,
        isEnabled: row.is_enabled === undefined ? DEFAULT_MERCHANT_RULES.isEnabled : Boolean(Number(row.is_enabled)),
        maxDiscountPercent: row.max_discount_percent === null || row.max_discount_percent === undefined
            ? DEFAULT_MERCHANT_RULES.maxDiscountPercent
            : Number(row.max_discount_percent),
        promotionLabel: row.promotion_label || DEFAULT_MERCHANT_RULES.promotionLabel,
        promotionMultiplier: Number(row.promotion_multiplier || DEFAULT_MERCHANT_RULES.promotionMultiplier)
    };
}

function mapWallet(row = {}) {
    return {
        userId: row.user_id,
        pointsBalance: Number(row.points_balance || 0),
        cashbackBalance: Number(row.cashback_balance || 0),
        lifetimePoints: Number(row.lifetime_points || 0)
    };
}

function toDisplayType(rawType) {
    const key = String(rawType || '').trim().toLowerCase();
    const normalized = LEGACY_TYPE_MAP[key] || String(rawType || '').trim().toUpperCase();
    return normalized || 'ACTIVITY';
}

function getDisplayTitle(type, row = {}) {
    if (type === ACTIVITY_TYPES.EARNED) {
        if (hasOrderReference(row)) return DISPLAY_TYPE_LABELS.PRODUCT_ORDER_REWARD;
        if (hasBookingReference(row)) return DISPLAY_TYPE_LABELS.BOOKING_REWARD;
        if (Number(row.points_delta || 0) > 0 && Number(row.cashback_delta || 0) <= 0) return 'Points Earned';
    }

    return DISPLAY_TYPE_LABELS[type] || 'Loyalty Activity';
}

function cleanReference(value) {
    return String(value || '').trim();
}

function hasOrderReference(row = {}) {
    return Boolean(cleanReference(row.order_number || row.orderNumber || row.order_id || row.orderId));
}

function hasBookingReference(row = {}) {
    const bookingReference = cleanReference(row.booking_reference || row.bookingReference);
    const source = cleanReference(row.source_receipt_id || row.sourceReceiptId);
    return Boolean(bookingReference) || /^points-\d+$/i.test(source);
}

function isGenericMerchantName(value) {
    return /^any merchant$/i.test(cleanReference(value));
}

function isInternalSourceReference(value) {
    const text = cleanReference(value);
    if (!text) return true;

    return /^\d+$/.test(text)
        || /^(order|cashback-order|campaign-order|reverse-campaign-order|campaign|reverse-campaign|points|booking-review|spin|birthday)-/i.test(text);
}

function isCustomerFacingReference(value) {
    const text = cleanReference(value);
    return Boolean(text) && !isInternalSourceReference(text);
}

function withReferencePrefix(prefix, value) {
    const text = cleanReference(value);
    if (!text) return '';
    if (/^(order|booking|receipt|reference)\b/i.test(text) || text.startsWith('#')) return text;
    return `${prefix} ${text}`;
}

function getInternalFallbackReference(row = {}) {
    const source = cleanReference(row.source_receipt_id || row.sourceReceiptId);
    const sourceMatch = source.match(/(?:^|-)(?:order|cashback-order|campaign-order|points)-(\d+)(?:-|$)/i);

    if (sourceMatch) return `#${sourceMatch[1]}`;
    if (/^\d+$/.test(source)) return `#${source}`;
    if (row.order_id || row.orderId) return `#${row.order_id || row.orderId}`;
    if (row.loyalty_transaction_id || row.id) return `#${row.loyalty_transaction_id || row.id}`;

    return '';
}

function formatOrderReference(row = {}) {
    const orderNumber = cleanReference(row.order_number || row.orderNumber);
    if (orderNumber) {
        return withReferencePrefix('Order', orderNumber);
    }

    const bookingReference = cleanReference(row.booking_reference || row.bookingReference);
    if (bookingReference && isCustomerFacingReference(bookingReference)) {
        return withReferencePrefix('Booking', bookingReference);
    }

    const sourceReceiptId = cleanReference(row.source_receipt_id || row.sourceReceiptId);
    if (isCustomerFacingReference(sourceReceiptId)) {
        return sourceReceiptId;
    }

    return getInternalFallbackReference(row);
}

function getDisplayMerchantName(row = {}, displayDetails = {}) {
    const merchantName = cleanReference(displayDetails.merchantName || displayDetails.merchant_name || row.merchant_name || row.merchantName);
    return isGenericMerchantName(merchantName) ? '' : merchantName;
}

function isInternalDescription(value) {
    const text = cleanReference(value);
    if (!text) return true;

    return /^cashback used at checkout/i.test(text)
        || /^earned .* from receipt/i.test(text)
        || /^earned .* from order/i.test(text)
        || /^reversed .* for receipt/i.test(text)
        || /^redeemed \d+ points/i.test(text);
}

function getDisplaySubtitle(row = {}, type, displayOrderReference = '') {
    const merchantName = getDisplayMerchantName(row);
    const bookingReference = cleanReference(row.booking_reference || row.bookingReference);
    const description = cleanReference(row.description);

    if (type === ACTIVITY_TYPES.REDEEMED) {
        return 'Cashback conversion';
    }

    if (type === ACTIVITY_TYPES.POINTS_USED) {
        if (merchantName) return merchantName;
        return 'Booking discount';
    }

    if (type === ACTIVITY_TYPES.REVIEW_BONUS) {
        return 'Review reward';
    }

    if (type === ACTIVITY_TYPES.REFERRAL_REWARD) {
        return 'Referral reward';
    }

    if (type === ACTIVITY_TYPES.SPIN_REWARD) {
        return 'Spin reward';
    }

    if (type === ACTIVITY_TYPES.EXPIRY) {
        return 'Expired points';
    }

    if (merchantName) {
        return merchantName;
    }

    if (!displayOrderReference && bookingReference && isCustomerFacingReference(bookingReference)) {
        return withReferencePrefix('Booking', bookingReference);
    }

    if (description && !isInternalDescription(description)) {
        return description;
    }

    return 'Transaction';
}

function formatDisplayDate(value, options = {}) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return options.includeTime
        ? date.toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
        : date.toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

function formatPointsMovement(value) {
    const points = Number(value || 0);
    if (points === 0) return '';
    return `${points > 0 ? '+' : ''}${points} pts`;
}

function formatCashbackMovement(value) {
    const amount = Number(value || 0);
    if (amount === 0) return '';
    return `${amount > 0 ? '+' : '-'}$${Math.abs(amount).toFixed(2)}`;
}

function getMovementTone(value) {
    const amount = Number(value || 0);
    if (amount > 0) return 'positive';
    if (amount < 0) return 'negative';
    return 'neutral';
}

function buildDisplayLines(displaySubtitle, displayOrderReference) {
    const lines = [];

    [displaySubtitle, displayOrderReference].forEach((line) => {
        const text = cleanReference(line);
        if (text && !lines.includes(text)) {
            lines.push(text);
        }
    });

    return lines;
}

function buildDisplayKinds(pointsDelta, cashbackDelta) {
    const kinds = [];

    if (Number(pointsDelta || 0) !== 0) kinds.push('points');
    if (Number(cashbackDelta || 0) !== 0) kinds.push('cashback');

    return kinds.length ? kinds : ['activity'];
}

function buildDisplayValueLines(transaction = {}) {
    const lines = [];

    if (transaction.displayPointsDelta) {
        lines.push({
            kind: 'points',
            text: transaction.displayPointsDelta,
            tone: transaction.displayPointsTone
        });
    }

    if (transaction.displayCashbackDelta) {
        lines.push({
            kind: 'cashback',
            text: transaction.displayCashbackDelta,
            tone: transaction.displayCashbackTone
        });
    }

    return lines;
}

function buildDisplaySearchText(transaction = {}) {
    return [
        transaction.displayTitle,
        transaction.displaySubtitle,
        ...(Array.isArray(transaction.displayLines) ? transaction.displayLines : []),
        transaction.displayOrderReference,
        transaction.displayMerchantName,
        transaction.displayDate,
        transaction.displayDateTime,
        transaction.displayExpiryDate,
        transaction.displayPointsDelta,
        transaction.displayCashbackDelta,
        transaction.displayStatus
    ].filter(Boolean).join(' ').toLowerCase();
}

function applyTransactionDisplay(transaction = {}, displayDetails = {}) {
    const displaySubtitle = String(displayDetails.displaySubtitle || displayDetails.itemNames || displayDetails.itemName || '').trim()
        || transaction.displaySubtitle
        || '';
    const detailOrderReference = formatOrderReference({
        ...transaction,
        order_number: displayDetails.order_number || displayDetails.orderNumber || transaction.order_number || transaction.orderNumber,
        booking_reference: displayDetails.booking_reference || displayDetails.bookingReference || transaction.bookingReference,
        source_receipt_id: displayDetails.receiptId || transaction.sourceReceiptId,
        loyalty_transaction_id: transaction.id
    });
    const displayOrderReference = detailOrderReference || transaction.displayOrderReference || '';
    const displayMerchantName = getDisplayMerchantName(transaction, displayDetails);
    const displayLines = buildDisplayLines(displaySubtitle, displayOrderReference);
    const displayValueLines = buildDisplayValueLines(transaction);
    const updated = {
        ...transaction,
        displaySubtitle,
        displayOrderReference,
        displayMerchantName,
        displayLines,
        displayValueLines
    };

    return {
        ...updated,
        displaySearchText: buildDisplaySearchText(updated)
    };
}

function applyTransactionDisplayDetails(transactions = [], receipts = []) {
    const receiptMap = (receipts || []).reduce((map, receipt = {}) => {
        const keys = [
            receipt.receiptId,
            receipt.order_number,
            receipt.orderNumber
        ].filter(Boolean);

        keys.forEach((key) => {
            map[String(key)] = receipt;
        });

        return map;
    }, {});

    return (transactions || []).map((transaction) => {
        const receipt = receiptMap[String(transaction.sourceReceiptId || '')]
            || receiptMap[String(transaction.receiptId || '')]
            || receiptMap[String(transaction.orderNumber || transaction.order_number || '')]
            || null;

        return applyTransactionDisplay(transaction, receipt || {});
    });
}

function mapTransaction(row = {}) {
    const rawType = String(row.transaction_type || '').trim();
    const type = toDisplayType(rawType);
    const pointsDelta = Number(row.points_delta || 0);
    const cashbackDelta = Number(row.cashback_delta || 0);
    const displayTitle = getDisplayTitle(type, row);
    const displayOrderReference = formatOrderReference(row);
    const displaySubtitle = getDisplaySubtitle(row, type, displayOrderReference);
    const displayMerchantName = getDisplayMerchantName(row);
    const displayPointsDelta = formatPointsMovement(pointsDelta);
    const displayCashbackDelta = formatCashbackMovement(cashbackDelta);
    const displayDate = formatDisplayDate(row.created_at);
    const displayDateTime = formatDisplayDate(row.created_at, { includeTime: true });
    const displayExpiryDate = formatDisplayDate(row.expires_at);
    const displayKinds = buildDisplayKinds(pointsDelta, cashbackDelta);
    const orderReference = displayOrderReference || '';

    return applyTransactionDisplay({
        id: row.loyalty_transaction_id,
        activityId: row.loyalty_transaction_id,
        sourceReceiptId: row.source_receipt_id,
        receiptId: row.source_receipt_id,
        type,
        activityType: type,
        pointsDelta,
        pointsChange: pointsDelta,
        cashbackDelta,
        cashbackChange: cashbackDelta,
        description: row.description,
        expiresAt: row.expires_at || null,
        bookingReference: row.booking_reference || row.source_receipt_id || '',
        orderId: row.order_id || null,
        orderNumber: row.order_number || '',
        order_number: row.order_number || '',
        orderReference,
        displayTitle,
        displaySubtitle,
        displayOrderReference,
        displayPointsDelta,
        displayCashbackDelta,
        displayPointsTone: getMovementTone(pointsDelta),
        displayCashbackTone: getMovementTone(cashbackDelta),
        displayDate,
        displayDateTime,
        displayExpiryDate,
        displayStatus: (displayPointsDelta || displayCashbackDelta) ? 'Balance updated' : 'Recorded',
        displayKinds,
        displayKindsText: displayKinds.join(' '),
        displayMerchantName,
        merchantName: row.merchant_name || '',
        rewardDiscount: Number(row.reward_discount || 0),
        campaignId: row.campaign_id || null,
        salonId: row.salon_id || null,
        createdAt: row.created_at
    });
}

function buildWalletDisplaySummary(transactions = []) {
    const cashbackEarnedTotal = roundMoney((transactions || [])
        .filter((entry) => Number(entry.cashbackDelta || 0) > 0)
        .reduce((sum, entry) => sum + Number(entry.cashbackDelta || 0), 0));
    const cashbackUsedTotal = roundMoney(Math.abs((transactions || [])
        .filter((entry) => Number(entry.cashbackDelta || 0) < 0)
        .reduce((sum, entry) => sum + Number(entry.cashbackDelta || 0), 0)));
    const reviewBonusPointsTotal = (transactions || [])
        .filter((entry) => entry.type === ACTIVITY_TYPES.REVIEW_BONUS)
        .reduce((sum, entry) => sum + Number(entry.pointsDelta || 0), 0);

    return {
        cashbackEarnedTotal,
        cashbackUsedTotal,
        reviewBonusPointsTotal,
        displayCashbackEarnedTotal: `$${cashbackEarnedTotal.toFixed(2)}`,
        displayCashbackUsedTotal: `$${cashbackUsedTotal.toFixed(2)}`,
        displayCashbackSummary: `$${cashbackEarnedTotal.toFixed(2)} earned - $${cashbackUsedTotal.toFixed(2)} used or reversed`,
        displayReviewBonusPointsTotal: `${reviewBonusPointsTotal} pts`
    };
}

function getRules(callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query('SELECT * FROM loyalty_rules WHERE rule_id = 1 LIMIT 1', (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, mapRules(rows[0]));
        });
    });
}

function updateRules(rules, callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            UPDATE loyalty_rules
            SET points_per_dollar = ?,
                cashback_percent = ?,
                min_points_to_redeem = ?,
                points_to_cash_rate = ?,
                max_discount_percent = ?,
                points_expiry_days = ?,
                is_enabled = ?
            WHERE rule_id = 1
        `;

        db.query(sql, [
            rules.pointsPerDollar,
            rules.cashbackPercent,
            rules.minPointsToRedeem,
            rules.pointsToCashRate,
            rules.maxDiscountPercent,
            rules.pointsExpiryDays,
            rules.isEnabled ? 1 : 0
        ], callback);
    });
}

function ensureWallet(userId, callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const insertSql = `
            INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
            VALUES (?, 0, 0, 0)
            ON DUPLICATE KEY UPDATE user_id = user_id
        `;

        db.query(insertSql, [userId], (insertError) => {
            if (insertError) {
                callback(insertError);
                return;
            }

            db.query('SELECT * FROM loyalty_wallets WHERE user_id = ? LIMIT 1', [userId], (lookupError, rows) => {
                if (lookupError) {
                    callback(lookupError);
                    return;
                }

                callback(null, mapWallet(rows[0]));
            });
        });
    });
}

function getTransactions(userId, limit, callback) {
    const sql = `
        SELECT lt.*, o.order_number
        FROM loyalty_transactions lt
        LEFT JOIN orders o
            ON o.order_id = lt.order_id
        WHERE lt.user_id = ?
        ORDER BY lt.loyalty_transaction_id DESC
        LIMIT ?
    `;

    db.query(sql, [userId, Number(limit || 20)], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapTransaction));
    });
}

function getTransactionsPage(userId, options = {}, callback) {
    const pageSize = Number(options.pageSize || 10) === 20 ? 20 : 10;
    const currentPage = Math.max(1, Number(options.page || 1));
    const offset = (currentPage - 1) * pageSize;

    const countSql = `
        SELECT COUNT(*) AS total_count
        FROM loyalty_transactions lt
        WHERE lt.user_id = ?
    `;
    const pageSql = `
        SELECT lt.*, o.order_number
        FROM loyalty_transactions lt
        LEFT JOIN orders o
            ON o.order_id = lt.order_id
        WHERE lt.user_id = ?
        ORDER BY lt.loyalty_transaction_id DESC
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, [userId], (countError, countRows = []) => {
        if (countError) {
            callback(countError);
            return;
        }

        const totalCount = Number(countRows[0]?.total_count || 0);
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const safePage = Math.min(currentPage, totalPages);
        const safeOffset = (safePage - 1) * pageSize;

        db.query(pageSql, [userId, pageSize, safeOffset], (pageError, rows = []) => {
            if (pageError) {
                callback(pageError);
                return;
            }

            callback(null, {
                transactions: rows.map(mapTransaction),
                pagination: {
                    page: safePage,
                    pageSize,
                    totalCount,
                    totalPages,
                    hasPrevious: safePage > 1,
                    hasNext: safePage < totalPages
                }
            });
        });
    });
}

function getWalletView(userId, callback) {
    return ensureWallet(userId, (walletError, wallet) => {
        if (walletError) {
            callback(walletError);
            return;
        }

        return getRules((rulesError, rules) => {
            if (rulesError) {
                callback(rulesError);
                return;
            }

            return getTransactions(userId, 25, (historyError, transactions) => {
                if (historyError) {
                    callback(historyError);
                    return;
                }

                callback(null, {
                    wallet,
                    rules,
                    transactions,
                    displaySummary: buildWalletDisplaySummary(transactions)
                });
            });
        });
    });
}

function getPlatformSummary(callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT
                COUNT(*) AS transaction_count,
                SUM(CASE WHEN lt.transaction_type IN ('REDEEMED', 'POINTS_USED', 'redeem_points') THEN 1 ELSE 0 END) AS redemption_count,
                COALESCE(SUM(lt.points_delta), 0) AS points_delta_total,
                COALESCE(SUM(lt.cashback_delta), 0) AS cashback_delta_total
            FROM loyalty_transactions lt
            LEFT JOIN orders o
                ON o.order_id = lt.order_id
        `;

        db.query(sql, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                transactionCount: Number(rows[0]?.transaction_count || 0),
                redemptionCount: Number(rows[0]?.redemption_count || 0),
                pointsDeltaTotal: Number(rows[0]?.points_delta_total || 0),
                cashbackDeltaTotal: Number(rows[0]?.cashback_delta_total || 0)
            });
        });
    });
}

function getMerchantRewardAnalytics(merchantId, callback) {
    const salonId = Number(merchantId || 0);

    if (!salonId) {
        callback(null, {
            rewardBookingCount: 0,
            totalRedeemedValue: 0,
            loyaltyDrivenRevenue: 0,
            repeatRewardCustomers: 0
        });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT
                COUNT(DISTINCT bookings.booking_id) AS reward_booking_count,
                COALESCE(SUM(lt.reward_discount), 0) AS total_redeemed_value,
                COALESCE(SUM(transactions.total_amount), 0) AS loyalty_driven_revenue,
                COUNT(DISTINCT CASE WHEN customer_counts.booking_count > 1 THEN bookings.user_id END) AS repeat_reward_customers
            FROM loyalty_transactions lt
            LEFT JOIN orders o
                ON o.order_id = lt.order_id
            INNER JOIN bookings
                ON lt.source_receipt_id = CONCAT('points-', bookings.booking_id)
            LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
            LEFT JOIN (
                SELECT user_id, merchant_id, COUNT(*) AS booking_count
                FROM bookings
                WHERE status NOT IN ('cancelled', 'rejected')
                GROUP BY user_id, merchant_id
            ) AS customer_counts
                ON customer_counts.user_id = bookings.user_id
                AND customer_counts.merchant_id = bookings.merchant_id
            WHERE bookings.merchant_id = ?
                AND lt.transaction_type = 'POINTS_USED'
        `;

        db.query(sql, [salonId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                rewardBookingCount: Number(rows[0]?.reward_booking_count || 0),
                totalRedeemedValue: Number(rows[0]?.total_redeemed_value || 0),
                loyaltyDrivenRevenue: Number(rows[0]?.loyalty_driven_revenue || 0),
                repeatRewardCustomers: Number(rows[0]?.repeat_reward_customers || 0)
            });
        });
    });
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function validateOrderIdForLoyalty(orderId) {
    if (!orderId || !Number.isInteger(Number(orderId)) || Number(orderId) <= 0) {
        throw new Error('Invalid orderId for loyalty transaction');
    }

    return Number(orderId);
}

function getValidatedOrderIdForLoyalty(orderId, required = false) {
    if (!orderId && !required) {
        return null;
    }

    return validateOrderIdForLoyalty(orderId);
}

function isOrderReceipt(receipt = {}) {
    return String(receipt.type || '').toLowerCase() === 'order';
}

function isOrderRelatedCashback(sourceReceiptId, options = {}) {
    return String(options.receiptType || options.type || '').toLowerCase() === 'order';
}

function normalizePercent(value, fallback = 0) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100));
}

function getMerchantRules(merchantId, callback) {
    const salonId = Number(merchantId || 0);

    if (!salonId) {
        callback(new Error('Merchant is required.'));
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query('SELECT * FROM merchant_loyalty_rules WHERE merchant_id = ? LIMIT 1', [salonId], (rulesError, rulesRows = []) => {
            if (rulesError) {
                callback(rulesError);
                return;
            }

            db.query(
                'SELECT service_id, redemption_enabled FROM merchant_loyalty_services WHERE merchant_id = ?',
                [salonId],
                (servicesError, serviceRows = []) => {
                    if (servicesError) {
                        callback(servicesError);
                        return;
                    }

                    const serviceRedemptions = {};
                    serviceRows.forEach((row) => {
                        serviceRedemptions[Number(row.service_id)] = Boolean(Number(row.redemption_enabled));
                    });

                    callback(null, {
                        ...mapMerchantRules(rulesRows[0]),
                        merchantId: salonId,
                        serviceRedemptions
                    });
                }
            );
        });
    });
}

function updateMerchantRules(merchantId, settings = {}, callback) {
    const salonId = Number(merchantId || 0);
    const serviceIds = Array.isArray(settings.serviceIds)
        ? settings.serviceIds.map((id) => Number(id)).filter(Boolean)
        : [];
    const enabledServiceIds = new Set(
        (Array.isArray(settings.enabledServiceIds) ? settings.enabledServiceIds : [])
            .map((id) => Number(id))
            .filter(Boolean)
    );
    const maxDiscountPercent = settings.maxDiscountPercent === null || settings.maxDiscountPercent === ''
        ? null
        : normalizePercent(settings.maxDiscountPercent, DEFAULT_RULES.maxDiscountPercent);

    if (!salonId) {
        callback(new Error('Merchant is required.'));
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
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

                const ruleSql = `
                    INSERT INTO merchant_loyalty_rules
                        (merchant_id, is_enabled, max_discount_percent, promotion_label, promotion_multiplier)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        is_enabled = VALUES(is_enabled),
                        max_discount_percent = VALUES(max_discount_percent),
                        promotion_label = VALUES(promotion_label),
                        promotion_multiplier = VALUES(promotion_multiplier)
                `;

                connection.query(ruleSql, [
                    salonId,
                    settings.isEnabled ? 1 : 0,
                    maxDiscountPercent,
                    String(settings.promotionLabel || '').trim().slice(0, 120) || null,
                    Math.max(0, Math.min(Number(settings.promotionMultiplier || 1), 1))
                ], (ruleError) => {
                    if (ruleError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(ruleError);
                        });
                    }

                    connection.query('DELETE FROM merchant_loyalty_services WHERE merchant_id = ?', [salonId], (deleteError) => {
                        if (deleteError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(deleteError);
                            });
                        }

                        if (!serviceIds.length) {
                            return connection.commit((commitError) => {
                                connection.release();
                                callback(commitError);
                            });
                        }

                        const rows = serviceIds.map((serviceId) => [
                            salonId,
                            serviceId,
                            enabledServiceIds.has(serviceId) ? 1 : 0
                        ]);

                        connection.query(
                            'INSERT INTO merchant_loyalty_services (merchant_id, service_id, redemption_enabled) VALUES ?',
                            [rows],
                            (serviceError) => {
                                if (serviceError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(serviceError);
                                    });
                                }

                                return connection.commit((commitError) => {
                                    connection.release();
                                    callback(commitError);
                                });
                            }
                        );
                    });
                });
            });
        });
    });
}

function getEffectiveRedemptionRules(options = {}, callback) {
    const merchantId = Number(options.merchantId || 0);
    const serviceId = Number(options.serviceId || 0);

    return getRules((rulesError, adminRules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!merchantId) {
            callback(null, {
                enabled: false,
                reason: 'Merchant rewards are unavailable.',
                adminRules,
                merchantRules: mapMerchantRules(),
                maxDiscountPercent: 0,
                minPointsToRedeem: adminRules.minPointsToRedeem,
                pointsToCashRate: adminRules.pointsToCashRate
            });
            return;
        }

        return getMerchantRules(merchantId, (merchantError, merchantRules) => {
            if (merchantError) {
                callback(merchantError);
                return;
            }

            const serviceSetting = serviceId ? merchantRules.serviceRedemptions[serviceId] : undefined;
            const serviceEnabled = serviceSetting === undefined ? true : Boolean(serviceSetting);
            const merchantMax = merchantRules.maxDiscountPercent === null || merchantRules.maxDiscountPercent === undefined
                ? adminRules.maxDiscountPercent
                : merchantRules.maxDiscountPercent;
            const maxDiscountPercent = Math.min(
                normalizePercent(adminRules.maxDiscountPercent, DEFAULT_RULES.maxDiscountPercent),
                normalizePercent(merchantMax, adminRules.maxDiscountPercent)
            );
            const enabled = Boolean(adminRules.isEnabled && merchantRules.isEnabled && serviceEnabled);
            let reason = '';

            if (!adminRules.isEnabled) {
                reason = 'Rewards are disabled platform-wide.';
            } else if (!merchantRules.isEnabled) {
                reason = 'This merchant has disabled rewards.';
            } else if (!serviceEnabled) {
                reason = 'This service does not allow reward redemption.';
            }

            callback(null, {
                enabled,
                reason,
                adminRules,
                merchantRules,
                serviceEnabled,
                maxDiscountPercent,
                minPointsToRedeem: adminRules.minPointsToRedeem,
                pointsToCashRate: Math.round(adminRules.pointsToCashRate * Math.max(0, Math.min(Number(merchantRules.promotionMultiplier || 1), 1)) * 10000) / 10000,
                pointsPerDollar: adminRules.pointsPerDollar,
                pointsExpiryDays: adminRules.pointsExpiryDays
            });
        });
    });
}

function calculatePointRedemption(options = {}, callback) {
    const requestedPoints = Math.floor(Number(options.requestedPoints || 0));
    const amount = roundMoney(options.amount || 0);

    if (requestedPoints <= 0 || amount <= 0) {
        callback(null, { points: 0, discount: 0, rules: null });
        return;
    }

    return getEffectiveRedemptionRules(options, (rulesError, rules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!rules.enabled) {
            callback(new Error(rules.reason || 'Rewards cannot be redeemed for this booking.'));
            return;
        }

        if (requestedPoints < rules.minPointsToRedeem) {
            callback(new Error(`Minimum redemption is ${rules.minPointsToRedeem} points.`));
            return;
        }

        if (Number(rules.pointsToCashRate || 0) <= 0) {
            callback(new Error('This merchant has set points redemption value to zero.'));
            return;
        }

        return ensureWallet(options.userId, (walletError, wallet) => {
            if (walletError) {
                callback(walletError);
                return;
            }

            const availablePoints = Math.max(0, Number(wallet.pointsBalance || 0));

            if (requestedPoints > availablePoints) {
                callback(new Error('Not enough points to redeem.'));
                return;
            }

            const rawDiscount = roundMoney(requestedPoints * rules.pointsToCashRate);
            const maxDiscount = roundMoney(amount * (rules.maxDiscountPercent / 100));
            const discount = Math.min(rawDiscount, maxDiscount, amount);
            const appliedPoints = Math.min(requestedPoints, Math.floor(discount / rules.pointsToCashRate));

            if (discount <= 0 || appliedPoints <= 0) {
                callback(null, { points: 0, discount: 0, rules, wallet });
                return;
            }

            callback(null, {
                points: appliedPoints,
                requestedPoints,
                discount,
                maxDiscount,
                rawDiscount,
                rules,
                wallet
            });
        });
    });
}

function redeemPointsForPayment(userId, points, discount, sourceReceiptId, options = {}, callback) {
    const done = typeof options === 'function' ? options : callback;
    const metadata = typeof options === 'function' ? {} : options || {};
    const requestedPoints = Math.floor(Number(points || 0));
    const redeemDiscount = roundMoney(discount || 0);

    if (!userId || requestedPoints <= 0 || redeemDiscount <= 0) {
        done(null, { redeemed: false, points: 0, discount: 0 });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            done(tableError);
            return;
        }

        db.getConnection((connectionError, connection) => {
            if (connectionError) {
                done(connectionError);
                return;
            }

            connection.beginTransaction((transactionError) => {
                if (transactionError) {
                    connection.release();
                    done(transactionError);
                    return;
                }

                const updateSql = `
                    UPDATE loyalty_wallets
                    SET points_balance = points_balance - ?
                    WHERE user_id = ?
                        AND points_balance >= ?
                `;

                connection.query(updateSql, [requestedPoints, userId, requestedPoints], (updateError, result) => {
                    if (updateError || result.affectedRows === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            done(updateError || new Error('Not enough points to redeem.'));
                        });
                    }

                    const insertSql = `
                        INSERT IGNORE INTO loyalty_transactions
                            (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description, booking_reference, merchant_name, reward_discount)
                        VALUES (?, ?, 'POINTS_USED', ?, 0, ?, ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        userId,
                        String(sourceReceiptId),
                        -requestedPoints,
                        `Redeemed ${requestedPoints} points for $${redeemDiscount.toFixed(2)} booking discount`,
                        metadata.bookingReference || String(sourceReceiptId).replace(/^points-/, ''),
                        metadata.merchantName || '',
                        redeemDiscount
                    ], (insertError, insertResult) => {
                        if (insertError || insertResult.affectedRows === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                done(insertError || null, { redeemed: false, duplicate: true, points: 0, discount: 0 });
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            done(commitError, {
                                redeemed: !commitError,
                                points: requestedPoints,
                                discount: redeemDiscount
                            });
                        });
                    });
                });
            });
        });
    });
}

function getReceiptBirthdayMultiplier(receipt, callback) {
    if (!receipt?.userId || String(receipt.type || '').toLowerCase() !== 'booking') {
        callback(null, {
            multiplier: 1,
            birthdayApplied: false
        });
        return;
    }

    User.findById(receipt.userId, (error, user) => {
        if (error) {
            callback(error);
            return;
        }

        // Birthday rewards follow the payment month because points are granted when the receipt is paid.
        const birthdayApplied = isBirthdayMonthForDate(user?.birthday, receipt.paidAt || new Date());
        callback(null, {
            multiplier: birthdayApplied ? 2 : 1,
            birthdayApplied
        });
    });
}

function awardForReceipt(receipt, callback) {
    const totalAmount = Number(receipt.totalAmount || 0);
    const paymentStatus = String(receipt.paymentStatus || '').toLowerCase();

    if (!receipt.userId || totalAmount <= 0 || paymentStatus !== 'paid') {
        callback(null, { awarded: false });
        return;
    }

    return getRules((rulesError, rules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!rules.isEnabled) {
            callback(null, { awarded: false, disabled: true });
            return;
        }

        return getReceiptBirthdayMultiplier(receipt, (birthdayError, birthdayReward) => {
            if (birthdayError) {
                callback(birthdayError);
                return;
            }

            const basePoints = Math.floor(totalAmount * rules.pointsPerDollar);
            const platformCashback = roundMoney(totalAmount * (Number(rules.cashbackPercent || 0) / 100));
            const multiplier = Number(birthdayReward?.multiplier || 1);
            const points = basePoints * multiplier;
            const birthdayApplied = Boolean(birthdayReward?.birthdayApplied);
            const bonusPoints = Math.max(0, points - basePoints);
            const rewardLabel = platformCashback > 0 ? 'points and platform cashback' : 'points';
            const description = birthdayApplied
                ? `Earned ${rewardLabel} from receipt ${receipt.displayId || receipt.id} with birthday month 2X points`
                : `Earned ${rewardLabel} from receipt ${receipt.displayId || receipt.id}`;
            const sourceReceiptId = String(receipt.id);
            const receiptOrderId = Number(receipt.orderId || 0) || null;

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
                        `SELECT lt.loyalty_transaction_id, o.order_number
                         FROM loyalty_transactions lt
                         LEFT JOIN orders o
                            ON o.order_id = lt.order_id
                         WHERE lt.source_receipt_id = ?
                            AND lt.transaction_type IN ('EARNED', 'earn')
                         LIMIT 1`,
                        [sourceReceiptId],
                        (duplicateError, duplicateRows = []) => {
                            if (duplicateError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(duplicateError);
                                });
                            }

                            if (duplicateRows.length) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(null, { awarded: false, duplicate: true });
                                });
                            }

                            let validatedOrderId = null;

                            try {
                                validatedOrderId = getValidatedOrderIdForLoyalty(receiptOrderId, isOrderReceipt(receipt));
                            } catch (validationError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(validationError);
                                });
                            }

                            const insertSql = `
                                INSERT IGNORE INTO loyalty_transactions
                                    (user_id, order_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description, expires_at, booking_reference, merchant_name)
                                VALUES (?, ?, ?, 'EARNED', ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY), ?, ?)
                            `;

                            connection.query(insertSql, [
                                receipt.userId,
                                validatedOrderId,
                                sourceReceiptId,
                                points,
                                platformCashback,
                                description,
                                Math.max(1, Number(rules.pointsExpiryDays || DEFAULT_RULES.pointsExpiryDays)),
                                receipt.displayId || receipt.id || sourceReceiptId,
                                receipt.merchantName || ''
                            ], (insertError, result) => {
                                if (insertError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(insertError);
                                    });
                                }

                                if (!result.affectedRows) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(null, { awarded: false, duplicate: true });
                                    });
                                }

                                const updateSql = `
                                    INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
                                    VALUES (?, ?, ?, ?)
                                    ON DUPLICATE KEY UPDATE
                                        points_balance = points_balance + VALUES(points_balance),
                                        cashback_balance = cashback_balance + VALUES(cashback_balance),
                                        lifetime_points = lifetime_points + VALUES(lifetime_points)
                                `;

                                connection.query(updateSql, [
                                    receipt.userId,
                                    points,
                                    platformCashback,
                                    points
                                ], (updateError) => {
                                    if (updateError) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(updateError);
                                        });
                                    }

                                    return connection.commit((commitError) => {
                                        connection.release();
                                        callback(commitError, {
                                            awarded: !commitError,
                                            points,
                                            cashback: platformCashback,
                                            platformCashback,
                                            platformCashbackPercent: Number(rules.cashbackPercent || 0),
                                            basePoints,
                                            bonusPoints,
                                            multiplier,
                                            birthdayApplied
                                        });
                                    });
                                });
                            });
                        }
                    );
                });
            });
        });
    });
}

function loadReceiptForAward(userId, receiptId, callback) {
    const receiptKey = String(receiptId || '').trim();

    if (!userId || !receiptKey) {
        callback(null, null);
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const historySql = `
            SELECT
                ph.receipt_id AS id,
                ph.user_id,
                ph.purchase_type,
                ph.total_amount,
                ph.payment_status,
                ph.created_at,
                o.order_id,
                o.order_number
            FROM purchase_history ph
            LEFT JOIN orders o
                ON ph.payment_transaction_id = o.transaction_id
            WHERE ph.receipt_id = ?
                AND ph.user_id = ?
            LIMIT 1
        `;

        db.query(historySql, [receiptKey, userId], (historyError, rows = []) => {
            if (historyError) {
                callback(historyError);
                return;
            }

            if (rows[0]) {
                callback(null, {
                    id: rows[0].id,
                    userId: rows[0].user_id,
                    orderId: rows[0].order_id || null,
                    orderNumber: rows[0].order_number || '',
                    order_number: rows[0].order_number || '',
                    type: rows[0].purchase_type === 'booking' ? 'booking' : 'order',
                    totalAmount: Number(rows[0].total_amount || 0),
                    paymentStatus: rows[0].payment_status || 'paid',
                    paidAt: rows[0].created_at
                });
                return;
            }

            const bookingId = receiptKey.replace(/^booking-/, '');

            if (!/^\d+$/.test(bookingId)) {
                callback(null, null);
                return;
            }

            const bookingSql = `
                SELECT
                    bookings.booking_id AS id,
                    bookings.user_id,
                    services.price AS total_amount,
                    COALESCE(transactions.payment_status, CASE WHEN bookings.transaction_id IS NOT NULL OR bookings.status = 'paid' THEN 'paid' ELSE bookings.status END) AS payment_status
                FROM bookings
                INNER JOIN services ON services.service_id = bookings.service_id
                LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
                WHERE bookings.booking_id = ?
                    AND bookings.user_id = ?
                LIMIT 1
            `;

            db.query(bookingSql, [bookingId, userId], (bookingError, bookingRows = []) => {
                if (bookingError) {
                    callback(bookingError);
                    return;
                }

                const booking = bookingRows[0];

                if (!booking) {
                    callback(null, null);
                    return;
                }

                callback(null, {
                    id: booking.id,
                    userId: booking.user_id,
                    type: 'booking',
                    totalAmount: Number(booking.total_amount || 0),
                    paymentStatus: booking.payment_status || 'pending'
                });
            });
        });
    });
}

function awardPointsForReceipt(userId, receiptId, callback) {
    loadReceiptForAward(userId, receiptId, (lookupError, receipt) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (!receipt) {
            callback(null, { awarded: false, missing: true });
            return;
        }

        awardForReceipt(receipt, callback);
    });
}

function getReceiptCampaignGroups(receipt = {}) {
    const type = String(receipt.type || '').toLowerCase();

    if (type === 'booking') {
        const salonId = Number(receipt.merchantId || receipt.salonId || 0);
        const amount = roundMoney(receipt.originalAmount || receipt.totalAmount || 0);

        return salonId && amount > 0
            ? [{
                salonId,
                applicableType: 'services',
                subtotal: amount,
                merchantName: receipt.merchantName || '',
                serviceName: receipt.serviceName || receipt.items?.[0]?.name || ''
            }]
            : [];
    }

    const groups = new Map();
    (receipt.items || []).forEach((item) => {
        const itemType = String(item.type || '').toLowerCase();
        const salonId = Number(item.merchantId || item.salonId || 0);
        const lineTotal = roundMoney(item.lineTotal || (Number(item.unitPrice || item.price || 0) * Number(item.quantity || 1)));

        if (!salonId || lineTotal <= 0 || itemType !== 'product') {
            return;
        }

        const existing = groups.get(salonId) || {
            salonId,
            applicableType: 'products',
            subtotal: 0,
            merchantName: item.merchantName || item.detail || '',
            serviceName: 'Product order'
        };

        existing.subtotal = roundMoney(existing.subtotal + lineTotal);
        groups.set(salonId, existing);
    });

    return Array.from(groups.values());
}

function estimateCampaignCashback(receipt, callback) {
    const groups = getReceiptCampaignGroups(receipt);

    if (!groups.length) {
        callback(null, { total: 0, breakdown: [] });
        return;
    }

    const breakdown = [];
    let index = 0;

    function next(error) {
        if (error) {
            callback(error);
            return;
        }

        if (index >= groups.length) {
            callback(null, {
                total: roundMoney(breakdown.reduce((sum, entry) => sum + Number(entry.cashbackAmount || 0), 0)),
                breakdown
            });
            return;
        }

        const group = groups[index];
        index += 1;

        CashbackCampaign.findActiveForSpend({
            salonId: group.salonId,
            applicableType: group.applicableType,
            spend: group.subtotal
        }, (campaignError, campaign) => {
            if (campaignError) {
                next(campaignError);
                return;
            }

            const cashbackAmount = CashbackCampaign.calculateCashback(group.subtotal, campaign);

            if (campaign && cashbackAmount > 0) {
                breakdown.push({
                    campaignId: campaign.id,
                    campaignTitle: campaign.title,
                    salonId: group.salonId,
                    salonName: campaign.salonName || group.merchantName,
                    applicableType: group.applicableType,
                    subtotal: group.subtotal,
                    cashbackPercent: campaign.cashbackPercent,
                    cashbackAmount
                });
            }

            next();
        });
    }

    next();
}

function awardCampaignCashbackForReceipt(receipt, callback) {
    const receiptId = String(receipt?.id || receipt?.receiptId || '').trim();
    const userId = Number(receipt?.userId || 0);
    const paymentStatus = String(receipt?.paymentStatus || '').toLowerCase();
    const receiptOrderId = Number(receipt?.orderId || 0) || null;

    if (!receiptId || !userId || paymentStatus !== 'paid') {
        callback(null, { awarded: false, total: 0, breakdown: [] });
        return;
    }

    estimateCampaignCashback(receipt, (estimateError, estimate) => {
        if (estimateError) {
            callback(estimateError);
            return;
        }

        const awards = (estimate.breakdown || []).filter((entry) => Number(entry.cashbackAmount || 0) > 0);

        if (!awards.length) {
            callback(null, { awarded: false, total: 0, breakdown: [] });
            return;
        }

        let validatedOrderId = null;

        try {
            validatedOrderId = getValidatedOrderIdForLoyalty(receiptOrderId, isOrderReceipt(receipt));
        } catch (validationError) {
            callback(validationError);
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

                const inserted = [];
                let awardIndex = 0;

                function insertNext(error) {
                    if (error) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(error);
                        });
                    }

                    if (awardIndex >= awards.length) {
                        const total = roundMoney(inserted.reduce((sum, entry) => sum + Number(entry.cashbackAmount || 0), 0));

                        if (total <= 0) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(null, { awarded: false, duplicate: true, total: 0, breakdown: [] });
                            });
                        }

                        const walletSql = `
                            INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
                            VALUES (?, 0, ?, 0)
                            ON DUPLICATE KEY UPDATE cashback_balance = cashback_balance + VALUES(cashback_balance)
                        `;

                        return connection.query(walletSql, [userId, total], (walletError) => {
                            if (walletError) {
                                return insertNext(walletError);
                            }

                            return connection.commit((commitError) => {
                                connection.release();
                                callback(commitError, {
                                    awarded: !commitError,
                                    total,
                                    breakdown: inserted
                                });
                            });
                        });
                    }

                    const award = awards[awardIndex];
                    awardIndex += 1;
                    const sourceReceiptId = `campaign-${receiptId}-${award.campaignId}-${award.salonId}`;
                    const description = `${award.campaignTitle} cashback from receipt ${receipt.displayId || receiptId}`;

                    const insertSql = `
                        INSERT IGNORE INTO loyalty_transactions
                            (user_id, order_id, source_receipt_id, campaign_id, salon_id, transaction_type, points_delta, cashback_delta, description, booking_reference, merchant_name)
                        VALUES (?, ?, ?, ?, ?, 'CASHBACK_EARNED', 0, ?, ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        userId,
                        validatedOrderId,
                        sourceReceiptId,
                        award.campaignId,
                        award.salonId,
                        award.cashbackAmount,
                        description,
                        receipt.displayId || receiptId,
                        award.salonName || receipt.merchantName || ''
                    ], (insertError, result) => {
                        if (insertError) {
                            return insertNext(insertError);
                        }

                        if (result.affectedRows > 0) {
                            inserted.push(award);
                        }

                        return insertNext();
                    });
                }

                insertNext();
            });
        });
    });
}

function reverseCampaignCashbackForReceipt(receiptId, callback) {
    const rawReceiptId = String(receiptId || '').trim();
    const sourcePrefix = `campaign-${rawReceiptId}-%`;

    if (!rawReceiptId) {
        callback(null, { reversed: false, total: 0 });
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

            const lookupSql = `
                SELECT lt.*, o.order_number
                FROM loyalty_transactions lt
                LEFT JOIN orders o
                    ON o.order_id = lt.order_id
                WHERE lt.source_receipt_id LIKE ?
                    AND lt.transaction_type = 'CASHBACK_EARNED'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM loyalty_transactions reversed
                        WHERE reversed.source_receipt_id = CONCAT('reverse-', lt.source_receipt_id)
                            AND reversed.transaction_type = 'CASHBACK_REVERSED'
                    )
            `;

            connection.query(lookupSql, [sourcePrefix], (lookupError, rows = []) => {
                if (lookupError) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(lookupError);
                    });
                }

                if (!rows.length) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(null, { reversed: false, total: 0 });
                    });
                }

                const total = roundMoney(rows.reduce((sum, row) => sum + Number(row.cashback_delta || 0), 0));
                let index = 0;

                function insertReverse(error) {
                    if (error) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(error);
                        });
                    }

                    if (index >= rows.length) {
                        const walletSql = `
                            UPDATE loyalty_wallets
                            SET cashback_balance = GREATEST(cashback_balance - ?, 0)
                            WHERE user_id = ?
                        `;

                        return connection.query(walletSql, [total, rows[0].user_id], (walletError) => {
                            if (walletError) {
                                return insertReverse(walletError);
                            }

                            return connection.commit((commitError) => {
                                connection.release();
                                callback(commitError, {
                                    reversed: !commitError,
                                    total
                                });
                            });
                        });
                    }

                    const earned = rows[index];
                    index += 1;

                    const insertSql = `
                        INSERT IGNORE INTO loyalty_transactions
                            (user_id, order_id, source_receipt_id, campaign_id, salon_id, transaction_type, points_delta, cashback_delta, description, booking_reference, merchant_name)
                        VALUES (?, ?, ?, ?, ?, 'CASHBACK_REVERSED', 0, ?, ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        earned.user_id,
                        earned.order_id || null,
                        `reverse-${earned.source_receipt_id}`,
                        earned.campaign_id,
                        earned.salon_id,
                        -Number(earned.cashback_delta || 0),
                        `Reversed campaign cashback for receipt ${rawReceiptId}`,
                        earned.booking_reference || rawReceiptId,
                        earned.merchant_name || ''
                    ], insertReverse);
                }

                insertReverse();
            });
        });
    });
}

function getCampaignCashbackForReceipt(receiptId, callback) {
    const rawReceiptId = String(receiptId || '').trim();

    if (!rawReceiptId) {
        callback(null, { earned: 0, reversed: 0, net: 0, transactions: [] });
        return;
    }

    const sql = `
        SELECT lt.*, o.order_number
        FROM loyalty_transactions lt
        LEFT JOIN orders o
            ON o.order_id = lt.order_id
        WHERE (lt.source_receipt_id LIKE ? OR lt.source_receipt_id LIKE ?)
            AND lt.transaction_type IN ('CASHBACK_EARNED', 'CASHBACK_REVERSED')
        ORDER BY lt.loyalty_transaction_id
    `;

    db.query(sql, [`campaign-${rawReceiptId}-%`, `reverse-campaign-${rawReceiptId}-%`], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        const transactions = rows.map(mapTransaction);
        const earned = roundMoney(transactions
            .filter((entry) => entry.type === 'CASHBACK_EARNED')
            .reduce((sum, entry) => sum + Number(entry.cashbackDelta || 0), 0));
        const reversed = roundMoney(Math.abs(transactions
            .filter((entry) => entry.type === 'CASHBACK_REVERSED')
            .reduce((sum, entry) => sum + Number(entry.cashbackDelta || 0), 0)));

        callback(null, {
            earned,
            reversed,
            net: roundMoney(earned - reversed),
            transactions
        });
    });
}

function awardReviewBonus(userId, bookingId, options = {}, callback) {
    const basePoints = Number(options.basePoints || 0);
    const mediaPoints = Number(options.mediaPoints || 0);
    const detailPoints = Number(options.detailPoints || 0);
    const totalPoints = Math.max(0, Math.floor(basePoints + mediaPoints + detailPoints));

    if (!userId || !bookingId || totalPoints <= 0) {
        callback(null, { awarded: false, points: 0 });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
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

                const sourceReceiptId = `booking-review-${bookingId}`;
                const descriptionParts = [`Review reward for booking #${bookingId}`];

                if (basePoints > 0) descriptionParts.push(`+${Math.floor(basePoints)} rating`);
                if (mediaPoints > 0) descriptionParts.push(`+${Math.floor(mediaPoints)} media`);
                if (detailPoints > 0) descriptionParts.push(`+${Math.floor(detailPoints)} detail`);

                const insertSql = `
                    INSERT IGNORE INTO loyalty_transactions
                        (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                    VALUES (?, ?, 'review_bonus', ?, 0, ?)
                `;

                connection.query(insertSql, [
                    userId,
                    sourceReceiptId,
                    totalPoints,
                    descriptionParts.join(' ')
                ], (insertError, result) => {
                    if (insertError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(insertError);
                        });
                    }

                    if (!result.affectedRows) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, { awarded: false, duplicate: true, points: 0 });
                        });
                    }

                    const updateSql = `
                        INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
                        VALUES (?, ?, 0, ?)
                        ON DUPLICATE KEY UPDATE
                            points_balance = points_balance + VALUES(points_balance),
                            lifetime_points = lifetime_points + VALUES(lifetime_points)
                    `;

                    connection.query(updateSql, [userId, totalPoints, totalPoints], (updateError) => {
                        if (updateError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(updateError);
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            callback(commitError, {
                                awarded: !commitError,
                                points: totalPoints,
                                breakdown: {
                                    basePoints: Math.floor(basePoints),
                                    mediaPoints: Math.floor(mediaPoints),
                                    detailPoints: Math.floor(detailPoints)
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

function redeemCashback(userId, amount, sourceReceiptId, options = {}, callback) {
    const redeemOptions = typeof options === 'function' ? {} : options || {};
    const done = typeof options === 'function' ? options : callback;
    const redeemAmount = roundMoney(amount);
    const cashbackOrderId = Number(redeemOptions.orderId || 0) || null;
    const orderReference = redeemOptions.orderNumber || sourceReceiptId;

    if (!userId || redeemAmount <= 0) {
        done(null, { redeemed: false, amount: 0 });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            done(tableError);
            return;
        }

        let validatedOrderId = null;

        try {
            validatedOrderId = getValidatedOrderIdForLoyalty(
                cashbackOrderId,
                isOrderRelatedCashback(sourceReceiptId, redeemOptions)
            );
        } catch (validationError) {
            done(validationError);
            return;
        }

        db.getConnection((connectionError, connection) => {
            if (connectionError) {
                done(connectionError);
                return;
            }

            connection.beginTransaction((transactionError) => {
                if (transactionError) {
                    connection.release();
                    done(transactionError);
                    return;
                }

                const insertSql = `
                    INSERT IGNORE INTO loyalty_transactions
                        (user_id, order_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                    VALUES (?, ?, ?, 'CASHBACK_USED', 0, ?, ?)
                `;

                connection.query(insertSql, [
                    userId,
                    validatedOrderId,
                    String(sourceReceiptId),
                    -redeemAmount,
                    `Cashback used at checkout for ${orderReference}`
                ], (insertError, insertResult) => {
                    if (insertError || insertResult.affectedRows === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            done(insertError || null, { redeemed: false, duplicate: true, amount: 0 });
                        });
                    }

                    const updateSql = `
                        UPDATE loyalty_wallets
                        SET cashback_balance = cashback_balance - ?
                        WHERE user_id = ?
                            AND cashback_balance >= ?
                    `;

                    connection.query(updateSql, [redeemAmount, userId, redeemAmount], (updateError, result) => {
                        if (updateError || result.affectedRows === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                done(updateError || new Error('Not enough cashback balance.'));
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            done(commitError, {
                                redeemed: !commitError,
                                amount: redeemAmount
                            });
                        });
                    });
                });
            });
        });
    });
}

function redeemPointsForCashback(userId, points, callback) {
    const requestedPoints = Math.floor(Number(points || 0));

    return getRules((rulesError, rules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!rules.isEnabled) {
            callback(new Error('Loyalty rewards are currently disabled.'));
            return;
        }

        if (requestedPoints < rules.minPointsToRedeem) {
            callback(new Error(`Minimum redemption is ${rules.minPointsToRedeem} points`));
            return;
        }

        const cashback = roundMoney(requestedPoints * rules.pointsToCashRate);

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
                    UPDATE loyalty_wallets
                    SET points_balance = points_balance - ?,
                        cashback_balance = cashback_balance + ?
                    WHERE user_id = ?
                        AND points_balance >= ?
                `;

                connection.query(updateSql, [requestedPoints, cashback, userId, requestedPoints], (updateError, result) => {
                    if (updateError || result.affectedRows === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(updateError || new Error('Not enough points to redeem.'));
                        });
                    }

                    const insertSql = `
                        INSERT INTO loyalty_transactions
                            (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                        VALUES (?, ?, 'REDEEMED', ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        userId,
                        `points-${Date.now()}`,
                        -requestedPoints,
                        cashback,
                        `Redeemed ${requestedPoints} points for $${cashback.toFixed(2)} cashback`
                    ], (insertError) => {
                        if (insertError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(insertError);
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            callback(commitError, {
                                points: requestedPoints,
                                cashback
                            });
                        });
                    });
                });
            });
        });
    });
}

module.exports = {
    ACTIVITY_TYPES,
    applyTransactionDisplayDetails,
    awardForReceipt,
    awardCampaignCashbackForReceipt,
    awardPointsForReceipt,
    awardReviewBonus,
    ensureWallet,
    estimateCampaignCashback,
    calculatePointRedemption,
    getEffectiveRedemptionRules,
    getMerchantRules,
    getMerchantRewardAnalytics,
    getPlatformSummary,
    getRules,
    getTransactionsPage,
    getCampaignCashbackForReceipt,
    getWalletView,
    redeemCashback,
    redeemPointsForPayment,
    redeemPointsForCashback,
    reverseCampaignCashbackForReceipt,
    updateMerchantRules,
    updateRules
};
