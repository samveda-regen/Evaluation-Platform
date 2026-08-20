# TalentStaq Recruiter Integration Guide

This document is for developers on the **recruitment platform** side integrating
with TalentStaq: fetching/creating tests, inviting candidates, delivering
candidates into a test session, and receiving results.

Base URL for every endpoint below: `{TALENTSTAQ_API_BASE_URL}/api/integration`
(you'll be given the actual host separately).

---

## 0. Requirements checklist (what we need from you)

**Before integrating:**
- [ ] A backend capable of signing an **HS256 JWT** server-side (never in a
      browser/mobile client) — see §3.1.
- [ ] A place to securely store the JWT signing secret we issue you (e.g.
      secrets manager / env var on your server, not source control).
- [ ] Send us: platform name, a slug, and the `iss` (issuer) value your JWTs
      will use (§2). We hand back your signing secret in response.

**Per recruiter-user request, your JWT must include:**
- [ ] `sub` — your internal user id
- [ ] `email` — recruiter's email
- [ ] `companyId` (or `company_id`) — your internal org id (this becomes the
      TalentStaq tenant boundary — see §1)
- [ ] `iss` — matching what you registered with us
- [ ] `role` — `recruiter_user` for read-only, anything else for invite/write access

**Decisions to make (no extra setup required either way):**
- [ ] Candidate delivery: rely on our invite email, or use `candidate-session`
      to redirect candidates into your own UI first (§4).
- [ ] Results: poll `GET /tests/:testId/results`, or register a webhook via
      `POST /company/webhook` (§6) — this is self-service, nothing to send us.

**Not required from you:** database schema, pre-registering companies or
candidates, or any infrastructure beyond the ability to sign a JWT and
(optionally) receive an HTTPS POST for webhooks.

---

## 1. How tenancy works

Each recruiting organization on your platform maps to one **Company** on
TalentStaq, identified by the `companyId` you send us. Multiple recruiter users
at the same organization share one Company and see the same pool of tests,
invitations, and results — there is no per-user private data on our side.

You do **not** need to pre-register companies. The first authenticated request
from a given `companyId` auto-creates the Company and the recruiter user's
admin account on our side.

---

## 2. One-time setup (before you write any code)

Send us:

1. A name for your platform (e.g. "Acme Recruiter").
2. A slug (e.g. `acme-recruiter`) — used internally, not user-facing.
3. The `iss` (issuer) value you'll put in your signed JWTs, e.g.
   `https://api.acme-recruiter.com`.
4. (Optional) The `aud` (audience) value if you want it enforced.

We'll register you as an **Integration Partner** and hand back a **JWT signing
secret** (HMAC-SHA256 / HS256). Store it like any other API secret — never in
client-side code, never committed to source control, never logged. It's
encrypted at rest on our side and only ever shown to you once, at creation
time — if it's lost, ask us to rotate it (we cannot recover the original).

Webhooks (§6) are self-service and don't require anything from us up front —
you register your own callback URL via an authenticated API call once you're
integrated.

---

## 3. Authentication flow

### 3.1 Sign a JWT per recruiter session

Every request into TalentStaq is authenticated via a JWT **you sign** with the
secret we gave you. Claims:

| Claim | Required | Description |
|---|---|---|
| `sub` | yes | Your internal user id for this recruiter |
| `email` | yes | Recruiter's email |
| `companyId` (or `company_id`) | yes | Your internal org/company id — this becomes the TalentStaq tenant boundary |
| `company_name` | no | Used to label the Company on first creation |
| `name` | no | Recruiter's display name |
| `role` | no | `recruiter_user` → read-only (`tests:read`, `results:read`). Anything else (e.g. `admin`) → also gets `invites:write` |
| `iss` | yes | Must match the issuer you registered with us |
| `aud` | only if you registered one | Must match the audience you registered |
| `exp` | recommended | Short-lived — a few minutes is fine, you can mint a fresh one per API call |

Example (Node, `jsonwebtoken`):

```js
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    sub: recruiterUser.id,
    email: recruiterUser.email,
    name: recruiterUser.name,
    companyId: organization.id,
    company_name: organization.name,
    role: recruiterUser.isAdmin ? 'admin' : 'recruiter_user',
  },
  process.env.TALENTSTAQ_JWT_SECRET, // the secret TalentStaq gave you
  { issuer: 'https://api.acme-recruiter.com', expiresIn: '5m' }
);
```

### 3.2 Exchange it for an access token

```
POST /auth/exchange
Content-Type: application/json

{ "recruiterJwt": "<the JWT from 3.1>" }
```

Response:

```json
{
  "token_type": "Bearer",
  "access_token": "...",
  "expires_in": 900,
  "refresh_token": "...",
  "refresh_expires_in": 2592000,
  "scopes": ["tests:read", "invites:write", "results:read"],
  "admin": { "id": "...", "email": "...", "name": "..." },
  "company": { "id": "...", "external_company_id": "...", "name": "..." }
}
```

Use `access_token` as `Authorization: Bearer <token>` on every call below.
It expires in 15 minutes.

> **Shortcut:** you can also skip the exchange step entirely and send your
> signed recruiter JWT directly as the `Authorization: Bearer` header on any
> endpoint below — it's verified the same way. The exchange flow just gets you
> a longer-lived refresh token so you don't have to re-sign a JWT on every
> single call.

### 3.3 Refresh

```
POST /auth/refresh
Content-Type: application/json

{ "refreshToken": "<refresh_token from exchange>" }
```

Returns a new `access_token` + rotated `refresh_token` (30-day expiry).

### 3.4 Revoke

```
POST /auth/revoke
Authorization: Bearer <access_token>
```

Revokes every active refresh-token session for that recruiter user. Call this
on logout or when deprovisioning a user.

---

## 4. Endpoints

All require `Authorization: Bearer <access_token>` unless noted.

### List tests
```
GET /tests?page=1&limit=20&status=active
```
Scope: `tests:read`. Returns your company's tests with invite/attempt counts.

### Create a test with AI + optionally invite
```
POST /tests/create-with-ai
```
Scope: `invites:write`. Body:
```json
{
  "jobProfile": { "title": "Backend Engineer", "experience": "2-4 years" },
  "skills": ["Node.js", "PostgreSQL"],
  "difficulty": "medium",
  "mcqCount": 10,
  "codingCount": 2,
  "behavioralCount": 1,
  "testSettings": { "startTime": "2026-08-01T09:00:00Z", "duration": 60 },
  "candidates": [{ "name": "Jane Doe", "email": "jane@example.com" }]
}
```

### Invite candidates to an existing test
```
POST /tests/:testId/invitations
```
Scope: `invites:write`. Body:
```json
{
  "candidates": [{ "name": "Jane Doe", "email": "jane@example.com", "phone": "+1..." }],
  "customMessage": "Optional note shown in the invite email"
}
```
TalentStaq emails the candidate an invite link. Fires an `invitation.sent`
webhook (see §6) if you've configured one.

### Deep-link a candidate in (no email)
```
POST /tests/:testId/candidate-session
```
Scope: `invites:write`. Body:
```json
{ "candidate": { "name": "Jane Doe", "email": "jane@example.com" } }
```
Response:
```json
{ "redirectUrl": "https://.../test/login?token=...", "accessCode": "ABCD-1234", "isNew": true, "consumed": false }
```
Redirect the candidate's browser to `redirectUrl` (or hand them `accessCode` +
their email to type in manually) instead of relying on our invite email. Use
this if you want your own UI to be the thing the candidate sees before they
land on TalentStaq.

### Get results
```
GET /tests/:testId/results
```
Scope: `results:read`. Returns invitation status + attempt status/score per
candidate. Poll this, or use webhooks instead (§6).

### Webhook configuration
```
GET /company/webhook
POST /company/webhook
DELETE /company/webhook
```
Scope: `invites:write`. See §6.1 for details.

---

## 5. Scopes

| Role claim | Scopes granted |
|---|---|
| `recruiter_user` | `tests:read`, `results:read` |
| anything else (e.g. `admin`) | `tests:read`, `invites:write`, `results:read` |

A 403 with `{"error": "insufficient_scope"}` means your JWT's `role` claim
didn't grant the scope the endpoint needs.

---

## 6. Webhooks (optional, instead of polling results)

### 6.1 Register your callback URL (self-service)

```
POST /company/webhook
Authorization: Bearer <access_token>
Content-Type: application/json

{ "webhookUrl": "https://your-domain.example.com/webhooks/talentstaq" }
```

Response (the secret is shown **once** — store it immediately, it's encrypted
on our side afterward and can't be retrieved again; ask us to have you re-run
this call to rotate it):

```json
{ "webhookUrl": "https://your-domain.example.com/webhooks/talentstaq", "webhookSecret": "..." }
```

`webhookUrl` must be `https://`. Requires the `invites:write` scope (i.e. an
admin-role token, not `recruiter_user`).

Check current config: `GET /company/webhook` → `{ "configured": true, "webhookUrl": "..." }`
(never returns the secret again).

Remove it: `DELETE /company/webhook`.

### 6.2 Events

Once registered, we POST to your `webhookUrl` on:

| Event | When |
|---|---|
| `invitation.sent` | After `POST /tests/:testId/invitations` completes |
| `test.started` | When a candidate begins their attempt |
| `test.completed` | When a candidate submits (or is auto-submitted) |

Payload shape:
```json
{
  "event": "test.completed",
  "companyId": "...",
  "data": {
    "testId": "...",
    "testName": "...",
    "attemptId": "...",
    "candidateName": "Jane Doe",
    "candidateEmail": "jane@example.com",
    "score": 42,
    "status": "completed",
    "passingMarks": 35,
    "result": "passed"
  },
  "timestamp": "2026-07-22T10:00:00.000Z"
}
```
`passingMarks` is whatever the test's pass mark is set to (`null` if the test
has none configured). `result` is `"passed"` / `"failed"` based on
`score >= passingMarks`, or `null` when the test has no passing marks set —
only present on `test.completed`, not `test.started`.

### 6.3 Verifying the signature

Every request includes `X-TalentStaq-Signature: sha256=<hex>`, an HMAC-SHA256
of the raw request body using the `webhookSecret` returned by `POST /company/webhook`:

```js
const crypto = require('crypto');

function isValidSignature(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```
Reject the request (401/400) if the signature doesn't match. We treat 2xx as
delivered; anything else is logged and not retried, so respond quickly and
process asynchronously if your handler is slow.

---

## 7. Rate limits

- `/auth/exchange` and `/auth/refresh`: 100 requests / 5 minutes per IP.
- All other `/api/integration/*` endpoints: 300 requests / minute per IP.

A `429` response includes a JSON `{"error": "..."}` body — back off and retry
with exponential backoff.

---

## 8. Security notes

- Treat your JWT signing secret and webhook secret as production credentials —
  rotate them if you suspect exposure (ask us to reissue).
- Sign JWTs server-side only; never ship the secret to a browser or mobile app.
- Use short `exp` values on the recruiter JWT (minutes, not days) — the
  `refresh_token` from `/auth/exchange` is what should live longer.
- All traffic must be over HTTPS.

---

## 9. End-to-end flow

```text
HRIA Recruiter Platform
  |
  | 1) recruiter signs in
  | 2) HRIA backend signs a short-lived recruiter JWT
  v
Recruiter JWT
  |
  | 3) HRIA frontend sends the JWT to
  v
ManchesterGlobal /api/integration/auth/exchange
  |
  | 4) ManchesterGlobal verifies:
  |    - signature
  |    - issuer (iss)
  |    - audience (aud)
  |    - required claims
  | 5) ManchesterGlobal links or creates:
  |    - Company
  |    - Admin
  |    - externalProvider
  |    - externalUserId
  v
Access token + refresh token
  |
  | 6) HRIA uses the access token on future calls
  v
Protected ManchesterGlobal integration APIs
  - /api/integration/tests
  - /api/integration/tests/:testId/invitations
  - /api/integration/tests/:testId/results
  - /api/integration/company/webhook
```

In short:

- HRIA issues the recruiter JWT.
- ManchesterGlobal verifies it and links the account.
- ManchesterGlobal returns an access token for the subsequent API calls.
