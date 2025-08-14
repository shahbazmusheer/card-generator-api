const axios = require('axios');
const fs = require('fs');
const path = require('path');

const {
    DHL_API_KEY,
    DHL_API_SECRET,
    DHL_API_RATES_ENDPOINT,
    DHL_API_SHIPMENTS_ENDPOINT,
    DHL_ACCOUNT_NUMBER,
    SHIPPER_POSTAL_CODE,
    SHIPPER_CITY_NAME,
    SHIPPER_COUNTRY_CODE,
    SHIPPER_ADDRESS
} = process.env;

async function getShippingRates(shippingDetails, packageDetails) {
    if (!DHL_API_KEY || !DHL_API_SECRET || !DHL_API_RATES_ENDPOINT || !DHL_ACCOUNT_NUMBER) {
        console.error("DHL API credentials, Rates Endpoint, or Account Number are not fully configured.");
        throw new Error("Shipping rate service is not properly configured.");
    }

    const credentials = Buffer.from(`${DHL_API_KEY}:${DHL_API_SECRET}`).toString('base64');
    const authorizationHeader = `Basic ${credentials}`;
    const headers = { 'Authorization': authorizationHeader };

    const params = new URLSearchParams({
        accountNumber: DHL_ACCOUNT_NUMBER,
        originCountryCode: SHIPPER_COUNTRY_CODE,
        originPostalCode: SHIPPER_POSTAL_CODE,
        originCityName: SHIPPER_CITY_NAME,
        destinationCountryCode: shippingDetails.countryCode,
        destinationCityName: shippingDetails.city,
        destinationPostalCode: shippingDetails.zipCode,
        weight: packageDetails.weight || 5,
        length: packageDetails.length || 15,
        width: packageDetails.width || 10,
        height: packageDetails.height || 5,
        plannedShippingDate: new Date().toISOString().split('T')[0],
        isCustomsDeclarable: shippingDetails.countryCode !== SHIPPER_COUNTRY_CODE,
        unitOfMeasurement: 'metric',
        requestEstimatedDeliveryDate: true,
        estimatedDeliveryDateType: 'QDDF'
    });

    const finalUrl = `${DHL_API_RATES_ENDPOINT}?${params.toString()}`;

    try {
        const response = await axios.get(finalUrl, { headers });

        if (response.data && response.data.products) {
            const simplifiedRates = response.data.products.map(product => ({
                serviceName: product.productName,
                price: product.totalPrice[0]?.price,
                currency: product.totalPrice[0]?.currency,
                estimatedDelivery: product.deliveryCapabilities?.estimatedDeliveryDateAndTime || null
            }));

            return simplifiedRates;
        }
        return [];
    } catch (error) {
        console.error("--- DHL Get Rates API Call Failed ---");
        let errorMessage = "An unknown error occurred while fetching shipping rates.";
        if (error.response && error.response.data) {
            console.error("DHL Error Details:", JSON.stringify(error.response.data, null, 2));
            errorMessage = error.response.data.detail || error.response.data.message || errorMessage;
        } else {
            console.error(error.message);
        }
        throw new Error(`DHL API Error: ${errorMessage}`);
    }
}

async function createShipment(order) {
    if (!DHL_API_KEY || !DHL_API_SECRET || !DHL_API_SHIPMENTS_ENDPOINT || !DHL_ACCOUNT_NUMBER) {
        console.error("DHL API credentials, Shipments Endpoint, or Account Number are not fully configured.");
        throw new Error("Shipment creation service is not properly configured.");
    }

    const credentials = Buffer.from(`${DHL_API_KEY}:${DHL_API_SECRET}`).toString('base64');
    const headers = {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
    };

    const isCustomsDeclarable = order.shippingDetails.countryCode !== SHIPPER_COUNTRY_CODE;

    const requestBody = {
        plannedShippingDateAndTime: new Date().toISOString().slice(0, 19) + " GMT+01:00",
        pickup: { isRequested: false },
        productCode: 'P',
        accounts: [{ typeCode: 'shipper', number: DHL_ACCOUNT_NUMBER }],
        customerDetails: {
            shipperDetails: {
                postalAddress: {
                    postalCode: SHIPPER_POSTAL_CODE,
                    cityName: SHIPPER_CITY_NAME,
                    countryCode: SHIPPER_COUNTRY_CODE,
                    addressLine1: SHIPPER_ADDRESS
                },
                contactInformation: {
                    fullName: "Card Crafter Support",
                    phone: "+15555555555",
                    companyName: "Card Crafter Inc."
                }
            },
            receiverDetails: {
                postalAddress: {
                    postalCode: order.shippingDetails.zipCode,
                    cityName: order.shippingDetails.city,
                    countryCode: order.shippingDetails.countryCode,
                    addressLine1: order.shippingDetails.address
                },
                contactInformation: {
                    fullName: order.shippingDetails.fullName,
                    phone: order.shippingDetails.phone,
                    companyName: order.shippingDetails.fullName
                }
            }
        },
        content: {
            packages: [{
                weight: 1.5,
                dimensions: { length: 20, width: 15, height: 10 }
            }],
            unitOfMeasurement: "metric",
            isCustomsDeclarable: isCustomsDeclarable,
            description: `Order of custom playing cards - ${order.orderId}`,
            declaredValue: order.costs.cardsSubtotal + order.costs.boxesSubtotal,
            declaredValueCurrency: "USD",
            incoterm: "DAP"
        }
    };

    if (isCustomsDeclarable) {
        // --- THIS IS THE CORRECTED EXPORT DECLARATION OBJECT ---
        requestBody.content.exportDeclaration = {
            invoice: {
                number: order.orderId.replace(/[^a-zA-Z0-9]/g, ''),
                date: new Date().toISOString().split('T')[0]
            },
            // reasonForExport key has been removed.
            lineItems: [
                {
                    number: 1,
                    description: "Custom Printed Educational Playing Cards",
                    price: order.costs.cardsSubtotal + order.costs.boxesSubtotal,
                    quantity: {
                        value: order.items[0].deckQuantity,
                        unitOfMeasurement: "BOX"
                    },
                    // countryOfOrigin and commodityCode have been removed.
                    // manufacturerCountry and weight have been added.
                    manufacturerCountry: SHIPPER_COUNTRY_CODE,
                    weight: {
                        netValue: 1.5,
                        grossValue: 1.5
                    }
                }
            ]
        };
    }

    try {
        console.log(`Creating DHL shipment for order: ${order.orderId}`);
        const response = await axios.post(DHL_API_SHIPMENTS_ENDPOINT, requestBody, { headers });

        const trackingNumber = response.data?.shipmentTrackingNumber;
        const shippingLabelData = response.data?.documents?.[0]?.content;

        if (!trackingNumber || !shippingLabelData) {
            throw new Error("DHL API response was missing a tracking number or shipping label.");
        }

        const labelBuffer = Buffer.from(shippingLabelData, 'base64');
        const labelsDir = path.join(__dirname, '..', '..', 'uploads', 'labels');
        if (!fs.existsSync(labelsDir)) {
            fs.mkdirSync(labelsDir, { recursive: true });
        }
        const shippingLabelPath = path.join(labelsDir, `label-${order.orderId.replace(/[^a-z0-9]/gi, '_')}.pdf`);
        fs.writeFileSync(shippingLabelPath, labelBuffer);

        console.log(`Shipment created for ${order.orderId}. Tracking #: ${trackingNumber}`);
        console.log(`Shipping label saved to: ${shippingLabelPath}`);

        return { trackingNumber, shippingLabelPath };

    } catch (error) {
        console.error("--- DHL Create Shipment API Call Failed ---");
        let errorMessage = "An unknown error occurred while creating the shipment.";
        if (error.response && error.response.data) {
            console.error("DHL Error Details:", JSON.stringify(error.response.data, null, 2));
            errorMessage = error.response.data.message || JSON.stringify(error.response.data.details);
        } else {
            console.error(error.message);
        }
        throw new Error(`DHL Shipment API Error: ${errorMessage}`);
    }
}

module.exports = {
    getShippingRates,
    createShipment
};