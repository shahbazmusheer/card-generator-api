const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const { sendEmail } = require('./email.service');

/**
 * Creates an in-app notification and attempts to send a corresponding email.
 * If userId is null, it notifies all admins.
 * @param {string|null} userId - The ID of the user to notify, or null for all admins.
 * @param {string} title - The title of the notification.
 * @param {string} message - The message body.
 * @param {string} type - The category ('order', 'project', 'announcement').
 * @param {string} link - The front-end link for the notification.
 */
async function createNotification(userId, title, message, type, link) {
    try {
        if (userId) {
            // --- Notify a single user ---
            await Notification.create({ userId, title, message, type, link });
            console.log(`In-app notification created for user ${userId}`);
            const emailHtml = `<h1>${title}</h1><p>${message}</p><p><a href="${process.env.FRONTEND_BASE_URL}${link}">View Details</a></p>`;
            await sendEmail(userId, title, message, emailHtml);
        } else {
            // --- Notify all admins ---
            const admins = await User.find({ role: 'admin' });
            for (const admin of admins) {
                await Notification.create({ userId: admin._id, title, message, type, link });
                console.log(`In-app notification created for admin ${admin._id}`);
                const emailHtml = `<h1>Admin Alert: ${title}</h1><p>${message}</p><p><a href="${process.env.FRONTEND_BASE_URL}${link}">View in Admin Panel</a></p>`;
                await sendEmail(admin._id, `Admin Alert: ${title}`, message, emailHtml);
            }
        }
    } catch (error) {
        console.error("Failed to create notification:", error);
    }
}

module.exports = { createNotification };