# TestFlow

A modern bug reporting and tracking tool built for development teams. Admins create projects, invite testers, and track bug resolutions. Testers report bugs with screenshots and get notified when they're fixed.

**Live app:** https://testflow-pi.vercel.app

---

## Features

### For Admins
- Create and manage projects
- Invite testers via email — credentials are sent automatically
- View all bugs reported across a project
- Update bug status (Open → Fixed → Verified → Reopen)
- Soft-delete projects (moves to Bin) or permanently delete them
- Manage tester access per project
- Upload overall project report files (PDF, DOCX, MD, TXT — up to 5 per project)

### For Testers
- Access all projects in the organisation automatically
- Report bugs with title, description, and screenshots
- Edit and delete their own bug reports
- View and update bug statuses
- Download report files
- Restore deleted projects from the Bin

### Notifications
- Email notification when a bug is marked **Fixed**
- WhatsApp notification (via SNS) when a bug is marked **Fixed**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Auth | AWS Cognito (Amplify v6) |
| Backend | AWS Lambda (Python 3.12) |
| API | AWS API Gateway HTTP API (JWT authorizer) |
| Database | DynamoDB (single-table design with GSI) |
| Storage | S3 (presigned URLs for upload/download) |
| Notifications | AWS SES (email) + SNS (WhatsApp) |
| IaC | AWS CDK (Python) |
| Hosting | Vercel (frontend) |

---

## Project Structure

```
testflow/
├── frontend/                  # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/        # Login, Signup, Onboarding pages
│   │   │   └── (app)/         # Dashboard, Projects, Admin, Bin, Profile
│   │   ├── components/        # UI components (sidebar, shadcn)
│   │   ├── context/           # Auth context (Cognito session)
│   │   └── lib/               # API client, auth helpers, config
│   └── public/                # logo.svg, favicon
│
├── backend/                   # AWS CDK + Lambda functions
│   ├── backend/
│   │   └── testflow_stack.py  # CDK stack (all AWS resources)
│   └── lambdas/
│       ├── auth/              # POST /auth/invite
│       ├── bugs/              # CRUD for bugs
│       ├── projects/          # CRUD for projects + bin + reports
│       ├── attachments/       # Presign URLs + view URLs
│       ├── users/             # Profile, phone OTP
│       └── notifications/     # SES email + SNS WhatsApp
│
└── scripts/
    └── generate_manual.py     # Playwright script → PDF user guide
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.12+
- AWS CLI configured with profile `cleanflowai-demo`
- AWS CDK CLI (`npm install -g aws-cdk`)

### Frontend (local dev)

```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in your values
npm run dev
```

Required environment variables in `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.ap-south-1.amazonaws.com
NEXT_PUBLIC_USER_POOL_ID=ap-south-1_xxxxxxxx
NEXT_PUBLIC_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AWS_REGION=ap-south-1
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Backend (deploy)

```bash
cd backend
pip install -r requirements.txt

# Always diff before deploying
cdk diff --profile cleanflowai-demo

# Deploy
cdk deploy --profile cleanflowai-demo
```

> **Important:** Always run `cdk diff` first to confirm only additive changes before deploying. Do not touch any other resources in the AWS account.

---

## Data Model (DynamoDB single table)

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Project | `PROJECT#{id}` | `METADATA` | `ADMIN#{adminSub}` | `PROJECT#{id}` |
| Bug | `PROJECT#{id}` | `BUG#{id}` | — | — |
| Member | `PROJECT#{id}` | `MEMBER#{testerSub}` | `USER#{testerSub}` | `PROJECT#{id}` |
| Report | `PROJECT#{id}` | `REPORT#{id}` | — | — |
| User Profile | `USER#{sub}` | `PROFILE` | — | — |

---

## Bug Status Lifecycle

```
Open ──► Fixed ──► Verified
  ▲         │
  └─────────┘ (Reopen)
```

Testers are notified by email and WhatsApp when their bug is marked **Fixed**.

---

## Deployment

The frontend is deployed on **Vercel** with root directory set to `frontend/`.

The backend is deployed on **AWS** (ap-south-1) via CDK.

To trigger a frontend redeploy, push to the `main` branch on GitHub.
