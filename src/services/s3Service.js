// =========================================================
//  ReceiptIQ — S3 Service
//  src/services/s3Service.js
// =========================================================

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ╔══════════════════════════════════════════════════════════╗
// ║  🔧 CLOUD CONFIG — FILL IN THESE VALUES                 ║
// ╚══════════════════════════════════════════════════════════╝

const s3Client = new S3Client({
  // ⚠️  HIGHLIGHT: Your AWS region (e.g. 'us-east-1', 'eu-west-1')
  region: process.env.AWS_REGION || 'us-east-1',

  // ⚠️  HIGHLIGHT: Only needed for local dev — in production use IAM Role
  // credentials: {
  //   accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // }
});

// ⚠️  HIGHLIGHT: Your S3 bucket name created in AWS console
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'YOUR_S3_BUCKET_NAME';

// =========================================================


/**
 * Upload a file buffer to S3
 * @param {Object} params
 * @param {string} params.key         - S3 object key (path)
 * @param {Buffer} params.buffer      - File contents
 * @param {string} params.contentType - MIME type
 * @param {Object} params.metadata    - Custom metadata (email, docId, etc.)
 */
async function uploadToS3({ key, buffer, contentType, metadata = {} }) {
  const command = new PutObjectCommand({
    Bucket:      BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
    // Metadata values must be strings
    Metadata: Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, String(v)])
    ),
    ServerSideEncryption: 'AES256'
  });

  const result = await s3Client.send(command);

  return {
    bucket: BUCKET_NAME,
    key,
    etag: result.ETag,
    location: `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`
  };
}


/**
 * Generate a presigned download URL (expires in 15 min)
 * @param {string} key - S3 object key
 */
async function getPresignedUrl(key, expiresInSeconds = 900) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key:    key
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}


module.exports = { uploadToS3, getPresignedUrl, BUCKET_NAME };
