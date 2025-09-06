const axios = require('axios');
const FormData = require('form-data');

// All constants related to prompt optimization and font selection have been removed.
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const STABILITY_API_HOST_V2 = 'https://api.stability.ai/v2beta/stable-image/generate/ultra';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL;
const GEMINI_API_HOST = 'https://generativelanguage.googleapis.com/v1beta';

const PIXIAN_API_KEY = process.env.PIXIAN_API_KEY;
const PIXIAN_API_SECRET = process.env.PIXIAN_API_SECRET;
const PIXIAN_API_HOST = 'https://api.pixian.ai/api/v2/remove-background';

const BOX_DESCRIPTION_SYSTEM_INSTRUCTION = `
You are a creative writer for the back of a game box.
Based on the user's theme, write a short, exciting, and thematic description for the card game.
- The description should be a single paragraph, between 2 to 4 sentences long.
- Capture the essence and mood of the game.
- Do NOT include any conversational text, introductions, or summaries.
- Your entire response must be ONLY the description text.
`;

function parseStabilityAIError(error) {
    if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 402) return "Image generation failed: Insufficient credits.";
        if (error.response.status === 401) return "Image generation failed: Invalid API Key.";
        if (error.response.data) {
            try {
                const responseBody = Buffer.from(error.response.data).toString('utf-8');
                const parsedError = JSON.parse(responseBody);
                return `Image generation failed: ${parsedError.errors ? parsedError.errors.join(', ') : 'Unknown API Error'}`;
            } catch (e) {
                return `Image generation failed with status ${error.response.status}.`;
            }
        }
    }
    return "Image generation failed due to an unknown network error.";
}

async function generateImageWithStabilityAI_V2(prompt, requestedOutputFormat = 'png', aspectRatio = '1:1') {
    if (!STABILITY_API_KEY) {
        return { success: false, data: null, error: "Image generation is not configured on the server." };
    }
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('output_format', requestedOutputFormat);
    formData.append('aspect_ratio', aspectRatio);
    try {
        const response = await axios.post(STABILITY_API_HOST_V2, formData, {
            responseType: 'arraybuffer',
            headers: { ...formData.getHeaders(), Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'image/*' },
            timeout: 60000,
        });
        if (response.status === 200) {
            const imageBuffer = Buffer.from(response.data);
            if (imageBuffer.length === 0) {
                return { success: false, data: null, error: "Image generation failed: The API returned an empty image." };
            }
            const base64String = imageBuffer.toString('base64');
            const finalDataUri = `data:image/png;base64,${base64String}`;
            return { success: true, data: finalDataUri, error: null };
        } else {
            return { success: false, data: null, error: `Image generation failed with status ${response.status}.` };
        }
    } catch (error) {
        const errorMessage = parseStabilityAIError(error);
        console.error(`STABILITY AI LOG: ${errorMessage}`);
        return { success: false, data: null, error: errorMessage };
    }
}

async function generateTextWithGemini(promptText, model = GEMINI_TEXT_MODEL, systemInstructionText = null) {
    if (!GEMINI_API_KEY) {
        console.error('Gemini API key not configured.');
        throw new Error('Gemini API key not configured.');
    }
    const apiUrl = `${GEMINI_API_HOST}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const requestBody = { contents: [{ parts: [{ text: promptText, }], }], };
    if (systemInstructionText && typeof systemInstructionText === 'string' && systemInstructionText.trim() !== '') {
        requestBody.system_instruction = { parts: [{ text: systemInstructionText }] };
    }
    try {
        const response = await axios.post(apiUrl, requestBody, { headers: { 'Content-Type': 'application/json', }, timeout: 30000, });
        if (response.status === 200 && response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Gemini API response in unexpected format.');
        }
    } catch (error) {
        console.error('--- Gemini API Call Failed ---');
        throw error;
    }
}

async function removeBackgroundWithPixian(imageBuffer) {
    if (!PIXIAN_API_KEY || !PIXIAN_API_SECRET) {
        console.error('Pixian API key or secret not configured. Skipping background removal.');
        return null;
    }
    if (!imageBuffer || imageBuffer.length === 0) {
        console.warn('Received empty buffer for background removal. Skipping.');
        return null;
    }
    const formData = new FormData();
    formData.append('image', imageBuffer, 'image-to-clean.png');
    formData.append('test', 'true'); // For Test Devolepment


    try {
        const response = await axios.post(PIXIAN_API_HOST, formData, {
            responseType: 'arraybuffer',
            headers: { ...formData.getHeaders() },
            auth: { username: PIXIAN_API_KEY, password: PIXIAN_API_SECRET },
            timeout: 60000,
        });
        if (response.status === 200) {
            const cleanedImageBuffer = Buffer.from(response.data);
            return `data:image/png;base64,${cleanedImageBuffer.toString('base64')}`;
        }
        return null;
    } catch (error) {
        console.error('--- Pixian API Call Failed ---');
        return null;
    }
}

const CARD_BACK_DESIGN_PROMPT_ADDITION = `
Beautiful, intricate, symmetrical design for the back of a playing card. 
Style: Ornate patterns, elegant, fantasy, epic. 
IMPORTANT: The image should be a background pattern only or can include theme , with no text and no characters.
`;

module.exports = {
    generateImageWithStabilityAI: generateImageWithStabilityAI_V2,
    generateTextWithGemini,
    removeBackgroundWithPixian,
    CARD_BACK_DESIGN_PROMPT_ADDITION,
    BOX_DESCRIPTION_SYSTEM_INSTRUCTION
};