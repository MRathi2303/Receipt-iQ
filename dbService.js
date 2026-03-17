// =========================================================
//  ReceiptIQ — Database Service (DynamoDB)
//  src/services/dbService.js
// =========================================================

const {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

// ╔══════════════════════════════════════════════════════════╗
// ║  🔧 CLOUD CONFIG — FILL IN THESE VALUES                 ║
// ╚══════════════════════════════════════════════════════════╝

const dbClient = new DynamoDBClient({
  // ⚠️  HIGHLIGHT: Same region as your S3 bucket and Lambda
  region: process.env.AWS_REGION || 'us-east-1'
});

// ⚠️  HIGHLIGHT: Your DynamoDB table name (create in AWS console)
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'YOUR_DYNAMODB_TABLE_NAME';

// =========================================================


/**
 * Fetch all processed receipts (paginated)
 */
async function getReceiptsFromDB({ limit = 20, offset = 0 }) {
  // Note: DynamoDB Scan is fine for small tables.
  // For production with large data, use Query with GSI on date.
  const command = new ScanCommand({
    TableName: TABLE_NAME,
    Limit: limit + offset
  });

  const response = await dbClient.send(command);
  const items = (response.Items || [])
    .slice(offset)
    .map(item => unmarshall(item))
    .map(formatReceipt);

  return { items, total: response.Count || 0 };
}


/**
 * Fetch single receipt by docId
 */
async function getReceiptById(docId) {
  const command = new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ docId })
  });

  const response = await dbClient.send(command);
  if (!response.Item) return null;

  return formatReceipt(unmarshall(response.Item));
}


/**
 * Normalize DynamoDB item to clean API shape
 */
function formatReceipt(raw) {
  return {
    docId:      raw.docId,
    merchant:   raw.merchant    || 'Unknown',
    date:       raw.date        || '—',
    total:      raw.total       ? `$${parseFloat(raw.total).toFixed(2)}` : '—',
    tax:        raw.tax         ? `$${parseFloat(raw.tax).toFixed(2)}` : '—',
    category:   raw.category    || 'Other',
    confidence: raw.confidence  ? `${(raw.confidence * 100).toFixed(1)}%` : '—',
    s3Key:      raw.s3Key       || null,
    createdAt:  raw.createdAt   || null,
    lineItems:  raw.lineItems   || []
  };
}


module.exports = { getReceiptsFromDB, getReceiptById };
