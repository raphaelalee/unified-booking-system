const Loyalty = require('../models/Loyalty');
const AuditLog = require('../models/AuditLog');
const PurchaseHistory = require('../models/PurchaseHistory');
const User = require('../models/User');
const UserVoucher = require('../models/UserVoucher');
const { getBirthdayPromotionContext } = require('../utils/birthdayPromotions');

function getRulesForm(body = {}) {
    return {
        pointsPerDollar: Number(body.pointsPerDollar || 0),
        cashbackPercent: Number(body.cashbackPercent || 0),
        minPointsToRedeem: Number.parseInt(body.minPointsToRedeem, 10) || 0,
        pointsToCashRate: Number(body.pointsToCashRate || 0),
        maxDiscountPercent: Number(body.maxDiscountPercent || 0),
        pointsExpiryDays: Number.parseInt(body.pointsExpiryDays, 10) || 0,
        isEnabled: body.isEnabled === 'on' || body.isEnabled === true
    };
}

function validateRules(rules) {
    const errors = [];

    if (!Number.isInteger(rules.pointsPerDollar) || rules.pointsPerDollar < 1) {
        errors.push('Points per dollar must be a positive whole number.');
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

    if (!Number.isFinite(rules.maxDiscountPercent) || rules.maxDiscountPercent < 0 || rules.maxDiscountPercent > 100) {
        errors.push('Maximum booking discount must be between 0 and 100%.');
    }

    if (!Number.isInteger(rules.pointsExpiryDays) || rules.pointsExpiryDays < 1) {
        errors.push('Points expiry period must be at least 1 day.');
    }

    return errors;
}

function mapWalletReceipt(row) {
    return {
        id: String(row.receipt_id || '').replace(/^order-/, ''),
        receiptId: row.receipt_id,
        itemNames: row.item_names || 'Paid receipt',
        totalAmount: Number(row.total_amount || 0),
        paymentStatus: row.payment_status || 'paid',
        createdAt: row.created_at
    };
}

function awardReceiptSeries(userId, receipts, callback) {
    let index = 0;

    function next(error) {
        if (error) {
            callback(error);
            return;
        }

        if (index >= receipts.length) {
            callback(null);
            return;
        }

        const receipt = receipts[index];
        index += 1;

        Loyalty.awardPointsForReceipt(userId, receipt.receiptId, (awardError) => {
            if (awardError) {
                console.error(awardError);
            }

            next(null);
        });
    }

    next();
}

function buildBirthdayPromotion(user, vouchers = []) {
    const context = getBirthdayPromotionContext(user?.birthday);
    const voucher = vouchers.find((entry) => {
        return String(entry.sourceType || '').toLowerCase() === 'birthday'
            && String(entry.sourceReference || '') === `birthday-${context.rewardYear}`;
    }) || null;

    return {
        hasBirthday: context.hasBirthday,
        isBirthdayMonth: context.isBirthdayMonth,
        monthName: context.monthName,
        monthEndLabel: context.monthEndLabel,
        voucher,
        pointsMultiplier: context.isBirthdayMonth ? 2 : 1
    };
}

function renderWallet(req, res, viewName, title) {
    const userId = req.session.user.id;

    return User.findById(userId, (userError, accountUser) => {
        if (userError) {
            console.error(userError);
        }

        const continueWithWallet = () => PurchaseHistory.getByUserId(userId, (historyError, rows = []) => {
            if (historyError) {
                console.error(historyError);
            }

            const receipts = (historyError ? [] : rows)
                .filter((row) => String(row.payment_status || '').toLowerCase() === 'paid')
                .map(mapWalletReceipt);

            return awardReceiptSeries(userId, receipts, () => Loyalty.getWalletView(userId, (error, viewModel) => {
                if (error) {
                    console.error(error);
                    return res.status(500).render('error', {
                        title: 'Rewards Error',
                        message: 'Your rewards wallet could not be loaded.'
                    });
                }

                return UserVoucher.getByUserId(userId, (voucherError, vouchers = []) => {
                    if (voucherError) {
                        console.error(voucherError);
                    }

                    const success = req.session.loyaltySuccess;
                    const redeemError = req.session.loyaltyError;
                    req.session.loyaltySuccess = null;
                    req.session.loyaltyError = null;

                    const transactions = Loyalty.applyTransactionDisplayDetails(viewModel.transactions, receipts);

                    return res.render(viewName, {
                        title,
                        wallet: viewModel.wallet,
                        rules: viewModel.rules,
                        transactions,
                        receipts,
                        birthdayPromotion: buildBirthdayPromotion(accountUser, vouchers),
                        success,
                        error: redeemError
                    });
                });
            }));
        });

        if (!accountUser) {
            return continueWithWallet();
        }

        return UserVoucher.ensureBirthdayVoucherForUser(accountUser, (birthdayVoucherError) => {
            if (birthdayVoucherError) {
                console.error(birthdayVoucherError);
            }

            return continueWithWallet();
        });
    });
}

function showWallet(req, res) {
    return renderWallet(req, res, 'wallet', 'Rewards Wallet');
}

function redeemPoints(req, res) {
    const points = req.body.points;
    const redirectPath = req.originalUrl.startsWith('/customer/') ? '/customer/wallet' : '/profile#wallet';

    return Loyalty.redeemPointsForCashback(req.session.user.id, points, (error, result) => {
        if (error) {
            const message = String(error.message || '');
            req.session.loyaltyError = message.includes('Minimum redemption')
                ? message
                : message.includes('Not enough') || message.includes('points')
                    ? 'Insufficient points'
                    : 'Rewards could not be redeemed.';
            return res.redirect(redirectPath);
        }

        AuditLog.log({
            actorUserId: req.session.user?.id,
            actorRole: req.session.user?.role || 'customer',
            action: 'points_converted_to_cashback',
            entityType: 'loyalty_wallet',
            entityId: req.session.user?.id,
            details: {
                points: result?.points || Number(points || 0),
                cashback: result?.cashback || 0
            }
        }, (auditError) => {
            if (auditError) console.error(auditError);
        });
        req.session.loyaltySuccess = 'Points redeemed successfully';
        return res.redirect(redirectPath);
    });
}

function applyCashback(req, res) {
    return Loyalty.getWalletView(req.session.user.id, (error, loyalty) => {
        if (error) {
            console.error(error);
            req.session.success = 'Cashback could not be applied.';
            return res.redirect('/cart');
        }

        if (Number(loyalty?.wallet?.cashbackBalance || 0) <= 0) {
            req.session.success = 'No cashback available yet.';
            return res.redirect('/cart');
        }

        req.session.applyCashback = true;
        req.session.success = 'Cashback applied successfully';
        return res.redirect('/cart');
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
            AuditLog.log({
                actorUserId: req.session.user?.id,
                actorRole: req.session.user?.role || 'admin',
                action: 'admin_loyalty_rules_updated',
                entityType: 'loyalty_rules',
                entityId: 'platform',
                details: rules
            }, (auditError) => {
                if (auditError) console.error(auditError);
            });
            req.session.adminSuccess = 'Loyalty settings updated.';
        }

        return res.redirect('/admin/loyalty');
    });
}

module.exports = {
    applyCashback,
    redeemPoints,
    showAdminRules,
    showWallet,
    updateAdminRules
};
