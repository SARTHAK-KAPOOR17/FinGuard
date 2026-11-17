const http = require('http');
const { app, logger } = require('./app');
const config = require('./config');
const { assertApiKeyConfigured } = require('@finguard/shared');
const { connectMongo, disconnectMongo } = require('./database/mongo');
const { alertConsumerService } = require('./services/alert-consumer.service');
const { wsService } = require('./services/websocket.service');

// Enforce that ADMIN_API_KEY is configured before running in non-test mode
if (process.env.NODE_ENV !== 'test') {
  assertApiKeyConfigured(process.env.ADMIN_API_KEY);
}

const server = http.createServer(app);

// Attach Socket.io server
wsService.attach(server);
alertConsumerService.setWebSocketService(wsService);

server.listen(config.port, async () => {
  logger.info(
    { port: config.port, env: config.env, service: config.serviceName },
    `${config.serviceName} listening on port ${config.port}`
  );

  try {
    await connectMongo();
    await alertConsumerService.start();
  } catch (err) {
    logger.error(
      { err: err.message },
      'Failed to initialize MongoDB or Alert Service Kafka consumer on startup'
    );
  }
});

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, `${signal} received. Initiating graceful shutdown...`);

  try {
    await alertConsumerService.stop();
    logger.info('Alert consumer stopped cleanly');
  } catch (err) {
    logger.error({ err: err.message }, 'Error stopping alert consumer');
  }

  try {
    await wsService.close();
    logger.info('WebSocket service closed cleanly');
  } catch (err) {
    logger.error({ err: err.message }, 'Error closing WebSocket service');
  }

  try {
    await disconnectMongo();
    logger.info('MongoDB disconnected cleanly');
  } catch (err) {
    logger.error({ err: err.message }, 'Error disconnecting MongoDB');
  }

  server.close((err) => {
    if (err) {
      logger.error({ err: err.message }, 'Error closing HTTP server');
      process.exit(1);
    }
    logger.info('HTTP server closed cleanly. Cleanup complete.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { server, wsService, alertConsumerService };
