# TenderFlow

Multi-tenant SaaS for public-procurement bidding. A company signs up, gets an
isolated workspace, and uses it to discover tenders on GeM, match them against
its own inventory, and produce a costed bid with a technical compliance trail.

---

## 1. Architecture

```
┌─────────────────────┐        ┌──────────────────────┐        ┌─────────────────┐
│  React + Vite SPA   │  JWT   │  Node/Express API    │        │    Supabase     │
│                     │───────▶│                      │───────▶│  Postgres + RLS │
│  react-router       │        │  requireAuth         │        │  Auth (GoTrue)  │
│  Supabase JS (anon) │◀───────│  requireOrgMember    │◀───────│  Storage        │
└─────────────────────┘        └──────────────────────┘        └─────────────────┘
         │                                │
         │  anon key + user JWT           │  agents, scraping, privileged writes
         └───────── RLS applies ──────────┘
```

Tenancy is enforced **in the database**. Both tiers query as the signed-in
user, so Row Level Security — not an application `WHERE` clause — is what makes
cross-tenant access impossible. The service-role key appears only where an
action has no user in the loop (audit rows, vault PIN records, member removal),
and every such query carries an explicit `organization_id`.

### Layout

| Path | Contents |
| --- | --- |
| `src/` | SPA: routes, guards, screens, hooks, API client |
| `src/routes/` | Route table plus auth / organisation / role guards |
| `src/hooks/` | `useInventory`, `useRfps`, `useDiscovery`, `useVault`, `useAdmin`, `useCompanySettings` |
| `server/routes/` `server/controllers/` | HTTP surface; controllers stay thin |
| `server/middleware/` | `requireAuth`, `requireOrgMember`, validation, rate limits, errors |
| `server/repositories/` | Organisation-scoped data access |
| `server/discovery/` | Portal adapter → parser → normaliser → dedupe → qualification → persistence |
| `server/agents/` | Technical and financial agents (deterministic) |
| `server/services/` | Storage, logistics/geo, security (SSRF), RFP pipeline, audit |
| `supabase/migrations/` | Ordered, idempotent SQL migrations |
| `tests/` | `unit/`, `integration/`, `e2e/`, `rls/`, `api/`, `fixtures/` |

---

## 2. Local setup

Requires Node 20+ (CI and the image use 22) and a Supabase project.

```bash
npm install
cp .env.example .env     # then fill it in — see §4
npm run db:migrate       # apply migrations
npm run db:types         # regenerate database.types.ts
npm run dev              # client on :5173, API on :3001
```

`npm run dev` runs both tiers. To run them separately use `npm run dev:client`
and `npm run dev:server`.

---

## 3. Supabase setup

1. Create a project. Note its URL and **publishable (anon)** key.
2. Copy the **service role** key — backend only, never into a `VITE_` variable.
3. From *Project Settings → Database*, copy the **session pooler** connection
   string into `SUPABASE_POOLER_URL`.
4. Apply migrations (§5).
5. Auth → Providers: enable **Email**. Enable Google only after configuring the
   OAuth consent screen and adding the redirect URL — see §7.
6. Storage: migration `0006` creates the private `org-documents` bucket and its
   policies. No manual step is required.

### Which connection string

Supabase exposes two Postgres endpoints and they are **not** interchangeable:

| Variable | Endpoint | Resolves over | Use |
| --- | --- | --- | --- |
| `SUPABASE_POOLER_URL` | Supavisor session pooler | IPv4 **and** IPv6 | **Preferred.** Works from CI and IPv4-only networks |
| `SUPABASE_DB_URL` | Direct (`db.<ref>.supabase.co`) | **IPv6 only** | Fails with `ENOTFOUND` on an IPv4-only host |

`scripts/db.mjs` tries the pooler first and falls back to the direct URL. On an
IPv4-only machine the direct URL cannot work, which is a network property, not
a misconfiguration.

---

## 4. Environment variables

`.env.example` is the authoritative list, with each variable's audience and
consequences. The split in brief:

**Frontend (compiled into the bundle — public by definition)**
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`,
`VITE_GOOGLE_CLIENT_ID`

**Backend (server process only)**
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`,
`APP_ENV`, `CORS_ORIGINS`, `GEMINI_API_KEY`, `GEMINI_API_KEY_2`,
`GROQ_API_KEY`, `CONVERT_API_SECRET`, `GOOGLE_CLIENT_ID`,
`PUPPETEER_HEADLESS`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_NAV_TIMEOUT_MS`

**Tooling only (migrations, one-off data moves)**
`SUPABASE_POOLER_URL`, `SUPABASE_DB_URL`, and the legacy `DB_*` set

In production the API **refuses to start** without `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and a non-wildcard
`CORS_ORIGINS`. A missing value fails at boot, not at the first request.

---

## 5. Database migrations

```bash
npm run db:status     # what is applied
npm run db:migrate    # apply pending
npm run db:verify     # compare the live schema against expectations
```

Each file runs in its own transaction and is recorded in
`public.schema_migrations`, so re-runs are no-ops. The files are also written
to be individually idempotent (`create table if not exists`,
`add column if not exists`, `drop policy if exists` before `create policy`), so
`--force` can safely re-apply one.

| Migration | Adds |
| --- | --- |
| `0001_identity` | profiles, organizations, members, modules, invitations |
| `0002_business` | org profile, inventory, warehouses, vehicles, compliance docs |
| `0003_discovery` | discovery runs, tenders, qualifications, analyses |
| `0004_rls_helpers` | `is_org_member`, `has_org_role_at_least`, `create_organization` |
| `0005_rls_policies` | the policy set for every tenant table |
| `0006_storage_and_lockdown` | private `org-documents` bucket, storage policies, grant lockdown |
| `0007`, `0008` | owner guard and auth trigger fixes |
| `0009_audit_notifications_runs` | audit_logs, notifications, analysis_runs, profile email, invitation status |
| `0010_invitations_and_org_creation` | `accept_invitation`, `my_pending_invitations`, full-profile `create_organization`, legacy OTP column removal |

---

## 6. Generated database types

`database.types.ts` mirrors the live schema and is shared by both tiers.

```bash
npm run db:types
```

It is generated, not hand-edited. If a type looks wrong the fix belongs in a
migration; editing the file only hides a mismatch until runtime.

---

## 7. Authentication

Supabase Auth (GoTrue) owns identity and sessions entirely. The browser signs
in with the SDK and receives a JWT; the API validates that JWT and derives the
caller's organisation from `organization_members`. The server issues no
credential of its own and accepts none.

### Supported flows

| Flow | Mechanism |
| --- | --- |
| Email code (OTP) | `signInWithOtp` → `verifyOtp`, with resend cooldown and expiry countdown. Requires the template change below |
| Email magic link | `signInWithOtp` → link → `/auth/callback`. The default |
| Email + password | `signInWithPassword` / `signUp` |
| Google | `signInWithOAuth({ provider: 'google' })` → `/auth/callback` |
| Session restore | `getSession` + `onAuthStateChange` on startup |
| Sign out | `signOut`, which clears the stored session |
| MFA (TOTP) | `supabase.auth.mfa.enroll` / `challenge` / `verify` |
| Step-up | A fresh OTP before changing the vault PIN |

### Required Supabase configuration

**Email (Authentication → Providers → Email)**
- Enable the Email provider.
- Confirm email: on by default. The E2E suite creates pre-confirmed users via
  the admin API because CI has no mailbox.
- The built-in SMTP is heavily rate limited — a burst returns
  `429 email rate limit exceeded`. Configure a custom SMTP provider for
  anything beyond light testing.
- Supabase also validates deliverability: an address at a domain with no MX
  record is rejected as "Email address is invalid".

#### Code or link? This is a template setting, not an API setting

`signInWithOtp` is the same call either way. **The email template decides what
the recipient gets**, and the API response is identical, so the frontend cannot
detect which one was sent. Showing a six digit input for an email that contains
only a link is exactly the mismatch `VITE_EMAIL_AUTH_MODE` exists to prevent.

| You want | Supabase template (Authentication → Email Templates → Magic Link) | Set |
| --- | --- | --- |
| **Six digit code** | Template body must contain `{{ .Token }}` | `VITE_EMAIL_AUTH_MODE=otp` |
| **Clickable link** (stock) | Template body contains `{{ .ConfirmationURL }}` | `VITE_EMAIL_AUTH_MODE=magic_link` *(default)* |

To switch this project to the six digit experience:

1. Authentication → Email Templates → **Magic Link**.
2. Replace the body with something containing the token, for example:
   ```html
   <h2>Your TenderFlow sign-in code</h2>
   <p>Enter this code to continue:</p>
   <p style="font-size:28px;letter-spacing:6px;"><strong>{{ .Token }}</strong></p>
   <p>It expires shortly and can be used once.</p>
   ```
3. Set `VITE_EMAIL_AUTH_MODE=otp` and rebuild the frontend.

The default is `magic_link` because that is what an unmodified project sends.
Under magic link the email opens `/auth/callback`, which establishes the
session and continues into organisation resolution exactly as Google does —
the authentication method never changes the bootstrap path.

Add the callback to Authentication → URL Configuration → Redirect URLs, the
same list Google needs.

**Google (Authentication → Providers → Google)** — *external setup required*
1. In Google Cloud, create an OAuth 2.0 client and configure the consent screen.
2. Put the client ID and client secret into the Supabase dashboard. **The
   client secret is a backend value — it belongs in Supabase, never in a
   `VITE_` variable.**
3. Add the callback Supabase shows you to Google's authorised redirect URIs.
4. Under Authentication → URL Configuration, add the app's own callback to the
   redirect allow list:
   - local: `http://localhost:5173/auth/callback`
   - production: `https://your-app.example.com/auth/callback`

Until this is done the Google button is present but the provider rejects the
round trip, and the UI reports "Google sign-in is not enabled on this
deployment yet". That is *configuration required*, not a code gap.

**MFA (Authentication → Providers → Multi-Factor)**
Enable TOTP to allow authenticator enrolment. Without it the security screen
reports that it cannot enrol a factor.

### Vault PIN

An **optional** second factor in front of compliance documents — not a login.
Stored as a bcrypt hash against the authenticated user, rate limited, and
locked for 15 minutes after 5 failures. Forgetting it triggers a fresh
Supabase code; the server additionally requires the session to be recently
issued (`requireRecentAuth`) before it will set a new PIN.

Resetting the PIN grants nothing new — a user holding a valid session could
already read their own documents. That is precisely why it is safe, and why
the PIN must never be the thing that authenticates you.

## 8. Storage

Compliance documents live in the **private** `org-documents` bucket at:

```
{organizationId}/{documentId}/{safeFileName}
```

The leading segment is the tenant key the storage policy checks, so company A
cannot read company B's object even given its exact path. Access is always a
freshly minted signed URL (5 minutes); no permanent public URL is ever
produced. Uploads are validated on MIME type, extension, and size (25 MB), and
filenames are reduced to a safe basename before storage.

---

## 9. Running

| Command | Effect |
| --- | --- |
| `npm run dev` | Client (:5173) and API (:3001) together |
| `npm run dev:client` / `npm run dev:server` | One tier |
| `npm run build` | Type-check then build the SPA to `dist/` |
| `npm start` | Run the API (what the container runs) |
| `npm run typecheck:all` | Client and server type-checks |

---

## 10. Tests

| Command | Scope | Needs credentials |
| --- | --- | --- |
| `npm test` | Everything Vitest covers | No |
| `npm run test:unit` | Agents, scoring, geo, security guards | No |
| `npm run test:integration` | Real Express app via Supertest | No |
| `npm run test:discovery` | Qualification and GeM parsing | No |
| `npm run test:agents` | Financial and technical agents | No |
| `npm run test:security` | SSRF, uploads, headers, CORS, rate limits | No |
| `npm run test:coverage` | Coverage report | No |
| `npm run test:rls` | RLS policies against a live project | **Yes** |
| `npm run test:api` | Cross-tenant API isolation | **Yes** |
| `npm run test:tenancy` | Both of the above | **Yes** |
| `npm run test:e2e` | Playwright flows A–G | **Yes** |

The credential-free suites are the default so `npm test` is useful on a fresh
clone. The suites that need a live project are separate because a passing
tenant-isolation test is only meaningful against real RLS.

### E2E

```bash
npm run test:e2e:install   # one-time Chromium download
npm run test:e2e
```

Needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`, and should point at a **disposable** project — the
specs create and delete users, organisations and storage objects. Without those
variables every spec skips rather than fails. See `tests/e2e/README.md`.

---

## 11. Deployment

One architecture, configured in-repo:

| Tier | Platform | Config |
| --- | --- | --- |
| Frontend | Vercel | `vercel.json` |
| Backend | Render (Docker) | `render.yaml`, `Dockerfile` |
| Database / Auth / Storage | Supabase | `supabase/migrations/` |

**Frontend** — build `npm run build`, output `dist/`. Set the four `VITE_*`
variables in the Vercel project. The SPA rewrite in `vercel.json` is required
for client-side routing; without it a deep link like `/admin/audit` 404s.

**Backend** — a Docker service, not Render's Node runtime, because discovery
needs a real Chromium. The image installs distribution Chromium and sets
`PUPPETEER_EXECUTABLE_PATH` to it. Health check: `/api/health`. Readiness:
`/api/ready`.

**Order of operations**

1. Apply migrations against the production project.
2. Deploy the backend; confirm `/api/ready` reports `supabase: ok`.
3. Deploy the frontend with `VITE_API_BASE_URL` pointing at the backend.
4. Set `CORS_ORIGINS` on the backend to the frontend's origin, and redeploy.

Steps 3 and 4 are mutually dependent — the backend rejects the frontend until
its origin is on the allowlist.

---

## 12. Discovery, and its limits

The pipeline is layered so each stage is separately testable:

```
GeMAdapter → GeMClient (Puppeteer) → GeMParser → GeMNormalizer
          → Deduplicator → InventoryMatcher → Technical / Logistics
          → Commercial / Compliance → TenderQualifier → DiscoveryRepository
```

Properties that are enforced and tested:

- **Deterministic.** No `Math.random` anywhere in scoring or qualification;
  identical inputs produce identical scores, ordering and reasons.
- **No invented data.** A field the parser cannot read comes back empty with a
  parse warning. It is never replaced by a placeholder organisation or
  category, and an unreadable card scores zero rather than matching on filler.
- **Explained both ways.** Every result carries the reason it qualified *or*
  the reason it was rejected.
- **Measured distance.** The consignee is resolved to coordinates, the nearest
  warehouse holding matched stock is chosen, and the distance between them is
  computed. The configured average is used only when the consignee cannot be
  resolved, and is then explicitly labelled an estimate.

### Known limitations

- **Live GeM scraping needs verification in a deployed environment.** It
  depends on an external portal's markup, availability and rate limiting. The
  adapter has timeouts, bounded retries, selector fallbacks and block
  detection, and everything downstream of it is covered by fixture-driven
  tests — but a successful live scrape has not been demonstrated from a
  deployed host and should not be assumed.
- **Distance is gazetteer-based.** Locations resolve against a bundled table of
  Indian states and major cities, and road distance is the great-circle
  distance times a fixed factor. It is deterministic and honest about its
  precision, but it is not a routed distance. An unrecognised place returns
  null rather than a guess.
- **Market insights are LLM-generated**, not a market data feed, and are
  labelled indicative in the UI.

---

## 13. Security model

| Control | Implementation |
| --- | --- |
| Identity | Supabase Auth only; the server mints and accepts no credential of its own |
| Ownership | Conferred solely by creating an organisation; an invitation can never grant it |
| Tenant isolation | Postgres RLS on every organisation-owned table |
| Authorisation | `requireAuth` + `requireOrgMember(role)`; roles owner/admin/manager/member/viewer |
| Tenant context | Derived from the JWT and membership; a client-supplied id is only ever a selector |
| Secrets | Service role never in a `VITE_` variable; the build output is scanned for it |
| SSRF | Protocol/host allowlist, DNS-resolved private-range rejection, per-hop redirect revalidation |
| Uploads | MIME + extension + size validation, filename reduced to a safe basename, private bucket |
| Document access | Short-lived signed URLs, ownership verified before signing |
| CORS | Explicit allowlist; no wildcard, and empty in production means deny |
| Rate limits | Per user (falling back to IP) on auth, discovery, upload, AI and fetch routes |
| Headers | Helmet, plus `X-Frame-Options`/`Referrer-Policy` at the CDN |
| Audit | Server-written `audit_logs`; no client INSERT policy, so entries cannot be forged |
| Errors | `{ code, message, requestId }` — never a stack trace, path or key |

Role changes enforce an invariant the UI cannot: an organisation must always
retain at least one active owner, and only an owner may grant ownership.
