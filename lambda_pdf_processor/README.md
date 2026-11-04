# Python PDF Lambda

This folder contains the replacement Lambda implementation for receipt processing.

It is designed to run as an AWS Lambda container image and supports PDF files only.

Flow:

1. Download uploaded PDF from S3
2. For each page, try direct text extraction first
3. If the page does not contain enough selectable text, OCR that page with Tesseract
4. Parse merchant/date/amount fields from the combined text
5. Store the result in DynamoDB
AI extraction is provider-agnostic. For Google Gemini, set `AI_PROVIDER=gemini`,
`GOOGLE_API_KEY`, and optionally `GOOGLE_MODEL`. The key is read at runtime and
must be stored in Secrets Manager or local environment configuration, never in a
Dockerfile, build argument, image layer, or Git repository. The deterministic
OCR/parser remains the fallback when the provider is unavailable.

Build example:

```bash
docker build -t receiptiq-pdf-lambda ./lambda_pdf_processor
```

The Lambda handler is `app.handler`.

## Manual ECR and Lambda deployment

Run these commands from the repository root after configuring the AWS CLI for
the target account and region. The current ReceiptIQ account uses the
`aws_second` profile in `us-east-1`:

```bash
AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
AWS_PROFILE="aws_second"
AWS_REGION="us-east-1"
REPOSITORY="receiptiq-processor"
IMAGE_TAG="$(git rev-parse --short HEAD)"

aws ecr create-repository \
  --repository-name "$REPOSITORY" \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE \
  --region "$AWS_REGION" || true

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

Create the Lambda function as a **container image** in the AWS console using
the pushed image. Set:

- timeout: 120 seconds
- memory: 1536 MB
- architecture: x86_64
- `DYNAMODB_TABLE_NAME`
- `DYNAMODB_USERS_TABLE`
- `AI_PROVIDER`
- `AI_BASE_URL`
- `AI_MODEL`
- `AI_API_KEY` from Secrets Manager or an encrypted deployment workflow
- `GOOGLE_API_KEY` from Google AI Studio, stored as a runtime secret
- `GOOGLE_MODEL` (default: `gemini-3.8-flash`)

The Lambda role needs CloudWatch Logs, S3 `GetObject`/`HeadObject`, DynamoDB
`GetItem`/`PutItem`/`UpdateItem`, and SQS consume permissions when the SQS
reliability path is enabled.

The `--platform linux/amd64 --provenance=false --sbom=false` flags are
required for compatibility with Lambda container image manifests.

See [`docs/AWS-MANUAL-SETUP.md`](../docs/AWS-MANUAL-SETUP.md) for the complete
resource order, policies, event wiring, and smoke tests.
