#!/usr/bin/env node
// =========================================================
//  ReceiptIQ — One-time User Migration: JSON → DynamoDB
//  Run: node scripts/migrate-users.js
// =========================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || 'receiptiq-users';
const usersPath = path.join(__dirname, '..', 'data', 'users.json');

const dbClient = new DynamoDBClient({ region: REGION });

async function migrate() {
  if (!fs.existsSync(usersPath)) {
    console.log('No users.json found — nothing to migrate.');
    return;
  }

  const content = fs.readFileSync(usersPath, 'utf8');
  const parsed = JSON.parse(content || '{"users":[]}');
  const users = Array.isArray(parsed.users) ? parsed.users : [];

  if (!users.length) {
    console.log('No users to migrate.');
    return;
  }

  console.log(`Migrating ${users.length} user(s) to DynamoDB table "${USERS_TABLE}"...`);

  for (const user of users) {
    try {
      await dbClient.send(new PutItemCommand({
        TableName: USERS_TABLE,
        Item: marshall(user, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(id)'
      }));
      console.log(`  ✓ ${user.email} (${user.id})`);
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log(`  ⊘ ${user.email} — already exists, skipping.`);
      } else {
        console.error(`  ✗ ${user.email} — ${error.message}`);
      }
    }
  }

  console.log('Migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
