#!/usr/bin/env bash
set -euo pipefail

awslocal s3api create-bucket --bucket receiptiq-receipts

awslocal dynamodb create-table \
  --table-name receiptiq-receipts \
  --attribute-definitions AttributeName=docId,AttributeType=S AttributeName=userId,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=docId,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"userId-createdAt-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}]' \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table \
  --table-name receiptiq-users \
  --attribute-definitions AttributeName=id,AttributeType=S AttributeName=email,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"email-index","KeySchema":[{"AttributeName":"email","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}]' \
  --billing-mode PAY_PER_REQUEST

echo "LocalStack resources initialized."
