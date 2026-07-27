const db = require('../../db');
const { buildAnalyticsDataAnswer } = require('../analyticsAiDataService');
const { routeAiData } = require('./aiDataRouter');
const { validateAiRequestPermissions } = require('./aiPermissionService');

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, rows = []) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(rows);
        });
    });
}

async function checkDatabase() {
    const rows = await query('SELECT 1 AS ok');
    return rows?.[0]?.ok === 1;
}

function checkGroqConfig() {
    return Boolean(String(process.env.GROQ_API_KEY || '').trim())
        && Boolean(String(process.env.GROQ_TEXT_MODEL || '').trim());
}

async function checkRouter(role) {
    const summary = role === 'admin'
        ? {
            period: { label: 'Health check' },
            metrics: { totalPlatformRevenue: 100, totalBookings: 2 },
            topMerchantsByRevenue: [{ merchantName: 'Health Merchant', revenue: 100 }]
        }
        : {
            period: { label: 'Health check' },
            metrics: { totalRevenue: 100, totalBookings: 2, totalOrders: 1 },
            topServicesByRevenue: [{ serviceName: 'Health Service', bookings: 2, revenue: 100 }]
        };

    let userId = 1;
    if (role === 'merchant') {
        const merchants = await query('SELECT merchant_id FROM salons ORDER BY salon_id ASC LIMIT 1');
        userId = merchants?.[0]?.merchant_id;
        if (!userId) {
            throw new Error('No merchant profile is available for merchant router validation.');
        }
    }

    const routed = await routeAiData({
        role,
        userId,
        intentResult: {
            intent: role === 'admin' ? 'admin_platform_revenue' : 'merchant_revenue',
            question: 'explain revenue',
            entities: { analyticsPeriod: 'last30' }
        },
        period: 'last30'
    });

    const deterministic = buildAnalyticsDataAnswer(summary, 'explain revenue', role);
    return Boolean(routed.dataSources?.length) && Boolean(deterministic?.answer);
}

function checkPermissionGuards() {
    const merchantReq = { session: { user: { id: 8, role: 'merchant' } } };
    const adminReq = { session: { user: { id: 1, role: 'admin' } } };
    const merchantIdentity = validateAiRequestPermissions({
        req: merchantReq,
        role: 'merchant',
        intent: 'merchant_revenue',
        entities: {}
    });
    const adminIdentity = validateAiRequestPermissions({
        req: adminReq,
        role: 'admin',
        intent: 'admin_platform_revenue',
        entities: {}
    });

    return merchantIdentity.userId === 8 && adminIdentity.userId === 1;
}

async function runAiHealthCheck() {
    const checks = {
        database: false,
        groqConfiguration: false,
        merchantAnalyticsRouter: false,
        adminAnalyticsRouter: false,
        deterministicFallback: false,
        permissionChecks: false
    };
    const errors = {};

    try {
        checks.database = await checkDatabase();
    } catch (error) {
        errors.database = error.message;
    }

    checks.groqConfiguration = checkGroqConfig();

    try {
        checks.merchantAnalyticsRouter = await checkRouter('merchant');
    } catch (error) {
        errors.merchantAnalyticsRouter = error.message;
    }

    try {
        checks.adminAnalyticsRouter = await checkRouter('admin');
    } catch (error) {
        errors.adminAnalyticsRouter = error.message;
    }

    checks.deterministicFallback = Boolean(buildAnalyticsDataAnswer({
        period: { label: 'Health check' },
        metrics: { totalRevenue: 1, totalBookings: 1, totalOrders: 0 }
    }, 'explain revenue', 'merchant')?.answer);

    try {
        checks.permissionChecks = checkPermissionGuards();
    } catch (error) {
        errors.permissionChecks = error.message;
    }

    return {
        ok: Object.values(checks).every(Boolean),
        environment: process.env.NODE_ENV || 'development',
        checks,
        errors,
        generatedAt: new Date().toISOString()
    };
}

module.exports = {
    runAiHealthCheck
};
