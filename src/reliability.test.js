const { once } = require('events');
const { marshall } = require('@aws-sdk/util-dynamodb');

async function request(app, { method, path, headers = {}, body } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    return {
      status: response.status,
      body: payload
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createAuthApp(overrides = {}) {
  jest.resetModules();

  const bcryptMock = {
    hash: jest.fn().mockResolvedValue('hashed-password'),
    compare: jest.fn().mockResolvedValue(false)
  };
  const userStoreMock = {
    createUser: jest.fn(),
    findUserByEmail: jest.fn(),
    sanitizeUser: jest.fn((user) => user)
  };
  const notificationMock = {
    initializeUserNotifications: jest.fn(),
    refreshUserNotifications: jest.fn()
  };
  const authMock = {
    signUserToken: jest.fn(() => 'signed-token'),
    requireAuth: jest.fn((req, res, next) => {
      req.user = overrides.user || {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        notificationStatus: 'verified',
        notificationMessage: 'SNS notification delivery is active for this account.',
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        snsSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-subscription'
      };
      next();
    })
  };

  jest.doMock('bcryptjs', () => bcryptMock);
  jest.doMock('./services/userStore', () => userStoreMock);
  jest.doMock('./services/notificationService', () => notificationMock);
  jest.doMock('./middleware/auth', () => authMock);

  const express = require('express');
  const authRoutes = require('./routes/auth');
  const { errorHandler } = require('./middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);

  return {
    app,
    mocks: {
      bcryptMock,
      userStoreMock,
      notificationMock,
      authMock
    }
  };
}

function createReceiptsApp(overrides = {}) {
  jest.resetModules();

  const receiptStoreMock = {
    uploadToS3: jest.fn().mockResolvedValue({ bucket: 'bucket', key: 'key' }),
    createReceiptRecord: jest.fn().mockResolvedValue({ docId: 'DOC-1' }),
    getReceiptsFromDB: jest.fn(),
    getReceiptById: jest.fn()
  };
  const authMock = {
    signUserToken: jest.fn(() => 'signed-token'),
    requireAuth: jest.fn((req, res, next) => {
      req.user = overrides.user || {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        notificationStatus: 'verified',
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic'
      };
      next();
    })
  };

  jest.doMock('./services/s3Service', () => ({
    uploadToS3: receiptStoreMock.uploadToS3,
    deleteFromS3: jest.fn().mockResolvedValue({}),
    getPresignedUrl: jest.fn().mockResolvedValue('https://presigned-url')
  }));
  jest.doMock('./services/dbService', () => ({
    getReceiptsFromDB: receiptStoreMock.getReceiptsFromDB,
    getReceiptById: receiptStoreMock.getReceiptById,
    createReceiptRecord: receiptStoreMock.createReceiptRecord,
    deleteReceiptById: jest.fn().mockResolvedValue(null),
    findReceiptByHash: jest.fn().mockResolvedValue(null)
  }));
  jest.doMock('./middleware/auth', () => authMock);

  const express = require('express');
  const receiptRoutes = require('./routes/receipts');
  const { errorHandler } = require('./middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use('/api/receipts', receiptRoutes);
  app.use(errorHandler);

  return {
    app,
    mocks: {
      receiptStoreMock,
      authMock
    }
  };
}

describe('auth reliability', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-api-key';
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('rejects duplicate signups with a 409', async () => {
    const { app, mocks } = createAuthApp();
    const duplicateError = new Error('An account already exists with this email.');
    duplicateError.statusCode = 409;
    mocks.userStoreMock.createUser.mockRejectedValueOnce(duplicateError);

    const result = await request(app, {
      method: 'POST',
      path: '/api/auth/signup',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      })
    });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'An account already exists with this email.'
    });
    expect(mocks.notificationMock.initializeUserNotifications).not.toHaveBeenCalled();
    expect(mocks.authMock.signUserToken).not.toHaveBeenCalled();
  });

  test('rejects invalid login credentials with a 401', async () => {
    const { app, mocks } = createAuthApp();
    mocks.userStoreMock.findUserByEmail.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      passwordHash: 'hashed-password'
    });

    const result = await request(app, {
      method: 'POST',
      path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'wrong-password'
      })
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      error: 'Invalid email or password.'
    });
    expect(mocks.notificationMock.refreshUserNotifications).not.toHaveBeenCalled();
    expect(mocks.authMock.signUserToken).not.toHaveBeenCalled();
  });
});

describe('receipt reliability', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-api-key';
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('returns a paginated receipt slice after scanning all pages', async () => {
    jest.resetModules();

    const send = jest.fn();
    const DynamoDBClient = jest.fn(() => ({ send }));
    class ScanCommand {
      constructor(input) {
        this.input = input;
      }
    }
    class GetItemCommand {
      constructor(input) {
        this.input = input;
      }
    }
    class PutItemCommand {
      constructor(input) {
        this.input = input;
      }
    }

    jest.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient,
      ScanCommand,
      QueryCommand: class QueryCommand { constructor(input) { this.input = input; } },
      GetItemCommand,
      PutItemCommand,
      DeleteItemCommand: class DeleteItemCommand { constructor(input) { this.input = input; } }
    }));

    const { getReceiptsFromDB } = require('./services/dbService');

    send
      .mockResolvedValueOnce({
        Items: [
          marshall({
            docId: 'DOC-1',
            userId: 'user-1',
            createdAt: '2026-04-03T12:00:00.000Z',
            merchant: 'Alpha Store',
            total: '10.00'
          })
        ],
        LastEvaluatedKey: { docId: { S: 'DOC-1' } }
      })
      .mockResolvedValueOnce({
        Items: [
          marshall({
            docId: 'DOC-3',
            userId: 'user-1',
            createdAt: '2026-04-01T12:00:00.000Z',
            merchant: 'Gamma Market',
            total: '30.00'
          })
        ]
      });

    const result = await getReceiptsFromDB({ limit: 1, offset: 1, userId: 'user-1' });

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      docId: 'DOC-3',
      merchant: 'Gamma Market',
      status: 'processing'
    });
  });

  test('accepts a receipt upload and queues persistence before S3 upload', async () => {
    const { app, mocks } = createReceiptsApp();

    const formData = new FormData();
    formData.append('category', 'auto');
    formData.append('file', new Blob(['%PDF-1.4 test pdf'], { type: 'application/pdf' }), 'receipt.pdf');

    const result = await request(app, {
      method: 'POST',
      path: '/api/receipts/upload',
      headers: {
        'x-api-key': 'test-api-key'
      },
      body: formData
    });

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      success: true,
      status: 'processing',
      receiptUrl: expect.stringMatching(/^\/api\/receipts\/DOC-/)
    });
    expect(mocks.receiptStoreMock.createReceiptRecord).toHaveBeenCalledTimes(1);
    expect(mocks.receiptStoreMock.uploadToS3).toHaveBeenCalledTimes(1);
  });
});