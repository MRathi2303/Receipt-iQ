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

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'YOUR_DYNAMODB_TABLE_NAME';
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN || '';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@yourdomain.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://YOUR_FRONTEND_URL';

const textract = new TextractClient({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });
const sns = new SNSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

const SUMMARY_FIELD_ALIASES = {
  merchant: ['VENDOR_NAME', 'SUPPLIER_NAME'],
  date: ['INVOICE_RECEIPT_DATE'],
  total: ['TOTAL', 'AMOUNT_DUE'],
  subtotal: ['SUBTOTAL'],
  tax: ['TAX', 'VAT', 'CGST', 'SGST', 'GST'],
  invoiceId: ['INVOICE_RECEIPT_ID'],
  currency: ['CURRENCY'],
  paymentTerms: ['PAYMENT_TERMS']
};

const CATEGORY_RULES = {
  food: /restaurant|cafe|coffee|bakery|grocery|supermarket|food|dining|market|whole foods|starbucks|uber eats|doordash|swiggy|zomato/i,
  travel: /airline|airport|flight|rail|metro|hotel|stay|uber|lyft|taxi|airbnb|travel|booking|car rental/i,
  utilities: /internet|broadband|water|electric|electricity|gas|telecom|mobile|wifi|utility|office/i,
  medical: /hospital|clinic|pharmacy|medical|health|doctor|diagnostic|lab|dental/i,
  shopping: /store|retail|amazon|flipkart|mall|mart|shopping|fashion|electronics|target|best buy/i
};

exports.handler = async (event) => {
  console.log('Lambda triggered:', JSON.stringify(event, null, 2));

  const results = [];

  for (const record of event.Records || []) {
    const bucket = record?.s3?.bucket?.name;
    const key = decodeURIComponent(String(record?.s3?.object?.key || '').replace(/\+/g, ' '));

    if (!bucket || !key) {
      console.warn('Skipping malformed S3 event record.');
      continue;
    }

    console.log(`Processing receipt: s3://${bucket}/${key}`);

    try {
      const metadata = await getS3Metadata(bucket, key);
      const context = buildReceiptContext(bucket, key, metadata);
      const extracted = await runTextract(bucket, key);
      const result = buildResultRecord(context, extracted);

      await writeToDatabase(result);
      await notifyUser(result);

      console.log(`Processed successfully: ${result.docId}`);
      results.push({ docId: result.docId, status: 'processed' });
    } catch (error) {
      console.error(`Failed processing ${key}:`, error);
      results.push({ key, status: 'failed', error: error.message });
    }
  }

  return {
    statusCode: 200,
    processed: results
  };
};

async function runTextract(bucket, key) {
  const command = new AnalyzeExpenseCommand({
    Document: {
      S3Object: { Bucket: bucket, Name: key }
    }
  });

  const response = await textract.send(command);
  const docs = response.ExpenseDocuments || [];
  if (!docs.length) {
    return emptyExtraction();
  }

  const doc = docs[0];
  const summaryFields = doc.SummaryFields || [];
  const groups = doc.LineItemGroups || [];

  const merchant = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.merchant);
  const dateText = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.date);
  const totalText = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.total);
  const subtotalText = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.subtotal);
  const taxText = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.tax);
  const invoiceId = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.invoiceId);
  const currencyText = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.currency);
  const paymentTerms = extractBestField(summaryFields, SUMMARY_FIELD_ALIASES.paymentTerms);

  const lineItems = extractLineItems(groups);
  const currency = inferCurrency(currencyText, [totalText, subtotalText, taxText], lineItems);
  const confidence = normalizeConfidence(computeAverageConfidence(summaryFields, lineItems));

  return {
    merchant: sanitizeText(merchant),
    date: normalizeDate(dateText),
    total: normalizeMoney(totalText, currency),
    subtotal: normalizeMoney(subtotalText, currency),
    tax: normalizeMoney(taxText, currency),
    invoiceId: sanitizeText(invoiceId),
    currency,
    paymentTerms: sanitizeText(paymentTerms),
    confidence,
    lineItems
  };
}

function extractLineItems(groups) {
  const items = [];

  for (const group of groups) {
    for (const lineItem of group.LineItems || []) {
      const item = {
        name: null,
        quantity: null,
        unitPrice: null,
        totalPrice: null,
        rawPrice: null,
        confidence: null
      };

      const confidences = [];

      for (const field of lineItem.LineItemExpenseFields || []) {
        const type = field.Type?.Text;
        const text = field.ValueDetection?.Text;
        const confidence = field.ValueDetection?.Confidence;

        if (confidence) {
          confidences.push(confidence);
        }

        if (type === 'ITEM') item.name = sanitizeText(text);
        if (type === 'QUANTITY') item.quantity = normalizeQuantity(text);
        if (type === 'PRICE') item.rawPrice = text;
      }

      if (item.rawPrice) {
        const normalizedMoney = normalizeMoney(item.rawPrice, null);
        item.totalPrice = normalizedMoney;
      }

      item.confidence = normalizeConfidence(computeSimpleAverage(confidences));

      if (item.name || item.totalPrice || item.quantity) {
        if (item.quantity && item.totalPrice && item.totalPrice.numericValue) {
          item.unitPrice = {
            value: roundMoney(item.totalPrice.numericValue / item.quantity),
            display: formatMoney(roundMoney(item.totalPrice.numericValue / item.quantity), item.totalPrice.currency)
          };
        }

        delete item.rawPrice;
        items.push(item);
      }
    }
  }

  return items;
}

function buildReceiptContext(bucket, key, metadata) {
  const email = sanitizeEmail(metadata.email) || 'unknown@example.com';
  const originalName = sanitizeText(metadata.originalname) || key.split('/').pop();
  const requestedCategory = sanitizeText(metadata.category) || 'auto';
  const docId = sanitizeText(metadata.docid) || key.split('/').pop();

  return {
    bucket,
    key,
    email,
    originalName,
    requestedCategory,
    docId
  };
}

function buildResultRecord(context, extracted) {
  const category = context.requestedCategory !== 'auto'
    ? context.requestedCategory
    : classifyCategory(extracted.merchant, extracted.lineItems);

  return {
    docId: context.docId,
    bucket: context.bucket,
    s3Key: context.key,
    originalName: context.originalName,
    email: context.email,
    merchant: extracted.merchant || 'Unknown Merchant',
    date: extracted.date || null,
    total: extracted.total?.display || null,
    totalValue: extracted.total?.numericValue ?? null,
    subtotal: extracted.subtotal?.display || null,
    subtotalValue: extracted.subtotal?.numericValue ?? null,
    tax: extracted.tax?.display || null,
    taxValue: extracted.tax?.numericValue ?? null,
    currency: extracted.currency || extracted.total?.currency || null,
    invoiceId: extracted.invoiceId || null,
    paymentTerms: extracted.paymentTerms || null,
    lineItems: extracted.lineItems || [],
    category,
    confidence: extracted.confidence,
    createdAt: new Date().toISOString(),
    status: 'processed'
  };
}

function classifyCategory(merchant = '', lineItems = []) {
  const text = [merchant, ...lineItems.map((item) => item.name || '')].join(' ');

  for (const [category, pattern] of Object.entries(CATEGORY_RULES)) {
    if (pattern.test(text)) {
      return category;
    }
  }

  return 'other';
}

async function writeToDatabase(result) {
  const command = new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(result, { removeUndefinedValues: true })
  });

  await dynamo.send(command);
}

async function notifyUser(result) {
  if (!SNS_TOPIC_ARN) {
    console.warn('SNS topic ARN not configured. Skipping notification publish.');
    return;
  }

  const message = buildEmailMessage(result);

  const command = new PublishCommand({
    TopicArn: SNS_TOPIC_ARN,
    Subject: `ReceiptIQ: ${result.merchant} receipt processed`,
    Message: JSON.stringify({
      email: result.email,
      from: SES_FROM_EMAIL,
      subject: `Your receipt from ${result.merchant} is ready`,
      body: message,
      docId: result.docId
    })
  });

  await sns.send(command);
}

function buildEmailMessage(result) {
  const lineItems = (result.lineItems || [])
    .slice(0, 8)
    .map((item) => {
      const pieces = [item.name || 'Item'];
      if (item.quantity) pieces.push(`qty ${item.quantity}`);
      if (item.totalPrice?.display) pieces.push(item.totalPrice.display);
      return `- ${pieces.join(' | ')}`;
    })
    .join('\n');

  return [
    'Hello,',
    '',
    'Your receipt has been processed successfully.',
    '',
    `Document ID: ${result.docId}`,
    `Merchant: ${result.merchant || 'Unknown'}`,
    `Date: ${result.date || 'Not detected'}`,
    `Category: ${result.category || 'other'}`,
    `Subtotal: ${result.subtotal || 'Not detected'}`,
    `Tax: ${result.tax || 'Not detected'}`,
    `Total: ${result.total || 'Not detected'}`,
    `Confidence: ${result.confidence ? `${result.confidence}%` : 'Not available'}`,
    '',
    lineItems ? `Line items:\n${lineItems}\n` : '',
    `View your app: ${FRONTEND_URL}`,
    '',
    'Thank you for using ReceiptIQ.'
  ].filter(Boolean).join('\n');
}

async function getS3Metadata(bucket, key) {
  const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  return response.Metadata || {};
}

function extractBestField(fields, aliases) {
  const candidates = fields.filter((field) => aliases.includes(field.Type?.Text));
  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => (b.ValueDetection?.Confidence || 0) - (a.ValueDetection?.Confidence || 0));
  return candidates[0]?.ValueDetection?.Text || null;
}

function computeAverageConfidence(summaryFields, lineItems) {
  const summaryConfidences = summaryFields
    .map((field) => field.ValueDetection?.Confidence)
    .filter(Boolean);

  const itemConfidences = lineItems
    .map((item) => {
      const numeric = Number.parseFloat(String(item.confidence || '').replace('%', ''));
      return Number.isFinite(numeric) ? numeric : null;
    })
    .filter(Boolean);

  return computeSimpleAverage([...summaryConfidences, ...itemConfidences]);
}

function computeSimpleAverage(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeConfidence(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = value <= 1 ? value * 100 : value;
  return Number.parseFloat(normalized.toFixed(1));
}

function normalizeMoney(text, fallbackCurrency) {
  if (!text) {
    return null;
  }

  const currency = inferCurrency(null, [text], []) || fallbackCurrency || 'USD';
  const numericText = String(text).replace(/[^0-9.,-]/g, '');
  if (!numericText) {
    return null;
  }

  const normalizedNumber = parseLocaleNumber(numericText);
  if (!Number.isFinite(normalizedNumber)) {
    return null;
  }

  return {
    numericValue: roundMoney(normalizedNumber),
    currency,
    display: formatMoney(roundMoney(normalizedNumber), currency)
  };
}

function parseLocaleNumber(value) {
  const text = String(value).trim();
  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;

  if (commaCount && dotCount) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      return Number.parseFloat(text.replace(/\./g, '').replace(',', '.'));
    }
    return Number.parseFloat(text.replace(/,/g, ''));
  }

  if (commaCount && !dotCount) {
    const parts = text.split(',');
    if (parts[parts.length - 1].length === 2) {
      return Number.parseFloat(text.replace(',', '.'));
    }
    return Number.parseFloat(text.replace(/,/g, ''));
  }

  return Number.parseFloat(text);
}

function roundMoney(value) {
  return Number.parseFloat(Number(value).toFixed(2));
}

function formatMoney(value, currency) {
  const symbol = currencySymbol(currency);
  return `${symbol}${Number(value).toFixed(2)}`;
}

function inferCurrency(explicitCurrency, moneyFields, lineItems) {
  const joinedText = [
    explicitCurrency,
    ...(moneyFields || []),
    ...(lineItems || []).map((item) => item.rawPrice || item.totalPrice?.display || '')
  ].join(' ');

  if (/₹|INR/i.test(joinedText)) return 'INR';
  if (/€|EUR/i.test(joinedText)) return 'EUR';
  if (/£|GBP/i.test(joinedText)) return 'GBP';
  if (/AED/i.test(joinedText)) return 'AED';
  if (/USD|\$/i.test(joinedText)) return 'USD';

  return explicitCurrency ? String(explicitCurrency).toUpperCase() : 'USD';
}

function currencySymbol(currency) {
  const symbols = {
    USD: '$',
    INR: 'Rs. ',
    EUR: 'EUR ',
    GBP: 'GBP ',
    AED: 'AED '
  };

  return symbols[currency] || `${currency || ''} `;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const slashMatch = String(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!slashMatch) {
    return sanitizeText(value);
  }

  let [, first, second, year] = slashMatch;
  if (year.length === 2) {
    year = `20${year}`;
  }

  const month = Number(first) > 12 ? second : first;
  const day = Number(first) > 12 ? first : second;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeQuantity(value) {
  if (!value) {
    return null;
  }

  const numeric = Number.parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) ? numeric : sanitizeText(value);
}

function sanitizeText(value) {
  if (value == null) {
    return null;
  }

  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function sanitizeEmail(value) {
  const email = sanitizeText(value);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function emptyExtraction() {
  return {
    merchant: null,
    date: null,
    total: null,
    subtotal: null,
    tax: null,
    invoiceId: null,
    currency: 'USD',
    paymentTerms: null,
    confidence: null,
    lineItems: []
  };
}
