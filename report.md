<div align="center">

# ReceiptIQ
## Intelligent Receipt Processing Pipeline API

### A Project Report

#### Bachelor of Technology
#### Session 2025–26
#### Computer Science and Engineering

---

### Submitted by
**[STUDENT NAME 1]** (Roll No: [ROLL NO 1])  
**[STUDENT NAME 2]** (Roll No: [ROLL NO 2])

### Under the Guidance of
**[GUIDE NAME]**, M.Tech / Ph.D.  
School of Computer Science and Engineering

---

### SCHOOL OF COMPUTER SCIENCE AND ENGINEERING
### IILM UNIVERSITY, GREATER NOIDA
### May 2026

</div>

---

## CANDIDATE'S DECLARATION

We hereby certify that the work presented in this project report, entitled "**ReceiptIQ: Intelligent Receipt Processing Pipeline API**", in partial fulfillment of the requirements for the degree of Bachelor of Technology in the School of Computer Science and Engineering of IILM University, Greater Noida, is an original work carried out from August 2025 to May 2026 under the supervision of [GUIDE NAME].

The matter presented in this project has not been submitted by us for the award of any other degree from this or any other place.

---

**[STUDENT NAME 1]** (Roll No: [ROLL NO 1])  
Signature: _____________________ Date: __________

**[STUDENT NAME 2]** (Roll No: [ROLL NO 2])  
Signature: _____________________ Date: __________

---

This is to certify that the above statement made by the candidates is correct to the best of my knowledge.

**[GUIDE NAME]**  
M.Tech / Ph.D., School of Computer Science and Engineering  
Signature: _____________________ Date: __________

## CERTIFICATE

This is to certify that the project report entitled "**ReceiptIQ: Intelligent Receipt Processing Pipeline API**" submitted by **[STUDENT NAME 1]** (Roll No: [ROLL NO 1]) and **[STUDENT NAME 2]** (Roll No: [ROLL NO 2]) in partial fulfillment of the requirement for the degree of Bachelor of Technology in the School of Computer Science and Engineering of IILM University, Greater Noida, is a record of the candidates' own work carried out under supervision. The matter embodied in this project is original and has not been submitted for the award of any other degree.

---

**Signature of Head of Department**  
Dr. Anil Saroliya, Professor  
School of Computer Science and Engineering  
IILM University, Greater Noida  
Signature: _____________________ Date: __________

**Signature of Guide**  
[GUIDE NAME]  
School of Computer Science and Engineering  
IILM University, Greater Noida  
Signature: _____________________ Date: __________

## ACKNOWLEDGEMENT

It gives us a great sense of pleasure to present the report of the project undertaken during the Bachelor of Technology final year. We owe a special debt of gratitude to [GUIDE NAME] and the faculty members of IILM University, Greater Noida, for their constant support, guidance, and encouragement throughout the course of this work.

We extend our sincere thanks to **Dr. Anil Saroliya**, Head of the Department of Computer Science and Engineering, and all faculty members for providing the necessary facilities and support.

We also acknowledge the contribution of our friends and colleagues for their cooperation and technical assistance during the development and testing of the project.

Last but not least, we are grateful to our families for their encouragement and support throughout this endeavor.

---

**[STUDENT NAME 1]**  
Roll No: [ROLL NO 1]

**[STUDENT NAME 2]**  
Roll No: [ROLL NO 2]

May 2026

## ABSTRACT

ReceiptIQ is an intelligent receipt processing platform that automates the extraction and management of receipt data. The system enables users to sign up, log in, upload PDF receipts, and view extracted receipt details in a personal workspace. The project integrates a responsive browser-based frontend, a Node.js Express backend API, AWS cloud services (S3, DynamoDB, SNS, SES, Textract), and containerized Lambda functions for advanced PDF processing.

**Key Features:**
- Account-based receipt storage with per-user data isolation
- Asynchronous receipt processing using AWS Lambda
- Multi-method extraction: Textract (Node.js Lambda) and OCR/LLM (Python Lambda)
- Per-user SNS topics for email notifications
- Receipt categorization and field extraction
- Responsive HTML5 frontend with real-time progress tracking
- Comprehensive error handling and reliability improvements

**Technical Stack:**
Frontend: HTML5, CSS3, Vanilla JavaScript, Axios  
Backend: Node.js v18+, Express.js, bcryptjs, jsonwebtoken  
Cloud: AWS S3, DynamoDB, Lambda, SNS, SES, Textract  
Database: DynamoDB (production), Local JSON (development)  
Python Lambda: pdfplumber, Tesseract, Gemini API  

**Testing:** Jest unit tests covering middleware, routing, and service reliability  
**Deployment:** Ready for AWS Lambda containerization and EC2/ECS backend deployment  

The project is designed for local development without full AWS setup while being fully compatible with AWS-hosted deployment.

## LIST OF ABBREVIATIONS

| Abbreviation | Full Form | Description / Use |
| --- | --- | --- |
| API | Application Programming Interface | Backend endpoints used by the frontend |
| AWS | Amazon Web Services | Cloud platform for storage, compute, notifications, and database |
| CSP | Content Security Policy | Browser security policy configured by Helmet |
| PDF | Portable Document Format | Accepted receipt file type |
| JWT | JSON Web Token | Used for user authentication sessions |
| OCR | Optical Character Recognition | Used by the Python Lambda for scanned receipts |
| OCR | Optical Character Recognition | Fallback extraction approach for image-based PDFs |
| SNS | Simple Notification Service | Notification topic and email subscription system |
| SES | Simple Email Service | Sends email notifications |
| S3 | Simple Storage Service | Stores uploaded receipt PDFs |
| Textract | Amazon Textract | Receipt field extraction service used in the Node Lambda |
| UI | User Interface | Browser-based frontend |

## TABLE OF CONTENTS

| | |
|---|---|
| 1. | Introduction |
| 2. | Literature Review |
| 3. | Methodology |
| 4. | Results and Discussion |
| 5. | Conclusion and Recommendations |
| 6. | References |
| 7. | Appendix |

# CHAPTER 1: INTRODUCTION

## 1.1 Introduction

ReceiptIQ is an intelligent receipt processing system that combines browser interaction, secure backend APIs, and AWS-based asynchronous processing to convert PDF receipts into structured data. The project targets a common workflow: a user uploads a receipt PDF, the system stores it safely, extracts useful fields such as merchant, date, tax, and totals, and then presents the processed record in a personal history view.

The application is designed as an account-based workspace rather than a shared inbox or generic upload form. That design keeps receipt data isolated per user, simplifies history browsing, and supports per-user notification subscriptions.

## 1.2 Problem Statement

Receipt management is often manual, fragmented, and difficult to search. Users typically keep PDFs in email, chat apps, or cloud drives, then later have to look up merchants, amounts, or tax details when expenses need to be reviewed or reported. Manual data entry is slow and error-prone.

The problem addressed by ReceiptIQ is to automate receipt ingestion and extraction while keeping each user’s records separate, secure, and easy to review.

## 1.3 Scope of Research

The scope of the project includes:

- User signup, login, and session persistence
- PDF-only receipt upload
- Receipt extraction using AWS and Python-based parsing
- Storage of receipt history in DynamoDB
- Per-user notification support through SNS and SES
- A responsive frontend for upload, progress tracking, and history review
- Local development mode without requiring all AWS services to be active

The scope does not include native mobile apps, bulk enterprise workflows, or accounting software integration in the current implementation.

## 1.4 Research Hypothesis

If receipt uploads are handled through a secure account-based pipeline with asynchronous AWS-backed processing and structured parsing, then users can obtain receipt metadata more reliably and with less manual effort than with a purely manual receipt archive.

## 1.5 Objectives

The project objectives are:

1. Provide a clean signup and login workflow.
2. Allow authenticated users to upload PDF receipts.
3. Store each receipt under a user-specific S3 path.
4. Create and update receipt records in DynamoDB.
5. Extract structured fields from receipts automatically.
6. Support per-user SNS topics and email notifications.
7. Present receipt history and receipt details in the browser.
8. Make the project runnable in local development mode and ready for AWS deployment.

## 1.6 Organization of the Report

- Chapter 1 introduces the project and its goals.
- Chapter 2 reviews the technical background and design approach.
- Chapter 3 explains the methodology and module structure.
- Chapter 4 presents the implementation outcome and validation results.
- Chapter 5 concludes the work and suggests future improvements.

# CHAPTER 2: LITERATURE REVIEW

## 2.1 Background

Receipt processing systems usually fall into one of three categories: manual storage, OCR-only extraction, or cloud-assisted extraction. Manual storage is simple but does not scale well when users need to search or summarize records. OCR-only systems can extract text but often struggle with layout-heavy PDFs or scanned documents. Cloud-assisted approaches improve reliability by combining OCR, metadata storage, and workflow automation.

ReceiptIQ uses a hybrid strategy:

- A browser frontend for user interaction
- Express routes for authentication and receipt management
- S3 events for asynchronous processing
- DynamoDB for structured history storage
- SNS/SES for notification delivery
- Node.js Textract-based Lambda and Python OCR/Gemini Lambda support for extraction

This architecture improves responsiveness because uploads return immediately while the processing pipeline continues in the background.

## 2.2 Existing Approach and Gap

A common gap in receipt systems is that the same notification or history store is shared across all users, which makes account isolation weaker. Another gap is limited resilience when uploads, writes, or notifications fail mid-process.

ReceiptIQ addresses these concerns by:

- Storing receipts by authenticated user ID
- Creating per-user SNS topics
- Hardening local user storage with atomic writes and serialized updates
- Separating upload, processing, and notification responsibilities into dedicated services

## 2.3 Summary of Literature Review and Research Gap

The key gap identified in comparable approaches is that many systems either prioritize extraction accuracy or user experience, but not both together. ReceiptIQ combines a user-friendly frontend with a multi-stage extraction pipeline and consistent user isolation, making it suitable for a personal workspace model.

# CHAPTER 3: METHODOLOGY

## 3.1 Materials

### Frontend

- `index.html` provides the markup for the auth shell, workspace shell, receipt upload panel, progress tracker, history panel, and receipt detail modal.
- `styles.css` defines the complete visual language using CSS variables, a light glassmorphism aesthetic, responsive grids, and the Outfit font family.
- `src/app.js` contains the browser logic for login, signup, upload, progress updates, polling, receipt history rendering, and modal behavior.

### Backend

- `src/server.js` configures the Express app, security middleware, static file hosting, runtime config, health checks, and route registration.
- `src/routes/auth.js` handles signup, login, and session lookup.
- `src/routes/receipts.js` handles upload, list, and detail receipt requests.
- `src/middleware/auth.js` signs and verifies JWTs.
- `src/middleware/errorHandler.js` validates API keys and maps common errors to HTTP responses.

### Services

- `src/services/userStore.js` manages local user storage for development.
- `src/services/s3Service.js` uploads receipt files to S3 and generates presigned URLs.
- `src/services/dbService.js` reads and writes receipt records in DynamoDB.
- `src/services/notificationService.js` creates and refreshes per-user SNS notification state.

### Lambda and Deployment Assets

- `lambdaHandler.js` processes S3-triggered receipt events using AWS Textract.
- `lambda_pdf_processor/app.py` performs advanced PDF parsing using pdfplumber, Tesseract OCR, and Gemini API.
- `lambda_pdf_processor/Dockerfile` packages the Python Lambda as a container image.
- `lambda_pdf_processor/requirements.txt` lists Python dependencies.
- `lambda_role_access_policy.json` and `receipt_iq_local_policy.json` define AWS permissions.

## 3.2 System Methodology

The project follows an event-driven, layered workflow:

1. The user signs up or logs in from the frontend.
2. The backend validates the request, creates or loads a user record, and returns a JWT.
3. The authenticated user uploads a PDF receipt.
4. The backend validates the file, writes a processing record to DynamoDB, and uploads the PDF to S3.
5. The S3 event triggers receipt extraction in Lambda.
6. The Lambda extracts fields, updates DynamoDB, and publishes notifications.
7. The frontend polls the receipt status until the job is processed or failed.
8. The history panel shows all receipts belonging to the authenticated user.

## 3.3 Frontend Materials and Components

### Page Structure

The frontend has two primary modes:

- Auth shell: login and signup forms
- Workspace shell: upload, progress, history, and receipt details

### Behavior

- The app stores the session token in localStorage using the key `receiptiq.auth.token`.
- `runtime-config.js` injects API base URL and API key at runtime.
- Axios is used for HTTP calls.
- The app automatically attaches the JWT to requests after login.
- Uploads are limited to PDF files and 10 MB.
- A seven-step progress indicator communicates the current processing stage.

### Visual Design

The UI uses:

- Outfit font family
- Light blue background gradients
- Glass-like panels with blur and transparency
- Rounded cards and pill labels
- Responsive layout that adjusts between desktop and mobile screens

## 3.4 Backend Methodology

### Server Configuration

`src/server.js` performs the following:

- Loads environment variables using dotenv
- Applies Helmet with a restrictive content security policy
- Enables CORS for the configured frontend URL
- Adds rate limiting for API routes
- Parses JSON bodies with a 1 MB limit
- Logs requests through Morgan
- Serves the frontend, runtime config, CSS, and Axios bundle
- Exposes a health endpoint at `/health`

### Authentication Flow

`src/routes/auth.js` provides three endpoints:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`

Passwords are hashed with bcryptjs. JWTs are signed for seven days. Duplicate signup attempts return a 409 conflict.

### Receipt Flow

`src/routes/receipts.js` provides:

- `POST /api/receipts/upload`
- `GET /api/receipts`
- `GET /api/receipts/:docId`

The upload route validates the API key and JWT, accepts PDF files only, stores the initial processing record, then uploads the file to S3.

## 3.5 User Storage Method

`src/services/userStore.js` uses a JSON file under `data/users.json` for development. The current implementation improves reliability by:

- Creating the store if it does not exist
- Writing through a temporary file and rename operation
- Serializing mutations through an internal promise queue
- Sanitizing user objects before they are returned to the frontend

This makes local development practical while keeping the code ready for a future database-backed migration.

## 3.6 Notification Method

`src/services/notificationService.js` builds per-user SNS topics and subscriptions using the authenticated user email. Notification states include:

- `disabled` when AWS credentials are not present
- `pending_verification` when the email subscription still needs confirmation
- `verified` when the subscription is active

The service refreshes notification status during login and session lookup so the UI reflects the current state.

## 3.7 Database Method

`src/services/dbService.js` stores receipt records in DynamoDB using `docId` as the primary key. The service supports:

- Inserting new records
- Fetching a receipt by ID
- Reading all receipts for a user
- Formatting receipt amounts, tax, totals, and confidence for display

The receipt list function now scans through all DynamoDB pages before filtering by user ID and applying pagination, which makes history retrieval more reliable as data grows.

## 3.8 AWS Processing Method

### Node.js Lambda (`lambdaHandler.js`)

The Node Lambda is triggered by S3 object creation events. It:

- Reads the S3 bucket and object key from the event
- Fetches metadata with HeadObject
- Runs Textract AnalyzeExpense
- Maps Textract field names to project fields
- Classifies the receipt category from merchant patterns
- Writes the processed record to DynamoDB
- Sends notification email through SES
- Writes a failure record when processing fails

The flow has been hardened so the processed record is stored before email delivery, reducing the risk of notification/data mismatches.

### Python Lambda (`lambda_pdf_processor/app.py`)

The Python container Lambda is designed for advanced receipt extraction. It:

- Reads PDFs from S3
- Uses pdfplumber for selectable text
- Falls back to Tesseract OCR for scanned pages
- Calls Gemini for structured extraction
- Detects known merchants and platforms
- Infers categories
- Stores the final receipt result in DynamoDB
- Publishes SNS notifications

This module is packaged as a container image through `lambda_pdf_processor/Dockerfile`.

# CHAPTER 4: RESULTS AND DISCUSSION

## 4.1 Implementation Results

The project successfully implements the following core outcomes:

- A working account-based authentication flow
- Protected receipt upload and retrieval endpoints
- User-specific S3 storage paths for uploaded receipts
- Receipt history views scoped to the authenticated user
- Per-user SNS notification setup
- Local development mode without full AWS dependency activation
- A modern, responsive frontend workspace

## 4.2 Verification Results

The repository includes Jest-based tests that verify the most important middleware and reliability paths.

### Verified Test Coverage

- Express app initialization and middleware wiring
- API key validation behavior
- Multer file size error mapping
- Duplicate signup rejection
- Invalid login rejection
- Receipt upload path validation
- DynamoDB receipt pagination behavior

The latest test run completed successfully after the reliability improvements.

## 4.3 Reliability Improvements Observed

During code review and hardening work, the following reliability concerns were addressed:

- Receipt Lambda persistence now happens before email notification, preventing a success email from being sent without a stored receipt record.
- Receipt history retrieval now scans all DynamoDB pages before user filtering and pagination.
- Local user storage now writes atomically and serializes concurrent updates.

These changes improve consistency and reduce the chance of lost writes or misleading state.

## 4.4 Discussion

ReceiptIQ is effective because it separates immediate user interaction from slower processing tasks. The browser receives fast responses while AWS services handle extraction, storage, and notifications in the background. This design is appropriate for receipt workflows where the file must be preserved and processed asynchronously.

The main tradeoff is that receipt extraction quality depends on the PDF structure, OCR quality, and external model/service availability. The project addresses this through multiple extraction paths and fallback logic.

# CHAPTER 5: CONCLUSION AND RECOMMENDATIONS

## 5.1 Conclusion

ReceiptIQ demonstrates a complete receipt processing workflow that integrates a secure frontend, a Node.js backend, an event-driven AWS pipeline, and a containerized Python extraction service. It supports account-based receipt storage, history browsing, notification setup, and multiple extraction techniques for better coverage of real-world receipts.

The project is currently suitable for local development and is architected for AWS deployment. The backend tests pass, the main reliability issues identified during review have been addressed, and the repository includes the necessary policy and container configuration to move toward production deployment.

## 5.2 Recommendations

### Immediate Recommendations

1. Replace the development JSON user store with DynamoDB or another durable database for production.
2. Add more mocked AWS integration tests for S3, SNS, SES, and DynamoDB.
3. Add end-to-end tests that simulate the receipt upload-to-processing pipeline.
4. Add stronger observability, such as structured logging and alarm metrics.

### Medium-Term Recommendations

1. Create infrastructure as code for all AWS resources.
2. Add receipt search and filtering by date, merchant, and category.
3. Add export options for CSV and PDF summaries.
4. Improve Gemini prompt tuning and confidence-based review workflows.

### Long-Term Recommendations

1. Add analytics dashboards for spending trends.
2. Add mobile capture support.
3. Add team or shared workspace features.
4. Add accounting-platform integration and audit logging.

# REFERENCES

1. Express.js documentation
2. AWS SDK for JavaScript v3 documentation
3. AWS Lambda documentation
4. Amazon S3 documentation
5. Amazon DynamoDB documentation
6. Amazon SNS and SES documentation
7. Amazon Textract documentation
8. Google Gemini API documentation
9. pdfplumber documentation
10. Tesseract OCR documentation

# APPENDIX

## A. Project Structure Summary

- `index.html` - Frontend entry point and app shell.
- `styles.css` - Responsive visual design and layout.
- `package.json` - Node.js dependencies and scripts.
- `.env.example` - Environment configuration template.
- `setup.sh` - Quick setup instructions.
- `README.md` - Project overview and usage notes.
- `src/server.js` - Express bootstrap and middleware.
- `src/app.js` - Frontend application logic.
- `src/middleware/auth.js` - JWT signing and verification.
- `src/middleware/errorHandler.js` - API key validation and error mapping.
- `src/routes/auth.js` - Signup, login, and `/me` routes.
- `src/routes/receipts.js` - Receipt upload and retrieval routes.
- `src/services/userStore.js` - Local development user store.
- `src/services/notificationService.js` - SNS topic and subscription management.
- `src/services/s3Service.js` - S3 upload and presigned URL helpers.
- `src/services/dbService.js` - DynamoDB receipt persistence and formatting.
- `src/server.test.js` - Basic wiring tests.
- `src/reliability.test.js` - Reliability-focused route and service tests.
- `lambdaHandler.js` - Node.js receipt processor using Textract.
- `lambda_pdf_processor/app.py` - Python container Lambda for advanced extraction.
- `lambda_pdf_processor/Dockerfile` - Container image definition.
- `lambda_pdf_processor/requirements.txt` - Python dependencies.
- `lambda_pdf_processor/README.md` - Lambda-specific notes.
- `lambda_role_access_policy.json` - Lambda IAM permissions.
- `receipt_iq_local_policy.json` - Backend IAM permissions.
- `data/users.json` - Development-only local user store.

## B. Environment Variables Summary

- `PORT` - Backend port.
- `FRONTEND_URL` - Frontend origin used for CORS.
- `API_KEY` - Shared API key for request validation.
- `JWT_SECRET` - Secret used to sign JWTs.
- `AWS_ACCESS_KEY_ID` - AWS credential for local development.
- `AWS_SECRET_ACCESS_KEY` - AWS credential for local development.
- `AWS_REGION` - Shared AWS region.
- `S3_BUCKET_NAME` - Receipt upload bucket.
- `DYNAMODB_TABLE_NAME` - Receipt table name.
- `SES_FROM_EMAIL` - Verified SES sender address.
- `SNS_TOPIC_PREFIX` - Prefix for per-user SNS topics.
- `GEMINI_API_KEY` - Gemini API key.
- `GEMINI_MODEL` - Gemini model name.

## C. Deployment Notes

The repository already includes the AWS IAM policy files and container build files required for deployment. AWS CLI is assumed to be configured for the target account and region, so the existing policies and Docker image definition can be used directly for provisioning and deployment work.

---

## DOCUMENT INFORMATION

**Report Generated:** 30 April 2026  
**Project Name:** ReceiptIQ — Intelligent Receipt Processing Pipeline API  
**Project Version:** 1.0.0  
**Status:** Development Complete | Ready for AWS Deployment  
**Repository Root:** `/Users/m.rathi/new/3rd_year_project`  
**Primary Framework:** Express.js (Node.js) | AWS Lambda (Python)  
**Development Period:** August 2025 – May 2026
