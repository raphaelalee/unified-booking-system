const Loyalty = require('../models/Loyalty');

function getRulesForm(body = {}) {
    return {
        pointsPerDollar: Number(body.pointsPerDollar || 0),
        cashbackPercent: Number(body.cashbackPercent || 0),
        minPointsToRedeem: Number.parseInt(body.minPointsToRedeem, 10) || 0,
        pointsToCashRate: Number(body.pointsToCashRate || 0),
        isEnabled: body.isEnabled === 'on' || body.isEnabled === true
    };
}

function validateRules(rules) {
    const errors = [];

    if (!Number.isFinite(rules.pointsPerDollar) || rules.pointsPerDollar < 0) {
        errors.push('Points per dollar must be zero or more.');
    }

    if (!Number.isFinite(rules.cashbackPercent) || rules.cashbackPercent < 0 || rules.cashbackPercent > 50) {
        errors.push('Cashback percent must be between 0 and 50.');
    }

    if (!Number.isInteger(rules.minPointsToRedeem) || rules.minPointsToRedeem < 1) {
        errors.push('Minimum redeem points must be at least 1.');
    }

    if (!Number.isFinite(rules.pointsToCashRate) || rules.pointsToCashRate <= 0) {
        errors.push('Points to cashback rate must be more than 0.');
    }

    return errors;
}

function renderWallet(req, res, viewName, title) {
    return Loyalty.getWalletView(req.session.user.id, (error, viewModel) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Rewards Error',
                message: 'Your rewards wallet could not be loaded.'
            });
        }

        const success = req.session.loyaltySuccess;
        const redeemError = req.session.loyaltyError;
        req.session.loyaltySuccess = null;
        req.session.loyaltyError = null;

        return res.render(viewName, {
            title,
            wallet: viewModel.wallet,
            rules: viewModel.rules,
            transactions: viewModel.transactions,
            success,
            error: redeemError
        });
    });
}

function showWallet(req, res) {
    return res.redirect('/profile#wallet');
}

function showCashback(req, res) {
    return renderWallet(req, res, 'cashback', 'Cashback');
}

function redeemPoints(req, res) {
    const points = req.body.points;

    return Loyalty.redeemPointsForCashback(req.session.user.id, points, (error, result) => {
        if (error) {
            req.session.loyaltyError = error.message || 'Rewards could not be redeemed.';
            return res.redirect('/profile#wallet');
        }

        req.session.loyaltySuccess = `${result.points} points converted into $${Number(result.cashback).toFixed(2)} cashback.`;
        return res.redirect('/profile#wallet');
    });
}

function showAdminRules(req, res) {
    return Loyalty.getRules((error, rules) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Loyalty Settings Error',
                message: 'Loyalty settings could not be loaded.'
            });
        }

        const success = req.session.adminSuccess;
        const adminError = req.session.adminError;
        req.session.adminSuccess = null;
        req.session.adminError = null;

        return res.render('admin-loyalty', {
            title: 'Loyalty Settings',
            rules,
            success,
            error: adminError
        });
    });
}

function updateAdminRules(req, res) {
    const rules = getRulesForm(req.body);
    const errors = validateRules(rules);

    if (errors.length > 0) {
        req.session.adminError = errors.join(' ');
        return res.redirect('/admin/loyalty');
    }

    return Loyalty.updateRules(rules, (error) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'Loyalty settings could not be updated.';
        } else {
            req.session.adminSuccess = 'Loyalty settings updated.';
        }

        return res.redirect('/admin/loyalty');
    });
}

module.exports = {
    redeemPoints,
    showAdminRules,
    showCashback,
    showWallet,
    updateAdminRules
};
