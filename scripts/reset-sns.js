require('dotenv').config({ path: '.env' });
const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE_NAME = process.env.DYNAMODB_USERS_TABLE || 'receiptiq-users';

const dbClient = new DynamoDBClient({ region: REGION });

async function run() {
  console.log('Scanning users in', TABLE_NAME);
  const scan = await dbClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  const users = (scan.Items || []).map(i => unmarshall(i));
  
  console.log(`Found ${users.length} users. Resetting SNS fields...`);
  
  for (const user of users) {
    if (!user.id) continue;
    
    await dbClient.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ id: user.id }),
      UpdateExpression: 'REMOVE snsTopicArn, snsSubscriptionArn SET notificationStatus = :st, notificationMessage = :msg',
      ExpressionAttributeValues: marshall({
        ':st': 'pending_verification',
        ':msg': 'Notification system reset. Please wait or refresh for setup.'
      })
    }));
    console.log(`Reset user: ${user.email}`);
  }
  
  console.log('Done!');
}

run().catch(console.error);
