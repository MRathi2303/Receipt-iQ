User Uploads (Frontend)
        │
        ▼
REST API (Express / Node.js)
        │
        ▼
AWS S3 (Object Storage)
        │
        ▼
S3 Event Trigger
        │
        ▼
AWS Lambda
(Textract OCR + AI Classification)
        │
        ▼
DynamoDB (Structured Storage)
        │
        ▼
SNS Notification
        │
        ▼
SES Email Delivery


receipt-pipeline/
│
├── frontend/
│   ├── index.html        # Main UI (upload, dashboard)
│   ├── styles.css        # UI design
│   └── app.js            # Upload logic + API calls
│
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/
│   │   │   └── receipts.js
│   │   ├── middleware/
│   │   │   └── errorHandler.js
│   │   └── services/
│   │       ├── s3Service.js
│   │       ├── dbService.js
│   │       └── lambdaHandler.js
│   │
│   ├── package.json
│   └── .env.example
│
└── infrastructure/
    └── setup.sh






    git clone <repo-url>
cd backend
npm install
cp .env.example .env
























### 2. Provision AWS (see infrastructure/setup.sh)
- Create S3 bucket
- Create DynamoDB table
- Create SNS topic
- Verify SES email
- Deploy Lambda (lambdaHandler.js)
- Add S3 → Lambda trigger

### 3. Run Backend
```bash
npm run dev    # Development with nodemon
npm start      # Production
```

### 4. Deploy Frontend
```bash
# Option A: Open frontend/index.html directly in browser (local test)
# Option B: Deploy to S3 static hosting, Netlify, or Vercel
# Update API_BASE_URL in frontend/app.js first!
```

## 🔧 Configuration Checklist

All values marked ⚠️ HIGHLIGHT must be filled before the app works:

| File | Variable | What to put |
|------|----------|-------------|
| frontend/app.js | `API_BASE_URL` | Your deployed backend URL |
| frontend/app.js | `API_KEY` | Your API key (match .env) |
| backend/.env | `FRONTEND_URL` | Your frontend domain |
| backend/.env | `API_KEY` | Strong random string |
| backend/.env | `AWS_REGION` | e.g. `us-east-1` |
| backend/.env | `S3_BUCKET_NAME` | Your S3 bucket name |
| backend/.env | `DYNAMODB_TABLE_NAME` | Your DynamoDB table |
| backend/.env | `SNS_TOPIC_ARN` | Copy from AWS SNS |
| backend/.env | `SES_FROM_EMAIL` | Verified email in SES |

## 🛡 Security Notes

- Never commit `.env` to git (it's in `.gitignore`)
- In production, use IAM Roles instead of access keys
- API keys are validated on every request
- Files are validated by type and size before upload
- S3 bucket is private with public access blocked

## 📬 Email Flow

1. Lambda processes receipt → calls SNS Publish
2. SNS delivers JSON payload to subscribed Lambda or email
3. That Lambda calls SES SendEmail with branded HTML

## 🧪 Testing the Demo

Without a backend deployed, the frontend runs in **demo mode**:
- Upload any file + enter an email → click Process Receipt
- A simulated pipeline runs showing all 7 steps
- A mock result is shown (Starbucks, $12.50)

## 📄 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /api/receipts/upload | Upload receipt file |
| GET | /api/receipts | List all receipts |
| GET | /api/receipts/:docId | Get single receipt |

## 🔗 Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JS (no framework needed)
- **Backend**: Node.js 18+, Express 4
- **AWS Services**: S3, Lambda, Textract, DynamoDB, SNS, SES
- **Auth**: API Key via `x-api-key` header
#
