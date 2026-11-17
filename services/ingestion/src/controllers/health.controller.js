const healthService = require('../services/health.service');

/**
 * Health check controller
 */
class HealthController {
  /**
   * GET /health handler
   */
  getHealth(req, res) {
    const health = healthService.getHealthStatus();
    return res.status(200).json(health);
  }
}

module.exports = new HealthController();
