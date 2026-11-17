const request = require('supertest');
const { app } = require('../src/app');

describe('GET /health - Auth Service', () => {
  it('should return 200 with service health metadata', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'healthy');
    expect(res.body).toHaveProperty('service', 'auth-service');
  });
});
