const User = require('../../models/User.model');
const Box = require('../../models/Box.model');
const Order = require('../../models/Order.model');
const UserActionLog = require('../../models/UserActionLog.model');

const { successResponse, errorResponse } = require('../../utils/responseHandler');



/**
 * @desc    Get all users with aggregated stats for the User Management list.
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
exports.getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';

        // The aggregation pipeline is the most efficient way to do this in MongoDB.
        const pipeline = [
            // Stage 1: Filter users by role 'user' and optional search query
            {
                $match: {
                    role: 'user',
                    $or: [
                        { fullName: { $regex: search, $options: 'i' } },
                        { email: { $regex: search, $options: 'i' } },
                        { username: { $regex: search, $options: 'i' } }
                    ]
                }
            },
            // Stage 2: Join with the 'boxes' collection
            {
                $lookup: {
                    from: 'boxes', // The actual name of the collection in MongoDB
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'games'
                }
            },
            // Stage 3: Join with the 'orders' collection
            {
                $lookup: {
                    from: 'orders', // The actual name of the collection in MongoDB
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'orders'
                }
            },
            // Stage 4: Reshape the document and calculate stats
            {
                $project: {
                    // Include original user fields
                    fullName: 1,
                    email: 1,
                    avatarUrl: 1,
                    createdAt: 1,
                    // Calculate new stats
                    gamesCreated: { $size: '$games' },
                    totalOrders: { $size: '$orders' },
                    totalSpending: { $sum: '$orders.costs.total' }
                }
            },
            // Stage 5: Sort by creation date
            { $sort: { createdAt: -1 } },
            // Stage 6: Apply pagination
            { $skip: (page - 1) * limit },
            { $limit: limit }
        ];

        const usersWithStats = await User.aggregate(pipeline);

        // We need a separate count for total pagination documents
        const total = await User.countDocuments({ role: 'user' });

        successResponse(res, 'Users with stats retrieved successfully.', {
            users: usersWithStats,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });

    } catch (err) {
        errorResponse(res, 'Server error while getting users with stats.', 500, 'GET_USERS_STATS_FAILED', err.message);
    }
};

/**
 * @desc    Get full details for a single user, including their projects and order history.
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
exports.getUser = async (req, res) => {
    try {
        // Fetch the user, their created boxes, and their orders in parallel
        const [user, projects, orderHistory] = await Promise.all([
            User.findById(req.params.id).select('-password'),
            Box.find({ userId: req.params.id }).sort({ createdAt: -1 }).lean(),
            Order.find({ userId: req.params.id }).sort({ createdAt: -1 }).lean()
        ]);

        if (!user) return errorResponse(res, 'User not found', 404);

        const userDetails = {
            user: user.toObject(),
            projects,
            orderHistory
        };

        successResponse(res, 'User details retrieved successfully.', userDetails);
    } catch (err) {
        errorResponse(res, 'Server error while getting user details.', 500, 'GET_USER_DETAILS_FAILED', err.message);
    }
};
 
/**
 * @desc    Update user details (e.g., name, phone, location, role)
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
exports.updateUser = async (req, res) => {
    try {
        const { fullName, phone, email, location, role } = req.body;
        const updates = { fullName, phone, email, location, role };
        
        Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

        const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).select('-password');
        if (!user) return errorResponse(res, 'User not found', 404);
        
        successResponse(res, 'User updated successfully.', user);
    } catch (err) {
        errorResponse(res, 'Server error while updating user.', 500, 'UPDATE_USER_FAILED', err.message);
    }
};

// @desc    Delete a user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return errorResponse(res, 'User not found', 404);

        // In a real app, you might want to handle cleaning up the user's content (orders, boxes, etc.)
        // For now, we just remove the user document.
        await user.remove();
        successResponse(res, 'User deleted successfully.', { userId: req.params.id });
    } catch (err) {
        errorResponse(res, 'Server error while deleting user.', 500, 'DELETE_USER_FAILED', err.message);
    }
};


// --- User Moderation Actions ---

// @desc    Ban a user
// @route   PUT /api/admin/users/:id/ban
// @access  Private/Admin
exports.banUser = async (req, res) => {
    try {
        const { reasonType, reasonDescription } = req.body;
        if (!reasonType || !reasonDescription) return errorResponse(res, 'Reason type and description are required.', 400);

        const user = await User.findById(req.params.id);
        if (!user) return errorResponse(res, 'User not found', 404);
        if (user.role === 'admin') return errorResponse(res, 'Admins cannot be banned.', 400);
        if (user.status === 'banned') return errorResponse(res, `User is already banned.`, 400);

        user.status = 'banned';
        user.suspensionExpiresAt = null; // Clear any previous suspension
        await user.save();
        
        await UserActionLog.deleteMany({ userId: user._id });
        await UserActionLog.create({
            userId: user._id,
            moderatorId: req.user.id,
            actionType: 'ban',
            reasonType,
            reasonDescription
        });

        successResponse(res, `User ${user.username} has been banned.`);
    } catch (err) {
        errorResponse(res, 'Server error during ban operation.', 500, 'BAN_USER_FAILED', err.message);
    }
};

// @desc    Suspend a user
// @route   PUT /api/admin/users/:id/suspend
// @access  Private/Admin
exports.suspendUser = async (req, res) => {
    try {
        const { suspensionEndDate, reasonType, reasonDescription } = req.body;
        if (!suspensionEndDate || new Date(suspensionEndDate) <= new Date()) return errorResponse(res, 'Please provide a valid future suspension end date.', 400);
        if (!reasonType || !reasonDescription) return errorResponse(res, 'Reason type and description are required.', 400);

        const user = await User.findById(req.params.id);
        if (!user) return errorResponse(res, 'User not found', 404);
        if (user.role === 'admin') return errorResponse(res, 'Admins cannot be suspended.', 400);

        user.status = 'suspended';
        user.suspensionExpiresAt = suspensionEndDate;
        await user.save();

        await UserActionLog.create({
            userId: user._id,
            moderatorId: req.user.id,
            actionType: 'suspend',
            reasonType,
            reasonDescription,
            expiresAt: suspensionEndDate
        });

        successResponse(res, `User ${user.username} has been suspended until ${new Date(suspensionEndDate).toLocaleString()}.`);
    } catch (err) {
        errorResponse(res, 'Server error during suspend operation.', 500, 'SUSPEND_USER_FAILED', err.message);
    }
};


// @desc    Unban or remove suspension from a user
// @route   PUT /api/admin/users/:id/activate
// @access  Private/Admin
exports.activateUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return errorResponse(res, 'User not found', 404);
        if (user.status === 'active') return errorResponse(res, `User is already active.`, 400);

        user.status = 'active';
        user.suspensionExpiresAt = null;
        await user.save();

        await UserActionLog.deleteMany({ userId: user._id });

        successResponse(res, `User ${user.username} has been activated.`);
    } catch (err) {
        errorResponse(res, 'Server error during activation.', 500, 'ACTIVATE_USER_FAILED', err.message);
    }
};