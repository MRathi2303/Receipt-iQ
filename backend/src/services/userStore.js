// =========================================================
//  ReceiptIQ — User Store (DynamoDB-backed)
//  src/services/userStore.js
// =========================================================

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('crypto');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || 'receiptiq-users';

const dbClient = new DynamoDBClient({ region: REGION });

async function createUser({ name, email, passwordHash }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  // Check if email already exists via GSI
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    const error = new Error('An account already exists with this email.');
    error.statusCode = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    email: normalizedEmail,
    passwordHash,
    notificationStatus: 'pending_verification',
    notificationMessage: 'Notification setup is pending.',
    snsTopicArn: null,
    snsSubscriptionArn: null,
    createdAt: now,
    updatedAt: now
  };

  await dbClient.send(new PutItemCommand({
    TableName: USERS_TABLE,
    Item: marshall(user, { removeUndefinedValues: true }),
    ConditionExpression: 'attribute_not_exists(id)'
  }));

  return sanitizeUser(user);
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const response = await dbClient.send(new QueryCommand({
    TableName: USERS_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: marshall({ ':email': normalizedEmail }),
    Limit: 1
  }));

  const items = (response.Items || []).map(item => unmarshall(item));
  return items[0] || null;
}

async function findUserById(id) {
  const response = await dbClient.send(new GetItemCommand({
    TableName: USERS_TABLE,
    Key: marshall({ id })
  }));

  if (!response.Item) return null;
  return sanitizeUser(unmarshall(response.Item));
}

async function updateUser(userId, changes = {}) {
  // Build update expression dynamically from the changes object
  const expressionParts = [];
  const expressionNames = {};
  const expressionValues = {};
  let counter = 0;

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'id') continue; // Never update the primary key
    counter += 1;
    const nameAlias = `#f${counter}`;
    const valueAlias = `:v${counter}`;
    expressionParts.push(`${nameAlias} = ${valueAlias}`);
    expressionNames[nameAlias] = key;
    expressionValues[valueAlias] = value;
  }

  // Always update updatedAt
  counter += 1;
  expressionParts.push(`#f${counter} = :v${counter}`);
  expressionNames[`#f${counter}`] = 'updatedAt';
  expressionValues[`:v${counter}`] = new Date().toISOString();

  if (!expressionParts.length) return null;

  const response = await dbClient.send(new UpdateItemCommand({
    TableName: USERS_TABLE,
    Key: marshall({ id: userId }),
    UpdateExpression: `SET ${expressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: marshall(expressionValues, { removeUndefinedValues: true }),
    ReturnValues: 'ALL_NEW'
  }));

  if (!response.Attributes) return null;
  return sanitizeUser(unmarshall(response.Attributes));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    notificationStatus: user.notificationStatus || 'pending_verification',
    notificationMessage: user.notificationMessage || 'Notification setup is pending.',
    snsTopicArn: user.snsTopicArn || null,
    snsSubscriptionArn: user.snsSubscriptionArn || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
  sanitizeUser
};
