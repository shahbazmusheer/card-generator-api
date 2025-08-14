// src/controllers/card.controller.js
const Box = require('../models/Box.model'); // May need for auth/context
const Card = require('../models/Card.model');
const Element = require('../models/Element.model');
const aiService = require('../services/ai.service');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION = `
You are a data generation assistant. Your ONLY task is to provide concise, raw data examples based on the user's request, suitable for populating fields on a card.
- Output must be like problem-solving game.
- Alway change scenarios and also don't include answers.
- keep the questions basic and non-conceptual.
- keep the game level to most basic.
- Output ONLY the requested data items.
- Each distinct data item should be on a new line.
- Do NOT include any titles, headings, explanations, introductions, summaries, or conversational text (e.g., "Here are some examples:", "I hope this helps!").
- If the user asks for "examples of X", provide only the examples of X, not a description of X.
- If the user asks for "questions for Y", provide only the questions for Y.
- If the user asks for "stats for Z", provide only the stats for Z.
- Think of your output as directly filling a spreadsheet or a list on a game card.
- Adhere strictly to these formatting and content rules.
`;


exports.getCardsByBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const userId = req.user?.id || "60c72b2f9b1e8b5a70d4834d"; // Placeholder

        // Optional: Check if user owns the box
        const box = await Box.findOne({ _id: boxId, userId });
        if (!box) return res.status(404).json({ success:false, message: "Box not found or not authorized."});

        const cards = await Card.find({ boxId }).sort({ orderInBox: 1 });
        successResponse(res, "Cards for box retrieved.", cards);
    } catch (error) {
        errorResponse(res, "Failed to retrieve cards for box.", 500, "FETCH_CARDS_FAILED", error.message);
    }
};

// --- Standard Success Response ---
function successResponse(res, message, data, statusCode = 200, metadata = null) {
    const response = { success: true, message, data };
    if (metadata) response.metadata = metadata;
    res.status(statusCode).json(response);
}

// --- Standard Error Response ---
function errorResponse(res, message, statusCode = 500, errorCode = null, details = null) {
    const errorPayload = { details: details || message };
    if (errorCode) errorPayload.code = errorCode;
    res.status(statusCode).json({ success: false, message: errorPayload.details });
}

// Helper to get the correct element array path on the Card model
const getCardElementArrayPath = (isFront) => { // Changed param to boolean
    return isFront ? 'cardFrontElementIds' : 'cardBackElementIds';
};


exports.getCardsByBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        let userId = null; // For guest access
        if (req.user && req.user.id) { // If user is authenticated
            userId = req.user.id;
        }

        const boxQuery = { _id: boxId };
        if (userId) {
            boxQuery.userId = userId; // Logged-in user can only access their own boxes
        } else {
            boxQuery.isGuestBox = true; // Guests can only access guest boxes
        }
        const box = await Box.findOne(boxQuery);
        if (!box) return errorResponse(res, "Box not found or not authorized.", 404, "BOX_NOT_FOUND");

        const cardsFromDB = await Card.find({ boxId: box._id }) // Ensure cards are from the verified box
            .populate('cardFrontElementIds') // Populate with Element documents
            .populate('cardBackElementIds')   // Populate with Element documents
            .sort({ orderInBox: 1 })
            .lean();

        const cardsForResponse = cardsFromDB.map(card => {
            const responseCard = { ...card };
            responseCard.cardFrontElements = card.cardFrontElementIds || []; // Populated array
            responseCard.cardBackElements = card.cardBackElementIds || [];   // Populated array
            // Re-create IDs array for frontend consistency if needed
            responseCard.cardFrontElementIds = (card.cardFrontElementIds || []).map(el => el._id);
            responseCard.cardBackElementIds = (card.cardBackElementIds || []).map(el => el._id);
            return responseCard;
        });
        successResponse(res, "Cards for box retrieved.", cardsForResponse);
    } catch (error) {
        errorResponse(res, "Failed to retrieve cards for box.", 500, "FETCH_CARDS_FAILED", error.message);
    }
};

exports.createCardInBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const { name, widthPx, heightPx, cardFrontElementsData = [], cardBackElementsData = [], orderInBox } = req.body;
        // cardFrontElementsData & cardBackElementsData are arrays of element *properties*

        let userId = null;
        let isGuestCard = true;
        if (req.user && req.user.id) { // If route is protected and user is logged in
            userId = req.user.id;
        }

        const boxQuery = { _id: boxId };
        if (userId) {
            boxQuery.userId = userId;
        } else {
            boxQuery.isGuestBox = true; // Guest can only add to a guest box
        }
        const box = await Box.findOne(boxQuery);
        if (!box) return errorResponse(res, "Box not found or not authorized to add cards.", 404, "BOX_NOT_FOUND_OR_UNAUTHORIZED");

        if (box.userId) { // If the box is owned, the card is not a guest card
            isGuestCard = false;
            userId = box.userId; // Card's userId should match box's userId
        }


        const tempCardId = new mongoose.Types.ObjectId(); // Pre-generate ID for linking elements

        // Create Front Elements
        let createdFrontElementIds = [];
        if (cardFrontElementsData.length > 0) {
            const frontElementsToCreate = cardFrontElementsData.map(el => ({
                ...el,
                cardId: tempCardId,
                boxId: box._id,
                userId: userId, // Inherit userId from box or null if guest box
                isGuestElement: isGuestCard, // Match card's guest status
                isFrontElement: true
            }));
            const savedFrontElements = await Element.insertMany(frontElementsToCreate);
            createdFrontElementIds = savedFrontElements.map(el => el._id);
        }

        // Create Back Elements
        let createdBackElementIds = [];
        if (cardBackElementsData.length > 0) {
            const backElementsToCreate = cardBackElementsData.map(el => ({
                ...el,
                cardId: tempCardId,
                boxId: box._id,
                userId: userId,
                isGuestElement: isGuestCard,
                isFrontElement: false
            }));
            const savedBackElements = await Element.insertMany(backElementsToCreate);
            createdBackElementIds = savedBackElements.map(el => el._id);
        }

        const newCard = new Card({
            _id: tempCardId,
            name: name || 'New Card',
            boxId,
            userId, // Will be box's userId if box is owned, or null if guest box/card
            isGuestCard,
            widthPx: widthPx || box.defaultCardWidthPx,
            heightPx: heightPx || box.defaultCardHeightPx,
            cardFrontElementIds: createdFrontElementIds,
            cardBackElementIds: createdBackElementIds,
            orderInBox: orderInBox === undefined ? (await Card.countDocuments({ boxId })) : orderInBox
        });
        let savedCard = await newCard.save();

        // Populate for response
        savedCard = await Card.findById(savedCard._id)
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .lean();
        
        const cardForResponse = {
            ...savedCard,
            cardFrontElements: savedCard.cardFrontElementIds || [],
            cardBackElements: savedCard.cardBackElementIds || [],
            cardFrontElementIds: (savedCard.cardFrontElementIds || []).map(el => el._id), // Keep original IDs for reference
            cardBackElementIds: (savedCard.cardBackElementIds || []).map(el => el._id),
        };

        successResponse(res, "Card created successfully.", cardForResponse, 201);
    } catch (error) {
        console.error("Error in createCardInBox:", error.message, error.stack);
        errorResponse(res, "Failed to create card in box.", 500, "CREATE_CARD_FAILED", error.message);
    }
};

exports.updateCardDetails = async (req, res) => {
    console.log(`CARD_CONTROLLER: updateCardDetails called for cardId: ${req.params.cardId}`);
    try {
        const { cardId } = req.params;
        const { name, orderInBox, metadata } = req.body;
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            return errorResponse(res, "Invalid Card ID format.", 400, "INVALID_ID_FORMAT");
        }

        const updates = {};
        if (name !== undefined) updates.name = String(name).trim();
        if (orderInBox !== undefined) updates.orderInBox = Number(orderInBox);
        if (metadata !== undefined) updates.metadata = metadata;

        if (Object.keys(updates).length === 0) {
            return errorResponse(res, "No valid fields for update.", 400, "NO_UPDATE_FIELDS");
        }
        updates.updatedAt = Date.now();

        const cardQuery = { _id: cardId };
        if (userId) cardQuery.userId = userId; else cardQuery.isGuestCard = true; // Allow guest to update their guest card

        const card = await Card.findOne(cardQuery);
        if (!card) {
            return errorResponse(res, "Card not found or not authorized.", 404, "CARD_NOT_FOUND_OR_UNAUTHORIZED");
        }

        const updatedCardFromDB = await Card.findByIdAndUpdate(cardId, { $set: updates }, { new: true, runValidators: true })
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .lean();

        if (!updatedCardFromDB) { // Should be caught by the findOne earlier
            return errorResponse(res, "Card not found after update.", 404, "NOT_FOUND_POST_UPDATE");
        }

        const cardResponseObject = {
            ...updatedCardFromDB,
            cardFrontElements: updatedCardFromDB.cardFrontElementIds || [],
            cardBackElements: updatedCardFromDB.cardBackElementIds || [],
            cardFrontElementIds: (updatedCardFromDB.cardFrontElementIds || []).map(el => el._id),
            cardBackElementIds: (updatedCardFromDB.cardBackElementIds || []).map(el => el._id),
        };

        successResponse(res, "Card details updated successfully.", cardResponseObject);
    } catch (error) {
        console.error("Error in updateCardDetails Controller:", error.message, error.stack);
        errorResponse(res, "Error updating card details.", 500, "UPDATE_CARD_FAILED", error.message);
    }
};

exports.deleteCard = async (req, res) => {
    console.log(`CARD_CONTROLLER: deleteCard called for cardId: ${req.params.cardId}`);
    try {
        const { cardId } = req.params;
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            return errorResponse(res, "Invalid Card ID format.", 400, "INVALID_ID_FORMAT");
        }

        const cardQuery = { _id: cardId };
        if (userId) cardQuery.userId = userId; else cardQuery.isGuestCard = true;
        
        const cardToDelete = await Card.findOne(cardQuery);
        if (!cardToDelete) {
            return errorResponse(res, "Card not found or not authorized to delete.", 404, "CARD_NOT_FOUND_OR_UNAUTHORIZED");
        }

        const elementIdsToDelete = [
            ...(cardToDelete.cardFrontElementIds || []),
            ...(cardToDelete.cardBackElementIds || [])
        ];

        if (elementIdsToDelete.length > 0) {
            // Ensure user also "owns" these elements, or they are guest elements associated with this card
            const elementQuery = { _id: { $in: elementIdsToDelete }, cardId: cardToDelete._id }; // scope to card
            if (userId) elementQuery.userId = userId; else elementQuery.isGuestElement = true;
            const deleteResult = await Element.deleteMany(elementQuery);
            console.log(`CARD_CONTROLLER: Deleted ${deleteResult.deletedCount} elements associated with card ${cardId}.`);
        }

        await Card.findByIdAndDelete(cardId);

        successResponse(res, `Card ${cardId} and its elements deleted successfully.`, { cardId });
    } catch (error) {
        console.error("Error in deleteCard Controller:", error.message, error.stack);
        errorResponse(res, "Error deleting card.", 500, "DELETE_CARD_FAILED", error.message);
    }
};

// --- Card Element Management ---
exports.addCardElement = async (req, res) => {
    console.log(`CARD_CONTROLLER: addCardElement for cardId: ${req.params.cardId}`);
    try {
        const { cardId } = req.params;
        const { isFrontElement, type, ...elementProps } = req.body; // isFrontElement must be boolean
        let userId = null;
        let isGuest = true; // Default to guest element behavior
        if (req.user && req.user.id) {
            userId = req.user.id;
        }

        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            return errorResponse(res, "Invalid Card ID.", 400, "INVALID_CARD_ID");
        }
        if (typeof isFrontElement !== 'boolean') {
            return errorResponse(res, "isFrontElement (true/false) is required in body.", 400, "MISSING_ISFRONT");
        }
        if (!type || !['text', 'image', 'shape'].includes(type)) {
            return errorResponse(res, `Invalid element type: ${type}.`, 400, "INVALID_ELEMENT_TYPE");
        }

        const cardQuery = { _id: cardId };
        if (userId) {
            cardQuery.userId = userId; // Logged-in user must own the card
            isGuest = false; // Element is not guest if card is owned
        } else {
            cardQuery.isGuestCard = true; // Guest can only add to a guest card
            isGuest = true;
        }
        const card = await Card.findOne(cardQuery);
        if (!card) {
            return errorResponse(res, "Card not found or not authorized.", 404, "CARD_NOT_FOUND_OR_UNAUTHORIZED");
        }

        const newElement = new Element({
            ...elementProps, type,
            cardId: card._id,
            boxId: card.boxId,
            userId: card.userId, // Inherit userId from the card (could be null if card is guest)
            isGuestElement: card.isGuestCard, // Element's guest status matches card's
            isFrontElement
        });
        const savedElement = await newElement.save();

        const arrayPath = getCardElementArrayPath(isFrontElement);
        await Card.findByIdAndUpdate(cardId, { $push: { [arrayPath]: savedElement._id } });

        // For response, populate the card fully
        const updatedCard = await Card.findById(cardId)
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .lean();
        
        const cardForResponse = {
            ...updatedCard,
            cardFrontElements: updatedCard.cardFrontElementIds || [],
            cardBackElements: updatedCard.cardBackElementIds || [],
            cardFrontElementIds: (updatedCard.cardFrontElementIds || []).map(el => el._id),
            cardBackElementIds: (updatedCard.cardBackElementIds || []).map(el => el._id),
        };

        successResponse(res, "Element added to card.", cardForResponse, 201);
    } catch (error) {
        console.error("Error adding card element:", error);
        errorResponse(res, "Failed to add element.", 500, "ADD_ELEMENT_FAILED", error.message);
    }
};


exports.updateCardElement = async (req, res) => {
    try {
        const { elementId } = req.params; // This is Element._id
        const updates = req.body;
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(elementId)) {
            return errorResponse(res, "Invalid Element ID.", 400, "INVALID_ELEMENT_ID");
        }
        if (Object.keys(updates).length === 0) {
            return errorResponse(res, "No update data provided.", 400, "NO_UPDATE_DATA");
        }
        
        // Remove fields that should not be updatable this way
        delete updates.cardId; delete updates.boxId; delete updates.userId;
        delete updates.isFrontElement; delete updates.isGuestElement;

        const elementQuery = { _id: elementId };
        if (userId) elementQuery.userId = userId; else elementQuery.isGuestElement = true;

        const updatedElement = await Element.findOneAndUpdate(elementQuery, { $set: updates }, { new: true, runValidators: true });

        if (!updatedElement) {
            return errorResponse(res, "Element not found or not authorized.", 404, "ELEMENT_NOT_FOUND_OR_UNAUTHORIZED");
        }
        
        // To provide context, fetch and return the parent Card with all elements populated
        const parentCard = await Card.findById(updatedElement.cardId)
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .lean();

        const cardForResponse = {
            ...parentCard,
            cardFrontElements: parentCard.cardFrontElementIds || [],
            cardBackElements: parentCard.cardBackElementIds || [],
            cardFrontElementIds: (parentCard.cardFrontElementIds || []).map(el => el._id),
            cardBackElementIds: (parentCard.cardBackElementIds || []).map(el => el._id),
        };
        successResponse(res, "Element updated.", cardForResponse);
    } catch (error) {
        errorResponse(res, "Failed to update element.", 500, "UPDATE_ELEMENT_FAILED", error.message);
    }
};


exports.deleteCardElement = async (req, res) => {
    console.log(`CARD_CONTROLLER: deleteCardElement for elementId: ${req.params.elementId}`);
    try {
        const { cardId, elementId } = req.params; // elementId is Element._id
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(cardId) || !mongoose.Types.ObjectId.isValid(elementId)) {
            return errorResponse(res, "Invalid Card or Element ID format.", 400, "INVALID_ID_FORMAT");
        }

        const elementQuery = { _id: elementId, cardId: cardId }; // Ensure element belongs to the card
        if (userId) elementQuery.userId = userId; else elementQuery.isGuestElement = true;
        
        const elementToDelete = await Element.findOne(elementQuery);
        if (!elementToDelete) {
            return errorResponse(res, "Element not found on this card or not authorized.", 404, "ELEMENT_NOT_FOUND_OR_UNAUTHORIZED");
        }

        // Determine which array to pull from in the Card document
        const elementIdArrayPath = elementToDelete.isFrontElement ? 'cardFrontElementIds' : 'cardBackElementIds';
        
        // Pull from Card's array
        await Card.findByIdAndUpdate(cardId, { $pull: { [elementIdArrayPath]: elementId } });
        
        // Delete the Element document
        await Element.findByIdAndDelete(elementId);

        successResponse(res, "Card element deleted successfully.", { elementId });
    } catch (error) {
        console.error("Error deleting card element:", error);
        errorResponse(res, "Failed to delete card element.", 500, "DELETE_CARD_ELEMENT_FAILED", error.message);
    }
};


exports.getCardById = async (req, res) => {
    console.log(`CARD_CONTROLLER: getCardById called for cardId: ${req.params.cardId}`);
    try {
        const { cardId } = req.params;
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            return errorResponse(res, "Invalid Card ID format.", 400, "INVALID_ID");
        }

        const cardQuery = { _id: cardId };
        if (userId) cardQuery.userId = userId; else cardQuery.isGuestCard = true;

        const cardFromDB = await Card.findOne(cardQuery)
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .lean();

        if (!cardFromDB) {
            return errorResponse(res, "Card not found or not authorized.", 404, "NOT_FOUND");
        }

        const cardResponseObject = {
            ...cardFromDB,
            cardFrontElements: cardFromDB.cardFrontElementIds || [],
            cardBackElements: cardFromDB.cardBackElementIds || [],
            cardFrontElementIds: (cardFromDB.cardFrontElementIds || []).map(element => element._id),
            cardBackElementIds: (cardFromDB.cardBackElementIds || []).map(element => element._id),
        };
        successResponse(res, "Card retrieved successfully.", cardResponseObject);
    } catch (error) {
        console.error("Error in getCardById Controller:", error.message, error.stack);
        errorResponse(res, "Error fetching card details.", 500, "FETCH_CARD_FAILED", error.message);
    }
};

exports.getAllCards = async (req, res) => { // Might be for admin or needs user scoping
    try {
        const query = {};
        if (req.user && req.user.id) query.userId = req.user.id; // Scope to user if logged in

        const cardsFromDB = await Card.find(query)
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .sort({ createdAt: -1 })
            .lean();
        
        const cardsForResponse = cardsFromDB.map(card => ({
            ...card,
            cardFrontElements: card.cardFrontElementIds || [],
            cardBackElements: card.cardBackElementIds || [],
            cardFrontElementIds: (card.cardFrontElementIds || []).map(el => el._id),
            cardBackElementIds: (card.cardBackElementIds || []).map(el => el._id),
        }));
        successResponse(res, 'Cards retrieved successfully', cardsForResponse);
    } catch (error) {
        console.error("Error in getAllCards:", error);
        errorResponse(res, 'Error fetching cards', 500, "FETCH_ALL_CARDS_FAILED", error.message);
    }
};

// Helper function (if not already global or imported)
const getElementArrayPath = (face) => {
    return face === 'back' ? 'cardBackElementIds' : 'cardFrontElementIds';
};


exports.generateCardWithAI = async (req, res) => {
    try {
        const {
            prompt,
            name = "AI Generated Card",
            aspectRatio = "1:1",
            outputFormat = "png"
        } = req.body;

        if (!prompt) {
            return res.status(400).json({ success:false, message: "Prompt is required." });
        }

        const base64ImageDataUriFromAI = await aiService.generateImageWithStabilityAI(
            prompt,
            outputFormat,
            aspectRatio
        );

        console.log("Controller: Received Data URI from AI Service (first 100):", base64ImageDataUriFromAI.substring(0, 100) + "...");

        let displayWidth = 512;
        let displayHeight = 512;
        if (aspectRatio === "16:9") { displayWidth = 768; displayHeight = 432;}
        else if (aspectRatio === "9:16") { displayWidth = 432; displayHeight = 768;}

        const backgroundElement = {
            elementId: uuidv4(), // *** ADDED elementId HERE ***
            type: 'image',
            imageUrl: base64ImageDataUriFromAI,
            x: 0,
            y: 0,
            width: displayWidth,
            height: displayHeight,
            zIndex: 0,
            rotation: 0
        };

        const newCard = new Card({
            name: name,
            promptUsed: prompt,
            cardArtUrl: base64ImageDataUriFromAI, // You might deprecate this if background is always an element
            widthPx: displayWidth,
            heightPx: displayHeight,
            elements: [backgroundElement], // Initial background image
            metadata: {
                aspectRatio: aspectRatio,
                outputFormat: base64ImageDataUriFromAI.match(/^data:image\/([a-z]+);/i)[1] || outputFormat,
                backgroundColor: '#FFFFFF'
            }
        });

        await newCard.save();
        // res.status(201).json({ message: "Card generated successfully!", card: newCard });
        res.status(201).json({ success:true, message: "Card generated successfully!", card: newCard, artUrl: newCard.cardArtUrl });

    } catch (error) {
        console.error("Error in generateCardWithAI Controller:", error.message);
        // Handle specific errors thrown by ai.service.js or other issues
        if (error.message.includes("Stability AI returned an empty image")) {
            return res.status(502).json({ success:false, message: "AI service reported an empty image.", details: error.message });
        } else if (error.message.includes("Stability AI API key")) {
            return res.status(500).json({ success:false, message: "AI service not configured.", details: error.message });
        } else if (error.message.includes("Stability AI")) { // Catches other Stability/Axios errors
            return res.status(502).json({ success:false, message: "AI image generation failed.", details: error.message });
        }
        // Generic fallback
        res.status(500).json({ success:false, message: error.message });
    }
};

// NEW FUNCTION to add an element
exports.addElementToCard = async (req, res) => {
    try {
        const { cardId } = req.params;
        const { type, ...elementProps } = req.body; // Element type and its properties

        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            return res.status(400).json({ success:false, message: 'Invalid Card ID format.' });
        }

        if (!type || !['text', 'image'].includes(type)) { // Add more types as you support them
            return res.status(400).json({ success:false, message: 'Invalid or missing element type.' });
        }

        const card = await Card.findById(cardId);
        if (!card) {
            return res.status(404).json({ success:false, message: 'Card not found.' });
        }

        const newElement = {
            elementId: uuidv4(), // Generate a unique ID for the new element
            type: type,
            ...elementProps, // Spread the rest of the properties from req.body
        };

        // Validate required fields based on type (optional, but good practice)
        if (type === 'text' && (typeof newElement.content === 'undefined')) {
            // newElement.content = ''; // Or return error:
            return res.status(400).json({ success:false, message: 'Text content is required for text element.'});
        }
        if (type === 'image' && !newElement.imageUrl) {
            return res.status(400).json({ success:false, message: 'Image URL is required for image element.'});
        }


        // Add the new element to the card's elements array
        // card.elements.push(newElement); // Mongoose < 7 might need this
        // await card.save();

        // More direct update using $push for Mongoose 7+ (and older versions)
        const updatedCard = await Card.findByIdAndUpdate(
            cardId,
            { $push: { elements: newElement }, $set: { updatedAt: Date.now() } },
            { new: true, runValidators: true } // new: true returns the modified document
        );

        if (!updatedCard) { // Should not happen if findById worked, but good check
            return res.status(404).json({ success:false, message: 'Card not found after update attempt.' });
        }

        successResponse(res, 'Element added successfully', updatedCard);

    } catch (error) {
        console.error("Error in addElementToCard:", error);
        if (error.name === 'ValidationError') {
            errorResponse(res, "Failed to add elements to card.", 400, "ADD_CARD_ELEMENT_VALIDATION_FAILED", error.message);
        }
        errorResponse(res, "Failed to add elements to card.", 500, "ADD_CARD_ELEMENT_VALIDATION_FAILED", error.message);
    }
};

exports.generateTextForCard = async (req, res) => {
    try {
        const userRawPrompt = req.body.prompt;

        if (!userRawPrompt || userRawPrompt.trim() === '') {
            return res.status(400).json({ success:false, message: "A prompt describing the desired card data is required." });
        }

        // Structure the prompt for the AI service
        const userPromptForService = `User Request: Generate dummy data for printable cards related to "${userRawPrompt}".\n\nData Items:`;

        const generatedText = await aiService.generateTextWithGemini(
            userPromptForService,
            undefined, // Use default model from ai.service.js (which reads from .env)
            CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION // Pass the universal system instruction
        );

        // Basic post-processing: trim whitespace.
        // More aggressive post-processing can be added if needed but good prompting is preferred.
        const cleanedText = generatedText.trim();

        res.status(200).json({
            success: true,
            message: "Dummy data generated successfully.",
            requestedTopic: userRawPrompt,
            // systemInstructionsUsed: CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION, // For debugging if needed
            generatedData: cleanedText,
        });

    } catch (error) {
        console.error("Error in generateTextForCard Controller:", error.message, error.stack);
        if (error.message.includes("Gemini API key not configured")) {
            return res.status(500).json({ message: "AI text service (Gemini) not configured." });
        } else if (error.message.includes("Gemini API Error") || error.message.includes("Gemini prompt blocked")) {
            return res.status(502).json({ message: "AI text generation failed.", details: error.message });
        }
        res.status(500).json({ message: "Error generating dummy card data.", error: error.message });
    }
};
