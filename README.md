# ReceiptIQ

ReceiptIQ is a receipt-processing demo with a static frontend, an Express API, and an AWS-based async processing pipeline.

## Project Layout

```text
3rd_Year-Major_Project/
├── index.html
├── styles.css
├── lambdaHandler.js
├── package.json
├── setup.sh
└── src/
    ├── app.js
    ├── server.js
    ├── middleware/
    │   └── errorHandler.js
    ├── routes/
    │   └── receipts.js
    └── services/
        ├── dbService.js
        └── s3Service.js
```

## Getting Started

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:4000` by default.

To try the frontend locally, open `index.html` in a browser. The frontend script is loaded from `src/app.js`.

## Configuration

Fill in the values in `.env` before connecting the app to AWS:

- `FRONTEND_URL`
- `API_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`
- `DYNAMODB_TABLE_NAME`
- `SNS_TOPIC_ARN`
- `SES_FROM_EMAIL`

For the browser app, update the values near the top of `src/app.js`:

- `API_BASE_URL`: For local backend usage, set this to `http://localhost:4000/api`
- `API_KEY`: Match the backend `API_KEY`

If those frontend placeholders are left unchanged, the UI falls back to demo mode after a failed upload request.

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health check |
| POST | `/api/receipts/upload` | Upload a receipt for async processing |
| GET | `/api/receipts` | List processed receipts |
| GET | `/api/receipts/:docId` | Fetch a specific processed receipt |

## Scripts

- `npm start`: Start the production server
- `npm run dev`: Start the server with `nodemon`
- `npm test`: Run Jest tests
- `npm run lambda`: Build `lambda.zip` from the root project files

## Notes

- Uploaded files are validated for type and limited to 10 MB.
- The API expects an `x-api-key` header on receipt routes.
- The Lambda function in `lambdaHandler.js` is intended to be deployed separately to AWS Lambda.
