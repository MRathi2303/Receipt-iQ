# ReceiptIQ

ReceiptIQ is an event-driven receipt processing platform built to demonstrate
production-oriented cloud and DevOps practices.

## Architecture

```text
Vercel static frontend
        |
API Gateway HTTP API -> API Lambda -> S3 and DynamoDB
        |
S3 receipt upload -> SQS queue -> processor Lambda -> DynamoDB
                                      |
                              Secrets Manager -> Gemini
```

The processing path is asynchronous and uses an SQS dead-letter queue for
retries and failures. Deterministic OCR and parsing remain available when the
hosted AI provider is unavailable.

## Capabilities

- Secure JWT authentication with bcrypt password hashing.
- PDF and image receipt uploads with ownership isolation.
- OCR, deterministic extraction, and optional Google Gemini enhancement.
- Receipt history, structured details, analytics, and deletion controls.
- Retry and DLQ handling for asynchronous processing.
- Containerized Python processing with Docker Compose and LocalStack.
- GitHub Actions validation for tests, audits, and container builds.

## Local development

Requirements: Docker Desktop, Node.js 22+, and Python 3.12+ for direct
processor development.

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). The API health endpoint is
available at [http://localhost:4000/health](http://localhost:4000/health).
LocalStack initializes development S3 and DynamoDB resources automatically.

## Google Gemini

For local processor development, configure:

```dotenv
AI_PROVIDER=gemini
GOOGLE_API_KEY=replace-me
GOOGLE_MODEL=gemini-3.8-flash
```

In AWS, the processor loads the key at runtime from Secrets Manager through
`AI_SECRET_ARN`. Never put credentials in a Dockerfile, image build argument,
frontend file, or GitHub repository. Deterministic extraction remains the
fallback if Gemini is unavailable.

## Deployment

AWS resources are configured manually using the runbook in
[`docs/AWS-MANUAL-SETUP.md`](docs/AWS-MANUAL-SETUP.md). The processor image
build and deployment steps are documented in
[`lambda_pdf_processor/README.md`](lambda_pdf_processor/README.md).

Current deployment:

- Frontend: [receipt-iq-live.vercel.app](https://receipt-iq-live.vercel.app)
- API health: [AWS API health endpoint](https://fn4khftdk3.execute-api.us-east-1.amazonaws.com/health)
- Frontend fallback:
  [S3 HTTPS endpoint](https://receiptiq-frontend-357275711997.s3.us-east-1.amazonaws.com/index.html)

The frontend is static. Authentication, uploads, processing, and storage use
the serverless AWS API and pipeline.

## Verification

```bash
cd backend
npm ci
npm test -- --runInBand
npm audit --omit=dev --audit-level=high

cd ..
python3 -m py_compile lambda_pdf_processor/app.py
node --check frontend/app.js
docker compose config
git diff --check
```
