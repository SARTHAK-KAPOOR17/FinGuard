const pino = require('pino');

/**
 * Creates a structured Pino logger instance.
 *
 * @param {string} serviceName - Name of the service initializing the logger
 * @param {object} [options] - Additional Pino options
 * @returns {pino.Logger}
 */
function createLogger(serviceName = 'finguard', options = {}) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

  const baseConfig = {
    level: logLevel,
    base: {
      service: serviceName,
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    ...options,
  };

  // If pretty logging is enabled in development
  if (isDevelopment && process.env.LOG_PRETTY === 'true') {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(baseConfig);
}

module.exports = {
  createLogger,
};
