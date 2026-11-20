const dotenv = require('dotenv');
const path = require('path');
const { SERVICES, DEFAULT_PORTS } = require('@finguard/shared');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = Object.freeze({
  serviceName: SERVICES.AUTH,
  port: parseInt(process.env.PORT || String(DEFAULT_PORTS.AUTH), 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://root:example@localhost:27017/finguard?authSource=admin',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_insecure_jwt_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
});

module.exports = config;
