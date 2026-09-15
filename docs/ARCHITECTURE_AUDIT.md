# TenderFlow — Architecture Audit (Phase 0)

**Date:** 2026-09-07
**Repo root:** `Tender_Flow-main/`
**Baseline verified:** `npx tsc --noEmit` (frontend) → clean · `npx tsc --noEmit -p server/tsconfig.json` → clean · `npm run build` → **exit 0**, built in 6.24s.

This document is the pre-implementation map. No application code has been modified.

---

## 1. Current directory structure

```
Tender_Flow-main/
├── .env                        ← LIVE SECRETS, present in working tree (gitignored)
├── index.html                  ← Vite entry, mounts #root
├── package.json                ← single package for BOTH client and server
├── tsconfig.json               ← include: src/**  (data/, types.ts, server/ NOT checked here)
├── tsconfig.node.json
├── server/tsconfig.json        ← include: ["*.ts"] only — subfolders not directly included
├── vite.config.ts
├── tailwind.config.js / postcss.config.js
├── types.ts                    ← SHARED types, imported by client AND server
├── metadata.json
├── gem_diagnosis.png           ← stray 425 KB debug screenshot
│
├── data/                       ← MOCK / SEED DATA (frontend-imported, also server-imported)
│   ├── storeData.ts            (1026 lines — productInventory: SKU[])
│   ├── configData.ts           (initialConfig: AppConfig — one hardcoded company)
│   └── rfpData.ts              (initialRfpList: Rfp[] + 5 inline RFP text blobs)
│
├── server/
│   ├── index.ts                (487 lines — Express entry + ALL routes inline)
│   ├── db.ts                   (pg Pool + query helper)
│   ├── auth.ts                 (250 lines — 8 handlers: Google OIDC, PIN, TOTP, OTP)
│   ├── schema.sql              (5 tables, no org column anywhere)
│   ├── gemini.ts               (RFP structural parse, 2-key rotation)
│   ├── grok.ts                 (ATC slice + legal/risk parse)
│   ├── chatbot.ts              (copilot + doubles as market-insights generator)
│   ├── listModels.ts           (standalone script — DEAD)
│   ├── discovery/
│   │   ├── DiscoveryCoord.ts   (85 lines)
│   │   └── GeMWorker.ts        (258 lines — scrape + parse + match + logistics + qualify)
│   └── utils/
│       ├── extractJson.ts      (LLM JSON hardening)
│       ├── normalizeParsedRfp.ts (Gemini JSON → ParsedRfpData)
│       ├── rfpStatus.ts
│       └── agentLogger.ts      (DEAD — never imported)
│
├── src/
│   ├── index.tsx               (root, GoogleOAuthProvider)
│   ├── App.tsx                 (567 lines — GOD COMPONENT: auth gate, routing, API, orchestration)
│   ├── constants.ts            (91 lines — DEAD, stale "Asian Paints" data)
│   ├── index.css
│   ├── vite-env.d.ts
│   ├── agents/
│   │   ├── technicalagent.ts   (runs on the SERVER despite living in src/)
│   │   └── financialagent.ts   (same)
│   ├── assets/                 (3 PNGs)
│   └── components/             (18 files, flat — no ui/layout/feature separation)
│
└── vault_storage/              ← 15 uploaded compliance files on local disk, no tenant scoping
```

### Immediate structural observations
- **No routing library.** Navigation is a `switch` on `currentView` state inside `App.tsx`.
- **No state manager, no contexts, no hooks directory, no services layer.**
- `src/agents/*` is executed by the Express server (`server/index.ts:8-9`) — a client folder is a server dependency. This is why `server/tsconfig.json` compiles but the layering is inverted.
- `types.ts` at repo root is the single shared contract. Good instinct, wrong location for a growing system.
- One `package.json` for client + server means Puppeteer, pg, bcrypt, nodemailer sit in the same dependency graph Vite resolves.

---

## 2. Frontend architecture

| Concern | Where it lives today |
|---|---|
| Entry point | `src/index.tsx` |
| App root | `src/App.tsx` |
| Routing | `App.tsx:318-496` — `switch (currentView)`, 11 `View` union members |
| Auth state | `App.tsx:57-59` (`user`, `isAuthSessionActive`, `onboardingStep`) + `localStorage` |
| Global state | 14 `useState` hooks in `App.tsx`; passed down as props |
| Contexts | **None** |
| API calls | `apiService` object at `App.tsx:32-52` (1 method), plus **~20 raw `fetch()` calls scattered across 9 components** |
| Feature components | `src/components/*.tsx` — flat, 18 files |
| Pages/screens | Same folder, distinguished only by the `Screen` suffix convention |
| Reusable components | **None extracted** — Tailwind classes are copy-pasted per screen |
| Types | `types.ts` (root) |
| Constants | `src/constants.ts` — **entirely unused** |
| Mock data | `data/*.ts`, imported directly into `App.tsx:11,26,27` |

### `App.tsx` responsibility inventory (the core refactor target)
`App.tsx` currently owns, in one file:
1. Auth session restore from `localStorage` (`:99-114`)
2. Login/logout/PIN-change handlers (`:117-130`)
3. **Auto-discovery side effect** — picks the highest-value SKU and fires a GeM scrape on login (`:133-175`), guarded by a **module-level mutable flag** `hasTriggeredDiscovery` (`:54`) that survives remounts and never resets on logout
4. RFP list state + `updateRfpState` reducer-by-hand (`:178-186`)
5. The full RFP processing pipeline `processRfp` (`:188-258`) — URL fetch → parse → agent output merge → duration timing
6. **Fake progress logs on timers** (`:220-236`) interleaved with real backend logs
7. Three separate inline `fetch` implementations of discovery (`:149`, `:390`, `:424`)
8. View rendering and every screen's callback wiring (`:318-496`)
9. Two full-screen auth gates (`:499-544`)

### Component map
| Component | Lines | Role | Notable coupling |
|---|---|---|---|
| `AnalysisScreen` | 898 | Tender analysis, BoQ, PDF export, doc conversion | 4 inline `fetch`, jsPDF, `config` prop |
| `FinalRecommendation` | 530 | Bid recommendation + export | `analysisContext` any-typed |
| `SignInScreen` | 458 | Google OAuth + OTP + PIN + 2FA (also reused as **vault unlock**) | 7 inline `fetch` |
| `OnboardingWizard` | 401 | PIN setup / TOTP bind only — **not** company onboarding | 5 inline `fetch` |
| `VaultScreen` | 348 | Compliance doc list, upload, view/download | 5 inline `fetch` |
| `ProcessingScreen` | 336 | Live agent log theatre + market ticker | 2 inline `fetch` |
| `ConfigScreen` | 309 | Company profile, signing authorities, asset value | **hardcoded admin password** |
| `Frontpage` | 265 | Dashboard, urgency heatmap, discovery cards | — |
| `StoreScreen` | 242 | Inventory CRUD (in-memory only) | writes never persist |
| `Helperbot` | 216 | Copilot chat | 1 inline `fetch` |
| `RfpInput` | 197 | URL / file ingestion | 1 inline `fetch` |
| `DiscoveryScreen` | 190 | Search + filters + result grid | filters are local state, not config |
| `AdvancedSearchScreen` | 186 | Ministry/location/BoQ tabs | **wired to a broken path — see §6** |
| `LogScreen` | 133 | Terminal view | — |
| `AddItemModal` | 118 | SKU create/edit | hardcoded Jalandhar lat/lon default |
| `Header` | 71 | Nav | **hardcoded operator name "Ansh Pratap Singh"** |
| `Logo` | 8 | — | — |

---

## 3. Backend architecture

**Everything is in `server/index.ts`.** There are no controllers, no service layer, no repositories, no middleware beyond `cors()` and `express.json()`, no router modules, no request validation, no auth middleware, and no error-handling middleware.

| Layer | Status |
|---|---|
| Express entry | `server/index.ts` — app creation, middleware, 20 route handlers, DB bootstrap, `listen()` |
| Routes | Inline `app.post(...)`/`app.get(...)` in the entry file |
| Controllers | **None** (except `auth.ts`, which exports handlers directly and is the one good precedent) |
| Services | **None** — `gemini.ts`, `grok.ts`, `chatbot.ts` are the closest thing |
| Agents | `src/agents/technicalagent.ts`, `src/agents/financialagent.ts` (imported across the client/server boundary) |
| Workers | `server/discovery/GeMWorker.ts` |
| Scrapers | Same file — Puppeteer launch, navigation, DOM extraction |
| AI services | `gemini.ts`, `grok.ts`, `chatbot.ts` |
| DB access | `server/db.ts` — a raw `pg.Pool`; queries written inline in route handlers |
| Utilities | `server/utils/*` |
| Logging | `console.log` with ANSI colour codes; `addLogToConsole()` at `index.ts:75` |
| Error handling | Per-route `try/catch`; inconsistent response shapes; two global process-level handlers that **log and continue** (`index.ts:23-29`) |
| Env config | `dotenv/config` at top of `index.ts` + a second `dotenv.config()` in `db.ts`; no validation, no schema, no fail-fast |

### Error-shape inconsistency (real, observable)
```
/api/discover        → { success: false, error, message }
/api/parse-rfp       → { error: "BACKEND_LIVE_ERROR" }
/api/vault/documents → { success: false, error }
/api/inventory       → res.status(500).send("Inventory Retrieval Error")   ← plain text
/api/market-insights → { success: false, data: {...} }  ← 200 OK on failure
```

---

## 4. Current authentication architecture

```
SignInScreen
   │
   ├─ Google Sign-In (@react-oauth/google, VITE_GOOGLE_CLIENT_ID)
   │       └─ POST /api/auth/login  { token }
   │             └─ google-auth-library verifyIdToken
   │                   └─ SELECT/INSERT vault_access WHERE recovery_email
   │                         └─ returns { email, is_setup_complete, has_pin }
   │
   └─ Email OTP path
           POST /api/auth/check-email → POST /api/auth/send-otp (nodemailer/Gmail)
           → POST /api/auth/verify-otp

Then App.tsx:
   localStorage['tf_auth_user']      = JSON of the response
   localStorage['tf_setup_complete'] = "true"|"false"
   isAuthSessionActive = true         ← the entire session model
```

### Critical properties
- **There is no session token.** `verifyVaultAccess` returns the literal string `"session_token_approved"` (`auth.ts:107`) and nothing ever checks it again.
- **No API endpoint is authenticated.** Every route — inventory, vault documents, config update, discovery — is callable by an unauthenticated client.
- Session restoration = trusting `localStorage`. Setting `tf_auth_user` by hand in DevTools fully logs you in.
- `vault_access` is simultaneously the users table, the 2FA table, and the OTP table.
- The `OnboardingWizard` is a **security onboarding** (PIN → TOTP), not a business onboarding. There is no company/organization creation flow anywhere.
- Vault unlock reuses `SignInScreen` as a modal gate (`App.tsx:353-361`); the unlock is client-side state (`isVaultUnlocked`) and the vault API endpoints remain open regardless.

---

## 5. Current data model

### Persisted (PostgreSQL, `server/schema.sql`)
| Table | Columns | Tenant column |
|---|---|---|
| `company_profile` | id, company_name, address, gstin, pan, annual_turnover_cr, experience_years | ❌ — seeded with **one row**, read via `LIMIT 1` |
| `signing_authorities` | id, name, designation, din | ❌ (table exists but **no route reads or writes it**) |
| `compliance_vault` | id, cert_name **UNIQUE**, category, issued_date, expiry_date, is_valid, file_path | ❌ — `cert_name` unique **globally**, so two orgs can never both have "ISO 9001:2015" |
| `product_inventory` | id, sku_id **UNIQUE**, product_name, category, sub_category, brand, available_qty, unit_price, gst_rate, warehouse_location, technical_specs JSONB, last_restocked | ❌ — `sku_id` unique globally |
| `vault_access` | id, recovery_email **UNIQUE**, pin_hash, two_fa_secret, is_2fa_enabled, is_setup_complete, is_locked, failed_attempts, last_login, reset_token, reset_token_expiry | ❌ (this *is* the user table) |

### In-memory / type-level only (never persisted)
| Entity | Defined at | Persistence |
|---|---|---|
| `SKU` (28 fields) | `types.ts:60-99` | `data/storeData.ts` seed → React state; `product_inventory` table is a **narrower, out-of-sync** shape (no warehouse lat/lon, no truckType, no leadTime, no costPrice, no margin, no compliance flags) |
| `Rfp` / tender | `types.ts:231-265` | React state only — lost on refresh |
| `Tender` (discovery result) | `types.ts:187-201` | React state only — **discovery output is never stored** |
| `AppConfig` | `types.ts:294-304` | React state; only 4 of its fields sync to `company_profile` |
| `SigningAuthority` | `types.ts:287-292` | React state only |
| Warehouse | ❌ no entity | embedded as 4 fields inside every SKU |
| Vehicle | ❌ no entity | `TruckType` string union on the SKU |
| Route / distance | ❌ no entity | a single user-supplied number (`manualAvgKms`) |
| Project | ❌ does not exist | — |
| Supplier | ❌ does not exist | — |
| Discovery run | ❌ does not exist | — |
| Qualification result | ❌ no entity | fields spliced onto `Tender` |
| Organization | ❌ **does not exist** | — |

### Object → concept coverage matrix (requested in Phase 0)
| Concept | Represented? | Where |
|---|---|---|
| User | Partially | `vault_access` row + `UserData` type |
| Company | Yes, singular | `company_profile` (1 row), `configData.ts` |
| Organization | **No** | — |
| Tender | Yes, transient | `Rfp`, `Tender` types |
| Bid | Merged into Tender | — |
| Inventory item / Product | Yes | `SKU`, `product_inventory` |
| Supplier | **No** | — |
| Project | **No** | — |
| Vehicle | Weak | `TruckType` enum + `TRUCK_*` constants (unused) |
| Route | **No** | `manualAvgKms` scalar |
| Warehouse | Weak | 4 denormalised SKU fields |
| Compliance info | Yes | `compliance_vault` |
| Documents | Yes | `vault_storage/` on local disk |
| Discovery run | **No** | — |
| Qualification result | Weak | ad-hoc fields on `Tender` |

---

## 6. Current discovery architecture

### Actual traced flow
```
DiscoveryScreen.handleSearchTrigger        src/components/DiscoveryScreen.tsx:30
   │  (filters built from LOCAL component state, not config)
   ▼
App.tsx onSearch → fetch POST /api/discover               App.tsx:390
   │  body: { portal, category, filters, inventory }
   │  ⚠ the ENTIRE inventory array is shipped to the server on every search
   ▼
app.post("/api/discover")                                 server/index.ts:211
   │  no auth, no validation beyond presence of category+inventory
   ▼
new DiscoveryCoordinator(inventory, logFn)                DiscoveryCoord.ts:8
   │  .runDiscovery(portal, category, filters)
   │  hard-throws unless portal === 'gem'                 DiscoveryCoord.ts:22
   ▼
for (cat of filters.categories || [category])             DiscoveryCoord.ts:30
   │
   ▼
GeMWorker.scrape(cat)                                     GeMWorker.ts:30
   │  launches a NEW Puppeteer browser PER CATEGORY, headless:false
   │  goto bidplus.gem.gov.in/all-bids → type → click #searchBidRA
   ▼
GeMWorker.extractBidsFromPage(page)                       GeMWorker.ts:153
   │  page.evaluate over #bidCard .card  →  GeMBid[]
   │  PARSING happens inside the browser context, mixed with scraping
   ▼
GeMWorker.filterFutureBids                                GeMWorker.ts:187
   │  keeps only endDate within [today, today+3 months]
   ▼
GeMWorker.qualify(allRawBids)                             GeMWorker.ts:242
   │  → calculateMetrics: inventory match + logistics cost + risk, ALL INLINE
   ▼
res.json({ success: true, data: qualifiedBids })
   ▼
setDiscoveryResults(...)  → DiscoveryScreen grid          App.tsx:397
```

### Where each pipeline stage lives today
| Target stage | Current location | Status |
|---|---|---|
| Coordinator | `DiscoveryCoord.ts` | exists, thin, GeM-hardcoded |
| Portal adapter | — | **missing** |
| Portal client (browser/session) | `GeMWorker.scrape` `:30-64` | fused with everything else |
| Parser | `GeMWorker.extractBidsFromPage` `:153-185` | inside `page.evaluate` |
| Normalizer | — | **missing** — `GeMBid` leaks straight to the UI |
| Deduplicator | — | **missing** |
| Basic filters | `filterFutureBids` `:187-205` | exists |
| Inventory matcher | `calculateMetrics` `:208-213` | 2 `.includes()` calls |
| Technical qualification | — | **missing at discovery time** |
| Logistics qualification | `calculateMetrics` `:216-228` | `distance × rate`, distance is user input |
| Overall qualification | `qualify` `:242-258` | one boolean expression |
| Persistence | — | **missing** |

### Confirmed defects
1. **Advanced Search is dead-wired.** `AdvancedSearchScreen` POSTs to `/api/discover` with `category: 'ADVANCED_MODE'` and `filters: params` (`App.tsx:424-433`). `params` has no `.categories`, so the coordinator falls through to `[category]` and **scrapes GeM for the literal string "ADVANCED_MODE"**. `GeMWorker.scrapeAdvanced()` (89 lines, `:69-133`) is **never called from anywhere**.
2. **`matchScore` is fabricated on failure.** `GeMWorker.ts:235` — when the real score is 0, it returns `Math.floor(Math.random() * 30) + 10`. Random numbers are shown to the user as "Stock Match %".
3. **`distance` is not a distance.** `GeMWorker.ts:216` sets `distance = filters.manualAvgKms` — the slider value the user chose. The qualification check at `:251` then tests `metrics.distance <= filters.manualAvgKms`, i.e. `X <= X`, which is **always true**. Consignee location is scraped but never geocoded or used.
4. **Match score denominator is the whole catalogue.** `:213` — `matchingSKUs.length / inventory.length`. Adding unrelated SKUs mathematically lowers every tender's score.
5. **Scrape errors return `[]`.** `:58-60` and `:127-129` swallow every failure into an empty array, so "portal blocked" and "no results" are indistinguishable.
6. **`headless: false`** (`:32`, `:71`) opens a visible Chrome window per search — will not work on a server.
7. **One browser per category, launched serially**, never reused; no rate limiting, no retry, no pagination (only page 1 is read).
8. **`hasTriggeredDiscovery`** is a module-level `let` (`App.tsx:54`) — auto-discovery fires once per page load, ignores logout, and would fire for whatever org loaded first.

---

## 7. Current GeM implementation

All of it is `server/discovery/GeMWorker.ts` (258 lines), one class with mixed responsibilities.

**Session/browser (would become `GeMClient`)** — `:31-41`, `:70-78`
- `puppeteer.launch` with `--no-sandbox`, `--disable-blink-features=AutomationControlled`, `--ignore-certificate-errors`, `headless:false`
- fixed 1920×1080 viewport, one hardcoded Chrome 121 UA
- `waitUntil: 'networkidle2'`, 60 s selector timeout
- no retry, no backoff, no CAPTCHA detection, no session reuse, no proxy support

**DOM extraction (would become `GeMParser`)** — `:153-185`
- selectors: `#bidCard`, `.card`, `a.bid_no_hover`, `.end_date`, `.org_name`, `.consignee_location`
- bid id via `href.match(/\d+/)`; detail URL rebuilt as `showbidDocument/{n}`
- end date via `/\d{2}-\d{2}-\d{4}/` on `.end_date`
- title/category both from `innerText.match(/Items:\s*(.*)/)` — **the same value twice**
- EMD via `innerText.includes('EMD: Yes')` — a substring test
- **silent fallbacks**: missing org → `"Ministry of Defence"`; missing title → `"Industrial Supply"`; missing location → `"Location Restricted"`. Fabricated data is indistinguishable from scraped data downstream.
- date parsed as `DD-MM-YYYY` in `filterFutureBids` with no validation — a malformed string yields `Invalid Date` and is silently dropped

**Advanced search** — `:69-133`, dead code. Select2 dropdown driving for ministry/organization/state/city/BoQ tabs. Worth preserving into `GeMAdapter` rather than deleting.

**Normalization** — does not exist. `GeMBid` (`:4-16`) is spread directly into `Tender` at `:248`, so GeM-shaped fields (`org`, `endDate`, `consigneeLocation`, `emdRequired`) are the app-wide tender vocabulary. This is the single biggest obstacle to adding a second portal.

---

## 8. Current AI integrations

| Service | File | Model | Purpose | Failure mode |
|---|---|---|---|---|
| Google Gemini | `server/gemini.ts` | `gemini-2.5-flash`, temp 0.1, 20480 max tokens | Structural RFP extraction → strict JSON | 2-key rotation, `keys.length * 2` attempts, 1 s backoff, then throws |
| Groq (ATC) | `server/grok.ts` | `llama-3.3-70b-versatile`, temp 0.1 | ATC slice → summary, required docs, smart links, risk entries | catch → returns `{atc_summary:[], required_documents:[], documents:[]}` — **silently drops `risk_entries`**, shape differs from success path |
| Groq (Copilot) | `server/chatbot.ts` | `llama-3.3-70b-versatile`, temp 0.6 | `/api/copilot-chat` | rethrows → 500 |
| Groq (Market data) | `chatbot.ts` reused | same | `/api/market-insights` — **an LLM is asked to invent commodity prices** and the result is cached 1 h and rendered as live market data |

Supporting logic worth preserving:
- `extractJsonFromText` (`utils/extractJson.ts`) — markdown strip, brace extraction, control-char scrub, smart-quote normalise, trailing-comma repair.
- `parseRFP`'s second-stage repair (`gemini.ts:136-155`) — bracket-stack completion for truncated JSON, inner-quote escaping.
- `extractATCSlice` (`grok.ts:7`) — 3-tier fallback (exact slice → 5000 chars → last 8000 chars), bilingual EN/HI keywords.
- `normalizeParsedRfp` — Gemini JSON → `ParsedRfpData`, with certification keyword extraction.

Gemini and Groq are fired **in parallel** at `index.ts:403-406`. `parseRFP` rejecting takes down the whole request even though the Groq half succeeded (`Promise.all`, not `allSettled`).

Prompt content is hardcoded inline. Nothing is org-configurable. `content.substring(0, 30000)` silently truncates long tenders.

---

## 9. Current inventory model

Two incompatible shapes for the same thing.

**`SKU` (`types.ts:60-99`)** — the shape the whole app actually uses (28 fields): identity (skuId, productName, productCategory, productSubCategory, oemBrand), `specification: Record<string,string>`, `availableQuantity`, warehouse (location, code, lat, lon), logistics (truckType, leadTime), commercials (costPrice, unitSalesPrice, bulkSalesPrice, gstRate, brokerage, minMarginPercent), flags (isActive, isCustomMadePossible, isComplianceReady), and a transient `matchPercentage`.

**`product_inventory` (`schema.sql:33-46`)** — 12 columns. Missing: warehouse lat/lon, warehouseCode, truckType, leadTime, costPrice, bulkSalesPrice, brokerage, minMarginPercent, and all three boolean flags. Naming is snake_case and diverges (`brand` vs `oemBrand`, `unit_price` vs `unitSalesPrice`, `available_qty` vs `availableQuantity`).

**No mapper exists between them.** `GET /api/inventory` returns raw snake_case rows that do not satisfy `SKU`, which is why the frontend never calls it — `App.tsx:66` seeds from `data/storeData.ts` instead. `StoreScreen` edits are React state only; `POST /api/inventory/update-stock` exists but is never called from the client.

Warehouse data is denormalised into every SKU row. 20 SKUs across 3 warehouses = 20 copies of 3 coordinate pairs.

---

## 10. Current logistics implementation

There are **three** logistics calculations, in three places, that disagree.

1. **`GeMWorker.calculateMetrics`** (`:216-228`) — discovery-time.
   `distance = filters.manualAvgKms` (a slider value, not a computed distance).
   `effectiveRate` = base rate × 1.0 / 0.7 / 0.4 by `bestSku.truckType`.
   `totalLogisticsCost = distance × effectiveRate`.
2. **`runFinancialAgent`** (`financialagent.ts:66-67`) — analysis-time.
   `baseTransport = manualAvgKms × manualRatePerKm`, then `× 1.10` buffer.
   **Ignores truck type entirely** — so the same tender gets a different freight number in discovery than in analysis.
3. **`src/constants.ts`** — `TRUCK_CAPACITY_TONS`, `TRUCK_COST_PER_KM`, `CATEGORY_TO_TRUCK_MAP`, `TRANSPORT_COST_ADJUSTMENT_FACTOR`, `CONSIGNEE_LOCATIONS` (6 hardcoded pincodes), and a correct **Haversine** `getDistanceFromLatLonInKm`. **None of it is imported anywhere.** The data is also stale — it describes a paints business ("Decorative Paints", "Industrial Coatings"), not the cables/lighting business in `storeData.ts`.

So: real coordinates exist on every SKU, a working Haversine function exists, and neither is used. Distance is a slider.

**Financial logic worth preserving verbatim** (`financialagent.ts`): GeM transaction fees per the Sept 2024 slabs (0 ≤ ₹10 L; 0.30% to ₹10 Cr; flat ₹3,00,000 above), EMD/ePBG resolution with explicit-amount override before percentage fallback (`:122-142`), per-line GST, and the confidence/status aggregation.

---

## 11. Current mock / static data

| Source | Size | Consumed by | Migration target |
|---|---|---|---|
| `data/storeData.ts` | 1026 lines, ~20 SKUs | `App.tsx:11` (state seed), `server/index.ts:10` (parse fallback) | `inventory_items` + `warehouses` |
| `data/configData.ts` | 36 lines | `App.tsx:27` | `organizations` + `organization_profiles` + `signing_authorities` + `organization_discovery_settings` |
| `data/rfpData.ts` | 103 lines, 2 RFPs + 5 text blobs | `App.tsx:26` | `tenders` (demo seed only) |
| `src/constants.ts` | 91 lines | **nothing** | `vehicles` + logistics service; content needs rewriting for the real business |
| `schema.sql:62-63` | 1 INSERT | DB bootstrap | seeded org |
| `Header.tsx:60` | `"Ansh Pratap Singh"` | rendered as the logged-in operator | `profiles.full_name` |
| `index.ts:197-202` | commodity fallback array | market ticker | keep as fallback |
| `AddItemModal.tsx:18`, `StoreScreen.tsx:83` | Jalandhar lat/lon | new-SKU defaults | `warehouses` default |
| `vault_storage/` | 15 files | vault | Supabase Storage, org-prefixed |

`server/index.ts:420` — `inventory && inventory.length > 0 ? inventory : productInventory` — the **server** falls back to the demo catalogue when the client sends none. Under multi-tenancy this would silently qualify one org's tender against another company's stock. This line must go.

---

## 12. Current API endpoints

**None of these require authentication.**

| Method | Path | Handler | Auth | Tenant scope | Notes |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | `auth.ts:25` | — | — | Google OIDC verify; auto-registers |
| POST | `/api/auth/check-email` | `auth.ts:152` | ❌ | — | **user enumeration oracle** |
| POST | `/api/auth/send-otp` | `auth.ts:163` | ❌ | — | no rate limit; sends mail to any address |
| POST | `/api/auth/verify-otp` | `auth.ts:204` | ❌ | — | no attempt counter |
| POST | `/api/vault/setup-pin` | `auth.ts:62` | ❌ | — | **sets any user's PIN by email** |
| POST | `/api/vault/setup-2fa` | `auth.ts:137` | ❌ | — | **rotates any user's TOTP secret** |
| POST | `/api/vault/verify-2fa` | `auth.ts:224` | ❌ | — | no attempt counter |
| POST | `/api/vault/verify-pin` | `auth.ts:90` | ❌ | — | returns a fake token string |
| POST | `/api/convert-pdf` | `index.ts:111` | ❌ | — | **SSRF**: fetches any URL, uploads to ConvertAPI |
| GET | `/api/market-insights` | `index.ts:160` | ❌ | global cache | LLM-invented prices, 1 h TTL |
| POST | `/api/discover` | `index.ts:211` | ❌ | client-supplied inventory | launches Puppeteer |
| POST | `/api/vault/add-document` | `index.ts:239` | ❌ | none | multer disk write |
| GET | `/api/vault/documents` | `index.ts:260` | ❌ | none | all rows |
| POST | `/api/vault/upload` | `index.ts:275` | ❌ | none | updates **any** docId |
| GET | `/api/vault/view/:filename` | `index.ts:295` | ❌ | none | **path traversal** — `path.join` on raw param |
| GET | `/api/vault/download/:filename` | `index.ts:301` | ❌ | none | same |
| GET | `/api/compliance-check` | `index.ts:309` | ❌ | `LIMIT 1` | returns the one company |
| POST | `/api/update-config` | `index.ts:323` | shared password `TF-Admin-2026` | none | `UPDATE ...` **with no WHERE clause** |
| GET | `/api/inventory` | `index.ts:339` | ❌ | none | snake_case, unusable by the client |
| POST | `/api/inventory/update-stock` | `index.ts:348` | ❌ | none | **no try/catch** → unhandled rejection |
| POST | `/api/copilot-chat` | `index.ts:354` | ❌ | — | forwards arbitrary context to Groq |
| POST | `/api/fetch-rfp-url` | `index.ts:365` | ❌ | — | **SSRF** |
| POST | `/api/parse-rfp` | `index.ts:382` | ❌ | client inventory | Gemini + Groq in parallel |

---

## 13. Current database assumptions

1. **Exactly one company exists.** `company_profile` is seeded with one row and read with `LIMIT 1` (`index.ts:311`).
2. **`UPDATE company_profile SET ...` has no `WHERE`** (`index.ts:330`) — correct only because there is one row; under multi-tenancy it rewrites every organization.
3. **Global unique constraints on business data.** `product_inventory.sku_id`, `compliance_vault.cert_name` — two organizations cannot hold the same SKU code or the same certificate name.
4. **No foreign keys between business tables**, no `organization_id` anywhere, no `created_at`/`updated_at` on most tables.
5. **Schema is applied once, by existence check.** `initDb` (`index.ts:456`) runs `schema.sql` only if `company_profile` does not exist. There is **no migration mechanism** — schema changes to an existing database will never be applied.
6. **`signing_authorities` is written by no code path.** The UI edits them in React state only.
7. Files are stored on the **local filesystem** (`vault_storage/`), which does not survive a container restart and cannot be tenant-isolated by filename alone.
8. `pg.Pool` is created once with no SSL config, no connection limits, no timeouts.

---

## 14. Current single-user assumptions

| # | Assumption | Location |
|---|---|---|
| 1 | One company profile | `schema.sql:62`, `index.ts:311,330`, `configData.ts:4` |
| 2 | The operator is "Ansh Pratap Singh" | `Header.tsx:60` (hardcoded in JSX) |
| 3 | Inventory is global | `product_inventory` unique `sku_id`; `App.tsx:66` seeds from a file |
| 4 | Server falls back to the demo catalogue | `index.ts:420` |
| 5 | Compliance vault is global | `compliance_vault`, `GET /api/vault/documents` |
| 6 | Uploaded files share one flat directory | `index.ts:80-92` |
| 7 | Discovery filters are app-level | `configData.ts:28`, `DiscoveryScreen.tsx:24-28` |
| 8 | Auto-discovery is a global singleton | `App.tsx:54` module-level `let` |
| 9 | Market-insight cache is global | `index.ts:157` |
| 10 | Config writes are guarded by one shared password | `ConfigScreen.tsx:53`, `index.ts:325` |
| 11 | Signing authorities are app config | `configData.ts:14`, `types.ts:294` |
| 12 | No role concept exists anywhere | — |
| 13 | Session = a `localStorage` blob, no user id sent to the API | `App.tsx:100-113` |
| 14 | All warehouses are Punjab, all defaults are Jalandhar | `storeData.ts`, `AddItemModal.tsx:18` |
| 15 | Analysis output lives in React state, so it is per-browser-tab | `types.ts:252` |

---

## 15. Security concerns

### Critical
| # | Issue | Evidence |
|---|---|---|
| S1 | **Every API endpoint is unauthenticated.** No middleware, no token, no user context. | `server/index.ts` (all routes) |
| S2 | **Account takeover via `/api/vault/setup-pin`.** Accepts `{email, pin}` with no proof of identity and overwrites that account's PIN hash. | `auth.ts:62-87` |
| S3 | **2FA reset via `/api/vault/setup-2fa`.** Same — rotates any account's TOTP secret by email. | `auth.ts:137-149` |
| S4 | **Path traversal** in vault view/download. `path.join(vaultDir, req.params.filename)` with no normalisation check; `../` escapes the directory. | `index.ts:295-304` |
| S5 | **Hardcoded admin password `TF-Admin-2026`** shipped in the client bundle. | `ConfigScreen.tsx:53`, `index.ts:325` |
| S6 | **SSRF ×2** — `/api/fetch-rfp-url` and `/api/convert-pdf` fetch arbitrary attacker-supplied URLs from the server. | `index.ts:118`, `index.ts:365` |
| S7 | **Client-side authorization only.** `isAuthSessionActive` / `isVaultUnlocked` are React state; the APIs they "protect" are open. | `App.tsx:73,499` |
| S8 | **`.env` with live credentials is present in the working tree** — 2 Gemini keys, Groq key, Google OAuth **client secret**, Gmail app password, DB password, ConvertAPI secret, mail refresh token. It is gitignored, but it shipped inside this archive. | `.env` |

### High
| # | Issue |
|---|---|
| S9 | Session is a `localStorage` JSON blob; editing it in DevTools grants full access (`App.tsx:100`). |
| S10 | No rate limiting on OTP send, OTP verify, PIN verify, or 2FA verify — brute-force is unbounded. `failed_attempts`/`is_locked` columns exist but are **never written**. |
| S11 | User enumeration via `POST /api/auth/check-email` returning `{exists: bool}`. |
| S12 | `UPDATE company_profile` with no `WHERE` clause (`index.ts:330`). |
| S13 | `process.on('uncaughtException')` logs and continues (`index.ts:23`) — the process runs on in an undefined state. |
| S14 | `cors()` with no origin allowlist — any site can call the API from a user's browser. |
| S15 | Full DB query text logged on every call (`db.ts:15`); raw Gemini/Groq output and full parsed payloads logged. |
| S16 | Puppeteer `--ignore-certificate-errors` (`GeMWorker.ts:33`) disables TLS validation for the scrape. |
| S17 | No IDOR protection on `docId` (`/api/vault/upload`) or `skuId` (`/api/inventory/update-stock`). |
| S18 | No request body validation anywhere; `express.json({limit:"50mb"})` accepts 50 MB from anonymous clients. |
| S19 | Uploaded filenames are user-controlled (`Date.now() + '-' + file.originalname`), no MIME allowlist, no size cap. |

### Forward-looking (Supabase)
| # | Issue |
|---|---|
| S20 | `SUPABASE_SERVICE_ROLE_KEY` must never appear under `VITE_*`, in `src/`, or in any file Vite bundles. Vite inlines **every** `VITE_`-prefixed variable into client JS. |
| S21 | The service-role key **bypasses RLS**. Any server code holding it must scope every query by `organization_id` in code. Prefer forwarding the user's JWT so RLS applies. |
| S22 | Storage buckets must be private with org-prefixed object paths (`{org_id}/{doc_id}/{filename}`) and storage RLS policies. |

**Recommendation: rotate every credential in `.env` before this goes anywhere near production.**

---

## 16. Technical debt

**Dead code** — `src/constants.ts` (91 lines, unimported, stale domain), `GeMWorker.scrapeAdvanced` (89 lines, unreachable), `server/utils/agentLogger.ts`, `server/listModels.ts`, `signing_authorities` table, `gem_diagnosis.png` (425 KB), `data/rfpData.ts` unused blobs (`rfpDoc_PowerGrid_Cables`, `rfpDoc_NIC_Switches`, `rfpDoc_PortTrust_MCCB`, `rfpDoc_CPWD_Exterior`).

**Correctness** — random `matchScore` (`GeMWorker.ts:235`); `distance <= manualAvgKms` is a tautology (`:251`); Advanced Search scrapes the string `"ADVANCED_MODE"`; `Promise.all` on Gemini+Groq loses the Groq result when Gemini fails (`index.ts:403`); Groq's catch block drops `risk_entries` (`grok.ts:99`); `/api/inventory/update-stock` has no `try/catch`; `/api/market-insights` returns HTTP 200 with `success:false`.

**Architecture** — `App.tsx` at 567 lines owns nine concerns; `AnalysisScreen` at 898 lines; `server/index.ts` at 487 lines holds all 20 routes; `src/agents/*` executes server-side; `types.ts` at repo root shared by both tiers; three separate copies of the discovery fetch in `App.tsx`; `API_BASE` recomputed inline in ~10 places; no repository layer; `SKU` ↔ `product_inventory` shapes never reconciled.

**Types** — `any` at every seam (`analysisContext`, `agentOutputs.parsedData`, `scrapeAdvanced(params: any)`, `runFinancialAgent(filters: any)`); `(this.filters as any).bypassFilters` (`GeMWorker.ts:246`); `types.ts:300` declares `categories: [string]` (a 1-tuple) where an array is meant.

**Ops** — one `package.json` for two runtimes; `server/tsconfig.json` includes only `*.ts` so subfolders are type-checked only transitively; `headless:false` blocks server deployment; no tests of any kind; no `.env.example`; no migration tooling; 1.27 MB main bundle.

**Preserved-value list** (do not rewrite — extract behind interfaces): `financialagent.ts` GeM fee slabs + EMD/ePBG override logic; `technicalagent.ts` weighted 40/20/40 scoring with stock weighting; `extractJsonFromText` + `parseRFP`'s bracket-stack JSON repair; `extractATCSlice` 3-tier fallback; `normalizeParsedRfp`; the GeM DOM selector set; `filterFutureBids`; the Haversine function in `constants.ts`; the entire visual language.

---

## 17. Recommended migration sequence

The 25-step order in the brief is sound. Adjustments, with reasons:

| Step | Action | Change from brief |
|---|---|---|
| 1 | Codebase audit | ✔ this document |
| 2 | Build hygiene | Build and both typechecks are **already green** — so this step becomes: add `.env.example`, split `tsconfig`, remove dead files, add `npm run typecheck`. |
| 2.5 | **Fix the three discovery correctness bugs** (random score, tautological distance filter, Advanced Search wiring) | **inserted** — refactoring around known-wrong logic just relocates the bug |
| 3 | Frontend/backend structure: `src/app`, `src/features`, `src/services/api`, `server/routes`, `server/controllers`, `server/services` | move files, keep behaviour identical, build after each move |
| 4 | Supabase integration layer (`src/services/supabase/`, `server/db/supabase.ts`), env plumbing | **requires Supabase URL + keys from you** |
| 5 | Migration `001`: `profiles`, `organizations`, `organization_members`, `organization_modules`, `invitations` | |
| 6 | Supabase Auth alongside the existing Google flow | **run both in parallel**, do not cut over until 7-8 are green |
| 7 | `AuthContext` + `OrganizationContext`, active-org persistence | |
| 8 | RLS + helper functions + **positive/negative isolation tests** | gate: no further data migration until negative tests pass |
| 9 | Migration `002` (business tables) + backfill of company/profile/inventory/warehouses | |
| 10 | Tender + analysis persistence | |
| 11-15 | Discovery refactor: coordinator → adapter → GeM client/parser/normalizer → run persistence → dedup | |
| 16 | Qualification engine split into six independent scorers | preserve current numbers as the default scorer |
| 17 | `LogisticsService` — unify the three competing calculations, wire the existing Haversine | |
| 18-19 | Maps provider abstraction; real distance replaces the slider (slider becomes an override) | |
| 20-22 | Org onboarding, team management, module configuration | |
| 23-25 | Security audit, E2E, production readiness | |

**Blocking dependency:** steps 4 onward need `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), and `SUPABASE_SERVICE_ROLE_KEY`. Steps 2, 2.5 and 3 can proceed immediately without them.

---

## 18. Proposed Supabase schema

```sql
-- ─── enums ────────────────────────────────────────────────────────────────
create type org_role         as enum ('owner','admin','manager','member','viewer');
create type member_status    as enum ('invited','active','suspended');
create type discovery_status as enum ('queued','running','completed','partial','failed','cancelled');

-- ─── identity ─────────────────────────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  industry    text,
  logo_url    text,
  created_by  uuid references auth.users,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  role            org_role not null default 'member',
  status          member_status not null default 'active',
  invited_by      uuid references auth.users,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on organization_members (user_id);

create table organization_modules (
  organization_id uuid not null references organizations on delete cascade,
  module_key      text not null,   -- discovery|analysis|inventory|procurement|logistics|compliance|projects|analytics
  enabled         boolean not null default true,
  config          jsonb  not null default '{}',
  primary key (organization_id, module_key)
);

create table invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  email           text not null,
  role            org_role not null default 'member',
  token           text not null unique,
  invited_by      uuid references auth.users,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, email)
);

-- ─── org business profile (from configData.ts + company_profile) ──────────
create table organization_profiles (
  organization_id     uuid primary key references organizations on delete cascade,
  legal_name          text,
  address             text,
  gstin               text,
  pan                 text,
  domain              text,
  annual_turnover_cr  numeric,
  turnover_year       text,
  experience_years    integer,
  oem_status          text,
  updated_at          timestamptz not null default now()
);

create table signing_authorities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  name            text not null,
  designation     text,
  din             text,
  created_at      timestamptz not null default now()
);

-- ─── logistics assets ─────────────────────────────────────────────────────
create table warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  code            text not null,
  name            text,
  address         text, city text, state text, pincode text,
  latitude        double precision,
  longitude       double precision,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table vehicles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  truck_type      text not null,          -- MINI_TRUCK|LCV|MEDIUM_TRUCK|HEAVY_TRUCK
  label           text,
  capacity_tons   numeric,
  cost_per_km     numeric,
  fleet_count     integer default 0,
  unique (organization_id, truck_type)
);

-- ─── inventory (full SKU shape, no longer a subset) ───────────────────────
create table inventory_items (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations on delete cascade,
  sku_id                   text not null,
  product_name             text not null,
  product_category         text,
  product_sub_category     text,
  oem_brand                text,
  specification            jsonb not null default '{}',
  available_quantity       integer not null default 0,
  warehouse_id             uuid references warehouses on delete set null,
  truck_type               text,
  lead_time_days           integer,
  cost_price               numeric,
  unit_sales_price         numeric,
  bulk_sales_price         numeric,
  gst_rate                 numeric default 18,
  brokerage                numeric,
  min_margin_percent       numeric,
  is_active                boolean not null default true,
  is_custom_made_possible  boolean not null default false,
  is_compliance_ready      boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (organization_id, sku_id)          -- scoped, not global
);
create index on inventory_items (organization_id, product_category);

-- ─── compliance ───────────────────────────────────────────────────────────
create table compliance_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  cert_name       text not null,
  category        text,
  issued_date     date,
  expiry_date     date,
  is_valid        boolean not null default true,
  storage_path    text,                     -- Supabase Storage: {org_id}/{doc_id}/{file}
  uploaded_by     uuid references auth.users,
  created_at      timestamptz not null default now(),
  unique (organization_id, cert_name)        -- scoped, not global
);

-- ─── discovery + tenders ──────────────────────────────────────────────────
create table discovery_runs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations on delete cascade,
  portal             text not null,
  criteria           jsonb not null default '{}',
  status             discovery_status not null default 'queued',
  started_at         timestamptz,
  completed_at       timestamptz,
  total_found        integer not null default 0,
  total_normalized   integer not null default 0,
  total_duplicates   integer not null default 0,
  total_qualified    integer not null default 0,
  error_message      text,
  triggered_by       uuid references auth.users,
  created_at         timestamptz not null default now()
);
create index on discovery_runs (organization_id, created_at desc);

create table tenders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations on delete cascade,
  portal           text not null,
  external_id      text not null,
  title            text not null,
  description      text,
  buyer            text,
  category         text, subcategory text,
  location         text,
  latitude double precision, longitude double precision,
  published_at     timestamptz,
  closing_at       timestamptz,
  estimated_value  numeric,
  emd_amount       numeric,
  emd_required     boolean,
  tender_url       text,
  source_metadata  jsonb not null default '{}',
  first_seen_run   uuid references discovery_runs on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, portal, external_id)   -- ← deduplication identity
);
create index on tenders (organization_id, closing_at);

create table discovery_run_tenders (
  run_id     uuid not null references discovery_runs on delete cascade,
  tender_id  uuid not null references tenders on delete cascade,
  is_new     boolean not null default true,
  primary key (run_id, tender_id)
);

create table tender_qualifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations on delete cascade,
  tender_id        uuid not null references tenders on delete cascade,
  run_id           uuid references discovery_runs on delete set null,
  inventory_score  numeric, technical_score numeric, quantity_score numeric,
  compliance_score numeric, logistics_score numeric, commercial_score numeric,
  overall_score    numeric,
  is_qualified     boolean not null default false,
  breakdown        jsonb not null default '{}',   -- matched SKUs, gaps, distance, ETA, cost
  created_at       timestamptz not null default now(),
  unique (tender_id, run_id)
);

create table tender_analyses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations on delete cascade,
  tender_id          uuid references tenders on delete cascade,
  source             text,           -- URL|File
  source_ref         text,
  status             text,           -- Pending|Extracting|Parsing|Processing|Complete|Error
  parsed_data        jsonb, technical_analysis jsonb, pricing jsonb, risk_analysis jsonb,
  processing_seconds integer,
  created_by         uuid references auth.users,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  tender_id       uuid references tenders on delete set null,
  name            text not null,
  status          text,
  owner_id        uuid references auth.users,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create table organization_discovery_settings (
  organization_id      uuid primary key references organizations on delete cascade,
  default_portals      text[] not null default array['gem'],
  categories           text[] not null default '{}',
  manual_avg_kms       integer default 400,
  manual_rate_per_km   numeric default 55,
  allow_emd            boolean default true,
  min_match_threshold  integer default 20,
  delivery_type        text default 'Pan India',
  updated_at           timestamptz not null default now()
);
```

Plus a trigger on `auth.users` insert → create a `profiles` row, and an `updated_at` touch trigger applied to every table carrying that column.

---

## 19. Proposed RLS strategy

**Principle:** isolation is enforced by the database, never by a frontend filter or a server `WHERE` clause alone.

### Helper functions (SECURITY DEFINER — this is what prevents policy recursion on `organization_members`)
```sql
create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_org_role(org uuid, allowed org_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed)
  );
$$;
```
A plain `exists (select … from organization_members …)` written inline in a policy **on** `organization_members` re-triggers that policy and errors with infinite recursion. `SECURITY DEFINER` runs the lookup as the function owner, skipping RLS. Both are `stable` so the planner can cache within a statement.

### Uniform policy shape for every org-owned table
```sql
alter table inventory_items enable row level security;

create policy inventory_read on inventory_items
  for select using (public.is_org_member(organization_id));

create policy inventory_write on inventory_items
  for all
  using      (public.has_org_role(organization_id, array['owner','admin','manager']::org_role[]))
  with check (public.has_org_role(organization_id, array['owner','admin','manager']::org_role[]));
```
The `with check` clause is what stops a member of Org A from **writing** a row stamped `organization_id = OrgB`. A `using`-only policy blocks reads but not that insert.

### Per-table intent
| Table | select | insert / update / delete |
|---|---|---|
| `profiles` | own row + co-members | own row only |
| `organizations` | members | owner, admin |
| `organization_members` | members of the same org | owner, admin (last owner cannot be removed) |
| `organization_modules` | members | owner, admin |
| `invitations` | owner, admin | owner, admin |
| `organization_profiles`, `signing_authorities`, `organization_discovery_settings` | members | owner, admin |
| `inventory_items`, `warehouses`, `vehicles`, `compliance_documents`, `projects` | members | owner, admin, manager |
| `tenders`, `discovery_runs`, `tender_qualifications`, `tender_analyses` | members | owner, admin, manager (server writes via a scoped service client) |
| `discovery_run_tenders` | members, via the parent run's org | server only |
| Storage bucket `org-documents` | path prefix `{org_id}/…` must satisfy `is_org_member` | same |

### Service-role rule
`SUPABASE_SERVICE_ROLE_KEY` **bypasses RLS entirely**. Therefore:
- User-initiated reads/writes go through a per-request client carrying the caller's JWT, so RLS is the enforcement point.
- The service-role client is used **only** for background work (discovery runs, invitation acceptance) and every such query must carry an explicit `organization_id` predicate, plus a membership assertion before the write.
- The key is never referenced under a `VITE_` name, never imported from `src/`, and is asserted absent from `dist/` during the security-audit step.

### Test matrix (the gate for "multi-tenancy is done")
| Case | Expectation |
|---|---|
| User A (Org A) selects Org A inventory | rows returned |
| User A selects Org B inventory | **0 rows** |
| User A inserts a row with `organization_id = Org B` | **rejected by `with check`** |
| User A updates an Org B tender by id | **0 rows affected** |
| Viewer role attempts an inventory insert in their own org | **rejected** |
| Anonymous (anon key, no session) selects any business table | **0 rows** |
| Suspended member of Org A selects Org A data | **0 rows** |
| User A downloads a storage object under `orgB/...` | **denied** |

---

## 20. Proposed final directory structure

```
TenderFlow/
├── .env.example                    ← placeholders committed; .env never
├── package.json
├── tsconfig.base.json / tsconfig.app.json / tsconfig.server.json
│
├── shared/
│   └── types/                      ← the contract both tiers import (replaces root types.ts)
│       ├── tender.ts  inventory.ts  organization.ts  discovery.ts  logistics.ts  index.ts
│
├── supabase/
│   ├── migrations/
│   │   ├── 0001_identity.sql             (profiles, organizations, members, modules, invitations)
│   │   ├── 0002_business.sql             (org profiles, inventory, warehouses, vehicles, compliance)
│   │   ├── 0003_discovery.sql            (tenders, runs, qualifications, analyses)
│   │   ├── 0004_rls_helpers.sql          (is_org_member, has_org_role)
│   │   ├── 0005_rls_policies.sql
│   │   └── 0006_storage.sql
│   ├── seed/                             (migrated storeData / configData)
│   └── tests/rls.test.ts                 (the §19 matrix)
│
├── src/
│   ├── app/
│   │   ├── App.tsx                 ← shell only
│   │   ├── routes.tsx
│   │   └── providers/              (AuthProvider, OrganizationProvider, QueryProvider)
│   ├── components/
│   │   ├── ui/                     (Button, Card, Input, Badge, Modal — extracted from repeated Tailwind)
│   │   ├── layout/                 (Header, Nav, OrgSwitcher, ModuleGuard, RoleGuard)
│   │   └── common/
│   ├── features/
│   │   ├── auth/                   (SignInScreen, security OnboardingWizard, hooks)
│   │   ├── organization/           (onboarding wizard, members, invites, module config)
│   │   ├── dashboard/              (Frontpage)
│   │   ├── discovery/              (DiscoveryScreen, AdvancedSearchScreen, RunHistory)
│   │   ├── tenders/                (AnalysisScreen, FinalRecommendation, ProcessingScreen, RfpInput)
│   │   ├── inventory/              (StoreScreen, AddItemModal)
│   │   ├── procurement/  logistics/ (RouteMap)  compliance/ (VaultScreen)  projects/
│   │   ├── analytics/  settings/ (ConfigScreen)
│   │   └── system/                 (LogScreen, HelperBot)
│   ├── services/
│   │   ├── api/                    (client.ts, discoveryApi, tenderApi, inventoryApi, organizationApi)
│   │   ├── supabase/               (client.ts + repositories)
│   │   ├── maps/                   (MapProvider interface + implementation)
│   │   └── analytics/
│   ├── contexts/                   (AuthContext, OrganizationContext)
│   ├── hooks/                      (useAuth, useOrganization, useModule, usePermission, useDiscovery…)
│   ├── lib/authorization.ts        ← the ONE place role checks live
│   ├── types/  utils/  constants/
│   └── index.tsx
│
└── server/
    ├── app.ts                      ← express app assembly only
    ├── index.ts                    ← bootstrap + listen
    ├── config/env.ts               ← validated, fail-fast
    ├── routes/                     (auth, organizations, discovery, tenders, inventory, compliance, ai, maps)
    ├── controllers/
    ├── middleware/                 (requireAuth, requireOrgMember, requireRole, validate, errorHandler, rateLimit)
    ├── services/
    │   └── discovery/  qualification/  logistics/  ai/  documents/  maps/
    ├── discovery/
    │   ├── DiscoveryCoordinator.ts
    │   ├── portals/
    │   │   ├── PortalAdapter.ts            ← search / fetchTenderDetails / normalize
    │   │   ├── PortalRegistry.ts
    │   │   └── gem/  (GeMAdapter, GeMClient, GeMParser, GeMNormalizer, GeMSelectors, GeMTypes)
    │   ├── normalization/  deduplication/
    │   ├── qualification/  (InventoryMatcher, TechnicalQualifier, LogisticsQualifier,
    │   │                    ComplianceQualifier, CommercialQualifier, TenderQualifier)
    │   └── persistence/DiscoveryRepository.ts
    ├── repositories/               (Organization, Inventory, Tender, Discovery, Project, Warehouse, Vehicle)
    ├── db/                         (supabase.ts — anon + service clients, types.ts — generated)
    ├── auth/  logging/  utils/
    └── agents/                     ← technicalagent + financialagent MOVED here from src/
```

**Key moves:** `src/agents/*` → `server/agents/*` (they are server code); root `types.ts` → `shared/types/*`; the 20 inline routes in `server/index.ts` → `routes/` + `controllers/`; `GeMWorker`'s five responsibilities → `GeMClient` / `GeMParser` / `GeMNormalizer` / `InventoryMatcher` / `LogisticsQualifier`; every raw `fetch` in a component → `src/services/api/*`.

---

## Blocking input needed before Step 4

1. `SUPABASE_URL`
2. `SUPABASE_ANON_KEY` (publishable) — becomes `VITE_SUPABASE_PUBLISHABLE_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY` — server only
4. Whether migrations should be applied via the Supabase SQL editor (I generate `.sql` files you paste) or the Supabase CLI, if it is installed
5. Maps provider preference (Google Maps / Mapbox / OpenRouteService) — the abstraction is provider-agnostic, but the first implementation needs a choice

Steps 2, 2.5 and 3 need none of these and can start immediately.
