const Notification = require('../models/Notification.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');

exports.getMyNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const { type } = req.query; // For filtering
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 10;

        const query = { userId };
        if (type && ['order', 'project', 'announcement', 'social'].includes(type)) {
            query.type = type;
        }

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Notification.countDocuments(query);

        successResponse(res, "Notifications retrieved.", {
            notifications,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        errorResponse(res, "Failed to retrieve notifications.", 500, "FETCH_NOTIFS_FAILED", error.message);
    }
};

exports.getRecentNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const [recent, unreadCount] = await Promise.all([
            Notification.find({ userId }).sort({ createdAt: -1 }).limit(5),
            Notification.countDocuments({ userId, isRead: false })
        ]);
        successResponse(res, "Recent notifications retrieved.", { recent, unreadCount });
    } catch (error) {
        errorResponse(res, "Failed to get recent notifications.", 500, "FETCH_RECENT_NOTIFS_FAILED", error.message);
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
        successResponse(res, "All notifications marked as read.");
    } catch (error) {
        errorResponse(res, "Failed to mark notifications as read.", 500, "MARK_READ_FAILED", error.message);
    }
};