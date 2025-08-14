// src/routes/template.routes.js
const express = require('express');
const router = express.Router();
const templateController = require('../controllers/template.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// For now, all routes are public as requested.
// Later, you can add `authMiddleware.protect` and `authMiddleware.authorize('admin')` to these routes.

// Export/Import
router.get('/export/json', templateController.exportTemplates);
router.post('/import/json', templateController.importTemplates);

router.route('/')
    .get(templateController.getAllTemplates);

router.route('/:templateId')
    .get(templateController.getTemplateById);

    
router.use(protect);
router.use(authorize('admin'));
// Standard CRUD
router.route('/')
    .post(templateController.createTemplate);

router.route('/:templateId')
    .put(templateController.updateTemplate)
    .delete(templateController.deleteTemplate);

module.exports = router;