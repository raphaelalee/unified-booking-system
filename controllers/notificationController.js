const Notification = require('../models/Notification');

function getRoleCopy(role) {
    if (role === 'admin') {
        return {
            eyebrow: 'Vaniday Admin',
            heading: 'Platform notifications',
            description: 'Track merchant approvals, sales signals, campaign updates, and system actions across Vaniday.'
        };
    }

    if (role === 'merchant') {
        return {
            eyebrow: 'Merchant Portal',
            heading: 'Merchant notifications',
            description: 'Read booking alerts, product order updates, stock reminders, and campaign activity for your merchant account.'
        };
    }

    return {
        eyebrow: 'Customer Centre',
        heading: 'Your notifications',
        description: 'Keep up with booking confirmations, successful purchases, reward updates, and new Vaniday offers.'
    };
}

function showNotifications(req, res) {
    return Notification.getForUser(req.session.user, (error, notifications = []) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Notifications Error',
                message: 'Notifications could not be loaded.'
            });
        }

        const unreadCount = notifications.filter((notification) => notification.status === 'unread').length;
        const typeCounts = notifications.reduce((counts, notification) => {
            counts[notification.type] = (counts[notification.type] || 0) + 1;
            return counts;
        }, {});

        const success = req.session.notificationSuccess || null;
        req.session.notificationSuccess = null;

        return res.render('notifications', {
            title: 'Notifications',
            roleCopy: getRoleCopy(req.session.user.role),
            notifications,
            unreadCount,
            typeCounts,
            success
        });
    });
}

function openNotification(req, res) {
    return Notification.getOneForUser(req.session.user.id, req.params.notificationId, (lookupError, notification) => {
        if (lookupError) {
            console.error(lookupError);
            return res.redirect('/notifications');
        }

        if (!notification) {
            return res.redirect('/notifications');
        }

        return Notification.markRead(req.session.user.id, req.params.notificationId, (markError) => {
            if (markError) {
                console.error(markError);
            }

            return res.redirect(notification.linkUrl || '/notifications');
        });
    });
}

function markNotificationRead(req, res) {
    return Notification.markRead(req.session.user.id, req.params.notificationId, (error) => {
        if (error) {
            console.error(error);
        }

        return res.redirect('/notifications');
    });
}

function markAllRead(req, res) {
    return Notification.markAllRead(req.session.user.id, (error) => {
        if (error) {
            console.error(error);
            req.session.notificationSuccess = null;
        } else {
            req.session.notificationSuccess = 'All notifications marked as read.';
        }

        return res.redirect('/notifications');
    });
}

function deleteNotification(req, res) {
    return Notification.deleteOneForUser(req.session.user.id, req.params.notificationId, (error) => {
        if (error) {
            console.error(error);
            req.session.notificationSuccess = null;
        } else {
            req.session.notificationSuccess = 'Notification deleted.';
        }

        return res.redirect('/notifications');
    });
}

function clearReadNotifications(req, res) {
    return Notification.deleteReadForUser(req.session.user.id, (error, result) => {
        if (error) {
            console.error(error);
            req.session.notificationSuccess = null;
        } else {
            const deletedCount = Number(result?.affectedRows || 0);
            req.session.notificationSuccess = deletedCount > 0
                ? `${deletedCount} read notification${deletedCount === 1 ? '' : 's'} deleted.`
                : 'There were no read notifications to delete.';
        }

        return res.redirect('/notifications');
    });
}

module.exports = {
    showNotifications,
    openNotification,
    markNotificationRead,
    markAllRead,
    deleteNotification,
    clearReadNotifications
};
