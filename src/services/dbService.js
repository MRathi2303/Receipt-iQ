// =========================================================
//  ReceiptIQ — Database Service (DynamoDB)
//  src/services/dbService.js
// =========================================================

const {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'YOUR_DYNAMODB_TABLE_NAME';
const USER_INDEX = 'userId-createdAt-index';


/**
 * Fetch receipts for a specific user using the GSI (no more full-table scan).
 * Falls back to scan-style query when no userId is given.
 */
async function getReceiptsFromDB({ limit = 20, offset = 0, userId = null }) {
  if (!userId) {
    return { items: [], total: 0 };
  }

  const allItems = [];
  let lastEvaluatedKey;

  do {
    const response = await dbClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: USER_INDEX,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: marshall({ ':uid': userId }),
      ScanIndexForward: false,   // newest first
      ExclusiveStartKey: lastEvaluatedKey
    }));

    allItems.push(...(response.Items || []).map(item => unmarshall(item)));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const items = allItems.slice(offset, offset + limit).map(formatReceipt);
  return { items, total: allItems.length };
}


/**
 * Fetch single receipt by docId
 */
async function getReceiptById(docId, userId = null) {
  const command = new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ docId })
  });

  const response = await dbClient.send(command);
  if (!response.Item) return null;
  const item = unmarshall(response.Item);
  if (userId && item.userId !== userId) {
    return null;
  }

  return formatReceipt(item);
}

/**
 * Create a receipt record
 */
async function createReceiptRecord(receipt) {
  const command = new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(receipt, { removeUndefinedValues: true })
  });

  await dbClient.send(command);
  return formatReceipt(receipt);
}

/**
 * Delete a receipt record by docId (with ownership check)
 */
async function deleteReceiptById(docId, userId) {
  // First verify ownership
  const item = await getReceiptById(docId, userId);
  if (!item) return null;

  await dbClient.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ docId })
  }));

  return item;
}

/**
 * Find a receipt by file hash (for duplicate detection).
 * Uses a scan-style query on the user's receipts since hash is not a key.
 */
async function findReceiptByHash(userId, fileHash) {
  if (!userId || !fileHash) return null;

  const response = await dbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: USER_INDEX,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: 'fileHash = :hash',
    ExpressionAttributeValues: marshall({ ':uid': userId, ':hash': fileHash }),
    Limit: 1
  }));

  const items = (response.Items || []).map(item => unmarshall(item));
  return items[0] ? formatReceipt(items[0]) : null;
}


/**
 * Normalize DynamoDB item to clean API shape
 */
function formatReceipt(raw) {
  const totalValue = raw.totalValue ?? extractNumericValue(raw.total);
  const subtotalValue = raw.subtotalValue ?? extractNumericValue(raw.subtotal);
  const taxValue = raw.taxValue ?? extractNumericValue(raw.tax);
  const confidenceValue = raw.confidence == null
    ? null
    : Number.parseFloat(String(raw.confidence).replace('%', ''));

  return {
    docId:      raw.docId,
    merchant:   compactText(raw.merchant, 96) || 'Unknown',
    date:       raw.date        || '—',
    total:      formatMoneyValue(raw.total, totalValue, raw.currency),
    subtotal:   formatMoneyValue(raw.subtotal, subtotalValue, raw.currency),
    tax:        formatMoneyValue(raw.tax, taxValue, raw.currency),
    category:   raw.category    || 'Other',
    confidence: Number.isFinite(confidenceValue) ? `${confidenceValue.toFixed(1)}%` : '—',
    s3Key:      raw.s3Key       || null,
    createdAt:  raw.createdAt   || null,
    updatedAt:  raw.updatedAt   || raw.createdAt || null,
    lineItems:  raw.lineItems   || [],
    status:     raw.status      || 'processing',
    email:      raw.email       || null,
    userId:     raw.userId      || null,
    userName:   raw.userName    || null,
    originalName: raw.originalName || null,
    invoiceId: compactText(raw.invoiceId, 48),
    emailDeliveryStatus: raw.emailDeliveryStatus || 'pending',
    errorMessage: raw.errorMessage || null,
    fileHash:   raw.fileHash    || null
  };
}

function formatMoneyValue(displayValue, numericValue, currency = 'USD') {
  if (displayValue && /[0-9]/.test(String(displayValue))) {
    const trimmed = String(displayValue).trim();
    return /^[A-Za-z$Rs.]/.test(trimmed) ? trimmed : formatCurrency(numericValue, currency);
  }

  if (Number.isFinite(numericValue)) {
    return formatCurrency(numericValue, currency);
  }

  return '—';
}

function formatCurrency(value, currency = 'USD') {
  const symbols = {
    USD: '$',
    INR: 'Rs. ',
    EUR: 'EUR ',
    GBP: 'GBP ',
    AED: 'AED '
  };

  return `${symbols[currency] || `${currency} `}${Number(value).toFixed(2)}`;
}

function extractNumericValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const numeric = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function compactText(value, maxLength = 80) {
  if (value == null) {
    return null;
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}...`;
}

module.exports = { getReceiptsFromDB, getReceiptById, createReceiptRecord, deleteReceiptById, findReceiptByHash };
