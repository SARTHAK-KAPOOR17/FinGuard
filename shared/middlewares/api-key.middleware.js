/**
 * API Key Authentication Middleware
 * Protects administrative/write endpoints across FinGuard microservices.
 * Uses constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks.
 */

const crypto = require('crypto');

/**
 * Constant-time string equality check using crypto.timingSafeEqual.
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // timingSafeEqual requires buffers of identical byte length
  if (bufA.length !== bufB.length) {
    // Perform dummy comparison to keep constant-time behavior against length probes
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates that an API key is configured at service initialization.
 * Throws an explicit error if missing, preventing silent open access.
 */
function assertApiKeyConfigured(key = process.env.ADMIN_API_KEY) {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: ADMIN_API_KEY environment variable is missing or empty. ' +
        'FinGuard requires a securely configured API key for write endpoints.'
    );
  }
  return key.trim();
}

/**
 * Creates API key middleware.
 * If requireConfigured is true (default), asserts that a valid key exists.
 */
function createApiKeyMiddleware(options = {}) {
  const headerName = (options.headerName || 'x-api-key').toLowerCase();

  return function apiKeyAuth(req, res, next) {
    const configuredKey = options.apiKey || process.env.ADMIN_API_KEY;

    if (!configuredKey) {
      return res.status(500).json({
        error: 'ConfigurationError',
        message: 'ADMIN_API_KEY is not configured on this server.',
      });
    }

    const authHeader = req.headers.authorization;
    let providedKey = req.headers[headerName];

    if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.slice(7).trim();
    }

    if (!providedKey || !timingSafeCompare(providedKey, configuredKey)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing API key',
      });
    }

    return next();
  };
}

const apiKeyAuth = createApiKeyMiddleware();

module.exports = {
  createApiKeyMiddleware,
  apiKeyAuth,
  assertApiKeyConfigured,
  timingSafeCompare,
};
