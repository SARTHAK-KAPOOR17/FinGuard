const express = require('express');
const pinoHttp = require('pino-http');
const { createLogger } = require('@finguard/shared');
const config = require('./config');
const healthRoutes = require('./routes/health.route');
const alertRoutes = require('./routes/alert.route');

const logger = createLogger(config.serviceName);

const app = express();

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

// CORS middleware supporting configured dashboard origins
app.use((req, res, next) => {
  const allowedOrigins = [config.dashboardOrigin, 'http://localhost:5173', 'http://localhost:3000'].filter(Boolean);
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use('/health', healthRoutes);
app.use('/alerts', alertRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Unhandled error in Alert Service');
  res.status(err.status || 500).json({
    error: err.name || 'InternalServerError',
    message: config.env === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

module.exports = { app, logger };
