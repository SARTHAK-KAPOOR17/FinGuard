/**
 * API Key Authentication Middleware
 * Protects administrative/write endpoints across FinGuard microservices.
 */

const DEFAULT_ADMIN_API_KEY = 'finguard-admin-secret-key-2026';

function createApiKeyMiddleware(options = {}) {
  const configuredKey = options.apiKey || process.env.ADMIN_API_KEY || DEFAULT_ADMIN_API_KEY;
  const headerName = (options.headerName || 'x-api-key').toLowerCase();

  return function apiKeyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    let providedKey = req.headers[headerName];

    if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.slice(7).trim();
    }

    if (!providedKey || providedKey !== configuredKey) {
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
  DEFAULT_ADMIN_API_KEY,
};
