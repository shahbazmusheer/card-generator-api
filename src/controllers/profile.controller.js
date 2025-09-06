const Box = require('../models/Box.model');
const Order = require('../models/Order.model');
const User = require('../models/User.model');
const Element = require('../models/Element.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const mongoose = require('mongoose');

// --- THIS IS THE CORRECTED VERSION of getMyProfile ---
exports.getMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch the user's profile details and their complete order history in parallel for efficiency.
        const [user, orderHistory] = await Promise.all([
            User.findById(userId).select('-password'), // Exclude password from the response
            Order.find({ userId: userId })
                .sort({ createdAt: -1 }) // Show most recent orders first
                .lean()
        ]);

        if (!user) {
            return errorResponse(res, "User not found.", 404);
        }

        // Assemble the final response object containing both user data and their orders.
        const profileData = {
            user: user.toObject(),
            orderHistory
        };

        successResponse(res, "Profile data retrieved successfully.", profileData);

    } catch (error) {
        errorResponse(res, "Failed to retrieve profile data.", 500, "GET_PROFILE_FAILED", error.message);
    }
};

exports.updateMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { fullName, phone, location, avatarUrl, settings } = req.body;

        const updates = {};
        if (fullName !== undefined) updates.fullName = fullName;
        if (phone !== undefined) updates.phone = phone;
        if (location !== undefined) updates.location = location;
        if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
        if (settings && typeof settings.receiveEmailNotifications === 'boolean') {
            updates['settings.receiveEmailNotifications'] = settings.receiveEmailNotifications;
        }

        if (Object.keys(updates).length === 0) {
            return errorResponse(res, "No update data provided.", 400);
        }

        const updatedUser = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true, runValidators: true }).select('-password');
        successResponse(res, "Profile updated successfully.", updatedUser);
    } catch (error) {
        errorResponse(res, "Failed to update profile.", 500, "UPDATE_PROFILE_FAILED", error.message);
    }
};

exports.uploadAvatar = (req, res) => {
    if (!req.file) {
        return errorResponse(res, "No file was uploaded.", 400);
    }
    const avatarUrl = `/images/avatars/${req.file.filename}`;
    successResponse(res, "Avatar uploaded successfully. Use this URL to save the changes.", { avatarUrl });
};

exports.deleteMyAccount = async (req, res) => {
    try {
        const userId = req.user.id;
        await User.findByIdAndDelete(userId);
        successResponse(res, "Your account has been permanently deleted.");
    } catch (error) {
        errorResponse(res, "Failed to delete account.", 500, "DELETE_ACCOUNT_FAILED", error.message);
    }
};

exports.getUserDashboardStatsOldOld = async (req, res) => {
    try {
        const userId = req.user.id;

        const [
            myGameCardsCount,
            totalOrdersCount,
            ordersReceivedCount,
            totalPurchaseData,
            recentProjects
        ] = await Promise.all([
            Box.countDocuments({ userId }),
            Order.countDocuments({ userId, orderStatus: { $ne: 'Rejected' } }),
            Order.countDocuments({ userId, orderStatus: { $in: ['Delivered', 'Completed'] } }),
            Order.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId), orderStatus: { $ne: 'Rejected' } } },
                { $group: { _id: null, total: { $sum: '$costs.total' } } }
            ]),
            Box.find({ userId }).sort({ updatedAt: -1 }).limit(4).lean()
        ]);

        const totalPurchase = totalPurchaseData.length > 0 ? totalPurchaseData[0].total : 0;

        const stats = {
            myGameCards: myGameCardsCount,
            totalOrder: totalOrdersCount,
            orderReceived: ordersReceivedCount,
            totalPurchase: parseFloat(totalPurchase.toFixed(2))
        };

        const projectIds = recentProjects.map(p => p._id);
        const coverElements = await Element.aggregate([
            { $match: { boxId: { $in: projectIds }, isFrontElement: true, zIndex: 0, type: 'image' } },
            { $sort: { createdAt: 1 } },
            { $group: { _id: "$boxId", coverElement: { $first: "$$ROOT" } } }
        ]);

        const projectsWithCovers = recentProjects.map(project => {
            const cover = coverElements.find(c => c._id.toString() === project._id.toString());
            return {
                ...project,
                coverImageUrl: cover ? cover.coverElement.imageUrl : null
            };
        });

        const dashboardData = {
            stats,
            recentProjects: projectsWithCovers
        };

        successResponse(res, "User dashboard data retrieved successfully.", dashboardData);
    } catch (error)
    {
        errorResponse(res, "Failed to retrieve user dashboard data.", 500, "DASHBOARD_FETCH_FAILED", error.message);
    }
};

// --- THIS IS THE CORRECTED AND FINAL VERSION of getUserDashboardStats ---
exports.getUserDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;

        const [
            myGameCardsCount,
            totalOrdersCount,
            ordersReceivedCount,
            totalPurchaseData,
            // --- THE FIX: This query now fully populates the box elements. ---
            // Because we only fetch a limit of 4, this is very fast and efficient.
            recentProjects
        ] = await Promise.all([
            Box.countDocuments({ userId }),
            Order.countDocuments({ userId, orderStatus: { $ne: 'Rejected' } }),
            Order.countDocuments({ userId, orderStatus: { $in: ['Delivered', 'Completed'] } }),
            Order.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId), orderStatus: { $ne: 'Rejected' } } },
                { $group: { _id: null, total: { $sum: '$costs.total' } } }
            ]),
            Box.find({ userId })
                .sort({ updatedAt: -1 })
                .limit(4)
                .populate('boxFrontElementIds') // Populate the actual element documents
                .populate('boxBackElementIds')
                .lean()
        ]);

        const totalPurchase = totalPurchaseData.length > 0 ? totalPurchaseData[0].total : 0;

        const stats = {
            myGameCards: myGameCardsCount,
            totalOrder: totalOrdersCount,
            orderReceived: ordersReceivedCount,
            totalPurchase: parseFloat(totalPurchase.toFixed(2))
        };

        // The front-end now has everything it needs.
        // It can find the cover image from the populated 'boxFrontElementIds' array.
        const dashboardData = {
            stats,
            recentProjects: recentProjects
        };

        successResponse(res, "User dashboard data retrieved successfully.", dashboardData);
    } catch (error) {
        errorResponse(res, "Failed to retrieve user dashboard data.", 500, "DASHBOARD_FETCH_FAILED", error.message);
    }
};