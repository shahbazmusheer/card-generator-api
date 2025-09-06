const mongoose = require('mongoose');

// The CustomDesignSchema is no longer needed and has been removed.

const CardSchema = new mongoose.Schema({
    name: {
        type: String,
        default: 'Untitled Card'
    },
    boxId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Box',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    isGuestCard: {
        type: Boolean,
        default: true
    },
    orderInBox: {
        type: Number,
        default: 0
    },
    widthPx: {
        type: Number,
        required: true
    },
    heightPx: {
        type: Number,
        required: true
    },

    // --- NEW, SIMPLIFIED STRUCTURE ---

    // A flag to determine if this card uses the master template or its own design.
    isCustomDesign: {
        type: Boolean,
        default: false
    },

    // A single array to hold this card's elements.
    // - If isCustomDesign is FALSE, this holds only the unique elements (e.g., text).
    // - If isCustomDesign is TRUE, this holds ALL elements for the card (background, frame, text, etc.).
    elements: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Element'
    }],

    metadata: {
        aiFrontImagePromptUsed: String,
        aiTextPromptUsed: String,
        frontImageSource: String
    },
}, { timestamps: true });

module.exports = mongoose.model('Card', CardSchema);