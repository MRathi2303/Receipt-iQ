// =========================================================
//  ReceiptIQ — Receipt Routes
//  src/routes/receipts.js
// =========================================================

const express   = require('express');
const crypto    = require('crypto');
const multer    = require('multer');
const router    = express.Router();
const path      = require('path');

const { uploadToS3, deleteFromS3, getPresignedUrl } = require('../services/s3Service');
const { getReceiptsFromDB, getReceiptById, createReceiptRecord, deleteReceiptById, findReceiptByHash } = require('../services/dbService');
const { requireAuth } = require('../middleware/auth');
const { validateApiKey } = require('../middleware/errorHandler');

// Multer: accept PDF + images, store in memory before streaming to S3
const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only PDF and image files (JPG, PNG, WebP) are allowed.'));
    }
    cb(null, true);
  }
});

// ── POST /api/receipts/upload ─────────────────────────────
// Receives: multipart/form-data { file, category }
// Returns:  { docId, status, message }
router.post('/upload', validateApiKey, requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const { category } = req.body;
    const file = req.file;
    const user = req.user;
    const email = user.email;

    if (!file) return res.status(400).json({ error: 'No file provided.' });

    // ── Duplicate detection via SHA-256 hash ──────────────
    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await findReceiptByHash(user.id, fileHash);
    if (duplicate) {
      return res.status(409).json({
        error: 'This receipt appears to have been uploaded before.',
        duplicate: true,
        existingDocId: duplicate.docId,
        existingMerchant: duplicate.merchant,
        existingDate: duplicate.date
      });
    }

    // Generate a unique document ID
    const docId = `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const extension = path.extname(file.originalname || '').toLowerCase();
    const safeExtension = extension && /^\.[a-z0-9]+$/.test(extension) ? extension : '';
    const s3Key = `users/${user.id}/receipts/${new Date().getFullYear()}/${String(new Date().getMonth()+1).padStart(2,'0')}/${docId}${safeExtension}`;
    const timestamp = new Date().toISOString();

    await createReceiptRecord({
      docId,
      bucket: null,
      s3Key,
      userId: user.id,
      userName: user.name,
      originalName: file.originalname,
      email,
      merchant: null,
      date: null,
      total: null,
      totalValue: null,
      subtotal: null,
      subtotalValue: null,
      tax: null,
      taxValue: null,
      currency: null,
      invoiceId: null,
      paymentTerms: null,
      lineItems: [],
      category: category || 'auto',
      confidence: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'processing',
      emailDeliveryStatus: 'pending',
      fileHash
    });

    // Upload file buffer to S3 (triggers Lambda via S3 event)
    await uploadToS3({
      key:         s3Key,
      buffer:      file.buffer,
      contentType: file.mimetype,
      metadata: {
        email:    email,
        category: category || 'auto',
        docId:    docId,
        originalName: file.originalname,
        userId: user.id,
        userName: user.name,
        notificationStatus: user.notificationStatus || 'pending_verification',
        notificationTopicArn: user.snsTopicArn || ''
      }
    });

    // Respond immediately — Lambda does async processing
    res.status(202).json({
      success: true,
      docId,
      status: 'processing',
      message: `Receipt uploaded. Processing started. Check ${email} for results.`,
      receiptUrl: `/api/receipts/${docId}`
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /api/receipts ─────────────────────────────────────
// List processed receipts from DB
router.get('/', validateApiKey, requireAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const { items, total } = await getReceiptsFromDB({ limit, offset, userId: req.user.id });

    res.json({ items, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/receipts/:docId ──────────────────────────────
// Get single receipt result
router.get('/:docId', validateApiKey, requireAuth, async (req, res, next) => {
  try {
    const item = await getReceiptById(req.params.docId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Receipt not found.' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/receipts/:docId/download ─────────────────────
// Generate presigned URL for the original file
router.get('/:docId/download', validateApiKey, requireAuth, async (req, res, next) => {
  try {
    const item = await getReceiptById(req.params.docId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Receipt not found.' });
    if (!item.s3Key) return res.status(404).json({ error: 'Original file not available.' });

    const url = await getPresignedUrl(item.s3Key, 900);
    res.json({ url, expiresIn: 900 });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/receipts/:docId ───────────────────────────
// Delete a receipt (DB record + S3 object)
router.delete('/:docId', validateApiKey, requireAuth, async (req, res, next) => {
  try {
    const deleted = await deleteReceiptById(req.params.docId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Receipt not found.' });

    // Best-effort S3 cleanup (don't fail if S3 delete fails)
    if (deleted.s3Key) {
      try {
        await deleteFromS3(deleted.s3Key);
      } catch (s3Err) {
        console.error('S3 delete failed (non-fatal):', s3Err.message);
      }
    }

    res.json({ success: true, message: 'Receipt deleted.', docId: req.params.docId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
