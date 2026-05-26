# TestFlow — Product Requirements Document

## Overview

TestFlow is an internal web application that enables developers to manage test projects and testers to report bugs with attachments. Developers create projects, invite testers, and track bugs through a fixed status lifecycle. Testers submit bug reports with screenshots and documents, and are notified via email and WhatsApp when bugs are resolved.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, shadcn/ui, Tailwind CSS |
| Frontend Hosting | Vercel |
| Backend | AWS CDK (Python), Serverless |
| API | AWS HTTP API Gateway |
| Compute | AWS Lambda (Python) |
| Database | AWS DynamoDB (single-table) |
| File Storage | AWS S3 |
| Auth | AWS Cognito User Pool (no MFA) |
| Email | AWS SES |
| WhatsApp | AWS SNS (WhatsApp Business channel) |
| Region | ap-south-1 (Mumbai) |
| Repo | Monorepo (`/frontend` + `/backend`) |
| Environment | Single (production only) |

---

## User Roles

### Admin / Developer
- Self-registers via the signup page — first user type, auto-assigned Admin role
- Creates and manages projects
- Invites testers to projects
- Views all bugs across their projects
- Changes bug status to **Fixed**
- Receives no notifications (acts, not notified)

### Tester
- Account created by Admin via invite (no self-signup)
- Sets password and WhatsApp number on first login
- Can be a member of multiple projects
- Submits bug reports under assigned projects
- Views only bugs they submitted
- Changes bug status to **Verified** or **Reopen** after retesting
- Notified via email and WhatsApp when a bug is marked Fixed

---

## Authentication

- **Cognito User Pool**, ap-south-1, no MFA
- Admin signup: open self-registration → auto-tagged with `role: admin` in Cognito custom attribute
- Tester signup: invite-only flow
  1. Admin enters tester's email in the app
  2. Lambda creates Cognito account with temporary password
  3. SES sends invite email with login link and temp password
  4. Tester logs in, is forced to set new password, and is prompted to enter WhatsApp number
  5. Tester is auto-assigned to the inviting project
- JWT tokens from Cognito authorise all HTTP API Gateway routes
- Role stored as Cognito custom attribute (`custom:role`): `admin` or `tester`

---

## Project

A Project is the top-level grouping. It represents a feature, app, or testing scope.

### Fields
| Field | Type | Notes |
|---|---|---|
| project_id | String (UUID) | Partition key |
| title | String | e.g., "Data Quality Feature" |
| created_by | String | Admin's Cognito sub |
| created_at | ISO 8601 timestamp | Auto-set |

### Rules
- Only Admins can create projects
- An Admin can create multiple projects
- A Tester can be a member of multiple projects
- Admin sees all their own projects on their dashboard
- Tester sees only projects they have been invited to

---

## Bug Report

### Fields
| Field | Type | Notes |
|---|---|---|
| bug_id | String (UUID) | |
| project_id | String | FK to Project |
| title | String | Short bug summary |
| description | String | Free text detail |
| screenshots | List\<S3Key\> | Max 3, PNG/JPG/WebP, ≤5MB each |
| documents | List\<S3Key\> | Max 3, .md/.txt/.pdf, ≤5MB each |
| status | Enum | See status lifecycle below |
| reported_by | String | Tester's Cognito sub |
| created_at | ISO 8601 timestamp | Auto-set |
| updated_at | ISO 8601 timestamp | Updated on status change |

### Status Lifecycle

```
[Tester submits]
      │
      ▼
    OPEN
      │
      │  Admin marks fixed
      ▼
   FIXED  ──────────────────────────────┐
      │                                 │
      │  Tester retests                 │
      ├──── still broken ──► REOPEN ───►┘
      │
      └──── confirmed fixed ──► VERIFIED
```

| Status | Set By | Trigger |
|---|---|---|
| Open | System | Bug submitted by Tester |
| Fixed | Admin / Developer | Developer resolves the bug |
| Verified | Tester | Tester confirms fix after retest |
| Reopen | Tester | Tester finds bug still exists after retest |

### Status Change Rules
- Tester can only set: **Verified**, **Reopen** (only when current status is Fixed)
- Admin can only set: **Fixed** (only when current status is Open or Reopen)
- No other status transitions are permitted

---

## File Attachments

All files are uploaded directly from the browser to S3 via a Lambda-generated presigned URL.

### Upload Flow
1. Frontend requests presigned URL from Lambda (passes filename, content type)
2. Lambda validates file type and size, generates presigned PUT URL
3. Frontend uploads file directly to S3 using presigned URL
4. Frontend saves returned S3 key in the bug report payload

### Limits
| Type | Allowed Formats | Max File Size | Max Per Bug |
|---|---|---|---|
| Screenshots | PNG, JPG, WebP | 5 MB | 3 |
| Documents | .md, .txt, .pdf | 5 MB | 3 |

### S3 Bucket Structure
```
s3://testflow-attachments/
  └── {project_id}/
        └── {bug_id}/
              ├── screenshots/
              └── documents/
```

---

## Notifications

Triggered when an Admin changes a bug status to **Fixed**.

| Channel | Recipient | Content |
|---|---|---|
| SES Email | Bug reporter (Tester) | Bug title, project name, link to bug, "Please retest and update status" |
| SNS WhatsApp | Bug reporter (Tester) | Same message, short format |

- WhatsApp notification is sent only if the tester has a phone number saved
- Tester provides WhatsApp number during first-login onboarding (mandatory prompt)
- Tester can update their phone number anytime in the Profile section

---

## DynamoDB Single-Table Design

**Table name:** `testflow`

### Key Schema

| Entity | PK | SK |
|---|---|---|
| User | `USER#{cognito_sub}` | `PROFILE` |
| Project | `PROJECT#{project_id}` | `METADATA` |
| ProjectMember | `PROJECT#{project_id}` | `MEMBER#{cognito_sub}` |
| Bug | `PROJECT#{project_id}` | `BUG#{bug_id}` |
| UserProject (GSI) | `USER#{cognito_sub}` | `PROJECT#{project_id}` |

### GSI
- **GSI1** — PK: `USER#{cognito_sub}`, SK: `PROJECT#{project_id}`
  - Supports: Get all projects for a Tester

### Access Patterns
| Pattern | Key |
|---|---|
| Get user profile | PK=`USER#{sub}` SK=`PROFILE` |
| Get all projects by Admin | Query PK=`USER#{sub}` SK begins_with `PROJECT#` (via GSI1) |
| Get project metadata | PK=`PROJECT#{id}` SK=`METADATA` |
| Get all members of a project | PK=`PROJECT#{id}` SK begins_with `MEMBER#` |
| Get all bugs in a project | PK=`PROJECT#{id}` SK begins_with `BUG#` |
| Get single bug | PK=`PROJECT#{id}` SK=`BUG#{bug_id}` |
| Get all projects for a Tester | GSI1 PK=`USER#{sub}` SK begins_with `PROJECT#` |

---

## API Endpoints

All routes protected by Cognito JWT authorizer.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/invite` | Admin invites a tester by email |

### Projects
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/projects` | Admin | Create a new project |
| GET | `/projects` | Both | List projects (Admin: own, Tester: invited) |
| GET | `/projects/{projectId}` | Both | Get project detail |

### Bugs
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/projects/{projectId}/bugs` | Tester | Submit a bug report |
| GET | `/projects/{projectId}/bugs` | Both | List bugs in a project |
| GET | `/projects/{projectId}/bugs/{bugId}` | Both | Get bug detail |
| PATCH | `/projects/{projectId}/bugs/{bugId}/status` | Both | Update bug status |

### Attachments
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/attachments/presign` | Tester | Get presigned S3 URL for upload |

### Users
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/users/me` | Both | Get own profile |
| PATCH | `/users/me` | Both | Update profile (phone number) |

---

## Frontend Pages

### Admin
| Route | Page |
|---|---|
| `/signup` | Admin self-registration |
| `/login` | Login (both roles) |
| `/dashboard` | List of Admin's projects |
| `/projects/new` | Create new project |
| `/projects/[id]` | Project detail — bug list, invite tester button |
| `/projects/[id]/bugs/[bugId]` | Bug detail — view attachments, change status to Fixed |

### Tester
| Route | Page |
|---|---|
| `/onboarding` | Set password + WhatsApp number (first login) |
| `/dashboard` | List of Tester's assigned projects |
| `/projects/[id]` | Project detail — tester's bug list, submit bug button |
| `/projects/[id]/bugs/new` | Submit new bug report |
| `/projects/[id]/bugs/[bugId]` | Bug detail — view, change status to Verified/Reopen |
| `/profile` | Update WhatsApp number |

---

## Monorepo Structure

```
testflow/
├── frontend/                  # Next.js app (deployed to Vercel)
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── package.json
├── backend/                   # AWS CDK Python (deployed to ap-south-1)
│   ├── stacks/
│   │   └── testflow_stack.py
│   ├── lambdas/
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── bugs/
│   │   ├── attachments/
│   │   ├── users/
│   │   └── notifications/
│   ├── app.py
│   └── requirements.txt
├── testflow-prd.md
└── README.md
```

---

## Out of Scope

- MFA / 2FA
- Multiple environments (dev/staging) — single production environment only
- Bug assignment to specific developers
- Comments or discussion threads on bugs
- Search or advanced filtering
- Bug export (CSV, PDF)
- Analytics or dashboards
- Mobile app
- Self-signup for Testers (invite-only)
