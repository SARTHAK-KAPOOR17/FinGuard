const request = require('supertest');
const { app } = require('../src/app');
const { connectMongo, disconnectMongo } = require('../src/database/mongo');
const { disconnectRedis } = require('../src/database/redis');
const { DEFAULT_ADMIN_API_KEY } = require('@finguard/shared');

describe('Rule Engine Service - HTTP Endpoints', () => {
  const testRuleId = `RULE_API_TEST_${Date.now()}`;
  const validApiKey = DEFAULT_ADMIN_API_KEY;

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

  it('GET /rules should return list of configured rules from MongoDB (unprotected)', async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rules');
    expect(Array.isArray(res.body.rules)).toBe(true);
    expect(res.body.rules.length).toBeGreaterThanOrEqual(1);
  });

  describe('API Key Authentication on Write Endpoints', () => {
    it('should reject write requests without API key with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/rules')
        .send({ ruleId: 'TEST_UNAUTH' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
      expect(res.body).toHaveProperty('message', 'Invalid or missing API key');
    });

    it('should reject write requests with invalid API key with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/rules')
        .set('x-api-key', 'wrong-key')
        .send({ ruleId: 'TEST_UNAUTH' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });
  });

  describe('POST /rules (Create Rule)', () => {
    it('should create a new valid rule (201 Created)', async () => {
      const newRulePayload = {
        ruleId: testRuleId,
        name: 'Automated Test Rule',
        description: 'Created by Supertest',
        type: 'amount_threshold',
        severity: 'MEDIUM',
        enabled: true,
        config: {
          threshold: 7500,
          currency: 'USD',
          operator: '>',
        },
      };

      const res = await request(app)
        .post('/rules')
        .set('x-api-key', validApiKey)
        .send(newRulePayload);
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('status', 'success');
      expect(res.body.rule).toHaveProperty('ruleId', testRuleId);
      expect(res.body.rule.config).toHaveProperty('threshold', 7500);
    });

    it('should return 409 Conflict if ruleId already exists', async () => {
      const duplicatePayload = {
        ruleId: testRuleId,
        name: 'Duplicate Rule',
        type: 'amount_threshold',
        config: { threshold: 1000 },
      };

      const res = await request(app)
        .post('/rules')
        .set('x-api-key', validApiKey)
        .send(duplicatePayload);
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('error', 'ConflictError');
    });

    it('should return 400 Bad Request on invalid payload schema', async () => {
      const invalidPayload = {
        ruleId: 'INVALID!', // Invalid characters
        name: 'Bad',
        type: 'unknown_type',
      };

      const res = await request(app)
        .post('/rules')
        .set('x-api-key', validApiKey)
        .send(invalidPayload);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body).toHaveProperty('details');
    });

    it('should return 400 Bad Request if regex is prone to catastrophic backtracking (ReDoS)', async () => {
      const redosPayload = {
        ruleId: `RULE_REDOS_${Date.now()}`,
        name: 'ReDoS Test',
        type: 'merchant_regex',
        config: {
          pattern: '(a+)+$', // ReDoS pattern
        },
      };

      const res = await request(app)
        .post('/rules')
        .set('x-api-key', validApiKey)
        .send(redosPayload);
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.includes('catastrophic backtracking'))).toBe(true);
    });
  });

  describe('GET /rules/:id (Get Rule by ID)', () => {
    it('should return 200 with rule details for existing rule', async () => {
      const res = await request(app).get(`/rules/${testRuleId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rule');
      expect(res.body.rule).toHaveProperty('ruleId', testRuleId);
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await request(app).get('/rules/NON_EXISTENT_ID_9999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFound');
    });
  });

  describe('PUT /rules/:id (Update Rule)', () => {
    it('should update rule configuration (200 OK)', async () => {
      const updatePayload = {
        name: 'Updated Rule Name',
        severity: 'HIGH',
        config: {
          threshold: 12000,
          currency: 'USD',
          operator: '>=',
        },
      };

      const res = await request(app)
        .put(`/rules/${testRuleId}`)
        .set('x-api-key', validApiKey)
        .send(updatePayload);
      expect(res.status).toBe(200);
      expect(res.body.rule.name).toBe('Updated Rule Name');
      expect(res.body.rule.severity).toBe('HIGH');
      expect(res.body.rule.config.threshold).toBe(12000);
    });

    it('should return 404 when updating non-existent rule', async () => {
      const res = await request(app)
        .put('/rules/NON_EXISTENT_ID_9999')
        .set('x-api-key', validApiKey)
        .send({ name: 'Does not exist' });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /rules/:id/toggle (Toggle Rule)', () => {
    it('should toggle rule enabled state (200 OK)', async () => {
      const res = await request(app)
        .patch(`/rules/${testRuleId}/toggle`)
        .set('x-api-key', validApiKey)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.rule.enabled).toBe(false);

      // Toggle back to true
      const res2 = await request(app)
        .patch(`/rules/${testRuleId}/toggle`)
        .set('x-api-key', validApiKey)
        .send({ enabled: true });

      expect(res2.status).toBe(200);
      expect(res2.body.rule.enabled).toBe(true);
    });

    it('should return 404 when toggling non-existent rule', async () => {
      const res = await request(app)
        .patch('/rules/NON_EXISTENT_ID_9999/toggle')
        .set('x-api-key', validApiKey)
        .send();
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /rules/:id (Delete Rule)', () => {
    it('should delete rule successfully (200 OK)', async () => {
      const res = await request(app)
        .delete(`/rules/${testRuleId}`)
        .set('x-api-key', validApiKey);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'success');

      // Verify it is gone
      const verifyRes = await request(app).get(`/rules/${testRuleId}`);
      expect(verifyRes.status).toBe(404);
    });

    it('should return 404 when deleting non-existent rule', async () => {
      const res = await request(app)
        .delete('/rules/NON_EXISTENT_ID_9999')
        .set('x-api-key', validApiKey);
      expect(res.status).toBe(404);
    });
  });
});
