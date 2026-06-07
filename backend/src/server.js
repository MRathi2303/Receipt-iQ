// =========================================================
//  ReceiptIQ — Backend API Server (Node.js + Express)
//  Entry point: src/server.js
// =========================================================

require('dotenv').config();
const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const receiptRoutes = require('./routes/receipts');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const projectRoot = path.join(__dirname, '..');
const frontendRoot = path.join(__dirname, '../../frontend');

// ── SECURITY MIDDLEWARE ───────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"]
    }
  }
}));
app.use(cors({
  // ⚠️  HIGHLIGHT: Replace with your deployed frontend URL
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization']
}));

// ── RATE LIMITING ─────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                   // 50 requests per window
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api', limiter);

// ── BODY PARSING ──────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// ── STATIC FRONTEND ───────────────────────────────────────
app.use(express.static(frontendRoot, { index: false }));
app.get('/vendor/axios.min.js', (req, res) => {
  res.sendFile(path.join(frontendRoot, 'vendor', 'axios.min.js'));
});
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(frontendRoot, 'styles.css'));
});
app.get('/app.js', (req, res) => {
  res.sendFile(path.join(frontendRoot, 'app.js'));
});
app.get('/runtime-config.js', (req, res) => {
  const runtimeConfig = {
    apiBaseUrl: '/api',
    apiKey: process.env.API_KEY || 'YOUR_API_KEY_HERE'
  };

  res.type('application/javascript').send(
    `window.RECEIPTIQ_CONFIG = ${JSON.stringify(runtimeConfig)};`
  );
});

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── ROUTES ────────────────────────────────────────────────
app.use('/api/receipts', receiptRoutes);
app.use('/api/auth', authRoutes);

// ── ERROR HANDLER ─────────────────────────────────────────
app.use(errorHandler);

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ReceiptIQ API running on port ${PORT}`);
  });
}

module.exports = app;
