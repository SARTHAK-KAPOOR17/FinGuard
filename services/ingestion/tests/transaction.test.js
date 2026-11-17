const request = require('supertest');
const { app } = require('../src/app');
const transactionService = require('../src/services/transaction.service');

describe('Ingestion Service - Transaction API', () => {
  let mockProducer;

  beforeEach(() => {
    mockProducer = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      send: jest.fn().mockResolvedValue([{ topicName: 'transactions.raw', partition: 0 }]),
      sendBatch: jest.fn().mockResolvedValue([{ topicName: 'transactions.raw', partition: 0 }]),
      isConnected: jest.fn().mockReturnValue(true),
    };
    transactionService.producer = mockProducer;
  });

  afterAll(async () => {
    await transactionService.disconnect();
  });

  const validTxn = {
    txnId: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user_test_101',
    amount: 149.99,
    currency: 'USD',
    merchant: 'Acme Superstore',
    location: {
      city: 'Seattle',
      country: 'USA',
      lat: 47.6062,
      lng: -122.3321,
    },
    deviceId: 'device_test_999',
    timestamp: new Date().toISOString(),
  };

  describe('POST /transactions (Single)', () => {
    it('should accept a valid transaction and return 202 Accepted', async () => {
      const res = await request(app)
        .post('/transactions')
        .send(validTxn);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('status', 'accepted');
      expect(res.body).toHaveProperty('txnId', validTxn.txnId);
      expect(mockProducer.send).toHaveBeenCalledTimes(1);
      expect(mockProducer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'transactions.raw',
          messages: [
            expect.objectContaining({
              key: validTxn.userId,
              value: expect.objectContaining({ txnId: validTxn.txnId }),
            }),
          ],
        })
      );
    });

    it('should return 400 Bad Request when txnId is not a valid UUID', async () => {
      const invalidTxn = { ...validTxn, txnId: 'not-a-uuid' };
      const res = await request(app)
        .post('/transactions')
        .send(invalidTxn);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'txnId' }),
        ])
      );
      expect(mockProducer.send).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when amount is negative or zero', async () => {
      const invalidTxn = { ...validTxn, amount: -50.0 };
      const res = await request(app)
        .post('/transactions')
        .send(invalidTxn);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'amount' }),
        ])
      );
      expect(mockProducer.send).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when currency is invalid length', async () => {
      const invalidTxn = { ...validTxn, currency: 'US' };
      const res = await request(app)
        .post('/transactions')
        .send(invalidTxn);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'currency' }),
        ])
      );
    });

    it('should return 400 Bad Request when location coordinates are out of bounds', async () => {
      const invalidTxn = {
        ...validTxn,
        location: { city: 'North Pole', country: 'Arctic', lat: 95.0, lng: -200.0 },
      };
      const res = await request(app)
        .post('/transactions')
        .send(invalidTxn);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'location.lat' }),
          expect.objectContaining({ field: 'location.lng' }),
        ])
      );
    });

    it('should return 400 Bad Request when timestamp is not ISO-8601', async () => {
      const invalidTxn = { ...validTxn, timestamp: 'yesterday afternoon' };
      const res = await request(app)
        .post('/transactions')
        .send(invalidTxn);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'timestamp' }),
        ])
      );
    });
  });

  describe('POST /transactions/batch (Bulk)', () => {
    it('should accept a valid batch of transactions and call sendBatch', async () => {
      const batch = [
        { ...validTxn, txnId: '123e4567-e89b-12d3-a456-426614174001', userId: 'user_1' },
        { ...validTxn, txnId: '123e4567-e89b-12d3-a456-426614174002', userId: 'user_2' },
      ];

      const res = await request(app)
        .post('/transactions/batch')
        .send(batch);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('status', 'accepted');
      expect(res.body).toHaveProperty('acceptedCount', 2);
      expect(res.body).toHaveProperty('rejectedCount', 0);
      expect(mockProducer.sendBatch).toHaveBeenCalledTimes(1);
    });

    it('should accept batch wrapped in { transactions: [...] }', async () => {
      const payload = {
        transactions: [
          { ...validTxn, txnId: '123e4567-e89b-12d3-a456-426614174003', userId: 'user_3' },
        ],
      };

      const res = await request(app)
        .post('/transactions/batch')
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('acceptedCount', 1);
      expect(mockProducer.sendBatch).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when batch is empty', async () => {
      const res = await request(app)
        .post('/transactions/batch')
        .send([]);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.message).toMatch(/at least 1 transaction/i);
      expect(mockProducer.sendBatch).not.toHaveBeenCalled();
    });

    it('should return 400 when payload is not an array or object with transactions', async () => {
      const res = await request(app)
        .post('/transactions/batch')
        .send('string-payload');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(mockProducer.sendBatch).not.toHaveBeenCalled();
    });

    it('should return 400 when batch exceeds maximum cap (500 items)', async () => {
      const largeBatch = Array.from({ length: 501 }, (_, i) => ({
        ...validTxn,
        txnId: `123e4567-e89b-12d3-a456-${String(i).padStart(12, '0')}`,
      }));

      const res = await request(app)
        .post('/transactions/batch')
        .send(largeBatch);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.message).toMatch(/exceeds maximum limit of 500/i);
      expect(mockProducer.sendBatch).not.toHaveBeenCalled();
    });

    it('should report per-item errors with index and publish valid items via sendBatch', async () => {
      const mixedBatch = [
        { ...validTxn, txnId: '123e4567-e89b-12d3-a456-426614174010', userId: 'user_valid_1' },
        { ...validTxn, txnId: 'invalid-uuid-at-index-1' }, // bad item at index 1
        { ...validTxn, txnId: '123e4567-e89b-12d3-a456-426614174012', userId: 'user_valid_2' },
        { ...validTxn, amount: -100 }, // bad item at index 3
      ];

      const res = await request(app)
        .post('/transactions/batch')
        .send(mixedBatch);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('status', 'partially_accepted');
      expect(res.body).toHaveProperty('acceptedCount', 2);
      expect(res.body).toHaveProperty('rejectedCount', 2);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ index: 1, field: 'txnId' }),
          expect.objectContaining({ index: 3, field: 'amount' }),
        ])
      );
      expect(mockProducer.sendBatch).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when all items in batch are invalid with their indices', async () => {
      const allInvalidBatch = [
        { ...validTxn, txnId: 'bad-uuid-0' },
        { ...validTxn, amount: -50 },
      ];

      const res = await request(app)
        .post('/transactions/batch')
        .send(allInvalidBatch);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ index: 0, field: 'txnId' }),
          expect.objectContaining({ index: 1, field: 'amount' }),
        ])
      );
      expect(mockProducer.sendBatch).not.toHaveBeenCalled();
    });
  });
});
