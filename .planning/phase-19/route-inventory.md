# Phase 19 — Route Inventory (BACKBONE-10 entry gate)

**Generated:** 2026-05-08
**Phase entry condition:** every Next.js route exporting non-GET handlers touching `api_keys | strategies | strategy_analytics | verification_requests | strategy_verifications | compute_jobs` MUST map to a `flow_type` in `KeySubmissionRequest` OR carry explicit `out of scope, rationale: <one-line reason>` (Pitfall 1 — 4th orphan path mitigation).

**Sentinel tables grepped:** api_keys, strategies, strategy_analytics, verification_requests, strategy_verifications, compute_jobs.

## Inventory

| Route file | Method | Touches | Disposition | Notes |
|------------|--------|---------|-------------|-------|
| `src/app/api/verify-strategy/route.ts` | POST | `verification_requests` (rate-limit count + UPDATE public_token L114-117) | flow_type=teaser | **Public unauthenticated**; CSRF + IP rate-limit |
| `src/app/api/verify-strategy/[id]/status/route.ts` | GET | `verification_requests` (SELECT only) | out of scope, rationale: read-only sibling — moves to VIEW-read in migration 107 shim step (d) | Public token-gated read |
| `src/app/api/keys/validate-and-encrypt/route.ts` | POST | `api_keys` (writes encrypted blob) | flow_type=onboard | `withAuth` user-scoped; validate-only step in onboard wizard |
| `src/app/api/strategies/finalize-wizard/route.ts` | POST | `strategies` + `api_keys` (last_sync_at via after()) | flow_type=onboard | finalize step; force-refresh permissions probe at L60-86 retained at thin-adapter layer |
| `src/app/api/keys/sync/route.ts` | POST | `compute_jobs` + `strategy_analytics` | flow_type=resync | retires legacy `after()` path; absorbs USE_COMPUTE_JOBS_QUEUE flag |
| `src/app/api/factsheet/[id]/pdf/route.ts` | GET | `strategies` + `strategy_analytics` (SELECT only) | out of scope, rationale: read-only PDF generation; consumes `strategy_verifications` via VIEW only — no /process-key write call (Open Question 2 resolution) | cron + public IP rate-limit; bypass via x-internal-token |
| `src/app/api/strategies/csv-validate/route.ts` | POST | (no DB write — validate-only) | flow_type=csv | Phase 15 ships; Phase 19 absorbs into `IngestionAdapter.validate` |
| `src/app/api/strategies/csv-finalize/route.ts` | POST | `strategies` + `strategy_verifications` (via finalize_csv_strategy RPC) | flow_type=csv | Phase 15 already at `strategy_verifications.status='validated'` |
| `src/app/api/strategies/draft/route.ts` | GET | `strategies` (draft step — GET-only sibling) | out of scope, rationale: pre-validation wizard step 1 — not a key submission; route exports only GET (verified line 27 `export const GET = withAuth(...)`) | Wizard step 1; documented for inventory completeness |
| `src/app/api/strategies/draft/[id]/route.ts` | DELETE | `strategies` (draft delete cascades to api_keys + strategy_analytics + trades) | out of scope, rationale: user-initiated "Delete draft" from wizard — not a key submission; route exports GET (line 42) + DELETE (line 81), no PATCH | Same |
| `src/app/api/strategies/create-with-key/route.ts` | POST | `strategies` + `api_keys` (legacy create-with-key) | out of scope, rationale: deprecated pre-wizard legacy path; slated for removal post-Phase 19 cleanup PR | Document explicit deprecation |
| `src/app/api/portfolio-strategies/alias/route.ts` | PATCH | `portfolio_strategies` (alias write) | out of scope, rationale: allocator-side alias on `portfolio_strategies` (not in the 6 sentinel tables); route exports only PATCH (verified line 30 `export async function PATCH(...)`) | Allocator-side |
| `src/app/api/cron/reconcile-strategies/route.ts` | GET | `compute_jobs` (enqueue reconcile) | out of scope, rationale: cron-driven reconcile not user-driven submission | Cron path |
| `src/app/api/keys/[id]/permissions/route.ts` | GET | `api_keys` (probe via Vercel cache) | out of scope, rationale: server-to-server internal probe — not user submission; GET-only per route file line 97 (`export const GET = withAuth(...)`) | Internal probe only — corrected per C-6 |

## Theme 6 / Pitfall 1 Compliance

Every non-GET route above carries either `flow_type=...` (5 unification targets — verify-strategy/route.ts, keys/validate-and-encrypt, strategies/finalize-wizard, keys/sync, csv-validate, csv-finalize all map to `teaser|onboard|csv|resync`) or `out of scope, rationale: ...` (5 explicit refusals). The plan-checker grep at Phase 19 entry asserts: every row matches `(flow_type=(teaser|onboard|internal_report|csv|resync))|out of scope, rationale: .{10,}`.

## Method-Label Parity (C-6 fix)

`scripts/check-route-inventory.sh` additionally cross-checks each inventory row's Method column against the actual `export (const|async function) METHOD` declarations in the corresponding route file. A row labeled `POST` whose route file only exports `GET` is a CI failure. This catches the original C-6 finding where `keys/[id]/permissions` was misclassified as POST.

## CI Guard

`scripts/check-route-inventory.sh` runs on every commit touching `src/app/api/**/route.ts` and rejects if a non-GET route exists in the codebase that does NOT appear in this inventory.
