// src/controllers/box.controller.js
const Box = require('../models/Box.model');
const Card = require('../models/Card.model'); // Needed for deleting cards with box
const Element = require('../models/Element.model');
const aiService = require('../services/ai.service');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken'); // For optional token check
const User = require('../models/User.model'); // For optional token check
const RuleSet = require('../models/RuleSet.model');
const SystemSetting = require('../models/SystemSetting.model.js');

const { successResponse, errorResponse } = require('../utils/responseHandler');
const { 
    CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION, 
    CARD_TITLE_SYSTEM_INSTRUCTION, 
    ILLUSTRATION_IDEAS_SYSTEM_INSTRUCTION,
    DECORATIVE_BACKGROUND_PROMPT_ADDITION,
    DECORATIVE_ELEMENT_IDEAS_SYSTEM_INSTRUCTION
  } = require('../constants/aiPrompts');

// --- NEW HELPER FUNCTION for Parsing AI Rules ---
function parseRulesFromAiText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return [];
    }
    const rules = [];
    const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    for (let i = 0; i < lines.length; i++) {
        // A heading is a line that is NOT wrapped in parentheses.
        // The next line SHOULD be the description, wrapped in parentheses.
        if (!lines[i].startsWith('(') && !lines[i].endsWith(')')) {
            const heading = lines[i];
            if (i + 1 < lines.length && lines[i + 1].startsWith('(') && lines[i + 1].endsWith(')')) {
                // Remove parentheses and trim for the description
                const description = lines[i + 1].slice(1, -1).trim();
                rules.push({
                    heading: heading,
                    description: description,
                    status: 'enabled' // Default status
                });
                i++; // Increment i to skip the description line in the next iteration
            }
        }
    }
    return rules;
}


const DEFAULT_BACKEND_PLACEHOLDER_IMAGE_URL ="";

// Helper function to find the closest supported aspect ratio string
function getClosestSupportedAspectRatioOld(width, height, supportedRatios) {
    if (height === 0) return "1:1";
    const targetRatio = width / height;
    let closestRatioString = "1:1";
    let smallestDifference = Infinity;
    supportedRatios.forEach(ratioObj => {
        const difference = Math.abs(targetRatio - ratioObj.value);
        if (difference < smallestDifference) {
            smallestDifference = difference;
            closestRatioString = ratioObj.string;
        }
    });
    console.log(`Target ratio for image: ${targetRatio.toFixed(2)}, Chosen supported Stability AI ratio string: ${closestRatioString}`);
    return closestRatioString;
}

function getClosestSupportedAspectRatio(width, height, supportedRatios) {
    if (!width || !height || height === 0) return "1:1"; // Default for invalid inputs

    const targetRatioValue = width / height;
    
    // Use reduce to find the object with the smallest difference
    const closestRatio = supportedRatios.reduce((prev, curr) => {
        const prevDiff = Math.abs(prev.value - targetRatioValue);
        const currDiff = Math.abs(curr.value - targetRatioValue);
        return currDiff < prevDiff ? curr : prev;
    });
    
    console.log(`Target ratio: ${targetRatioValue.toFixed(2)}, Chosen supported Stability AI ratio string: ${closestRatio.string}`);
    return closestRatio.string;
}

// --- THE COMPLETE, MERGED, AND FINAL DECK GENERATION FUNCTION ---
exports.generateNewDeckAndBox = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Resilient Mode) started.");
    
    // Array to collect warnings for non-critical failures
    const generationWarnings = [];

    try {
        const {
            boxName,
            boxDescription = "",
            userPrompt,
            genre = "Educational",
            ruleSetId,
            accentColorHex = "#333333",
            defaultCardWidthPx = 315,
            defaultCardHeightPx = 440,
            imageOutputFormatForDeck = "png",
            numCardsInDeck = 1,
            fallbackBackgroundUri = null,
            fallbackCharacterUris = [],
            fallbackDecorativeUris = []
        } = req.body;

        let userId = null;
        let isGuest = true;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (user) {
                    userId = user._id;
                    isGuest = false;
                }
            } catch (err) {
                console.log('Optional token check failed, proceeding as guest:', err.message);
            }
        }

        if (!userPrompt) {
            return errorResponse(res, "A user prompt is required.", 400);
        }

        // --- PHASE 1: Text-Based AI Brainstorming (These are critical and will throw errors) ---
        let finalBoxName = boxName;
        const brainstormingPromises = [];
        const textListPromptForGemini = `Game Context:\nThe game is about: "${userPrompt}".\n\nUser Request:\nBased on the game context above, generate a list of ${numCardsInDeck} unique, concise problem-solving questions for game cards.`;
        brainstormingPromises.push(aiService.generateTextWithGemini(textListPromptForGemini, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION));
        
        if (!finalBoxName) {
            brainstormingPromises.push(aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION));
        } else {
            brainstormingPromises.push(Promise.resolve(null));
        }
        brainstormingPromises.push(aiService.generateTextWithGemini(userPrompt, undefined, DECORATIVE_ELEMENT_IDEAS_SYSTEM_INSTRUCTION));

        const [ textListData, generatedTitle, decorativeIdeasText ] = await Promise.all(brainstormingPromises);
        
        if (!finalBoxName && generatedTitle) {
            finalBoxName = generatedTitle.trim();
        } else if (!finalBoxName) {
            finalBoxName = "My Fun Game";
        }

        let textItemsArray = (textListData || '').split('\n').map(item => item.trim()).filter(Boolean);
        while (textItemsArray.length < numCardsInDeck) { textItemsArray.push(`[Problem ${textItemsArray.length + 1}]`); }
        
        const decorativeIdeas = decorativeIdeasText ? decorativeIdeasText.split(',').map(s => s.trim()).filter(Boolean) : [];
        const supportedRatios = [{ string: "2:3", value: 2/3 }, { string: "3:2", value: 3/2 }, { string: "1:1", value: 1/1 }];
        const finalAspectRatioForAI = getClosestSupportedAspectRatio(defaultCardWidthPx, defaultCardHeightPx, supportedRatios);

        // --- PHASE 2: Image Generation (These are non-critical and will add warnings) ---
        let sharedBackgroundUri = fallbackBackgroundUri;
        let initialDecorativeUris = fallbackDecorativeUris;
        const canUseStabilityAI = !!process.env.STABILITY_API_KEY;
        const canUseBgRemoval = !!process.env.PIXIAN_API_KEY;

        if (canUseStabilityAI) {
            if (!sharedBackgroundUri) {
                const backgroundPrompt = `A simple, clean, vibrant, colorful gradient background for a children's flashcard about "${userPrompt}".`;
                const backgroundResult = await aiService.generateImageWithStabilityAI(backgroundPrompt, imageOutputFormatForDeck, finalAspectRatioForAI);
                if (backgroundResult.success) {
                    sharedBackgroundUri = backgroundResult.data;
                } else {
                    generationWarnings.push(backgroundResult.error);
                }
            }

            if (initialDecorativeUris.length === 0 && decorativeIdeas.length > 0) {
                const decorativePromises = decorativeIdeas.map(idea => aiService.generateImageWithStabilityAI(`A single, cute, small cartoon ${idea}, sticker style.`, 'png', '1:1'));
                const decorativeResults = await Promise.all(decorativePromises);
                decorativeResults.forEach(result => {
                    if (result.success) {
                        initialDecorativeUris.push(result.data);
                    } else {
                        generationWarnings.push(result.error);
                    }
                });
            }
        }
        
        let refinedDecorativeUris = [];
        if (canUseBgRemoval && initialDecorativeUris.length > 0) {
            const bgRemovalPromises = initialDecorativeUris.map(uri => aiService.removeBackgroundWithPixian(Buffer.from(uri.split(',')[1], 'base64')));
            refinedDecorativeUris = (await Promise.all(bgRemovalPromises)).filter(Boolean);
            if (refinedDecorativeUris.length === 0) {
                refinedDecorativeUris = initialDecorativeUris;
            }
        } else {
            refinedDecorativeUris = initialDecorativeUris;
        }

        // --- PHASE 3: Database Assembly ---
        const newBoxData = {
            name: finalBoxName, description: boxDescription, userId, isGuestBox: isGuest,
            defaultCardWidthPx, defaultCardHeightPx,
            baseAISettings: { userPrompt, genre, accentColorHex, imageAspectRatio: finalAspectRatioForAI, imageOutputFormat: imageOutputFormatForDeck }
        };
        const savedBox = await new Box(newBoxData).save();
        console.log("BOX_CONTROLLER: Box saved, ID:", savedBox._id);

        const generatedCardsDataForResponse = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            const individualCardText = textItemsArray[i];
            let initialCharUris = i < fallbackCharacterUris.length ? [fallbackCharacterUris[i]] : [];
            
            if (canUseStabilityAI && initialCharUris.length === 0) {
                const charIdeasText = await aiService.generateTextWithGemini(`Text: "${individualCardText}"`, undefined, ILLUSTRATION_IDEAS_SYSTEM_INSTRUCTION);
                const charIdeas = charIdeasText ? charIdeasText.split(',').map(s => s.trim()).filter(Boolean) : [];
                if (charIdeas.length > 0) {
                    const initialCharPromises = charIdeas.slice(0, 2).map(idea => aiService.generateImageWithStabilityAI(`Cute cartoon illustration of ${idea}, for a children's game.`, 'png', '1:1'));
                    const initialCharResults = await Promise.all(initialCharPromises);
                    initialCharResults.forEach(result => {
                        if (result.success) {
                            initialCharUris.push(result.data);
                        } else {
                            generationWarnings.push(result.error);
                        }
                    });
                }
            }

            let refinedCharacterUris = [];
            if(canUseBgRemoval && initialCharUris.length > 0){
                const charBgRemovalPromises = initialCharUris.map(uri => aiService.removeBackgroundWithPixian(Buffer.from(uri.split(',')[1], 'base64')));
                refinedCharacterUris = (await Promise.all(charBgRemovalPromises)).filter(Boolean);
                if (refinedCharacterUris.length === 0) {
                    refinedCharacterUris = initialCharUris;
                }
            } else {
                refinedCharacterUris = initialCharUris;
            }
            
            const tempCardId = new mongoose.Types.ObjectId();
            const cardFrontElementDocsData = [];
            
            if (sharedBackgroundUri) { cardFrontElementDocsData.push({ type: 'image', imageUrl: sharedBackgroundUri, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx }); }
            
            refinedDecorativeUris.forEach(uri => {
                for (let j = 0; j < 4; j++) {
                    const decorativeSize = Math.random() * 15 + 15;
                    cardFrontElementDocsData.push({ type: 'image', imageUrl: uri, zIndex: 1, x: Math.random() * (defaultCardWidthPx - decorativeSize), y: Math.random() * (defaultCardHeightPx - decorativeSize), width: decorativeSize, height: decorativeSize, rotation: Math.random() * 360 });
                }
            });

            const charSize = defaultCardWidthPx * 0.4;
            if (refinedCharacterUris[0]) cardFrontElementDocsData.push({ type: 'image', imageUrl: refinedCharacterUris[0], zIndex: 2, x: 20, y: defaultCardHeightPx - charSize - 20, width: charSize, height: charSize });
            if (refinedCharacterUris[1]) cardFrontElementDocsData.push({ type: 'image', imageUrl: refinedCharacterUris[1], zIndex: 2, x: defaultCardWidthPx - charSize - 20, y: defaultCardHeightPx - charSize - 20, width: charSize, height: charSize });

            const questionBoxHeight = 100;
            cardFrontElementDocsData.push({ type: 'shape', shapeType: 'rectangle', zIndex: 3, x: 40, y: 150, width: defaultCardWidthPx - 80, height: questionBoxHeight, fillColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 20 });
            cardFrontElementDocsData.push({ type: 'text', content: finalBoxName, zIndex: 4, x: 0, y: 40, width: defaultCardWidthPx, height: 60, color: '#5C3A92', textAlign: 'center', fontSize: "35px", fontFamily: "Arial Rounded MT Bold, sans-serif", fontWeight: 'bold' });
            cardFrontElementDocsData.push({ type: 'text', content: individualCardText, zIndex: 4, x: 50, y: 155, width: defaultCardWidthPx - 100, height: questionBoxHeight - 10, color: '#333333', textAlign: 'center', fontSize: "20px", fontFamily: "Arial, sans-serif" });

            const elementsToCreate = cardFrontElementDocsData.map(el => ({ ...el, cardId: tempCardId, boxId: savedBox._id, isGuestElement: isGuest, userId: userId, isFrontElement: true }));
            const savedFrontElements = await Element.insertMany(elementsToCreate);

            const cardToSave = new Card({ _id: tempCardId, name: `${finalBoxName} - Card ${i + 1}`, boxId: savedBox._id, userId: userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, cardFrontElementIds: savedFrontElements.map(el => el._id), cardBackElementIds: [] });
            const savedCard = await cardToSave.save();
            const cardForResponse = savedCard.toObject();
            cardForResponse.cardFrontElements = savedFrontElements.map(el => el.toObject());
            generatedCardsDataForResponse.push(cardForResponse);
        }

        // --- PHASE 4: Construct and Send Final Response ---
        const boxResponseObject = savedBox.toObject();
        boxResponseObject.cards = generatedCardsDataForResponse;
        
        // Add the warnings to the response metadata if any exist, removing duplicates.
        const metadata = generationWarnings.length > 0 ? { warnings: [...new Set(generationWarnings)] } : null;

        const successMessage = `Box '${savedBox.name}' and ${generatedCardsDataForResponse.length} cards created.`;
        
        successResponse(res, successMessage, { box: boxResponseObject }, 201, metadata);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
    console.log("CONTROLLER: generateNewDeckAndBox finished.");
};

// --- THE COMPLETE, FINAL, ROBUST-FALLBACK DECK GENERATION FUNCTION ---
exports.generateNewDeckAndBoxOld = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Robust Fallback Strategy) started.");
    try {
        const {
            boxName, boxDescription = "", userPrompt, genre = "Educational",
            accentColorHex = "#333333", defaultCardWidthPx = 315,
            defaultCardHeightPx = 440, imageAspectRatioForDeck = null,
            imageOutputFormatForDeck = "png", numCardsInDeck = 1,
            fallbackBackgroundUri = null,
            fallbackCharacterUris = [],
            fallbackDecorativeUris = []
        } = req.body;


        let userId = null;
        let isGuest = true;
        let token;
        // THIS IS A MANUAL AUTHENTICATION CHECK
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (user) {
                    userId = user._id;
                    isGuest = false; // <-- This line SHOULD run for an auth'd user
                }
            } catch (err) {
                // If an error happens (e.g., expired token), it proceeds as a guest
                console.log('Optional token check failed, proceeding as guest:', err.message);
            }
        }

        // const userId = req.user ? req.user.id : null;
        // const isGuest = !userId;
        const canUseStabilityAI = !!process.env.STABILITY_API_KEY;
        const canUseBgRemoval = !!process.env.PIXIAN_API_KEY && !!process.env.PIXIAN_API_SECRET;

        if (!boxName || !userPrompt) { return errorResponse(res, "Box name and prompt are required.", 400); }

        // --- PHASE 1: AI BRAINSTORMING ---
        const textListPrompt = `Generate a list of ${numCardsInDeck} unique, concise questions about: "${userPrompt}".`;
        const sharedPromises = [
            aiService.generateTextWithGemini(textListPrompt, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION),
            aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION),
            aiService.generateTextWithGemini(userPrompt, undefined, DECORATIVE_ELEMENT_IDEAS_SYSTEM_INSTRUCTION)
        ];
        const [ textListData, title, decorativeIdeasText ] = await Promise.all(sharedPromises);
        let textItemsArray = (textListData || '').split('\n').map(item => item.trim()).filter(Boolean);
        while (textItemsArray.length < numCardsInDeck) { textItemsArray.push(`[Problem ${textItemsArray.length + 1}]`); }
        const cardTitle = title.trim() || "Fun Adventure";
        const decorativeIdeas = decorativeIdeasText.split(',').map(s => s.trim()).filter(Boolean);
        
        const supportedRatios = [{ string: "2:3", value: 2/3 }, { string: "3:2", value: 3/2 }, { string: "1:1", value: 1/1 }];
        const finalAspectRatioForAI = getClosestSupportedAspectRatio(defaultCardWidthPx, defaultCardHeightPx, supportedRatios);

        // --- PHASE 2: GATHER & REFINE SHARED ELEMENTS ---
        let sharedBackgroundUri = fallbackBackgroundUri;
        let initialDecorativeUris = fallbackDecorativeUris;

        if (canUseStabilityAI) {
            if (!sharedBackgroundUri) {
                const backgroundPrompt = `A simple, clean, vibrant, colorful gradient background for a children's flashcard about "${userPrompt}". No objects, no text, no patterns.`;
                sharedBackgroundUri = await aiService.generateImageWithStabilityAI(backgroundPrompt, imageOutputFormatForDeck, finalAspectRatioForAI);
            }
            if (initialDecorativeUris.length === 0) {
                const decorativePromises = decorativeIdeas.map(idea => aiService.generateImageWithStabilityAI(`A single, cute, small cartoon ${idea}, sticker style.`, 'png', '1:1').catch(e => null));
                initialDecorativeUris = await Promise.all(decorativePromises);
            }
        }
        
        let refinedDecorativeUris = [];
        if (canUseBgRemoval && initialDecorativeUris.length > 0) {
            console.log("Refining decorative element images...");
            const bgRemovalPromises = initialDecorativeUris.filter(Boolean).map(uri => aiService.removeBackgroundWithPixian(Buffer.from(uri.split(',')[1], 'base64')));
            refinedDecorativeUris = await Promise.all(bgRemovalPromises);
            // --- FIX IS HERE: If refinement failed, fall back to the unrefined images ---
            if (refinedDecorativeUris.every(uri => uri === null)) {
                console.warn("Background removal for all decorative elements failed. Using original images as fallback.");
                refinedDecorativeUris = initialDecorativeUris;
            }
        } else {
            refinedDecorativeUris = initialDecorativeUris;
        }

        // --- PHASE 3: DATABASE ASSEMBLY ---
        const newBoxData = {
            name: boxName.trim(), description: boxDescription, userId: userId, isGuestBox: isGuest,
            defaultCardWidthPx: defaultCardWidthPx, defaultCardHeightPx: defaultCardHeightPx,
            baseAISettings: { userPrompt, genre, accentColorHex, imageAspectRatio: finalAspectRatioForAI, imageOutputFormat: imageOutputFormatForDeck }
        };
        const savedBox = await new Box(newBoxData).save();
        console.log("BOX_CONTROLLER: Box saved, ID:", savedBox._id);

        const generatedCardsDataForResponse = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            const individualCardText = textItemsArray[i];
            let initialCharUris = fallbackCharacterUris;
            
            if (canUseStabilityAI && initialCharUris.length === 0) {
                const charIdeasText = await aiService.generateTextWithGemini(`Text: "${individualCardText}"`, undefined, ILLUSTRATION_IDEAS_SYSTEM_INSTRUCTION);
                const charIdeas = charIdeasText.split(',').map(s => s.trim()).filter(Boolean);
                const initialCharPromises = charIdeas.map(idea => aiService.generateImageWithStabilityAI(`Cute cartoon illustration of ${idea}, for a children's game.`, 'png', '1:1').catch(e => null));
                initialCharUris = await Promise.all(initialCharPromises);
            }

            let refinedCharacterUris = [];
            if(canUseBgRemoval && initialCharUris.length > 0){
                const charBgRemovalPromises = initialCharUris.filter(Boolean).map(uri => aiService.removeBackgroundWithPixian(Buffer.from(uri.split(',')[1], 'base64')));
                refinedCharacterUris = await Promise.all(charBgRemovalPromises);
                // --- FIX IS HERE: If refinement failed, fall back to the unrefined images ---
                if (refinedCharacterUris.every(uri => uri === null)) {
                    console.warn(`Background removal for all characters on Card ${i+1} failed. Using original images as fallback.`);
                    refinedCharacterUris = initialCharUris;
                }
            } else {
                refinedCharacterUris = initialCharUris;
            }
            
            const tempCardId = new mongoose.Types.ObjectId();
            const cardFrontElementDocsData = [];
            
            if (sharedBackgroundUri) { cardFrontElementDocsData.push({ type: 'image', imageUrl: sharedBackgroundUri, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx }); }
            
            const copiesPerDecorativeItem = 4;
            refinedDecorativeUris.filter(Boolean).forEach(uri => {
                for (let j = 0; j < copiesPerDecorativeItem; j++) {
                    const decorativeSize = Math.random() * 15 + 15;
                    cardFrontElementDocsData.push({ type: 'image', imageUrl: uri, zIndex: 1, x: Math.random() * (defaultCardWidthPx - decorativeSize), y: Math.random() * (defaultCardHeightPx - decorativeSize), width: decorativeSize, height: decorativeSize, rotation: Math.random() * 360 });
                }
            });

            const charSize = defaultCardWidthPx * 0.4;
            // This logic is now simpler, as refinedCharacterUris will always hold the correct images (refined or fallback)
            if (refinedCharacterUris[0]) cardFrontElementDocsData.push({ type: 'image', imageUrl: refinedCharacterUris[0], zIndex: 2, x: 20, y: defaultCardHeightPx - charSize - 20, width: charSize, height: charSize });
            if (refinedCharacterUris[1]) cardFrontElementDocsData.push({ type: 'image', imageUrl: refinedCharacterUris[1], zIndex: 2, x: defaultCardWidthPx - charSize - 20, y: defaultCardHeightPx - charSize - 20, width: charSize, height: charSize });

            const questionBoxHeight = 100;
            cardFrontElementDocsData.push({ type: 'shape', shapeType: 'rectangle', zIndex: 3, x: 40, y: 150, width: defaultCardWidthPx - 80, height: questionBoxHeight, fillColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 20 });
            cardFrontElementDocsData.push({ type: 'text', content: cardTitle, zIndex: 4, x: 0, y: 40, width: defaultCardWidthPx, height: 60, color: '#5C3A92', textAlign: 'center', fontSize: "35px", fontFamily: "Arial Rounded MT Bold, Comic Sans MS, cursive, sans-serif", fontWeight: 'bold' });
            cardFrontElementDocsData.push({ type: 'text', content: individualCardText, zIndex: 4, x: 50, y: 155, width: defaultCardWidthPx - 100, height: questionBoxHeight - 10, color: '#333333', textAlign: 'center', fontSize: "20px", fontFamily: "Arial, sans-serif" });

            const elementsToCreate = cardFrontElementDocsData.map(el => ({ ...el, cardId: tempCardId, boxId: savedBox._id, isGuestElement: isGuest, userId: userId, isFrontElement: true }));
            const savedFrontElements = await Element.insertMany(elementsToCreate);

            const cardToSave = new Card({ _id: tempCardId, name: `${savedBox.name} - Card ${i + 1}`, boxId: savedBox._id, userId: userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, cardFrontElementIds: savedFrontElements.map(el => el._id), cardBackElementIds: [] });
            const savedCard = await cardToSave.save();
            const cardForResponse = savedCard.toObject();
            cardForResponse.cardFrontElements = savedFrontElements.map(el => el.toObject());
            generatedCardsDataForResponse.push(cardForResponse);
        }

        const boxResponseObject = savedBox.toObject();
        boxResponseObject.cards = generatedCardsDataForResponse;
        successResponse(res, `Box "${savedBox.name}" and ${generatedCardsDataForResponse.length} cards created with refined, editable layers.`, { box: boxResponseObject }, 201);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
    console.log("CONTROLLER: generateNewDeckAndBox finished.");
};

exports.claimBox = async (req, res) => {
    const { boxId } = req.params;
    const userId = req.user.id; // From protect middleware

    try {
        const box = await Box.findById(boxId);
        if (!box) return errorResponse(res, 'Box not found.', 404, "BOX_NOT_FOUND");
        if (box.userId && box.userId.toString() !== userId.toString()) {
            return errorResponse(res, 'This box is already owned by another user.', 403, "BOX_OWNED_BY_OTHER");
        }
        if (box.userId && !box.isGuestBox) {
             return successResponse(res, 'Box already associated with your account.', {box});
        }

        box.userId = userId;
        box.isGuestBox = false;
        await box.save();

        const cardsInBox = await Card.find({ boxId: box._id });
        const cardIds = cardsInBox.map(c => c._id);

        await Card.updateMany(
            { _id: { $in: cardIds }, isGuestCard: true },
            { $set: { userId: userId, isGuestCard: false } }
        );
        await Element.updateMany(
            { boxId: box._id, isGuestElement: true }, // Elements directly on box OR on cards in this box
            { $set: { userId: userId, isGuestElement: false } }
        );

         // --- NEW: 3. Claim the associated RuleSet ---
        if (box.ruleSetId) {
            const ruleSetClaimResult = await RuleSet.findOneAndUpdate(
                { _id: box.ruleSetId, isGuestRuleSet: true }, // Find the linked guest ruleset
                { $set: { userId: userId, isGuestRuleSet: false } } // Claim it
            );
            if (ruleSetClaimResult) {
                console.log(`Successfully claimed associated RuleSet ID: ${box.ruleSetId}`);
            } else {
                console.log(`Note: RuleSet ID ${box.ruleSetId} was already claimed or does not exist.`);
            }
        }
        
        // Refetch data to return fully populated and updated structures
        const updatedBox = await Box.findById(boxId).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        const updatedCards = await Card.find({ boxId: boxId }).populate('cardFrontElementIds').populate('cardBackElementIds').lean();
        
        const populatedCards = updatedCards.map(card => ({
            ...card,
            cardFrontElements: card.cardFrontElementIds || [],
            cardBackElements: card.cardBackElementIds || [],
            cardFrontElementIds: (card.cardFrontElementIds || []).map(el => el._id),
            cardBackElementIds: (card.cardBackElementIds || []).map(el => el._id)
        }));
        const populatedBox = {
            ...updatedBox,
            boxFrontElements: updatedBox.boxFrontElementIds || [],
            boxBackElements: updatedBox.boxBackElementIds || [],
            boxFrontElementIds: (updatedBox.boxFrontElementIds || []).map(el => el._id),
            boxBackElementIds: (updatedBox.boxBackElementIds || []).map(el => el._id)
        };

        successResponse(res, 'Box, cards, and elements successfully claimed.', { box: populatedBox, cards: populatedCards });
    } catch (error) {
        errorResponse(res, 'Server error while claiming box.', 500, "CLAIM_BOX_FAILED", error.message);
    }
};


exports.createBox = async (req, res) => {
    try {
        const { name, description, defaultCardWidthPx, defaultCardHeightPx } = req.body;
        let userId = null;
        let isGuest = true;
        if (req.user && req.user.id) { userId = req.user.id; isGuest = false; }

        if (!name) return errorResponse(res, "Box name is required.", 400);

        const newBox = new Box({
            name, description, userId, isGuestBox: isGuest,
            defaultCardWidthPx, defaultCardHeightPx
        });
        const savedBox = await newBox.save();
        successResponse(res, "Box created successfully.", savedBox, 201);
    } catch (error) {
        errorResponse(res, "Failed to create box.", 500, "BOX_CREATION_FAILED", error.message);
    }
};

exports.getUserBoxes = async (req, res) => {
    try {
        if (!req.user || !req.user.id) return errorResponse(res, "User not authenticated.", 401);
        const userId = req.user.id;

        const boxesFromDB = await Box.find({ userId }) // Only user's boxes
            .populate('boxFrontElementIds')
            .populate('boxBackElementIds')
            .sort({ updatedAt: -1 })
            .lean();

        const boxesForResponse = boxesFromDB.map(box => ({
            ...box,
            boxFrontElements: box.boxFrontElementIds || [],
            boxBackElements: box.boxBackElementIds || [],
            boxFrontElementIds: (box.boxFrontElementIds || []).map(el => el._id),
            boxBackElementIds: (box.boxBackElementIds || []).map(el => el._id),
        }));
        successResponse(res, "User boxes retrieved successfully.", boxesForResponse);
    } catch (error) {
        errorResponse(res, "Failed to retrieve user boxes.", 500, "FETCH_BOXES_FAILED", error.message);
    }
};

exports.exportBoxAsJson = async (req, res) => {
    console.log(`BOX_CONTROLLER: exportBoxAsJson called for boxId: ${req.params.boxId}`);
    try {
        const { boxId } = req.params;
        const userId = req.user.id; // From protect middleware, user must be authenticated

        if (!mongoose.Types.ObjectId.isValid(boxId)) {
            return errorResponse(res, "Invalid Box ID format.", 400, "INVALID_ID");
        }

        // 1. Fetch the Box and populate its own elements
        // We use .lean() for performance as we're just sending data.
        const box = await Box.findOne({ _id: boxId, userId: userId })
            .populate('boxFrontElementIds') // Populate with full Element documents
            .populate('boxBackElementIds')  // Populate with full Element documents
            .lean();

        if (!box) {
            return errorResponse(res, "Box not found or you are not authorized to export it.", 404, "NOT_FOUND_OR_UNAUTHORIZED");
        }

        // 2. Fetch all Cards for this Box, and populate their Elements
        const cards = await Card.find({ boxId: box._id, userId: userId }) // Ensure cards also belong to the user
            .populate('cardFrontElementIds') // Populate with full Element documents
            .populate('cardBackElementIds')  // Populate with full Element documents
            .sort({ orderInBox: 1 })
            .lean();

        // 3. Structure the data for JSON response
        // The .lean() and .populate() calls have already given us most of what we need.
        // We just need to ensure the arrays of element objects are named consistently
        // if the frontend expects `boxFrontElements` and `cardFrontElements` etc.

        const boxForExport = {
            ...box,
            // Rename populated ID arrays to the arrays of full element objects
            boxFrontElements: box.boxFrontElementIds || [],
            boxBackElements: box.boxBackElementIds || [],
            // Optionally, remove the ID-only arrays if they are redundant for export
            // delete box.boxFrontElementIds;
            // delete box.boxBackElementIds;
        };

        const cardsForExport = cards.map(card => {
            const cardObject = { ...card };
            cardObject.cardFrontElements = card.cardFrontElementIds || [];
            cardObject.cardBackElements = card.cardBackElementIds || [];
            // Optionally remove ID-only arrays from cards too
            // delete cardObject.cardFrontElementIds;
            // delete cardObject.cardBackElementIds;
            return cardObject;
        });

        const exportData = {
            box: boxForExport,
            cards: cardsForExport
        };

        // 4. Send JSON response
        // The successResponse helper will handle sending this as JSON.
        // No need for Content-Disposition headers for a JSON API response.
        // If the frontend wants to trigger a download of this JSON, it can do so.
        successResponse(res, "Box data exported successfully as JSON.", exportData);

    } catch (error) {
        console.error("Error in exportBoxAsJson Controller:", error.message, error.stack);
        errorResponse(res, "Error exporting box data.", 500, "JSON_EXPORT_FAILED", error.message);
    }
};

exports.getBoxById = async (req, res) => {
    console.log(`BOX_CONTROLLER: getBoxById called for boxId: ${req.params.boxId}`);
    try {
        const { boxId } = req.params;
        let currentUserId = null; // Assume guest initially
        let isAuthenticated = false;

        // Optional token check to determine if a user is logged in
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken'); // require if not at top
                const User = require('../models/User.model'); // require if not at top

                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id).lean();
                if (user) {
                    currentUserId = user._id.toString();
                    isAuthenticated = true;
                }
            } catch (err) {
                // Token invalid or expired, proceed as guest for public access
                console.log('Optional token check failed for getBoxById, proceeding as guest-can-view:', err.message);
            }
        }

        if (!mongoose.Types.ObjectId.isValid(boxId)) {
            return errorResponse(res, "Invalid Box ID format.", 400, "INVALID_ID");
        }

        const boxFromDB = await Box.findById(boxId)
            .populate('boxFrontElementIds')
            .populate('boxBackElementIds')
            .lean();

        if (!boxFromDB) {
            return errorResponse(res, "Box not found.", 404, "NOT_FOUND");
        }

        // Authorization Logic:
        if (!boxFromDB.isGuestBox) { // If the box is NOT a guest box (i.e., it has an owner or should have one)
            if (!isAuthenticated) {
                return errorResponse(res, "Not authorized to view this box (login required).", 401, "AUTH_REQUIRED");
            }
            if (boxFromDB.userId && boxFromDB.userId.toString() !== currentUserId) {
                return errorResponse(res, "Not authorized to view this box (ownership mismatch).", 403, "UNAUTHORIZED_ACCESS");
            }
            // If boxFromDB.userId is null but isGuestBox is false, it implies an inconsistent state,
            // but for safety, if authenticated and userId doesn't match, deny.
        }
        // If it's a guest box (boxFromDB.isGuestBox is true), anyone can view it.
        // If the user is authenticated and it's a guest box, they can still view it.

        console.log(`BOX_CONTROLLER: Found box ${boxId}. Populating its cards and their elements...`);

        const cardQuery = { boxId: boxFromDB._id };
        // If the box is owned, only show cards owned by that user (or guest cards if box was just claimed)
        // If the box is guest, only show guest cards
        if (boxFromDB.userId) {
            cardQuery.userId = boxFromDB.userId;
        } else {
            cardQuery.isGuestCard = true;
        }

        const cardsFromDB = await Card.find(cardQuery)
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .sort({ orderInBox: 1 })
            .lean();
        
        const cardsForResponse = cardsFromDB.map(card => {
            const responseCard = { ...card };
            responseCard.cardFrontElements = card.cardFrontElementIds || [];
            responseCard.cardBackElements = card.cardBackElementIds || [];
            responseCard.cardFrontElementIds = (card.cardFrontElementIds || []).map(element => element._id);
            responseCard.cardBackElementIds = (card.cardBackElementIds || []).map(element => element._id);
            return responseCard;
        });

        const boxResponseObject = { ...boxFromDB };
        boxResponseObject.boxFrontElements = boxFromDB.boxFrontElementIds || [];
        boxResponseObject.boxBackElements = boxFromDB.boxBackElementIds || [];
        boxResponseObject.boxFrontElementIds = (boxFromDB.boxFrontElementIds || []).map(element => element._id);
        boxResponseObject.boxBackElementIds = (boxFromDB.boxBackElementIds || []).map(element => element._id);
        boxResponseObject.cards = cardsForResponse;

        successResponse(res, "Box details retrieved successfully.", boxResponseObject);

    } catch (error) {
        console.error("Error in getBoxById Controller:", error.message, error.stack);
        errorResponse(res, "Error fetching box details.", 500, "FETCH_BOX_FAILED", error.message);
    }
};

exports.updateBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const updates = req.body; // name, description, defaults, baseAISettings
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(boxId)) {
            return errorResponse(res, "Invalid Box ID format.", 400);
        }
        if (Object.keys(updates).length === 0) {
            return errorResponse(res, "No update fields provided.", 400);
        }
        // Sanitize updates - prevent changing userId or isGuestBox directly here
        delete updates.userId; delete updates.isGuestBox;
        delete updates.cards; // Cards are managed separately

        updates.updatedAt = Date.now();

        const boxQuery = { _id: boxId };
        if (userId) boxQuery.userId = userId; else boxQuery.isGuestBox = true;

        const updatedBox = await Box.findOneAndUpdate(boxQuery, { $set: updates }, { new: true, runValidators: true })
            .populate('boxFrontElementIds').populate('boxBackElementIds').lean();

        if (!updatedBox) {
            return errorResponse(res, "Box not found or not authorized to update.", 404);
        }
        
        const boxResponseObject = {...updatedBox};
        boxResponseObject.boxFrontElements = updatedBox.boxFrontElementIds || [];
        boxResponseObject.boxBackElements = updatedBox.boxBackElementIds || [];
        boxResponseObject.boxFrontElementIds = (updatedBox.boxFrontElementIds || []).map(el => el._id);
        boxResponseObject.boxBackElementIds = (updatedBox.boxBackElementIds || []).map(el => el._id);

        successResponse(res, "Box updated successfully.", boxResponseObject);
    } catch (error) {
        errorResponse(res, "Error updating box.", 500, "BOX_UPDATE_FAILED", error.message);
    }
};

exports.deleteBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(boxId)) {
            return errorResponse(res, "Invalid Box ID format.", 400);
        }

        const boxQuery = { _id: boxId };
        if (userId) boxQuery.userId = userId; else boxQuery.isGuestBox = true;

        const boxToDelete = await Box.findOne(boxQuery);
        if (!boxToDelete) return errorResponse(res, "Box not found or not authorized.", 404);

        // 1. Find all cards in the box
        const cardsInBox = await Card.find({ boxId: boxToDelete._id });
        const cardIdsInBox = cardsInBox.map(c => c._id);

        // 2. Collect all element IDs from cards in the box and from the box itself
        let allElementIdsToDelete = [
            ...(boxToDelete.boxFrontElementIds || []),
            ...(boxToDelete.boxBackElementIds || [])
        ];
        cardsInBox.forEach(card => {
            allElementIdsToDelete.push(...(card.cardFrontElementIds || []));
            allElementIdsToDelete.push(...(card.cardBackElementIds || []));
        });
        allElementIdsToDelete = [...new Set(allElementIdsToDelete.map(id => id.toString()))]; // Unique IDs

        // 3. Delete all collected elements
        if (allElementIdsToDelete.length > 0) {
            const elementQueryDel = { _id: { $in: allElementIdsToDelete } };
            if (userId) elementQueryDel.userId = userId; else elementQueryDel.isGuestElement = true;
            await Element.deleteMany(elementQueryDel);
        }

        // 4. Delete all cards in the box
        if (cardIdsInBox.length > 0) {
            const cardQueryDel = { _id: { $in: cardIdsInBox } };
            if (userId) cardQueryDel.userId = userId; else cardQueryDel.isGuestCard = true;
            await Card.deleteMany(cardQueryDel);
        }

        // 5. Delete the box itself
        await Box.findByIdAndDelete(boxId);

        successResponse(res, "Box, associated cards, and elements deleted successfully.", { boxId });
    } catch (error) {
        errorResponse(res, "Error deleting box and its contents.", 500, "BOX_DELETE_CASCADE_FAILED", error.message);
    }
};
// TODO: addBoxElement, updateBoxElement, deleteBoxElement (for box art)
// These would modify box.boxFrontElements or box.boxBackElements
// Similar to how card elements are managed, but on the Box model.
// Helper function to get the correct element array path for Box elements
const getBoxElementArrayPath = (face) => {
    return face === 'back' ? 'boxBackElementIds' : 'boxFrontElementIds';
};

// --- Box Element Management ---
exports.addBoxElement = async (req, res) => {
    try {
        const { boxId } = req.params;
        const { isFrontElement, type, ...elementProps } = req.body;
        let userId = null;
        let isGuest = true;
        if (req.user && req.user.id) { userId = req.user.id; }

        if (!mongoose.Types.ObjectId.isValid(boxId)) return errorResponse(res, 'Invalid Box ID.', 400);
        if (typeof isFrontElement !== 'boolean') return errorResponse(res, "isFrontElement (true/false) is required.", 400);
        if (!type || !['text', 'image', 'shape'].includes(type)) return errorResponse(res, 'Invalid element type.', 400);

        const boxQuery = { _id: boxId };
        if (userId) boxQuery.userId = userId; else boxQuery.isGuestBox = true;
        const box = await Box.findOne(boxQuery);
        if (!box) return errorResponse(res, "Box not found or not authorized.", 404);

        if (box.userId) isGuest = false; // If box is owned, element is not guest

        const newElement = new Element({
            ...elementProps, type,
            boxId: box._id,
            cardId: null, // Explicitly null for box elements
            userId: box.userId, // Inherit userId from box (can be null for guest box)
            isGuestElement: box.isGuestBox, // Match box's guest status
            isFrontElement
        });
        const savedElement = await newElement.save();

        const arrayPath = getBoxElementArrayPath(isFrontElement);
        await Box.findByIdAndUpdate(boxId, { $push: { [arrayPath]: savedElement._id } });
        
        const updatedBox = await Box.findById(boxId)
            .populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        
        const boxForResponse = {
            ...updatedBox,
            boxFrontElements: updatedBox.boxFrontElementIds || [],
            boxBackElements: updatedBox.boxBackElementIds || [],
            boxFrontElementIds: (updatedBox.boxFrontElementIds || []).map(el => el._id),
            boxBackElementIds: (updatedBox.boxBackElementIds || []).map(el => el._id),
        };
        successResponse(res, "Element added to box.", boxForResponse, 201);
    } catch (error) {
        errorResponse(res, "Failed to add element to box.", 500, "ADD_BOX_ELEMENT_FAILED", error.message);
    }
};

exports.updateBoxElement = async (req, res) => {
    try {
        const { elementId } = req.params; // Element's _id
        const updates = req.body;
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(elementId)) return errorResponse(res, "Invalid Element ID.", 400);
        if (Object.keys(updates).length === 0) return errorResponse(res, "No updates provided.", 400);
        
        delete updates.cardId; delete updates.boxId; delete updates.userId;
        delete updates.isFrontElement; delete updates.isGuestElement;

        const elementQuery = { _id: elementId, cardId: null }; // Ensure it's a box element
        if (userId) elementQuery.userId = userId; else elementQuery.isGuestElement = true;
        
        const updatedElement = await Element.findOneAndUpdate(elementQuery, { $set: updates }, { new: true });
        if (!updatedElement) return errorResponse(res, "Box element not found or not authorized.", 404);
        
        const parentBox = await Box.findById(updatedElement.boxId)
            .populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        
        const boxForResponse = {
            ...parentBox,
            boxFrontElements: parentBox.boxFrontElementIds || [],
            boxBackElements: parentBox.boxBackElementIds || [],
            boxFrontElementIds: (parentBox.boxFrontElementIds || []).map(el => el._id),
            boxBackElementIds: (parentBox.boxBackElementIds || []).map(el => el._id),
        };
        successResponse(res, "Box element updated.", boxForResponse);
    } catch (error) {
        errorResponse(res, "Failed to update box element.", 500, "UPDATE_BOX_ELEMENT_FAILED", error.message);
    }
};

exports.deleteBoxElement = async (req, res) => {
    try {
        const { elementId } = req.params; // Element's _id
        let userId = null;
        if (req.user && req.user.id) userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(elementId)) return errorResponse(res, "Invalid Element ID.", 400);

        const elementQuery = { _id: elementId, cardId: null }; // Box element
        if (userId) elementQuery.userId = userId; else elementQuery.isGuestElement = true;

        const elementToDelete = await Element.findOne(elementQuery);
        if (!elementToDelete) return errorResponse(res, "Box element not found or not authorized.", 404);

        const boxId = elementToDelete.boxId;
        const arrayPath = getBoxElementArrayPath(elementToDelete.isFrontElement);

        await Element.findByIdAndDelete(elementId);
        const updatedBox = await Box.findByIdAndUpdate(boxId, 
            { $pull: { [arrayPath]: elementId }, $set: {updatedAt: Date.now()} }, 
            { new: true }
        ).populate('boxFrontElementIds').populate('boxBackElementIds').lean();

        const responseBox = { ...updatedBox };
        responseBox.boxFrontElements = updatedBox.boxFrontElementIds || [];
        responseBox.boxBackElements = updatedBox.boxBackElementIds || [];
        responseBox.boxFrontElementIds = (updatedBox.boxFrontElementIds || []).map(el => el._id);
        responseBox.boxBackElementIds = (updatedBox.boxBackElementIds || []).map(el => el._id);
        
        successResponse(res, "Box element deleted.", responseBox);
    } catch (error) {
        errorResponse(res, "Error deleting box element.", 500, error.message);
    }
};

/**
 * @desc    Toggle the public sharing status of a box and return a shareable link.
 * @route   PUT /api/boxes/:boxId/toggle-public
 * @access  Private
 */
exports.togglePublicStatus = async (req, res) => {
    try {
        const { boxId } = req.params;
        const userId = req.user.id;

        const box = await Box.findOne({ _id: boxId, userId: userId });

        if (!box) {
            return errorResponse(res, "Box not found or you are not authorized to modify it.", 404);
        }

        // Flip the boolean status
        box.isPublic = !box.isPublic;
        await box.save();

        let message = "Box is now private.";
        let shareableLink = null;

        // If the box was just made public, construct the link.
        if (box.isPublic) {
            message = "Box is now publicly shareable.";
            if (process.env.FRONTEND_BASE_URL) {
                // Construct the link using the base URL from the .env file.
                shareableLink = `${process.env.FRONTEND_BASE_URL}/boxes/view-box/${box._id}`;
            } else {
                console.warn("FRONTEND_BASE_URL is not set in .env file. Cannot generate shareable link.");
            }
        }

        successResponse(res, message, {
            isPublic: box.isPublic,
            shareableLink: shareableLink // This will be the link or null
        });

    } catch (error) {
        errorResponse(res, "Failed to update public status.", 500, "TOGGLE_PUBLIC_FAILED", error.message);
    }
};

/**
 * @desc    Get a single publicly shared box's details.
 * @route   GET /api/boxes/public/:boxId
 * @access  Public
 */
exports.getPublicBox = async (req, res) => {
    try {
        const { boxId } = req.params;

        // Find the box by its ID but ONLY if its 'isPublic' flag is set to true.
        // This prevents private boxes from ever being fetched through this public endpoint.
        const box = await Box.findOne({ _id: boxId, isPublic: true })
            .populate('boxFrontElementIds')
            .populate('boxBackElementIds')
            .lean();

        if (!box) {
            return errorResponse(res, "This box is not public or does not exist.", 404);
        }

        // Also fetch the cards associated with this public box
        const cards = await Card.find({ boxId: box._id })
            .populate('cardFrontElementIds')
            .populate('cardBackElementIds')
            .sort({ orderInBox: 1 })
            .lean();
            
        const responseData = {
            box,
            cards
        };

        successResponse(res, "Public box data retrieved successfully.", responseData);

    } catch (error) {
        errorResponse(res, "Failed to retrieve public box data.", 500, "GET_PUBLIC_BOX_FAILED", error.message);
    }
};