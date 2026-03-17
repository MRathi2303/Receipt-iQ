// =========================================================
//  ReceiptIQ — AWS Lambda Function
//  Triggered by: S3 ObjectCreated event
//  Actions:
//    1. Retrieve file from S3
//    2. Run Textract OCR
//    3. Classify category via Comprehend / heuristic
//    4. Write results to DynamoDB
//    5. Publish to SNS → SES email
//
//  Deploy: lambda/index.js  (zip and upload to AWS Lambda)
// =========================================================

const {
  TextractClient,
  AnalyzeExpenseCommand
} = require('@aws-sdk/client-textract');

const {
  DynamoDBClient,
  PutItemCommand
} = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const {
  SNSClient,
  PublishCommand
} = require('@aws-sdk/client-sns');

const {
  S3Client,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');

// ╔══════════════════════════════════════════════════════════╗
// ║  🔧 CLOUD CONFIG — FILL IN THESE VALUES                 ║
// ╚══════════════════════════════════════════════════════════╝

// ⚠️  HIGHLIGHT: AWS Region for all services
const REGION = process.env.AWS_REGION || 'us-east-1';

// ⚠️  HIGHLIGHT: Your DynamoDB table name
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'YOUR_DYNAMODB_TABLE_NAME';

// ⚠️  HIGHLIGHT: Your SNS Topic ARN (copy from AWS SNS console)
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN || 'arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:YOUR_SNS_TOPIC';

// ⚠️  HIGHLIGHT: Verified sender email in AWS SES
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@yourdomain.com';

// =========================================================

const textract = new TextractClient({ region: REGION });
const dynamo   = new DynamoDBClient({ region: REGION });
const sns      = new SNSClient({ region: REGION });
const s3       = new S3Client({ region: REGION });


// ── LAMBDA HANDLER ────────────────────────────────────────
exports.handler = async (event) => {
  console.log('Lambda triggered:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key    = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    console.log(`Processing: s3://${bucket}/${key}`);

    try {
      // 1. Fetch metadata (email, docId) from S3 object
      const meta = await getS3Metadata(bucket, key);
      const email  = meta.email  || 'unknown@example.com';
      const docId  = meta.docid  || key.split('/').pop();
      const hintCategory = meta.category || 'auto';

      // 2. OCR with Textract AnalyzeExpense
      const extracted = await runTextract(bucket, key);

      // 3. Classify category
      const category = hintCategory !== 'auto'
        ? hintCategory
        : classifyCategory(extracted.merchant, extracted.lineItems);

      // 4. Build result record
      const result = {
        docId,
        s3Key:      key,
        bucket,
        email,
        merchant:   extracted.merchant,
        date:       extracted.date,
        total:      extracted.total,
        tax:        extracted.tax,
        lineItems:  extracted.lineItems,
        category,
        confidence: extracted.confidence,
        createdAt:  new Date().toISOString(),
        status:     'processed'
      };

      // 5. Write to DynamoDB
      await writeToDatabase(result);

      // 6. Publish to SNS (triggers SES email)
      await notifyUser(result);

      console.log(`✅  Done: ${docId}`);

    } catch (err) {
      console.error(`❌  Failed for key ${key}:`, err);
      // Don't throw — let other records process
    }
  }
};


// ── TEXTRACT OCR ──────────────────────────────────────────
async function runTextract(bucket, key) {
  const command = new AnalyzeExpenseCommand({
    Document: {
      S3Object: { Bucket: bucket, Name: key }
    }
  });

  const response = await textract.send(command);
  const docs = response.ExpenseDocuments || [];
  if (!docs.length) return emptyExtraction();

  const doc = docs[0];
  const fields  = doc.SummaryFields  || [];
  const groups  = doc.LineItemGroups || [];

  // Extract summary fields
  const merchant   = getFieldValue(fields, 'VENDOR_NAME');
  const date       = getFieldValue(fields, 'INVOICE_RECEIPT_DATE');
  const total      = getFieldValue(fields, 'TOTAL');
  const tax        = getFieldValue(fields, 'TAX');
  const confidence = avgConfidence(fields);

  // Extract line items
  const lineItems = [];
  for (const group of groups) {
    for (const lineItem of (group.LineItems || [])) {
      const item = {};
      for (const field of (lineItem.LineItemExpenseFields || [])) {
        if (field.Type?.Text === 'ITEM')     item.name     = field.ValueDetection?.Text;
        if (field.Type?.Text === 'QUANTITY') item.quantity = field.ValueDetection?.Text;
        if (field.Type?.Text === 'PRICE')    item.price    = field.ValueDetection?.Text;
      }
      if (item.name) lineItems.push(item);
    }
  }

  return { merchant, date, total, tax, lineItems, confidence };
}


// ── CLASSIFICATION ────────────────────────────────────────
const CATEGORY_RULES = {
  food:       /starbucks|mcdonald|pizza|restaurant|cafe|food|grocery|market|walmart|costco|whole foods|chipotle|uber eats|doordash/i,
  travel:     /airline|delta|united|hotel|marriott|hilton|uber|lyft|taxi|airbnb|car rental|hertz|avis/i,
  utilities:  /electric|gas|water|internet|comcast|verizon|at&t|utility|wework|office/i,
  medical:    /pharmacy|cvs|walgreens|hospital|clinic|dental|doctor|medical|health/i,
  shopping:   /amazon|target|best buy|apple store|nike|gap|zara|h&m|nordstrom/i
};

function classifyCategory(merchant = '', lineItems = []) {
  const text = [merchant, ...lineItems.map(i => i.name || '')].join(' ').toLowerCase();
  for (const [cat, regex] of Object.entries(CATEGORY_RULES)) {
    if (regex.test(text)) return cat;
  }
  return 'other';
}


// ── DYNAMODB WRITE ────────────────────────────────────────
async function writeToDatabase(result) {
  const command = new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(result, { removeUndefinedValues: true })
  });
  await dynamo.send(command);
  console.log(`Saved to DynamoDB: ${result.docId}`);
}


// ── SNS NOTIFICATION → SES EMAIL ─────────────────────────
async function notifyUser(result) {
  const message = buildEmailMessage(result);

  const command = new PublishCommand({
    TopicArn: SNS_TOPIC_ARN,
    Subject:  `ReceiptIQ: ${result.merchant} receipt processed`,
    Message:  JSON.stringify({
      email:   result.email,
      from:    SES_FROM_EMAIL,
      subject: `✅ Your ${result.merchant} receipt — ReceiptIQ`,
      body:    message,
      docId:   result.docId
    })
  });

  await sns.send(command);
  console.log(`SNS published for ${result.email}`);
}


// ── EMAIL BODY BUILDER ────────────────────────────────────
function buildEmailMessage(r) {
  const items = (r.lineItems || [])
    .slice(0, 8)
    .map(i => `  • ${i.name}${i.price ? ' — ' + i.price : ''}`)
    .join('\n');

  return `
Hello!

Your receipt has been processed by ReceiptIQ.

📋 SUMMARY
──────────────────────────
Merchant : ${r.merchant || 'Unknown'}
Date     : ${r.date     || '—'}
Category : ${r.category || '—'}
Tax      : ${r.tax      || '—'}
TOTAL    : ${r.total    || '—'}
Confidence: ${r.confidence ? (r.confidence * 100).toFixed(1) + '%' : '—'}
──────────────────────────
${items ? '\n🧾 LINE ITEMS\n' + items + '\n' : ''}
Document ID: ${r.docId}

View your full history at: https://YOUR_FRONTEND_URL/dashboard

Thank you for using ReceiptIQ!
  `.trim();
}


// ── HELPERS ───────────────────────────────────────────────
async function getS3Metadata(bucket, key) {
  const cmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
  const res = await s3.send(cmd);
  return res.Metadata || {};
}

function getFieldValue(fields, type) {
  const f = fields.find(f => f.Type?.Text === type);
  return f?.ValueDetection?.Text || null;
}

function avgConfidence(fields) {
  if (!fields.length) return null;
  const vals = fields
    .map(f => f.ValueDetection?.Confidence)
    .filter(Boolean);
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length / 100);
}

function emptyExtraction() {
  return { merchant: null, date: null, total: null, tax: null, lineItems: [], confidence: null };
}
