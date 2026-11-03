# ReceiptIQ manual AWS setup

This runbook is intentionally written for manual AWS Console and AWS CLI
practice. It does not use Terraform or automatically create resources.

Current target region: `us-east-1` (N. Virginia), using the local AWS CLI
profile `aws_second`. Change the region consistently everywhere if you move
the deployment.

## 0. Account safety

Before creating resources:

1. Enable MFA on the root account.
2. Do not use the root account for daily work.
3. Create an IAM administrator or IAM Identity Center user.
4. Configure a billing alarm and a monthly budget.
5. Configure the AWS CLI with a named profile:

```bash
aws configure sso --profile aws_second
export AWS_PROFILE=aws_second
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

Never put access keys, model keys, or passwords in Git, Dockerfiles, frontend
files, or GitHub Actions logs.

## 0.1 Active low-cost deployment

The primary deployment is serverless and does not require ECS, an ALB, a VPC,
or a NAT Gateway:

```text
S3 frontend -> API Gateway HTTP API -> receiptiq-api Lambda
                                      -> S3/DynamoDB
S3 receipt bucket -> SQS -> receiptiq-processor Lambda -> DynamoDB
```

Current deployed values:

- API Lambda: `receiptiq-api`
- API Gateway endpoint: `https://fn4khftdk3.execute-api.us-east-1.amazonaws.com`
- Frontend bucket: `receiptiq-frontend-357275711997`
- Frontend HTTPS URL:
  `https://receiptiq-frontend-357275711997.s3.us-east-1.amazonaws.com/index.html`
- Processor SQS event source mapping:
  `974147cd-8c74-4bcc-94d5-58f4bd2d6e68`

CloudFront is the preferred frontend distribution, but this AWS account
currently requires account verification before new CloudFront resources can
be created. Until AWS Support verifies the account, the private-bucket
CloudFront step cannot be completed; the active fallback is the HTTPS S3
object endpoint above. The fallback requires public read access to the
frontend-only bucket and must not be used for receipt storage.

The current deployment is fully usable through the S3 HTTPS frontend URL, but
it is not the final private-frontend security posture. After account
verification, create CloudFront and replace the public frontend bucket policy
with the CloudFront Origin Access Control policy described in Section 12.

## 1. Create the S3 receipt bucket

Create a bucket with a globally unique name, for example:

```bash
export RECEIPTS_BUCKET="receiptiq-receipts-ACCOUNT_ID"
aws s3api create-bucket \
  --bucket "$RECEIPTS_BUCKET" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
```

Configure:

- Block all public access: enabled
- Bucket versioning: enabled
- Default encryption: SSE-S3 or SSE-KMS
- Object ownership: bucket owner enforced
- Lifecycle rule: transition old receipt objects or expire test data
- CORS: allow only the deployed frontend origin if browser presigned access is used

Receipt object keys must use:

```text
users/{userId}/receipts/{year}/{month}/{docId}.{extension}
```

## 2. Create DynamoDB tables

### Receipts table

Create a table with:

- Table name: `receiptiq-receipts-table`
- Partition key: `docId` (String)
- Billing mode: On-demand
- Point-in-time recovery: enabled
- Server-side encryption: enabled

Create this GSI:

- Index name: `userId-createdAt-index`
- Partition key: `userId` (String)
- Sort key: `createdAt` (String)
- Projection: All

### Users table

Create a second table with:

- Table name: `receiptiq-users-table`
- Partition key: `id` (String)
- Billing mode: On-demand
- Point-in-time recovery: enabled
- Server-side encryption: enabled

Create this GSI:

- Index name: `email-index`
- Partition key: `email` (String)
- Projection: All

## 3. Create the SQS processing queue and dead-letter queue

Create:

- Queue: `receiptiq-processing-queue`
- Dead-letter queue: `receiptiq-processing-dlq`
- Visibility timeout: at least 360 seconds
- Message retention: 4 days or longer
- Maximum receives before DLQ: 3
- Server-side encryption: enabled

Use the queue between S3 and Lambda for production reliability:

```text
S3 ObjectCreated -> SQS processing queue -> Lambda event source mapping
                                      \-> DLQ after repeated failures
```

Configure the Lambda event source mapping with batch size 1 initially,
maximum batching window 5 seconds, and enabled state. The Lambda role needs
`sqs:ReceiveMessage`, `sqs:DeleteMessage`, and `sqs:GetQueueAttributes` on the
processing queue.

Create a CloudWatch alarm for visible messages on the DLQ. If you skip SQS
during initial learning, direct S3-to-Lambda wiring is acceptable, but SQS/DLQ
is the recommended production design.

## 4. Create the Lambda execution role

Create an IAM role trusted by `lambda.amazonaws.com`.

Attach the AWS managed policy:

- `AWSLambdaBasicExecutionRole`

Add a custom inline policy. Replace the bucket and table ARNs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadReceiptObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:HeadObject"],
      "Resource": "arn:aws:s3:::REPLACE_BUCKET_NAME/users/*"
    },
    {
      "Sid": "ReceiptDatabase",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:ACCOUNT_ID:table/receiptiq-receipts-table",
        "arn:aws:dynamodb:us-east-1:ACCOUNT_ID:table/receiptiq-users-table"
      ]
    }
  ]
}
```

SNS, SES, and email permissions are intentionally not required.

## 5. Build and push the processor image

Follow the commands in [`lambda_pdf_processor/README.md`](../lambda_pdf_processor/README.md).

Use immutable image tags based on a commit SHA. Enable ECR scan-on-push and
review the scan before deploying the image.

## 6. Create the Lambda function

Create a Lambda function from the ECR image:

- Name: `receiptiq-processor`
- Package type: Container image
- Memory: 1536 MB
- Timeout: 120 seconds
- Architecture: x86_64
- Execution role: the role from step 3

Environment variables:

```text
DYNAMODB_TABLE_NAME=receiptiq-receipts-table
DYNAMODB_USERS_TABLE=receiptiq-users-table
AI_PROVIDER=gemini
GOOGLE_MODEL=gemini-3.8-flash
GOOGLE_API_KEY=<secret>
```

Prefer AWS Secrets Manager for `GOOGLE_API_KEY` (or `AI_API_KEY` for an
OpenAI-compatible provider). If Lambda environment variables
are used temporarily, enable KMS encryption and do not expose the value in
logs or screenshots.

For the deployed processor, set `AI_SECRET_ARN` to the ARN of this secret.
The Lambda loads `GOOGLE_API_KEY` at cold start and never logs the secret.

## 7. Connect S3 to SQS

Before creating the notification, the queue must allow the S3 service
principal to send messages. S3 validates this permission when the
notification is saved. Add a policy to `receiptiq-processing-queue` with
these values (replace the account ID and bucket name if your resources
differ):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReceiptBucketToSend",
      "Effect": "Allow",
      "Principal": { "Service": "s3.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:ACCOUNT_ID:receiptiq-processing-queue",
      "Condition": {
        "ArnEquals": { "aws:SourceArn": "arn:aws:s3:::BUCKET_NAME" },
        "StringEquals": { "aws:SourceAccount": "ACCOUNT_ID" }
      }
    }
  ]
}
```

The policy is intentionally restricted to this bucket and account. A queue
with only the default owner policy causes the Console error:
`Unable to validate the following destination configurations`.

Create an S3 event notification for `ObjectCreated` events:

- Prefix: `users/`
- Suffix: leave empty or configure accepted file extensions
- Destination: `receiptiq-processing-queue`

Confirm the SQS queue policy permits only this bucket ARN to send messages.

Do not configure SNS notifications. If using the direct S3-to-Lambda learning
path, configure the Lambda invoke permission restricted to this bucket ARN.

## 7.1 Deploy the serverless API

The Express backend is packaged as a Lambda handler in
[`backend/src/lambda.js`](../backend/src/lambda.js). It loads the JWT secret
from Secrets Manager on cold start and keeps the existing authentication and
receipt routes.

The deployed API uses:

- Lambda: `receiptiq-api`
- Runtime: Node.js 22
- Memory: 512 MB
- Timeout: 30 seconds
- HTTP API: `fn4khftdk3`
- Secret: `receiptiq/production/jwt`

The API Gateway proxy forwards all routes to Express. The frontend runtime
configuration must use the API Gateway endpoint as its `apiBaseUrl`; do not
put the JWT secret or AWS credentials in frontend files.

For future updates, package production dependencies and update the function:

```bash
cd backend
npm ci --omit=dev
rm -rf /tmp/receiptiq-api-package /tmp/receiptiq-api.zip
mkdir -p /tmp/receiptiq-api-package
cp -R src node_modules package.json package-lock.json /tmp/receiptiq-api-package/
(cd /tmp/receiptiq-api-package && zip -qr /tmp/receiptiq-api.zip src node_modules package.json package-lock.json)

export AWS_PROFILE=aws_second
export AWS_REGION=us-east-1
aws lambda update-function-code \
  --function-name receiptiq-api \
  --zip-file fileb:///tmp/receiptiq-api.zip
```

The backend API does not require a VPC. Its Lambda role is restricted to the
receipt bucket prefix, the two DynamoDB tables/indexes, CloudWatch Logs, and
the JWT secret.

## 8. Configure networking for ECS

**You do not need to configure a VPC for the resources already created.**
S3, SQS, DynamoDB, ECR, and this Lambda can work without a VPC. Do not attach
the processor Lambda to a VPC for this project; doing so creates additional
networking requirements and is not needed.

This section is only for the future ECS Fargate backend and its Application
Load Balancer. Complete it when you are ready to host the backend. The target
layout is:

```text
Internet
   |
Application Load Balancer (public subnets, ports 80/443)
   |
ECS Fargate backend (private subnets, port 4000)
   |
S3 / DynamoDB / SQS / hosted AI provider
```

### 8.1 Create the VPC

In the AWS Console, switch to **us-east-1**, open **VPC**, and choose **Create
VPC**. Select **VPC and more**, then use:

| Setting | Value |
|---|---|
| Name tag auto-generation | `receiptiq` |
| IPv4 CIDR | `10.0.0.0/16` |
| Number of Availability Zones | `2` |
| Number of public subnets | `2` |
| Number of private subnets | `2` |
| NAT gateways | `1 per AZ` for production; `In 1 AZ` for learning/cost control |
| VPC endpoints | `None` initially |
| DNS hostnames / DNS resolution | Keep enabled |

Choose **Create VPC**. AWS will create one VPC, an Internet Gateway, public
subnets, private subnets, route tables, and NAT gateway resources. A NAT
Gateway is billed while it exists. For the lowest-cost learning setup choose
**In 1 AZ**; for higher availability choose **1 per AZ**.

Record these values from the VPC resource details:

- VPC ID
- two public subnet IDs
- two private subnet IDs
- route table IDs
- NAT gateway ID

Do not use the default VPC for the documented ECS architecture.

### 8.2 Create security groups

In **VPC > Security groups**, create these groups in the new VPC:

**`receiptiq-alb-sg`**

- Inbound TCP 80 from `0.0.0.0/0`
- Inbound TCP 443 from `0.0.0.0/0`
- Outbound: all traffic

**`receiptiq-backend-sg`**

- Inbound TCP 4000 with source **`receiptiq-alb-sg`** (select the security
  group, not a CIDR range)
- Outbound: all traffic

Do not add inbound rules for SSH, TCP 4000 from the public internet, S3,
DynamoDB, SQS, or Lambda. The backend should only be reachable through the
load balancer.

### 8.3 How the ECS networking choices map to the design

When creating the ECS service later:

1. Select the new VPC.
2. Select both **private subnets**.
3. Assign the `receiptiq-backend-sg`.
4. Set **Public IP** to **Off**.
5. Attach the load balancer to both **public subnets**.
6. Attach `receiptiq-alb-sg` to the load balancer.
7. Configure the target group to forward to container port `4000`.

The private-subnet route table sends outbound traffic to the NAT gateway.
This is required for ECS tasks to pull images and send logs unless you later
create the required VPC endpoints. It is also required if the backend calls a
hosted AI endpoint. S3 and DynamoDB gateway endpoints can reduce NAT traffic,
but they are an optimization and are not required for the first deployment.

If you are not deploying ECS yet, stop after the Lambda/SQS setup and skip all
of Section 8. There is no reason to create a NAT gateway just for the current
Lambda pipeline.

## 9. Configure the backend runtime

The backend needs an environment containing:

```text
NODE_ENV=production
PORT=4000
FRONTEND_URL=<deployed-frontend-origin>
JWT_SECRET=<random-value-at-least-32-characters>
AWS_REGION=us-east-1
S3_BUCKET_NAME=<receipt-bucket-name>
DYNAMODB_TABLE_NAME=receiptiq-receipts-table
DYNAMODB_USERS_TABLE=receiptiq-users-table
```

The backend role needs:

- S3 `PutObject`, `DeleteObject`, `GetObject`
- DynamoDB access for the two tables and required indexes

Use an IAM role rather than static AWS keys. The backend runtime can be ECS,
App Runner, or another container host; the application does not require SNS.

## 10. Deploy the backend container

Create an ECR repository named `receiptiq-backend` with scan-on-push enabled,
immutable image tags, and a lifecycle policy for old test images.

```bash
AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REPOSITORY="receiptiq-backend"
IMAGE_TAG="$(git rev-parse --short HEAD)"

aws ecr create-repository \
  --repository-name "$REPOSITORY" \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE \
  --region "$AWS_REGION" || true

aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -t "$REPOSITORY:$IMAGE_TAG" .
docker tag "$REPOSITORY:$IMAGE_TAG" \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPOSITORY:$IMAGE_TAG"
docker push \
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPOSITORY:$IMAGE_TAG"
```

For ECS Fargate, create an ECS cluster, task definition, task execution role,
task role, service, and CloudWatch log group. Configure:

- desired count: 1 initially
- container port: 4000
- health check: `GET /health`
- log group: `/ecs/receiptiq-backend`

Create an Application Load Balancer with an HTTPS listener, HTTP-to-HTTPS
redirect, target group on port 4000, and health path `/health`.

## 11. Configure Secrets Manager

Create a secret such as `receiptiq/production/ai`:

```json
{
  "GOOGLE_API_KEY": "replace-me"
}
```

Grant only the Lambda role and backend task role `secretsmanager:GetSecretValue`
for this secret. Do not put the value in Docker images, GitHub variables, or
frontend JavaScript.

## 12. Host the frontend

Create a private S3 bucket for the static frontend and upload the contents of
`frontend/`. Create a CloudFront distribution with Origin Access Control,
HTTPS, compression, default root object `index.html`, and release invalidation.

Set the frontend API base URL to the backend HTTPS URL before uploading. Do not
place an API secret in `runtime-config.js`.

## 13. Configure monitoring

Create CloudWatch alarms for:

- Lambda `Errors > 0`
- Lambda `Throttles > 0`
- Lambda duration near the timeout
- Lambda invocations with an unexpected drop
- DynamoDB throttled requests
- backend HTTP 5xx responses

Create a log group with a finite retention period, such as 30 days.

For each processing failure, inspect the Lambda log stream using the `docId`.
The persisted receipt record should have `status=failed` and an `errorMessage`.

## 14. Smoke test

1. Register a user through the frontend.
2. Confirm signup does not send an email.
3. Upload a small PDF or image.
4. Confirm the S3 object appears under the expected user prefix.
5. Confirm an SQS message is created.
6. Confirm Lambda is invoked and the message is deleted after success.
7. Confirm the receipt record changes from `processing` to `processed`.
8. Confirm no SNS topic, subscription, or email is created.
9. Confirm the result appears in the authenticated workspace.

## 15. Teardown checklist

When deleting a test deployment:

1. Delete S3 event notifications.
2. Delete the ECS service and load balancer.
3. Delete Lambda event source mappings and the Lambda function.
4. Delete SQS queues.
5. Delete ECR images and repositories.
6. Export or delete DynamoDB tables.
7. Empty and delete S3 buckets.
8. Delete unused IAM roles, policies, secrets, and security groups.
9. Remove CloudWatch log groups.
10. Review billing and Cost Explorer.
