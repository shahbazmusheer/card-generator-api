const axios = require('axios');
const FormData = require('form-data');

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const STABILITY_API_HOST_V2 = 'https://api.stability.ai/v2beta/stable-image/generate/ultra';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL;
const GEMINI_API_HOST = 'https://generativelanguage.googleapis.com/v1beta';

const PIXIAN_API_KEY = process.env.PIXIAN_API_KEY;
const PIXIAN_API_SECRET = process.env.PIXIAN_API_SECRET;
const PIXIAN_API_HOST = 'https://api.pixian.ai/api/v2/remove-background';


/**
 * A helper function to parse Axios errors from Stability AI into a clean, readable message.
 * @param {Error} error - The Axios error object.
 * @returns {string} A user-friendly error reason.
 */
function parseStabilityAIError(error) {
    if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 402) {
            return "Image generation failed: Insufficient credits.";
        }
        if (error.response.status === 401) {
            return "Image generation failed: Invalid API Key.";
        }
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

/**
 * Generates an image with Stability AI. This function NO LONGER THROWS on API failure.
 * Instead, it returns an object indicating success and providing either data or an error message.
 * @returns {Promise<{success: boolean, data: string|null, error: string|null}>}
 */
async function generateImageWithStabilityAI_V2(prompt, requestedOutputFormat = 'png', aspectRatio = '1:1') {
    if (!STABILITY_API_KEY) {
        return { success: false, data: null, error: "Image generation is not configured on the server." };
    }

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('output_format', requestedOutputFormat);
    formData.append('aspect_ratio', aspectRatio);

    try {
        console.log(`Calling Stability AI v2beta with prompt: "${prompt}", Aspect Ratio: ${aspectRatio}`);
        const response = await axios.post(
            STABILITY_API_HOST_V2,
            formData,
            {
                responseType: 'arraybuffer',
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${STABILITY_API_KEY}`,
                    Accept: 'image/*',
                },
                timeout: 60000,
            }
        );

        if (response.status === 200) {
            const imageBuffer = Buffer.from(response.data);
            if (imageBuffer.length === 0) {
                const errorMessage = "Image generation failed: The API returned an empty image.";
                console.error(`STABILITY AI LOG: ${errorMessage}`);
                return { success: false, data: null, error: errorMessage };
            }
            const base64String = imageBuffer.toString('base64');
            const finalDataUri = `data:image/png;base64,${base64String}`;
            return { success: true, data: finalDataUri, error: null };
        } else {
             const errorMessage = `Image generation failed with status ${response.status}.`;
             console.error(`STABILITY AI LOG: ${errorMessage}`);
             return { success: false, data: null, error: errorMessage };
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
    const requestBody = {
        contents: [{ parts: [{ text: promptText, }], }],
    };
    if (systemInstructionText && typeof systemInstructionText === 'string' && systemInstructionText.trim() !== '') {
        requestBody.system_instruction = { parts: [{ text: systemInstructionText }] };
    }
    try {
        const response = await axios.post(apiUrl, requestBody, {
            headers: { 'Content-Type': 'application/json', },
            timeout: 30000,
        });
        if (response.status === 200 && response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Gemini API response in unexpected format.');
        }
    } catch (error) {
        console.error('--- Gemini API Call Failed ---');
        // Let Gemini errors still be fatal as they are required for text content
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
    formData.append('test', 'true');
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
        return null; // Return null on failure so the process can continue
    }
}

module.exports = {
    generateImageWithStabilityAI: generateImageWithStabilityAI_V2,
    generateTextWithGemini,
    removeBackgroundWithPixian,
};