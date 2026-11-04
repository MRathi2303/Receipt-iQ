# ReceiptIQ AWS infrastructure

This is the infrastructure reference for my current ReceiptIQ deployment. It
lists the resources I use, what each one does, and which part of the system is
allowed to access it.

Region: `us-east-1`
AWS CLI profile: `aws_second`

## Request and processing flow

```text
User
  |
  v
Vercel static frontend
  |
  v
API Gateway HTTP API
  |
  v
receiptiq-api Lambda
  |                         \
  v                          v
S3 receipt bucket       DynamoDB tables
  |
  v
S3 ObjectCreated -> SQS processing queue -> receiptiq-processor Lambda
                                             |
                                             v
                                      DynamoDB receipt record
                                             |
                                             v
                                Secrets Manager -> Gemini API
```

The API path handles authentication, upload URLs, receipt history, and
deletion. The processing path is asynchronous so the API does not wait for OCR
or AI extraction. Failed messages are retried and eventually moved to the DLQ.

## Resource inventory

| Resource | Current name or endpoint | Role in the system |
|---|---|---|
| Vercel project | `receipt-iq-live` | Serves the static frontend over HTTPS. |
| API Gateway HTTP API | `https://fn4khftdk3.execute-api.us-east-1.amazonaws.com` | Public HTTPS entry point for the Node.js API Lambda. |
| API Lambda | `receiptiq-api` | Handles JWT auth, receipt uploads, presigned S3 access, history, and deletion. |
| Receipt S3 bucket | `receipt-iq-bkt` | Stores customer receipt files under user-specific prefixes. |
| Frontend S3 bucket | `receiptiq-frontend-357275711997` | HTTPS fallback for static frontend files only. |
| SQS queue | `receiptiq-processing-queue` | Buffers S3 receipt events before processing. |
| SQS DLQ | `receiptiq-processing-dlq` | Holds messages that fail repeatedly for investigation. |
| Processor Lambda | `receiptiq-processor` | Runs the Python OCR/parser container and updates receipt records. |
| ECR repository | `receiptiq-processor` | Stores immutable processor container images. |
| Receipts DynamoDB table | `receiptiq-receipts-table` | Stores processing status, extracted fields, totals, and line items. |
| Users DynamoDB table | `receiptiq-users-table` | Stores user accounts and bcrypt password hashes. |
| AI secret | `receiptiq/production/ai` | Stores `GOOGLE_API_KEY`, read only by the processor Lambda. |
| CloudWatch Logs | Lambda log groups | Stores API and processor logs for debugging and operations. |

## IAM roles and access

### API Lambda execution role

The API role is trusted by Lambda and is used only by `receiptiq-api`.

It needs:

- CloudWatch Logs write access.
- S3 `PutObject`, `GetObject`, and `DeleteObject` for the receipt bucket's
  user receipt prefix.
- DynamoDB read/write access to the users and receipts tables and their
  required indexes.
- Secrets Manager access only to the JWT secret.

It does not need SQS consumer access or access to the Gemini API key.

### Processor Lambda execution role

The processor role is trusted by Lambda and is used only by
`receiptiq-processor`.

It needs:

- CloudWatch Logs write access.
- S3 `GetObject` and `HeadObject` for receipt objects.
- SQS `ReceiveMessage`, `DeleteMessage`, and `GetQueueAttributes` for the
  processing queue.
- DynamoDB read/write access to the receipt and users tables.
- `secretsmanager:GetSecretValue` only for
  `receiptiq/production/ai`.

The processor reads `GOOGLE_API_KEY` at runtime. The key is not stored in the
container image, Git, Docker build arguments, or frontend code.

### S3 notification permissions

The receipt bucket allows the S3 service to send `ObjectCreated` events for the
`users/` prefix to `receiptiq-processing-queue`. The queue policy restricts
that permission to the receipt bucket and the expected source account.

### API Gateway permissions

API Gateway is allowed to invoke `receiptiq-api`. It does not have direct
access to S3, DynamoDB, or Secrets Manager.

### ECR permissions

The deployment identity can push processor images to `receiptiq-processor`.
The Lambda service can pull the selected immutable image through its execution
role and ECR permissions.

## Data and security boundaries

- Receipt files and frontend files use separate S3 buckets.
- Receipt objects are stored below `users/{userId}/receipts/`.
- User IDs come from the verified JWT, not from a client-provided ownership
  field.
- JWT signing fails closed if `JWT_SECRET` is absent or shorter than 32
  characters.
- AI credentials are runtime secrets and are never exposed to the browser.
- DynamoDB tables use on-demand capacity and server-side encryption.
- SQS uses a visibility timeout suitable for the 120-second processor Lambda
  timeout and moves repeatedly failed messages to the DLQ.
- CloudWatch log retention is finite to control cost.

## Lambda and container settings

The processor Lambda uses:

- Container image package type.
- `x86_64` architecture.
- 1,536 MB memory.
- 120-second timeout.
- Immutable ECR image tags.
- ECR scan-on-push.

The API Lambda is deployed as a Node.js Lambda function behind API Gateway.
Neither Lambda is attached to a VPC, because the current serverless design
does not need NAT gateways or private subnets.

## Local equivalent

Docker Compose starts LocalStack and creates local S3 and DynamoDB resources.
This keeps local development isolated from production AWS resources. SQS and
Lambda are represented by the local application flow; the deployed AWS
environment provides the full managed event pipeline.

## Operational checks

I verify the deployment by:

1. Checking the API `/health` endpoint.
2. Registering and logging in through the frontend.
3. Uploading a PDF or image receipt.
4. Confirming the S3 object uses the expected user prefix.
5. Confirming the SQS message invokes the processor.
6. Confirming the DynamoDB record reaches `processed`.
7. Checking CloudWatch logs and the DLQ when a controlled failure is tested.
