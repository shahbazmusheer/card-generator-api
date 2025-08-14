const PriceConfiguration = require('../models/PriceConfiguration.model');

/**
 * Calculates the price per deck for cards and a box based on the provided parameters.
 * @param {string} cardType - The type of card stock, e.g., "Standard 300gsm Poker".
 * @param {number} deckQuantity - The total number of decks being ordered.
 * @param {number} cardsPerDeck - The number of cards within a single deck.
 * @returns {Promise<{pricePerDeckForCards: number, pricePerDeckForBox: number}>} An object containing the calculated prices.
 */
async function calculatePrice(cardType, deckQuantity, cardsPerDeck) {
    // 1. Fetch the entire pricing configuration from the database.
    // Caching this in a real application would be a good performance optimization.
    const config = await PriceConfiguration.findOne({ configKey: 'DEFAULT_PRICING_TABLE' });
    if (!config) {
        throw new Error('Pricing configuration not found in the database.');
    }

    // 2. Find the specific set of rules for the chosen cardType.
    const cardTypeRules = config.pricingTable.find(p => p.cardType === cardType);
    if (!cardTypeRules) {
        throw new Error(`Pricing for card type "${cardType}" not found.`);
    }

    // 3. Find the correct pricing tier based on the total number of decks (deckQuantity).
    const tier = findDeckQuantityTier(deckQuantity, cardTypeRules.pricing);
    if (!tier) {
        throw new Error(`Pricing tier for deck quantity "${deckQuantity}" not found.`);
    }

    // 4. Find the correct price for the cards based on the number of cards per deck.
    const pricePerDeckForCards = findCardsPerDeckPrice(cardsPerDeck, tier.cards);
    if (pricePerDeckForCards === null) {
        throw new Error(`Pricing for "${cardsPerDeck}" cards per deck not found in the selected tier.`);
    }

    // 5. The box price is straightforward from the selected tier.
    const pricePerDeckForBox = tier.box;

    return { pricePerDeckForCards, pricePerDeckForBox };
}

/**
 * Helper function to find the correct pricing tier based on deck quantity.
 * @param {number} quantity - The number of decks.
 * @param {Array} pricingTiers - The array of pricing tiers for a card type.
 * @returns {object|null} The matching tier object or null if not found.
 */
function findDeckQuantityTier(quantity, pricingTiers) {
    for (const tier of pricingTiers) {
        const { deckRange } = tier;

        if (deckRange.includes('+')) {
            // Handles ranges like "2500+"
            const min = parseInt(deckRange.replace('+', ''), 10);
            if (quantity >= min) {
                return tier;
            }
        } else {
            // Handles ranges like "20-50"
            const [min, max] = deckRange.split('-').map(Number);
            if (quantity >= min && quantity <= max) {
                return tier;
            }
        }
    }
    return null; // No matching tier found
}

/**
 * Helper function to find the price within a tier based on the number of cards per deck.
 * @param {number} quantity - The number of cards in a deck.
 * @param {object} cardPrices - The 'cards' object from a pricing tier.
 * @returns {number|null} The price or null if not found.
 */
function findCardsPerDeckPrice(quantity, cardPrices) {
    // The keys in your schema are "30-50", "51-75", etc.
    for (const rangeKey in cardPrices) {
        if (rangeKey === '_id') continue; // Skip mongoose internals if they appear

        const [min, max] = rangeKey.split('-').map(Number);
        if (quantity >= min && quantity <= max) {
            // The .toObject() is needed if cardPrices is a Mongoose subdocument
            return cardPrices.toObject ? cardPrices.toObject()[rangeKey] : cardPrices[rangeKey];
        }
    }
    return null; // No matching price found
}


module.exports = {
    calculatePrice
};