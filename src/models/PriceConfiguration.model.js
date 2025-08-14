const mongoose = require('mongoose');

// This schema is designed to be flexible enough to hold your entire pricing JSON array.
// We are essentially storing the configuration document in the database.

const CardPricingDetailSchema = new mongoose.Schema({
    _id: false, // No need for sub-document IDs
    "30-50": { type: Number, required: true },
    "51-75": { type: Number, required: true },
    "76-100": { type: Number, required: true },
    "101-120": { type: Number, required: true }
});

const PricingTierSchema = new mongoose.Schema({
    _id: false,
    deckRange: { type: String, required: true }, // e.g., "20-50", "2500+"
    cards: { type: CardPricingDetailSchema, required: true },
    box: { type: Number, required: true }
});

const CardTypePricingSchema = new mongoose.Schema({
    cardType: { type: String, required: true, unique: true }, // e.g., "Standard 300gsm Bridge"
    size: { type: String, required: true }, // e.g., "57x88mm"
    pricing: [PricingTierSchema]
});

const PriceConfigurationSchema = new mongoose.Schema({
    // A key to identify this configuration, in case you have multiple (e.g., 'DEFAULT_PRICING_2025')
    configKey: {
        type: String,
        required: true,
        unique: true,
        default: 'DEFAULT_PRICING_TABLE'
    },
    // The main array holding all pricing rules
    pricingTable: [CardTypePricingSchema]
}, { timestamps: true });


module.exports = mongoose.model('PriceConfiguration', PriceConfigurationSchema);