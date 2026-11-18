/**
 * FinGuard REST API Client
 * Uses Vite proxy (/api) in development or VITE_API_URL in production.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/alerts`
  : '/api/alerts';

const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY || '';

/**
 * Fetch alerts list with optional filtering and pagination
 * @param {Object} params
 * @param {number} [params.page=1]
 * @param {number} [params.limit=50]
 * @param {string} [params.severity]
 * @param {string} [params.status]
 * @param {string} [params.userId]
 * @param {string} [params.sort='createdAt']
 */
export async function fetchAlerts(params = {}) {
  const query = new URLSearchParams();
  query.set('page', params.page || 1);
  query.set('limit', params.limit || 20);
  if (params.severity && params.severity !== 'ALL') query.set('severity', params.severity);
  if (params.status && params.status !== 'ALL') query.set('status', params.status);
  if (params.userId && params.userId.trim()) query.set('userId', params.userId.trim());
  if (params.sort) query.set('sort', params.sort);

  const url = `${API_BASE_URL}?${query.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to fetch alerts: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch aggregated stats
 */
export async function fetchAlertStats() {
  const response = await fetch(`${API_BASE_URL}/stats`);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to fetch stats: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch single alert by ID
 * @param {string} alertId
 */
export async function fetchAlertById(alertId) {
  const response = await fetch(`${API_BASE_URL}/${alertId}`);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to fetch alert ${alertId}`);
  }
  return response.json();
}

/**
 * Update alert status (requires ADMIN_API_KEY)
 * @param {string} alertId
 * @param {Object} updateData
 * @param {string} updateData.status - OPEN | INVESTIGATING | RESOLVED | DISMISSED
 * @param {string} [updateData.analyst]
 * @param {string} [updateData.note]
 */
export async function updateAlertStatus(alertId, { status, analyst = 'current_analyst', note = '' }) {
  const response = await fetch(`${API_BASE_URL}/${alertId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ADMIN_API_KEY,
    },
    body: JSON.stringify({ status, analyst, note: note || undefined }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Status update failed (${response.status})`);
  }
  return response.json();
}
