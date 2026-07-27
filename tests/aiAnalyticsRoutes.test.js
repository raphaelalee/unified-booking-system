const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const db = require('../db');
const aiController = require('../controllers/aiController');

let currentUser = null;
let merchantApprovalStatus = 'approved';
let server = null;

const originalQuery = db.query;
const originalHandlers = {
    generateMerchantBusinessInsights: aiController.generateMerchantBusinessInsights,
    answerMerchantAnalyticsQuestion: aiController.answerMerchantAnalyticsQuestion,
    generateAdminPlatformInsights: aiController.generateAdminPlatformInsights,
    answerAdminAnalyticsQuestion: aiController.answerAdminAnalyticsQuestion,
    createMerchantActionProposal: aiController.createMerchantActionProposal,
    confirmAiPromotion: aiController.confirmAiPromotion,
    createAdminActionProposal: aiController.createAdminActionProposal,
    dismissMerchantAiReminder: aiController.dismissMerchantAiReminder,
    markMerchantAiReminderDone: aiController.markMerchantAiReminderDone
};

test.before(() => {
    db.query = (sql, params, callback) => {
        if (String(sql).includes('SELECT approval_status FROM salons WHERE merchant_id = ? LIMIT 1')) {
            assert.equal(params[0], currentUser?.id);
            callback(null, [{ approval_status: merchantApprovalStatus }]);
            return;
        }

        return originalQuery.call(db, sql, params, callback);
    };
    aiController.generateMerchantBusinessInsights = (req, res) => res.json({
        ok: true,
        sessionUserId: req.session.user.id,
        submittedMerchantId: req.body?.merchantId || null
    });
    aiController.answerMerchantAnalyticsQuestion = (req, res) => res.json({ ok: true });
    aiController.createMerchantActionProposal = (req, res) => res.json({
        ok: true,
        sessionUserId: req.session.user.id,
        submittedMerchantId: req.body?.merchantId || null
    });
    aiController.confirmAiPromotion = (req, res) => res.json({ ok: true, proposalId: req.body?.proposalId });
    aiController.dismissMerchantAiReminder = (req, res) => res.json({ ok: true, reminderId: req.body?.reminderId });
    aiController.markMerchantAiReminderDone = (req, res) => res.json({ ok: true, reminderId: req.body?.reminderId });
    aiController.generateAdminPlatformInsights = (req, res) => res.json({ ok: true, role: req.session.user.role });
    aiController.answerAdminAnalyticsQuestion = (req, res) => res.json({ ok: true });
    aiController.createAdminActionProposal = (req, res) => res.json({ ok: true, role: req.session.user.role });

    const aiRoutes = require('../routes/aiRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = currentUser ? { user: { ...currentUser } } : {};
        next();
    });
    app.use('/api/ai', aiRoutes);
    server = app.listen(0, '127.0.0.1');
});

test.after(async () => {
    db.query = originalQuery;
    Object.assign(aiController, originalHandlers);
    await new Promise((resolve) => {
        server?.close(resolve);
    });
    await new Promise((resolve) => {
        setTimeout(resolve, 1200);
    });
    db.end?.();
});

function requestJson(path, body = {}, targetServer = server) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1',
            port: targetServer.address().port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: raw ? JSON.parse(raw) : {}
                });
            });
        });
        req.on('error', reject);
        req.end(payload);
    });
}

function requestGet(path, targetServer = server) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port: targetServer.address().port,
            path,
            method: 'GET'
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: raw ? JSON.parse(raw) : {}
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

test('merchant AI route rejects unauthenticated requests', async () => {
    currentUser = null;
    const response = await requestJson('/api/ai/merchant/business-insights');

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, 'UNAUTHENTICATED');
});

test('merchant AI route rejects customer role', async () => {
    currentUser = { id: 1, role: 'customer' };
    const response = await requestJson('/api/ai/merchant/business-insights');

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'FORBIDDEN');
});

test('merchant AI route requires approved merchant status', async () => {
    currentUser = { id: 3, role: 'merchant' };
    merchantApprovalStatus = 'suspended';
    const response = await requestJson('/api/ai/merchant/business-insights');

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'MERCHANT_NOT_APPROVED');
});

test('merchant AI route ignores submitted merchant ID and keeps session identity', async () => {
    currentUser = { id: 3, role: 'merchant' };
    merchantApprovalStatus = 'approved';
    const response = await requestJson('/api/ai/merchant/business-insights', { merchantId: 999 });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.sessionUserId, 3);
    assert.equal(response.body.submittedMerchantId, 999);
});

test('admin AI route rejects merchant role', async () => {
    currentUser = { id: 3, role: 'merchant' };
    const response = await requestJson('/api/ai/admin/platform-insights');

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'FORBIDDEN');
});

test('admin AI route allows admin role', async () => {
    currentUser = { id: 2, role: 'admin' };
    const response = await requestJson('/api/ai/admin/platform-insights');

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.role, 'admin');
});

test('merchant AI action route requires approved merchant status', async () => {
    currentUser = { id: 8, role: 'merchant' };
    merchantApprovalStatus = 'pending_review';
    const response = await requestJson('/api/ai/merchant/action-proposal', { prompt: 'prepare a promotion' });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'MERCHANT_NOT_APPROVED');
});

test('merchant AI action route ignores submitted merchant ID and keeps session identity', async () => {
    currentUser = { id: 8, role: 'merchant' };
    merchantApprovalStatus = 'approved';
    const response = await requestJson('/api/ai/merchant/action-proposal', { merchantId: 999, prompt: 'prepare a promotion' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.sessionUserId, 8);
    assert.equal(response.body.submittedMerchantId, 999);
});

test('merchant AI confirmation route rejects customer role', async () => {
    currentUser = { id: 12, role: 'customer' };
    const response = await requestJson('/api/ai/merchant/actions/confirm-promotion', { proposalId: 'abc' });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'FORBIDDEN');
});

test('admin AI action route rejects merchant role', async () => {
    currentUser = { id: 8, role: 'merchant' };
    merchantApprovalStatus = 'approved';
    const response = await requestJson('/api/ai/admin/action-proposal', { prompt: 'review a merchant' });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'FORBIDDEN');
});

test('admin AI action route allows admin role', async () => {
    currentUser = { id: 2, role: 'admin' };
    const response = await requestJson('/api/ai/admin/action-proposal', { prompt: 'review platform risk' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.role, 'admin');
});

test('AI health check route is admin-only', async () => {
    currentUser = { id: 8, role: 'merchant' };
    merchantApprovalStatus = 'approved';
    const denied = await requestGet('/api/ai/admin/health-check');

    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.error, 'FORBIDDEN');
});
