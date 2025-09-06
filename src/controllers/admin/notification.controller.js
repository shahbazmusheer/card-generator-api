const User = require('../../models/User.model');
const { createNotification } = require('../../services/notification.service');
const { successResponse, errorResponse } = require('../../utils/responseHandler');

/**
 * @desc    Broadcasts a notification to all non-admin users.
 * @route   POST /api/admin/notifications/broadcast
 * @access  Private/Admin
 */
exports.broadcastNotification = async (req, res) => {
    try {
        const { title, message, link, type = 'announcement' } = req.body;

        if (!title || !message) {
            return errorResponse(res, "Title and message are required for a broadcast.", 400);
        }

        // 1. Find all regular users
        const users = await User.find({ role: 'user' }).select('_id');
        if (!users || users.length === 0) {
            return successResponse(res, "No users to notify.", null, 200);
        }

        // 2. Create a notification for each user
        // We use Promise.all to run these operations in parallel for efficiency.
        const notificationPromises = users.map(user =>
            createNotification(user._id, title, message, type, link)
        );

        await Promise.all(notificationPromises);

        successResponse(res, `Announcement has been broadcast to ${users.length} users successfully.`);

    } catch (error) {
        errorResponse(res, "Failed to broadcast notification.", 500, "BROADCAST_FAILED", error.message);
    }
};