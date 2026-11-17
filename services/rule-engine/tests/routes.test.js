const request = require('supertest');
const { app } = require('../src/app');

describe('Rule Engine Service - HTTP Endpoints', () => {
  it('GET /health should return 200 with service health and processor metrics', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'healthy');
    expect(res.body).toHaveProperty('service', 'rule-engine-service');
    expect(res.body).toHaveProperty('processor');
  });

  it('GET /rules should return list of active seed rules', async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rules');
    expect(res.body.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'RULE_LARGE_AMOUNT' }),
        expect.objectContaining({ id: 'RULE_SUSPICIOUS_MERCHANT' }),
      ])
    );
  });

  it('PATCH /rules/:id should toggle rule enabled state', async () => {
    const res = await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled', false);

    // Toggle back
    await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ enabled: true });
  });

  it('PATCH /rules/:id should return 400 when enabled is not boolean', async () => {
    const res = await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'ValidationError');
  });

  it('PATCH /rules/:id should return 404 when rule does not exist', async () => {
    const res = await request(app)
      .patch('/rules/NON_EXISTENT_RULE')
      .send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'NotFound');
  });
});
