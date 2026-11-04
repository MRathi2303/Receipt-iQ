# ReceiptIQ

I built ReceiptIQ as a serverless receipt-processing project to practice
event-driven AWS architecture, containerized workloads, and production
operations.

## What I built

When a user uploads a receipt, the API stores the file in S3 and creates the
receipt record in DynamoDB. S3 sends an event to SQS, and the processor Lambda
consumes that message, extracts the receipt data, and updates DynamoDB.

```text
Vercel frontend
        |
API Gateway -> API Lambda -> S3 and DynamoDB
        |
S3 upload -> SQS -> processor Lambda -> DynamoDB
                         |
                 Secrets Manager -> Gemini
```

The processor uses direct PDF text extraction, Tesseract OCR, and deterministic
parsing. I also added Google Gemini as an optional enhancement, while keeping
the deterministic path available if the model is unavailable.

## Main features

- JWT authentication with bcrypt password hashing.
- User-owned PDF and image receipt uploads.
- Asynchronous processing through S3, SQS, Lambda, and DynamoDB.
- Receipt history, structured details, analytics, and deletion.
- SQS retry handling and a dead-letter queue for failed messages.
- Runtime AI secrets loaded from AWS Secrets Manager.
- Docker Compose and LocalStack for local development.
- GitHub Actions checks for tests, audits, and container builds.

## Run locally

I use Docker Compose to run the frontend, API, and LocalStack:

```bash
docker compose up --build
```

The frontend is available at [http://localhost:8080](http://localhost:8080).
The API health check is available at
[http://localhost:4000/health](http://localhost:4000/health).

Local development does not need AWS credentials or a Gemini key. The
deterministic OCR/parser path works without hosted AI.

## Gemini configuration

For local processor development:

```dotenv
AI_PROVIDER=gemini
GOOGLE_API_KEY=replace-me
GOOGLE_MODEL=gemini-3.8-flash
```

In AWS, the processor reads the key from Secrets Manager at runtime. I do not
put credentials in Dockerfiles, image build arguments, frontend files, or Git.

## Live deployment

- Frontend: [receipt-iq-live.vercel.app](https://receipt-iq-live.vercel.app)
- API health:
  [AWS API endpoint](https://fn4khftdk3.execute-api.us-east-1.amazonaws.com/health)
- S3 frontend fallback:
  [HTTPS endpoint](https://receiptiq-frontend-357275711997.s3.us-east-1.amazonaws.com/index.html)

The complete deployed infrastructure and the role of each resource are listed
in [`docs/AWS-INFRASTRUCTURE.md`](docs/AWS-INFRASTRUCTURE.md).

## Checks I run before pushing

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
