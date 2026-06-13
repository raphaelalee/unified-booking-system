const SpinDiscover = require('../models/SpinDiscover');

function wantsJson(req) {
    return req.xhr
        || (req.get('accept') || '').includes('application/json')
        || req.get('content-type') === 'application/json';
}

function renderSpinPage(req, res, options = {}) {
    const userId = req.session.user?.role === 'customer' ? req.session.user.id : null;

    return SpinDiscover.getPageData(userId, (error, pageData = {}) => {
        if (error) {
            console.error('Spin & Discover page error:', error);
            return res.status(500).render('error', {
                title: 'Spin & Discover Error',
                message: 'Spin & Discover could not be loaded.'
            });
        }

        const sessionResult = req.session.spinDiscoverResult || null;
        const sessionError = req.session.spinDiscoverError || null;
        req.session.spinDiscoverResult = null;
        req.session.spinDiscoverError = null;

        return res.render('spin-discover', {
            title: 'Spin & Discover',
            rewards: pageData.rewards || [],
            tokenSummary: pageData.tokenSummary || { available: 0, used: 0, expired: 0, tokens: [] },
            history: pageData.history || [],
            settings: pageData.settings || { isEnabled: true },
            result: options.result || sessionResult,
            error: options.error || sessionError,
            showChatbot: true
        });
    });
}

function showSpinDiscover(req, res) {
    return renderSpinPage(req, res);
}

function spin(req, res) {
    return SpinDiscover.spin(req.session.user.id, (error, result) => {
        if (error) {
            console.error('Spin & Discover spin error:', error);
            if (wantsJson(req)) {
                return res.status(500).json({
                    ok: false,
                    message: 'Your spin could not be completed. Please try again.'
                });
            }

            req.session.spinDiscoverError = 'Your spin could not be completed. Please try again.';
            return res.redirect('/spin-discover');
        }

        if (!result.ok) {
            if (wantsJson(req)) {
                return res.status(409).json(result);
            }

            req.session.spinDiscoverError = result.message || 'You do not have a spin chance available.';
            return res.redirect('/spin-discover');
        }

        if (wantsJson(req)) {
            return SpinDiscover.getPageData(req.session.user.id, (pageError, pageData = {}) => {
                if (pageError) {
                    console.error('Spin & Discover refresh error:', pageError);
                }

                return res.json({
                    ok: true,
                    reward: result.reward,
                    tokenSummary: pageData.tokenSummary || null,
                    history: pageData.history || []
                });
            });
        }

        req.session.spinDiscoverResult = result.reward;
        return res.redirect('/spin-discover#spin-result');
    });
}

module.exports = {
    showSpinDiscover,
    spin
};
