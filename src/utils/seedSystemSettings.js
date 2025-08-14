// src/utils/seedSystemSettings.js
const SyetemSetting = require('../models/SystemSetting.model');

// An array of default settings your application needs to function.
const defaultSystemSettings = [
    {
        key: 'IMAGE_GENERATION_STRATEGY',
        value: 'UNIQUE_IMAGE_PER_CARD',
        description: "Determines image generation for new decks. Options: 'SINGLE_IMAGE_PER_DECK' or 'UNIQUE_IMAGE_PER_CARD'."
    },
    // You can add more default settings here in the future
    // {
    //     key: 'DEFAULT_CARD_BACK',
    //     value: 'public/images/card-backs/1.jpg',
    //     description: 'The default card back image for all new decks.'
    // }
];

const seedSystemSettings = async () => {
    try {
        console.log('Checking for default settings...');
        for (const setting of defaultSystemSettings) {
            // Find a setting by its key. The `upsert: true` option is the magic here.
            // - If it finds the document, it will update it (or do nothing if it matches).
            // - If it does NOT find it, it will create it (`upsert`).
            await SyetemSetting.findOneAndUpdate(
                { key: setting.key }, // The condition to find the document
                { $set: setting },    // The data to apply
                { upsert: true, new: true } // Options: upsert if not found, return the new doc
            );
        }
        console.log('Default settings check complete. Database is seeded.');
    } catch (error) {
        console.error('Error seeding database with default settings:', error);
    }
};

module.exports = seedSystemSettings;