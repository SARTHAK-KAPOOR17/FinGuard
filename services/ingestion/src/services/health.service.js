const config = require('../config');

/**
 * Health check service
 */
class HealthService {
  /**
   * Retrieves current service health metadata.
   *
   * @returns {object}
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      service: config.serviceName,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: config.env,
    };
  }
}

module.exports = new HealthService();
