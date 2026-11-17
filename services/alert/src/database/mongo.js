const mongoose = require('mongoose');
const { createLogger } = require('@finguard/shared');
const config = require('../config');

const logger = createLogger(config.serviceName);

let isConnected = false;

async function connectMongo() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    logger.info('Connected to MongoDB successfully for Alert Service');
  } catch (err) {
    logger.error({ err: err.message }, 'MongoDB connection failed in Alert Service');
    throw err;
  }
}

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Disconnected from MongoDB in Alert Service');
  }
}

module.exports = {
  connectMongo,
  disconnectMongo,
};
