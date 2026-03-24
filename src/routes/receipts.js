// =========================================================
//  ReceiptIQ — Receipt Routes
//  src/routes/receipts.js
// =========================================================

const express   = require('express');
const multer    = require('multer');
const router    = express.Router();

const { uploadToS3 }        = require('../services/s3Service');
const { getReceiptsFromDB, getReceiptById } = require('../services/dbService');
const { validateApiKey } = require('../middleware/errorHandler');

// Multer: store in memory before streaming to S3
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed.'));
    }
    cb(null, true);
  }
});

// ── POST /api/receipts/upload ─────────────────────────────
// Receives: multipart/form-data { file, email, category }
// Returns:  { docId, status, message }
router.post('/upload', validateApiKey, upload.single('file'), async (req, res, next) => {
  try {
    const { email, category } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file provided.' });
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    // Generate a unique document ID
    const docId = `DOC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const s3Key = `receipts/${new Date().getFullYear()}/${String(new Date().getMonth()+1).padStart(2,'0')}/${docId}`;

    // Upload file buffer to S3 (triggers Lambda via S3 event)
    await uploadToS3({
      key:         s3Key,
      buffer:      file.buffer,
      contentType: file.mimetype,
      metadata: {
        email:    email,
        category: category || 'auto',
        docId:    docId,
        originalName: file.originalname
      }
    });

    // Respond immediately — Lambda does async processing
    res.status(202).json({
      success: true,
      docId,
      status: 'processing',
      message: `Receipt uploaded. Processing started. Check ${email} for results.`
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /api/receipts ─────────────────────────────────────
// List processed receipts from DB
router.get('/', validateApiKey, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const { items, total } = await getReceiptsFromDB({ limit, offset });

    res.json({ items, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/receipts/:docId ──────────────────────────────
// Get single receipt result
router.get('/:docId', validateApiKey, async (req, res, next) => {
  try {
    const item = await getReceiptById(req.params.docId);
    if (!item) return res.status(404).json({ error: 'Receipt not found.' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
