const RoutineFinder = require('../models/RoutineFinder');

const quizOptions = {
    goals: [
        { value: 'glow', label: 'Healthy glow' },
        { value: 'relax', label: 'Relax and reset' },
        { value: 'hair', label: 'Hair refresh' },
        { value: 'nails', label: 'Nail care' },
        { value: 'grooming', label: 'Grooming' },
        { value: 'event', label: 'Event prep' }
    ],
    concerns: [
        { value: 'dry_skin', label: 'Dry or dull skin' },
        { value: 'acne_pores', label: 'Pores or breakouts' },
        { value: 'stress', label: 'Stress or tension' },
        { value: 'damaged_hair', label: 'Damaged hair' },
        { value: 'tired_body', label: 'Tired body' },
        { value: 'maintenance', label: 'Aftercare maintenance' }
    ],
    categories: [
        { value: '', label: 'Any service type' },
        { value: 'facial', label: 'Facial' },
        { value: 'hair', label: 'Hair' },
        { value: 'spa', label: 'Spa' },
        { value: 'massage', label: 'Massage' },
        { value: 'nail', label: 'Nails' },
        { value: 'barber', label: 'Barber/Grooming' }
    ],
    productNeeds: [
        { value: '', label: 'No product preference' },
        { value: 'skincare', label: 'Skincare' },
        { value: 'haircare', label: 'Haircare' },
        { value: 'bodycare', label: 'Bodycare' },
        { value: 'wellness', label: 'Wellness' },
        { value: 'makeup', label: 'Makeup' },
        { value: 'nailcare', label: 'Nailcare' }
    ],
    budgets: [
        { value: '', label: 'Any budget' },
        { value: 'under-50', label: 'Under $50' },
        { value: '50-100', label: '$50 to $100' },
        { value: '100-150', label: '$100 to $150' },
        { value: '150-plus', label: '$150+' }
    ],
    genderTargets: [
        { value: '', label: 'Any' },
        { value: 'female', label: 'Women' },
        { value: 'male', label: 'Men' },
        { value: 'unisex', label: 'Unisex' }
    ]
};

function renderFinder(req, res, options = {}) {
    return res.render('routine-finder', {
        title: 'Beauty Routine Finder',
        options: quizOptions,
        form: options.form || {},
        results: options.results || null,
        error: options.error || null,
        success: options.success || null,
        showChatbot: true
    });
}

function showFinder(req, res) {
    return renderFinder(req, res);
}

function showResults(req, res) {
    const hasGoal = Array.isArray(req.body.goals)
        ? req.body.goals.length > 0
        : Boolean(req.body.goals);
    const hasConcern = Array.isArray(req.body.concerns)
        ? req.body.concerns.length > 0
        : Boolean(req.body.concerns);

    if (!hasGoal && !hasConcern && !req.body.category && !req.body.productNeed && !req.body.locationPreference) {
        return renderFinder(req, res, {
            form: req.body,
            error: 'Choose at least one goal, concern, category, product need, or location preference.'
        });
    }

    return RoutineFinder.getRecommendations(req.body, req.session.user?.id || null, (error, results) => {
        if (error) {
            console.error('Routine Finder error:', error);
            return renderFinder(req, res, {
                form: req.body,
                error: 'Routine recommendations could not be loaded. Please try again.'
            });
        }

        return renderFinder(req, res, {
            form: req.body,
            results
        });
    });
}

function continueBooking(req, res) {
    const merchantId = encodeURIComponent(req.params.merchantId || '');
    const serviceId = req.query.serviceId ? encodeURIComponent(req.query.serviceId) : '';
    const query = serviceId ? `?serviceId=${serviceId}` : '';

    return res.redirect(`/booking/${merchantId}${query}`);
}

function saveRoutine(req, res) {
    return RoutineFinder.getRecommendations(req.body, req.session.user.id, (error, results) => {
        if (error) {
            console.error('Routine Finder save error:', error);
            return renderFinder(req, res, {
                form: req.body,
                error: 'Your routine could not be saved. Please try again.'
            });
        }

        return renderFinder(req, res, {
            form: req.body,
            results,
            success: 'Your routine has been saved to your customer history.'
        });
    });
}

module.exports = {
    showFinder,
    showResults,
    continueBooking,
    saveRoutine
};
