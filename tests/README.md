# TenderFlow tests

No test framework dependency — everything runs on Node's built-in runner via
`tsx` (needed because the suites import TypeScript source directly).

```bash
npm test          # everything
npm run test:unit # pure logic, no network
npm run test:rls  # database policies (needs Supabase)
npm run test:api  # Express middleware + real JWT isolation
```

## Layout

```
tests/
├── helpers/
│   └── rlsHarness.mjs        impersonation harness + fixture lifecycle
├── unit/                     no network required
│   ├── gemParser.test.mjs        HTML fixtures -> structured cards
│   ├── qualification.test.mjs    scoring, dedup, thresholds
│   └── vaultPath.test.mjs        path traversal guard
├── rls/                      requires SUPABASE_POOLER_URL
│   ├── isolation.test.mjs        cross-tenant matrix
│   └── roles.test.mjs            role permission matrix
└── api/                      requires Supabase
    ├── authorization.test.mjs    endpoint auth contract
    └── tenantIsolation.test.mjs  real JWT -> PostgREST
```

## How RLS is tested without a service-role key

`tests/helpers/rlsHarness.mjs` adopts the `authenticated` role and sets
`request.jwt.claims`, which is what `auth.uid()` reads. That exercises the real
policies over a normal Postgres connection, so no Auth Admin API — and no
service-role key — is required.

`tests/api/tenantIsolation.test.mjs` goes further and uses genuine sign-ins
over GoTrue, then queries PostgREST with the resulting JWT. Together the two
cover both the policy itself and the plumbing that carries identity to it.

Every fixture is prefixed `tfrlstest` and removed by `cleanupTestData()`, so
these are safe to run against a live project.

### Seeding auth users directly

If you write a test that signs a user in, the empty-string token columns in
`createTestUser` are load-bearing. GoTrue scans `confirmation_token`,
`recovery_token`, `email_change*`, `phone_change*` and `reauthentication_token`
into non-nullable Go strings; leaving them `NULL` makes every sign-in for that
user fail with a misleading `500 Database error querying schema`. That error
points at the schema but the cause is the row.

## Policy matrix

Enforced by `supabase/migrations/0005_rls_policies.sql`, asserted by
`tests/rls/roles.test.mjs`.

| Capability | owner | admin | manager | member | viewer | non-member | anon |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Read org business data | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create / update / delete business data | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Run discovery (writes runs + tenders) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Update the organisation record | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Toggle modules | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage members / invitations | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Delete the organisation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Leave the organisation yourself | ✅¹ | ✅ | ✅ | ✅ | ✅ | — | — |

¹ Unless you are the last active owner — a trigger blocks that, while still
allowing the organisation itself to be deleted.

"Business data" means `inventory_items`, `warehouses`, `vehicles`, `suppliers`,
`compliance_documents`, `projects`, `tenders`, `discovery_runs`,
`tender_qualifications`, `tender_analyses`, `organization_profiles`,
`signing_authorities`, `organization_discovery_settings`.

`user_security` (PIN, TOTP secret) is per-user, not per-organisation: only the
owning user can read or write their own row, regardless of role.

## What the negative cases assert

Cross-tenant reads return **zero rows** rather than erroring — that is RLS
filtering, not a permission failure. Cross-tenant writes are **rejected** by
`WITH CHECK`. Both matter:

- a `USING`-only policy blocks reads but still lets a member of Org A insert a
  row stamped `organization_id = OrgB`
- the "cannot move a row between organisations" test covers the same hole on
  `UPDATE`

## Requirements

Unit tests need nothing. RLS and API tests read `SUPABASE_POOLER_URL`,
`SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env`. They never need
`SUPABASE_SERVICE_ROLE_KEY`.
