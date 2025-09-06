// src/controllers/box.controller.js
const Box = require('../models/Box.model');
const Card = require('../models/Card.model'); // Needed for deleting cards with box
const Element = require('../models/Element.model');
const aiService = require('../services/ai.service');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const CardTemplate = require('../models/CardTemplate.model');
const jwt = require('jsonwebtoken'); // For optional token check
const User = require('../models/User.model'); // For optional token check
const RuleSet = require('../models/RuleSet.model');
const SystemSetting = require('../models/SystemSetting.model.js');
const { CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION, CARD_TITLE_SYSTEM_INSTRUCTION } = require('../constants/aiPrompts');

const { successResponse, errorResponse } = require('../utils/responseHandler');

const DEFAULT_BACKEND_PLACEHOLDER_IMAGE_URL ="";

// Helper function to find the closest supported aspect ratio string
function getClosestSupportedAspectRatio(width, height, supportedRatios) {
    if (!width || !height || height === 0) return "1:1";
    const targetRatioValue = width / height;
    const closestRatio = supportedRatios.reduce((prev, curr) => {
        const prevDiff = Math.abs(prev.value - targetRatioValue);
        const currDiff = Math.abs(curr.value - targetRatioValue);
        return currDiff < prevDiff ? curr : prev;
    });
    return closestRatio.string;
}

// --- Helper function to add the isCustomCardDesign flag ---
const addCustomDesignFlag = (card) => ({
    ...card,
    isCustomCardDesign: !!card.customDesign
});

// --- THIS IS THE FIX: The missing helper function is now included ---
// This function ensures that every box object sent to the frontend
// has the ruleSetId and game_rules keys, even if they are null.
const normalizeBox = (box) => {
    if (!box) return null;
    return {
        ...box,
        ruleSetId: box.ruleSetId || null,
        game_rules: box.game_rules || null
    };
};

function getContrastingTextColor(hexColor) {
    if (!hexColor || hexColor.length < 4) return '#000000';
    let r = parseInt(hexColor.slice(1, 3), 16);
    let g = parseInt(hexColor.slice(3, 5), 16);
    let b = parseInt(hexColor.slice(5, 7), 16);
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
    return hsp > 127.5 ? '#000000' : '#FFFFFF';
}

// --- THE FINAL, SIMPLIFIED GENERATION METHOD ---

// --- MAIN DECK GENERATION METHOD ---
exports.generateNewDeckAndBox = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Final & Simplified Mode) started.");
    const generationWarnings = [];
    try {
        const {
            userPrompt,
            boxName,
            boxDescription: userBoxDescription,
            genre = "Fantasy",
            numCardsInDeck = 1,
            generateBoxDesign = true,
            includeCharacterArt = false,
            defaultCardWidthPx = 315,
            defaultCardHeightPx = 440,
            ruleSetId,
            cardColorTheme = '#5D4037'
        } = req.body;

        let userId = null;
        let isGuest = true;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (user) { userId = user._id; isGuest = false; }
            } catch (err) { /* proceed as guest */ }
        }
        if (!userPrompt) return errorResponse(res, "An AI Prompt is required.", 400);

        // --- PHASE 1: RULESET & TEXT GENERATION ---
        let game_rules = null;
        let rulesContextString = "No specific rules provided.";
        if (ruleSetId) {
            if (!mongoose.Types.ObjectId.isValid(ruleSetId)) return errorResponse(res, "Invalid RuleSet ID format.", 400);
            const ruleSet = await RuleSet.findById(ruleSetId);
            if (!ruleSet) return errorResponse(res, "RuleSet with the provided ID not found.", 404);
            if (!isGuest && ruleSet.userId && ruleSet.userId.toString() !== userId.toString()) return errorResponse(res, "You are not authorized to use this RuleSet.", 403);
            game_rules = { rules_data: ruleSet.rules_data.map(r => ({ ...r })) };
            rulesContextString = game_rules.rules_data.map(rule => `- ${rule.heading}: ${rule.description}`).join('\n');
        }

        let selectedFontFamily;
        switch (genre.toLowerCase()) {
            case 'fantasy':
            case 'mythology':
                selectedFontFamily = "'MedievalSharp', cursive";
                break;
            case 'sci-fi':
            case 'cyberpunk':
                selectedFontFamily = "'Orbitron', sans-serif";
                break;
            case 'horror':
                selectedFontFamily = "'Creepster', cursive";
                break;
            case 'educational':
                selectedFontFamily = "'Comic Sans MS', cursive";
                break;
            default:
                selectedFontFamily = "'Roboto', sans-serif";
        }

        const [textListData, finalBoxNameResult, aiBoxDescription] = await Promise.all([
            aiService.generateTextWithGemini(`Game Context:\n${rulesContextString}\n\nBased on the theme "${userPrompt}" and genre "${genre}", generate a list of ${numCardsInDeck} unique pieces of text content for game cards.`, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION),
            boxName ? Promise.resolve(boxName) : aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION),
            userBoxDescription ? Promise.resolve(userBoxDescription) : aiService.generateTextWithGemini(userPrompt, undefined, aiService.BOX_DESCRIPTION_SYSTEM_INSTRUCTION)
        ]);
        const finalBoxName = boxName || finalBoxNameResult.trim();
        const finalBoxDescription = userBoxDescription || aiBoxDescription.trim();
        let textItemsArray = (textListData || '').split('\n').map(item => item.trim()).filter(Boolean);
        while (textItemsArray.length < numCardsInDeck) { textItemsArray.push(`[Content ${textItemsArray.length + 1}]`); }

        // --- PHASE 2: VISUAL ASSET GENERATION (DIRECT PROMPTING) ---
        const cardAspectRatio = getClosestSupportedAspectRatio(defaultCardWidthPx, defaultCardHeightPx, [{ string: "2:3", value: 2/3 }, { string: "3:2", value: 3/2 }, { string: "1:1", value: 1/1 }]);
        const baseArtPrompt = `${userPrompt}, ${genre}, featuring the color ${cardColorTheme}, digital art, cinematic lighting, high detail.`;
        const backgroundPrompt = `Scenic atmospheric landscape art for a TCG background, including an integrated decorative frame, no characters, no text, ${baseArtPrompt}`;
        const illustrationPrompt = `Isolated TCG character art, full body, on a plain solid white background, NO shadows, NO environment, ${baseArtPrompt}`;
        const boxFrontPrompt = `Product packaging art for the front of a tuck box, title "${finalBoxName}", ${baseArtPrompt}`;
        const boxBackPrompt = `Back of product box, retail packaging, ${baseArtPrompt}`;

        const [bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult] = await Promise.all([
            aiService.generateImageWithStabilityAI(backgroundPrompt, 'png', cardAspectRatio),
            aiService.generateImageWithStabilityAI(`Card back design, with art based on: ${userPrompt}. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', cardAspectRatio),
            includeCharacterArt ? aiService.generateImageWithStabilityAI(illustrationPrompt, 'png', '1:1') : Promise.resolve({ success: false, error: "Character art was not requested." }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxFrontPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxBackPrompt, 'png', '1:1') : Promise.resolve({ success: false })
        ]);

        // --- PHASE 3: DATABASE ASSEMBLY ---
        const boxWidthPx = Math.round(defaultCardWidthPx * 1.05);
        const boxHeightPx = Math.round(defaultCardHeightPx * 1.05);
        const newBoxData = { name: finalBoxName, description: finalBoxDescription, userId, isGuestBox: isGuest, defaultCardWidthPx, defaultCardHeightPx, boxWidthPx, boxHeightPx, ruleSetId: ruleSetId || null, game_rules, baseAISettings: { userPrompt, genre, cardColorTheme, fontFamily: selectedFontFamily } };
        const savedBox = await new Box(newBoxData).save();
        const savedTemplate = await new CardTemplate({ boxId: savedBox._id }).save();
        savedBox.cardTemplateId = savedTemplate._id;
        await savedBox.save();

        const masterFrontElementsData = [];
        if (bgResult.success) masterFrontElementsData.push({ type: 'image', imageUrl: bgResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx }); else generationWarnings.push(bgResult.error);
        if (mainIllustrationResult.success) {
            const refinedUri = await aiService.removeBackgroundWithPixian(Buffer.from(mainIllustrationResult.data.split(',')[1], 'base64'));
            const charSize = defaultCardWidthPx * 0.9;
            masterFrontElementsData.push({ type: 'image', imageUrl: refinedUri || mainIllustrationResult.data, zIndex: 2, x: (defaultCardWidthPx - charSize) / 2, y: (defaultCardHeightPx - charSize) / 2, width: charSize, height: charSize });
        } else if (includeCharacterArt) { generationWarnings.push(mainIllustrationResult.error); }
        const titleColor = getContrastingTextColor(cardColorTheme);
        masterFrontElementsData.push({ type: 'text', content: finalBoxName, zIndex: 4, x: 0, y: 20, width: defaultCardWidthPx, height: 40, color: titleColor, fontFamily: selectedFontFamily, textAlign: 'center', fontSize: "28px", fontWeight: 'bold' });

        const masterBackElementsData = [];
        if (backResult.success) masterBackElementsData.push({ type: 'image', imageUrl: backResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx, isFrontElement: false }); else generationWarnings.push(backResult.error);

        const frontTemplateElements = await Element.insertMany(masterFrontElementsData.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: true })));
        const backTemplateElements = await Element.insertMany(masterBackElementsData.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
        savedTemplate.frontElements = frontTemplateElements.map(e => e._id);
        savedTemplate.backElements = backTemplateElements.map(e => e._id);
        await savedTemplate.save();

        const savedCardsForResponse = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            const textBgShape = await new Element({ type: 'shape', shapeType: 'rectangle', zIndex: 3, x: 40, y: 275, width: defaultCardWidthPx - 80, height: 120, fillColor: 'rgba(0, 0, 0, 0.5)', borderRadius: 15, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const textElement = await new Element({ type: 'text', content: textItemsArray[i], zIndex: 5, x: 50, y: 280, width: defaultCardWidthPx - 100, height: 120, color: '#FFFFFF', fontFamily: "'Roboto', sans-serif", textAlign: 'center', fontSize: "18px", boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const savedCard = await new Card({ name: `${finalBoxName} - Card ${i + 1}`, boxId: savedBox._id, userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, isCustomDesign: false, elements: [textBgShape._id, textElement._id] }).save();
            const cardObject = await Card.findById(savedCard._id).populate('elements').lean();
            savedCardsForResponse.push(cardObject);
        }

        if (generateBoxDesign) {
            const boxFrontElements = []; const boxBackElements = [];
            if (boxFrontResult.success) boxFrontElements.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxFrontResult.error);
            if (boxBackResult.success) boxBackElements.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxBackResult.error);
            const savedBoxFrontElements = await Element.insertMany(boxFrontElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: true })));
            const savedBoxBackElements = await Element.insertMany(boxBackElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: false })));
            savedBox.boxFrontElementIds = savedBoxFrontElements.map(e => e._id);
            savedBox.boxBackElementIds = savedBoxBackElements.map(e => e._id);
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements').populate('backElements').lean();

        const finalResponseData = {
            box: normalizeBox(finalBox),
            cardTemplate: finalCardTemplate,
            cards: savedCardsForResponse
        };
        const metadata = generationWarnings.length > 0 ? { warnings: [...new Set(generationWarnings)] } : null;
        successResponse(res, `Box "${finalBoxName}" and ${numCardsInDeck} cards created successfully.`, finalResponseData, 201, metadata);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

exports.generateNewDeckAndBoxOld2 = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Final Architecture) started.");
    const generationWarnings = [];
    try {
        const {
            userPrompt,
            boxName,
            boxDescription: userBoxDescription,
            genre = "Fantasy",
            numCardsInDeck = 1,
            generateBoxDesign = true,
            includeCharacterArt = true,
            defaultCardWidthPx = 315,
            defaultCardHeightPx = 440,
            ruleSetId,
            cardColorTheme = '#5D4037'
        } = req.body;

        let userId = null;
        let isGuest = true;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (user) { userId = user._id; isGuest = false; }
            } catch (err) { /* proceed as guest */ }
        }
        if (!userPrompt) return errorResponse(res, "An AI Prompt is required.", 400);

        // --- PHASE 1: Deconstruct Prompt, Select Font, Generate Text ---
        const deconstructSystemInstruction = `You are a text analyzer. Your task is to extract the main subject/character, the background setting, and the overall artistic style from the user's prompt. Respond with ONLY a valid JSON object with the keys "character", "background", and "style".`;
        let promptData;
        try { const result = await aiService.generateTextWithGemini(userPrompt, undefined, deconstructSystemInstruction); const cleanedResult = result.replace(/```json/g, '').replace(/```/g, '').trim(); promptData = JSON.parse(cleanedResult); } catch (error) { console.warn("Failed to deconstruct user prompt with AI. Using raw prompt as fallback."); promptData = { character: userPrompt, background: userPrompt, style: "digital art" }; }
        let game_rules = null;
        let rulesContextString = "No specific rules provided.";
        if (ruleSetId) {
            if (!mongoose.Types.ObjectId.isValid(ruleSetId)) return errorResponse(res, "Invalid RuleSet ID format.", 400);
            const ruleSet = await RuleSet.findById(ruleSetId);
            if (!ruleSet) return errorResponse(res, "RuleSet with the provided ID not found.", 404);
            if (!isGuest && ruleSet.userId && ruleSet.userId.toString() !== userId.toString()) return errorResponse(res, "You are not authorized to use this RuleSet.", 403);
            game_rules = { rules_data: ruleSet.rules_data.map(r => ({ ...r })) };
            rulesContextString = game_rules.rules_data.map(rule => `- ${rule.heading}: ${rule.description}`).join('\n');
        }
        let selectedFontFamily;
        switch (genre.toLowerCase()) {
            case 'fantasy': case 'mythology': selectedFontFamily = "'MedievalSharp', cursive"; break;
            case 'sci-fi': case 'cyberpunk': selectedFontFamily = "'Orbitron', sans-serif"; break;
            case 'horror': selectedFontFamily = "'Creepster', cursive"; break;
            case 'educational': selectedFontFamily = "'Comic Sans MS', cursive"; break;
            default: selectedFontFamily = "'Roboto', sans-serif";
        }
        const [textListData, finalBoxNameResult, aiBoxDescription] = await Promise.all([
            aiService.generateTextWithGemini(`Game Context:\n${rulesContextString}\n\nBased on the theme "${userPrompt}" and genre "${genre}", generate a list of ${numCardsInDeck} unique pieces of text content for game cards.`, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION),
            boxName ? Promise.resolve(boxName) : aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION),
            userBoxDescription ? Promise.resolve(userBoxDescription) : aiService.generateTextWithGemini(userPrompt, undefined, aiService.BOX_DESCRIPTION_SYSTEM_INSTRUCTION)
        ]);
        const finalBoxName = boxName || finalBoxNameResult.trim();
        const finalBoxDescription = userBoxDescription || aiBoxDescription.trim();
        let textItemsArray = (textListData || '').split('\n').map(item => item.trim()).filter(Boolean);
        while (textItemsArray.length < numCardsInDeck) { textItemsArray.push(`[Content ${textItemsArray.length + 1}]`); }

        // --- PHASE 2: VISUAL ASSET GENERATION ---
        const cardAspectRatio = getClosestSupportedAspectRatio(defaultCardWidthPx, defaultCardHeightPx, [{ string: "2:3", value: 2/3 }, { string: "3:2", value: 3/2 }, { string: "1:1", value: 1/1 }]);
        const baseArtPrompt = `${userPrompt}, ${genre}, featuring the color ${cardColorTheme}, digital art, cinematic lighting, high detail.`;
        const backgroundPrompt = `Scenic atmospheric landscape art for a TCG background, including an integrated decorative frame, no characters, no text, ${baseArtPrompt}`;
        const illustrationPrompt = `Isolated TCG character art, full body, on a plain solid white background, NO shadows, NO environment, ${baseArtPrompt}`;
        const boxFrontPrompt = `Product packaging art for the front of a tuck box, title "${finalBoxName}", ${baseArtPrompt}`;
        const boxBackPrompt = `Back of product box, retail packaging, ${baseArtPrompt}`;

        const [bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult] = await Promise.all([
            aiService.generateImageWithStabilityAI(backgroundPrompt, 'png', cardAspectRatio),
            aiService.generateImageWithStabilityAI(`Card back design, with art based on: ${userPrompt}. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', cardAspectRatio),
            includeCharacterArt ? aiService.generateImageWithStabilityAI(illustrationPrompt, 'png', '1:1') : Promise.resolve({ success: false, error: "Character art was not requested." }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxFrontPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxBackPrompt, 'png', '1:1') : Promise.resolve({ success: false })
        ]);

        // --- PHASE 3: DATABASE ASSEMBLY ---
        const boxWidthPx = Math.round(defaultCardWidthPx * 1.05);
        const boxHeightPx = Math.round(defaultCardHeightPx * 1.05);
        const newBoxData = { name: finalBoxName, description: finalBoxDescription, userId, isGuestBox: isGuest, defaultCardWidthPx, defaultCardHeightPx, boxWidthPx, boxHeightPx, ruleSetId: ruleSetId || null, game_rules, baseAISettings: { userPrompt, genre, cardColorTheme, fontFamily: selectedFontFamily } };
        const savedBox = await new Box(newBoxData).save();
        const savedTemplate = await new CardTemplate({ boxId: savedBox._id }).save();
        savedBox.cardTemplateId = savedTemplate._id;
        await savedBox.save();

        const masterFrontElementsData = [];
        if (bgResult.success) masterFrontElementsData.push({ type: 'image', imageUrl: bgResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx }); else generationWarnings.push(bgResult.error);
        if (mainIllustrationResult.success) {
            const refinedUri = await aiService.removeBackgroundWithPixian(Buffer.from(mainIllustrationResult.data.split(',')[1], 'base64'));
            const charSize = defaultCardWidthPx * 0.9;
            masterFrontElementsData.push({ type: 'image', imageUrl: refinedUri || mainIllustrationResult.data, zIndex: 2, x: (defaultCardWidthPx - charSize) / 2, y: (defaultCardHeightPx - charSize) / 2, width: charSize, height: charSize });
        } else if (includeCharacterArt) { generationWarnings.push(mainIllustrationResult.error); }
        const titleColor = getContrastingTextColor(cardColorTheme);
        masterFrontElementsData.push({ type: 'text', content: finalBoxName, zIndex: 4, x: 0, y: 20, width: defaultCardWidthPx, height: 40, color: titleColor, fontFamily: selectedFontFamily, textAlign: 'center', fontSize: "28px", fontWeight: 'bold' });
        const masterBackElementsData = [];
        if (backResult.success) masterBackElementsData.push({ type: 'image', imageUrl: backResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx }); else generationWarnings.push(backResult.error);

        const frontTemplateElements = await Element.insertMany(masterFrontElementsData.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
        const backTemplateElements = await Element.insertMany(masterBackElementsData.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
        savedTemplate.frontElements = frontTemplateElements.map(e => e._id);
        savedTemplate.backElements = backTemplateElements.map(e => e._id);
        await savedTemplate.save();

        const savedCardsForResponse = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            const textBgShape = await new Element({ type: 'shape', shapeType: 'rectangle', zIndex: 3, x: 40, y: 275, width: defaultCardWidthPx - 80, height: 120, fillColor: 'rgba(0, 0, 0, 0.5)', borderRadius: 15, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const textElement = await new Element({ type: 'text', content: textItemsArray[i], zIndex: 5, x: 50, y: 280, width: defaultCardWidthPx - 100, height: 120, color: '#FFFFFF', fontFamily: "'Roboto', sans-serif", textAlign: 'center', fontSize: "18px", boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const savedCard = await new Card({ name: `${finalBoxName} - Card ${i + 1}`, boxId: savedBox._id, userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, uniqueElements: [textBgShape._id, textElement._id] }).save();

            // --- THIS IS THE FIX ---
            // We now create the full, consistent card object for the response.
            const cardObject = savedCard.toObject();
            cardObject.uniqueElements = [textBgShape.toObject(), textElement.toObject()]; // Populate the unique elements
            cardObject.isCustomCardDesign = false; // All newly created cards use the template by default
            savedCardsForResponse.push(cardObject);
        }

        if (generateBoxDesign) {
            const boxFrontElements = []; const boxBackElements = [];
            if (boxFrontResult.success) boxFrontElements.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxFrontResult.error);
            if (boxBackResult.success) boxBackElements.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxBackResult.error);
            const savedBoxFrontElements = await Element.insertMany(boxFrontElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
            const savedBoxBackElements = await Element.insertMany(boxBackElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
            savedBox.boxFrontElementIds = savedBoxFrontElements.map(e => e._id);
            savedBox.boxBackElementIds = savedBoxBackElements.map(e => e._id);
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements').populate('backElements').lean();

        const finalResponseData = {
            box: finalBox,
            cardTemplate: finalCardTemplate,
            cards: savedCardsForResponse // Use the new, fully populated array
        };
        const metadata = generationWarnings.length > 0 ? { warnings: [...new Set(generationWarnings)] } : null;
        successResponse(res, `Box "${finalBoxName}" and ${numCardsInDeck} cards created successfully.`, finalResponseData, 201, metadata);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

// --- MAIN DECK GENERATION METHOD ---
exports.generateNewDeckAndBoxOld = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Final & Simplified Mode) started.");
    const generationWarnings = [];
    try {
        const {
            userPrompt,
            boxName,
            boxDescription: userBoxDescription,
            genre = "Fantasy",
            numCardsInDeck = 1,
            generateBoxDesign = true,
            includeCharacterArt = false,
            defaultCardWidthPx = 315,
            defaultCardHeightPx = 440,
            ruleSetId,
            cardColorTheme = '#5D4037'
        } = req.body;

        let userId = null;
        let isGuest = true;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (user) { userId = user._id; isGuest = false; }
            } catch (err) { /* proceed as guest */ }
        }
        if (!userPrompt) return errorResponse(res, "An AI Prompt is required.", 400);

        // --- PHASE 1: TEXT GENERATION ---
        const [textListData, finalBoxNameResult, aiBoxDescription] = await Promise.all([
            aiService.generateTextWithGemini(`Based on the theme "${userPrompt}", generate a list of ${numCardsInDeck} unique pieces of text content for game cards.`, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION),
            boxName ? Promise.resolve(boxName) : aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION),
            userBoxDescription ? Promise.resolve(userBoxDescription) : aiService.generateTextWithGemini(userPrompt, undefined, aiService.BOX_DESCRIPTION_SYSTEM_INSTRUCTION)
        ]);
        const finalBoxName = boxName || finalBoxNameResult.trim();
        const finalBoxDescription = userBoxDescription || aiBoxDescription.trim();
        let textItemsArray = (textListData || '').split('\n').map(item => item.trim()).filter(Boolean);
        while (textItemsArray.length < numCardsInDeck) { textItemsArray.push(`[Content ${textItemsArray.length + 1}]`); }

        // --- PHASE 2: VISUAL ASSET GENERATION (DIRECT PROMPTING) ---
        const cardAspectRatio = getClosestSupportedAspectRatio(defaultCardWidthPx, defaultCardHeightPx, [{ string: "2:3", value: 2/3 }, { string: "3:2", value: 3/2 }, { string: "1:1", value: 1/1 }]);
        const baseArtPrompt = `${userPrompt}, ${genre}, featuring the color ${cardColorTheme}, digital art, cinematic lighting, high detail.`;
        const backgroundPrompt = `Scenic atmospheric landscape art for a TCG background, including an integrated decorative frame, no characters, no text, ${baseArtPrompt}`;
        const illustrationPrompt = `Isolated TCG character art, full body, on a plain solid white background, NO shadows, NO environment, ${baseArtPrompt}`;
        const boxFrontPrompt = `Product packaging art for the front of a tuck box, title "${finalBoxName}", ${baseArtPrompt}`;
        const boxBackPrompt = `Back of product box, retail packaging, ${baseArtPrompt}`;

        const [bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult] = await Promise.all([
            aiService.generateImageWithStabilityAI(backgroundPrompt, 'png', cardAspectRatio),
            aiService.generateImageWithStabilityAI(`Card back design, with art based on: ${userPrompt}. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', cardAspectRatio),
            includeCharacterArt ? aiService.generateImageWithStabilityAI(illustrationPrompt, 'png', '1:1') : Promise.resolve({ success: false, error: "Character art was not requested." }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxFrontPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxBackPrompt, 'png', '1:1') : Promise.resolve({ success: false })
        ]);

        // --- PHASE 3: DATABASE ASSEMBLY ---
        const boxWidthPx = Math.round(defaultCardWidthPx * 1.05);
        const boxHeightPx = Math.round(defaultCardHeightPx * 1.05);
        const newBoxData = { name: finalBoxName, description: finalBoxDescription, userId, isGuestBox: isGuest, defaultCardWidthPx, defaultCardHeightPx, boxWidthPx, boxHeightPx };
        const savedBox = await new Box(newBoxData).save();
        const savedTemplate = await new CardTemplate({ boxId: savedBox._id }).save();
        savedBox.cardTemplateId = savedTemplate._id;
        await savedBox.save();

        const masterFrontElementsData = [];
        if (bgResult.success) masterFrontElementsData.push({ type: 'image', imageUrl: bgResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx }); else generationWarnings.push(bgResult.error);
        if (mainIllustrationResult.success) {
            const refinedUri = await aiService.removeBackgroundWithPixian(Buffer.from(mainIllustrationResult.data.split(',')[1], 'base64'));
            const charSize = defaultCardWidthPx * 0.9;
            masterFrontElementsData.push({ type: 'image', imageUrl: refinedUri || mainIllustrationResult.data, zIndex: 2, x: (defaultCardWidthPx - charSize) / 2, y: (defaultCardHeightPx - charSize) / 2, width: charSize, height: charSize });
        } else if (includeCharacterArt) { generationWarnings.push(mainIllustrationResult.error); }
        masterFrontElementsData.push({ type: 'text', content: finalBoxName, zIndex: 4, x: 0, y: 20, width: defaultCardWidthPx, height: 40, color: getContrastingTextColor(cardColorTheme), fontFamily: "'MedievalSharp', cursive", textAlign: 'center', fontSize: "28px", fontWeight: 'bold' });

        const masterBackElementsData = [];
        if (backResult.success) masterBackElementsData.push({ type: 'image', imageUrl: backResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx, isFrontElement: false }); else generationWarnings.push(backResult.error);

        const frontTemplateElements = await Element.insertMany(masterFrontElementsData.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
        const backTemplateElements = await Element.insertMany(masterBackElementsData.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
        savedTemplate.frontElements = frontTemplateElements.map(e => e._id);
        savedTemplate.backElements = backTemplateElements.map(e => e._id);
        await savedTemplate.save();

        const cardsForResponse = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            const textBgShape = await new Element({ type: 'shape', shapeType: 'rectangle', zIndex: 3, x: 40, y: 275, width: defaultCardWidthPx - 80, height: 120, fillColor: 'rgba(0, 0, 0, 0.5)', borderRadius: 15, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const textElement = await new Element({ type: 'text', content: textItemsArray[i], zIndex: 5, x: 50, y: 280, width: defaultCardWidthPx - 100, height: 120, color: '#FFFFFF', fontFamily: "'Roboto', sans-serif", textAlign: 'center', fontSize: "18px", boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const savedCard = await new Card({ name: `${finalBoxName} - Card ${i + 1}`, boxId: savedBox._id, userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, isCustomDesign: false, elements: [textBgShape._id, textElement._id] }).save();
            const cardObject = await Card.findById(savedCard._id).populate('elements').lean();
            cardObject.isCustomDesign = false;
            cardsForResponse.push(cardObject);
        }

        if (generateBoxDesign) {
            const boxFrontElements = []; const boxBackElements = [];
            if (boxFrontResult.success) boxFrontElements.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxFrontResult.error);
            if (boxBackResult.success) boxBackElements.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxBackResult.error);
            const savedBoxFrontElements = await Element.insertMany(boxFrontElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
            const savedBoxBackElements = await Element.insertMany(boxBackElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })));
            savedBox.boxFrontElementIds = savedBoxFrontElements.map(e => e._id);
            savedBox.boxBackElementIds = savedBoxBackElements.map(e => e._id);
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements').populate('backElements').lean();

        const finalResponseData = { box: finalBox, cardTemplate: finalCardTemplate, cards: cardsForResponse };
        const metadata = generationWarnings.length > 0 ? { warnings: [...new Set(generationWarnings)] } : null;
        successResponse(res, `Box "${finalBoxName}" and ${numCardsInDeck} cards created successfully.`, finalResponseData, 201, metadata);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

exports.getUserBoxes = async (req, res) => {
    try {
        if (!req.user || !req.user.id) return errorResponse(res, "User not authenticated.", 401);
        const userId = req.user.id;
        const boxesFromDB = await Box.find({ userId: userId }).populate('boxFrontElementIds').populate('boxBackElementIds').sort({ updatedAt: -1 }).lean();
        if (!boxesFromDB || boxesFromDB.length === 0) return successResponse(res, "User has no boxes.", []);
        const boxIds = boxesFromDB.map(box => box._id);
        const templateIds = boxesFromDB.map(box => box.cardTemplateId);
        const [allTemplates, allCards] = await Promise.all([
            CardTemplate.find({ _id: { $in: templateIds } }).populate('frontElements').populate('backElements').lean(),
            Card.find({ boxId: { $in: boxIds } }).populate('elements').sort({ orderInBox: 1 }).lean()
        ]);
        const fullBoxData = boxesFromDB.map(box => {
            const cardTemplate = allTemplates.find(t => t._id.toString() === box.cardTemplateId.toString());
            const cards = allCards.filter(c => c.boxId.toString() === box._id.toString());
            return { box: normalizeBox(box), cardTemplate, cards }; // <-- NORMALIZED
        });
        successResponse(res, "User boxes retrieved successfully.", fullBoxData);
    } catch (error) {
        errorResponse(res, "Failed to retrieve user boxes.", 500, "FETCH_BOXES_FAILED", error.message);
    }
};

exports.getBoxById = async (req, res) => {
    try {
        const { boxId } = req.params;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, $or: [{ userId: userId }, { isGuestBox: true }] } : { _id: boxId, isGuestBox: true };
        const box = await Box.findOne(query).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        if (!box) return errorResponse(res, "Box not found or not authorized.", 404);
        const cardTemplate = await CardTemplate.findById(box.cardTemplateId).populate('frontElements').populate('backElements').lean();
        const cards = await Card.find({ boxId: box._id }).populate('elements').sort({ orderInBox: 1 }).lean();
        successResponse(res, "Box details retrieved successfully.", { box: normalizeBox(box), cardTemplate, cards }); // <-- NORMALIZED
    } catch (error) {
        errorResponse(res, "Error fetching box details.", 500, "FETCH_BOX_FAILED", error.message);
    }
};

exports.getPublicBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const box = await Box.findOne({ _id: boxId, isPublic: true }).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        if (!box) return errorResponse(res, "This box is not public or does not exist.", 404);
        const cardTemplate = await CardTemplate.findById(box.cardTemplateId).populate('frontElements').populate('backElements').lean();
        const cards = await Card.find({ boxId: box._id }).populate('elements').sort({ orderInBox: 1 }).lean();
        successResponse(res, "Public box data retrieved successfully.", { box: normalizeBox(box), cardTemplate, cards }); // <-- NORMALIZED
    } catch (error) {
        errorResponse(res, "Failed to retrieve public box data.", 500, "GET_PUBLIC_BOX_FAILED", error.message);
    }
};

exports.claimBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const userId = req.user.id;
        const box = await Box.findById(boxId);
        if (!box) return errorResponse(res, 'Box not found.', 404);
        if (box.userId && box.userId.toString() !== userId.toString()) return errorResponse(res, 'This box is already owned by another user.', 403);

        box.userId = userId; box.isGuestBox = false;
        await box.save();
        await Card.updateMany({ boxId: box._id, isGuestCard: true }, { $set: { userId: userId, isGuestCard: false } });
        await Element.updateMany({ boxId: box._id, isGuestElement: true }, { $set: { userId: userId, isGuestElement: false } });
        await CardTemplate.updateMany({ boxId: box._id }, { $set: { userId: userId } });

        const updatedBox = await Box.findById(boxId).populate('boxFrontElementIds').populate('boxBackElementIds').lean();
        const cardTemplate = await CardTemplate.findById(updatedBox.cardTemplateId).populate('frontElements').populate('backElements').lean();
        const cards = await Card.find({ boxId: boxId }).populate('elements').sort({ orderInBox: 1 }).lean();
        successResponse(res, 'Box, cards, and elements successfully claimed.', { box: normalizeBox(updatedBox), cardTemplate, cards }); // <-- NORMALIZED
    } catch (error) {
        errorResponse(res, 'Server error while claiming box.', 500, "CLAIM_BOX_FAILED", error.message);
    }
};

// --- NEW METHOD for detaching a card to give it a custom design ---
exports.detachCardFromTemplate = async (req, res) => {
    try {
        const { cardId } = req.params;
        const { frontElements, backElements } = req.body; // Expects full element objects
        const userId = req.user.id;

        const card = await Card.findOne({ _id: cardId, userId });
        if (!card) return errorResponse(res, "Card not found or not authorized.", 404);

        // Delete old unique elements if they exist
        if (card.uniqueElements && card.uniqueElements.length > 0) {
            await Element.deleteMany({ _id: { $in: card.uniqueElements } });
        }

        // Create new elements for the custom design
        const newFrontElements = await Element.insertMany(frontElements.map(el => ({ ...el, userId, isGuestElement: false })));
        const newBackElements = await Element.insertMany(backElements.map(el => ({ ...el, userId, isGuestElement: false })));

        // Update the card to use the new custom design
        card.customDesign = {
            frontElements: newFrontElements.map(e => e._id),
            backElements: newBackElements.map(e => e._id),
        };
        card.uniqueElements = []; // Clear unique elements as it's now fully custom
        await card.save();

        successResponse(res, "Card has been given a custom design.", { card });
    } catch (error) {
        errorResponse(res, "Failed to detach card from template.", 500, "DETACH_CARD_FAILED", error.message);
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

// --- REFACTORED: promoteCardToTemplate to use the new, simplified Card model ---
exports.promoteCardToTemplate = async (req, res) => {
    try {
        const { cardId } = req.params;
        const userId = req.user.id;

        const card = await Card.findOne({ _id: cardId, userId });
        if (!card || !card.isCustomDesign) {
            return errorResponse(res, "Card not found, not authorized, or does not have a custom design.", 404);
        }

        const box = await Box.findById(card.boxId);
        const template = await CardTemplate.findById(box.cardTemplateId);

        // Delete old template elements to prevent orphans
        await Element.deleteMany({ _id: { $in: [...template.frontElements, ...template.backElements] } });

        // Get the full element documents from the custom card
        const customElements = await Element.find({ _id: { $in: card.elements } });

        // Separate them into front and back for the new template
        const newFrontElements = customElements.filter(el => el.isFrontElement);
        const newBackElements = customElements.filter(el => !el.isFrontElement);

        template.frontElements = newFrontElements.map(e => e._id);
        template.backElements = newBackElements.map(e => e._id);
        await template.save();

        // Find the unique text and shape elements from the new design to re-attach to the card
        const uniqueElementsForCard = customElements.filter(el => el.zIndex === 3 || el.zIndex === 5);

        // Re-attach the source card to the template
        card.isCustomDesign = false;
        card.elements = uniqueElementsForCard.map(e => e._id);
        await card.save();

        // Optionally, reset all other custom cards in the deck to use the new template
        // await Card.updateMany({ boxId: box._id, _id: { $ne: cardId }, isCustomDesign: true }, { $set: { isCustomDesign: false, elements: [ ... ] }});

        successResponse(res, "Card design has been promoted to the master template for this deck.");
    } catch (error) {
        errorResponse(res, "Failed to promote card design.", 500, "PROMOTE_CARD_FAILED", error.message);
    }
};

// --- THIS IS THE NEW, HIGHLY OPTIMIZED VERSION of getUserBoxes ---
exports.getUserBoxesOld = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return errorResponse(res, "User not authenticated.", 401);
        }
        const userId = req.user.id;
        console.log(`Fetching all boxes for user: ${userId}`);

        // 1. First Pass: Get all boxes and populate their direct elements. This is one fast query.
        const userBoxes = await Box.find({ userId: userId })
            .populate('boxFrontElementIds')
            .populate('boxBackElementIds')
            .sort({ updatedAt: -1 })
            .lean();

        if (!userBoxes || userBoxes.length === 0) {
            return successResponse(res, "User has no boxes.", []);
        }

        // 2. Collect all necessary IDs for the bulk fetch.
        const boxIds = userBoxes.map(box => box._id);
        const templateIds = userBoxes.map(box => box.cardTemplateId);

        // 3. Second Pass (Bulk Fetch): Get all templates and cards in two efficient queries.
        const [allTemplates, allCards] = await Promise.all([
            CardTemplate.find({ _id: { $in: templateIds } })
                .populate('frontElements')
                .populate('backElements')
                .lean(),
            Card.find({ boxId: { $in: boxIds } })
                .populate('elements')
                .sort({ orderInBox: 1 })
                .lean()
        ]);

        // 4. Assemble in Code: Stitch the data together in memory. This is extremely fast.
        const fullBoxData = userBoxes.map(box => {
            // Find the template for this specific box from the bulk-fetched templates.
            const cardTemplate = allTemplates.find(t => t._id.toString() === box.cardTemplateId.toString());
            // Filter the cards for this specific box from the bulk-fetched cards.
            const cards = allCards.filter(c => c.boxId.toString() === box._id.toString());

            // Return the final, consistent response object for this box.
            return {
                box,
                cardTemplate,
                cards
            };
        });

        successResponse(res, "User boxes retrieved successfully.", fullBoxData);
    } catch (error) {
        console.error("Error in getUserBoxes:", error);
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

exports.updateBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const updates = req.body;

        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, userId: userId } : { _id: boxId, isGuestBox: true };

        delete updates.userId; delete updates.isGuestBox;

        const updatedBox = await Box.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true })
            .populate('boxFrontElementIds').populate('boxBackElementIds').lean();

        if (!updatedBox) return errorResponse(res, "Box not found or not authorized to update.", 404);

        successResponse(res, "Box updated successfully.", updatedBox);
    } catch (error) {
        errorResponse(res, "Error updating box.", 500, "BOX_UPDATE_FAILED", error.message);
    }
};

exports.deleteBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, userId: userId } : { _id: boxId, isGuestBox: true };

        const boxToDelete = await Box.findOne(query);
        if (!boxToDelete) return errorResponse(res, "Box not found or not authorized.", 404);

        // ... (cascading delete logic for cards and elements remains the same) ...

        successResponse(res, "Box and all its contents deleted successfully.", { boxId });
    } catch (error) {
        errorResponse(res, "Error deleting box.", 500, "BOX_DELETE_FAILED", error.message);
    }
};

exports.addBoxElement = async (req, res) => {
    try {
        const { boxId } = req.params;
        const { isFrontElement, ...elementProps } = req.body;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, userId: userId } : { _id: boxId, isGuestBox: true };

        const box = await Box.findOne(query);
        if (!box) return errorResponse(res, "Box not found or not authorized.", 404);

        const isGuest = !box.userId;
        const newElement = await new Element({
            ...elementProps,
            boxId: box._id,
            cardId: null,
            userId: box.userId,
            isGuestElement: isGuest,
            isFrontElement
        }).save();

        const arrayPath = isFrontElement ? 'boxFrontElementIds' : 'boxBackElementIds';
        await Box.findByIdAndUpdate(boxId, { $push: { [arrayPath]: newElement._id } });

        successResponse(res, "Element added to box.", { element: newElement }, 201);
    } catch (error) {
        errorResponse(res, "Failed to add element to box.", 500, "ADD_BOX_ELEMENT_FAILED", error.message);
    }
};

// TODO: addBoxElement, updateBoxElement, deleteBoxElement (for box art)
// These would modify box.boxFrontElements or box.boxBackElements
// Similar to how card elements are managed, but on the Box model.
// Helper function to get the correct element array path for Box elements
const getBoxElementArrayPath = (face) => {
    return face === 'back' ? 'boxBackElementIds' : 'boxFrontElementIds';
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