#!/usr/bin/env bash

cat <<'EOF'
ReceiptIQ setup notes

1. Copy .env.example to .env
2. Fill in:
   - API_KEY
   - AWS_ACCESS_KEY_ID
   - AWS_SECRET_ACCESS_KEY
   - AWS_REGION
   - S3_BUCKET_NAME
   - DYNAMODB_TABLE_NAME
   - SES_FROM_EMAIL
3. Start the server:
   npm run dev

The project code is ready for AWS values, but AWS resource creation is intentionally left out for now.
EOF
