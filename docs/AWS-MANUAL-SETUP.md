# ReceiptIQ AWS manual setup

This runbook documents the current low-cost production architecture. AWS
resources are created manually with the Console or CLI; Terraform and
automatic provisioning are intentionally not used.

Region: `us-east-1`
CLI profile: `aws_second`

## Architecture

```text
Vercel frontend -> API Gateway HTTP API -> API Lambda -> S3/DynamoDB
S3 receipt bucket -> SQS queue -> processor Lambda -> DynamoDB
                                      |
                              Secrets Manager -> Gemini
```

The design uses no always-on compute. SQS and its dead-letter queue provide
retry isolation for processor failures.

## Current production resources

- API Lambda: `receiptiq-api`
- Processor Lambda: `receiptiq-processor`
- API Gateway: `https://fn4khftdk3.execute-api.us-east-1.amazonaws.com`
- Receipt bucket: `receipt-iq-bkt`
- Frontend bucket: `receiptiq-frontend-357275711997`
- Processing queue: `receiptiq-processing-queue`
- Processing DLQ: `receiptiq-processing-dlq`
- AI secret: `receiptiq/production/ai`
- Frontend: `https://receipt-iq-live.vercel.app`

## 1. Configure the AWS CLI

```bash
aws configure sso --profile aws_second
export AWS_PROFILE=aws_second
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

Use an IAM identity with MFA for daily work. Never place access keys,
passwords, receipt data, or model keys in Git, Dockerfiles, frontend files, or
GitHub Actions logs.

## 2. Create storage

Create a private receipt bucket with versioning, encryption, object ownership
set to bucket-owner-enforced, and a lifecycle policy for test data. Receipt
objects use this prefix:

```text
users/{userId}/receipts/{year}/{month}/{docId}.{extension}
```

Create these on-demand DynamoDB tables:

### Receipts table

- Table: `receiptiq-receipts-table`
- Partition key: `docId` (String)
- GSI: `userId-createdAt-index`
- GSI keys: `userId` (String), `createdAt` (String)
- Point-in-time recovery and server-side encryption: enabled

### Users table

- Table: `receiptiq-users-table`
- Partition key: `id` (String)
- GSI: `email-index`
- GSI key: `email` (String)
- Point-in-time recovery and server-side encryption: enabled

## 3. Configure asynchronous processing

Create:

- `receiptiq-processing-queue`
- `receiptiq-processing-dlq`

Use a visibility timeout of at least 360 seconds, a retention period of four
days or longer, and a maximum receive count of three before DLQ transfer.
Enable server-side encryption.

Configure the S3 `ObjectCreated` notification for the `users/` prefix to send
to the processing queue. Configure the processor Lambda event source mapping
with batch size 1, a five-second maximum batching window, and partial batch
failure reporting.

## 4. Configure IAM

Create a Lambda execution role trusted by `lambda.amazonaws.com` with
CloudWatch Logs permissions. Scope application permissions to:

- Receipt S3 prefix: `s3:GetObject`, `s3:HeadObject`
- API receipt operations: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
- Required DynamoDB table and index operations
- Processor queue receive/delete/attributes operations
- `secretsmanager:GetSecretValue` only for `receiptiq/production/ai`

Do not use static AWS credentials in application configuration.

## 5. Deploy the API Lambda

The Node.js API is packaged for Lambda through
[`backend/src/lambda.js`](../backend/src/lambda.js). Configure:

```text
NODE_ENV=production
AWS_REGION=us-east-1
S3_BUCKET_NAME=receipt-iq-bkt
DYNAMODB_TABLE_NAME=receiptiq-receipts-table
DYNAMODB_USERS_TABLE=receiptiq-users-table
FRONTEND_URL=https://receipt-iq-live.vercel.app
JWT_SECRET=<random value with at least 32 characters>
```

Validate the environment before deployment. JWT configuration fails closed
when the secret is missing or too short.

## 6. Deploy the processor

Build the container for Lambda's `x86_64` architecture and push an immutable
tag to ECR. Follow the exact commands in
[`lambda_pdf_processor/README.md`](../lambda_pdf_processor/README.md).

Configure:

```text
DYNAMODB_TABLE_NAME=receiptiq-receipts-table
DYNAMODB_USERS_TABLE=receiptiq-users-table
AI_PROVIDER=gemini
GOOGLE_MODEL=gemini-3.8-flash
AI_SECRET_ARN=arn:aws:secretsmanager:us-east-1:<account>:secret:receiptiq/production/ai
```

The processor loads `GOOGLE_API_KEY` from Secrets Manager at runtime. Never
use a Docker build argument for the key. Deterministic OCR/parser processing
remains the fallback.

## 7. Configure the AI secret

Create `receiptiq/production/ai` in Secrets Manager:

```json
{
  "GOOGLE_API_KEY": "replace-me"
}
```

Grant `secretsmanager:GetSecretValue` only to the processor role. Rotate or
replace the secret through Secrets Manager rather than changing source code.

## 8. Frontend hosting

The production frontend is deployed to Vercel from `frontend/`. It uses the
AWS API endpoint from `frontend/runtime-config.js`. Do not put an AWS or AI
secret in that file.

The S3 frontend endpoint remains an HTTPS fallback. Receipt storage must remain
private and separate from the frontend bucket.

## 9. Monitoring and smoke test

Create CloudWatch alarms for Lambda errors, throttles, duration, DynamoDB
throttles, and visible messages in the processing DLQ. Keep log retention
finite, such as 14 or 30 days.

Smoke test:

1. Register and log in through the frontend.
2. Upload a small PDF or image.
3. Confirm the object is stored under the user prefix.
4. Confirm SQS invokes the processor.
5. Confirm the DynamoDB receipt changes from `processing` to `processed`.
6. Confirm the result appears in the authenticated workspace.
7. Test a controlled processor failure and confirm retry/DLQ behavior.

## 10. Teardown

Delete event source mappings and Lambda functions, SQS queues, ECR images,
DynamoDB tables, test S3 objects/buckets, unused IAM roles and policies,
Secrets Manager test secrets, and CloudWatch log groups. Review Cost Explorer
after cleanup.
