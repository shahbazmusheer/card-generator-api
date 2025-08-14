// server.js
require('dotenv').config(); // Load environment variables AT THE VERY TOP
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./src/config/db');
const mainRouter = require('./src/routes');
const authRoutes = require('./src/routes/auth.routes');
const seedSystemSettings = require('./src/utils/seedSystemSettings');
const seedPricing = require('./src/utils/seedPricing');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 5001;

// --- START: MODIFIED CODE ---

// We create an async function to control the startup sequence
const startServer = async () => {
    try {
        // 1. Connect to MongoDB and WAIT for the connection to complete.
        console.log('Connecting to the database...');
        await connectDB();
        console.log('Database connected successfully.');

        // 2. AFTER the database is connected, run the seeding function and WAIT for it.
        await seedSystemSettings();
        
        await seedPricing();

        // 3. Now that the database is ready, configure the rest of the application.

        // Middleware
        app.use(cors());
        app.use(express.json({ limit: '50mb' }));
        app.use(express.urlencoded({ limit: '50mb', extended: true }));
        app.use(express.static(path.join(__dirname, 'public')));

        // API Routes
        app.use('/api', mainRouter);
        app.use('/api/auth', authRoutes);
        // The line below already works perfectly with the new structure.
        app.use('/api/admin', adminRoutes);

        // Basic root route for testing
        app.get('/', (req, res) => {
            res.send('Card Generator API is alive!');
        });

        app.use((err, req, res, next) => {
            if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid JSON body. Please ensure request body is valid JSON.'
                });
            }

            // Default error handler
            res.status(500).json({
                success: false,
                message: 'Something broke!',
                error: err.message
            });
        });

        // 4. Finally, start listening for requests.
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error('FATAL: Failed to start the server.');
        console.error(error);
        process.exit(1); // Exit the application if we can't connect to the DB or seed
    }
};

// Execute the startup function
startServer();

// --- END: MODIFIED CODE ---