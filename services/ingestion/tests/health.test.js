const request = require('supertest');
const { app } = require('../src/app');

describe('GET /health - Ingestion Service', () => {
  it('should return 200 with service health metadata', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'healthy');
    expect(res.body).toHaveProperty('service', 'ingestion-service');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('should return 404 for unknown route', async () => {
    const res = await request(app).get('/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'NotFound');
  });
});
