const config = require('../config');

class HealthService {
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
