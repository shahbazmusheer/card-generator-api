const mongoose = require('mongoose');

// --- NEW SUB-SCHEMA for the multi-faceted box design ---
const BoxDesignSchema = new mongoose.Schema({
    _id: false,
    frontElements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    backElements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    topElements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    bottomElements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    leftElements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    rightElements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }]
});

const BoxSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    isGuestBox: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: false, index: true },

    cardTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'CardTemplate' },

    defaultCardWidthPx: { type: Number, default: 315 },
    defaultCardHeightPx: { type: Number, default: 440 },
    boxWidthPx: { type: Number },
    boxHeightPx: { type: Number },

    // --- NEW: The structured box design for the dieline editor ---
    boxDesign: {
        type: BoxDesignSchema,
        default: () => ({})
    },

    // --- KEPT FOR BACKWARD COMPATIBILITY ---
    // The main generation logic will now populate both the new and old fields.
    boxFrontElementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],
    boxBackElementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Element' }],

    baseAISettings: { userPrompt: String, genre: String, cardColorTheme: String, fontFamily: String },
    ruleSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'RuleSet', required: false },
    game_rules: {
        difficulty_level: { type: String, enum: ['easier', 'moderate', 'expert'] },
        game_roles: { type: Number },
        rules_data: [{ _id: false, heading: { type: String }, description: { type: String }, status: { type: String, enum: ['enabled', 'disabled'] } }]
    }
}, { timestamps: true });

module.exports = mongoose.models.Box || mongoose.model('Box', BoxSchema);