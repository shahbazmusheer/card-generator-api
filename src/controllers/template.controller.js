const Template = require('../models/Template.model');
const { successResponse, errorResponse } = require('../utils/responseHandler');

exports.createTemplate = async (req, res) => {
    try {
        // Now accepts all the new default fields for pre-filling the form
        const {
            name, description, image,
            defaultBoxName, defaultPrompt, defaultGenre,
            defaultColorTheme, defaultNumCards,
            includesCharacterArt, generatesBoxDesign
        } = req.body;

        if (!name || !image || !defaultPrompt) {
            return errorResponse(res, 'Name, Image, and a Default Prompt are required fields.', 400);
        }

        const templateData = {
            name, description, image,
            defaultBoxName, defaultPrompt, defaultGenre,
            defaultColorTheme, defaultNumCards,
            includesCharacterArt, generatesBoxDesign
        };

        const newTemplate = await Template.create(templateData);
        successResponse(res, 'Template created successfully.', newTemplate, 201);
    } catch (error) {
        if (error.code === 11000) {
            return errorResponse(res, 'A template with this name already exists.', 409);
        }
        errorResponse(res, 'Error creating template.', 500, "TEMPLATE_CREATE_FAILED", error.message);
    }
};

exports.getAllTemplates = async (req, res) => {
    try {
        const templates = await Template.find().sort({ uses_count: -1, name: 1 });
        successResponse(res, 'Templates retrieved successfully.', templates);
    } catch (error) {
        errorResponse(res, 'Error retrieving templates.', 500, "FETCH_TEMPLATES_FAILED", error.message);
    }
};

exports.getTemplateById = async (req, res) => {
    try {
        const template = await Template.findById(req.params.templateId);
        if (!template) {
            return errorResponse(res, 'Template not found.', 404);
        }
        successResponse(res, 'Template retrieved successfully.', template);
    } catch (error) {
        errorResponse(res, 'Error retrieving template.', 500, "FETCH_TEMPLATE_FAILED", error.message);
    }
};

exports.updateTemplate = async (req, res) => {
    try {
        const updates = req.body;
        // Prevent changing the name, which should be unique
        delete updates.name;

        const updatedTemplate = await Template.findByIdAndUpdate(
            req.params.templateId,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!updatedTemplate) {
            return errorResponse(res, 'Template not found.', 404);
        }
        successResponse(res, 'Template updated successfully.', updatedTemplate);
    } catch (error) {
        errorResponse(res, 'Error updating template.', 500, "UPDATE_TEMPLATE_FAILED", error.message);
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const template = await Template.findByIdAndDelete(req.params.templateId);
        if (!template) {
            return errorResponse(res, 'Template not found.', 404);
        }
        successResponse(res, 'Template deleted successfully.', { templateId: req.params.templateId });
    } catch (error) {
        errorResponse(res, 'Error deleting template.', 500, "DELETE_TEMPLATE_FAILED", error.message);
    }
};