const healthService = require('../services/health.service');

class HealthController {
  getHealth(req, res) {
    const health = healthService.getHealthStatus();
    return res.status(200).json(health);
  }
}

module.exports = new HealthController();
