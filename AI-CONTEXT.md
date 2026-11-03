# ReceiptIQ AI continuation context

This file is the handoff contract for any AI tool working on this repository,
including Copilot, Codex, Claude, Gemini, Antigravity, and future tools.

## Mandatory update rule

Every AI run that reads, changes, tests, or reviews this repository must:

1. Read this file and [`AGENTS.md`](AGENTS.md) before acting.
2. Read [`WORKLOG.md`](WORKLOG.md) to understand the latest state.
3. Make the requested changes without reintroducing removed SNS/email behavior.
4. Run the smallest relevant validation.
5. Update `WORKLOG.md` before the final response, even if no code change was made.
6. Update this file when architecture, commands, deployment state, or known
   limitations change.

If an AI tool cannot update the work log, it must stop and clearly report that
limitation instead of claiming the task is complete.

## Current architecture

- Frontend: static HTML/CSS/JavaScript served by Vercel (Nginx/Docker remains available for local deployment)
- Backend: Node.js and Express
- Auth: bcrypt password hashes and JWT
- Storage: S3
- Database: DynamoDB
- Processing: AWS Lambda container image
- Reliability path: S3 -> SQS -> Lambda -> DynamoDB, with a DLQ
- Active AWS profile/region: `aws_second` / `us-east-1`
- Lambda function: `receiptiq-processor`
- Lambda image: ECR `receiptiq-processor`, immutable tag `lambda-20261028000642`
- S3 event notification: `receipt-iq-bkt/users/` ObjectCreated -> `receiptiq-processing-queue`
- SQS event source mapping: `974147cd-8c74-4bcc-94d5-58f4bd2d6e68` -> `receiptiq-processor`
- Backend hosting: API Gateway HTTP API -> Lambda (serverless; ECS is not required)
- Frontend hosting: Vercel production project `frontend`, with AWS S3 HTTPS fallback
- Frontend motion: lightweight Scroll Craft-inspired scroll reveals and progress indicator; no runtime dependency
- Frontend visual direction: Hallmark modern-minimal guardrails and a Cinetic-inspired scan-to-ready hero sequence implemented with native CSS
- Google Gemini is the supported hosted AI enhancement path; the deployed processor uses `gemini-3.8-flash` and loads `GOOGLE_API_KEY` from Secrets Manager at cold start via `AI_SECRET_ARN`. Never use a Docker build argument. Deterministic OCR/parser extraction remains the fallback.
- Parsing: pdfplumber, Tesseract, deterministic parser
- Optional AI: hosted provider using Gemini or OpenAI-compatible API
- Local development: Docker Compose and LocalStack
- AWS provisioning: manual Console/CLI only; Terraform is intentionally not used
- Cost target: no always-on compute; AWS usage and retained storage can still incur charges
- Active API endpoint: `https://fn4khftdk3.execute-api.us-east-1.amazonaws.com`
- Active frontend endpoint: `https://frontend-neon-omega-72.vercel.app`
- Active frontend fallback: `https://receiptiq-frontend-357275711997.s3.us-east-1.amazonaws.com/index.html`
- CloudFront creation is blocked until AWS account verification; S3 HTTPS object hosting is active
- Monitoring: 14-day Lambda log retention and alarms for API errors, processor errors, and visible DLQ messages

## Explicit product decisions

- SNS is removed.
- SES and email verification are removed.
- Receipt processing results appear in the workspace only.
- Do not add email notifications back without explicit user approval.
- Do not add Terraform or automatic AWS provisioning without explicit user approval.
- Do not commit credentials, API keys, generated files, or `.env` files.
- JWT authentication fails closed when `JWT_SECRET` is absent or shorter than 32 characters; local Compose and Lambda startup provide validated secrets.

## Important files

- Manual AWS runbook: [`docs/AWS-MANUAL-SETUP.md`](docs/AWS-MANUAL-SETUP.md)
- Lambda build/deploy notes: [`lambda_pdf_processor/README.md`](lambda_pdf_processor/README.md)
- Application overview: [`README.md`](README.md)
- Local stack: [`docker-compose.yml`](docker-compose.yml)
- Backend environment template: [`backend/.env.example`](backend/.env.example)

## Validation commands

```bash
cd backend
npm ci
npm test -- --runInBand
npm audit --omit=dev --audit-level=high

cd ..
python3 -m py_compile lambda_pdf_processor/app.py
docker compose config
```
