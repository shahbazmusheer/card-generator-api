const Order = require('../../models/Order.model');
const { successResponse, errorResponse } = require('../../utils/responseHandler');
const dhlService = require('../../services/dhl.service'); // <-- Import the DHL service



/**
 * @description Handles the review of a modification request by an admin.
 * @param {string} orderId - The ID of the order to review.
 * @param {string} status - The status of the modification request ("accepted" or "rejected").
 * @param {Object} req.user - The user who is making the request (should be an admin).
 * @param {Object} res - The response object.
 * @returns {Promise} A promise that resolves to the response object.
 */
exports.reviewModification = async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  const adminId = req.user.id;

  // Validate status
  if (!['accepted', 'rejected'].includes(status)) {
    return errorResponse(res, 'Invalid status value. Must be "accepted" or "rejected".', 400);
  }

  try {
    const order = await Order.findById(orderId);
    if (!order || !order.modificationRequest || order.modificationRequest.status !== 'pending') {
        return errorResponse(res, 'No pending modification request found for this order.', 404);
    }
    
    // return successResponse(res, `Modification request ${status}`, {
    //   order: order,  
    //   allow: order.modificationAllowed,
    //   modificationRequest: order.modificationRequest
    // });
    // Update modification request
    order.modificationRequest.status = status;
    order.modificationRequest.reviewedAt = new Date();
    order.modificationRequest.reviewedBy = adminId;
    order.modificationAllowed = (status === 'accepted');
    
    await order.save();

    return successResponse(res, `Modification request ${status}`, {
      orderId: order._id,
      modificationRequest: order.modificationRequest
    });

  } catch (error) {
    console.error('❌ Error in reviewModification:', error);
    return errorResponse(res, 'Internal server error', 500, null, error.message);
  }
};

/**
 * @desc    Get a list of orders with pending modification requests.
 * @route   GET /api/admin/modifications
 * @access  Private/Admin
 * @param   {Number} page - Page number (optional, default: 1)
 * @param   {Number} limit - Number of orders per page (optional, default: 10)
 * @param   {String} search - Optional search by orderId
 */
exports.getModificationOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || '';

    // Query for orders with modificationRequest.status = "pending" AND modificationAllowed = false
    const query = {
      modificationAllowed: false,
      "modificationRequest.status": "pending"
    };

    // Optional search by orderId
    if (search) {
      query.orderId = { $regex: search, $options: 'i' };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('userId', 'username email')
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await Order.countDocuments(query);

    const response = {
      orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };

    successResponse(res, 'Pending modification orders retrieved successfully.', response);
  } catch (error) {
    errorResponse(res, 'Failed to retrieve modification orders.', 500, 'FETCH_PENDING_MODIFICATION_ORDERS_FAILED', error.message);
  }
};
