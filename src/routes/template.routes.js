const express = require('express');
const router = express.Router();
const templateController = require('../controllers/template.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// --- PUBLIC ROUTES ---
// Get all available templates for the user to choose from.
router.get('/', templateController.getAllTemplates);

// Get the details of a single, specific template.
router.get('/:templateId', templateController.getTemplateById);


// --- ADMIN-ONLY ROUTES ---
// All routes below require the user to be an authenticated admin.
router.use(protect, authorize('admin'));

// Admin creates a new template.
router.post('/', templateController.createTemplate);

// Admin updates or deletes an existing template.
router.route('/:templateId')
    .put(templateController.updateTemplate)
    .delete(templateController.deleteTemplate);

module.exports = router;