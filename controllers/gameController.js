const MerchantService = require('../models/MerchantService');
const RewardsGame = require('../models/RewardsGame');

function getSettingsForm(body = {}) {
    return {
        weeklyFreePlays: Number(body.weeklyFreePlays || 1),
        spendPerBonusPlay: Number(body.spendPerBonusPlay || 80),
        bonusPlaysPerThreshold: Number(body.bonusPlaysPerThreshold || 1),
        isEnabled: body.isEnabled === 'on' || body.isEnabled === true
    };
}

function getPrizeForm(body = {}) {
    return {
        salonId: String(body.salonId || '').trim(),
        title: String(body.title || '').trim(),
        description: String(body.description || '').trim(),
        prizeType: String(body.prizeType || 'voucher').trim(),
        rewardValue: String(body.rewardValue || '').trim(),
        weight: String(body.weight || '10').trim(),
        status: String(body.status || 'active').trim()
    };
}

function validateSettings(settings) {
    const errors = [];

    if (!Number.isInteger(settings.weeklyFreePlays) || settings.weeklyFreePlays < 0) {
        errors.push('Weekly free plays must be zero or more.');
    }

    if (!Number.isFinite(settings.spendPerBonusPlay) || settings.spendPerBonusPlay < 1) {
        errors.push('Spend amount per bonus play must be at least $1.');
    }

    if (!Number.isInteger(settings.bonusPlaysPerThreshold) || settings.bonusPlaysPerThreshold < 0) {
        errors.push('Bonus plays per spend tier must be zero or more.');
    }

    return errors;
}

function validatePrize(form, allowSalonChoice) {
    const errors = [];
    const weight = Number(form.weight);
    const rewardValue = form.rewardValue === '' ? null : Number(form.rewardValue);

    if (allowSalonChoice && form.salonId && !Number.isInteger(Number(form.salonId))) {
        errors.push('Please choose a valid merchant for this prize.');
    }

    if (form.title.length < 2) {
        errors.push('Prize title must be at least 2 characters.');
    }

    if (!RewardsGame.PRIZE_TYPES.includes(form.prizeType)) {
        errors.push('Please choose a valid prize type.');
    }

    if (form.rewardValue !== '' && (!Number.isInteger(rewardValue) || rewardValue < 0)) {
        errors.push('Reward value must be a whole number.');
    }

    if (!Number.isInteger(weight) || weight < 1) {
        errors.push('Prize weight must be at least 1.');
    }

    if (!RewardsGame.PRIZE_STATUSES.includes(form.status)) {
        errors.push('Please choose a valid prize status.');
    }

    return errors;
}

function buildPrizePayload(form, createdBy, forcedSalonId = null) {
    return {
        salonId: forcedSalonId || form.salonId || null,
        title: form.title,
        description: form.description,
        prizeType: form.prizeType,
        rewardValue: form.rewardValue === '' ? null : Number(form.rewardValue),
        weight: Number(form.weight),
        status: form.status,
        createdBy
    };
}

function renderCustomerGame(req, res, options = {}) {
    return RewardsGame.refreshWallet(req.session.user.id, (walletError, wallet) => {
        if (walletError) {
            console.error(walletError);
            return res.status(500).render('error', {
                title: 'Rewards Game Error',
                message: 'Rewards game details could not be loaded.'
            });
        }

        return RewardsGame.getRecentPlays(req.session.user.id, (historyError, plays) => {
            if (historyError) {
                console.error(historyError);
            }

            const sessionResult = req.session.gameLastResult || null;
            const sessionError = req.session.gameError || null;
            req.session.gameLastResult = null;
            req.session.gameError = null;

            return res.render('rewards-game', {
                title: 'Rewards Game',
                wallet,
                plays: historyError ? [] : plays,
                result: options.result || sessionResult?.prize || null,
                gameScore: options.gameScore ?? sessionResult?.score ?? null,
                error: options.error || sessionError || null
            });
        });
    });
}

function showCustomerGame(req, res) {
    return renderCustomerGame(req, res);
}

function playCustomerGame(req, res) {
    return res.redirect('/rewards-game/flappy');
}

function showFlappyGame(req, res) {
    return RewardsGame.refreshWallet(req.session.user.id, (walletError, wallet) => {
        if (walletError) {
            console.error(walletError);
            return res.status(500).render('error', {
                title: 'Rewards Game Error',
                message: 'Rewards game details could not be loaded.'
            });
        }

        if (!wallet.settings.isEnabled) {
            req.session.gameError = 'The rewards game is not active right now.';
            return res.redirect('/rewards-game');
        }

        if (wallet.playBalance < 1) {
            req.session.gameError = 'No plays available. Unused weekly plays will continue to accumulate.';
            return res.redirect('/rewards-game');
        }

        return res.render('flappy-game', {
            title: 'Flappy Rewards',
            wallet,
            returnPath: '/rewards-game'
        });
    });
}

function finishFlappyGame(req, res) {
    const score = Math.max(0, Math.min(9999, Number.parseInt(req.body.score, 10) || 0));

    return RewardsGame.play(req.session.user.id, (error, result) => {
        if (error) {
            console.error(error);
            return res.status(500).json({
                ok: false,
                message: 'The game could not be recorded. Please try again.',
                redirectPath: '/rewards-game'
            });
        }

        if (result.disabled) {
            return res.json({
                ok: false,
                disabled: true,
                message: 'The rewards game is not active right now.',
                remainingPlays: result.wallet?.playBalance || 0,
                redirectPath: '/rewards-game'
            });
        }

        if (result.noPlays) {
            return res.json({
                ok: false,
                noPlays: true,
                message: 'No plays available. Unused weekly plays will continue to accumulate.',
                remainingPlays: 0,
                redirectPath: '/rewards-game'
            });
        }

        if (result.noPrizes) {
            return res.json({
                ok: false,
                noPrizes: true,
                message: 'No active prizes are available right now.',
                remainingPlays: result.wallet?.playBalance || 0,
                redirectPath: '/rewards-game'
            });
        }

        const remainingPlays = result.wallet?.playBalance || 0;
        req.session.gameLastResult = {
            prize: result.prize,
            score
        };

        return res.json({
            ok: true,
            score,
            prize: result.prize,
            remainingPlays,
            shouldRedirect: remainingPlays < 1,
            redirectPath: '/rewards-game'
        });
    });
}

function showAdminGame(req, res) {
    return RewardsGame.getSettings((settingsError, settings) => {
        if (settingsError) {
            console.error(settingsError);
            return res.status(500).render('error', {
                title: 'Rewards Game Error',
                message: 'Rewards game settings could not be loaded.'
            });
        }

        return RewardsGame.getPrizes((prizeError, prizes) => {
            if (prizeError) {
                console.error(prizeError);
                return res.status(500).render('error', {
                    title: 'Rewards Game Error',
                    message: 'Rewards game prizes could not be loaded.'
                });
            }

            const success = req.session.adminSuccess;
            const error = req.session.adminError;
            req.session.adminSuccess = null;
            req.session.adminError = null;

            return res.render('admin-rewards-game', {
                title: 'Rewards Game Control',
                settings,
                prizes,
                success,
                error
            });
        });
    });
}

function updateAdminSettings(req, res) {
    const settings = getSettingsForm(req.body);
    const errors = validateSettings(settings);

    if (errors.length > 0) {
        req.session.adminError = errors.join(' ');
        return res.redirect('/admin/rewards-game');
    }

    return RewardsGame.updateSettings(settings, (error) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'Rewards game settings could not be updated.';
        } else {
            req.session.adminSuccess = 'Rewards game settings updated.';
        }

        return res.redirect('/admin/rewards-game');
    });
}

function renderAdminPrizeForm(res, options) {
    return MerchantService.getSalons((salonError, salons) => {
        if (salonError) {
            console.error(salonError);
            return res.status(500).render('error', {
                title: 'Merchant Salons Error',
                message: 'Merchant salons could not be loaded.'
            });
        }

        return res.status(options.status || 200).render('game-prize-form', {
            title: options.title,
            actionPath: options.actionPath,
            cancelPath: '/admin/rewards-game',
            form: options.form,
            prize: options.prize || null,
            salons,
            allowSalonChoice: true,
            prizeTypes: RewardsGame.PRIZE_TYPES,
            statuses: RewardsGame.PRIZE_STATUSES,
            errors: options.errors || []
        });
    });
}

function showNewAdminPrize(req, res) {
    return renderAdminPrizeForm(res, {
        title: 'Add Game Prize',
        actionPath: '/admin/rewards-game/prizes',
        form: getPrizeForm()
    });
}

function createAdminPrize(req, res) {
    const form = getPrizeForm(req.body);
    const errors = validatePrize(form, true);

    if (errors.length > 0) {
        return renderAdminPrizeForm(res, {
            status: 400,
            title: 'Add Game Prize',
            actionPath: '/admin/rewards-game/prizes',
            form,
            errors
        });
    }

    return RewardsGame.createPrize(buildPrizePayload(form, req.session.user.id), (error) => {
        if (error) {
            console.error(error);
            return renderAdminPrizeForm(res, {
                status: 500,
                title: 'Add Game Prize',
                actionPath: '/admin/rewards-game/prizes',
                form,
                errors: ['Prize could not be created.']
            });
        }

        req.session.adminSuccess = 'Game prize created.';
        return res.redirect('/admin/rewards-game');
    });
}

function showEditAdminPrize(req, res) {
    return RewardsGame.findPrizeById(req.params.prizeId, (error, prize) => {
        if (error || !prize) {
            if (error) console.error(error);
            return res.status(404).render('error', {
                title: 'Prize Not Found',
                message: 'The selected game prize could not be found.'
            });
        }

        return renderAdminPrizeForm(res, {
            title: 'Edit Game Prize',
            actionPath: `/admin/rewards-game/prizes/${prize.id}`,
            prize,
            form: {
                salonId: prize.salonId ? String(prize.salonId) : '',
                title: prize.title,
                description: prize.description,
                prizeType: prize.prizeType,
                rewardValue: prize.rewardValue === null ? '' : String(prize.rewardValue),
                weight: String(prize.weight),
                status: prize.status
            }
        });
    });
}

function updateAdminPrize(req, res) {
    const form = getPrizeForm(req.body);
    const errors = validatePrize(form, true);

    if (errors.length > 0) {
        return renderAdminPrizeForm(res, {
            status: 400,
            title: 'Edit Game Prize',
            actionPath: `/admin/rewards-game/prizes/${req.params.prizeId}`,
            form,
            errors
        });
    }

    return RewardsGame.updatePrize(req.params.prizeId, buildPrizePayload(form, req.session.user.id), (error) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'Game prize could not be updated.';
        } else {
            req.session.adminSuccess = 'Game prize updated.';
        }

        return res.redirect('/admin/rewards-game');
    });
}

function deleteAdminPrize(req, res) {
    return RewardsGame.deletePrize(req.params.prizeId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'Game prize could not be deleted.';
        } else {
            req.session.adminSuccess = result.affectedRows > 0 ? 'Game prize deleted.' : null;
            req.session.adminError = result.affectedRows > 0 ? null : 'Game prize could not be deleted.';
        }

        return res.redirect('/admin/rewards-game');
    });
}

function showMerchantGame(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (merchantError, merchant) => {
        if (merchantError || !merchant) {
            if (merchantError) console.error(merchantError);
            return res.status(403).render('error', {
                title: 'Merchant Not Assigned',
                message: 'Your merchant account needs an admin-created salon before game prizes can be managed.'
            });
        }

        return RewardsGame.getPrizesByMerchantUserId(req.session.user.id, (prizeError, prizes) => {
            if (prizeError) {
                console.error(prizeError);
                return res.status(500).render('error', {
                    title: 'Merchant Game Error',
                    message: 'Merchant game prizes could not be loaded.'
                });
            }

            const success = req.session.merchantSuccess;
            const error = req.session.merchantError;
            req.session.merchantSuccess = null;
            req.session.merchantError = null;

            return res.render('merchant-rewards-game', {
                title: 'Merchant Game Rewards',
                merchant,
                prizes,
                success,
                error
            });
        });
    });
}

function renderMerchantPrizeForm(req, res, options) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (merchantError, merchant) => {
        if (merchantError || !merchant) {
            if (merchantError) console.error(merchantError);
            return res.status(403).render('error', {
                title: 'Merchant Not Assigned',
                message: 'Your merchant account needs an admin-created salon before game prizes can be managed.'
            });
        }

        return res.status(options.status || 200).render('game-prize-form', {
            title: options.title,
            actionPath: options.actionPath,
            cancelPath: '/merchant/rewards-game',
            form: options.form,
            prize: options.prize || null,
            merchant,
            salons: [],
            allowSalonChoice: false,
            prizeTypes: RewardsGame.PRIZE_TYPES.filter((type) => type !== 'glints'),
            statuses: RewardsGame.PRIZE_STATUSES,
            errors: options.errors || []
        });
    });
}

function showNewMerchantPrize(req, res) {
    return renderMerchantPrizeForm(req, res, {
        title: 'Add Game Reward',
        actionPath: '/merchant/rewards-game/prizes',
        form: getPrizeForm({ prizeType: 'voucher' })
    });
}

function createMerchantPrize(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (merchantError, merchant) => {
        if (merchantError || !merchant) {
            if (merchantError) console.error(merchantError);
            return res.status(403).render('error', {
                title: 'Merchant Not Assigned',
                message: 'Your merchant account needs an admin-created salon before game prizes can be managed.'
            });
        }

        const form = getPrizeForm(req.body);
        const errors = validatePrize(form, false);

        if (form.prizeType === 'glints') {
            errors.push('Merchants can contribute vouchers or benefits. Glints are controlled by admin.');
        }

        if (errors.length > 0) {
            return renderMerchantPrizeForm(req, res, {
                status: 400,
                title: 'Add Game Reward',
                actionPath: '/merchant/rewards-game/prizes',
                form,
                errors
            });
        }

        return RewardsGame.createPrize(buildPrizePayload(form, req.session.user.id, merchant.id), (error) => {
            if (error) {
                console.error(error);
                return renderMerchantPrizeForm(req, res, {
                    status: 500,
                    title: 'Add Game Reward',
                    actionPath: '/merchant/rewards-game/prizes',
                    form,
                    errors: ['Reward could not be created.']
                });
            }

            req.session.merchantSuccess = 'Game reward created.';
            return res.redirect('/merchant/rewards-game');
        });
    });
}

function showEditMerchantPrize(req, res) {
    return RewardsGame.findPrizeForMerchant(req.session.user.id, req.params.prizeId, (error, prize) => {
        if (error || !prize) {
            if (error) console.error(error);
            return res.status(404).render('error', {
                title: 'Prize Not Found',
                message: 'This game prize does not belong to your merchant account.'
            });
        }

        return renderMerchantPrizeForm(req, res, {
            title: 'Edit Game Reward',
            actionPath: `/merchant/rewards-game/prizes/${prize.id}`,
            prize,
            form: {
                title: prize.title,
                description: prize.description,
                prizeType: prize.prizeType,
                rewardValue: prize.rewardValue === null ? '' : String(prize.rewardValue),
                weight: String(prize.weight),
                status: prize.status
            }
        });
    });
}

function updateMerchantPrize(req, res) {
    const form = getPrizeForm(req.body);
    const errors = validatePrize(form, false);

    if (form.prizeType === 'glints') {
        errors.push('Merchants can contribute vouchers or benefits. Glints are controlled by admin.');
    }

    if (errors.length > 0) {
        return renderMerchantPrizeForm(req, res, {
            status: 400,
            title: 'Edit Game Reward',
            actionPath: `/merchant/rewards-game/prizes/${req.params.prizeId}`,
            form,
            errors
        });
    }

    return RewardsGame.updatePrizeForMerchant(req.session.user.id, req.params.prizeId, buildPrizePayload(form, req.session.user.id), (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Game reward could not be updated.';
        } else {
            req.session.merchantSuccess = result.affectedRows > 0 ? 'Game reward updated.' : null;
            req.session.merchantError = result.affectedRows > 0 ? null : 'Game reward could not be updated.';
        }

        return res.redirect('/merchant/rewards-game');
    });
}

function deleteMerchantPrize(req, res) {
    return RewardsGame.deletePrizeForMerchant(req.session.user.id, req.params.prizeId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Game reward could not be deleted.';
        } else {
            req.session.merchantSuccess = result.affectedRows > 0 ? 'Game reward deleted.' : null;
            req.session.merchantError = result.affectedRows > 0 ? null : 'Game reward could not be deleted.';
        }

        return res.redirect('/merchant/rewards-game');
    });
}

module.exports = {
    showCustomerGame,
    playCustomerGame,
    showFlappyGame,
    finishFlappyGame,
    showAdminGame,
    updateAdminSettings,
    showNewAdminPrize,
    createAdminPrize,
    showEditAdminPrize,
    updateAdminPrize,
    deleteAdminPrize,
    showMerchantGame,
    showNewMerchantPrize,
    createMerchantPrize,
    showEditMerchantPrize,
    updateMerchantPrize,
    deleteMerchantPrize
};
