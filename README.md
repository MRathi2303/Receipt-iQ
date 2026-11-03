# ReceiptIQ

ReceiptIQ is an event-driven receipt processing platform that demonstrates
production-oriented DevOps practices:

- containerized local development with Docker Compose
- LocalStack emulation of S3 and DynamoDB
- OCR and deterministic parsing with an optional hosted AI enhancement
- manual AWS configuration with least-privilege IAM
- GitHub Actions checks and manually controlled AWS deployment
- automated tests, dependency auditing, and container builds

## Local development

Requirements:

- Docker Desktop
- Node.js 22+
- Python 3.12+ only when developing the processor directly

Start the complete local stack:

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). The API health endpoint is
available at [http://localhost:4000/health](http://localhost:4000/health).

LocalStack initializes the S3 bucket and DynamoDB tables automatically. No AWS
account, AWS credentials, or model API key is required for the deterministic
OCR/parser path.

## Hosted AI enhancement

The processor supports free hosted models through either the existing Gemini
format or an OpenAI-compatible API:

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-key
AI_MODEL=your-free-model
```

The parser does not fail closed when the provider is unavailable. It logs the
provider failure and keeps the deterministic extraction result.

For Google Gemini, use `AI_PROVIDER=gemini`, `GOOGLE_API_KEY`, and optionally
`GOOGLE_MODEL=gemini-3.8-flash`. Keep the key in local environment configuration
or AWS Secrets Manager; never put it in a Dockerfile or image build argument.

## AWS deployment

All AWS resources are intentionally configured manually so you can practice the
AWS console and CLI workflows. Follow
[`docs/AWS-MANUAL-SETUP.md`](docs/AWS-MANUAL-SETUP.md) in order.

The Lambda container build and ECR commands are documented in
[`lambda_pdf_processor/README.md`](lambda_pdf_processor/README.md). Never commit
AWS keys or hosted-model credentials.

## Live deployment

- Frontend: [ReceiptIQ on Vercel](https://frontend-neon-omega-72.vercel.app)
- API health: [AWS API health endpoint](https://fn4khftdk3.execute-api.us-east-1.amazonaws.com/health)
- AWS frontend fallback: [S3 frontend](https://receiptiq-frontend-357275711997.s3.us-east-1.amazonaws.com/index.html)

The Vercel deployment hosts only the static frontend. Authentication, receipt
uploads, processing, and storage continue to use the serverless AWS API and
pipeline.

The frontend uses a lightweight Scroll Craft-inspired motion layer for
scroll-progress feedback and progressive content reveals. It is implemented
with native CSS and browser APIs, so it adds no runtime package or hosting
cost.

The hero also uses a Cinetic-inspired scan-to-ready sequence to make the
receipt pipeline legible at a glance. Hallmark-inspired focus states,
reduced-motion behavior, and content-safe reveals are implemented natively.

## Verification

```bash
cd backend
npm ci
npm test -- --runInBand
npm audit --omit=dev --audit-level=high

cd ..
docker compose config
```
