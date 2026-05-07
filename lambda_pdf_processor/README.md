# Python PDF Lambda

This folder contains the replacement Lambda implementation for receipt processing.

It is designed to run as an AWS Lambda container image and supports PDF files only.

Flow:

1. Download uploaded PDF from S3
2. For each page, try direct text extraction first
3. If the page does not contain enough selectable text, OCR that page with Tesseract
4. Parse merchant/date/amount fields from the combined text
5. Store the result in DynamoDB
6. Publish a receipt summary to the user-specific SNS topic when that user has confirmed notifications

Build example:

```bash
docker build -t receiptiq-pdf-lambda ./lambda_pdf_processor
```

The Lambda handler is `app.handler`.
