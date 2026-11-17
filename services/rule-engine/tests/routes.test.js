const request = require('supertest');
const { app } = require('../src/app');
const { connectMongo, disconnectMongo } = require('../src/database/mongo');
const { disconnectRedis } = require('../src/database/redis');

describe('Rule Engine Service - HTTP Endpoints', () => {
  beforeAll(async () => {
    await connectMongo().catch(() => {});
  });

  afterAll(async () => {
    await disconnectRedis().catch(() => {});
    await disconnectMongo().catch(() => {});
  });

  it('GET /health should return 200 with service health and processor metrics', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'healthy');
    expect(res.body).toHaveProperty('service', 'rule-engine-service');
    expect(res.body).toHaveProperty('processor');
  });

  it('GET /rules should return list of configured rules from MongoDB', async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rules');
    expect(Array.isArray(res.body.rules)).toBe(true);
    expect(res.body.rules.length).toBeGreaterThanOrEqual(2);
  });

  it('PATCH /rules/:id should toggle rule enabled state and trigger reload', async () => {
    const res = await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rule');
    expect(res.body.rule).toHaveProperty('enabled', false);

    // Toggle back to true
    const resBack = await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ enabled: true });

    expect(resBack.status).toBe(200);
    expect(resBack.body.rule).toHaveProperty('enabled', true);
  });

  it('PATCH /rules/:id should update rule threshold', async () => {
    const res = await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ threshold: 50000 });

    expect(res.status).toBe(200);
    expect(res.body.rule.config).toHaveProperty('threshold', 50000);

    // Reset threshold back to 10000
    await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({ threshold: 10000 });
  });

  it('PATCH /rules/:id should return 400 when no valid update fields are provided', async () => {
    const res = await request(app)
      .patch('/rules/RULE_LARGE_AMOUNT')
      .send({});

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
