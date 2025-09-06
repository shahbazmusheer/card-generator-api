// src/controllers/box.controller.js
const Box = require('../models/Box.model');
const Card = require('../models/Card.model');
const Element = require('../models/Element.model');
const CardTemplate = require('../models/CardTemplate.model');
const aiService = require('../services/ai.service');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const RuleSet = require('../models/RuleSet.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const { CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION, CARD_TITLE_SYSTEM_INSTRUCTION } = require('../constants/aiPrompts');
const getImageColors = require('get-image-colors');

// --- HELPER FUNCTIONS ---
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

function getContrastingTextColor(hexColor) {
    if (!hexColor || hexColor.length < 4) return '#000000';
    let r = parseInt(hexColor.slice(1, 3), 16);
    let g = parseInt(hexColor.slice(3, 5), 16);
    let b = parseInt(hexColor.slice(5, 7), 16);
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
    return hsp > 127.5 ? '#000000' : '#FFFFFF';
}

const normalizeBox = (box) => {
    if (!box) return null;
    return {
        ...box,
        ruleSetId: box.ruleSetId || null,
        game_rules: box.game_rules || null,
        boxDesign: box.boxDesign || { frontElements: [], backElements: [], topElements: [], bottomElements: [], leftElements: [], rightElements: [] }
    };
};

// --- THIS IS THE SINGLE, CORRECT DECLARATION ---
const populateBoxPaths = [
    { path: 'boxDesign.frontElements' }, { path: 'boxDesign.backElements' },
    { path: 'boxDesign.topElements' }, { path: 'boxDesign.bottomElements' },
    { path: 'boxDesign.leftElements' }, { path: 'boxDesign.rightElements' }
];

// --- MAIN DECK GENERATION METHOD ---
exports.generateNewDeckAndBox = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Advanced Box Design) started.");
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

        // --- PHASE 1: RULESET, FONT, & TEXT GENERATION ---
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

        const [textData, visualData] = await Promise.all([
            (async () => {
                const [textList, name, desc] = await Promise.all([
                    aiService.generateTextWithGemini(`Game Context:\n${rulesContextString}\n\nBased on "${userPrompt}", generate ${numCardsInDeck} unique text contents for cards.`, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION),
                    boxName ? Promise.resolve(boxName) : aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION),
                    userBoxDescription ? Promise.resolve(userBoxDescription) : aiService.generateTextWithGemini(userPrompt, undefined, aiService.BOX_DESCRIPTION_SYSTEM_INSTRUCTION)
                ]);
                let textItems = (textList || '').split('\n').map(item => item.trim()).filter(Boolean);
                while (textItems.length < numCardsInDeck) { textItems.push(`[Content ${textItems.length + 1}]`); }
                return { textItemsArray: textItems, finalBoxName: boxName || name.trim(), finalBoxDescription: userBoxDescription || desc.trim() };
            })(),
            (async () => {
                const basePrompt = `${userPrompt}, ${genre}, digital art.`;
                const [bgRes, backRes, charRes, boxFrontRes, boxBackRes, patternRes] = await Promise.all([
                    aiService.generateImageWithStabilityAI(`Scenic background, no characters, ${basePrompt}`, 'png', '2:3'),
                    aiService.generateImageWithStabilityAI(`Card back design. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', '2:3'),
                    includeCharacterArt ? aiService.generateImageWithStabilityAI(`Isolated character, on a solid white background, ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false }),
                    generateBoxDesign ? aiService.generateImageWithStabilityAI(`Front of product box, title "${boxName}", ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false }),
                    generateBoxDesign ? aiService.generateImageWithStabilityAI(`Back of product box, retail packaging, ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false }),
                    generateBoxDesign ? aiService.generateImageWithStabilityAI(`Seamless, intricate background pattern, thematically consistent with: ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false })
                ]);
                return { bgResult: bgRes, backResult: backRes, mainIllustrationResult: charRes, boxFrontResult: boxFrontRes, boxBackResult: boxBackRes, patternResult: patternRes };
            })()
        ]);

        const { textItemsArray, finalBoxName, finalBoxDescription } = textData;
        const { bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult, patternResult } = visualData;

        const boxWidthPx = Math.round(defaultCardWidthPx * 1.05);
        const boxHeightPx = Math.round(defaultCardHeightPx * 1.05);
        const newBoxData = { name: finalBoxName, description: finalBoxDescription, userId, isGuestBox: isGuest, defaultCardWidthPx, defaultCardHeightPx, boxWidthPx, boxHeightPx, ruleSetId: ruleSetId || null, game_rules };
        const savedBox = await new Box(newBoxData).save();
        const savedTemplate = await new CardTemplate({ boxId: savedBox._id }).save();
        savedBox.cardTemplateId = savedTemplate._id;

        const masterFrontElements = [];
        if (bgResult.success) masterFrontElements.push({ type: 'image', imageUrl: bgResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx });
        if (mainIllustrationResult.success) {
            const refinedUri = await aiService.removeBackgroundWithPixian(Buffer.from(mainIllustrationResult.data.split(',')[1], 'base64'));
            const charSize = 280; masterFrontElements.push({ type: 'image', imageUrl: refinedUri || mainIllustrationResult.data, zIndex: 2, x: (defaultCardWidthPx - charSize) / 2, y: (defaultCardHeightPx - charSize) / 2, width: charSize, height: charSize });
        }
        const frontTemplateElements = await Element.insertMany(masterFrontElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: true })));
        savedTemplate.frontElements = frontTemplateElements.map(e => e._id);
        const backTemplateElements = [];
        if (backResult.success) {
            const backEl = await new Element({ type: 'image', imageUrl: backResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx, isFrontElement: false, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            backTemplateElements.push(backEl);
        }
        savedTemplate.backElements = backTemplateElements.map(e => e._id);
        await savedTemplate.save();

        for (let i = 0; i < numCardsInDeck; i++) {
            const textBg = await new Element({ type: 'shape', zIndex: 3, x: 40, y: 275, width: 235, height: 120, fillColor: 'rgba(0,0,0,0.5)', borderRadius: 15, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const textEl = await new Element({ type: 'text', content: textItemsArray[i], zIndex: 5, x: 50, y: 280, width: 215, height: 120, color: '#FFFFFF', boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            await new Card({ name: `${finalBoxName} - Card ${i + 1}`, boxId: savedBox._id, userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, elements: [textBg._id, textEl._id] }).save();
        }

        if (generateBoxDesign) {
            const boxFront = [], boxBack = [], boxTop = [], boxBottom = [], boxLeft = [], boxRight = [];
            if (boxFrontResult.success) boxFront.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx });
            if (boxBackResult.success) boxBack.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx });

            if (patternResult.success) {
                const panelDepth = Math.round(boxWidthPx * 0.3);
                const lrPanelElement = { type: 'image', imageUrl: patternResult.data, zIndex: 0, x: 0, y: 0, width: panelDepth, height: boxHeightPx };
                boxLeft.push(lrPanelElement); boxRight.push(lrPanelElement);
                const tbPanelElement = { type: 'image', imageUrl: patternResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: panelDepth };
                boxTop.push(tbPanelElement); boxBottom.push(tbPanelElement);
            }

            const [fe, be, te, boe, le, re] = await Promise.all([
                Element.insertMany(boxFront.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBack.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: false }))),
                Element.insertMany(boxTop.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBottom.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxLeft.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxRight.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })))
            ]);

            savedBox.boxDesign = {
                frontElements: fe.map(e => e._id), backElements: be.map(e => e._id),
                topElements: te.map(e => e._id), bottomElements: boe.map(e => e._id),
                leftElements: le.map(e => e._id), rightElements: re.map(e => e._id)
            };
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate(populateBoxPaths).lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements backElements').lean();
        const finalCards = await Card.find({ boxId: savedBox._id }).populate('elements').lean();

        successResponse(res, `Box "${finalBoxName}" created.`, { box: normalizeBox(finalBox), cardTemplate: finalCardTemplate, cards: finalCards }, 201);
    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

// --- MAIN DECK GENERATION METHOD ---
exports.generateNewDeckAndBoxx = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Advanced Box Design) started.");
    const generationWarnings = [];
    try {
        const { userPrompt, boxName, numCardsInDeck = 1, generateBoxDesign = true, includeCharacterArt = false, defaultCardWidthPx = 315, defaultCardHeightPx = 440, ...otherParams } = req.body;
        let userId = null; let isGuest = true;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (user) { userId = user._id; isGuest = false; }
            } catch (err) { /* proceed as guest */ }
        }
        if (!userPrompt) return errorResponse(res, "An AI Prompt is required.", 400);

        const [textData, visualData] = await Promise.all([
            (async () => {
                const [textList, name, desc] = await Promise.all([
                    aiService.generateTextWithGemini(`Based on "${userPrompt}", generate ${numCardsInDeck} unique text contents for cards.`, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION),
                    boxName ? Promise.resolve(boxName) : aiService.generateTextWithGemini(userPrompt, undefined, CARD_TITLE_SYSTEM_INSTRUCTION),
                    otherParams.boxDescription ? Promise.resolve(otherParams.boxDescription) : aiService.generateTextWithGemini(userPrompt, undefined, aiService.BOX_DESCRIPTION_SYSTEM_INSTRUCTION)
                ]);
                let textItems = (textList || '').split('\n').map(item => item.trim()).filter(Boolean);
                while (textItems.length < numCardsInDeck) { textItems.push(`[Content ${textItems.length + 1}]`); }
                return { textItemsArray: textItems, finalBoxName: boxName || name.trim(), finalBoxDescription: otherParams.boxDescription || desc.trim() };
            })(),
            (async () => {
                const basePrompt = `${userPrompt}, ${otherParams.genre || 'Fantasy'}, digital art.`;
                const [bgRes, backRes, charRes, boxFrontRes, boxBackRes, patternRes] = await Promise.all([
                    aiService.generateImageWithStabilityAI(`Scenic background, no characters, ${basePrompt}`, 'png', '2:3'),
                    aiService.generateImageWithStabilityAI(`Card back design. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', '2:3'),
                    includeCharacterArt ? aiService.generateImageWithStabilityAI(`Isolated character, on a solid white background, ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false }),
                    generateBoxDesign ? aiService.generateImageWithStabilityAI(`Front of product box, title "${boxName}", ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false }),
                    generateBoxDesign ? aiService.generateImageWithStabilityAI(`Back of product box, retail packaging, ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false }),
                    generateBoxDesign ? aiService.generateImageWithStabilityAI(`Seamless, intricate background pattern, ${basePrompt}`, 'png', '1:1') : Promise.resolve({ success: false })
                ]);
                return { bgResult: bgRes, backResult: backRes, mainIllustrationResult: charRes, boxFrontResult: boxFrontRes, boxBackResult: boxBackRes, patternResult: patternRes };
            })()
        ]);

        const { textItemsArray, finalBoxName, finalBoxDescription } = textData;
        const { bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult, patternResult } = visualData;

        const boxWidthPx = Math.round(defaultCardWidthPx * 1.05);
        const boxHeightPx = Math.round(defaultCardHeightPx * 1.05);
        const savedBox = await new Box({ name: finalBoxName, description: finalBoxDescription, userId, isGuestBox: isGuest, defaultCardWidthPx, defaultCardHeightPx, boxWidthPx, boxHeightPx }).save();
        const savedTemplate = await new CardTemplate({ boxId: savedBox._id }).save();
        savedBox.cardTemplateId = savedTemplate._id;

        const masterFrontElements = [];
        if (bgResult.success) masterFrontElements.push({ type: 'image', imageUrl: bgResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx });
        if (mainIllustrationResult.success) {
            const refinedUri = await aiService.removeBackgroundWithPixian(Buffer.from(mainIllustrationResult.data.split(',')[1], 'base64'));
            const charSize = 280; masterFrontElements.push({ type: 'image', imageUrl: refinedUri || mainIllustrationResult.data, zIndex: 2, x: (defaultCardWidthPx - charSize) / 2, y: (defaultCardHeightPx - charSize) / 2, width: charSize, height: charSize });
        }
        const frontTemplateElements = await Element.insertMany(masterFrontElements.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: true })));
        savedTemplate.frontElements = frontTemplateElements.map(e => e._id);
        const backTemplateElements = [];
        if (backResult.success) {
            const backEl = await new Element({ type: 'image', imageUrl: backResult.data, zIndex: 0, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx, isFrontElement: false, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            backTemplateElements.push(backEl);
        }
        savedTemplate.backElements = backTemplateElements.map(e => e._id);
        await savedTemplate.save();

        for (let i = 0; i < numCardsInDeck; i++) {
            const textBg = await new Element({ type: 'shape', zIndex: 3, x: 40, y: 275, width: 235, height: 120, fillColor: 'rgba(0,0,0,0.5)', borderRadius: 15, boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            const textEl = await new Element({ type: 'text', content: textItemsArray[i], zIndex: 5, x: 50, y: 280, width: 215, height: 120, color: '#FFFFFF', boxId: savedBox._id, isGuestElement: isGuest, userId }).save();
            await new Card({ name: `${finalBoxName} - Card ${i + 1}`, boxId: savedBox._id, userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, elements: [textBg._id, textEl._id] }).save();
        }

        if (generateBoxDesign) {
            const boxFront = [], boxBack = [], boxTop = [], boxBottom = [], boxLeft = [], boxRight = [];
            if (boxFrontResult.success) boxFront.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx });
            if (boxBackResult.success) boxBack.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx });

            let dominantColor = '#34495e';
            if (boxFrontResult.success) {
                try { const colors = await getImageColors(Buffer.from(boxFrontResult.data.split(',')[1], 'base64')); dominantColor = colors[0].hex(); } catch (e) { console.warn("Color analysis failed."); }
            }

            const sidePanelShape = { type: 'shape', shapeType: 'rectangle', fillColor: dominantColor, zIndex: 0, x: 0, y: 0 };
            const sidePanelElements = [sidePanelShape];
            if (patternResult.success) {
                sidePanelElements.push({ type: 'image', imageUrl: patternResult.data, zIndex: 1, x: 0, y: 0, opacity: 0.3 });
            }

            const panelDepth = Math.round(boxWidthPx * 0.3);
            boxLeft.push(...sidePanelElements.map(el => ({ ...el, width: panelDepth, height: boxHeightPx })));
            boxRight.push(...sidePanelElements.map(el => ({ ...el, width: panelDepth, height: boxHeightPx })));
            boxTop.push(...sidePanelElements.map(el => ({ ...el, width: boxWidthPx, height: panelDepth })));
            boxBottom.push(...sidePanelElements.map(el => ({ ...el, width: boxWidthPx, height: panelDepth })));

            const [fe, be, te, boe, le, re] = await Promise.all([
                Element.insertMany(boxFront.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBack.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: false }))),
                Element.insertMany(boxTop.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBottom.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxLeft.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxRight.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })))
            ]);

            savedBox.boxDesign = {
                frontElements: fe.map(e => e._id), backElements: be.map(e => e._id),
                topElements: te.map(e => e._id), bottomElements: boe.map(e => e._id),
                leftElements: le.map(e => e._id), rightElements: re.map(e => e._id)
            };
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate(populateBoxPaths).lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements backElements').lean();
        const finalCards = await Card.find({ boxId: savedBox._id }).populate('elements').lean();

        successResponse(res, `Box "${finalBoxName}" created.`, { box: normalizeBox(finalBox), cardTemplate: finalCardTemplate, cards: finalCards }, 201);
    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};


exports.generateNewDeckAndBoxOldNew = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Final & Simplified Box Design) started.");
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

        // --- PHASE 1: RULESET, FONT, & TEXT GENERATION ---
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
        const baseArtPrompt = `${userPrompt}, ${genre}, ${cardColorTheme}, digital art, cinematic lighting, high detail.`;
        const backgroundPrompt = `Scenic atmospheric landscape art for a TCG background, including an integrated decorative frame, no characters, no text, ${baseArtPrompt}`;
        const illustrationPrompt = `Isolated TCG character art, full body, on a plain solid white background, NO shadows, NO environment, ${baseArtPrompt}`;
        const boxFrontPrompt = `Product packaging art for the 2D front of a tuck box, a title box with decorative frame written the text: "${finalBoxName}", ${baseArtPrompt}`;
        const boxBackPrompt = `Back of product box, retail packaging, ${baseArtPrompt}`;
        const sidePanelPatternPrompt = `Seamless, intricate, decrative but less quantitative textures(shapes,lines) only with aspect ratios (9:21), thematic background pattern with lines and shapes based on the related content for ${boxName}, just to fit on box sides, must not have characters, must not have text`;

        const [bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult, patternResult] = await Promise.all([
            aiService.generateImageWithStabilityAI(backgroundPrompt, 'png', cardAspectRatio),
            aiService.generateImageWithStabilityAI(`Card back design, should include theme for: ${boxName}. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', cardAspectRatio),
            includeCharacterArt ? aiService.generateImageWithStabilityAI(illustrationPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxFrontPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxBackPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(sidePanelPatternPrompt, 'png', '1:1') : Promise.resolve({ success: false })
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
            const boxFront = [], boxBack = [], boxTop = [], boxBottom = [], boxLeft = [], boxRight = [];
            if (boxFrontResult.success) boxFront.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx });
            if (boxBackResult.success) boxBack.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx });

            let dominantColor = '#34495e';
            if (boxFrontResult.success) {
                try { const colors = await getImageColors(Buffer.from(boxFrontResult.data.split(',')[1], 'base64')); dominantColor = colors[0].hex(); } catch (e) { console.warn("Color analysis failed."); }
            }

            const sidePanelShape = { type: 'shape', shapeType: 'rectangle', fillColor: dominantColor, zIndex: 0, x: 0, y: 0 };
            const sidePanelElements = [sidePanelShape];
            if (patternResult.success) {
                sidePanelElements.push({ type: 'image', imageUrl: patternResult.data, zIndex: 1, x: 0, y: 0, opacity: 0.3 });
            }

            const panelDepth = Math.round(boxWidthPx * 0.3);
            boxLeft.push(...sidePanelElements.map(el => ({ ...el, width: panelDepth, height: boxHeightPx })));
            boxRight.push(...sidePanelElements.map(el => ({ ...el, width: panelDepth, height: boxHeightPx })));
            boxTop.push(...sidePanelElements.map(el => ({ ...el, width: boxWidthPx, height: panelDepth })));
            boxBottom.push(...sidePanelElements.map(el => ({ ...el, width: boxWidthPx, height: panelDepth })));

            const [fe, be, te, boe, le, re] = await Promise.all([
                Element.insertMany(boxFront.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBack.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: false }))),
                Element.insertMany(boxTop.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBottom.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxLeft.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxRight.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })))
            ]);

            savedBox.boxDesign = {
                frontElements: fe.map(e => e._id), backElements: be.map(e => e._id),
                topElements: te.map(e => e._id), bottomElements: boe.map(e => e._id),
                leftElements: le.map(e => e._id), rightElements: re.map(e => e._id)
            };
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate(populateBoxPaths).lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements backElements').lean();
        const finalCards = await Card.find({ boxId: savedBox._id }).populate('elements').lean();

        successResponse(res, `Box "${finalBoxName}" created.`, { box: normalizeBox(finalBox), cardTemplate: finalCardTemplate, cards: finalCards }, 201);
    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

exports.generateNewDeckAndBoxOldOld = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Final & Simplified Box Design) started.");
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

        // --- PHASE 1: RULESET, FONT, & TEXT GENERATION ---
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
        const baseArtPrompt = `${userPrompt}, ${genre}, ${cardColorTheme}, digital art, cinematic lighting, high detail.`;
        const backgroundPrompt = `Scenic atmospheric landscape art for a TCG background, including an integrated decorative frame, no characters, no text, ${baseArtPrompt}`;
        const illustrationPrompt = `Isolated TCG character art, full body, on a plain solid white background, NO shadows, NO environment, ${baseArtPrompt}`;
        const boxFrontPrompt = `Product packaging art for the 2D front of a tuck box, a title box with decorative frame written the text: "${finalBoxName}", ${baseArtPrompt}`;
        const boxBackPrompt = `Back of product box, retail packaging, ${baseArtPrompt}`;
        const sidePanelPatternPrompt = `Seamless, intricate, decrative but less quantitative textures(shapes,lines) only with aspect ratios (9:21), thematic background pattern with lines and shapes based on the related content for ${boxName}, just to fit on box sides, must not have characters, must not have text`;

        const [bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult, patternResult] = await Promise.all([
            aiService.generateImageWithStabilityAI(backgroundPrompt, 'png', cardAspectRatio),
            aiService.generateImageWithStabilityAI(`Card back design, should include theme for: ${boxName}. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', cardAspectRatio),
            includeCharacterArt ? aiService.generateImageWithStabilityAI(illustrationPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxFrontPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxBackPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(sidePanelPatternPrompt, 'png', '1:1') : Promise.resolve({ success: false })
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
            const boxFront = [], boxBack = [], boxTop = [], boxBottom = [], boxLeft = [], boxRight = [];
            if (boxFrontResult.success) boxFront.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxFrontResult.error);
            if (boxBackResult.success) boxBack.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxBackResult.error);

            if (patternResult.success) {
                // --- THIS IS THE FIX ---
                // The 'width' and 'height' for the side panels are now correctly defined for dielines.
                // A typical tuck box has a depth of around 0.75 inches, while the card width is 2.5 inches.
                const panelDepth = Math.round(boxWidthPx * 0.3); // Approx 30% of the width

                // Left and Right side panels are tall and thin
                const lrPanelElement = { type: 'image', imageUrl: patternResult.data, zIndex: 0, x: 0, y: 0, width: panelDepth, height: boxHeightPx };
                boxLeft.push(lrPanelElement);
                boxRight.push(lrPanelElement);

                // Top and Bottom panels are wide and short
                const tbPanelElement = { type: 'image', imageUrl: patternResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: panelDepth };
                boxTop.push(tbPanelElement);
                boxBottom.push(tbPanelElement);
            } else {
                generationWarnings.push(patternResult.error);
            }

            const [fe, be, te, boe, le, re] = await Promise.all([
                Element.insertMany(boxFront.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: true }))),
                Element.insertMany(boxBack.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: false }))),
                Element.insertMany(boxTop.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBottom.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxLeft.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxRight.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })))
            ]);

            savedBox.boxDesign = {
                frontElements: fe.map(e => e._id), backElements: be.map(e => e._id),
                topElements: te.map(e => e._id), bottomElements: boe.map(e => e._id),
                leftElements: le.map(e => e._id), rightElements: re.map(e => e._id)
            };
            savedBox.boxFrontElementIds = fe.map(e => e._id);
            savedBox.boxBackElementIds = be.map(e => e._id);
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate(populateBoxPaths).lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements').populate('backElements').lean();

        const finalResponseData = { box: normalizeBox(finalBox), cardTemplate: finalCardTemplate, cards: savedCardsForResponse };
        const metadata = generationWarnings.length > 0 ? { warnings: [...new Set(generationWarnings)] } : null;
        successResponse(res, `Box "${finalBoxName}" and ${numCardsInDeck} cards created successfully.`, finalResponseData, 201, metadata);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

exports.generateNewDeckAndBoxOld = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox (Final & Simplified Box Design) started.");
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

        // --- PHASE 1: RULESET, FONT, & TEXT GENERATION ---
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
        const baseArtPrompt = `${userPrompt}, ${genre}, ${cardColorTheme}, digital art, cinematic lighting, high detail.`;
        const backgroundPrompt = `Scenic atmospheric landscape art for a TCG background, including an integrated decorative frame, no characters, no text, ${baseArtPrompt}`;
        const illustrationPrompt = `Isolated TCG character art, full body, on a plain solid white background, NO shadows, NO environment, ${baseArtPrompt}`;
        const boxFrontPrompt = `Product packaging art for the front of a 2D tuck box, including an integrated decorative frame with a title "${finalBoxName} and inside a theme:", ${baseArtPrompt}`;
        const boxBackPrompt = `Back of product box, retail packaging, ${baseArtPrompt}`;
        // --- THIS IS THE FIX: New, dedicated prompt for the side panel texture ---
        const sidePanelPatternPrompt = `Seamless, intricate, decrative but less quantitative textures(shapes,lines) only with aspect ratios (1:4), thematic background pattern with lines and shapes based on the related content for ${boxName}, just to fit on box sides, must not have characters, must not have text`;
        // const sidePanelPatternPrompt = `Seamless, intricate, decrative border frames with aspect ratios (1:4), thematic background pattern with lines and shapes based on the related content from ${boxName}, must not have characters, must not have text`;

        const [bgResult, backResult, mainIllustrationResult, boxFrontResult, boxBackResult, patternResult] = await Promise.all([
            aiService.generateImageWithStabilityAI(backgroundPrompt, 'png', cardAspectRatio),
            aiService.generateImageWithStabilityAI(`Card back design. ${aiService.CARD_BACK_DESIGN_PROMPT_ADDITION}`, 'png', cardAspectRatio),
            includeCharacterArt ? aiService.generateImageWithStabilityAI(illustrationPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxFrontPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(boxBackPrompt, 'png', '1:1') : Promise.resolve({ success: false }),
            generateBoxDesign ? aiService.generateImageWithStabilityAI(sidePanelPatternPrompt, 'png', '9:21') : Promise.resolve({ success: false })
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
            const boxFront = [], boxBack = [], boxTop = [], boxBottom = [], boxLeft = [], boxRight = [];
            if (boxFrontResult.success) boxFront.push({ type: 'image', imageUrl: boxFrontResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxFrontResult.error);
            if (boxBackResult.success) boxBack.push({ type: 'image', imageUrl: boxBackResult.data, zIndex: 0, x: 0, y: 0, width: boxWidthPx, height: boxHeightPx }); else generationWarnings.push(boxBackResult.error);

            // --- THIS IS THE FIX: Use the single pattern image for all side panels ---
            if (patternResult.success) {
                const sidePanelElement = { type: 'image', imageUrl: patternResult.data, zIndex: 0, x: 0, y: 0, width: 100, height: boxHeightPx };
                boxTop.push(sidePanelElement);
                boxBottom.push(sidePanelElement);
                boxLeft.push(sidePanelElement);
                boxRight.push(sidePanelElement);
            } else {
                generationWarnings.push(patternResult.error);
            }

            const [fe, be, te, boe, le, re] = await Promise.all([
                Element.insertMany(boxFront.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: true }))),
                Element.insertMany(boxBack.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId, isFrontElement: false }))),
                Element.insertMany(boxTop.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxBottom.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxLeft.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId }))),
                Element.insertMany(boxRight.map(el => ({ ...el, boxId: savedBox._id, isGuestElement: isGuest, userId })))
            ]);

            savedBox.boxDesign = {
                frontElements: fe.map(e => e._id), backElements: be.map(e => e._id),
                topElements: te.map(e => e._id), bottomElements: boe.map(e => e._id),
                leftElements: le.map(e => e._id), rightElements: re.map(e => e._id)
            };
            savedBox.boxFrontElementIds = fe.map(e => e._id);
            savedBox.boxBackElementIds = be.map(e => e._id);
            await savedBox.save();
        }

        const finalBox = await Box.findById(savedBox._id).populate(populateBoxPaths).lean();
        const finalCardTemplate = await CardTemplate.findById(savedTemplate._id).populate('frontElements').populate('backElements').lean();

        const finalResponseData = { box: normalizeBox(finalBox), cardTemplate: finalCardTemplate, cards: savedCardsForResponse };
        const metadata = generationWarnings.length > 0 ? { warnings: [...new Set(generationWarnings)] } : null;
        successResponse(res, `Box "${finalBoxName}" and ${numCardsInDeck} cards created successfully.`, finalResponseData, 201, metadata);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
};

exports.getBoxById = async (req, res) => {
    try {
        const { boxId } = req.params;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, $or: [{ userId: userId }, { isGuestBox: true }] } : { _id: boxId, isGuestBox: true };
        const box = await Box.findOne(query).populate(populateBoxPaths).lean();
        if (!box) return errorResponse(res, "Box not found or not authorized.", 404);

        const cardTemplate = await CardTemplate.findById(box.cardTemplateId).populate('frontElements backElements').lean();
        const cards = await Card.find({ boxId: box._id }).populate('elements').sort({ orderInBox: 1 }).lean();

        successResponse(res, "Box details retrieved successfully.", { box: normalizeBox(box), cardTemplate, cards });
    } catch (error) {
        errorResponse(res, "Error fetching box details.", 500, "FETCH_BOX_FAILED", error.message);
    }
};

exports.getUserBoxes = async (req, res) => {
    try {
        if (!req.user || !req.user.id) return errorResponse(res, "User not authenticated.", 401);
        const userId = req.user.id;

        const boxesFromDB = await Box.find({ userId: userId }).populate(populateBoxPaths).sort({ updatedAt: -1 }).lean();
        if (!boxesFromDB || boxesFromDB.length === 0) return successResponse(res, "User has no boxes.", []);

        const boxIds = boxesFromDB.map(box => box._id);
        const templateIds = boxesFromDB.map(box => box.cardTemplateId);

        const [allTemplates, allCards] = await Promise.all([
            CardTemplate.find({ _id: { $in: templateIds } }).populate('frontElements backElements').lean(),
            Card.find({ boxId: { $in: boxIds } }).populate('elements').sort({ orderInBox: 1 }).lean()
        ]);

        const fullBoxData = boxesFromDB.map(box => {
            const cardTemplate = allTemplates.find(t => t._id.toString() === box.cardTemplateId.toString());
            const cards = allCards.filter(c => c.boxId.toString() === box._id.toString());
            return { box: normalizeBox(box), cardTemplate, cards };
        });

        successResponse(res, "User boxes retrieved successfully.", fullBoxData);
    } catch (error) {
        errorResponse(res, "Failed to retrieve user boxes.", 500, "FETCH_BOXES_FAILED", error.message);
    }
};

exports.getPublicBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const box = await Box.findOne({ _id: boxId, isPublic: true }).populate(populateBoxPaths).lean();
        if (!box) return errorResponse(res, "This box is not public or does not exist.", 404);
        const cardTemplate = await CardTemplate.findById(box.cardTemplateId).populate('frontElements backElements').lean();
        const cards = await Card.find({ boxId: box._id }).populate('elements').sort({ orderInBox: 1 }).lean();
        successResponse(res, "Public box data retrieved successfully.", { box: normalizeBox(box), cardTemplate, cards });
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

        if (box.userId && !box.isGuestBox) {
            const alreadyOwnedBox = await Box.findById(boxId).populate(populateBoxPaths).lean();
            const cardTemplate = await CardTemplate.findById(alreadyOwnedBox.cardTemplateId).populate('frontElements backElements').lean();
            const cards = await Card.find({ boxId: boxId }).populate('elements').sort({ orderInBox: 1 }).lean();
            return successResponse(res, 'Box already associated with your account.', { box: normalizeBox(alreadyOwnedBox), cardTemplate, cards });
        }

        box.userId = userId; box.isGuestBox = false;
        await box.save();
        await Card.updateMany({ boxId: box._id, isGuestCard: true }, { $set: { userId: userId, isGuestCard: false } });
        await Element.updateMany({ boxId: box._id, isGuestElement: true }, { $set: { userId: userId, isGuestElement: false } });
        await CardTemplate.updateMany({ boxId: box._id }, { $set: { userId: userId } });

        const updatedBox = await Box.findById(boxId).populate(populateBoxPaths).lean();
        const cardTemplate = await CardTemplate.findById(updatedBox.cardTemplateId).populate('frontElements backElements').lean();
        const cards = await Card.find({ boxId: boxId }).populate('elements').sort({ orderInBox: 1 }).lean();
        successResponse(res, 'Box, cards, and elements successfully claimed.', { box: normalizeBox(updatedBox), cardTemplate, cards });
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

exports.createBox = async (req, res) => {
    try {
        const { name, description, defaultCardWidthPx = 315, defaultCardHeightPx = 440 } = req.body;
        let userId = null; let isGuest = true;
        if (req.user && req.user.id) { userId = req.user.id; isGuest = false; }
        if (!name) return errorResponse(res, "Box name is required.", 400);

        const boxWidthPx = Math.round(defaultCardWidthPx * 1.05);
        const boxHeightPx = Math.round(defaultCardHeightPx * 1.05);
        const newBox = new Box({ name, description, userId, isGuestBox: isGuest, defaultCardWidthPx, defaultCardHeightPx, boxWidthPx, boxHeightPx });
        const savedBox = await newBox.save();
        successResponse(res, "Box created successfully.", savedBox, 201);
    } catch (error) {
        errorResponse(res, "Failed to create box.", 500, "BOX_CREATION_FAILED", error.message);
    }
};

exports.updateBox = async (req, res) => {
    try {
        const { boxId } = req.params;
        const updates = req.body;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, userId: userId } : { _id: boxId, isGuestBox: true };
        delete updates.userId; delete updates.isGuestBox;
        const updatedBox = await Box.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true }).populate(populateBoxPaths).lean();
        if (!updatedBox) return errorResponse(res, "Box not found or not authorized to update.", 404);
        successResponse(res, "Box updated successfully.", normalizeBox(updatedBox));
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

        await Card.deleteMany({ boxId: boxToDelete._id });
        await Element.deleteMany({ boxId: boxToDelete._id });
        await CardTemplate.findOneAndDelete({ boxId: boxToDelete._id });
        await Box.findByIdAndDelete(boxId);
        successResponse(res, "Box and all its contents deleted successfully.", { boxId });
    } catch (error) {
        errorResponse(res, "Error deleting box.", 500, "BOX_DELETE_FAILED", error.message);
    }
};

exports.addBoxElement = async (req, res) => {
    try {
        const { boxId } = req.params;
        const { face, ...elementProps } = req.body; // Expect 'face' like 'front', 'top', etc.
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: boxId, userId: userId } : { _id: boxId, isGuestBox: true };
        const box = await Box.findOne(query);
        if (!box) return errorResponse(res, "Box not found or not authorized.", 404);

        const isGuest = !box.userId;
        const newElement = await new Element({ ...elementProps, boxId: box._id, cardId: null, userId: box.userId, isGuestElement: isGuest }).save();

        const arrayPath = `boxDesign.${face}Elements`;
        await Box.findByIdAndUpdate(boxId, { $push: { [arrayPath]: newElement._id } });
        successResponse(res, `Element added to box ${face}.`, { element: newElement }, 201);
    } catch (error) {
        errorResponse(res, "Failed to add element to box.", 500, "ADD_BOX_ELEMENT_FAILED", error.message);
    }
};

exports.updateBoxElement = async (req, res) => {
    try {
        const { elementId } = req.params;
        const updates = req.body;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: elementId, userId: userId } : { _id: elementId, isGuestElement: true };
        delete updates._id; delete updates.boxId; delete updates.cardId;
        const updatedElement = await Element.findOneAndUpdate(query, { $set: updates }, { new: true });
        if (!updatedElement) return errorResponse(res, "Box element not found or not authorized.", 404);
        successResponse(res, "Box element updated successfully.", { element: updatedElement });
    } catch (error) {
        errorResponse(res, "Failed to update box element.", 500, "UPDATE_BOX_ELEMENT_FAILED", error.message);
    }
};

exports.deleteBoxElement = async (req, res) => {
    try {
        const { elementId } = req.params;
        const userId = req.user ? req.user.id : null;
        const query = userId ? { _id: elementId, userId: userId } : { _id: elementId, isGuestElement: true };
        const elementToDelete = await Element.findOne(query);
        if (!elementToDelete) return errorResponse(res, "Box element not found or not authorized.", 404);

        const boxId = elementToDelete.boxId;
        // This is complex, we need to find which array it's in. A simpler way is to just delete the element.
        // The frontend will need to refetch the box to see the change.
        await Element.findByIdAndDelete(elementId);

        // A more robust solution would pull from all possible arrays.
        await Box.findByIdAndUpdate(boxId, {
            $pull: {
                'boxDesign.frontElements': elementId, 'boxDesign.backElements': elementId,
                'boxDesign.topElements': elementId, 'boxDesign.bottomElements': elementId,
                'boxDesign.leftElements': elementId, 'boxDesign.rightElements': elementId,
            }
        });

        successResponse(res, "Box element deleted successfully.", { elementId });
    } catch (error) {
        errorResponse(res, "Error deleting box element.", 500, "DELETE_BOX_ELEMENT_FAILED", error.message);
    }
};

// TODO: addBoxElement, updateBoxElement, deleteBoxElement (for box art)
// These would modify box.boxFrontElements or box.boxBackElements
// Similar to how card elements are managed, but on the Box model.
// Helper function to get the correct element array path for Box elements
const getBoxElementArrayPath = (face) => {
    return face === 'back' ? 'boxBackElementIds' : 'boxFrontElementIds';
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
