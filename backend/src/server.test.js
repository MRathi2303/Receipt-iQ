const app = require('./server');
const { validateApiKey, errorHandler } = require('./middleware/errorHandler');

describe('ReceiptIQ server wiring', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    process.env.API_KEY = 'test-api-key';
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('exports an Express app instance', () => {
    expect(typeof app).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  test('validateApiKey rejects requests without a matching API key', () => {
    const req = { headers: {} };
    const res = createResponse();
    const next = jest.fn();

    validateApiKey(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toEqual({
      error: 'Unauthorized: invalid or missing API key.'
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('validateApiKey calls next for authorized requests', () => {
    const req = { headers: { 'x-api-key': 'test-api-key' } };
    const res = createResponse();
    const next = jest.fn();

    validateApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  test('errorHandler maps Multer size errors to HTTP 413', () => {
    const req = {};
    const res = createResponse();

    errorHandler({ code: 'LIMIT_FILE_SIZE' }, req, res, jest.fn());

    expect(res.statusCode).toBe(413);
    expect(res.jsonBody).toEqual({
      error: 'File too large. Maximum size is 10 MB.'
    });
  });
});

function createResponse() {
  return {
    statusCode: null,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    }
  };
}
