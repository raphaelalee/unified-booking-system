const db = require('../db');

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function buildConfig(settingsRows = [], amountRows = [], termRows = []) {
    const settings = settingsRows.reduce((map, row) => {
        map[row.setting_key] = row.setting_value;
        return map;
    }, {});
    const amounts = amountRows
        .map((row) => Number(row.amount))
        .filter((amount) => Number.isFinite(amount) && amount > 0);
    const terms = termRows
        .map((row) => String(row.term_text || '').trim())
        .filter(Boolean);
    const minAmount = toNumber(settings.min_amount);
    const maxAmount = toNumber(settings.max_amount);
    const validityMonths = toNumber(settings.validity_months);

    return {
        amounts,
        minAmount,
        maxAmount,
        validityMonths: validityMonths ? Math.max(1, Math.floor(validityMonths)) : null,
        terms
    };
}

function getConfig(callback) {
    db.query(
        `
            SELECT setting_key, setting_value
            FROM gift_card_settings
            WHERE setting_key IN ('min_amount', 'max_amount', 'validity_months')
        `,
        (settingsError, settingsRows = []) => {
        if (settingsError) {
            callback(settingsError);
            return;
        }

        db.query(
            'SELECT amount FROM gift_card_amounts WHERE is_active = 1 ORDER BY sort_order ASC, amount ASC',
            (amountError, amountRows = []) => {
                if (amountError) {
                    callback(amountError);
                    return;
                }

                db.query(
                    'SELECT term_text FROM gift_card_terms WHERE is_active = 1 ORDER BY sort_order ASC, gift_card_term_id ASC',
                    (termError, termRows = []) => {
                        if (termError) {
                            callback(termError);
                            return;
                        }

                        callback(null, buildConfig(settingsRows, amountRows, termRows));
                    }
                );
            }
        );
        }
    );
}

module.exports = {
    getConfig
};
