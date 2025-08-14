// src/controllers/box.controller.js

// ... (keep all existing imports)
const RuleSet = require('../models/RuleSet.model'); // <-- ADD THIS IMPORT

// ... (keep existing CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION constant)

// --- NEW CONSTANT for Game Rules AI Prompt ---
const GAME_RULES_SYSTEM_INSTRUCTION = `
You are a game design assistant. Your task is to generate a set of core game rules based on a user's prompt for a card game.
- The output MUST follow this strict format: Each rule is a heading on its own line, followed by a description in parentheses on the next line.
- Do NOT include any conversational text, introductions, summaries, or any text outside of this heading/description format.
- Do NOT number the headings.
- Example Output Format:
Heading One
(Description for rule one goes here.)
Heading Two
(Description for rule two goes here.)
- Generate between 3 to 5 core rules.
- The rules should be clear, concise, and suitable for the game described in the user's prompt.
`;

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


// ... (keep successResponse, errorResponse, and other helpers)

// --- MODIFIED generateNewDeckAndBox function ---
exports.generateNewDeckAndBox = async (req, res) => {
    console.log("BOX_CONTROLLER: generateNewDeckAndBox started.");
     try {
        const {
            boxName, boxDescription = "", userPrompt, genre = "Educational",
            // NEW: Receive new fields from the request body
            difficulty_level = 'moderate', game_roles = 2,
            accentColorHex = "#333333", defaultCardWidthPx = 315, defaultCardHeightPx = 440,
            imageAspectRatioForDeck = null, imageOutputFormatForDeck = "png",
            numCardsInDeck = 1, cardBackImageDataUri = null,
            fallbackFrontImageBase64DataUri = null
        } = req.body;

        // ... (keep userId/guest logic as is) ...
        let userId = null;
        let isGuest = true;
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
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

        // ... (keep validation logic as is) ...
        if (typeof boxName !== 'string' || boxName.trim() === '') {
            return res.status(400).json({ success: false, message: "Box name is required and must be a valid string." });
        }
        if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim() === '') {
            return res.status(400).json({ success: false, message: "A user prompt is required." });
        }


        // --- 1. Determine AI Settings & Prepare Prompts ---
        // ... (keep aspect ratio logic) ...
        const supportedStabilityRatios = [ { string: "21:9", value: 21/9 }, { string: "16:9", value: 16/9 }, { string: "3:2", value: 3/2 }, { string: "5:4", value: 5/4 }, { string: "1:1", value: 1/1 }, { string: "4:5", value: 4/5 }, { string: "2:3", value: 2/3 }, { string: "9:16", value: 9/16 }, { string: "9:21", value: 9/21 }];
        let finalAspectRatioForAI = getClosestSupportedAspectRatio(defaultCardWidthPx, defaultCardHeightPx, supportedStabilityRatios);
        if (imageAspectRatioForDeck && supportedStabilityRatios.some(r => r.string === imageAspectRatioForDeck)) {
            finalAspectRatioForAI = imageAspectRatioForDeck;
        }

        const aiSettingsForThisBox = { userPrompt: userPrompt, genre: genre, accentColorHex: accentColorHex, imageAspectRatio: finalAspectRatioForAI, imageOutputFormat: imageOutputFormatForDeck, cardBackImage: cardBackImageDataUri };
        
        const imageGenPromptForStability = userPrompt;
        const textListPromptForGemini = `User Request: Generate ${numCardsInDeck} unique, concise but complete data items, max 100 characters long each item... related to "${userPrompt}"...\n\nData Items List: (never include headings, descriptions, only provide single line per item.)`;
        // NEW: Prompt for game rules
        const rulesPromptForGemini = `The game is: "${userPrompt}". Generate rules based on this.`;


        // --- 2. Call AI Services (Now with 3 parallel calls) ---
        let aiFrontImageDataUri, generatedTextListData, generatedRulesTextData;
        let imageGenError = null, textGenError = null, rulesGenError = null;

        const imagePromise = aiService.generateImageWithStabilityAI(imageGenPromptForStability, imageOutputFormatForDeck, finalAspectRatioForAI)
            .catch(err => { imageGenError = err.message; return null; });
        const textPromise = aiService.generateTextWithGemini(textListPromptForGemini, undefined, CONCISE_DUMMY_DATA_SYSTEM_INSTRUCTION)
            .catch(err => { textGenError = err.message; return null; });
        // NEW: AI call for rules
        const rulesPromise = aiService.generateTextWithGemini(rulesPromptForGemini, undefined, GAME_RULES_SYSTEM_INSTRUCTION)
            .catch(err => { rulesGenError = err.message; return null; });

        [aiFrontImageDataUri, generatedTextListData, generatedRulesTextData] = await Promise.all([imagePromise, textPromise, rulesPromise]);

        // --- 3. Process AI Results ---
        // ... (keep image and text list processing) ...
        const aiFrontImageGeneratedSuccessfully = !!aiFrontImageDataUri;
        const textListGeneratedSuccessfully = !!generatedTextListData;
        if (!aiFrontImageGeneratedSuccessfully && !textListGeneratedSuccessfully && !fallbackFrontImageBase64DataUri && !DEFAULT_BACKEND_PLACEHOLDER_IMAGE_URL) {
            return res.status(502).json({ success: false, message: "Both AI failed, no fallbacks available." });
        }
        let finalFrontImageToUse = aiFrontImageGeneratedSuccessfully ? aiFrontImageDataUri : (fallbackFrontImageBase64DataUri || DEFAULT_BACKEND_PLACEHOLDER_IMAGE_URL);
        const textItemsArray = (generatedTextListData || '').split('\n').map(item => item.trim()).filter(item => item.length > 0);
        const finalTextsForCards = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            finalTextsForCards.push(textItemsArray[i] || `[Placeholder - Card ${i + 1}]`);
        }
        
        // NEW: Process and structure game rules
        const parsedRulesData = parseRulesFromAiText(generatedRulesTextData);
        if (parsedRulesData.length === 0) { // Add a fallback rule if AI fails
             parsedRulesData.push({ heading: 'Objective', description: `The objective of the game is based on the theme: ${userPrompt}.`, status: 'enabled' });
             console.log('Rules AI failed or returned empty, using fallback.');
        }

        const gameRulesForBox = {
            difficulty_level,
            game_roles,
            rules_data: parsedRulesData
        };
        

        // --- 4. Create Box Document (now includes game_rules) ---
        const newBoxData = {
            name: boxName.trim(), description: boxDescription, userId,
            isGuestBox: isGuest,
            defaultCardWidthPx, defaultCardHeightPx, aiSettingsForThisBox,
            game_rules: gameRulesForBox // <-- EMBED THE RULES
        };
        const newBox = new Box(newBoxData);
        const savedBox = await newBox.save();
        console.log("BOX_CONTROLLER: Box saved, ID:", savedBox._id);

        // --- NEW: 5. Create Separate RuleSet Document ---
        const newRuleSetData = {
            name: `${savedBox.name} Rules`,
            boxId: savedBox._id,
            userId: savedBox.userId,
            isGuestRuleSet: savedBox.isGuestBox,
            ...gameRulesForBox
        };
        const savedRuleSet = await new RuleSet(newRuleSetData).save();
        console.log("BOX_CONTROLLER: RuleSet saved, ID:", savedRuleSet._id);

        // --- 6. Create Card Data (was step 5) ---
        // ... (This entire section for creating cards and elements remains unchanged) ...
        const generatedCardsDataForResponse = [];
        for (let i = 0; i < numCardsInDeck; i++) {
            // ... all card and element creation logic ...
            const tempCardId = new mongoose.Types.ObjectId();
            const frontImageElementData = { cardId: tempCardId, boxId: savedBox._id, isGuestElement: isGuest, userId: savedBox.userId, isFrontElement: true, type: 'image', imageUrl: finalFrontImageToUse, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx, zIndex: 0 };
            const textContentForCard = finalTextsForCards[i];
            const textBlockX = Math.round(defaultCardWidthPx * 0.1);
            const textBlockY = Math.round((defaultCardHeightPx - (defaultCardHeightPx * 0.45)) / 2);
            const textBlockWidth = Math.round(defaultCardWidthPx * 0.8);
            const textBlockHeight = Math.round(defaultCardHeightPx * 0.45);
            const frontTextElementData = { cardId: tempCardId, boxId: savedBox._id, isGuestElement: isGuest, userId: savedBox.userId, isFrontElement: true, type: 'text', content: textContentForCard, x: textBlockX, y: textBlockY, width: textBlockWidth, height: textBlockHeight, fontSize: "22px", fontFamily: "Arial", color: accentColorHex, textAlign: "center", zIndex: 1 };
            const cardFrontElementDocsData = [frontImageElementData, frontTextElementData];
            const cardBackElementDocsData = [];
            if (cardBackImageDataUri) {
                cardBackElementDocsData.push({ cardId: tempCardId, boxId: savedBox._id, isGuestElement: isGuest, userId: savedBox.userId, isFrontElement: false, type: 'image', imageUrl: cardBackImageDataUri, x: 0, y: 0, width: defaultCardWidthPx, height: defaultCardHeightPx, zIndex: 0 });
            }
            const savedFrontElements = await Element.insertMany(cardFrontElementDocsData);
            const savedBackElements = await Element.insertMany(cardBackElementDocsData);
            const cardToSave = new Card({ _id: tempCardId, name: `${savedBox.name} - Card ${i + 1}`, boxId: savedBox._id, userId: savedBox.userId, isGuestCard: isGuest, orderInBox: i, widthPx: defaultCardWidthPx, heightPx: defaultCardHeightPx, cardFrontElementIds: savedFrontElements.map(el => el._id), cardBackElementIds: savedBackElements.map(el => el._id), metadata: { aiFrontImagePromptUsed: imageGenPromptForStability, aiTextPromptUsed: textListPromptForGemini.split('\n\nData Items List:')[0], frontImageSource: aiFrontImageGeneratedSuccessfully ? 'ai' : (fallbackFrontImageBase64DataUri ? 'frontend_fallback' : 'backend_placeholder'), imageGenerationStatus: imageGenError || "Success", textGenerationStatus: textGenError || "Success"} });
            const savedCard = await cardToSave.save();
            const cardForResponse = savedCard.toObject();
            cardForResponse.cardFrontElements = savedFrontElements.map(el => el.toObject());
            cardForResponse.cardBackElements = savedBackElements.map(el => el.toObject());
            generatedCardsDataForResponse.push(cardForResponse);
        }

        // --- 7. Construct and Send Final Response (was step 6) ---
        const boxResponseObject = savedBox.toObject();
        boxResponseObject.cards = generatedCardsDataForResponse;

        const responseData = {
            box: boxResponseObject,
            imageWasAIgenerated: aiFrontImageGeneratedSuccessfully,
            textListWasGenerated: textListGeneratedSuccessfully,
            rulesWereGenerated: !!generatedRulesTextData,
            rawText: generatedTextListData,
            rawRules: generatedRulesTextData
        };
        
        successResponse(res, `Box "${savedBox.name}" and ${generatedCardsDataForResponse.length} cards created.`, responseData, 201);

    } catch (error) {
        console.error("Error in generateNewDeckAndBox Controller:", error.message, error.stack);
        errorResponse(res, "Error generating new deck and box.", 500, "DECK_GENERATION_FAILED", error.message);
    }
    console.log("CONTROLLER: generateNewDeckAndBox finished.");
};

// ... (keep ALL other functions in box.controller.js as they were) ...