const { promisify } = require('util');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');

const getAutoCompletionCandidates = promisify(Booking.getAutoCompletionCandidates);
const autoConfirmPendingBookings = promisify(Booking.autoConfirmPendingBookings);
const markCompleted = promisify(Booking.markCompleted);
const getNotificationDetailsById = promisify(Booking.getNotificationDetailsById);

let autoCompletionTimer = null;
let autoCompletionRunning = false;

function isEnabled() {
    return String(process.env.BOOKING_AUTO_COMPLETION_ENABLED || 'true').toLowerCase() !== 'false';
}

function getIntervalMs() {
    const intervalMinutes = Number(process.env.BOOKING_AUTO_COMPLETION_INTERVAL_MINUTES || 5);
    return Math.max(intervalMinutes, 1) * 60 * 1000;
}

function getGraceMinutes() {
    return Math.max(0, Number(process.env.BOOKING_AUTO_COMPLETION_GRACE_MINUTES || 0));
}

function getBatchSize() {
    return Math.max(1, Math.min(100, Number(process.env.BOOKING_AUTO_COMPLETION_BATCH_SIZE || 25)));
}

function notifyCustomerBookingCompleted(bookingId, loyaltyAward = {}, callback = () => {}) {
    getNotificationDetailsById(bookingId)
        .then((booking) => {
            if (!booking?.user_id) {
                callback(null);
                return;
            }

            const pointsAwarded = Number(loyaltyAward.points || booking.booking_points_awarded || 0);
            const completionMessage = pointsAwarded > 0
                ? `Appointment completed. ${pointsAwarded} loyalty points have been added to your wallet.`
                : 'Appointment completed.';

            Notification.create({
                recipientUserId: booking.user_id,
                recipientRole: 'customer',
                actorUserId: null,
                type: 'booking_completed',
                title: 'Booking completed',
                message: `${completionMessage} ${booking.service_name} at ${booking.merchant_name}.`,
                linkUrl: '/profile#bookings',
                dedupeKey: `auto-booking-completed-${bookingId}`
            }, callback);
        })
        .catch(callback);
}

async function autoCompleteDueBookings() {
    if (!isEnabled() || autoCompletionRunning) {
        return;
    }

    autoCompletionRunning = true;

    try {
        const confirmationResult = await autoConfirmPendingBookings(Number(process.env.BOOKING_AUTO_CONFIRM_BATCH_SIZE || 100));

        if (Number(confirmationResult?.affectedRows || 0) > 0) {
            console.log(`Auto-confirmed ${confirmationResult.affectedRows} pending booking${confirmationResult.affectedRows === 1 ? '' : 's'}.`);
        }

        const bookings = await getAutoCompletionCandidates(getBatchSize(), getGraceMinutes());

        for (const booking of bookings) {
            try {
                const result = await markCompleted(booking.id);

                if (result?.affectedRows) {
                    await new Promise((resolve) => {
                        notifyCustomerBookingCompleted(booking.id, result.loyaltyAward, (notificationError) => {
                            if (notificationError) {
                                console.error(`Auto-completion notification failed for booking ${booking.id}:`, notificationError);
                            }

                            resolve();
                        });
                    });

                    const points = Number(result?.loyaltyAward?.points || 0);
                    console.log(`Auto-completed booking ${booking.id}${points > 0 ? ` and awarded ${points} points` : ''}.`);
                }
            } catch (error) {
                console.error(`Auto-completion failed for booking ${booking.id}:`, error);
            }
        }
    } catch (error) {
        console.error('Booking auto-completion job failed:', error);
    } finally {
        autoCompletionRunning = false;
    }
}

function startBookingAutoCompletionScheduler() {
    if (!isEnabled() || autoCompletionTimer) {
        return;
    }

    autoCompletionTimer = setInterval(autoCompleteDueBookings, getIntervalMs());
    autoCompletionTimer.unref?.();
    autoCompleteDueBookings();
}

module.exports = {
    autoCompleteDueBookings,
    startBookingAutoCompletionScheduler
};
