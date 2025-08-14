const User = require('../models/User.model');
const Order = require('../models/Order.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');

exports.getMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const [user, orderHistory] = await Promise.all([
            User.findById(userId).select('-password'),
            Order.find({ userId: userId }).sort({ createdAt: -1 }).lean()
        ]);
        if (!user) {
            return errorResponse(res, "User not found.", 404);
        }
        const profileData = { user: user.toObject(), orderHistory };
        successResponse(res, "Profile data retrieved successfully.", profileData);
    } catch (error) {
        errorResponse(res, "Failed to retrieve profile data.", 500, "GET_PROFILE_FAILED", error.message);
    }
};

exports.updateMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { fullName, phone, location, avatarUrl } = req.body;
        const updates = { fullName, phone, location, avatarUrl };
        Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);
        if (Object.keys(updates).length === 0) {
            return errorResponse(res, "No update data provided.", 400);
        }
        const updatedUser = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true, runValidators: true }).select('-password');
        successResponse(res, "Profile updated successfully.", updatedUser);
    } catch (error) {
        errorResponse(res, "Failed to update profile.", 500, "UPDATE_PROFILE_FAILED", error.message);
    }
};

// --- NEW CONTROLLER METHOD FOR AVATAR UPLOAD ---
/**
 * @desc    Handles the upload of a user avatar image.
 * @route   POST /api/profile/me/avatar
 * @access  Private
 */
exports.uploadAvatar = (req, res) => {
    // The multer middleware has already processed and saved the file.
    // If there was an error (e.g., wrong file type), it would have been caught.
    if (!req.file) {
        return errorResponse(res, "No file was uploaded.", 400);
    }

    // We construct the publicly accessible URL to the saved file.
    // The path needs to be formatted for a URL (forward slashes).
    const avatarUrl = `/images/avatars/${req.file.filename}`;

    // We send back the URL. The front-end will then use this URL in a
    // subsequent PUT /api/profile/me request to save it to the user's document.
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