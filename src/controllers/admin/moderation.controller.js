const Box = require('../../models/Box.model');
const Card = require('../../models/Card.model');
const Element = require('../../models/Element.model');
const CardTemplate = require('../../models/CardTemplate.model');
const ModificationRequest = require('../../models/ModificationRequest.model');
const Order = require('../../models/Order.model');
const { successResponse, errorResponse } = require('../../utils/responseHandler');
// --- THIS IS THE FIX ---
const { createNotification } = require('../../services/notification.service');

exports.getPendingBoxes = async (req, res) => {
    try {
        const pendingBoxes = await Box.find({ moderationStatus: 'pending_review' }).sort({ createdAt: -1 });
        successResponse(res, "Boxes pending review retrieved successfully.", pendingBoxes);
    } catch (error) {
        errorResponse(res, "Failed to retrieve pending boxes.", 500, "FETCH_PENDING_BOXES_FAILED", error.message);
    }
};

exports.updateBoxModerationStatus = async (req, res) => {
    try {
        const { boxId } = req.params;
        const { status } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return errorResponse(res, "Invalid status provided.", 400);
        }
        const box = await Box.findByIdAndUpdate(boxId, { moderationStatus: status }, { new: true });
        if (!box) {
            return errorResponse(res, "Box not found.", 404);
        }
        if (box.userId) {
            const title = `Project Status Alert`;
            const message = `Your game project '${box.name}' has been ${status}.`;
            const link = `/projects/${box._id}`;
            await createNotification(box.userId, title, message, 'project', link);
        }
        successResponse(res, `Box has been ${status}.`, box);
    } catch (error) {
        errorResponse(res, "Failed to update box moderation status.", 500, "UPDATE_BOX_MOD_STATUS_FAILED", error.message);
    }
};

exports.getModificationRequests = async (req, res) => { /* ... (unchanged) ... */ };

exports.processModificationRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { status, adminReason } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return errorResponse(res, "Invalid status provided.", 400);
        }
        const request = await ModificationRequest.findById(requestId);
        if (!request) return errorResponse(res, "Modification request not found.", 404);
        const order = await Order.findById(request.orderId);
        if (!order) return errorResponse(res, "Associated order not found.", 404);

        if (status === 'approved') {
            const originalBoxId = order.items[0].boxId;
            await Box.findByIdAndDelete(originalBoxId);
            await CardTemplate.findOneAndDelete({ boxId: originalBoxId });
            await Card.deleteMany({ boxId: originalBoxId });
            await Element.deleteMany({ boxId: originalBoxId });
            const { box, cardTemplate, cards } = request.modifiedBoxData;
            const newBox = await new Box({ ...box, _id: originalBoxId, userId: request.userId, isGuestBox: false }).save();
            const newTemplate = await new CardTemplate({ ...cardTemplate, _id: box.cardTemplateId, boxId: newBox._id, userId: request.userId }).save();
            for (const card of cards) {
                await new Card({ ...card, _id: card._id, boxId: newBox._id, userId: request.userId, isGuestCard: false }).save();
            }
        }

        request.status = status;
        request.adminReason = adminReason || '';
        await request.save();
        order.orderStatus = 'Pending Approval';
        order.statusHistory.push({ status: 'Pending Approval', reason: `Modification ${status}` });
        await order.save();

        const title = `Order Modification ${status.charAt(0).toUpperCase() + status.slice(1)}`;
        const message = `Your modification request for order ${order.orderId} has been ${status}.`;
        const link = `/orders/${order.orderId}`;
        await createNotification(order.userId, title, message, 'order', link);

        successResponse(res, `Modification request has been ${status}.`);
    } catch (error) {
        errorResponse(res, "Failed to process modification request.", 500, "PROCESS_MOD_REQUEST_FAILED", error.message);
    }
};