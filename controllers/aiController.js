const Groq = require('groq-sdk');
require('dotenv').config();
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Product = require('../models/Product');
const Review = require('../models/Review');
const bookingController = require('./bookingController');
const {
    cleanText,
    generateServiceSetupSuggestions
} = require('../services/serviceSetupAiAssistant');
const {
    classifyGroqError,
    generatePromotionRecommendations: generatePromotionRecommendationsFromGroq,
    generateReviewReply: generateReviewReplyFromGroq,
    generateVoucherRecommendations: generateVoucherRecommendationsFromGroq,
    moderateReviewImage: moderateReviewImageWithGroq,
    moderateReviewText: moderateReviewTextWithGroq,
    recommendFeaturedMerchants: recommendFeaturedMerchantsWithGroq,
    recommendFeaturedProducts: recommendFeaturedProductsWithGroq,
    recommendFeaturedServices: recommendFeaturedServicesWithGroq
} = require('../services/groqService');

// Shared Groq client for chatbot and product helper endpoints.
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

function normalizeTime(value) {
    const raw = String(value || '').trim().toLowerCase();
    const meridiemMatch = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    const timeMatch = raw.match(/\b(\d{1,2}):(\d{2})\b/);
    const match = meridiemMatch || timeMatch;

    if (!match) {
        return '';
    }

    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const meridiem = match[3];

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return '';
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function extractDate(value) {
    const match = String(value || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    return match ? match[1] : '';
}

function extractBookingId(value) {
    const match = String(value || '').match(/(?:booking\s*#?|#)\s*(\d+)/i)
        || String(value || '').match(/\b(\d{1,8})\b/);
    return match ? Number(match[1]) : 0;
}

function stripKnownTokens(value) {
    return String(value || '')
        .replace(/\b(20\d{2}-\d{2}-\d{2})\b/g, ' ')
        .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
        .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
        .replace(/\b(book|booking|make|schedule|appointment|for|at|on|please|hi|hello|i|want|to|a|an|the)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractGuestDetails(value) {
    const raw = String(value || '');
    const emailMatch = raw.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    const phoneMatch = raw.replace(/^\+65/, '').match(/\b[689]\d{7}\b/);
    const nameMatch = raw.match(/\b(?:name is|name:|i am|i'm)\s+([A-Za-z][A-Za-z\s'-]{1,60})(?=\s+(?:email|phone|on|at|for)\b|$)/i);

    return {
        customerName: nameMatch ? nameMatch[1].trim() : '',
        email: emailMatch ? emailMatch[0].trim() : '',
        phone: phoneMatch ? phoneMatch[0].trim() : ''
    };
}

function sendThroughHandler(handler, req, params = {}, body = {}) {
    return new Promise((resolve) => {
        const previousParams = req.params;
        const previousBody = req.body;

        req.params = { ...previousParams, ...params };
        req.body = { ...previousBody, ...body, responseType: 'json' };

        const fakeRes = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                req.params = previousParams;
                req.body = previousBody;
                resolve({ statusCode: this.statusCode, payload });
            },
            redirect(path) {
                req.params = previousParams;
                req.body = previousBody;
                resolve({
                    statusCode: this.statusCode >= 400 ? this.statusCode : 400,
                    payload: {
                        success: false,
                        message: req.session.profileError || 'The booking action could not be completed.',
                        redirectUrl: path
                    }
                });
            },
            render(view, payload) {
                req.params = previousParams;
                req.body = previousBody;
                resolve({
                    statusCode: this.statusCode,
                    payload: {
                        success: true,
                        message: payload?.title || 'Booking action completed.',
                        view,
                        booking: payload?.booking || null
                    }
                });
            }
        };

        handler(req, fakeRes);
    });
}

function getAllServices() {
    return new Promise((resolve, reject) => {
        MerchantService.getAllServices((error, services = []) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(services);
        });
    });
}

function getUpcomingBookings(userId) {
    return new Promise((resolve, reject) => {
        Booking.getUpcomingByUserId(userId, (error, bookings = []) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(bookings);
        });
    });
}

function scoreService(service, query) {
    const haystack = `${service.name || ''} ${service.category || ''} ${service.salonName || ''}`.toLowerCase();
    const terms = String(query || '').toLowerCase().split(/\s+/).filter((term) => term.length > 1);
    return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function buildGuestDetailPrompt(guestDetails) {
    const missing = [];

    if (!guestDetails.customerName) {
        missing.push('your full name');
    }
    if (!guestDetails.email) {
        missing.push('your email address');
    }
    if (!guestDetails.phone) {
        missing.push('your Singapore phone number');
    }

    if (!missing.length) {
        return '';
    }

    return `To complete the booking, I need ${missing.join(' and ')}. Please reply with your name, email, and phone number.`;
}

async function handleBookingCreate(req, prompt) {
    const serviceIdMatch = prompt.match(/\bservice\s*#?\s*(\d+)\b/i);
    const bookingDate = extractDate(prompt);
    const bookingTime = normalizeTime(prompt);
    const query = stripKnownTokens(prompt);
    const services = await getAllServices();
    const matches = serviceIdMatch
        ? services.filter((service) => Number(service.id) === Number(serviceIdMatch[1]))
        : services
            .map((service) => ({ service, score: scoreService(service, query) }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)
            .map((entry) => entry.service);

    if (!matches.length) {
        return {
            success: true,
            answer: 'Which service would you like to book? You can say something like "book facial on 2026-06-15 at 14:00".',
            suggestions: services.slice(0, 6).map((service) => ({
                id: service.id,
                name: service.name,
                merchantName: service.salonName,
                price: service.price
            }))
        };
    }

    if (matches.length > 1 && !serviceIdMatch) {
        return {
            success: true,
            answer: 'I found a few matching services. Reply with "book service 12 on YYYY-MM-DD at HH:mm".',
            suggestions: matches.slice(0, 6).map((service) => ({
                id: service.id,
                name: service.name,
                merchantName: service.salonName,
                price: service.price
            }))
        };
    }

    if (!bookingDate || !bookingTime) {
        return {
            success: true,
            answer: `I can book ${matches[0].name} at ${matches[0].salonName}. Please include a date and time, for example "book service ${matches[0].id} on 2026-06-15 at 14:00".`,
            selectedService: {
                id: matches[0].id,
                name: matches[0].name,
                merchantName: matches[0].salonName
            }
        };
    }

    const guestDetails = req.session.user ? {} : extractGuestDetails(prompt);

    if (!req.session.user) {
        const missingGuestPrompt = buildGuestDetailPrompt(guestDetails);

        if (missingGuestPrompt) {
            return {
                success: false,
                answer: missingGuestPrompt,
                missingDetails: {
                    name: !guestDetails.customerName,
                    email: !guestDetails.email,
                    phone: !guestDetails.phone
                },
                pendingBooking: {
                    command: `book service ${matches[0].id} on ${bookingDate} at ${bookingTime}`,
                    serviceId: matches[0].id,
                    bookingDate,
                    bookingTime
                }
            };
        }
    }

    const result = await sendThroughHandler(bookingController.createBooking, req, { serviceId: matches[0].id }, {
        serviceId: matches[0].id,
        bookingDate,
        bookingTime,
        ...guestDetails
    });

    return {
        ...result.payload,
        answer: result.payload.success
            ? `${result.payload.message} Booking #${result.payload.booking?.id}. Receipt: ${result.payload.booking?.receiptPath || `/receipt/${result.payload.booking?.id}`}`
            : result.payload.message
    };
}

async function handleReschedule(req, prompt) {
    if (!req.session.user) {
        return {
            success: false,
            message: 'Please log in as a customer before rescheduling through the chatbot.'
        };
    }

    const bookingId = extractBookingId(prompt);
    const bookingDate = extractDate(prompt);
    const bookingTime = normalizeTime(prompt);

    if (!bookingId || !bookingDate || !bookingTime) {
        const bookings = await getUpcomingBookings(req.session.user.id);
        return {
            success: true,
            answer: 'Tell me the booking number, new date, and new time. Example: "reschedule booking 15 to 2026-06-18 at 15:00".',
            bookings: bookings.slice(0, 6).map((booking) => ({
                id: booking.id,
                serviceName: booking.service_name,
                merchantName: booking.merchant_name,
                bookingDate: String(booking.booking_date).slice(0, 10),
                bookingTime: booking.booking_time
            }))
        };
    }

    const result = await sendThroughHandler(bookingController.rescheduleBooking, req, { bookingId }, {
        bookingDate,
        bookingTime
    });

    return {
        ...result.payload,
        answer: result.payload.message
    };
}

async function handleCancellation(req, prompt) {
    if (!req.session.user) {
        return {
            success: false,
            message: 'Please log in as a customer before cancelling through the chatbot.'
        };
    }

    const bookingId = extractBookingId(prompt);
    const reasonMatch = prompt.match(/\b(?:because|reason is|reason:)\s+(.+)$/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : 'Cancelled through chatbot';

    if (!bookingId) {
        const bookings = await getUpcomingBookings(req.session.user.id);
        return {
            success: true,
            answer: 'Which booking should I cancel? Reply with "cancel booking 15 because I cannot make it".',
            bookings: bookings.slice(0, 6).map((booking) => ({
                id: booking.id,
                serviceName: booking.service_name,
                merchantName: booking.merchant_name,
                bookingDate: String(booking.booking_date).slice(0, 10),
                bookingTime: booking.booking_time
            }))
        };
    }

    const result = await sendThroughHandler(bookingController.cancelBooking, req, { bookingId }, {
        reason
    });

    return {
        ...result.payload,
        answer: result.payload.message
    };
}

function getAssistantIntent(prompt) {
    const normalized = String(prompt || '').toLowerCase();

    if (/\b(cancel|cancelled|cancellation)\b/.test(normalized)) return 'cancel';
    if (/\b(reschedule|reshedul|change|move)\b/.test(normalized)) return 'reschedule';
    if (/\b(book|booking|appointment|schedule)\b/.test(normalized)) return 'book';
    return 'advice';
}

function addDaysToDateKey(dateKey, dayOffset) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return '';
    }

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(dayOffset || 0)));
    return date.toISOString().slice(0, 10);
}

function buildGuidedDates(limit = 14) {
    const todayKey = Booking.getSingaporeTodayKey();

    return Array.from({ length: limit }, (_, index) => {
        const dateKey = addDaysToDateKey(todayKey, index);
        const label = new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-SG', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });

        return {
            dateKey,
            label
        };
    });
}

exports.getGuidedBookingOptions = async (req, res) => {
    try {
        const services = await getAllServices();
        const merchantMap = new Map();

        services.forEach((service) => {
            const merchantId = String(service.salonId || '');

            if (!merchantId) {
                return;
            }

            if (!merchantMap.has(merchantId)) {
                merchantMap.set(merchantId, {
                    id: Number(service.salonId),
                    name: service.salonName || 'Vaniday merchant',
                    services: []
                });
            }

            merchantMap.get(merchantId).services.push({
                id: service.id,
                name: service.name,
                category: service.category || '',
                duration: service.duration,
                durationMins: service.durationMins,
                price: service.price
            });
        });

        return res.json({
            success: true,
            dates: buildGuidedDates(14),
            merchants: Array.from(merchantMap.values()).sort((left, right) => left.name.localeCompare(right.name))
        });
    } catch (error) {
        console.error('Guided booking options error:', error);
        return res.status(500).json({
            success: false,
            message: 'Booking options could not be loaded.'
        });
    }
};

exports.getGuidedBookingSlots = (req, res) => {
    const merchantId = Number(req.query.merchantId);
    const serviceId = Number(req.query.serviceId);
    const bookingDate = String(req.query.bookingDate || '').trim();

    if (!merchantId || !serviceId || !bookingDate) {
        return res.status(400).json({
            success: false,
            message: 'Choose a merchant, service, and date first.',
            slots: []
        });
    }

    return Booking.getAvailableSlots(merchantId, serviceId, bookingDate, {}, (error, slots = [], meta = {}) => {
        if (error) {
            console.error('Guided booking slots error:', error);
            return res.status(500).json({
                success: false,
                message: 'Available times could not be loaded.',
                slots: []
            });
        }

        return res.json({
            success: true,
            slots,
            meta,
            message: slots.length ? '' : 'No available times for this date.'
        });
    });
};

exports.getGuidedCustomerBookings = async (req, res) => {
    try {
        const userId = req.session.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Please log in as a customer to manage bookings.'
            });
        }

        const bookings = await getUpcomingBookings(userId);

        return res.json({
            success: true,
            dates: buildGuidedDates(14),
            bookings: bookings.slice(0, 12).map((booking) => ({
                id: booking.id,
                serviceName: booking.service_name,
                merchantName: booking.merchant_name,
                bookingDate: String(booking.booking_date).slice(0, 10),
                bookingTime: booking.booking_time,
                status: booking.status
            }))
        });
    } catch (error) {
        console.error('Guided customer bookings error:', error);
        return res.status(500).json({
            success: false,
            message: 'Your bookings could not be loaded.'
        });
    }
};

exports.getBeautyAdvice = async (req, res) => {
    try {
        const { userQuery, message } = req.body;
        const prompt = String(userQuery || message || '').trim();

        if (!prompt) {
            return res.status(400).json({
                success: false,
                message: "Please enter a question."
            });
        }

        const intent = getAssistantIntent(prompt);

        if (intent === 'book') {
            const result = await handleBookingCreate(req, prompt);
            return res.status(result.success === false ? 400 : 200).json(result);
        }

        if (intent === 'reschedule') {
            const result = await handleReschedule(req, prompt);
            return res.status(result.success === false ? 400 : 200).json(result);
        }

        if (intent === 'cancel') {
            const result = await handleCancellation(req, prompt);
            return res.status(result.success === false ? 400 : 200).json(result);
        }

        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({
                success: false,
                message: "AI is not configured yet."
            });
        }

        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "You are a professional Beauty & Wellness consultant for Vaniday Singapore. Suggest relevant services, products, and booking options from categories such as hair, nails, facial, massage, spa, gym, skincare, and wellness. Keep answers friendly, practical, and concise. Do not give medical diagnosis." 
                },
                { role: "user", content: prompt }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            max_completion_tokens: 350
        });

        const aiResponse = completion.choices?.[0]?.message?.content || "Sorry, I could not generate an answer just now.";
        res.json({ success: true, answer: aiResponse });

    } catch (error) {
        console.error("Groq API Error:", error);
        res.status(500).json({ success: false, message: "AI is currently resting!" });
    }
};

exports.generateProductCopy = async (req, res) => {
    try {
        const productName = String(req.body.productName || '').trim();

        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({
                success: false,
                message: "AI is not configured yet."
            });
        }

        if (productName.length < 2) {
            return res.status(400).json({
                success: false,
                message: "Enter a product name first."
            });
        }

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: [
                        "You write concise beauty product copy for Vaniday merchants.",
                        "Return only valid JSON with these string keys: description, ingredients, howToUse.",
                        "Do not make medical claims. Keep ingredients plausible and non-prescription."
                    ].join(" ")
                },
                {
                    role: "user",
                    content: `Product name: ${productName}`
                }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.6,
            max_completion_tokens: 260,
            response_format: { type: "json_object" }
        });

        const raw = completion.choices?.[0]?.message?.content || '{}';
        const generated = JSON.parse(raw);

        return res.json({
            success: true,
            description: String(generated.description || '').trim(),
            ingredients: String(generated.ingredients || '').trim(),
            howToUse: String(generated.howToUse || generated.how_to_use || '').trim()
        });
    } catch (error) {
        console.error("Product AI generation error:", error);
        return res.status(500).json({
            success: false,
            message: "AI could not generate product details right now."
        });
    }
};

function getMerchantProfile(userId) {
    return new Promise((resolve, reject) => {
        MerchantService.getMerchantByUserId(userId, (error, merchant) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(merchant || null);
        });
    });
}

function getServiceCategories() {
    return new Promise((resolve, reject) => {
        MerchantService.getCategories((error, categories = []) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(categories || []);
        });
    });
}

function getMerchantProducts(userId) {
    return new Promise((resolve, reject) => {
        Product.getByMerchantUserId(userId, (error, products = []) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(products || []);
        });
    });
}

exports.generateServiceSetup = async (req, res) => {
    try {
        const userId = req.session.user?.id;
        const serviceName = cleanText(req.body.serviceName || req.body.name, 120);
        const instructions = cleanText(req.body.instructions, 280);
        const categoryId = Number(req.body.categoryId || 0);

        if (!userId || req.session.user?.role !== 'merchant') {
            return res.status(403).json({
                success: false,
                message: 'Please log in as a merchant before using the AI service assistant.'
            });
        }

        if (!process.env.GROQ_API_KEY) {
            return res.status(503).json({
                success: false,
                message: 'AI suggestions are currently unavailable. You can continue completing the service manually.'
            });
        }

        if (serviceName.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Enter a service name first.'
            });
        }

        const [merchant, categories, products] = await Promise.all([
            getMerchantProfile(userId),
            getServiceCategories(),
            getMerchantProducts(userId)
        ]);

        if (!merchant) {
            return res.status(403).json({
                success: false,
                message: 'Your merchant profile could not be confirmed.'
            });
        }

        const selectedCategory = categories.find((category) => Number(category.category_id) === categoryId);
        const ownProducts = (products || [])
            .filter((product) => Number(product.salonId || 0) === Number(merchant.id || merchant.salonId || 0))
            .map((product) => ({
                name: cleanText(product.name, 120),
                category: cleanText(product.category, 80)
            }))
            .filter((product) => product.name);

        const suggestions = await generateServiceSetupSuggestions({
            serviceName,
            categoryName: selectedCategory ? selectedCategory.category_name : '',
            instructions,
            products: ownProducts
        });

        return res.json({
            success: true,
            suggestions
        });
    } catch (error) {
        console.warn('Service setup AI unavailable.');
        return res.status(error.code === 'AI_NOT_CONFIGURED' ? 503 : 500).json({
            success: false,
            message: 'AI suggestions are currently unavailable. You can continue completing the service manually.'
        });
    }
};

function sendAiError(res, error, logLabel = 'AI request error') {
    if (error?.status === 400 || error?.status === 413) {
        return res.status(error.status).json({
            error: error.code || 'VALIDATION_ERROR',
            message: error.message || 'Invalid request.'
        });
    }

    console.error(logLabel, {
        code: error?.code,
        status: error?.status || error?.statusCode,
        message: error?.message
    });
    const groqError = classifyGroqError(error);

    return res.status(groqError.status).json({
        error: groqError.code,
        message: groqError.message
    });
}

function requireBodyFields(body, fields) {
    return fields.filter((field) => !String(body?.[field] || '').trim());
}

exports.moderateReviewText = async (req, res) => {
    try {
        const missingFields = requireBodyFields(req.body, ['reviewText']);

        if (missingFields.length) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'Required review moderation data is missing.',
                missingFields
            });
        }

        if (String(req.body.reviewText || '').length > 2500) {
            return res.status(400).json({
                error: 'REVIEW_TEXT_TOO_LONG',
                message: 'Review text is too long.'
            });
        }

        const result = await moderateReviewTextWithGroq({
            reviewText: req.body.reviewText,
            rating: req.body.rating,
            merchantName: req.body.merchantName,
            serviceName: req.body.serviceName,
            productName: req.body.productName,
            verifiedBooking: req.body.verifiedBooking,
            completedBooking: req.body.completedBooking,
            previousReviewCount: req.body.previousReviewCount,
            duplicateTextCount: req.body.duplicateTextCount
        });

        return res.json(result);
    } catch (error) {
        return sendAiError(res, error, 'Review text moderation error');
    }
};

exports.moderateReviewImage = async (req, res) => {
    try {
        if (!req.body?.imageUrl && !req.body?.imageBase64) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'imageUrl or imageBase64 is required.'
            });
        }

        const result = await moderateReviewImageWithGroq({
            imageUrl: req.body.imageUrl,
            imageBase64: req.body.imageBase64,
            merchantCategory: req.body.merchantCategory,
            serviceName: req.body.serviceName,
            productName: req.body.productName,
            reviewText: req.body.reviewText
        });

        return res.json(result);
    } catch (error) {
        return sendAiError(res, error, 'Review image moderation error');
    }
};

function findReviewForMerchant(reviewId, merchantId) {
    return new Promise((resolve, reject) => {
        Review.findByIdForMerchant(reviewId, merchantId, (error, review) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(review || null);
        });
    });
}

exports.generateReviewReply = async (req, res) => {
    try {
        const user = req.session.user;

        if (!user) {
            return res.status(401).json({
                error: 'UNAUTHENTICATED',
                message: 'Please log in as a merchant before generating a review reply.'
            });
        }

        if (user.role !== 'merchant') {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Only merchants can generate review replies.'
            });
        }

        const reviewId = Number(req.body.reviewId);
        const merchant = await getMerchantProfile(user.id);

        if (!merchant) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Your merchant profile could not be confirmed.'
            });
        }

        if (!Number.isInteger(reviewId) || reviewId <= 0) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'reviewId is required.'
            });
        }

        const review = await findReviewForMerchant(reviewId, merchant.id || merchant.salonId);

        if (!review) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'You do not own this review.'
            });
        }

        const reviewText = String(review.comment || req.body.reviewText || '').trim();

        if (!reviewText) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'Review text is required.'
            });
        }

        const result = await generateReviewReplyFromGroq({
            reviewId: review.id,
            merchantName: review.merchantName || merchant.name,
            merchantCategory: review.merchantCategory || merchant.businessCategory || merchant.category || '',
            customerName: review.customerName || req.body.customerName || '',
            rating: review.rating,
            reviewText,
            serviceName: review.serviceName || '',
            productName: review.productName || '',
            merchantTone: req.body.merchantTone || 'Professional',
            businessPolicy: req.body.businessPolicy || ''
        });

        return res.json({
            ...result,
            reviewId: review.id
        });
    } catch (error) {
        const groqError = classifyGroqError(error);

        if (groqError.code && groqError.code.startsWith('GROQ_')) {
            return res.status(groqError.status === 429 ? 503 : groqError.status).json({
                error: groqError.code,
                message: groqError.message
            });
        }

        return sendAiError(res, error, 'Review reply generation error');
    }
};

exports.generateVoucherRecommendations = async (req, res) => {
    try {
        const result = await generateVoucherRecommendationsFromGroq({
            customerBookingFrequency: req.body.customerBookingFrequency,
            customerTotalSpend: req.body.customerTotalSpend,
            lastBookingDate: req.body.lastBookingDate,
            favouriteMerchant: req.body.favouriteMerchant,
            favouriteService: req.body.favouriteService,
            birthdayMonth: req.body.birthdayMonth,
            availableRewardPoints: req.body.availableRewardPoints,
            merchantSales: req.body.merchantSales,
            lowBookingDays: req.body.lowBookingDays,
            existingVouchers: req.body.existingVouchers,
            voucherRedemptionPerformance: req.body.voucherRedemptionPerformance
        });

        return res.json(result);
    } catch (error) {
        return sendAiError(res, error, 'Voucher recommendation error');
    }
};

function getStatisticsArray(req, fieldName) {
    const rows = Array.isArray(req.body?.[fieldName])
        ? req.body[fieldName]
        : Array.isArray(req.body)
            ? req.body
            : [];

    if (!rows.length) {
        const error = new Error(`${fieldName} must contain at least one row.`);
        error.code = 'VALIDATION_ERROR';
        error.status = 400;
        throw error;
    }

    return rows;
}

exports.recommendFeaturedMerchants = async (req, res) => {
    try {
        const result = await recommendFeaturedMerchantsWithGroq(getStatisticsArray(req, 'merchantStatistics'));
        return res.json(result);
    } catch (error) {
        return sendAiError(res, error, 'Featured merchant recommendation error');
    }
};

exports.recommendFeaturedServices = async (req, res) => {
    try {
        const result = await recommendFeaturedServicesWithGroq(getStatisticsArray(req, 'serviceStatistics'));
        return res.json(result);
    } catch (error) {
        return sendAiError(res, error, 'Featured service recommendation error');
    }
};

exports.recommendFeaturedProducts = async (req, res) => {
    try {
        const result = await recommendFeaturedProductsWithGroq(getStatisticsArray(req, 'productStatistics'));
        return res.json(result);
    } catch (error) {
        return sendAiError(res, error, 'Featured product recommendation error');
    }
};

exports.generatePromotionRecommendations = async (req, res) => {
    try {
        const user = req.session.user;

        // Keep this endpoint merchant-only because recommendations use merchant business data.
        if (!user || user.role !== 'merchant') {
            return res.status(user ? 403 : 401).json({
                error: user ? 'FORBIDDEN' : 'UNAUTHENTICATED',
                message: 'Please log in as a merchant to generate promotion recommendations.'
            });
        }

        const merchantData = req.body || {};
        const missingFields = ['merchantName', 'merchantCategory'].filter((field) => {
            return !String(merchantData[field] || '').trim();
        });

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'Required merchant promotion data is missing.',
                missingFields
            });
        }

        const recommendations = await generatePromotionRecommendationsFromGroq(merchantData);

        return res.status(200).json(recommendations);
    } catch (error) {
        return sendAiError(res, error, 'Groq promotion recommendation error');
    }
};
