const express = require('express');
const pinoHttp = require('pino-http');
const { createLogger } = require('@finguard/shared');
const config = require('./config');
const healthRoutes = require('./routes/health.route');
const transactionRoutes = require('./routes/transaction.route');

const logger = createLogger(config.serviceName);

const app = express();

// Request logging middleware
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/health', // Keep health checks out of log noise
    },
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRoutes);
app.use('/transactions', transactionRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Unhandled error encountered');
  res.status(err.status || 500).json({
    error: err.name || 'InternalServerError',
    message: config.env === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

module.exports = { app, logger };
