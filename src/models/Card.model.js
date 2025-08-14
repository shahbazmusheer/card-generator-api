// src/models/Card.model.js
const mongoose = require('mongoose');
const ElementSchema = require('./Element.model.js'); // Import the ElementSchema

const CardSchema = new mongoose.Schema({
    name: { type: String, default: 'Untitled Card' },
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Box', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    isGuestCard: { // Flag to indicate if it's a guest-created box
        type: Boolean,
        default: true
    },
    orderInBox: { type: Number, default: 0 },
    widthPx: { type: Number, required: true },
    heightPx: { type: Number, required: true },

    // Store arrays of ObjectId references to Element documents
    cardFrontElementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    cardBackElementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    // Metadata specific to this card's generation or state
    metadata: {
        // e.g., specific prompt used for this card if different from box,
        // generation status for this specific card's AI content
        aiFrontImagePromptUsed: String,
        aiTextPromptUsed: String,
        frontImageSource: String, // 'ai', 'uploaded', 'predefined_theme', 'placeholder'
        // any other card-specific details
    },
}, { timestamps: true }); // Adds createdAt and updatedAt

module.exports = mongoose.model('Card', CardSchema);