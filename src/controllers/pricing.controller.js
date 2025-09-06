const { successResponse, errorResponse } = require('../utils/responseHandler');
const PriceConfiguration = require('../models/PriceConfiguration.model');

exports.getProductOptions = async (req, res) => {
    try {
        const materialFinishes = ["Gloss Finish", "Matte Finish", "Linen Finish"];
        const boxTypes = ["Standard Tuck Box", "Rigid Collector's Box"];
        const config = await PriceConfiguration.findOne({ configKey: 'DEFAULT_PRICING_TABLE' });
        if (!config || !config.pricingTable) {
            return errorResponse(res, "Pricing configuration not found.", 500);
        }
        const cardStocks = config.pricingTable.map(item => item.cardType);
        const options = { materialFinishes, cardStocks, boxTypes };
        successResponse(res, "Product options retrieved successfully.", options);
    } catch (error) {
        errorResponse(res, "Failed to retrieve product options.", 500, "FETCH_OPTIONS_FAILED", error.message);
    }
};