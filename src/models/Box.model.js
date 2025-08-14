// src/models/Box.model.js
const mongoose = require('mongoose');
// No need to import Element model here if only storing ObjectIds with ref

const BoxSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    userId: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: false,
        index: true
    },
    // --- NEW FIELD FOR PUBLIC SHARING ---
    // This flag determines if the box can be viewed via a public link.
    // It is 'false' by default, meaning all user projects are private until shared.
    isPublic: {
        type: Boolean,
        default: false,
        index: true
    },
    isGuestBox: { // Flag to indicate if it's a guest-created box
        type: Boolean,
        default: true
    },
    defaultCardWidthPx: { type: Number, default: 315 },
    defaultCardHeightPx: { type: Number, default: 440 },
    baseAISettings: {
        userPrompt: String,
        genre: String,
        accentColorHex: String,
        imageAspectRatio: String,
        imageOutputFormat: String,
        cardBackImage: String // DataURI or URL for the default back for cards in this box
    },
    
    // --- NEW FIELD ---
    // Embeds the game rules directly in the box document for quick access.
    // This is managed and updated by the RuleSet controller.
    ruleSetId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RuleSet',
        required: false // Not every box must have rules
    },
    game_rules: {
        difficulty_level: { type: String, enum: ['easier', 'moderate', 'expert'] },
        game_roles: { type: Number },
        rules_data: [{
            _id: false, // Don't add mongoose _id to subdocuments
            heading: { type: String },
            description: { type: String },
            status: { type: String, enum: ['enabled', 'disabled'] }
        }]
    },

    // Elements for the box itself (e.g., box art front/back)
    // These store ObjectId references to documents in the 'Element' collection
    boxFrontElementIds: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Element' 
    }],
    boxBackElementIds: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Element' 
    }]

}, { timestamps: true });

module.exports = mongoose.models.Box || mongoose.model('Box', BoxSchema);