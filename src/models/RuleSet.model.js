// src/models/RuleSet.model.js
const mongoose = require('mongoose');

const RuleSchema = new mongoose.Schema({
    _id: false,
    heading: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: ['enabled', 'disabled'], default: 'enabled' }
});

const RuleSetSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, 'A name for the ruleset is required.'], 
        trim: true 
    },
    userId: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: false, // <-- Can be null for guests
        index: true
    },
    isGuestRuleSet: { // <-- New flag for guest rulesets
        type: Boolean,
        default: true
    },
    // --- NEW FIELD to store the reference ---
    ruleSetId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RuleSet',
        required: false // Not every box must have rules
    },
    difficulty_level: { type: String, enum: ['easier', 'moderate', 'expert'] },
    game_roles: { type: Number },
    rules_data: [RuleSchema]
}, { timestamps: true });

// A logged-in user cannot have two rulesets with the same name.
// This index will only apply to documents where userId is not null.
RuleSetSchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { userId: { $exists: true } } });

module.exports = mongoose.models.RuleSet || mongoose.model('RuleSet', RuleSetSchema);