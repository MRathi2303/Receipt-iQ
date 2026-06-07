const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'API_KEY',
  'FRONTEND_URL',
  'AWS_REGION',
  'S3_BUCKET_NAME',
  'DYNAMODB_TABLE_NAME'
];

const OPTIONAL_ENV_VARS = [
  'SES_FROM_EMAIL',
  'SNS_TOPIC_PREFIX',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'POLL_INTERVAL_MS',
  'MAX_POLL_ATTEMPTS',
  'REQUEST_TIMEOUT_MS',
  'USER_CACHE_TTL_MS',
  'DYNAMODB_USER_ID_INDEX'
];

function validateEnvironment() {
  const missing = [];
  
  for (const varName of REQUIRED_ENV_VARS) {
    const value = process.env[varName];
    if (!value || value === '') {
      missing.push(varName);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please set them in your .env file.`);
  }
  
  const apiKey = process.env.API_KEY;
  if (apiKey === 'YOUR_API_KEY_HERE' || apiKey?.length < 32) {
    throw new Error('API_KEY must be a strong random string (at least 32 characters).');
  }
  
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret === 'receiptiq-dev-secret' || jwtSecret?.length < 32) {
    throw new Error('JWT_SECRET must be a strong random string (at least 32 characters).');
  }
  
  const frontendUrl = process.env.FRONTEND_URL;
  try {
    const url = new URL(frontendUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('FRONTEND_URL must be http or https');
    }
  } catch {
    throw new Error('FRONTEND_URL must be a valid URL');
  }
  
  console.log('✓ Environment validation passed');
  console.log(`  - AWS Region: ${process.env.AWS_REGION}`);
  console.log(`  - DynamoDB Table: ${process.env.DYNAMODB_TABLE_NAME}`);
  console.log(`  - S3 Bucket: ${process.env.S3_BUCKET_NAME}`);
  
  return true;
}

module.exports = { validateEnvironment, REQUIRED_ENV_VARS, OPTIONAL_ENV_VARS };