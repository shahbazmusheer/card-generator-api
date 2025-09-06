const nodemailer = require('nodemailer');
const User = require('../models/User.model');
const SystemSetting = require('../models/SystemSetting.model');

// Create a reusable transporter object using the SMTP transport
// This will be null if the required environment variables are not set.
let transporter = null;
if (process.env.EMAIL_HOST && process.env.EMAIL_PORT && process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT, 10),
        secure: parseInt(process.env.EMAIL_PORT, 10) === 465, // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD, // This should be the App Password for Gmail
        },
    });
} else {
    console.warn("Email service is not configured. Please set EMAIL_HOST, EMAIL_PORT, EMAIL_USERNAME, and EMAIL_PASSWORD in .env file.");
}


/**
 * Sends an email, but only if both the system-wide and user-specific settings allow it.
 * @param {string} userId - The ID of the user to email.
 * @param {string} subject - The subject of the email.
 * @param {string} text - The plain text content of the email.
 * @param {string} html - The HTML content of the email.
 */
async function sendEmail(userId, subject, text, html) {
    // If the transporter was not created, we cannot send emails.
    if (!transporter) {
        console.error("Email not sent: Transporter is not configured.");
        return;
    }

    try {
        // 1. Check the system-wide master switch
        const emailMasterSwitch = await SystemSetting.findOne({ key: 'EMAIL_NOTIFICATIONS_ENABLED' });
        if (emailMasterSwitch && emailMasterSwitch.value === false) {
            console.log("Email sending is disabled system-wide. Skipping.");
            return;
        }

        // 2. Check the user's personal preference
        const user = await User.findById(userId).select('email settings');
        if (!user) {
            console.log(`Email not sent: User with ID ${userId} not found.`);
            return;
        }
        if (!user.settings.receiveEmailNotifications) {
            console.log(`User ${userId} has opted out of email notifications. Skipping.`);
            return;
        }

        // 3. If both checks pass, send the email
        const info = await transporter.sendMail({
            from: `"Card Crafter" <${process.env.EMAIL_USERNAME}>`, // Send from your own Gmail address
            to: user.email,
            subject: subject,
            text: text,
            html: html
        });

        console.log(`Email sent successfully to ${user.email}. Message ID: ${info.messageId}`);

    } catch (error) {
        console.error("Failed to send email:", error);
    }
}

module.exports = { sendEmail };