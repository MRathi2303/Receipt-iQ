# Receipt processor

I run the receipt processor as an AWS Lambda container image. It downloads the
uploaded file from S3, extracts text, applies OCR when needed, parses the
receipt fields, and writes the result to DynamoDB.

## Processing flow

1. Read the S3 object referenced by the queue message.
2. Try direct PDF text extraction.
3. Use Tesseract OCR when the page has insufficient selectable text.
4. Parse merchant, date, totals, category, and line items.
5. Optionally use Gemini to improve extraction.
6. Store the result and processing status in DynamoDB.

The deterministic OCR/parser path remains the fallback when Gemini is not
configured or unavailable. The Lambda handler is `app.handler`.

## Build and publish

I build the image for Lambda's `x86_64` runtime and use an immutable Git-based
tag:

```bash
AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
AWS_REGION="us-east-1"
REPOSITORY="receiptiq-processor"
IMAGE_TAG="$(git rev-parse --short HEAD)"

aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -t "$REPOSITORY:$IMAGE_TAG" \
  ./lambda_pdf_processor

docker tag "$REPOSITORY:$IMAGE_TAG" \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPOSITORY:$IMAGE_TAG"

docker push \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPOSITORY:$IMAGE_TAG"
```

The `--platform`, `--provenance`, and `--sbom` flags keep the image compatible
with Lambda container image requirements.

## Lambda configuration

The processor uses:

```text
DYNAMODB_TABLE_NAME=receiptiq-receipts-table
DYNAMODB_USERS_TABLE=receiptiq-users-table
AI_PROVIDER=gemini
GOOGLE_MODEL=gemini-3.8-flash
AI_SECRET_ARN=<Secrets Manager ARN>
```

The Lambda role needs CloudWatch Logs, S3 read access for receipt objects,
DynamoDB read/write access for the receipt tables, SQS consume permissions,
and `secretsmanager:GetSecretValue` for the single AI secret. The API key is
loaded at runtime and is never copied into the image.

See [`docs/AWS-INFRASTRUCTURE.md`](../docs/AWS-INFRASTRUCTURE.md) for the
resource names and responsibilities.
