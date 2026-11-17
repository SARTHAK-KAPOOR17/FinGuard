const mongoose = require('mongoose');
const { createLogger } = require('@finguard/shared');
const config = require('../config');
const { Rule } = require('../models/rule.model');
const { SEED_RULES } = require('../rules/seed-rules');

const logger = createLogger(config.serviceName);

let isConnected = false;

async function seedRulesIfEmpty() {
  try {
    const count = await Rule.countDocuments();
    if (count === 0) {
      logger.info('Collection "rules" is empty. Seeding default fraud rules into MongoDB...');
      await Rule.insertMany(SEED_RULES);
      logger.info({ seededCount: SEED_RULES.length }, 'Default rules seeded successfully into MongoDB');
    } else {
      logger.info({ existingRulesCount: count }, 'Rules already present in MongoDB. Skipping seed.');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Error seeding default rules into MongoDB');
    throw err;
  }
}

async function connectMongo() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    logger.info('Connected to MongoDB successfully');

    // Ensure seed rules exist
    await seedRulesIfEmpty();
  } catch (err) {
    logger.error({ err: err.message }, 'MongoDB connection failed');
    throw err;
  }
}

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Disconnected from MongoDB');
  }
}

module.exports = {
  connectMongo,
  disconnectMongo,
  seedRulesIfEmpty,
  isMongoConnected: () => mongoose.connection.readyState === 1,
};
