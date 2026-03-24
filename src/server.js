// =========================================================
//  ReceiptIQ — Backend API Server (Node.js + Express)
//  Entry point: src/server.js
// =========================================================

require('dotenv').config();
const fs         = require('fs');
const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const receiptRoutes = require('./routes/receipts');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const projectRoot = path.join(__dirname, '..');
const indexPath = path.join(projectRoot, 'index.html');

// ── SECURITY MIDDLEWARE ───────────────────────────────────
app.use(helmet());
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
app.use('/src', express.static(path.join(projectRoot, 'src'), { index: false }));
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(projectRoot, 'styles.css'));
});

app.get(['/', '/index.html'], (req, res, next) => {
  fs.readFile(indexPath, 'utf8', (error, html) => {
    if (error) {
      next(error);
      return;
    }

    const runtimeConfig = {
      apiBaseUrl: '/api',
      apiKey: process.env.API_KEY || 'YOUR_API_KEY_HERE'
    };

    const injectedHtml = html.replace(
      '</head>',
      `  <script>window.RECEIPTIQ_CONFIG = ${JSON.stringify(runtimeConfig)};</script>\n</head>`
    );

    res.type('html').send(injectedHtml);
  });
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
