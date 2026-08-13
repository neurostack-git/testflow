# TestFlow — Low Level Design

**Status:** Approved for implementation
**Supersedes:** the implicit "admin-owns-projects, testers invited per project" model
**Scope:** organisation-based RBAC, org-wide project visibility, revised bug lifecycle, team management, password self-service, shared backend authorisation layer

---

## 1. Purpose

TestFlow is a bug reporting and tracking product. Today it has two roles (`admin`, `tester`) and no organisation entity — an "org" is implied by `GSI1PK = ADMIN#{sub}` on project metadata, and testers are granted access by **fanning membership rows out to every one of the admin's projects** in three separate places:

- `lambdas/auth/handler.py` — writes one `PENDING#{projectId}` row per project at invite time
- `lambdas/post_auth/handler.py` — expands those into `MEMBER#` rows across every admin project on first login
- `lambdas/projects/handler.py::_auto_add_existing_testers` — back-fills every existing tester into each newly created project

This design replaces that fan-out with a single first-class `ORG#` entity. Access becomes a property of org membership rather than a set of denormalised per-project rows.

**The environment is wiped before implementation** (§12), so there is no backfill or dual-read migration. Every schema decision below is a greenfield decision.

---

## 2. Decision Register

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Org model | Real `ORG#{orgId}` entity; **one org per user** | Cognito's unique-email constraint enforces single-org for free; removes all fan-out code |
| D2 | Cognito User Pool | **Keep the existing pool**; delete all users | Preserves `UserPoolId` / `ClientId`, so no Vercel env changes and no SES re-verification |
| D3 | Caller identity resolution | **Single `GetItem` on `USER#{sub}/PROFILE`** yielding both `role` and `orgId` | See D3a |
| D3a | *Refinement to D3* | `orgId` is **not** put in the JWT | Would require a new Cognito custom attribute; CloudFormation cannot reliably add schema attributes to an existing pool without replacement, which contradicts D2. Since `role` is already read live, `orgId` rides along at zero extra cost and is always fresh. |
| D4 | Bug lifecycle | Add explicit `Reopened`; Tester verifies or reopens | Distinguishes a fresh bug from one whose fix already failed |
| D5 | Invite rights | **Only the Owner can create Developers**; Developers create Testers only | Owner ≠ Developer on people-management; identical on projects and bugs |
| D6 | Owner exclusive powers | Remove Developers · Transfer ownership · Rename org · Cannot be removed | |
| D7 | Role changes | **None.** Roles are fixed at invite time | Removal-only. Resolves the conflict with D6 — the Owner *removes* Developers, does not demote them. Ownership transfer remains as a dedicated single-purpose operation. |
| D8 | Project deletion | Any Developer or the Owner (soft, restore, and permanent) | Matches "Developer can do all the functions" |
| D9 | Org name | Collected on the signup form; renameable by Owner | |
| D10 | Tester rights over own bug | Edit **and** delete their own bug, at any status | Closest to today's behaviour |
| D11 | Per-project member list | **Removed entirely** from the project page | Membership is now an org concept; showing it per project is misleading |
| D12 | Team page | Flat org-wide member table at `/team` | |
| D13 | Passwords | Change-password in Profile **and** Forgot-password on login | |
| D14 | Shared backend code | **Lambda Layer** (`tfcommon`) | RBAC rules must exist in one place, not seven |
| D15 | Chat scope | One room per project, open to the whole org | Access check changes from project-membership to org-match |
| D16 | Notifications | Fixed→reporter · Reopened→developers · New bug→developers (in-app only) | |
| D17 | Member removal | Keep all content; retain a tombstone profile so names still resolve | Preserves bug history and attribution |
| D18 | Environment reset | Full wipe — all Cognito users, all DynamoDB items, all S3 objects | §12 |

---

## 3. Roles & Permission Matrix

Three roles. `owner` and `developer` are identical on **projects, bugs, reports and chat**, and differ only on **people and org settings**.

```
owner      — the account creator. Exactly one per org. Cannot be removed.
developer  — full product access. Cannot manage Developers or org settings.
tester     — files bugs, verifies fixes, reads everything in the org.
```

### 3.1 Matrix

Legend: `Y` allowed · `—` forbidden · `own` own records only · `†` conditional, see notes

| Capability | Owner | Developer | Tester |
|---|:--:|:--:|:--:|
| **Projects** | | | |
| View all org projects | Y | Y | Y |
| Create project | Y | Y | — |
| Soft-delete project (→ Bin) | Y | Y | — |
| Restore from Bin | Y | Y | — |
| Permanently delete project | Y | Y | — |
| View Bin | Y | Y | Y (read-only) |
| **Bugs** | | | |
| View bugs | Y | Y | Y |
| File a bug | Y | Y | Y |
| Edit a bug | Y | Y | own |
| Delete a bug | Y | Y | own |
| Transition status | Y (any) | Y (any) | †1 |
| **Reports** | | | |
| View / download report | Y | Y | Y |
| Upload report | Y | Y | — |
| Delete report | Y | Y | — |
| **Chat** | | | |
| Read / post / @-mention | Y | Y | Y |
| Clear chat history | Y | Y | — |
| **People** | | | |
| View Team page | Y | Y | — |
| Invite a Developer | Y | — | — |
| Invite a Tester | Y | Y | — |
| Remove a Developer | Y | — | — |
| Remove a Tester | Y | Y | — |
| Remove the Owner | — | — | — |
| **Org** | | | |
| Rename the org | Y | — | — |
| Transfer ownership | Y | — | — |

†1 — Testers may only perform `Fixed → Reopened` and `Fixed → Closed`. See §8.

### 3.2 Invariants

These must hold at all times and are enforced server-side:

- **INV-1** — Every org has exactly one member with `role = owner`.
- **INV-2** — No API path can delete or demote the Owner. Ownership must be transferred first.
- **INV-3** — Every user belongs to exactly one org.
- **INV-4** — A caller may only read or write resources whose `orgId` equals their own.
- **INV-5** — Roles are immutable after invite. The only role mutation in the system is `POST /org/transfer-ownership`, which swaps exactly two rows atomically.

---

## 4. Domain Model

```
Org  1 ──── * Member  (owner | developer | tester)
 │
 └── 1 ──── * Project
              │
              ├── * Bug ──── * Attachment (S3)
              ├── * Report (S3)
              └── * ChatMessage
```

Ownership rules:
- A **Project** belongs to an Org, not to a user. `createdBy` is retained for attribution only and grants no special rights (D8).
- A **Bug** belongs to a Project. `reportedBy` grants edit/delete rights to Testers (D10).
- A **Member** is the join between a User and an Org, carrying the role.

---

## 5. DynamoDB Single-Table Design

Table `testflow` — `PK` (S), `SK` (S), TTL attribute `expiresAt`.

### 5.1 Item catalogue

| Entity | PK | SK | Key attributes | GSI1PK | GSI1SK |
|---|---|---|---|---|---|
| Org | `ORG#{orgId}` | `METADATA` | `orgId, name, ownerSub, createdAt` | — | — |
| Org member | `ORG#{orgId}` | `MEMBER#{sub}` | `sub, email, name, role, status, invitedBy, joinedAt` | — | — |
| User profile | `USER#{sub}` | `PROFILE` | `orgId, role, email, name, phone, avatarKey, deleted` | — | — |
| Project | `PROJECT#{projectId}` | `METADATA` | `projectId, orgId, title, createdBy, createdAt, deletedAt` | `ORG#{orgId}` | `PROJECT#{projectId}` |
| Bug | `PROJECT#{projectId}` | `BUG#{bugId}` | `bugId, title, description, status, reportedBy, screenshots, videos, documents, createdAt, updatedAt` | — | — |
| Report | `PROJECT#{projectId}` | `REPORT#{reportId}` | `reportId, s3Key, filename, contentType, uploadedBy, uploadedAt` | — | — |
| Chat message | `PROJECT#{projectId}` | `MSG#{ts}#{messageId}` | `messageId, senderSub, senderName, senderRole, content, mentions, createdAt` | — | — |
| Notification | `USER#{sub}` | `NOTIF#{ts}#{notifId}` | `notifId, type, projectId, projectTitle, fromName, content, read, createdAt` | — | — |
| WS connection (lookup) | `WSCONN#{connId}` | `META` | `projectId, userSub, userName, userRole, expiresAt` | — | — |
| WS connection (broadcast) | `PROJECT#{projectId}` | `WSCONN#{connId}` | `connectionId, userSub, userName, expiresAt` | — | — |
| Phone OTP | `OTP#{sub}` | `PHONE` | `otp, phone, expiresAt` | — | — |

> These four retain their existing key shapes. The WebSocket broadcast path depends on the dual-row `WSCONN#` layout, and renaming keys that already work buys nothing when the data is being wiped regardless.

### 5.2 What changed from the current schema

| Change | Detail |
|---|---|
| **Added** | `ORG#{orgId}/METADATA` and `ORG#{orgId}/MEMBER#{sub}` |
| **Removed** | `PROJECT#{id}/MEMBER#{sub}` — per-project membership no longer exists |
| **Removed** | `USER#{sub}/PENDING#{projectId}` — invites now write the member row directly with `status: "pending"` |
| **Changed** | `PROJECT#{id}/METADATA.GSI1PK`: `ADMIN#{adminSub}` → `ORG#{orgId}` |
| **Added** | `PROJECT#{id}/METADATA.orgId` — denormalised so a single project read can be authorised without a second lookup |
| **Added** | `USER#{sub}/PROFILE.orgId` — the authorisation anchor (D3a) |
| **Added** | `USER#{sub}/PROFILE.deleted` — tombstone flag for removed members (D17) |

### 5.3 GSI1

`GSI1PK` / `GSI1SK`, projection `ALL`. After this redesign GSI1 serves exactly one access pattern:

```
GSI1PK = ORG#{orgId}, GSI1SK begins_with PROJECT#   →  all projects in the org
```

The previously overloaded `GSI1PK = USER#{sub}` entries disappear with per-project membership. "Which org am I in" is answered by the `USER#{sub}/PROFILE` read that every request already performs.

### 5.4 Access patterns

| # | Pattern | Query | Cost |
|---|---|---|---|
| AP-1 | Resolve caller identity | `GetItem USER#{sub}/PROFILE` | 1 read, every request |
| AP-2 | List org projects (dashboard) | `Query GSI1 PK=ORG#{orgId}`, filter `deletedAt` absent | 1 query |
| AP-3 | List Bin | same as AP-2, filter `deletedAt` present | 1 query |
| AP-4 | Authorise a project | `GetItem PROJECT#{id}/METADATA`, assert `orgId` match | 1 read |
| AP-5 | List bugs in project | `Query PK=PROJECT#{id}, SK begins_with BUG#` | 1 query |
| AP-6 | List team | `Query PK=ORG#{orgId}, SK begins_with MEMBER#` | 1 query |
| AP-7 | List developers for notification fan-out | AP-6, filter `role in (owner, developer)` | 1 query |
| AP-8 | Chat history (paged) | `Query PK=PROJECT#{id}, SK begins_with CHAT#`, desc, `ExclusiveStartKey` | 1 query |
| AP-9 | Notifications | `Query PK=USER#{sub}, SK begins_with NOTIF#` | 1 query |

**Note on AP-2/AP-3.** The current `list_projects` fires one `COUNT` query *per project* on a thread pool to compute `testerCount`. With org-wide membership that number is identical for every project, so it collapses into a single AP-6 count. The `ThreadPoolExecutor` is removed.

---

## 6. Identity & Authorisation

### 6.1 Caller resolution

Every HTTP Lambda begins the same way, via the shared layer:

```python
from tfcommon.auth import get_caller, require_role

caller = get_caller(event)      # -> Caller(sub, email, role, org_id)
```

`get_caller` does:
1. Read `sub` and `email` from `requestContext.authorizer.jwt.claims`. Absent ⇒ `401`.
2. `GetItem USER#{sub}/PROFILE`. Absent ⇒ `403 org_not_provisioned` (the org-bootstrap case, §7.1).
3. `deleted == True` ⇒ `403 account_removed`.
4. Return `Caller(sub, email, role, org_id)`.

`custom:role` remains on the Cognito user as a bootstrap hint for the PostAuthentication trigger, but **is never trusted for authorisation**. The profile row is the sole source of truth.

### 6.2 Guards provided by the layer

```python
require_role(caller, "owner")                    # 403 unless exact role
require_developer(caller)                        # owner or developer
require_org(caller, resource_org_id)             # INV-4
require_project(caller, project_id) -> project   # AP-4 + require_org, returns the row
can_invite(caller, target_role) -> bool          # D5
can_remove(caller, target_member) -> bool        # D6 + INV-2
```

Every authorisation decision in the system is expressed through these six functions. No handler re-implements a check.

### 6.3 Org scoping

`require_org` is the single enforcement point for INV-4. Because `PROJECT#/METADATA` carries a denormalised `orgId`, authorising any project-scoped request costs exactly one additional read (AP-4), regardless of nesting depth — bugs, reports and chat all authorise through the parent project.

---

## 7. Auth Flows

### 7.1 Owner signup (self-service)

The org cannot be created by Cognito, and adding a `custom:orgName` attribute is ruled out by D3a. The org is therefore created by an authenticated call immediately after the first successful sign-in.

```
1. /signup form:  full name · org name · email · password
2. Amplify signUp({ name, custom:role = "owner" })
   └─ org name held in sessionStorage under "tf-pending-org"
3. Amplify confirmSignUp(code from email)
4. Amplify signIn
5. Cognito PostAuthentication → creates nothing (no profile yet, no orgId)
6. Frontend: GET /users/me
      └─ 403 org_not_provisioned
7. Frontend: POST /org { name }        ← from sessionStorage, else prompt in /onboarding
      └─ creates ORG#, MEMBER#(owner), USER#/PROFILE(role=owner, orgId)   [TransactWrite]
8. Frontend: GET /users/me → 200, proceed to /dashboard
```

`POST /org` is guarded: it succeeds only if the caller has no existing profile row, and only if their Cognito `custom:role` is `owner`. A second call returns `409`.

If the user abandons between steps 3 and 7, the sessionStorage value is lost and `/onboarding` prompts for the org name. The account is unusable until an org exists, which is the correct failure mode.

### 7.2 Invite (Developer or Tester)

Unlike today, the invite writes **all** persistent state up front — there is no `PENDING#` conversion step, because `admin_create_user` returns the new `sub` immediately.

```
POST /org/invite { email, role }        role ∈ {developer, tester}

1. can_invite(caller, role)                                 D5
2. cognito.admin_create_user(email, custom:role = role)
      ├─ UsernameExists + role owner/developer → 400 "already a developer account"
      ├─ UsernameExists + FORCE_CHANGE_PASSWORD → 400 "invite already pending"
      └─ UsernameExists + CONFIRMED → 400 "already belongs to an organisation"   (D1)
3. TransactWrite:
      ORG#{orgId}/MEMBER#{sub}   status=pending, role, email, invitedBy
      USER#{sub}/PROFILE          orgId, role, email, name=email-local-part
4. Cognito sends the invite email with a temporary password
```

Because the profile row exists from step 3, the invited user is authorised the instant they log in — no first-login race.

### 7.3 First login for an invited user

```
Cognito PostAuthentication trigger:
  1. If USER#{sub}/PROFILE missing → no-op (owner bootstrap path, §7.1)
  2. Update ORG#{orgId}/MEMBER#{sub}.status = "active", joinedAt = now   (if pending)
  3. Sync PROFILE.name from Cognito `name` if the user set one during onboarding
```

The trigger keeps its deliberate restriction to `TABLE_NAME` only — it must not receive `USER_POOL_ID`, which would create a circular CloudFormation dependency (the existing comment at `testflow_stack.py:234` documents this and stays).

Frontend still routes `FORCE_CHANGE_PASSWORD` users through `/onboarding` to set a password and their display name.

### 7.4 Passwords (D13)

| Flow | Mechanism | Backend |
|---|---|---|
| Change password (signed in) | Amplify `updatePassword({ oldPassword, newPassword })` | none |
| Forgot password | Amplify `resetPassword()` → emailed code → `confirmResetPassword()` | none |

Both are pure client-side Cognito calls. No new routes, no new Lambda, no new IAM. The pool already has `account_recovery = EMAIL_ONLY`, so forgot-password works with no infrastructure change.

New route `/forgot-password` in the `(auth)` group. A link is added to the login page.

### 7.5 Ownership transfer

The single exception to D7's immutable roles.

```
POST /org/transfer-ownership { toSub }

1. require_role(caller, "owner")
2. target must exist in ORG#{orgId}, be status=active, and have role=developer
3. TransactWrite (all-or-nothing, preserves INV-1):
      ORG#/MEMBER#{caller.sub}  role → developer
      ORG#/MEMBER#{toSub}       role → owner
      USER#{caller.sub}/PROFILE role → developer
      USER#{toSub}/PROFILE      role → owner
      ORG#/METADATA             ownerSub → toSub
```

A single `TransactWriteItems` guarantees the org never has zero or two owners.

### 7.6 Member removal (D17)

```
DELETE /org/members/{sub}

1. can_remove(caller, target)          D6 + INV-2
2. cognito.admin_delete_user            frees the email for re-invite
3. Delete ORG#{orgId}/MEMBER#{sub}
4. Update USER#{sub}/PROFILE  deleted=true, deletedAt=now
      └─ retained so bug and chat author names still resolve
5. Bugs, chat messages, reports and S3 attachments are left untouched
```

The UI renders a tombstoned author as `Ravi (removed)`. `get_caller` rejects tombstoned users at step 3 of §6.1, so a removed member cannot act even with an unexpired token.

---

## 8. Bug Lifecycle

### 8.1 States

`Open` · `Fixed` · `Reopened` · `Closed` · `Invalid`

The legacy `Verified` and `Reopen` aliases in `bugs/handler.py` and `lib/bug-status.ts` are **deleted** — the wipe removes every record that could carry them.

### 8.2 State machine

```
                    ┌──────────────── developer ──────────────┐
                    │                                          ▼
   (new bug) ──► Open ──── developer ────► Fixed ──── tester ────► Closed
                  │                          │
                  │                          └──── tester ────► Reopened
                  │                                                 │
                  └──── developer ────► Invalid                     │
                                                                    │
                        Reopened ──── developer ────► Fixed  ◄──────┘
```

### 8.3 Transition table

Owner and Developer share one column (D5 — they differ only on people management).

| From | Owner / Developer may set | Tester may set |
|---|---|---|
| `Open` | Fixed, Closed, Invalid | — |
| `Fixed` | Open, Reopened, Closed, Invalid | **Reopened, Closed** |
| `Reopened` | Fixed, Closed, Invalid | — |
| `Closed` | Open, Fixed, Invalid | — |
| `Invalid` | Open, Fixed, Closed | — |

A new bug is always created as `Open`, by any role.

### 8.4 Where this lives

The matrix is defined **twice by necessity** — server-side for enforcement, client-side for rendering available options — and the two must not drift:

- `backend/layers/common/python/tfcommon/bugs.py` → `VALID_TRANSITIONS`
- `frontend/src/lib/bug-status.ts` → `TRANSITIONS`

Both files carry a header comment pointing at the other. The server is authoritative; the client copy exists only to grey out unavailable options.

---

## 9. API Surface

All routes sit behind the existing Cognito JWT authorizer on the HTTP API.

### 9.1 Org — new `org` Lambda

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/org` | bootstrap only | §7.1; `409` if a profile already exists |
| GET | `/org` | any member | `{ orgId, name, memberCount }` |
| PATCH | `/org` | owner | rename |
| GET | `/org/members` | developer, owner | AP-6 |
| POST | `/org/invite` | owner → dev\|tester · developer → tester | §7.2 |
| DELETE | `/org/members/{sub}` | D6 + INV-2 | §7.6 |
| POST | `/org/transfer-ownership` | owner | §7.5 |

### 9.2 Projects — unchanged paths, org-scoped

| Method | Path | Permission |
|---|---|---|
| GET | `/projects` | any member (AP-2) |
| POST | `/projects` | developer, owner |
| GET | `/projects/bin` | any member (read-only for testers) |
| GET | `/projects/{projectId}` | any member, org must match |
| DELETE | `/projects/{projectId}` | developer, owner |
| POST | `/projects/{projectId}/restore` | developer, owner |
| DELETE | `/projects/{projectId}/permanent` | developer, owner |
| GET | `/projects/{projectId}/reports` | any member |
| POST | `/projects/{projectId}/reports` | developer, owner |
| DELETE | `/projects/{projectId}/reports/{reportId}` | developer, owner |

### 9.3 Bugs — unchanged paths

| Method | Path | Permission |
|---|---|---|
| GET | `/projects/{projectId}/bugs` | any member |
| POST | `/projects/{projectId}/bugs` | any member |
| GET | `/projects/{projectId}/bugs/{bugId}` | any member |
| PATCH | `/projects/{projectId}/bugs/{bugId}` | developer, owner, or `reportedBy == caller` |
| DELETE | `/projects/{projectId}/bugs/{bugId}` | developer, owner, or `reportedBy == caller` |
| PATCH | `/projects/{projectId}/bugs/{bugId}/status` | §8.3 |

### 9.4 Chat, notifications, users, attachments — unchanged paths

Access checks change from per-project membership to org match (D15). Route list is otherwise identical to today, minus the removals below.

### 9.5 Removed routes

| Route | Reason |
|---|---|
| `POST /auth/invite` | replaced by `POST /org/invite`; the `auth` Lambda is deleted |
| `GET /projects/{projectId}/members` | D11 — membership is org-level |
| `DELETE /projects/{projectId}/members/{memberId}` | D11 — replaced by `DELETE /org/members/{sub}` |

### 9.6 Error contract

All handlers return `{ "error": "<human readable>", "code": "<machine code>" }`. `code` is new; the frontend's `request()` in `lib/api.ts` already surfaces `error` and needs only to pass `code` through for the `org_not_provisioned` branch in §7.1.

---

## 10. Backend Architecture

### 10.1 Lambda inventory

| Lambda | Status | Responsibility |
|---|---|---|
| `org` | **new** | org CRUD, members, invites, ownership transfer |
| `projects` | changed | projects, bin, reports — org-scoped; fan-out code deleted |
| `bugs` | changed | bug CRUD, new 5-state machine |
| `chat` | changed | history, members, notifications — org-scoped |
| `ws_chat` | changed | WebSocket chat — org-scoped; developer fan-out for notifications |
| `users` | changed | profile, avatar, phone OTP |
| `attachments` | unchanged | presigned S3 PUT/GET |
| `notifications` | changed | SES/SNS; adds the Reopened trigger |
| `post_auth` | simplified | activate pending member, sync name |
| `auth` | **deleted** | folded into `org` |

### 10.2 Shared layer (D14)

```
backend/layers/common/python/tfcommon/
  __init__.py
  http.py     response(status, body) · json_body(event) · ApiError
  auth.py     Caller · get_caller · require_role · require_developer
              require_org · require_project · can_invite · can_remove
  db.py       table handle · key builders (org_pk, project_pk, user_pk, …)
  bugs.py     STATUSES · VALID_TRANSITIONS · can_transition
  org.py      list_members · list_developers  (AP-6 / AP-7)
```

Published as a single `lambda_.LayerVersion` and attached to all nine functions. Handlers shrink to routing plus business logic; `response()` and the claims unpack disappear from every file.

**Boundary:** the layer contains authorisation and persistence primitives only. No business rules beyond the RBAC matrix and the transition table live there.

### 10.3 IAM changes

| Function | Change |
|---|---|
| `org` | inherits the `auth` Lambda's Cognito grants: `AdminCreateUser`, `AdminGetUser`, `AdminDeleteUser`, `AdminSetUserPassword`, `AdminUpdateUserAttributes`, `ListUsers` |
| `projects` | loses `cognito-idp:AdminDeleteUser` — member removal moves to `org` |
| `ws_chat` | unchanged (already has table read/write for the fan-out) |

### 10.4 CDK changes

- Add `LayerVersion`; attach to all functions.
- Add `OrgFn` + its routes; remove `AuthFn` and `POST /auth/invite`.
- Remove the two `/projects/{projectId}/members*` routes.
- **No changes to the User Pool** (D2, D3a) — no schema edit, no replacement risk.
- `RemovalPolicy.RETAIN` stays on the table, bucket and pool.

---

## 11. Frontend Architecture

### 11.1 Routes

| Route | Group | Access | Change |
|---|---|---|---|
| `/login` | auth | public | + "Forgot password?" link |
| `/signup` | auth | public | + org name field |
| `/forgot-password` | auth | public | **new** |
| `/onboarding` | auth | first login | + org-name fallback (§7.1) |
| `/dashboard` | app | all roles | all org projects |
| `/projects/[id]` | app | all roles | member list removed |
| `/team` | app | developer, owner | **new**, replaces `/admin` |
| `/bin` | app | all roles | read-only for Testers — no restore/delete controls |
| `/profile` | app | all roles | + Security card |

### 11.2 Permission helpers

A new `frontend/src/lib/permissions.ts` mirrors §3.1 so the UI never renders a control the API will reject:

```ts
export type Role = "owner" | "developer" | "tester";

export const isDeveloper   = (r: Role) => r === "owner" || r === "developer";
export const canManageTeam = (r: Role) => isDeveloper(r);
export const canInvite     = (r: Role, target: Role) =>
  target === "developer" ? r === "owner" : isDeveloper(r);
export const canEditBug    = (r: Role, sub: string, bug: Bug) =>
  isDeveloper(r) || bug.reportedBy === sub;
```

This file is the client mirror of `tfcommon/auth.py` and carries a comment saying so.

### 11.3 Component changes

| Component | Change |
|---|---|
| `context/auth-context.tsx` | `role` widens to the 3-role union; exposes `orgId`, `orgName`; handles the `org_not_provisioned` bootstrap branch |
| `components/layout/sidebar.tsx` | nav by role — Testers lose Team and Bin; shows org name |
| `app/(app)/admin/page.tsx` | **deleted**, replaced by `app/(app)/team/page.tsx` |
| `components/team/InviteMemberDialog.tsx` | **new** — replaces `InviteTesterDialog`; role dropdown gated by `canInvite` |
| `components/team/MemberTable.tsx` | **new** — flat member table with role badges (D12) |
| `app/(app)/projects/[id]/page.tsx` | member list + invite button removed (D11) |
| `components/projects/StatusBadge.tsx` | adds `Reopened` |
| `lib/bug-status.ts` | 5 states; legacy aliases deleted; `Reopened` styled amber |
| `app/(app)/profile/page.tsx` | + Security card (change password) |
| `lib/api.ts` | `orgApi` added; `authApi` and the two project-member calls removed; `BugStatus` union updated |

### 11.4 Team page (D12)

```
Team                                          [ + Invite ]

NAME       EMAIL             ROLE        JOINED
Kishore    k@acme.com        Owner       12 Mar
Asha       asha@acme.com     Developer   14 Mar    [remove]
Ravi       ravi@acme.com     Tester      02 Apr    [remove]
Meera      meera@acme.com    Tester      pending   [remove]
```

- The Invite dialog's role dropdown offers Developer only when `canInvite(role, "developer")`.
- The remove button is hidden for the Owner row (INV-2) and for Developer rows when the caller is a Developer (D6).
- `status: pending` renders in place of a join date until first login.

---

## 12. Notifications (D16)

| Trigger | Recipients | Channels |
|---|---|---|
| Bug status → `Fixed` | the bug's `reportedBy` | SES email + SNS WhatsApp (if phone verified) |
| Bug status → `Reopened` | all Developers + Owner | in-app + SES email |
| Bug created | all Developers + Owner | in-app only |
| Chat mention | mentioned user | in-app |

`Member joined` was considered and dropped as low-signal.

The Reopened and Bug-created fan-outs use AP-7. `bugs` invokes `notifications` asynchronously as it does today (`lambda:InvokeFunction`, `NOTIFICATIONS_FN_ARN`); the in-app rows are written directly by `bugs` using the same `USER#{sub}/NOTIF#{ts}#{id}` shape that `ws_chat` already writes.

Bug-created is in-app only by design — email on every filed bug is noise on an active project.

---

## 13. Environment Reset (D18)

Runs **before** any code change, as a standalone script committed at `scripts/reset_environment.py`.

### 13.1 Scope

| Deleted | Retained |
|---|---|
| Every Cognito user in `testflow-users`, including the operator's own account | The User Pool itself and its client |
| Every item in the `testflow` DynamoDB table | The table, its GSI and its TTL config |
| Every object in the attachments bucket | The bucket, its CORS and encryption config |

Deleted data covers: profiles, projects, bugs, chat messages, memberships, pending invites, notifications, reports, WebSocket connections, phone OTPs, and all S3 objects (screenshots, videos, documents, reports, avatars).

### 13.2 Safety

- `--dry-run` is the default; `--execute` is required to delete anything.
- Prints a full inventory and a per-resource count before acting.
- Requires typing the literal string `DELETE EVERYTHING` to proceed.
- Asserts region `ap-south-1` and the exact table/bucket/pool names before any destructive call.
- Deletes in dependency order: Cognito → DynamoDB → S3.

### 13.3 After the reset

The first person to sign up becomes the Owner of a new org (§7.1). The app is otherwise identical.

---

## 14. Implementation Plan

Ordered so the system is never left in a half-migrated state. The wipe first means no phase needs backward compatibility.

| Phase | Work | Verification |
|---|---|---|
| **0** | `scripts/reset_environment.py`; dry-run, then execute | Cognito, table and bucket all empty |
| **1** | `tfcommon` layer: `http`, `auth`, `db`, `bugs`, `org`. CDK: layer, `OrgFn`, route changes, delete `AuthFn` | `cdk synth` clean |
| **2** | `org` Lambda: bootstrap, members, invite, remove, transfer. Simplify `post_auth` | signup → org created; invite → member row |
| **3** | Rescope `projects` (delete all fan-out), `bugs` (5-state machine), `chat`, `ws_chat`, `users` onto the layer | org isolation holds; cross-org access 403s |
| **4** | Frontend auth: 3-role union, `permissions.ts`, org bootstrap, signup org field, forgot-password, profile Security card | full signup → dashboard |
| **5** | Frontend features: `/team`, sidebar by role, project page member removal, `Reopened` status | matrix in §3.1 matches the UI |
| **6** | End-to-end: owner + developer + tester walkthrough; verify INV-1…INV-5 | — |

### 14.1 Deletion checklist

Code that exists only to support per-project membership and must be removed, not adapted:

- `lambdas/auth/` — entire directory
- `projects/handler.py::_auto_add_existing_testers`
- `projects/handler.py::list_members`, `::remove_member`
- `post_auth/handler.py` — the `PENDING#` query, the admin-project expansion, the `PENDING#` deletes
- `list_projects` / `list_bin` — the tester branch and the `ThreadPoolExecutor` count fan-out
- `frontend/src/app/(app)/admin/page.tsx`
- `frontend/src/components/projects/InviteTesterDialog.tsx`
- `lib/api.ts` — `authApi`, `projectsApi.listMembers`, `projectsApi.removeMember`
- `lib/bug-status.ts` — `Verified` and `Reopen` legacy aliases

---

## 15. Assumptions & Open Items

Recorded because they were inferred rather than explicitly confirmed. Each is a one-line change if wrong.

| # | Assumption | Basis |
|---|---|---|
| A1 | **CONFIRMED** — Testers keep read-only access to project Reports | View and download; upload and delete remain Developer/Owner |
| A2 | **CONFIRMED** — Testers keep full chat access (read, post, @-mention) | Clearing history remains Developer/Owner |
| A3 | **CONFIRMED** — The Bin stays visible to Testers, read-only | Testers see soft-deleted projects but get no restore or permanent-delete controls (D8). Preserves today's behaviour, where the Bin link renders for every role in `sidebar.tsx` |
| A4 | Clearing chat history stays Developer/Owner | Destructive and org-wide |
| A5 | An email already belonging to another org is rejected at invite | Direct consequence of D1 (one org per user) |
| A6 | Project rename is Developer/Owner | Consistent with D8 |
| A7 | `createdBy` on a project is attribution only | D8 grants deletion to any Developer |

**A1–A3 are the ones worth a second look** — they define how much of the product a Tester actually sees.
