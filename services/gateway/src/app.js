const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const { createLogger } = require('@finguard/shared');
const config = require('./config');
const healthRoutes = require('./routes/health.route');

const logger = createLogger(config.serviceName);

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/health', healthRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Unhandled error in API Gateway');
  res.status(err.status || 500).json({
    error: err.name || 'InternalServerError',
    message: config.env === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

module.exports = { app, logger };
