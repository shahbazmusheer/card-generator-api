const Order = require('../../models/Order.model');
const User = require('../../models/User.model'); // <-- Import the User model
const { successResponse, errorResponse } = require('../../utils/responseHandler');

/**
 * @desc    Get a comprehensive overview of all platform statistics for the main admin dashboard.
 * @route   GET /api/admin/dashboard/overview
 * @access  Private/Admin
 */
exports.getPlatformOverviewStats = async (req, res) => {
    try {
        // We will run all our database queries in parallel for maximum efficiency.
        const [
            totalUsers,
            totalSalesData,
            verifiedOrders,
            deliveredOrders,
            happyBuyersCount
        ] = await Promise.all([
            // 1. Get Total Users
            User.countDocuments({ role: 'user' }),

            // 2. Get Total Sales using an Aggregation Pipeline
            Order.aggregate([
                {
                    $match: { orderStatus: { $ne: 'Rejected' } } // Only count sales from non-rejected orders
                },
                {
                    $group: {
                        _id: null, // Group all documents into a single result
                        total: { $sum: '$costs.total' } // Sum the 'total' field from the 'costs' object
                    }
                }
            ]),

            // 3. Get Verified Orders
            Order.countDocuments({
                orderStatus: { $nin: ['Pending Approval', 'Rejected'] }
            }),

            // 4. Get Delivered Orders
            Order.countDocuments({ orderStatus: 'Delivered' }),

            // 5. Get Happy Buyers (Unique users who have placed an order)
            Order.distinct('userId').then(users => users.length)
        ]);

        // The aggregation result for sales is an array, so we need to safely access it.
        const totalSales = totalSalesData.length > 0 ? totalSalesData[0].total : 0;

        const stats = {
            totalUsers,
            totalSales,
            verifiedOrders,
            deliveredOrders,
            happyBuyers: happyBuyersCount
        };

        successResponse(res, "Platform overview statistics retrieved successfully.", stats);
    } catch (error) {
        errorResponse(res, "Failed to retrieve platform overview stats.", 500, "STATS_OVERVIEW_FAILED", error.message);
    }
};


// The old, simpler function can remain if needed, but the new one is more comprehensive.
/**
 * @desc    Get dashboard statistics (total, pending, delivered orders).
 * @route   GET /api/admin/dashboard/stats
 * @access  Private/Admin
 */
exports.getOrderDashboardStats = async (req, res) => {
    // ... (this function can be kept or removed in favor of the new one)
    try{
        const [totalOrders, pendingOrders, deliveredOrders] = await Promise.all([
            Order.countDocuments(),
            Order.countDocuments({ orderStatus: 'Pending Approval' }),
            Order.countDocuments({ orderStatus: 'Delivered' })
        ]);
        const stats = { totalOrders, pendingOrders, deliveredOrders };
        successResponse(res, "Dashboard statistics retrieved successfully.", stats);
    } catch(error){
         errorResponse(res, "Failed to retrieve dashboard stats.", 500, "STATS_FETCH_FAILED", error.message);
    }
};