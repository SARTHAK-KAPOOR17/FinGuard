const { Router } = require('express');
const { apiKeyAuth } = require('@finguard/shared');
const alertController = require('../controllers/alert.controller');

const router = Router();

// CRITICAL: Register /stats BEFORE /:id to prevent route shadowing
router.get('/stats', (req, res, next) => alertController.getStats(req, res, next));

// Paginated & filtered list of alerts
router.get('/', (req, res, next) => alertController.getAlerts(req, res, next));

// Individual alert by alertId (UUID) or Mongo _id
router.get('/:id', (req, res, next) => alertController.getAlertById(req, res, next));

// Protected status update endpoint with API key
router.patch('/:id/status', apiKeyAuth, (req, res, next) => alertController.updateStatus(req, res, next));

module.exports = router;
