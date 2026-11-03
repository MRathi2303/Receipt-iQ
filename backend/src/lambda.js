const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const serverless = require('serverless-http');
const { validateEnvironment } = require('./config/validateEnv');

let handlerPromise;

async function loadJwtSecret() {
  if (process.env.JWT_SECRET || !process.env.JWT_SECRET_SECRET_ARN) {
    return;
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1'
  });
  const response = await client.send(new GetSecretValueCommand({
    SecretId: process.env.JWT_SECRET_SECRET_ARN
  }));

  if (!response.SecretString) {
    throw new Error('JWT secret was not returned by Secrets Manager.');
  }

  let secret = response.SecretString;
  try {
    const parsed = JSON.parse(response.SecretString);
    secret = parsed.JWT_SECRET || parsed.jwtSecret;
  } catch {
    // Plain-text secret values are also supported.
  }

  if (!secret || secret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters long.');
  }

  process.env.JWT_SECRET = secret;
}

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      await loadJwtSecret();
      validateEnvironment();
      const app = require('./server');
      return serverless(app, {
        binary: ['application/pdf', 'image/*', 'application/octet-stream']
      });
    })();
  }

  return handlerPromise;
}

exports.handler = async (event, context) => {
  const handler = await getHandler();
  return handler(event, context);
};
