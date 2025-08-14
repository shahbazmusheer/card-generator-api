// src/utils/responseHandler.js

/**
 * Sends a standardized success JSON response.
 * @param {object} res - The Express response object.
 * @param {string} message - A success message.
 * @param {object} data - The payload to send.
 * @param {number} statusCode - The HTTP status code (defaults to 200).
 */
// --- Standard Success Response ---
function successResponse(res, message, data, statusCode = 200, metadata = null) {
    const response = { success: true, message, data };
    if (metadata) response.metadata = metadata;
    res.status(statusCode).json(response);
}

/**
 * Sends a standardized error JSON response.
 * @param {object} res - The Express response object.
 * @param {string} message - A user-friendly error message.
 * @param {number} statusCode - The HTTP status code (defaults to 500).
 * @param {string|object|null} details - Optional technical details or error object.
 */

// --- Standard Error Response ---
function errorResponse(res, message, statusCode = 500, errorCode = null, details = null) {
    const errorPayload = { details: details || message };
    if (errorCode) errorPayload.code = errorCode;
    res.status(statusCode).json({ success: false, message: errorPayload.details });
}


module.exports = {
    successResponse,
    errorResponse
};