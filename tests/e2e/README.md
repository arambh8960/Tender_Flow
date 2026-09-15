# End-to-end tests

These specs drive the real application against a **real Supabase project**.
Nothing is mocked: the browser signs in through Supabase Auth, the assertions
read back through PostgREST, and the tenant-isolation suite tests Postgres RLS
itself rather than the server's own `WHERE` clauses.

## Why a real project is required

The flows worth testing end to end are precisely the ones that depend on Auth,
RLS and Storage. A stubbed session would prove nothing about any of them — a
cross-tenant read blocked by a mock tells you only that the mock works.

When the required variables are absent, every spec **skips** rather than fails,
so `npm test` stays useful on a machine without credentials.

## Required environment

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL the browser and specs talk to |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public key; used for the sign-in the browser performs |
| `SUPABASE_SERVICE_ROLE_KEY` | Creates pre-confirmed users, seeds rows, cleans up |
| `E2E_EMAIL_DOMAIN` | Optional. Domain for generated accounts (default `tenderflow-e2e.com`) |
| `E2E_BASE_URL` | Optional. Skips the built-in web server and targets a running app |
| `E2E_API_BASE_URL` | Optional. Backend origin for the API-level assertions (default `http://localhost:3001`) |

### About the service role key

It is used for three things only: creating confirmed users, seeding fixture
rows, and deleting both afterwards. It is never used to satisfy an assertion —
every isolation check runs through a **normal signed-in user's** client, which
is the only way the result means anything.

Email confirmation is enabled on the project and CI has no mailbox, which is
why users are created pre-confirmed via the admin API. This is not a bypass of
the code under test: the browser still performs a real sign-in and still
receives a real JWT.

## Running

```bash
npm run test:e2e:install   # one-time: fetch the Chromium build
npm run test:e2e
```

Against an already-running deployment:

```bash
E2E_BASE_URL=https://staging.example.com npm run test:e2e
```

## Use a disposable project

These specs create users, organisations, inventory, documents and storage
objects. Point them at a **dedicated test project**, never at production.
Cleanup runs in `afterAll`, and because every business table cascades from
`organizations`, deleting the organisation removes its rows — but an
interrupted run can still leave records behind.

## Coverage

| Spec | Flow |
| --- | --- |
| `auth.spec.ts` | A — sign-in, session restore, sign-out, bad credentials |
| `onboarding.spec.ts` | A — company creation, OWNER membership, empty workspace |
| `inventory.spec.ts` | B — SKUs, coordinates, edits, negative-stock guard, archive |
| `discovery.spec.ts` | C — configuration, persisted runs, determinism, measured distance |
| `rfp.spec.ts` | D — persistence across reload, failure reporting, run history |
| `vault.spec.ts` | E — private bucket, signed URLs, cross-tenant document access |
| `admin.spec.ts` | F — admin sections, real metrics, role enforcement at the API |
| `tenant-isolation.spec.ts` | G — SELECT/INSERT/UPDATE/DELETE isolation, both directions |

## Known limitation: live GeM discovery

`discovery.spec.ts` covers everything downstream of the portal adapter —
normalisation, scoring, qualification, persistence and presentation. It does
**not** drive a live scrape of the GeM portal, because that depends on an
external site whose availability, markup and rate limiting are outside this
suite's control, and a test that fails when a third party changes its HTML is
not a useful signal.

Live scraping needs verification in a deployed environment. See the
"Production discovery dependency" section of the root `README.md`.
