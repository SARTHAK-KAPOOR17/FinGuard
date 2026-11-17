const { app, logger } = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, service: config.serviceName },
    `${config.serviceName} listening on port ${config.port}`
  );
});

// Graceful shutdown handling
let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, `${signal} received. Initiating graceful shutdown...`);

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      logger.error({ err: err.message }, 'Error closing HTTP server');
      process.exit(1);
    }

    logger.info('HTTP server closed cleanly. Cleanup complete.');
    process.exit(0);
  });

  // Force shutdown if cleanup hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10s. Forcing exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;
