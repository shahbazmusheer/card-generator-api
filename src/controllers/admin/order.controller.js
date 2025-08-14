const Order = require('../../models/Order.model');
const { successResponse, errorResponse } = require('../../utils/responseHandler');
const dhlService = require('../../services/dhl.service'); // <-- Import the DHL service

/**
 * @desc    Get all orders with pagination, searching, and filtering for the admin panel.
 * @route   GET /api/admin/orders
 * @access  Private/Admin
 */
exports.getAllOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const status = req.query.status || '';

        let query = {};
        if (search) {
            query.orderId = { $regex: search, $options: 'i' };
        }
        if (status) {
            query.orderStatus = status;
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
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        };
        successResponse(res, "Orders retrieved successfully.", response);
    } catch (error) {
        errorResponse(res, "Failed to retrieve orders.", 500, "FETCH_ALL_ORDERS_FAILED", error.message);
    }
};

/**
 * @desc    Get full details for a single order for the admin panel.
 * @route   GET /api/admin/orders/:orderId
 * @access  Private/Admin
 */
exports.getOrderDetails = async (req, res) => {
    try {
        const orderId = decodeURIComponent(req.params.orderId);
        const order = await Order.findOne({ orderId }).populate('userId', 'fullName email phone');
        if (!order) return errorResponse(res, "Order not found.", 404);
        successResponse(res, "Order details retrieved successfully.", order);
    } catch (error) {
        errorResponse(res, "Failed to retrieve order details.", 500, "FETCH_ORDER_DETAIL_FAILED", error.message);
    }
};

/**
 * @desc    Update an order's status. If status is 'Shipped', it creates a shipment via DHL.
 * @route   PUT /api/admin/orders/:orderId/status
 * @access  Private/Admin
 */
exports.updateOrderStatus = async (req, res) => {
    try {
        const orderId = decodeURIComponent(req.params.orderId);
        const { status } = req.body;

        if (!status) return errorResponse(res, "A new status is required.", 400);

        const order = await Order.findOne({ orderId });
        if (!order) return errorResponse(res, "Order not found.", 404);

        order.orderStatus = status;

        // If the admin is marking the order as "Shipped", we automatically create
        // the shipment with DHL and get the real tracking number.
        if (status === 'Shipped') {
            if (!order.dhlTrackingNumber) { // Only create shipment if it doesn't already have one
                console.log(`Order ${orderId} status changed to Shipped. Creating DHL shipment...`);
                // Call the DHL service to create the shipment
                const { trackingNumber } = await dhlService.createShipment(order);
                order.dhlTrackingNumber = trackingNumber;
                console.log(`Shipment created for ${orderId}. Tracking #: ${trackingNumber}`);

                // You could trigger a "shipping confirmation" email to the user here.
            } else {
                console.log(`Order ${orderId} is already marked as shipped with tracking number.`);
            }
        }

        order.statusHistory.push({ status, date: new Date() });
        const updatedOrder = await order.save();

        successResponse(res, `Order status updated to ${status}.`, updatedOrder);
    } catch (error) {
        // Specifically handle errors from the DHL service
        if (error.message.startsWith("DHL")) {
            return errorResponse(res, error.message, 502); // 502 Bad Gateway is appropriate for upstream API errors
        }
        errorResponse(res, "Failed to update order status.", 500, "UPDATE_STATUS_FAILED", error.message);
    }
};


/**
 * @desc    Upload a print-ready PDF for an order.
 * @route   POST /api/admin/orders/:orderId/upload-pdf
 * @access  Private/Admin
 */
exports.uploadOrderPdf = async (req, res) => {
    try {
        const orderId = decodeURIComponent(req.params.orderId);
        if (!req.file) return errorResponse(res, "No PDF file was uploaded.", 400);

        const order = await Order.findOne({ orderId });
        if (!order) return errorResponse(res, "Order not found.", 404);

        order.printablePdfUrl = req.file.path;
        await order.save();
        successResponse(res, "Printable PDF uploaded successfully.", { filePath: req.file.path });
    } catch (error) {
        errorResponse(res, "Failed to upload PDF.", 500, "PDF_UPLOAD_FAILED", error.message);
    }
};

/**
 * @desc    Trigger the backend PDF generation for an order.
 * @route   POST /api/admin/orders/:orderId/generate-pdf
 * @access  Private/Admin
 */
exports.generateOrderPdf = async (req, res) => {
    try {
        const orderId = decodeURIComponent(req.params.orderId);
        const order = await Order.findOne({ orderId });
        if (!order) return errorResponse(res, "Order not found.", 404);

        const message = `Backend PDF generation for order ${orderId} has been initiated.`;
        successResponse(res, message, { orderId });
    } catch (error) {
        errorResponse(res, "Failed to generate PDF.", 500, "PDF_GENERATION_FAILED", error.message);
    }
};