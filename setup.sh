# ReceiptIQ — AWS Infrastructure Setup
# Run these steps in order in your AWS Console or AWS CLI

# =========================================================
# ⚠️  HIGHLIGHT: STEP 1 — Create S3 Bucket
# =========================================================
aws s3api create-bucket \
  --bucket YOUR_RECEIPTIQ_BUCKET_NAME \
  --region us-east-1

# Enable versioning (optional but recommended)
aws s3api put-bucket-versioning \
  --bucket YOUR_RECEIPTIQ_BUCKET_NAME \
  --versioning-configuration Status=Enabled

# Block all public access
aws s3api put-public-access-block \
  --bucket YOUR_RECEIPTIQ_BUCKET_NAME \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"


# =========================================================
# ⚠️  HIGHLIGHT: STEP 2 — Create DynamoDB Table
# =========================================================
aws dynamodb create-table \
  --table-name receiptiq-receipts \
  --attribute-definitions AttributeName=docId,AttributeType=S \
  --key-schema AttributeName=docId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1


# =========================================================
# ⚠️  HIGHLIGHT: STEP 3 — Create SNS Topic
# =========================================================
aws sns create-topic \
  --name receiptiq-notifications \
  --region us-east-1
# Copy the TopicArn from output → paste into SNS_TOPIC_ARN in .env


# =========================================================
# ⚠️  HIGHLIGHT: STEP 4 — Verify SES Email Sender
# =========================================================
aws ses verify-email-identity \
  --email-address noreply@yourdomain.com \
  --region us-east-1
# Check your inbox for the verification link and click it


# =========================================================
# ⚠️  HIGHLIGHT: STEP 5 — Create Lambda Function
# =========================================================
# 1. Zip the Lambda handler:
#    zip lambda.zip src/services/lambdaHandler.js

# 2. Create Lambda via console:
#    Runtime: Node.js 18.x
#    Handler: lambdaHandler.handler
#    Memory:  512 MB
#    Timeout: 60 seconds

# 3. Set Lambda environment variables (same as .env):
#    AWS_REGION, DYNAMODB_TABLE_NAME, SNS_TOPIC_ARN, SES_FROM_EMAIL

# 4. Attach IAM Role with these policies:
#    - AmazonS3ReadOnlyAccess (to read uploaded files)
#    - AmazonTextractFullAccess
#    - AmazonDynamoDBFullAccess
#    - AmazonSNSFullAccess


# =========================================================
# ⚠️  HIGHLIGHT: STEP 6 — Add S3 Trigger to Lambda
# =========================================================
# In Lambda console:
#   Add trigger → S3 → your bucket → Event: s3:ObjectCreated:*
#   Prefix: receipts/ (optional filter)


# =========================================================
# ⚠️  HIGHLIGHT: STEP 7 — Subscribe SES to SNS Topic
# =========================================================
# Option A: SNS → SES subscription (via Lambda that calls SES)
# Option B: Use SNS Email subscription (simpler, sends plain text)
#
# For branded HTML email, deploy a second Lambda subscribed to the SNS topic
# that reads the JSON message and sends via SES SendEmail API.

aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:receiptiq-notifications \
  --protocol email \
  --notification-endpoint user@example.com


# =========================================================
# ⚠️  HIGHLIGHT: STEP 8 — Deploy Backend API
# =========================================================
# Option A: AWS EC2 / Elastic Beanstalk
#   eb init && eb create receiptiq-api

# Option B: Docker on ECS
#   docker build -t receiptiq-api . && docker push ...

# Option C: Railway / Render (easiest for solo projects)
#   Connect your GitHub repo, set env variables, deploy.

# Copy your deployed API URL → paste into frontend app.js API_BASE_URL
