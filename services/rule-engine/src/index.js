const { app, logger } = require('./app');
const config = require('./config');
const { assertApiKeyConfigured } = require('@finguard/shared');
const ruleProcessorService = require('./services/rule-processor.service');

// Enforce that ADMIN_API_KEY is configured before listening
if (process.env.NODE_ENV !== 'test') {
  assertApiKeyConfigured(process.env.ADMIN_API_KEY);
}

const server = app.listen(config.port, async () => {
  logger.info(
    { port: config.port, env: config.env, service: config.serviceName },
    `${config.serviceName} listening on port ${config.port}`
  );

  // Start Kafka stream processing consumer
  try {
    await ruleProcessorService.start();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to start Rule Engine stream processing consumer on boot');
  }
});

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, `${signal} received. Initiating graceful shutdown...`);

  try {
    await ruleProcessorService.stop();
    logger.info('Kafka consumer & producer stopped cleanly during shutdown');
  } catch (err) {
    logger.error({ err: err.message }, 'Error stopping Rule Engine processor during shutdown');
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

module.exports = server;
