const Box = require('../models/Box.model');
const Card = require('../models/Card.model');
const Element = require('../models/Element.model');
const CardTemplate = require('../models/CardTemplate.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const mongoose = require('mongoose');

// --- HELPER FUNCTION: The "Detach" Logic (Final Version) ---
// This is the core of the editing system. It clones the master template for a card's first edit.
const detachAndCloneTemplateForCard = async (card, userId, isGuest) => {
    // 1. Find the master template for the box this card belongs to.
    const box = await Box.findById(card.boxId);
    if (!box) throw new Error("Parent box not found.");
    const template = await CardTemplate.findById(box.cardTemplateId).populate('frontElements backElements');
    if (!template) throw new Error("Card template not found for this box.");

    // 2. Combine all template elements and the card's original unique elements into one list.
    const allCurrentElements = await Element.find({ _id: { $in: [...template.frontElements, ...template.backElements, ...card.elements] } });

    // 3. Clone every element to create a new, independent set for this card.
    const clonedElements = allCurrentElements.map(el => {
        const newEl = el.toObject();
        delete newEl._id; delete newEl.__v; // Ensure new IDs are generated
        newEl.userId = userId;
        newEl.isGuestElement = isGuest;
        return newEl;
    });

    // 4. Save the new, full set of elements.
    const newElements = await Element.insertMany(clonedElements);

    // 5. Update the card to use this new set of elements and mark it as custom.
    card.isCustomDesign = true;
    card.elements = newElements.map(e => e._id);

    const updatedCard = await card.save();
    return updatedCard.populate('elements');
};

exports.getCardById = async (req, res) => {
    try {
        const { cardId } = req.params;
        const card = await Card.findById(cardId).populate('elements').lean();
        if (!card) return errorResponse(res, "Card not found.", 404);

        if (!card.isCustomDesign) {
            const box = await Box.findById(card.boxId).lean();
            if (!box) return errorResponse(res, "Parent box not found.", 404);
            const cardTemplate = await CardTemplate.findById(box.cardTemplateId).populate('frontElements backElements').lean();
            return successResponse(res, "Template card details retrieved successfully.", { card, cardTemplate });
        }

        successResponse(res, "Custom card details retrieved successfully.", { card, cardTemplate: null });
    } catch (error) {
        errorResponse(res, "Error fetching card details.", 500, "FETCH_CARD_FAILED", error.message);
    }
};

exports.createCardInBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const { name, textContent } = req.body;
        const userId = req.user ? req.user.id : null;
        const box = await Box.findById(boxId);
        if (!box) return errorResponse(res, "Box not found.", 404);
        const isGuest = !userId;

        const textBgShape = await new Element({ type: 'shape', shapeType: 'rectangle', zIndex: 3, x: 40, y: 275, width: box.defaultCardWidthPx - 80, height: 120, fillColor: 'rgba(0, 0, 0, 0.5)', borderRadius: 15, boxId: box._id, isGuestElement: isGuest, userId }).save();
        const textElement = await new Element({ type: 'text', content: textContent || "New Card Text", zIndex: 5, x: 50, y: 280, width: box.defaultCardWidthPx - 100, height: 120, color: '#FFFFFF', fontFamily: "'Roboto', sans-serif", textAlign: 'center', fontSize: "18px", boxId: box._id, isGuestElement: isGuest, userId }).save();

        const newCard = await new Card({
            name: name || `New Card - ${Date.now()}`,
            boxId, userId, isGuestCard: isGuest,
            widthPx: box.defaultCardWidthPx, heightPx: box.defaultCardHeightPx,
            isCustomDesign: false,
            elements: [textBgShape._id, textElement._id]
        }).save();

        const cardForResponse = await Card.findById(newCard._id).populate('elements').lean();
        successResponse(res, "Card created successfully.", { card: cardForResponse }, 201);
    } catch (error) {
        errorResponse(res, "Failed to create card.", 500, "CREATE_CARD_FAILED", error.message);
    }
};

exports.updateCardDetails = async (req, res) => {
    try {
        const { cardId } = req.params;
        const { name, orderInBox } = req.body;
        const userId = req.user ? req.user.id : null;
        const isGuestRequest = !userId;
        const query = isGuestRequest ? { _id: cardId, isGuestCard: true } : { _id: cardId, $or: [{ userId: userId }, { isGuestCard: true }] };
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (orderInBox !== undefined) updates.orderInBox = orderInBox;
        if (Object.keys(updates).length === 0) return errorResponse(res, "No update fields provided.", 400);
        const updatedCard = await Card.findOneAndUpdate(query, { $set: updates }, { new: true }).lean();
        if (!updatedCard) return errorResponse(res, "Card not found or not authorized.", 404);
        successResponse(res, "Card details updated.", updatedCard);
    } catch (error) {
        errorResponse(res, "Failed to update card details.", 500, "UPDATE_CARD_FAILED", error.message);
    }
};

exports.deleteCard = async (req, res) => {
    try {
        const { cardId } = req.params;
        const userId = req.user ? req.user.id : null;
        const isGuestRequest = !userId;
        const query = isGuestRequest ? { _id: cardId, isGuestCard: true } : { _id: cardId, $or: [{ userId: userId }, { isGuestCard: true }] };
        const cardToDelete = await Card.findOne(query);
        if (!cardToDelete) return errorResponse(res, "Card not found or not authorized.", 404);
        if (cardToDelete.elements.length > 0) {
            await Element.deleteMany({ _id: { $in: cardToDelete.elements } });
        }
        await Card.findByIdAndDelete(cardId);
        successResponse(res, "Card and its elements deleted successfully.", { cardId });
    } catch (error) {
        errorResponse(res, "Error deleting card.", 500, "DELETE_CARD_FAILED", error.message);
    }
};

exports.addCardElement = async (req, res) => {
    try {
        const { cardId } = req.params;
        const elementProps = req.body;
        const userId = req.user ? req.user.id : null;
        const isGuestRequest = !userId;
        const query = isGuestRequest ? { _id: cardId, isGuestCard: true } : { _id: cardId, $or: [{ userId: userId }, { isGuestCard: true }] };
        let card = await Card.findOne(query);
        if (!card) return errorResponse(res, "Card not found or not authorized.", 404);

        if (!card.isCustomDesign) {
            card = await detachAndCloneTemplateForCard(card, userId, card.isGuestCard);
        }

        const newElement = await new Element({ ...elementProps, boxId: card.boxId, cardId: card._id, userId, isGuestElement: card.isGuestCard }).save();
        await Card.findByIdAndUpdate(cardId, { $push: { elements: newElement._id } });
        successResponse(res, "Element added to custom card design.", { element: newElement.toObject() }, 201);
    } catch (error) {
        errorResponse(res, "Failed to add element.", 500, "ADD_ELEMENT_FAILED", error.message);
    }
};

exports.updateCardElement = async (req, res) => {
    try {
        const { elementId } = req.params;
        const updates = req.body;
        const userId = req.user ? req.user.id : null;
        const isGuestRequest = !userId;
        const query = isGuestRequest ? { _id: elementId, isGuestElement: true } : { _id: elementId, $or: [{ userId: userId }, { isGuestElement: true }] };
        const element = await Element.findOne(query);
        if (!element) return errorResponse(res, "Element not found or not authorized.", 404);

        let card = await Card.findById(element.cardId);
        if (!card) return errorResponse(res, "Parent card not found.", 404);

        if (!card.isCustomDesign) {
            card = await detachAndCloneTemplateForCard(card, userId, card.isGuestCard);
        }
        delete updates._id; delete updates.cardId; delete updates.boxId; delete updates.userId;
        const updatedElement = await Element.findByIdAndUpdate(elementId, { $set: updates }, { new: true });
        successResponse(res, "Element updated successfully.", { element: updatedElement.toObject() });
    } catch (error) {
        errorResponse(res, "Failed to update element.", 500, "UPDATE_ELEMENT_FAILED", error.message);
    }
};

exports.deleteCardElement = async (req, res) => {
    try {
        const { cardId, elementId } = req.params;
        const userId = req.user ? req.user.id : null;
        const isGuestRequest = !userId;
        const cardQuery = isGuestRequest ? { _id: cardId, isGuestCard: true } : { _id: cardId, $or: [{ userId: userId }, { isGuestCard: true }] };
        let card = await Card.findOne(cardQuery);
        if (!card) return errorResponse(res, "Card not found or not authorized.", 404);

        if (!card.isCustomDesign) {
            card = await detachAndCloneTemplateForCard(card, userId, card.isGuestCard);
        }

        const elementQuery = isGuestRequest ? { _id: elementId, isGuestElement: true } : { _id: elementId, $or: [{ userId: userId }, { isGuestElement: true }] };
        const elementToDelete = await Element.findOne(elementQuery);
        if (!elementToDelete) return errorResponse(res, "Element not found on this card or not authorized.", 404);

        await Element.findByIdAndDelete(elementId);
        await Card.findByIdAndUpdate(cardId, { $pull: { elements: elementId } });
        successResponse(res, "Element deleted successfully.", { elementId });
    } catch (error) {
        errorResponse(res, "Failed to delete element.", 500, "DELETE_ELEMENT_FAILED", error.message);
    }
};