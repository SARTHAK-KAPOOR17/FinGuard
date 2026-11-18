const config = require('../config');
const { alertConsumerService } = require('./alert-consumer.service');
const { wsService } = require('./websocket.service');

class HealthService {
  getHealthStatus() {
    return {
      status: 'healthy',
      service: config.serviceName,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: config.env,
      consumer: alertConsumerService ? alertConsumerService.getMetrics() : null,
      websocket: wsService ? { activeConnections: wsService.getActiveConnections() } : null,
    };
  }
}

module.exports = new HealthService();
