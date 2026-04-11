# Changelog

All notable changes to Quantalyze will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a 4-digit MAJOR.MINOR.PATCH.MICRO scheme so `/ship`
can bump without ambiguity.

## [0.6.0.0] - 2026-04-11

### Added
- **"Connect Your Strategy" wizard** (Sprint 1 Task 1.2) at `/strategies/new/wizard`. A 4-step onboarding flow for quant teams: connect a read-only exchange API key first, watch the factsheet compute from real trades, fill in metadata, submit for admin review. Replaces the inverted legacy `/strategies/new` form (which now redirects). The wizard fails fast on trading/withdrawal keys, validates on the exchange side before any data lands, and never renders raw server errors — every failure maps to a stable code in `src/lib/wizardErrors.ts` with institutional copy, a docs link, and concrete fix steps.
- **Visible inline permission block on ConnectKeyStep** (4 trust atoms: what we store, what we reject, who can decrypt, security contact) and 3 exchange cards (Binance, OKX, Bybit) with per-exchange captions and automatic OKX passphrase disclosure. Key nickname is optional. API secret has a show/hide toggle so mis-pastes are visually verifiable.
- **SyncPreviewStep with fire-and-forget sync** (`src/app/api/keys/sync/route.ts` refactored to Next.js `after()` + 202 pattern). The client polls `strategy_analytics` every 3 seconds using a lightweight status query, then pulls the full analytics row + trade count + symbol sample + exchange name in one `Promise.all` once computation completes. Slow-sync hint at 15 s, warning at 60 s, expandable status log at 60 s+. Runs `checkStrategyGate` against live data and renders the scripted wizardErrors copy for `<5 trades` / `<7 days` / analytics-failed rejections.
- **FactsheetPreview `verificationState` prop** (`draft` | `pending` | `verified`, default `verified`). The wizard renders the preview as `draft` ("Draft preview · pending review") so the "Verified by Quantalyze" accent badge only appears after the admin approves the listing. `/for-quants` and `/factsheet/[id]` continue to render the verified variant unchanged.
- **MetadataStep with detected-market pre-fill** — reuses the legacy StrategyForm field set (description, category, strategy types, subtypes, markets, supported exchanges, leverage range, AUM, max capacity) but renders inline chips instead of extracting a shared ChipGroup component. Markets and supported exchanges are pre-filled from the Step 2 sync sample + Step 1 exchange selection.
- **SubmitStep** renders a read-only summary card plus the draft-variant FactsheetPreview and calls `POST /api/strategies/finalize-wizard`. The endpoint invokes the `finalize_wizard_strategy` SECURITY DEFINER RPC, then kicks off both the founder-notification email and the `api_keys.last_sync_at` recency touch inside a single `after()` callback so the client never waits on SMTP.
- **WizardClient state machine + WizardChrome shell** with a 4-column hairline progress rail, `01 / 04` tabular counter, persistent "Delete draft" ghost link (hits the new `DELETE /api/strategies/draft/[id]` endpoint), persistent "Request a Call" ghost link (opens the existing `/for-quants` RequestCallModal with a `wizard_context` payload), ephemeral "Progress saved" toast on each step transition, and `supabase.auth.onAuthStateChange` listener that surfaces a non-blocking session-expired banner without losing the draft.
- **Server-side draft persistence** (`/api/strategies/draft` GET + `/api/strategies/draft/[id]` GET/DELETE). The wizard source of truth is the server `strategies` row; `src/lib/wizard/localStorage.ts` only stores a pointer so a closed-tab reopen can resume. Secrets are never persisted to the browser — resume requires re-pasting the secret.
- **DesktopGate at 640 px** (`src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx`). Narrow viewports see a save-my-progress email form that writes to `for_quants_leads` with a wizard context blob. Uses `matchMedia("change")` so state only updates when the breakpoint crosses, not on every resize pixel.
- **Migration 031** introduces `strategies.source` (`legacy` | `wizard` | `admin_import`) to cleanly discriminate wizard in-progress drafts from existing legacy and partner-import drafts, plus two SECURITY DEFINER RPCs (`create_wizard_strategy`, `finalize_wizard_strategy`) that encapsulate the wizard's atomic multi-row writes with explicit `auth.uid()` ownership checks. A `guard_wizard_draft_updates` BEFORE UPDATE trigger blocks any direct `authenticated`-role mutation that would flip a wizard draft out of `(source=wizard, status=draft)` — only the finalize RPC (running as the table owner) can promote to `pending_review`. Migration also adds `for_quants_leads.wizard_context JSONB` so Request-a-Call leads captured inside the wizard carry step context for founder triage. Self-verifying DO block asserts the column, CHECK constraint, index, RPCs, and guard trigger all exist before commit.
- **Atomic server endpoint `POST /api/strategies/create-with-key`** — replaces the legacy client-side `api_keys` insert after `validate-and-encrypt`. Validates, encrypts, and inserts both the `api_keys` row and the wizard draft `strategies` row via one RPC transaction, returning `{ strategy_id, api_key_id }`. Rate limited per user with length caps on key, secret, passphrase, label, and a strict UUID regex on `wizard_session_id`.
- **`src/lib/strategyGate.ts`** — pure function extracted from the admin strategy-review route. Both the admin approval gate and the wizard SyncPreviewStep now call the same `checkStrategyGate({ apiKeyId, tradeCount, earliest/latest, computationStatus, computationError })` so the 5-trades / 7-days / complete thresholds have a single source of truth. Boundary case preserved: exactly 7.0 days span passes. 13 unit tests cover every branch.
- **`src/lib/wizardErrors.ts`** — 16-code `formatKeyError(code, context)` table. Every error code (trading/withdraw perms, invalid secret, IP allowlist, rate limit, network timeout, draft already exists, sync timeout, sync failed, 4 gate failures, session expired, submit notify failed, unknown) has a stable identifier, institutional title, cause, numbered fix steps, `/security` docs anchor, and UI action list (`try_another_key`, `clear_and_retry`, `expand_log`, `resume_draft`, `start_fresh`, `request_call`, `leave_and_return`). No raw server strings reach the UI. 18 unit tests pin the contract.
- **Admin review card enhancement** (Task 1.3 rolled into the same PR) — `StrategyReviewTab` at `src/components/admin/AdminTabs.tsx` now shows a source badge (wizard / legacy / admin_import), CAGR + Sharpe + Max DD from the joined `strategy_analytics` row, computed-at recency ("just now" → "2d ago"), and a "View factsheet" link that opens `/factsheet/{id}` in a new tab. The admin query joins analytics in one PostgREST nested select so there's no N+1 and pulls only the columns the card actually renders.
- **16 PostHog wizard funnel events** — `wizard_start`, `wizard_step_view_{1-4}`, `wizard_step_complete_{1-4}`, `wizard_submit_success`, `wizard_error` (with stable code), `wizard_abandon`, `wizard_resume`, `wizard_delete_draft`, `wizard_try_different_key`, `wizard_request_call_click`. All events carry `wizard_session_id` so the funnel can correlate a single user across the /for-quants landing → CTA click → wizard start → submit success arc.
- **`/security` setup walkthroughs** at new anchors `#readonly-key`, `#binance-readonly`, `#okx-readonly`, `#bybit-readonly`, `#thresholds`, `#regenerate-key`, `#sync-timing`, `#draft-resume`. Each exchange gets a numbered step-by-step for creating a read-only key; thresholds explain the 5 trades / 7 days rationale; sync-timing explains first-sync-of-the-day cold starts; draft-resume explains the save-my-progress flow.
- **`e2e/for-quants-onboarding.spec.ts`** — wizard shell render, CTA swap assertion, exchange card rendering, inline permission block, scripted error copy regression (never leaks raw server strings), desktop gate at `<640 px`, **FactsheetPreview badge regression** (asserts `/for-quants` shows "Verified by Quantalyze" while the wizard draft variant never does), and `/security` anchor existence for all three exchange setup guides.

### Changed
- **`/for-quants` primary CTA routes logged-in managers to the wizard** — `ForQuantsCtas.tsx` swaps `LOGGED_IN_CTA_HREF` from `/strategies/new` to `/strategies/new/wizard` and relabels the button "Connect your strategy".
- **Legacy `/strategies/new` redirects to the wizard** — bookmarks, email CTAs, and any code link still works. `StrategyForm.tsx` is kept in place for `/strategies/[id]/edit` and will be removed in Sprint 3.
- **`/api/keys/sync` is fire-and-forget** — marks `strategy_analytics.computation_status='computing'` via the service-role client and returns 202 Accepted in milliseconds. The long-running `fetchTrades` + `computeAnalytics` work runs inside Next.js `after()` so the HTTP connection doesn't sit open through Railway cold starts. Failure path upserts `status='failed'` with the error message so the client poller can render a scripted retry. `maxDuration = 300` on Fluid Compute.
- **`ApiKeyManager.tsx` retry closure bug fix** — added a `lastAttemptedKeyId` state that survives the catch block clearing `syncingKeyId`, so the `SyncProgress` retry button now actually targets the attempted key instead of silently no-oping (pre-existing bug caught during Phase 3 engineering review).
- **`admin/strategy-review/route.ts` refactored to call `checkStrategyGate`** — replaces 38 lines of inline threshold logic with a single function call. Future threshold changes happen in one place.
- **`/api/admin/partner-import/route.ts`** sets `source: 'admin_import'` on inserted strategies so the Sprint 2 wizard cleanup cron never touches partner-seeded drafts.
- **`RequestCallModal` accepts an optional `wizardContext`** (`{ draft_strategy_id, step, wizard_session_id }`) and forwards it to `/api/for-quants-lead`. The `for_quants_leads.wizard_context` column (migration 031) lets the founder triage in-wizard leads separately from cold landing-page leads.
- **`FactsheetPreview` header badge is derived from `verificationState`** — the hardcoded "Verified by Quantalyze" string is gone. /for-quants still sees the default verified variant; everything else now has to opt-in.

### Security
- **Migration 031 guard trigger** closes the hole that `finalize_wizard_strategy` alone could not — the SECURITY DEFINER RPC was advertised as "the single choke point for wizard draft promotion" but the existing `strategies_update` RLS policy previously let any owner UPDATE `status='pending_review'` directly from the client. The new `guard_wizard_draft_updates` BEFORE UPDATE trigger blocks `authenticated`-role writes that would flip a wizard draft out of `(source=wizard, status=draft)`, while allowing the SECURITY DEFINER RPC (running as the table owner) through via a `current_user` check.
- **All new wizard draft routes are rate-limited** — `create-with-key`, `finalize-wizard`, `/api/strategies/draft` GET, and `/api/strategies/draft/[id]` GET/DELETE each check `userActionLimiter` under a dedicated bucket so a runaway client cannot spam the database.
- **Input validation tightened on both wizard RPCs** — strict UUID regex on `strategy_id`, `category_id`, and `wizard_session_id`; bounded lengths on key / secret / passphrase (512 chars), label (100 chars), description (10-5000 chars); AUM and max capacity capped at $1T so the admin card can't be spoofed with garbage numbers.
- **`/api/strategies/draft/[id] DELETE` re-applies the source+status filter on the DELETE itself** (not just the preflight) so a TOCTOU race cannot silently clobber a just-promoted strategy. Also checks whether any other strategy references the same `api_key_id` before hard-deleting the key — prevents a silent `SET NULL` cascade onto another strategy that happened to share the key.

### Review trail
- Passed full `/autoplan` pipeline with 12 adversarial voices across CEO / Design / Eng / DX phases (Claude subagent + Codex medium + Grok multi-agent per phase). Premise gate resolved 3 user decisions (hold wizard, separate draft storage → later pivoted to `source` discriminator mid-implementation after tracing Railway Python, two-metric ship gate). Final gate resolved 4 taste decisions (desktop-only 640 px, visible inline trust block + live scope viewer, 5-6 session effort budget, Task 1.3 rolled in).
- `/review` pipeline caught and fixed 8 issues pre-ship including 3 CRITICAL ship blockers: (a) `/api/keys/sync` was writing an invalid `'syncing'` value that would have violated the `strategy_analytics.computation_status` CHECK constraint on first call, (b) `finalize_wizard_strategy` was not actually a chokepoint because the trigger from migration 028 only fires on `api_key_id` changes — added `guard_wizard_draft_updates` trigger, (c) `/strategies` page was listing wizard drafts with clickable "edit" links to the legacy form — added source filter.
- `/simplify` removed dead code (`deriveMarketsFromDetected`, `detectedScopes`, `stepEnterTimes`, `wizardStartFired` state, `handleDeleteClick`/`handleRequestCallClick` no-op wrappers), consolidated two step-index tables into one, collapsed three localStorage reads on WizardClient mount into one ref, shrank the SyncPreviewStep poll payload to 2 columns per tick, folded 5 post-completion queries into one `Promise.all`, trimmed 4 unused columns from the admin strategies query, and deleted plan-narration comments from WizardClient, ConnectKeyStep, SyncPreviewStep, MetadataStep, create-with-key, finalize-wizard, sync route, AdminTabs, FactsheetPreview, strategyGate, wizardErrors, and localStorage.
- Test coverage: 727 unit tests pass (up from 689 pre-branch). 2 new test suites: `strategyGate.test.ts` (13 cases including the 7.0-day boundary) and `wizardErrors.test.ts` (18 cases covering all 16 codes + the fallback). 1 new e2e spec: `for-quants-onboarding.spec.ts`. 5 new FactsheetPreview component tests pin the verificationState prop contract.

## [0.5.2.0] - 2026-04-10

### Added
- **`/for-quants` public landing page** (Sprint 1 Task 1.1). Quant-team-facing marketing surface with 5 sections: Hero → Trust → How It Works → Factsheet Sample → CTA. Copy rewritten verbatim from the Codex Design review: "List a verified track record without exposing trading permissions." The primary CTA routes to `/signup?role=manager` for cold visitors and `/strategies/new` for signed-in managers.
- **"Request a Call" modal + public lead endpoint** — `RequestCallModal` client component submits to `POST /api/for-quants-lead` (CSRF + IP rate limit + Zod validation), writing to a new `for_quants_leads` table via the service-role client and emailing the founder. Mailto fallback to `security@quantalyze.com` is always visible for users without JS.
- **Migration 030 — `for_quants_leads`** — service-role-only lead intake table. RLS enabled with zero policies; `REVOKE ALL FROM anon, authenticated`; self-verifying DO block using `has_table_privilege()` asserts no leakage to user-scoped clients before committing.
- **`FactsheetPreview` shared server component** (`src/components/strategy/FactsheetPreview.tsx`) — extracted from `factsheet/[id]/page.tsx` hero metrics. Takes preformatted metric items (not a full analytics row) so it can render both real analytics (Task 1.2 wizard preview) and seeded demo data (/for-quants Sample section). Renders as a single shared-axis row per design guardrails.
- **`/security` public page + `public/security.txt`** — explicit security practices page covering read-only key enforcement, envelope encryption, tenant isolation, codename anonymization, allocator gating, deletion, and a `security@quantalyze.com` contact. `security.txt` follows RFC 9116 and is served from both `/security.txt` and `/.well-known/security.txt`.
- **PostHog analytics** (`src/lib/analytics.ts`) — dual-layer wrapper. Server-side `trackForQuantsEventServer` fires `for_quants_view` from the Server Component so JS-disabled crawlers still land in the funnel; client-side `trackForQuantsEventClient` fires `for_quants_cta_click`, `for_quants_request_call_click`, and `for_quants_lead_submit`. Graceful degradation when `NEXT_PUBLIC_POSTHOG_KEY` is missing. Powers the Sprint 1 ship metric (QQAR 5% within 7 days + CTR 10% as leading indicator).
- **`/api/for-quants-lead` regression tests** — 14 unit tests covering CSRF enforcement, Zod validation (missing fields, invalid email, oversized notes, malformed JSON), happy-path insert, optional-field normalization, and service failure handling.
- **`FactsheetPreview` component tests** — 7 assertions covering metric rendering, optional sparkline, sample label opt-in, and computed timestamp.
- **Static projection test for `for_quants_leads`** (`src/lib/for-quants-leads-projection.test.ts`) — scans `src/**` for any file that touches the table and asserts it imports `createAdminClient`, not the user-scoped Supabase client. Prevents future regressions where RLS would silently block a user-scoped read.
- **E2E smoke test** — `e2e/for-quants-landing.spec.ts` covers page load, 5-section visibility, CTA destination, Request a Call modal open/close/Escape flow, and both security.txt paths.

### Changed
- **`src/proxy.ts`** — added `/for-quants`, `/api/for-quants-lead`, `/security` to `PUBLIC_ROUTES`. Extended the logged-in-redirect exemption (previously only `/demo`) to cover `/for-quants` and `/security` so signed-in managers can share the landing page with colleagues without being bounced to the dashboard.
- **`.env.example`** — added `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.

### Dependencies
- Added `posthog-js` (~6 KB gzipped, browser SDK) and `posthog-node` (server SDK). Both dynamically imported so neither ships to bundles that don't call the analytics helpers.

### Review trail
- Passed full `/autoplan` pipeline: 11 adversarial voices across 4 phases (Claude + Codex + Grok × CEO/Design/Eng, plus Claude + Grok DX). 5 critical findings surfaced and resolved: `getSocialProofStats()` not exported, `/strategies/new` auth-gated, `/api/intro` reuse mismatch, proxy logged-in redirect bug, no ship metric. 7 taste decisions resolved by user at the final gate.

## [0.5.1.0] - 2026-04-11

### Security
- **SEC-005 — `api_keys` encrypted columns locked down** (migration 027). Revokes SELECT on `api_key_encrypted`, `api_secret_encrypted`, `passphrase_encrypted`, `dek_encrypted`, and `nonce` from anon and authenticated roles at the table level, then grants back only the allowlisted non-sensitive columns. Self-verifying DO blocks assert the grant state before committing, no more silent no-ops like migrations 012 and 017.
- **Cross-tenant `api_key_id` linkage blocked** (migration 028). A new `BEFORE INSERT OR UPDATE OF api_key_id` trigger on `strategies` enforces `api_keys.user_id = strategies.user_id`. Previously a user could set their strategy's `api_key_id` to another user's key via client-side state manipulation and claim their verified track record. Found by 3 independent adversarial reviewers (Claude, Codex, Grok).
- **Follow-up hardening** (migration 029). Retro-scan verifies no existing cross-tenant rows (found and remediated 5 demo seed violations). Trigger function gains `FOR SHARE` row lock, short-circuit on no-op updates, schema-qualified `public.api_keys`, and tightened `search_path = pg_catalog, public`. `strategies_update` policy adds explicit `WITH CHECK`. Verification uses `has_column_privilege()` ground-truth API instead of `information_schema.column_privileges`.
- **App-layer audit** — every `from("api_keys")` call site projects the `API_KEY_USER_COLUMNS` allowlist. `ApiKeyManager.tsx:49` no longer uses `.select("*")` which would have silently returned NULL after migration 027. `AllocatorExchangeManager.tsx` uses the shared constant for consistency.

### Added
- **`API_KEY_USER_COLUMNS` + `API_KEY_ENCRYPTED_COLUMNS`** constants in `src/lib/constants.ts` as the single source of truth for the projection allowlist. Backed by `API_KEY_USER_COLUMNS_ARR` tuple for type safety.
- **SEC-005 regression tests** — `src/lib/sec-005-api-keys-projection.test.ts` scans `src/**` for `.from("api_keys").select("*")` and PostgREST `api_keys(*)` embed syntax. Fails loudly if any call site regresses.
- **Migration 028 integration tests** — `src/lib/migration-028-tenant-check.test.ts` simulates the cross-tenant attack end-to-end (INSERT, UPDATE, self-link, NULL) against a live DB.
- **SEC-005 live probe** — `src/lib/sec-005-live-probe.test.ts` signs in as an authenticated user and asserts encrypted columns return NULL, catching regressions the static regex scan can't see. Also cross-references `API_KEY_USER_COLUMNS_ARR` against the live GRANT to detect constant-vs-migration drift.
- **Shared test helpers** — `src/lib/test-helpers/live-db.ts` centralizes `HAS_LIVE_DB` gate, admin client factory, test user creation, and cleanup for live-DB integration tests.

### Fixed
- **Demo seed cross-tenant `api_key_id`** — `scripts/seed-full-app-demo.ts` no longer sets `strategies.api_key_id` to the allocator-owned key. Demo strategies rely on synthetic analytics; the field is now NULL, which matches the product model (the column is the manager's verification key, not a portfolio-tracking reference).
- **9 pre-existing TypeScript errors** in widget test files unblocked (`allocation.test.tsx`, `meta.test.tsx`, `positions.test.tsx`). Placeholder widgets now have zero-arg signatures; tests call them without spreading grid props.
- **`ApiKey` type extended** to match the full projection (`sync_status`, `account_balance_usdt`), removing the stale `as ApiKey[]` cast in `ApiKeyManager.tsx`.

## [0.4.1.0] - 2026-04-10

### Security
- **Portfolio-PDF IDOR closed** — the `/portfolio-pdf/[id]` page now requires a signed HMAC render token. Direct browser access without a valid token returns "Unauthorized". API routes pass a 2-minute token to Puppeteer.
- **CSRF retrofit** — Origin/Referer check applied to all ~25 mutating API routes (was only 2).
- **Rate limiting extended** — all mutating/sensitive routes now have Upstash rate limits.
- **Timing-safe token comparison** — `verify-strategy/[id]/status` uses `timingSafeEqual` instead of `!==`.
- **`import 'server-only'`** guard on admin client modules prevents accidental browser bundle leak.
- **Trade upload validation** — rows are schema-validated and `strategy_id` is forced server-side.
- **API-layer auth defense-in-depth** — `getUser()` checks added before DB operations on write paths.

### Added
- **Sentry instrumentation** — `@sentry/nextjs` installed, `src/instrumentation.ts` conditionally initializes when `SENTRY_DSN` is set. `onRequestError` captures unhandled server errors.
- **Error boundaries** at root (`global-error.tsx`), dashboard, and auth layout levels.
- **Zod contract validation** for all 8 analytics service response types.
- **Email retry with backoff** — Resend calls now retry 3x with exponential backoff.
- **Analytics API version header** — client sends `X-Api-Version: 1`, warns on mismatch.
- **Stuck-notification health check** — `src/lib/observability.ts` for monitoring `notification_dispatches`.
- **13 Architecture Decision Records** in `docs/architecture/` covering RLS, auth, cron, caching, deployment, and more.
- **7 regression tests** for critical findings (`critical-regressions.test.ts`).
- **5 route tests** for trades/upload cross-user write protection.
- **My Allocation dashboard redesign spec** at `docs/superpowers/specs/2026-04-10-my-allocation-dashboard.md`.
- **Round-1 and round-2 audit reports** in `audit/`.

### Changed
- **Analytics client timeout** — shared fetch wrapper now uses `AbortSignal.timeout(30s)` with configurable override.
- **Analytics client consolidated** — `portfolio-optimizer` and `admin/match/eval` routes now use the shared client.
- **Vercel Crons re-registered** — `warm-analytics` (every 5 min) and `alert-digest` (daily 9 AM) in `vercel.json`.
- **Warmup timeout bumped** from 2s to 10s.
- **PDF routes** — `maxDuration=30` set on all 4 handlers; auth'd route cache changed from `s-maxage=3600` to `private, no-store`.
- **Trade upload cap** lowered from 50k to 5k rows per request.
- **Admin auth consolidated** — proxy now uses canonical `isAdmin()` from `src/lib/admin.ts`.
- **`api_keys` reads** switched from admin client to user-scoped client (respects RLS).
- **MyAllocationClient** broken up from 1218 to 544 LoC (6 sub-components extracted).
- **AllocatorMatchQueue** broken up from 1028 to 754 LoC (4 sub-components extracted).
- **`as unknown as` casts** reduced from 34 to 9 via typed `castRow`/`castRows` helpers.
- **VERSION synced** — `package.json` version matches `VERSION` file.

### Fixed
- **`freshnesScore` typo** fixed to `freshnessScore` across all files.
- **CsvUpload double-read** eliminated by storing parsed rows in state.
- **Fake sync button** in AllocatorExchangeManager replaced with disabled "Auto-synced" indicator.
- **`.env.example`** rewritten: fixed analytics port (8000 → 8002), added 10 missing vars, removed stale entries.

### Removed
- **Dead API routes** — `/api/keys/encrypt` and `/api/keys/validate` deleted (superseded by `validate-and-encrypt`).
- **CI audit swallow** — removed `|| true` from `npm audit` in CI.

### Design
- **PageHeader** uses Instrument Serif per DESIGN.md (propagates to all dashboard pages).
- **Landing page** H2 headings normalized to Instrument Serif 32px.
- **"How It Works"** section rebuilt from 3-card slop to editorial hairline columns.
- **WCAG 2.5.5** 44px touch targets enforced across Input/Select/Button primitives.
- **404 page** and **legal pages** typography aligned with DESIGN.md.

## [0.4.0.0] - 2026-04-09

### Added
- **My Allocation page** — `/allocations` is now a Scenarios-style live view of the allocator's actual exchange-connected investments. Each row is a real investment the allocator made by giving a team a read-only API key on their exchange account. KPI strip (TWR / CAGR / Sharpe / Sortino / Max DD / Avg |corr|), SVG equity curve, and per-investment list — all driven by the scenario math library applied to real data. Inline **Exchange connections** section (powered by the existing `AllocatorExchangeManager`) so the allocator can connect another exchange without navigating away.
- **Allocator-editable investment aliases** — migration 025 adds `portfolio_strategies.alias TEXT NULL`. Each row on My Allocation has a pencil icon that flips into an inline editor; saving PATCHes `/api/portfolio-strategies/alias` and the UI refreshes. Falls back to the strategy's canonical display name when unset.
- **Connections page** at `/connections` — the allocator's intro relationships with strategy managers, promoted from the old cross-portfolio `/allocations` section into its own route. Now has a server-side allocator role guard so managers who hit the URL directly get redirected.
- **Scenario math library** at `src/lib/scenario.ts` — extracted the ~250-line `computeScenario` function out of `ScenarioBuilder.tsx` so it can power both `/scenarios` (unchanged) and the new `/allocations` view. All three regression-critical behaviors from the lift are preserved and pinned by 17 unit tests: per-strategy staggered-start weight renormalization, absolute-value avg pairwise correlation, and Sortino dividing the downside RMS by total observations (not by the count of negative days).
- **Partial unique index** on `portfolios (user_id) WHERE is_test = false` (migration 023) enforces the one-real-portfolio-per-allocator invariant at the database level. Kept across the pivot even though the Test Portfolios surface was dropped — the invariant is still valuable.
- **`user_favorites` table** (migration 024) — created for future watchlist features. No UI ships against it in v0.4.0 after the Scenarios-replaces-Test-Portfolios pivot; the table persists as infrastructure.
- **PATCH `/api/portfolio-strategies/alias`** — auth-gated endpoint that lets the allocator rename an investment row. Ownership check on the parent portfolio before the UPDATE, alias capped at 120 characters, empty string coerces to null.
- **34 new tests across 3 new test files** — `scenario.test.ts` (17 tests, including all 3 regression pins), `queries.my-allocation.test.ts` (7 tests for the query helpers + dashboard payload), `Sidebar.test.tsx` (10 tests for the allocator-vs-manager workspace split).

### Changed
- **Sidebar split** — allocators see **My Allocation → Connections → Scenarios → Recommendations**. Managers and crypto teams see **Strategies → Portfolios**. "Strategies" is no longer shown to allocators (that's the manager surface — crypto teams publishing strategies for allocators to discover via the Discovery group). The legacy "Exchanges" top-level entry is folded into My Allocation.
- **`/allocations` full rewrite** — the old cross-portfolio aggregate view (4 KPI cards, portfolio list, Active Alerts banner, Active Connections section) is gone. Connections moved to `/connections`, the single-real-portfolio view is now the dashboard, and exchange connections live inline below.
- **Migrations 023 + 024 are now idempotent** — every `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX`, and `CREATE POLICY` is guarded with `IF NOT EXISTS` or a `DO $$ EXCEPTION WHEN duplicate_object THEN NULL` block, matching the convention in migrations 009 / 012 / 014 / 016.
- **`getMyAllocationDashboard`** — parallel-fetches the real portfolio, analytics, `portfolio_strategies` (with `alias` from migration 025 + raw `daily_returns`), `api_keys`, and alerts in one round. No favorites, no test portfolios.
- **`/portfolios` page** — reverted to the old "Portfolios" title for the manager/crypto-team workspace. Allocators no longer link here.
- **Connections page** `avgSharpe` — separate `sharpeCount` accumulator (was incorrectly sharing the CAGR counter), dynamic category slug for detail links (was hardcoded to `/discovery/crypto-sma/`), server-side role guard redirecting non-allocators.

### Removed
- **Test Portfolios concept** entirely. No `/api/test-portfolios` route, no Save-as-Test modal, no renamed `/portfolios` page, no `getTestPortfolios` query helper. Scenarios is the what-if exploration surface.
- **Favorites panel** and **FavoriteStar** — watchlist UI dropped. The `user_favorites` table stays as future infrastructure.
- **`/api/favorites`** POST/DELETE route.
- **Custom dashboard components** — `FundKPIStrip`, `StrategyMtdBars` replaced by the reused ScenarioBuilder-style `MetricCard` grid and inline equity curve. `PortfolioEquityCurve` is no longer called from `/allocations` (the Scenarios-style SVG curve is inlined in `MyAllocationClient` instead).

## [0.3.0.0] - 2026-04-09

### Added
- **Scenario Builder** at `/scenarios` (allocator-only) — interactive toggle-based what-if tool. Pick a subset of the 15 strategies, set per-strategy weight and "include from" date, watch every metric recompute live client-side in ~5-15ms per toggle. Recomputes TWR, CAGR, volatility, Sharpe, Sortino, max drawdown + duration, pairwise Pearson correlation matrix, avg pairwise correlation. Reuses the existing `CorrelationHeatmap`. Custom SVG equity curve. Quick presets: All / None / Equal weight. This is the decision-support tool allocators use to test "should I divest from X" or "should I add Y in month Z" before touching the real book.
- **Allocator Exchange Manager** at `/exchanges` (allocator-only) — allocator-facing page for uploading read-only exchange API keys to auto-build the Active Allocation portfolio from exchange-derived positions and lifecycle events. Modal with the existing `ApiKeyForm`, posts to `/api/keys/validate-and-encrypt` (validated against exchange, encrypted with per-user KEK before storage, trading/withdrawal keys rejected). Lists connected exchanges with sync status, last-synced relative time, reported balance. "Sync now" per-key refreshes `last_sync_at`. Direct link to the derived Active Allocation portfolio as the canonical output. Plain-English explainer card covering the `source='auto'` allocation_events derivation pattern.
- **Full-app demo seed** (`scripts/seed-full-app-demo.ts`) — replaces the 3-persona /demo-page seed with a realistic full-dashboard allocator experience. 1 allocator (`demo-allocator@quantalyze.test` / `DemoAlpha2026!`, Atlas Family Office), 8 managers across institutional + exploratory tiers, 15 strategies covering the real crypto-quant archetype universe (cross-exchange arb, basis carry, funding capture, BTC trend, altcoin momentum, L/S pairs, stat arb, short vol, iron condor, mean reversion, DEX MM, on-chain alpha, liquidation fade, risk parity, ML factor). Each strategy has 2-4 years of deterministic daily returns with explicit regime hits for 2022-05 LUNA, 2022-11 FTX, and 2024-04 correction. Complete `strategy_analytics` rows (returns_series, drawdown_series, monthly_returns, daily_returns, rolling 30/90/180d Sharpe, return quantiles, sparklines, all scalar metrics). 3 portfolios (1 real Active Allocation + 2 what-if scenarios) with full `portfolio_analytics` JSONB. 28 `allocation_events` covering the add → top-up → drawdown trim → re-add lifecycle on the real book.
- **Sidebar navigation** adds "Scenarios" and "Exchanges" under `MY WORKSPACE` for allocators (hidden from managers and from admins who have the Match Queue instead).
- **Demo walkthrough doc** at `docs/demos/2026-04-09-full-app-walkthrough.md` — click-by-click demo script with login credentials, seed summary, 5-act flow, known limitations, and post-demo housekeeping.

### Changed
- `/demo` editorial page and its 3-persona seed are superseded by the full-dashboard experience. The old /demo page still loads but is no longer the canonical allocator view.
- `portfolio_strategies.status='published'` is now the canonical status for seeded strategies (previously `'verified'`, which doesn't match the table's CHECK constraint).

### Fixed
- Seed `allocation_events.source` uses the allowed `'auto'` / `'manual'` enum values. Prior drafts used `'exchange_sync'` which silently failed the CHECK constraint.
- Silent failures in seed upserts — every insert path now throws with the table name and the Supabase error message so drift can't hide.

### Security
- Migrations 020/021/022 (landed separately via Supabase MCP earlier in the day) are documented in their own branch, not this one. Highlighted here for the release notes: real PII revoke on `profiles` (the 012/017 column-level revoke was a silent no-op against the table-level grant), SECURITY DEFINER RPC lockdown on `send_intro_with_decision` / `sync_trades` / `latest_cron_success`, and `public_profiles` view switched to `security_invoker=on`.

### Highest-priority follow-up
- **Multistrategy Dashboard** (`/overview`) — top-level allocator overview showing all strategies across all portfolios overlaid on one YTD PnL chart, MTD PnL horizontal bars, and fund-level AUM/24h/MTD/YTD KPIs. Data layer ready via the seed above. See `TODOS.md` for the full spec. Estimated 45-90 min, all client-side.

## [0.2.0.0] - 2026-04-09

### Added
- Editorial hero for the public `/demo` page — one Instrument Serif headline, four Geist Mono numbers, one "Download IC Report" CTA. Verdict / Evidence / Action / Appendix layout replaces the old 9-card mosaic.
- Per-persona demo experience via `?persona=active|cold|stalled`, backed by a server-side enum lookup that rejects hostile input (including `__proto__`) and hardcodes allocator UUIDs.
- Insight strip: biggest-risk / regime-change / underperformance / concentration-creep sentences derived from `portfolio_analytics`. Never shows a composite score.
- Winners/losers strip: top 3 contributors and bottom 3 detractors from attribution, stable sort by strategy ID on ties.
- "What we'd do in your shoes" + "Where would the next $5M go?" recommendation narrative reading `optimizer_suggestions` directly.
- Counterfactual strip: "Had you allocated 12 months ago: portfolio +X% vs BTC +Y%".
- `/api/demo/portfolio-pdf/[id]` — new public PDF endpoint with HMAC-SHA256 signed tokens (30 min TTL), allowlist-gated to the 3 persona portfolios, shares the existing Puppeteer concurrency semaphore. The authenticated `/api/portfolio-pdf/[id]` is unchanged.
- `/api/cron/warm-analytics` — Vercel Cron handler (every 5 min) that pings the Python analytics service `/health` endpoint to keep cold-start latency off the forwarded-URL path. Accepts both GET (cron default) and POST (manual probe).
- `/portfolios/[id]` now wires 7 previously-orphaned chart components: `PortfolioEquityCurve`, `CorrelationHeatmap`, `AttributionBar`, `BenchmarkComparison`, `CompositionDonut`, `RiskAttribution`. Below-the-fold charts lazy-load via `next/dynamic`.
- Stale-fallback analytics: `getPortfolioAnalyticsWithFallback` fetches latest + latest-where-status=complete in parallel so a failed run renders last-good data with a stale badge instead of an error card.
- `<CardShell>` primitive with 4 states (loading / ready / stale / unavailable) for the authenticated dashboard. Cards never disappear — only their content does.
- `<MorningBriefing>` shared component between `/demo` (dek variant) and `/portfolios/[id]` (card variant).
- `portfolio-analytics-adapter`: strict typed adapter at the Supabase boundary. Defends against prototype-key poisoning from JSONB and rejects empty-string / boolean numeric coercion.
- `ResizeObserver` stub in `src/test-setup.ts` so chart components can render under vitest+jsdom.
- 4-digit VERSION file and CHANGELOG.md for clean version tracking.

### Changed
- `PortfolioAnalytics` TypeScript types corrected to match what `analytics-service/routers/portfolio.py` actually persists: `rolling_correlation` is now `Record<string, {date,value}[]>` (pair-keyed), `benchmark_comparison` is a single object (not a `Record`), `attribution_breakdown` and `risk_decomposition` use the real field names (`contribution` + `allocation_effect`; `marginal_risk_pct` + `standalone_vol` + `component_var` + `weight_pct`).
- `StrategyBreakdownTable` and the authenticated portfolio-pdf page drop dead reads on `attr.weight` / `attr.twr` — fields that never existed in the persisted payload. Weights now come from `portfolio_strategies.current_weight`, TWR from `strategy_analytics.cagr`.
- `/demo` rewrite preserves the existing two-batch match fallback chain (`batches[0] → batches[1]`) via an extracted, unit-tested `resolveDemoRecommendations` helper.
- Package version bumped from `0.1.0` to `0.2.0`.

### Fixed
- Pre-landing review catches (Codex adversarial + Claude checklist):
  - Cron route now exports GET + POST (was POST-only; Vercel Cron sends GET).
  - Demo PDF endpoint switched to `Cache-Control: no-store` so the CDN can't replay a response past the 30 min signed-token TTL.
  - Demo page now only signs a PDF token when the current persona has a seeded portfolio in the allowlist; no silent cross-wire to the active persona's report.
  - Warmup helper clears its timeout handle on the sync-throw path.

### Removed
- Portfolio Health Score card — killed before implementation per 4-signal cross-phase cross-model consensus (Claude + Codex, CEO + Design). Composite scores are a taste landmine for institutional LPs; the hero is now raw metrics with explicit provenance.
