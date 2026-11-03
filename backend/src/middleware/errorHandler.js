// =========================================================
//  ReceiptIQ — Middleware
// =========================================================

// ── AUTH: API Key Validation ──────────────────────────────
// ╔══════════════════════════════════════════════════════════╗
// ║  🔧 CLOUD CONFIG — FILL IN THESE VALUES                 ║
// ╚══════════════════════════════════════════════════════════╝

function validateApiKey(req, res, next) {
  const VALID_API_KEY = process.env.API_KEY;

  // JWT authentication is the primary application boundary. An API key can
  // still be enabled for deployments that need an additional gateway secret.
  if (!VALID_API_KEY) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== VALID_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key.' });
  }
  next();
}

// ─────────────────────────────────────────────────────────

// ── ERROR HANDLER ─────────────────────────────────────────
function errorHandler(err, req, res, next) {
  console.error('API Error:', err.message, err.stack);

  // Multer file-size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });
  }
  // Multer file-type error
  if (err.message && err.message.includes('Only PDF')) {
    return res.status(415).json({ error: err.message });
  }

  const status  = err.statusCode || err.status || 500;
  const message = status === 500 ? 'Internal server error.' : err.message;

  res.status(status).json({ error: message });
}

module.exports = { validateApiKey, errorHandler };
