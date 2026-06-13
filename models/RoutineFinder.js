const db = require('../db');
const MerchantService = require('./MerchantService');
const Product = require('./Product');
const Promotion = require('./Promotion');

const GOAL_KEYWORDS = {
    glow: ['glow', 'facial', 'hydrating', 'skin', 'bright', 'cleanse', 'serum', 'skincare'],
    relax: ['spa', 'massage', 'relax', 'aroma', 'body', 'wellness', 'calm', 'oil'],
    hair: ['hair', 'scalp', 'shampoo', 'colour', 'style', 'keratin', 'treatment'],
    nails: ['nail', 'manicure', 'pedicure', 'gel', 'polish', 'hand', 'foot'],
    grooming: ['barber', 'groom', 'haircut', 'beard', 'shave', 'fade'],
    event: ['makeup', 'style', 'facial', 'hair', 'glow', 'nail', 'event']
};

const CONCERN_KEYWORDS = {
    dry_skin: ['dry', 'hydrating', 'moisture', 'skin', 'facial', 'serum', 'lotion'],
    acne_pores: ['acne', 'pore', 'cleanse', 'deep', 'facial', 'foam', 'skin'],
    stress: ['stress', 'relax', 'massage', 'spa', 'aroma', 'wellness', 'body'],
    damaged_hair: ['damaged', 'repair', 'hair', 'scalp', 'keratin', 'mask', 'shampoo'],
    tired_body: ['body', 'massage', 'spa', 'scrub', 'oil', 'wellness'],
    maintenance: ['maintenance', 'aftercare', 'cleanser', 'serum', 'shampoo', 'lotion', 'set']
};

const PRODUCT_NEED_KEYWORDS = {
    skincare: ['skin', 'serum', 'cleanser', 'facial', 'pore', 'mask', 'toner'],
    haircare: ['hair', 'shampoo', 'conditioner', 'scalp', 'mask'],
    bodycare: ['body', 'oil', 'lotion', 'scrub', 'butter'],
    wellness: ['wellness', 'mist', 'aroma', 'fragrance', 'calm', 'spa'],
    makeup: ['makeup', 'lip', 'tint', 'colour'],
    nailcare: ['nail', 'polish', 'gel', 'manicure', 'pedicure']
};

const GOAL_LABELS = {
    glow: 'Healthy glow',
    relax: 'Relax and reset',
    hair: 'Hair refresh',
    nails: 'Nail care',
    grooming: 'Grooming',
    event: 'Event prep'
};

const CONCERN_LABELS = {
    dry_skin: 'Dry or dull skin',
    acne_pores: 'Pores or breakouts',
    stress: 'Stress or tension',
    damaged_hair: 'Damaged hair',
    tired_body: 'Tired body',
    maintenance: 'Aftercare maintenance'
};

const CATEGORY_LABELS = {
    facial: 'Facial',
    hair: 'Hair',
    spa: 'Spa',
    massage: 'Massage',
    nail: 'Nails',
    barber: 'Barber/Grooming'
};

const PRODUCT_NEED_LABELS = {
    skincare: 'Skincare',
    haircare: 'Haircare',
    bodycare: 'Bodycare',
    wellness: 'Wellness',
    makeup: 'Makeup',
    nailcare: 'Nailcare'
};

const BUDGET_LABELS = {
    'under-50': 'Under $50',
    '50-100': '$50 to $100',
    '100-150': '$100 to $150',
    '150-plus': '$150+'
};

const GENDER_LABELS = {
    female: 'Women',
    male: 'Men',
    unisex: 'Unisex'
};

function ensureSchema(callback) {
    const sql = `
        CREATE TABLE IF NOT EXISTS beauty_routine_attempts (
            attempt_id INT NOT NULL AUTO_INCREMENT,
            user_id INT DEFAULT NULL,
            goals_json JSON DEFAULT NULL,
            concerns_json JSON DEFAULT NULL,
            preferences_json JSON DEFAULT NULL,
            budget_min DECIMAL(10,2) DEFAULT NULL,
            budget_max DECIMAL(10,2) DEFAULT NULL,
            location_preference VARCHAR(255) DEFAULT NULL,
            recommended_service_ids JSON DEFAULT NULL,
            recommended_product_ids JSON DEFAULT NULL,
            recommended_salon_ids JSON DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (attempt_id),
            KEY idx_routine_attempt_user_created (user_id, created_at),
            CONSTRAINT fk_routine_attempt_user
                FOREIGN KEY (user_id) REFERENCES users (user_id)
                ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, callback);
}

function asArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    const normalized = String(value || '').trim();
    return normalized ? [normalized] : [];
}

function normalizeBudget(value) {
    switch (String(value || '').trim()) {
        case 'under-50':
            return { min: 0, max: 50 };
        case '50-100':
            return { min: 50, max: 100 };
        case '100-150':
            return { min: 100, max: 150 };
        case '150-plus':
            return { min: 150, max: null };
        default:
            return { min: null, max: null };
    }
}

function normalizeAnswers(raw = {}) {
    return {
        goals: asArray(raw.goals),
        concerns: asArray(raw.concerns),
        category: String(raw.category || '').trim().toLowerCase(),
        productNeed: String(raw.productNeed || '').trim().toLowerCase(),
        genderTarget: String(raw.genderTarget || '').trim().toLowerCase(),
        locationPreference: String(raw.locationPreference || '').trim(),
        budget: normalizeBudget(raw.budget),
        budgetKey: String(raw.budget || '').trim()
    };
}

function getTerms(answers) {
    const terms = new Set();

    answers.goals.forEach((goal) => {
        (GOAL_KEYWORDS[goal] || [goal]).forEach((term) => terms.add(term));
    });

    answers.concerns.forEach((concern) => {
        (CONCERN_KEYWORDS[concern] || [concern]).forEach((term) => terms.add(term));
    });

    if (answers.category) terms.add(answers.category);
    if (answers.productNeed) {
        (PRODUCT_NEED_KEYWORDS[answers.productNeed] || [answers.productNeed]).forEach((term) => terms.add(term));
    }

    return Array.from(terms).filter((term) => term.length > 1);
}

function includesAny(haystack, terms) {
    return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function getMatchedTerms(haystack, terms, limit = 4) {
    return terms
        .filter((term) => haystack.includes(term))
        .slice(0, limit);
}

function scoreBudget(price, budget) {
    const amount = Number(price || 0);

    if (!Number.isFinite(amount) || (!budget.min && !budget.max)) {
        return 0;
    }

    if (budget.min !== null && amount < budget.min) {
        return budget.min >= 150 ? -1 : 1;
    }

    if (budget.max !== null && amount > budget.max) {
        return -4;
    }

    return 5;
}

function countOverlap(left = [], right = []) {
    const rightSet = new Set(right);
    return left.reduce((count, item) => count + (rightSet.has(item) ? 1 : 0), 0);
}

function scoreRoutineBudget(item, answers) {
    const min = item.routineBudgetMin;
    const max = item.routineBudgetMax;

    if ((min === null || min === undefined) && (max === null || max === undefined)) {
        return 0;
    }

    const selectedMin = answers.budget.min;
    const selectedMax = answers.budget.max;

    if (selectedMax !== null && min !== null && Number(min) > selectedMax) return -2;
    if (selectedMin !== null && max !== null && Number(max) < selectedMin) return -1;
    return 4;
}

function scoreService(service, answers, terms) {
    const haystack = [
        service.name,
        service.description,
        service.category,
        service.salonName,
        service.salonAddress
    ].join(' ').toLowerCase();
    const location = answers.locationPreference.toLowerCase();
    let score = 0;

    score += includesAny(haystack, terms) * 4;
    score += scoreBudget(service.price, answers.budget);
    score += scoreRoutineBudget(service, answers);
    score += countOverlap(service.routineGoalTags || [], answers.goals) * 8;
    score += countOverlap(service.routineConcernTags || [], answers.concerns) * 8;

    if (answers.category && haystack.includes(answers.category)) score += 8;
    if (answers.genderTarget && (service.genderTarget === answers.genderTarget || service.genderTarget === 'unisex')) score += 4;
    if (location && haystack.includes(location)) score += 5;
    if (Array.isArray(service.slots) && service.slots.length > 0) score += 2;
    if (service.isFeatured) score += 2;
    if (service.merchantIsFeatured) score += 2;
    if (service.inventoryBlocked) score -= 5;

    return score;
}

function scoreProduct(product, answers, terms) {
    const haystack = [
        product.name,
        product.description,
        product.category,
        product.salonName,
        product.ingredients,
        product.howToUse
    ].join(' ').toLowerCase();
    let score = 0;

    score += includesAny(haystack, terms) * 4;
    score += scoreBudget(product.price, answers.budget);
    score += scoreRoutineBudget(product, answers);
    score += countOverlap(product.routineGoalTags || [], answers.goals) * 8;
    score += countOverlap(product.routineConcernTags || [], answers.concerns) * 8;

    if (answers.productNeed && haystack.includes(answers.productNeed.replace('care', ''))) score += 7;
    if (answers.category && haystack.includes(answers.category)) score += 3;
    if (product.isFeatured) score += 2;
    if (Number(product.stockQuantity || 0) <= 0) score -= 20;

    return score;
}

function formatDiscount(promotion) {
    if (!promotion) return '';

    if (promotion.discountType === 'percentage') {
        return `${Number(promotion.discountValue || 0).toFixed(0)}% off`;
    }

    if (promotion.discountType === 'fixed_amount') {
        return `$${Number(promotion.discountValue || 0).toFixed(0)} off`;
    }

    if (promotion.discountType === 'fixed_price') {
        return `$${Number(promotion.discountValue || 0).toFixed(0)} deal`;
    }

    return 'Special offer';
}

function buildPromotionMaps(promotions = []) {
    const byService = new Map();
    const bySalon = new Map();

    promotions.forEach((promotion) => {
        const salonId = Number(promotion.salonId || 0);
        const serviceId = Number(promotion.serviceId || 0);

        if (serviceId) {
            byService.set(serviceId, [...(byService.get(serviceId) || []), promotion]);
        }

        if (salonId) {
            bySalon.set(salonId, [...(bySalon.get(salonId) || []), promotion]);
        }
    });

    return { byService, bySalon };
}

function getRelatedPromotionsForService(service, maps) {
    const servicePromotions = maps.byService.get(Number(service.id || service.serviceId || 0)) || [];
    const salonPromotions = maps.bySalon.get(Number(service.salonId || service.merchantId || 0)) || [];
    const promotionMap = new Map();

    [...servicePromotions, ...salonPromotions].forEach((promotion) => {
        promotionMap.set(promotion.id || promotion.promotionId, promotion);
    });

    return Array.from(promotionMap.values()).slice(0, 3);
}

function buildServiceReasons(service, answers, terms, relatedPromotions = []) {
    const haystack = [
        service.name,
        service.description,
        service.category,
        service.salonName,
        service.salonAddress
    ].join(' ').toLowerCase();
    const reasons = [];
    const matchedTerms = getMatchedTerms(haystack, terms);
    const matchedGoals = (service.routineGoalTags || []).filter((tag) => answers.goals.includes(tag));
    const matchedConcerns = (service.routineConcernTags || []).filter((tag) => answers.concerns.includes(tag));

    if (matchedGoals.length) {
        reasons.push('Tagged by merchant for your goal');
    }

    if (matchedConcerns.length) {
        reasons.push('Tagged by merchant for your concern');
    }

    if (service.routineRecommendationNote) {
        reasons.push(service.routineRecommendationNote);
    }

    if (answers.category && haystack.includes(answers.category)) {
        reasons.push(`Matches your ${CATEGORY_LABELS[answers.category] || answers.category} service preference`);
    }

    if (matchedTerms.length) {
        const firstTerm = matchedTerms[0];
        reasons.push(`Matches ${firstTerm.replace(/_/g, ' ')} in your routine goals`);
    }

    if (scoreBudget(service.price, answers.budget) > 0) {
        reasons.push('Within your selected budget');
    }

    if (answers.locationPreference && haystack.includes(answers.locationPreference.toLowerCase())) {
        reasons.push(`Close to ${answers.locationPreference}`);
    }

    if (answers.genderTarget && (service.genderTarget === answers.genderTarget || service.genderTarget === 'unisex')) {
        reasons.push(`Fits your ${GENDER_LABELS[answers.genderTarget] || answers.genderTarget} preference`);
    }

    if (Array.isArray(service.slots) && service.slots.length > 0) {
        reasons.push('Has available booking slots');
    }

    if (relatedPromotions.length) {
        reasons.push(`Includes ${formatDiscount(relatedPromotions[0])}`);
    }

    if (service.isFeatured || service.merchantIsFeatured) {
        reasons.push('Featured by Vaniday');
    }

    return reasons.slice(0, 4);
}

function buildProductReasons(product, answers, terms) {
    const haystack = [
        product.name,
        product.description,
        product.category,
        product.salonName,
        product.ingredients,
        product.howToUse
    ].join(' ').toLowerCase();
    const reasons = [];
    const matchedTerms = getMatchedTerms(haystack, terms);
    const matchedGoals = (product.routineGoalTags || []).filter((tag) => answers.goals.includes(tag));
    const matchedConcerns = (product.routineConcernTags || []).filter((tag) => answers.concerns.includes(tag));

    if (matchedGoals.length) {
        reasons.push('Tagged by merchant for your goal');
    }

    if (matchedConcerns.length) {
        reasons.push('Tagged by merchant for your concern');
    }

    if (product.routineRecommendationNote) {
        reasons.push(product.routineRecommendationNote);
    }

    if (answers.productNeed && haystack.includes(answers.productNeed.replace('care', ''))) {
        reasons.push(`Supports your ${PRODUCT_NEED_LABELS[answers.productNeed] || answers.productNeed} need`);
    }

    if (matchedTerms.length) {
        reasons.push(`Matches ${matchedTerms[0].replace(/_/g, ' ')} in your preferences`);
    }

    if (scoreBudget(product.price, answers.budget) > 0) {
        reasons.push('Within your selected budget');
    }

    if (Number(product.stockQuantity || 0) > 0) {
        reasons.push('Available in stock');
    }

    if (product.isFeatured) {
        reasons.push('Featured product');
    }

    return reasons.slice(0, 4);
}

function toMatchPercent(score, maxScore) {
    if (!Number.isFinite(score) || score <= 0) return 55;
    if (!Number.isFinite(maxScore) || maxScore <= 0) return Math.min(98, 60 + Math.round(score * 2));
    return Math.max(58, Math.min(98, Math.round((score / maxScore) * 100)));
}

function buildMerchantsFromServices(services) {
    const merchantMap = new Map();

    services.forEach((entry) => {
        const service = entry.item;
        const merchantId = Number(service.salonId || service.merchantId || 0);

        if (!merchantId) return;

        const current = merchantMap.get(merchantId) || {
            id: merchantId,
            name: service.salonName || 'Vaniday merchant',
            location: service.salonAddress || 'Singapore',
            category: service.category || 'Beauty & Wellness',
            score: 0,
            matchScore: 0,
            matchedServices: [],
            matchReasons: []
        };

        current.score += entry.score;
        current.matchedServices.push(service);
        current.matchReasons = Array.from(new Set([
            ...current.matchReasons,
            ...(service.matchReasons || []).slice(0, 2)
        ])).slice(0, 4);
        merchantMap.set(merchantId, current);
    });

    const merchants = Array.from(merchantMap.values())
        .sort((left, right) => right.score - left.score);
    const maxScore = Math.max(...merchants.map((merchant) => merchant.score), 1);

    return merchants
        .slice(0, 6)
        .map((merchant) => ({
            ...merchant,
            matchScore: toMatchPercent(merchant.score, maxScore)
        }));
}

function buildSummary(answers) {
    return {
        goals: answers.goals.map((goal) => GOAL_LABELS[goal] || goal),
        concerns: answers.concerns.map((concern) => CONCERN_LABELS[concern] || concern),
        category: CATEGORY_LABELS[answers.category] || 'Any service type',
        productNeed: PRODUCT_NEED_LABELS[answers.productNeed] || 'No product preference',
        budget: BUDGET_LABELS[answers.budgetKey] || 'Any budget',
        genderTarget: GENDER_LABELS[answers.genderTarget] || 'Any',
        locationPreference: answers.locationPreference || 'Anywhere'
    };
}

function filterRelatedPromotions(promotions, results, terms, answers) {
    const serviceIds = new Set(results.services.map((service) => Number(service.id || service.serviceId || 0)));
    const salonIds = new Set([
        ...results.services.map((service) => Number(service.salonId || service.merchantId || 0)),
        ...results.merchants.map((merchant) => Number(merchant.id || 0))
    ]);
    const location = answers.locationPreference.toLowerCase();

    return (promotions || [])
        .map((promotion) => {
            const haystack = [
                promotion.title,
                promotion.description,
                promotion.type,
                promotion.salonName,
                promotion.address,
                promotion.serviceName
            ].join(' ').toLowerCase();
            let score = 0;

            if (serviceIds.has(Number(promotion.serviceId || 0))) score += 12;
            if (salonIds.has(Number(promotion.salonId || 0))) score += 8;
            score += includesAny(haystack, terms) * 3;
            if (location && haystack.includes(location)) score += 4;

            return {
                ...promotion,
                score,
                discountLabel: formatDiscount(promotion)
            };
        })
        .filter((promotion) => promotion.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6);
}

function saveAttempt(userId, answers, results, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO beauty_routine_attempts (
                user_id,
                goals_json,
                concerns_json,
                preferences_json,
                budget_min,
                budget_max,
                location_preference,
                recommended_service_ids,
                recommended_product_ids,
                recommended_salon_ids
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            userId || null,
            JSON.stringify(answers.goals),
            JSON.stringify(answers.concerns),
            JSON.stringify({
                category: answers.category,
                productNeed: answers.productNeed,
                genderTarget: answers.genderTarget
            }),
            answers.budget.min,
            answers.budget.max,
            answers.locationPreference || null,
            JSON.stringify(results.services.map((service) => service.id)),
            JSON.stringify(results.products.map((product) => product.id)),
            JSON.stringify(results.merchants.map((merchant) => merchant.id))
        ], callback);
    });
}

function getRecommendations(rawAnswers, userId, callback) {
    const answers = normalizeAnswers(rawAnswers);
    const terms = getTerms(answers);

    MerchantService.getAllServices((serviceError, services = []) => {
        if (serviceError) {
            callback(serviceError);
            return;
        }

        Product.getAll((productError, products = []) => {
            if (productError) {
                callback(productError);
                return;
            }

            Promotion.getActivePublic((promotionError, promotions = []) => {
                if (promotionError) {
                    callback(promotionError);
                    return;
                }

                const promotionMaps = buildPromotionMaps(promotions);
                const scoredServices = services
                    .map((service) => {
                        const relatedPromotions = getRelatedPromotionsForService(service, promotionMaps);
                        const promotionBoost = relatedPromotions.length ? 4 : 0;
                        return {
                            item: service,
                            score: scoreService(service, answers, terms) + promotionBoost,
                            relatedPromotions
                        };
                    })
                    .filter((entry) => entry.score > 0)
                    .sort((left, right) => right.score - left.score);

                const scoredProducts = products
                    .map((product) => ({ item: product, score: scoreProduct(product, answers, terms) }))
                    .filter((entry) => entry.score > 0 && Number(entry.item.stockQuantity || 0) > 0)
                    .sort((left, right) => right.score - left.score);

                const fallbackServices = scoredServices.length > 0
                    ? scoredServices
                    : services
                        .map((service) => ({
                            item: service,
                            score: Number(service.merchantFeaturedScore || 0) || (service.isFeatured ? 2 : 1),
                            relatedPromotions: getRelatedPromotionsForService(service, promotionMaps)
                        }))
                        .sort((left, right) => right.score - left.score);

                const fallbackProducts = scoredProducts.length > 0
                    ? scoredProducts
                    : products
                        .filter((product) => Number(product.stockQuantity || 0) > 0)
                        .map((product) => ({ item: product, score: product.isFeatured ? 2 : 1 }))
                        .sort((left, right) => right.score - left.score);

                const maxServiceScore = Math.max(...fallbackServices.map((entry) => entry.score), 1);
                const maxProductScore = Math.max(...fallbackProducts.map((entry) => entry.score), 1);
                const resultServices = fallbackServices.slice(0, 8).map((entry) => ({
                    ...entry.item,
                    matchScore: toMatchPercent(entry.score, maxServiceScore),
                    matchReasons: buildServiceReasons(entry.item, answers, terms, entry.relatedPromotions),
                    relatedPromotions: entry.relatedPromotions.map((promotion) => ({
                        ...promotion,
                        discountLabel: formatDiscount(promotion)
                    }))
                }));
                const resultProducts = fallbackProducts.slice(0, 8).map((entry) => ({
                    ...entry.item,
                    matchScore: toMatchPercent(entry.score, maxProductScore),
                    matchReasons: buildProductReasons(entry.item, answers, terms)
                }));

                const results = {
                    answers,
                    summary: buildSummary(answers),
                    terms,
                    services: resultServices,
                    products: resultProducts,
                    merchants: buildMerchantsFromServices(resultServices.map((service) => ({ item: service, score: service.matchScore || 1 }))),
                    promotions: []
                };
                results.promotions = filterRelatedPromotions(promotions, results, terms, answers);

                saveAttempt(userId, answers, results, (saveError) => {
                    if (saveError) {
                        callback(saveError);
                        return;
                    }

                    callback(null, results);
                });
            });
        });
    });
}

module.exports = {
    ensureSchema,
    getRecommendations,
    normalizeAnswers
};
