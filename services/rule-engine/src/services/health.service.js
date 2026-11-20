const config = require('../config');
const ruleProcessorService = require('./rule-processor.service');

class HealthService {
  getHealthStatus() {
    return {
      status: 'healthy',
      service: config.serviceName,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: config.env,
      processor: ruleProcessorService.getMetrics(),
    };
  }
}

module.exports = new HealthService();
