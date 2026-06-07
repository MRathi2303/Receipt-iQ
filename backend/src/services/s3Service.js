// =========================================================
//  ReceiptIQ — S3 Service
//  src/services/s3Service.js
// =========================================================

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'YOUR_S3_BUCKET_NAME';


/**
 * Upload a file buffer to S3
 */
async function uploadToS3({ key, buffer, contentType, metadata = {} }) {
  const command = new PutObjectCommand({
    Bucket:      BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
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
 * Delete an object from S3
 */
async function deleteFromS3(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });

  await s3Client.send(command);
  return { bucket: BUCKET_NAME, key };
}


/**
 * Generate a presigned download URL (expires in 15 min)
 */
async function getPresignedUrl(key, expiresInSeconds = 900) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key:    key
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}


module.exports = { uploadToS3, deleteFromS3, getPresignedUrl, BUCKET_NAME };
