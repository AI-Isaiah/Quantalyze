# Codebase Concerns

**Analysis Date:** 2026-04-17

**Sources cross-referenced:**
- `audit/tech-debt-round-1.md` (round-1 audit, 32 findings)
- Current codebase state (many audit items have since shipped fixes — this document reflects what remains as of v0.13.1.0)
- `TODOS.md`, `CHANGELOG.md`, `docs/runbooks/vercel-cron-upgrade.md`
- Git log (`fix:`, hotfix, revert patterns)
- `.github/workflows/ci.yml` + `.github/workflows/nightly.yml`
- TODO/FIXME/HACK grep across `src/`, `analytics-service/`, `supabase/migrations/`

---

## Tech Debt

### Legacy email-based admin gate still coexists with `profiles.is_admin` (MEDIUM-08)
- **Severity:** medium
- **Category:** debt
- **Issue:** `src/proxy.ts` admin route protection only checks the `ADMIN_EMAIL` env fallback via `isAdmin(email)`. The canonical `isAdminUser()` in `src/lib/admin.ts` checks both legacy email AND `profiles.is_admin` column. A DB-only admin (no matching email) passes the DAL-layer `withAdminAuth`/`withRole("admin")` check but is redirected by the proxy before reaching the admin page.
- **Files:** `src/lib/admin.ts:13-16`, `src/proxy.ts:71-82`
- **Impact:** Not a correctness bug today (single founder admin), becomes an incident the moment a second admin is added. Also accumulated design debt — the RBAC shipped in Sprint 6 (`user_app_roles` table) should eventually obsolete the `is_admin` column entirely.
- **Fix approach:** Add a JWT custom claim via Supabase Auth hook that mirrors `profiles.is_admin` (or checks `user_app_roles`), read it in the proxy. Alternatively, cache `is_admin` in a cookie on successful `isAdminUser` call. Track with an ADR before a second admin is provisioned.

### Dead `freshnesScore` typo reference persists (MEDIUM-12 — still present)
- **Severity:** low
- **Category:** debt
- **Issue:** Function `freshnesScore` (missing 's') in `src/lib/health-score.ts:26` has been renamed to `freshnessScore` but the rename has only partially landed — recent verification shows `freshnessScore` in the file, so this may already be closed. Confirm with a grep pass on next /simplify.
- **Files:** `src/lib/health-score.ts:26,80`
- **Impact:** Greppability — callers searching `freshnessScore` will not find any old references.
- **Fix approach:** Regex confirm no `freshnesScore` (single 's') remains anywhere. Closes round-1 audit MEDIUM-12.

### Two `useStrategySyncPoller` implementations drift (Sprint 1 follow-up)
- **Severity:** low
- **Category:** debt
- **Issue:** Both `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` and `src/components/strategy/SyncProgress.tsx` implement the same 3-second `strategy_analytics` polling pattern inline, rather than extracting a shared hook.
- **Files:** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (~485 LoC), `src/components/strategy/SyncProgress.tsx`
- **Impact:** Next change to polling behavior must be made in two places; drift risk.
- **Fix approach:** Extract `src/hooks/useStrategySyncPoller(strategyId): {state, progress}` hook; both callers consume. Listed as a chore follow-up in `TODOS.md`.

### `withAuth` does not forward dynamic-route context (Sprint 1 follow-up)
- **Severity:** low
- **Category:** debt
- **Issue:** `/api/strategies/draft/[id]/route.ts` and 8+ other dynamic routes inline the same `getAuthedUserIdOrError` helper because `withAuth` in `src/lib/api/withAuth.ts` does not forward Next 16 `params`. Each route pays a 15-line boilerplate tax.
- **Files:** `src/lib/api/withAuth.ts`, dynamic routes under `src/app/api/**/[id]/route.ts`
- **Impact:** Boilerplate duplication; new dynamic routes repeat the pattern.
- **Fix approach:** Extend `withAuth` to accept and thread a `context: { params: Promise<{id: string}> }` second argument. Eliminate the inline helper in dynamic routes. Pattern already exists in `withRole` from Sprint 6 Task 7.2 — copy that contract.

### Legacy `StrategyForm` flow has not been retired post-wizard (Sprint 1 follow-up)
- **Severity:** low
- **Category:** debt
- **Issue:** `/strategies/[id]/edit` route still hosts the pre-wizard `StrategyForm`. The wizard (`/strategies/new/wizard`) is the canonical net-new entry point since v0.6.0.0 but the legacy form lingers, inviting drift between two strategy-creation paths.
- **Files:** `src/components/strategy/StrategyForm.tsx`, `/strategies/[id]/edit` page
- **Impact:** Two code paths for strategy creation/edit; bug fixes in the wizard don't propagate to the legacy form.
- **Fix approach:** After one full sprint of wizard-only net-new strategies, delete `StrategyForm.tsx` and the `/strategies/[id]/edit` page or refactor edit to a read-only summary + per-field RPC edit. Tracked in `TODOS.md` Sprint 3 follow-ups.

### God files still exceed 500 LoC (partial MEDIUM-01, MEDIUM-02)
- **Severity:** medium
- **Category:** debt
- **Issue:** `MyAllocationClient.tsx` was cut from 1218 → 544 lines (big improvement), but several files still exceed the 500-LoC threshold that predicts review burden and merge conflicts:
  - `src/components/admin/AllocatorMatchQueue.tsx` — 754 lines (from 1028; partial extract done)
  - `src/components/strategy/StrategyFilters.tsx` — 684 lines
  - `src/lib/queries.ts` — 705 lines (grew since audit)
  - `src/lib/types.ts` — 626 lines
  - `src/components/portfolio/PortfolioImpactPanel.tsx` — 624 lines
  - `src/lib/email.ts` — 601 lines
  - `src/app/security/page.tsx` — 582 lines
  - `analytics-service/services/job_worker.py` — 1188 lines
  - `analytics-service/services/match_engine.py` — 742 lines
- **Files:** above
- **Impact:** Cognitive load, merge conflict risk, reviewer fatigue. `job_worker.py` at 1188 lines is the most concerning since it hosts the hot-path dispatcher for every compute job kind.
- **Fix approach:** Continue the incremental extraction pattern already applied to `MyAllocationClient.tsx`. Top priority: extract per-kind handlers out of `job_worker.py` into `services/job_handlers/*.py`; extract `StrategyFilters` sub-components; break `queries.ts` by domain (portfolio, strategy, match).

### 24 `as unknown as` double-casts remain (MEDIUM-03 — partial)
- **Severity:** medium
- **Category:** debt
- **Issue:** Down from 34 but still 24 double-casts across 5 files (`src/lib/queries.ts`, `src/lib/admin/match.ts`, `src/components/**`, PDF routes). The `Buffer.from(pdfBuffer) as unknown as BodyInit` pattern is repeated across 4 PDF routes.
- **Files:** `src/lib/queries.ts:112,632+`, `src/lib/admin/match.ts`, `src/app/api/alert-digest/route.ts:50`, `src/app/api/**/pdf/route.ts` (4 files)
- **Impact:** Each cast is a type-system blind spot. When the DB schema changes, TypeScript won't catch the drift.
- **Fix approach:** Create `src/lib/supabase/types.ts` with `castEmbedRow<T>(raw)`, `castEmbedArray<T>(raw)`, `toBodyInit(buffer)` helpers. Replace the 24 sites incrementally.

### Route test coverage is 13/56 API routes (MEDIUM-05 — partial)
- **Severity:** medium
- **Category:** debt
- **Issue:** Only 13 of 56 API route files have `route.test.ts` siblings. Cross-user-write routes (`/api/trades/upload`, `/api/portfolio-strategies/alias`, `/api/portfolio-documents`, `/api/portfolio-optimizer`, `/api/intro`, every `/api/admin/match/*` route) have some tests but remain under-covered relative to their blast radius.
- **Files:** `src/app/api/**/route.ts` vs `src/app/api/**/route.test.ts`
- **Impact:** Refactors land without regression pinning; auth/CSRF retrofits have to rely on grep, not tests.
- **Fix approach:** Use `src/app/api/account/deletion-request/route.test.ts` as the template (most complete). Prioritize admin routes and any route using the service-role client. One test per route: auth-deny path + happy path + one validation-reject path.

### README migration instructions stale (MEDIUM-06)
- **Severity:** low
- **Category:** debt
- **Issue:** README references migrations up to 014; project is on migration 058. Any new dev copying the setup instructions runs 14 of 58 migrations and hits PGRST205 errors across the app.
- **Files:** `README.md:23-36`
- **Impact:** Onboarding friction — not seen often (solo dev) but guaranteed to bite the first outside contributor.
- **Fix approach:** Replace migration-by-number callouts with "run all files in `supabase/migrations/` in numeric order." Keep the `app.admin_email` pre-migration step since it genuinely needs to run before 011.

### Signup minLength still 6 chars (MEDIUM-10)
- **Severity:** medium
- **Category:** debt
- **Issue:** `src/components/auth/SignupForm.tsx:73` still has `minLength={6}`. HTML minLength is a client-only hint; server-side enforcement lives in the Supabase dashboard which is not visible in the repo.
- **Files:** `src/components/auth/SignupForm.tsx:73`
- **Impact:** Weak credentials for an "institutional" audience. Credibility hit in any security questionnaire from a partner allocator.
- **Fix approach:** Bump to `minLength={12}`. Enable Supabase dashboard password policy (min 12, require mixed case + number). One-line code change plus an external Supabase config step.

### `CsvUpload` reads the file twice (MEDIUM-11)
- **Severity:** low
- **Category:** debt
- **Issue:** `handleFileSelect` uses `FileReader` for preview then `handleUpload` calls `await file.text()` again — 10MB CSVs land in memory twice, and the preview/submit contents can drift if the user swaps the file between preview and upload.
- **Files:** `src/components/strategy/CsvUpload.tsx:75-103, 111-114`
- **Impact:** Minor memory footgun + potential correctness gap if file state desyncs.
- **Fix approach:** Store parsed rows from FileReader `onload` into component state; reuse in `handleUpload`. Drop the `file.text()` re-read.

### Native `alert()` / `confirm()` calls in admin UI (LOW-03, LOW-04, LOW-05)
- **Severity:** low
- **Category:** debt
- **Issue:** Admin UI uses browser-native prompts for destructive actions and errors:
  - `src/components/admin/AllocatorMatchQueue.tsx:235,240,263` — `alert()` for recompute errors
  - `src/components/admin/MatchQueueIndex.tsx:211` — `confirm()` for kill-switch toggle
  - `src/components/admin/PreferencesPanel.tsx:66,136` — `confirm()` wrapped in 100ms setTimeout with ref machinery to handle unmount
  - `src/components/admin/DeletionRequestActions.tsx:41` — `window.confirm()` for GDPR deletion approval
- **Files:** above
- **Impact:** Inconsistent UX — the rest of the app has toast/inline error patterns. Kill-switch flip (P0 admin action) deserves a proper modal rendering current state.
- **Fix approach:** Replace with existing `Modal` component or add a toast primitive. For PreferencesPanel, removing `confirm()` lets the setTimeout/ref dance evaporate.

### Inline SVG icons scattered across pages (LOW-07)
- **Severity:** low
- **Category:** debt
- **Issue:** Same `<svg>` paths (checkmark, spinner, alert, pencil) duplicated across `src/app/page.tsx:74-130`, `src/app/(dashboard)/portfolios/[id]/page.tsx:115-135`, `src/components/admin/AllocatorMatchQueue.tsx`, `src/app/(dashboard)/allocations/MyAllocationClient.tsx:715-727`. No `src/components/ui/icons/` directory exists.
- **Files:** above
- **Impact:** Inconsistent visual language; SVG tweak must be done in multiple files.
- **Fix approach:** Create `src/components/ui/icons/` with typed `CheckCircle`, `Spinner`, `Pencil`, `Warning`, `Info`. Replace inline usages opportunistically during unrelated PRs (not a single big PR).

### `extractAnalytics` / `EMPTY_ANALYTICS` re-exported from two paths (LOW-06)
- **Severity:** low
- **Category:** debt
- **Issue:** `src/lib/utils.ts:73-106` defines the canonical helpers; `src/lib/queries.ts:151` re-exports them. Some callers import from `@/lib/utils`, others from `@/lib/queries`. Two import paths for the same symbol.
- **Files:** `src/lib/utils.ts`, `src/lib/queries.ts:151`
- **Impact:** Refactor friction; a rename must be done in both places.
- **Fix approach:** Pick one canonical location (keep in `utils.ts`), delete the re-export from `queries.ts`, update all `queries` importers.

### `STRATEGY_PALETTE` undocumented for colorblind / WCAG AA (LOW-08, also in `TODOS.md`)
- **Severity:** low
- **Category:** debt
- **Issue:** `src/lib/utils.ts:45-48` defines an 8-color palette with no documentation about colorblind-safety or contrast ratios. With multi-line YTD charts on My Allocation, palette quality is now visible to users.
- **Files:** `src/lib/utils.ts:45-48`, `TODOS.md:28-33`
- **Impact:** Accessibility and design-system rigor. Currently unverified.
- **Fix approach:** Document palette origin and add a vitest test asserting minimum WCAG AA contrast against `#FFFFFF` via a small pure-JS helper. Actual palette swap is a design-review concern.

### `src/app/global-error.tsx` + `src/app/error.tsx` have Sentry wiring TODOs
- **Severity:** low
- **Category:** debt
- **Issue:** Both error boundaries `console.error` and leave a `// TODO: wire Sentry.captureException(error) once observability is set up` comment. Meanwhile `src/instrumentation.ts` already wires Sentry via `onRequestError` when `SENTRY_DSN` is set.
- **Files:** `src/app/error.tsx:20`, `src/app/global-error.tsx:19`, `src/instrumentation.ts:12-32`
- **Impact:** Client-side error boundaries skip the observability pipeline. Server-component and API errors are captured via `onRequestError`; client-render crashes are not.
- **Fix approach:** Import `@sentry/nextjs` client SDK in the error boundaries, call `Sentry.captureException(error, {tags: {boundary: "global"}})` alongside the console.error. Close the TODO.

---

## Bugs

### `handleSync` in `AllocatorExchangeManager` was a no-op; now hidden but not fixed (HIGH-09)
- **Severity:** high
- **Category:** bug
- **Issue:** The "Sync now" button previously updated `api_keys.last_sync_at = now()` from the browser client with no actual sync. A `NOTE` block in `src/components/exchanges/AllocatorExchangeManager.tsx:163-167` now explicitly acknowledges the issue and says the button is "disabled until a backend endpoint exists" — but the UI still suggests sync is happening in the surrounding text ("Active Allocation auto-synced"). The allocator-facing sync pathway is still a placeholder.
- **Files:** `src/components/exchanges/AllocatorExchangeManager.tsx:163-167` and downstream
- **Impact:** First real customer clicking the button sees nothing happen. UX lies about data freshness. Also the core value prop ("exchange-verified data") depends on real sync.
- **Fix approach:** Wire `/api/keys/sync` for the allocator flow, or add a new `/api/exchanges/sync` route that takes `{api_key_id}`, does ownership + key-active check, then enqueues a `sync_trades` compute_job. Until then, rename button or add a visible "manual refresh coming soon" chip.

### Wizard draft cleanup cron missing (Sprint 1 follow-up)
- **Severity:** medium
- **Category:** bug
- **Issue:** Wizard drafts (`strategies.source = 'wizard' AND status = 'draft'`) accumulate indefinitely. There is no cron that deletes stale drafts, and the companion `api_keys` rows they reference are orphaned when the user abandons the flow.
- **Files:** Not implemented — missing cron
- **Impact:** DB bloat; orphaned API keys continue to carry encrypted secrets. Security-sensitive because leaked drafts may reference real read-only keys.
- **Fix approach:** Add a daily cron (`/api/cron/cleanup-wizard-drafts`) that runs a single atomic `DELETE FROM strategies WHERE source = 'wizard' AND status = 'draft' AND created_at < now() - interval '24 hours'` (Postgres READ COMMITTED handles the race with concurrent finalize). Sweep orphaned `api_keys` in the same run. Note: the Hobby cron cap (2/day max) means this must either go on the Python worker via `analytics-service/main_worker.py`, consolidate with an existing cron, or wait for the Pro upgrade.

### Strategy sync failure has no checkpointing (Sprint 1 follow-up)
- **Severity:** medium
- **Category:** bug
- **Issue:** If `fetchTrades` succeeds but `computeAnalytics` fails, the current retry re-fetches trades from scratch. There is no `last_fetched_trade_timestamp` column to resume from.
- **Files:** `analytics-service/services/job_worker.py` (sync_trades handler)
- **Impact:** Every retry hammers the exchange API again — slow, wastes rate-limit budget, and on OKX/Binance can trigger weight limits.
- **Fix approach:** Add a `strategies.last_fetched_trade_timestamp` column (migration 059); persist on successful fetch; `sync_trades` handler reads it and passes as the `since` parameter to CCXT. Tracked in `TODOS.md` Sprint 3 follow-ups.

---

## Security

### Only 2 cron routes + 4 demo/factsheet/pdf routes sit in `PUBLIC_ROUTES`; CSRF retrofit is NOT complete to every mutating route
- **Severity:** medium
- **Category:** security
- **Issue:** `assertSameOrigin` from `src/lib/csrf.ts` is now used by 33 files (major progress since round-1 audit HIGH-01). But there is no CI gate that fails a PR if a new mutating route ships without it. A future regression is not detectable at review time.
- **Files:** `src/lib/csrf.ts`, every `src/app/api/**/route.ts` with a non-GET export
- **Impact:** Next new mutation route can silently skip CSRF. The existing pattern is uneven — some routes use `withAuth` + inline `assertSameOrigin`, some use neither.
- **Fix approach:** Add a CI grep gate that fails if any file under `src/app/api/**/route.ts` with a non-GET export does not reference `assertSameOrigin`. Maintain an allowlist for the handful of intentional exceptions (public lead-capture). Alternatively, create a `withCsrf(handler)` wrapper that composes with `withAuth`/`withRole` and enforces the check by construction.

### `npm audit` still gates at `--audit-level=critical` only (partial MEDIUM-13)
- **Severity:** medium
- **Category:** security
- **Issue:** `.github/workflows/ci.yml:26` runs `npm audit --audit-level=critical`. Down from `|| true` (which never failed) but still skips high-severity CVEs. Given the banned-packages list (axios et al.), a `high` bar is defensible.
- **Files:** `.github/workflows/ci.yml:26`
- **Impact:** High-severity dep vulns ship without blocking CI.
- **Fix approach:** Tighten to `--audit-level=high` and accept the signal-to-noise tradeoff. Add Dependabot or Renovate weekly runs to keep dep versions fresh. The banned-packages CI check (line 23) complements `npm audit` and handles the supply-chain attack class that `npm audit` typically misses.

### Wide-open RLS `USING (true)` on 4+ tables
- **Severity:** medium
- **Category:** security
- **Issue:** Several tables expose all rows to all authenticated (and in some cases anonymous) callers via `USING (true)` SELECT policies:
  - `profiles` (migration 002 line 14) — PII columns then REVOKEd column-level via migration 017
  - `discovery_categories` (002 line 25) — OK, reference data
  - `decks`, `deck_strategies` (005 lines 20-21) — public by design
  - `compute_jobs` with `USING (true)` SELECT (032 line 249) for authenticated users — leaks job metadata cross-tenant
  - `compute_job_kinds` (032 line 249) — reference table, OK
- **Files:** `supabase/migrations/002_rls_policies.sql`, `supabase/migrations/032_compute_jobs_queue.sql:240-252`
- **Impact:** `compute_jobs` wide-open SELECT means allocator A can see job rows for allocator B's strategies (kind, status, timestamps, error messages). Not catastrophic (no PII) but a minor info-leak.
- **Fix approach:** Tighten `compute_jobs` SELECT to `USING (auth.uid() = (SELECT user_id FROM strategies WHERE id = strategy_id))` or similar. Keep `compute_job_kinds` wide-open (it's a tiny reference table).

### Service-role client used in 30+ files; no CI gate that `server-only` import is present
- **Severity:** medium
- **Category:** security
- **Issue:** `src/lib/supabase/admin.ts:1` correctly has `import "server-only"`. But there is no CI grep that fails when any other file reads `SUPABASE_SERVICE_ROLE_KEY` or calls `createAdminClient()` without also importing `server-only`. Supporting files like `src/lib/api/withAdminAuth.ts` and `src/lib/admin/match.ts` are closer to the danger zone.
- **Files:** 30+ files grep `createAdminClient`
- **Impact:** A future client-component import of admin.ts would be caught at build time by Next (because the service-role key is not `NEXT_PUBLIC_`), but only for static import chains. Dynamic imports could defeat it.
- **Fix approach:** Add a CI grep gate: `grep -L 'server-only' $(grep -l 'createAdminClient\|SUPABASE_SERVICE_ROLE_KEY' src/)` must return empty. Extend the same gate to `src/lib/api/withAdminAuth.ts` and `src/lib/admin/match.ts`.

### PII CASCADE on `investor_attestations` + `profiles` deletion
- **Severity:** medium
- **Category:** security
- **Issue:** Migration 012 line 120 declares `investor_attestations.user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE`. The comment explicitly flags this: if an automatic deletion flow ships (Sprint 7+), the CASCADE will erase the compliance audit trail (date + version + IP) alongside the user. Sprint 6 Task 7.3 shipped `sanitize_user()` (anonymize-not-delete), which sidesteps the CASCADE — but only if the deletion path always routes through `sanitize_user`. A raw `DELETE FROM profiles` still triggers the CASCADE.
- **Files:** `supabase/migrations/012_disclosure_and_tenancy.sql:118-124`
- **Impact:** Compliance audit trail can be destroyed by a direct `DELETE FROM profiles` bypassing the GDPR workflow.
- **Fix approach:** Either change the CASCADE to `ON DELETE RESTRICT` (forcing the GDPR workflow to be the only deletion path) or add an `investor_attestations_archive` table that receives the row via trigger before the CASCADE fires. Tracked as P1 in `TODOS.md`.

### `security.txt` expires 2027-04-10
- **Severity:** low
- **Category:** security
- **Issue:** `public/.well-known/security.txt` has `Expires: 2027-04-10T00:00:00.000Z` — a year out from today (2026-04-17). Not an immediate concern but worth a calendar reminder so the contact policy doesn't go stale.
- **Files:** `public/.well-known/security.txt:9`
- **Impact:** Once expired, security researchers may disregard the disclosure contact.
- **Fix approach:** Annual rotate. Add a 60-day-before-expiry check to the nightly workflow.

### `demo-screenshot.spec.ts` baselines are Linux-only and not committed
- **Severity:** low
- **Category:** security (process)
- **Issue:** `.github/workflows/ci.yml:94-101` — the spec is intentionally excluded from CI because chromium-linux baselines are not committed. Means visual regressions in the demo dashboard go undetected in CI.
- **Files:** `.github/workflows/ci.yml:94-101`, `e2e/demo-screenshot.spec.ts`
- **Impact:** A CSS or rendering regression in `/demo` can ship to prod undetected.
- **Fix approach:** Generate baselines inside the Playwright Linux Docker image, commit alongside the spec, enable in CI. 15-minute task, blocks on one local playwright-in-docker run.

---

## Performance

### `src/lib/queries.ts` `getPercentiles` is O(metrics × n²) (LOW-01)
- **Severity:** low
- **Category:** performance
- **Issue:** For each of 7 metrics, for each strategy value, runs `values.filter(...).length` — that's 7n² comparisons. At 15 strategies (current marketplace) this is fine; at 200 strategies it's 280k comparisons per render.
- **Files:** `src/lib/queries.ts:119-144`
- **Impact:** Will become real at 10x marketplace size (~6-12 months at current growth rate).
- **Fix approach:** Sort `values` by `val` ascending once per metric, assign percentile = `((i + 1) / n) * 100`. Pure algorithmic cleanup, no interface change.

### `compute_jobs` watchdog timeouts are hardcoded per-kind
- **Severity:** low
- **Category:** performance
- **Issue:** `analytics-service/main_worker.py:71-76` hardcodes per-kind watchdog thresholds (`compute_analytics: 20 minutes`, `sync_trades: 10 minutes`, etc.). Thresholds are not tunable without a redeploy; no feedback loop from actual p95 job duration.
- **Files:** `analytics-service/main_worker.py:71-76`, `analytics-service/services/job_worker.py` (TIMEOUT_PER_KIND)
- **Impact:** A job kind that starts trending slower (more trades per strategy) will start timing out, or worse, running twice after the watchdog yanks the row.
- **Fix approach:** Instrument p95 job duration per-kind; emit via OpenTelemetry. Alert when p95 approaches the watchdog threshold. Long-term, move thresholds to a `compute_job_kinds.default_timeout` column and read dynamically.

### `alert-digest` fetches all pending alerts in one SELECT
- **Severity:** low
- **Category:** performance
- **Issue:** `src/app/api/alert-digest/route.ts:36-43` selects ALL `portfolio_alerts` where `acknowledged_at IS NULL AND emailed_at IS NULL`. At scale this could return thousands of rows in one query. The inner join on `portfolios!inner` helps but does not cap.
- **Files:** `src/app/api/alert-digest/route.ts:36-43`
- **Impact:** Vercel lambda memory pressure + slow cron run. Silent failure if the response exceeds the lambda's RAM cap.
- **Fix approach:** Add a `.limit(10_000)` guard + a TODO comment that once exceeded, migrate to pagination or move the digest to the Railway worker alongside the other Sprint 5 crons.

### PDF route `maxDuration = 30` vs Hobby-plan 10s ceiling
- **Severity:** medium
- **Category:** performance
- **Issue:** `src/app/api/portfolio-pdf/[id]/route.ts:14` sets `maxDuration = 30`. Vercel Hobby plan caps lambdas at 10 seconds; any `maxDuration` above 10 is silently ignored on Hobby and the function times out at 10s. Other PDF routes (`/api/factsheet/[id]/pdf`, `/api/factsheet/[id]/tearsheet.pdf`) have similar patterns.
- **Files:** `src/app/api/portfolio-pdf/[id]/route.ts:14`
- **Impact:** Puppeteer cold-starts routinely exceed 10s. On Hobby, PDFs fail with a 504 with no visible reason. The code says "30s is fine" but the plan says otherwise.
- **Fix approach:** Document the Hobby vs Pro gap in the PDF route files. Either upgrade to Pro (per `docs/runbooks/vercel-cron-upgrade.md`), move PDF generation to the Railway worker (consistent with the cron strategy), or accept that PDF generation fails on cold-start and add a warmup ping.

---

## Fragility

### Sprint 5/6 crons moved to Railway worker; Vercel routes kept as shims (process)
- **Severity:** medium
- **Category:** fragility
- **Issue:** Per `docs/runbooks/vercel-cron-upgrade.md`, the Hobby-plan 2-cron cap forced `sync-funding`, `reconcile-strategies`, `cleanup-ack-tokens` onto the Railway worker via `analytics-service/services/scheduled_tasks.py`. The Next.js routes at `src/app/api/cron/{sync-funding,reconcile-strategies,cleanup-ack-tokens}` still exist for manual incident-response curl. This creates two execution paths per cron.
- **Files:** `analytics-service/main_worker.py:42-47`, `analytics-service/services/scheduled_tasks.py`, `src/app/api/cron/*/route.ts`, `vercel.json`
- **Impact:** Diverging implementations possible — a fix landed in the Next.js route doesn't auto-apply to the Python loop. Also production was dark from Sprint 4 → 2026-04-17 because of the Hobby cap breach. The regression test `src/__tests__/vercel-cron-limits.test.ts` catches this going forward.
- **Fix approach:** Upgrade to Vercel Pro (per the runbook) and reconsolidate. Until then, leave a pointer comment in each of the three Next.js cron routes that says "schedule lives in analytics-service — see `scheduled_tasks.py`". Regression test is in place.

### Supabase types are not regenerated from schema
- **Severity:** medium
- **Category:** fragility
- **Issue:** 58 migrations but no visible `supabase gen types` workflow in `package.json` or `.github/workflows/`. Types in `src/lib/types.ts` (626 lines) are hand-maintained. The 24 `as unknown as` casts (see above) are downstream of this — the hand types don't match the generated shapes.
- **Files:** `src/lib/types.ts`, `supabase/migrations/*.sql`
- **Impact:** Column renames, type changes, and new tables silently skip type-checking. Each schema change is a hand-edit in `types.ts`.
- **Fix approach:** Add `npx supabase gen types typescript > src/lib/supabase/generated-types.ts` to a pre-commit or CI step; import generated types into `src/lib/types.ts` and build domain types on top. Tracked informally but no action item.

### Analytics-service has no contract tests with the Next.js layer
- **Severity:** medium
- **Category:** fragility
- **Issue:** The Python analytics service exposes 20+ endpoints (`routers/analytics.py`, `routers/portfolio.py`, `routers/match.py`, etc.) consumed by `src/lib/analytics-client.ts`. No OpenAPI / schema contract ensures request/response shapes match. Either side can change a field and the break surfaces as a runtime error in production.
- **Files:** `analytics-service/routers/*.py`, `src/lib/analytics-client.ts`
- **Impact:** Refactors on either side are load-bearing on human review. Typed shapes drift.
- **Fix approach:** Emit FastAPI's OpenAPI schema at build time; generate TypeScript types from it via `openapi-typescript`; fail CI if the generated types don't match the current hand-written ones. Quick win since FastAPI already produces OpenAPI automatically at `/openapi.json`.

### `audit-coverage.test.ts` grep-based coverage requires manual `@audit-skip` pragmas
- **Severity:** low
- **Category:** fragility
- **Issue:** Audit-coverage test scans routes via grep for `.insert()/.update()/.delete()` within 60 lines of `logAuditEvent`. When a mutation is legitimately skipped (e.g., bulk trade batch), it requires an inline `// @audit-skip:` pragma within 8 lines above the chain start. Grep rules are brittle: method chains broken across more than 8 lines, or mutations via helper functions, evade the scan.
- **Files:** `src/__tests__/audit-coverage.test.ts:120-240`
- **Impact:** A silent miss (mutation without audit, without pragma) is only caught by this test if the grep sees both. Real risk: someone writes `await supabase.from(X).update(Y)` split across 10+ lines and the test passes despite missing audit coverage.
- **Fix approach:** Replace the grep with an AST walk using `typescript`/`ts-morph` to find every `.update()/.insert()/.delete()` call and every `logAuditEvent` call, then do precise proximity analysis. Roughly 1 day of work; would also eliminate the `HELPER_MUTATORS` hardcoded list.

### Single founder admin — no break-glass / recovery plan visible
- **Severity:** medium
- **Category:** fragility
- **Issue:** `ADMIN_EMAIL` environment variable gates both the proxy and the DAL. If the founder's email changes, or the single admin account is locked out, there is no documented recovery path. Sprint 6 Task 7.2 shipped RBAC via `user_app_roles`, but the proxy still reads only `ADMIN_EMAIL`.
- **Files:** `src/lib/admin.ts:8`, `src/proxy.ts:3`
- **Impact:** SPOF on the human + env var. Revising `ADMIN_EMAIL` requires a redeploy.
- **Fix approach:** Add a second `ADMIN_EMAIL_BACKUP` env var or a DB-driven `break_glass_admins` table read at request time. Runbook: "what to do if founder is locked out" in `docs/runbooks/`.

---

## Dependencies at Risk

### Next.js 16.2 — recent release, breaking changes vs 15
- **Severity:** medium
- **Category:** fragility
- **Issue:** `package.json` pins `"next": "^16.2.3"`. `AGENTS.md` at the repo root warns "This is NOT the Next.js you know — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." Several recent commits are flagged as fix-ups for Next 16 async `params`, `middleware → proxy` rename, etc.
- **Files:** `package.json:25`, `AGENTS.md`
- **Impact:** Any Claude instance (including this one) that relies on training-data Next.js idioms will ship broken code. Pattern already established: migration from `middleware.ts` → `proxy.ts`, async `params`, `use cache` directive.
- **Fix approach:** Keep the `AGENTS.md` warning visible. Every Next-related task starts with reading `node_modules/next/dist/docs/` for the relevant area. Do not downgrade until Next 17 LTS.

### React 19 + nonstandard hooks
- **Severity:** low
- **Category:** fragility
- **Issue:** `package.json` pins `"react": "19.2.4"`. Tests use `react-hooks/incompatible-library` suppressions (see `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx:337`). React 19 compiler directive `"use no memo"` appears in `PositionsTable.tsx` to opt-out of auto-memoization.
- **Files:** `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx:271, 337`
- **Impact:** `use no memo` is a known escape hatch for the React Compiler; future React versions may phase it out or change behavior. `react-hooks/incompatible-library` suppressions hide real issues.
- **Fix approach:** Each `use no memo` / `eslint-disable react-hooks/incompatible-library` is a known-debt marker. Review quarterly; try to eliminate via component refactor.

### `@sparticuz/chromium` pinned to `^133.0.0` for Vercel lambdas
- **Severity:** low
- **Category:** fragility
- **Issue:** `@sparticuz/chromium@^133.0.0` provides the Chromium binary for serverless Puppeteer. Tied to a specific Chrome version; upgrading Puppeteer or Next.js runtime can break the integration.
- **Files:** `package.json:16`, `src/lib/puppeteer.ts`
- **Impact:** PDF generation silently breaks on lambda upgrade. Nightly probe (`.github/workflows/nightly.yml`) catches demo PDF but not allocator PDF.
- **Fix approach:** Extend the nightly probe to hit `/api/portfolio-pdf/[known-id]` with a signed token. Pin `@sparticuz/chromium` to a specific version (not `^`) and upgrade deliberately. Currently good — the nightly probe auto-files a GH issue on failure.

### `posthog-node@^5.29.2` + `posthog-js@^1.367.0` both loaded
- **Severity:** low
- **Category:** fragility
- **Issue:** Dual-layer PostHog (server + client). Neither side's API is locked (PostHog ships breaking minor versions). Missing env (`NEXT_PUBLIC_POSTHOG_KEY`) makes both silently no-op per `.env.example`.
- **Files:** `package.json:27-28`, `src/lib/analytics.ts`
- **Impact:** Two SDKs to track; any breaking release can silently drop instrumentation (because the SDK no-ops on missing env).
- **Fix approach:** Add an explicit log line when PostHog is configured but the event is dropped due to SDK error. Consider pinning exact versions if PostHog is funnel-critical.

### Banned-packages list: axios is not installed (verified)
- **Severity:** low (positive finding)
- **Category:** security
- **Issue:** Per global CLAUDE.md, `axios` is banned. `scripts/check-banned-packages.mjs` is wired into CI (`.github/workflows/ci.yml:22-23`). Grep of both `package.json` and `package-lock.json` returns zero axios references. This is healthy but worth verifying at each dep upgrade.
- **Files:** `scripts/check-banned-packages.mjs`, CI gate
- **Impact:** Positive — supply-chain attack surface closed for listed packages.
- **Fix approach:** None needed; the CI gate keeps this healthy. Ensure new entries in CLAUDE.md's banned-packages table are added to `scripts/check-banned-packages.mjs:26-48`.

---

## Test Coverage Gaps

### Python analytics service: `pytest --cov=services --cov-fail-under=80` — only services/ directory
- **Severity:** low
- **Category:** debt
- **Issue:** Coverage gate covers `services/` but not `routers/`. A bug in a router (e.g., request parsing, auth header handling) is not coverage-gated.
- **Files:** `.github/workflows/ci.yml:85`
- **Impact:** Router-layer bugs ship without coverage pressure.
- **Fix approach:** Extend to `--cov=services --cov=routers`. Likely drops total coverage 5-10% — carve time to bring it back to 80%.

### Playwright CI runs only 4 specs; full suite has 21
- **Severity:** medium
- **Category:** debt
- **Issue:** `.github/workflows/ci.yml:132` runs `auth, smoke, demo-public, demo-founder-view` only. Other specs (`match-queue`, `full-flow`, `api-key-flow`, `sync-flow-queue`, `wizard-sync-regression`, `admin-compute-jobs`, `strategy-detail-tabs`, `simulator-flow`, `bridge-flow`, `for-quants-onboarding`, `discovery`, `security-page`) are not run in CI because they require a seeded Supabase with test credentials that CI does not have.
- **Files:** `.github/workflows/ci.yml:87-102`
- **Impact:** End-to-end regressions ship undetected. Manual QA on demos pretends to cover this.
- **Fix approach:** Stand up a seeded CI Supabase (fresh project, migration-replay on every PR). Expand CI scope to all specs. Large effort (~1 day) but eliminates the "runs locally, broken in CI" gap.

### Live-DB tests skipped without `HAS_LIVE_DB`
- **Severity:** low
- **Category:** debt
- **Issue:** 40+ tests use `it.skipIf(!HAS_LIVE_DB)` — they only run when a real Supabase instance is reachable. In CI, this flag is never set, so these tests always skip. The tests that DO run (pure unit tests) cannot catch SECURITY DEFINER / RLS / trigger bugs.
- **Files:** `src/__tests__/audit-log-rls.test.ts`, `src/__tests__/sanitize-user.test.ts`, `src/__tests__/retention-crons.test.ts`, `src/__tests__/audit-log-cold-archive.test.ts`, `src/lib/sec-005-live-probe.test.ts`, `src/lib/migration-028-tenant-check.test.ts`, `src/__tests__/log-audit-event-service-rpc.test.ts`, `src/__tests__/user-app-roles-backfill.test.ts`, `src/__tests__/gdpr-export.test.ts`
- **Impact:** RLS, SECURITY DEFINER, and migration-correctness tests are shadow-banned in CI. A migration that breaks audit-log insert policy ships green.
- **Fix approach:** Same as above — stand up a seeded CI Supabase and set `HAS_LIVE_DB=true`. Until then, document explicitly in CI that these tests are opt-in.

### E2E `demo-screenshot` baselines missing
- **Severity:** low
- **Category:** debt
- **Issue:** See Security section above. Spec is excluded from CI because chromium-linux baselines are not committed.
- **Files:** `e2e/demo-screenshot.spec.ts`, `.github/workflows/ci.yml:94-101`
- **Impact:** Visual regressions in `/demo` (the founder's hero demo surface) ship undetected.
- **Fix approach:** Generate baselines in a Playwright Linux Docker container, commit, enable in CI.

---

## Missing Critical Features

### No ISR / cache layer for `/demo`
- **Severity:** low
- **Category:** debt
- **Issue:** `src/app/demo/page.tsx` is `force-dynamic`. At 100x scale (1000 req/min) the Supabase admin client becomes a bottleneck. Noted in `docs/superpowers/plans/2026-04-09-portfolio-management-demo-hero.md:637` as a FLAG for TODOS.
- **Files:** `src/app/demo/page.tsx`
- **Impact:** Performance ceiling on the demo surface. Not urgent until the demo hits sustained traffic.
- **Fix approach:** Layer Next.js `'use cache'` or `unstable_cache` on the demo data fetch with a short TTL (5-60 minutes). Bypass on founder-view query param.

### Allocator intent capture + founder triage (Sprint 3 follow-up)
- **Severity:** medium (business-critical, not code)
- **Category:** missing feature
- **Issue:** `TODOS.md` Sprint 3 follow-ups call out: "All 3 CEO voices flagged demand-side as the bigger risk. Ship an allocator-facing mandate-capture flow so the wizard-sourced supply has somewhere to land." No such surface exists today.
- **Files:** N/A (not yet built)
- **Impact:** Wizard-generated strategies have no allocator demand pipeline. Business risk more than code risk.
- **Fix approach:** Out of scope for this document; tracked in `TODOS.md`.

### Key-permission viewer deferred from Sprint 5
- **Severity:** low
- **Category:** missing feature
- **Issue:** `TODOS.md` flags that all 3 CEO voices wanted the wizard to show detected scopes returned by the exchange ("Read ✓ Trade ✗ Withdraw ✗") before accepting the key. Currently inferred from a read-only check.
- **Files:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKey.tsx`, `analytics-service/services/key_permissions.py`
- **Impact:** Trust UX; no real downside today.
- **Fix approach:** Use the existing `analytics-service/services/key_permissions.py` logic to return the detected scopes to the wizard UI.

---

## Patterns to Watch

### Defense-in-depth patterns are only partially applied
CSRF (now 33 files, better than round-1 audit's 2), rate-limiting, `server-only` guards, timing-safe compare — all good primitives introduced but not backed by a CI gate that fails when new routes skip them. The pattern from round-1 audit persists: each helper is retrofitted to some routes but the follow-up across every eligible route never fully lands.

### Route boilerplate is still duplicated
PDF routes (4 files, ~100 LoC each of similar Puppeteer setup). Admin auth wrappers (`withAdminAuth`, `withRole("admin")`, inline `isAdminUser` in some routes) — three patterns for the same check. Partial extraction has started; finish line not yet reached.

### Tests are concentrated in `src/lib/`, not routes
13/56 API routes have tests. `src/lib/` is well-covered. The most impactful routes (admin actions, trades/upload, intro send) are the ones with cross-user write primitives — exactly the ones that need pinning tests.

### Dead code and drift creep in between sprints
Sprint 6 closeout removed dead keys routes, fixed version drift, cleaned up some cross-service type drift. But the pattern recurs: `/ship` → `/document-release` loop skips steps under deadline pressure, then `/review` catches it a sprint later.

### Hobby-plan constraints drive architecture
`vercel.json:5-8` hard-limits to 2 crons. `maxDuration = 30` is ignored on Hobby's 10s ceiling. Production was dark Sprint 4 → 2026-04-17 because of the 3rd cron added silently. Regression test `src/__tests__/vercel-cron-limits.test.ts` now catches this; the underlying constraint remains. The path forward is documented in `docs/runbooks/vercel-cron-upgrade.md`.

---

*Concerns audit: 2026-04-17*
