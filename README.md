# ReceiptIQ

ReceiptIQ is now structured as an account-based receipt workspace with:

- A redesigned auth-first frontend with sign up, log in, upload, and receipt history views
- A Node.js API that supports local account creation plus authenticated PDF uploads
- Receipt records grouped by user so each account sees only its own processed history
- Per-user SNS topics so each account confirms notifications once and then reuses the same email on future uploads
- A Python container-based Lambda that extracts raw PDF text/OCR locally, then asks Gemini for clean structured JSON before storing the result and publishing receipt updates

## Project Layout

```text
3rd_Year-Major_Project/
├── index.html
├── lambda_pdf_processor/
│   ├── app.py
│   ├── Dockerfile
│   ├── README.md
│   └── requirements.txt
├── package.json
├── setup.sh
├── styles.css
└── src/
    ├── app.js
    ├── middleware/
    │   └── errorHandler.js
    ├── routes/
    │   └── receipts.js
    ├── server.js
    ├── server.test.js
    └── services/
        ├── dbService.js
        └── s3Service.js
```

## App Flow

1. A user signs up once with name, email, and password.
2. The frontend stores the session token locally and opens the user workspace.
3. `POST /api/receipts/upload` validates the authenticated upload, stores a `processing` record in DynamoDB, and uploads the PDF to an S3 key under `users/<userId>/...`.
4. The frontend polls `GET /api/receipts/:docId` until the receipt moves from `processing` to `processed` or `failed`.
5. The workspace dashboard loads the logged-in user’s receipt history through `GET /api/receipts`.
6. On signup, the backend creates a per-user SNS topic and subscribes the account email.
7. After the user confirms the SNS email once, future processed receipts publish notification updates to that user-specific topic.
8. The Lambda can optionally use Gemini API for higher-quality field extraction from the raw receipt text.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:4000`.

The app runs locally at `http://localhost:4000` and starts with the signup/login screen.

## Required Environment Variables

Use [.env.example](/Users/m.rathi/new/3rd_year_project/.env.example) as the source of truth.

- `PORT`
- `FRONTEND_URL`
- `API_KEY`
- `JWT_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`
- `DYNAMODB_TABLE_NAME`
- `SES_FROM_EMAIL`
- `SNS_TOPIC_PREFIX`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## What Works Without Extra AWS Setup

- The complete local auth flow
- The redesigned workspace UI
- Per-user receipt history reads
- The S3/DynamoDB/Lambda integration already present in code if your AWS values are configured
- Per-user SNS topic/subscription creation during signup when AWS credentials are available

## When You Want AWS Later

The code is already prepared for the live receipt pipeline. When you want to finish AWS wiring, supply real values for:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`
- `DYNAMODB_TABLE_NAME`
- `SES_FROM_EMAIL`
- `SNS_TOPIC_PREFIX`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

You can place those in `.env` for local testing, and use matching values in Lambda/server configuration later.

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health check |
| POST | `/api/auth/signup` | Create a local account, create the user SNS topic/subscription, and return a session token |
| POST | `/api/auth/login` | Log in, refresh SNS confirmation state, and return a session token |
| GET | `/api/auth/me` | Load the current authenticated user and current SNS notification state |
| POST | `/api/receipts/upload` | Upload a receipt PDF and create a processing record |
| GET | `/api/receipts` | List authenticated user receipt records |
| GET | `/api/receipts/:docId` | Fetch a single authenticated receipt |

## Testing

```bash
npm test
```

Current automated tests cover basic Express wiring and middleware. They do not mock the full AWS pipeline yet.
