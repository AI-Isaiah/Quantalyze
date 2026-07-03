# TODOS

> **Goal:** Make the portfolio management system Quantalyze's 10/10 demo hero
> for the next cap-intro / pilot-allocator meeting. Show allocators what is
> performing, what is underperforming, and where we can help them improve.
>
> **Horizon:** Two CC sessions of the 2026-04-08 size = ~12-14 PRs of coding
> capacity before the final product we show.
>
> **Format:** These are IDEAS, not a plan. The plan comes later. No file paths,
> no line numbers, no effort estimates. Just the shape of the thing.

---

## v1.3 phase 45 nav follow-ups (deferred from /ship pre-landing review, 2026-06-27)

### ~~P2: "Bridge" mobile-nav item lands on a tab with no bridge surface~~ — ✅ DONE (2026-06-27)
Pointed Bridge → `/allocations?tab=scenario`, where the ScenarioComposer's "Open
Bridge" card → BridgeDrawer actually lives (the Risk tab had no bridge surface;
`BridgeWidget` is mounted nowhere and `#bridge` anchored nothing). Dropped the inert
`#bridge` fragment; the new href is naturally distinct from Risk's so SC#1 still holds.
Product decision per user. Shipped on the v1.3 phases-46-48 branch.

### P3: tab-strip edge-tab focus ring clipped by `overflow-x-auto`
Converting the allocation tablist to a horizontal scroll container clips the outer 2px
of the outset `focus-visible` outline on the first/last tabs at the scroll boundary
(WCAG 2.4.7 degradation the axe gate can't detect). Add horizontal scroll padding or
switch the tab focus style to an inset ring — but verify it doesn't disturb the pinned
dashboard-parity Tailwind class order on `TAB_BUTTON_*`.

### P3: flagged-count badge can overflow its cell when > 99
The flagged-holdings badge on the bottom nav (and desktop sidebar) is unbounded; a
count > 99 widens the badge enough to overlap the adjacent cell on a 320px 5-item admin
layout. Cap the displayed value to `99+`.

---

## v1.3 phase 46 reflow follow-ups (deferred from /ship review, 2026-06-27)

### P3: sortable-header focus ring clipped by the new table `overflow-x-auto` regions
Same WCAG 2.4.7 class as the tab-strip P3 above, now extended to the tables Phase 46
newly wrapped in `ResponsiveTable`: HoldingsTable's `SortableHeader` / `StrategySortableHeader`
buttons and OpenPositionsTable sit inside the `overflow-x-auto` region, so the outset
`focus-visible` ring on the edge columns clips at the scroll boundary (axe can't detect it).
The pre-wrapped tables (Scenario/Correlation/ComputeJobs) already had overflow wrappers, so
no new clip there. Fix with the same inset-ring / scroll-padding remedy chosen for the tab strip.

### P3: stale `DesktopGate` references in `for-quants-lead/route.ts` comments
Phase 46 deleted `DesktopGate.tsx`, orphaning the `"desktop-gate"` `wizard_session_id` token
documented in `src/app/api/for-quants-lead/route.ts` (comments around lines 167/182/391). The
Zod schema still ACCEPTS the token (harmless back-compat for any old draft/analytics rows), so
this is doc rot only — left out of the phase-46 diff to keep it surgical. Drop the DesktopGate
mentions from those comments (and decide whether the back-compat token value is still worth keeping).

### P3: expand wizard 320px reflow coverage past the entry step
`reflow-sweep-authed.spec.ts` now proves BOTH wizard branch entries reflow at 320px (API
`#wizard-connect-key-heading` + CSV `#wizard-csv-upload-heading`), which is the de-block proof.
The later steps (`sync_preview` / `metadata` / `submit`; CSV `preview` / `submit`) use stacking
`md:` grids and overflow-wrapped tables so they're likely fine, but they're not measured at 320px.
Add cases that advance past the entry step (needs seeded draft state or step-state injection) so
"phone users complete onboarding" is proven end-to-end, not just at the funnel entrance.

### P3: migrate the remaining `overflow-x-auto`-wrapped tables onto `ResponsiveTable`
Phase 46 migrated 5 table groups to `ResponsiveTable` (the canonical scroll-affordance idiom),
but sibling tables still use the bare `<div className="overflow-x-auto"><table>` pattern
(e.g. `strategy/CompareTable`, `strategy/StrategyTable`, `portfolio/StrategyBreakdownTable`,
`strategy/CompareCorrelationMatrix`, plus factsheet/admin tables) and so lack the SR scroll
region + unique landmark name. Migrate them (or document the exemption) so there's one idiom,
passing a distinct `label` per table to preserve `landmark-unique`.

---

## Phase 19.1 follow-ups — CSV → analytics pipeline post-deploy work

### P1 — Plans 07-10 (remaining phase work, blocked on PR merge + Railway deploy)

Plans 01-06 of Phase 19.1 landed in this PR (v0.24.7.0): code on the branch + both migrations applied to TEST + PROD. The remaining plans are gated on this PR merging to main and Railway redeploying analytics-service with the new code:

- **Plan 07** — Railway deploy verification: assert deployed_sha == main HEAD via Supabase MCP probe, watchdog-headroom test passes against deployed image, hard 15-min timeout on deploy convergence.
- **Plan 08** — Vercel `USE_COMPUTE_JOBS_QUEUE=true` flip + redeploy: idempotent (`vercel env get` → skip if already true; fallback to `vercel env pull` if the `get` subcommand is unavailable).
- **Plan 09** — End-to-end production smoke: upload real CSV via wizard, poll `strategy_analytics.computation_status` until terminal, curl factsheet HTML, assert no stop-gap copy + CAGR card test-ids present.
- **Plan 10** — Stop-gap removal (`src/app/strategy/[id]/analyticsMissingMessage.ts` + `page.tsx` gate widening to admit `complete_with_warnings`) + delete the two discarded remote branches `feat/csv-analytics-pipeline-2026-05-21` and `feat/csv-analytics-pipeline-hardening-2026-05-22`.

Plans 07-10 are gated on Plan 06's verdict line `19.1-06-VERDICT: PROD-APPLIED` (already emitted) plus this PR landing on main. After merge, resume autonomous mode with: `gsd-autonomous --only 19.1` from Plan 07.

### P2 — Pre-existing atomicity gap (Grok 4.3 ship-review finding)

`csv-finalize/route.ts` calls `finalize_csv_strategy` then `persist_csv_daily_returns` non-transactionally. If `persist_csv_daily_returns` fails, the strategy row is already committed but has no daily returns. Mitigated today:
- 500 `CSV_PERSIST_FAIL` returned with strategy_id (support recovery path)
- No `after()` enqueue fires (early-return blocks it)
- Worker doesn't get a job → no silent loop on "Insufficient CSV history"

Real harm: orphan strategy rows accumulate, user confusion. Pre-existing issue (`finalize_csv_strategy` was on main before Phase 19.1). Deferred to BACKBONE-07 / R4 (`wizard_session_id` UNIQUE INDEX) per CONTEXT.md `<deferred>`. **Action when BACKBONE-07 ships:** wrap both RPCs in a single transaction OR add a Sentry alert + cron-based orphan-strategy cleanup.

### P2 — `after()` enqueue silent-failure monitoring

`csv-finalize/route.ts` after() block catches enqueue errors and logs warnings (non-blocking by design — the wizard returns 200 regardless). If enqueue fails silently in production (transient RPC error, etc.), the strategy has data but no compute job → factsheet shows "Analytics being computed" indefinitely. Real harm: stuck-pending strategies. **Mitigation needed:** Sentry alert on `enqueue_compute_job` failure path + dashboard for stuck `pending`/`null` `computation_status` rows >2h after `created_at`.

### P3 — `compute_all_metrics` edge case coverage in unit tests

Plan 05 ships live-DB regression tests for 1-row / all-zero / NaN-Inf CSVs. The matching pytest unit tests in `analytics-service/tests/test_csv_analytics_runner.py` (Plan 02 / Wave 1) cover the happy path + benchmark unavailable + sparse weekday calendar — but not the new edge cases against the live `compute_all_metrics` math directly. Adding mocked equivalents of Tests 9-11 would catch regressions without requiring `TEST_SUPABASE_DB_URL`.

### Claude red-team review (2026-05-22) — follow-ups

Five additional findings from the post-PR red-team pass against Phase 19.1. Fixes 1-4 landed in this branch (commits prefixed `19.1-redteam`). The items below are the remaining follow-ups that need separate plans / migrations / monitoring infra.

#### ~~P0 — `complete_with_warnings` CHECK constraint missing~~ — ✅ DONE (B9, 2026-06-02)

Shipped in migration `20260602120000_strategy_analytics_computation_status_add_complete_with_warnings.sql` (PR #406): the `strategy_analytics_computation_status_check` CHECK was widened to `('pending','computing','complete','complete_with_warnings','failed')` with a self-verifying DO block + the `check-zod-db-check-parity.test.ts` regression gate. The `portfolio_analytics` half of the original note was a precaution, not a live bug — verified 2026-06-20 that no producer ever writes `complete_with_warnings` to `portfolio_analytics.computation_status` (only `strategy_analytics`, plus a distinct `sync_status` column), so no widening was needed there.

#### P1 — Unified backbone CSV-finalize broken-by-construction

If `PROCESS_KEY_UNIFIED_BACKBONE=on` is flipped while CSV finalize is in scope, the upstream `/process-key` csv-finalize branch calls `finalize_csv_strategy` via the service-role client which has no `auth.uid()` → `42501` every time. The legacy direct-RPC path uses the request-scoped Supabase client and works.

**Action:** Either (a) skip unified path for `step=finalize` until the upstream supports JWT impersonation, or (b) add JWT forwarding upstream. Document the prerequisite in the unified-backbone flag's flip-runbook so a future operator doesn't enable it without addressing this gap.

#### P2 — Admin RLS policy EXISTS subquery on `csv_daily_returns`

The `csv_daily_returns_admin_select` RLS policy runs `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)` per row. At 5000 rows per query this is a planner gamble — Postgres might inline the EXISTS into the row scan, or might materialize it once. Empirically fine today, brittle as data grows.

**Action:** future migration — wrap the admin-check as a `SECURITY DEFINER` function (cached per session) or use `(SELECT auth.uid())` to hoist the lookup. Cross-reference admin-policy patterns already in use by the dashboard tables.

#### P2 — Worker crash mid-job leaves `computing` state

Pre-existing pattern inherited by the new CSV runner. If the worker SIGKILLs after `_mark_computing` but before any terminal write, the `strategy_analytics` row stays at `computing` until the existing stale-checkpoint watchdog catches it. For CSV uploads the user-visible symptom is a wizard that polls `computing` indefinitely.

**Action:** add a cron-style janitor (Vercel Cron or Supabase Edge Function) that detects `computation_status='computing'` rows older than 30 minutes and marks them `failed` with `computation_error='worker crash recovery — please retry'`. Use the existing `pg_cron`-based approach (see analytics watchdog precedent).

#### P3 — `@audit-skip` pragma copy-paste risk

The `@audit-skip` justification blocks in `csv-finalize/route.ts` (around `enqueueCsvAnalyticsAfter` and `applyCsvMetadataUpdate`) are sound for the current use, but future maintainers might quote the justification verbatim in unrelated places without understanding the audit-gate model. Pre-existing risk amplified by the recent extraction into shared helpers.

**Action:** add a CLAUDE.md note (`## Audit-skip pragma — when it's appropriate`) describing when `@audit-skip` is OK (continuation of an already-audited user-intent flow; internal worker-state scheduling) and when it is NOT (any new user-initiated mutation lacking an upstream audit row).

---

## Phase 18 — Root-Cause Fix + Founder LP Skeleton

- 10-team onboarding tracker: [`.planning/phase-18/team-status.md`](.planning/phase-18/team-status.md) — one row per onboarding team (FIX-03). Founder updates as teams flow through the wizard.
- Founder OKX smoke evidence template (FIX-02): [`.planning/phase-18/founder-okx-smoke.md`](.planning/phase-18/founder-okx-smoke.md). Filled at /ship time.
- In-flight traceability (FIX-01 record-only): [`.planning/phase-18/in-flight-traceability.md`](.planning/phase-18/in-flight-traceability.md).

### v1.1 follow-up: CSV daily-return scale auto-detect (operational friction surfaced 2026-05-06)

CSV ingestion (Phase 15 / CSV-02 schema) currently requires daily returns in **decimal** form (-0.0605 = -6.05%). Founder's real-world LP-team CSVs arrive in mixed formats — some in **percent points** (-6.05), some in **decimals** (-0.0605), some as **whole-number basis points** depending on the team's tooling. Today the schema rejects anything where any single row exceeds the `> -100% impossible` rule (i.e. value `< -1.0`), which means percent-point CSVs fail with N rows of "Column 'daily_return' failed: -X.XXX" and the founder has to hand-convert before re-uploading.

**Proposed enhancement (CSV-02 v1.1):** ingestion auto-detects the scale and normalizes:

1. **Decimal (default):** if every value is `|v| < 1.0`, treat as decimal — current behavior.
2. **Percent points:** if 5+ rows have `1.0 ≤ |v| < 100.0`, divide everything by 100. Surface a "detected percent format — auto-converted; NN values divided by 100" toast in the validator step.
3. **Whole numbers / basis points:** if 5+ rows have `|v| ≥ 100.0`, divide by 10000. Same auto-convert toast.

**Why this matters:** v1 founder LP teams won't standardize their export pipelines; making upload "just work" removes a per-team friction point. The fix is small (heuristic in `analytics-service/services/csv_validator.py` before pandera schema validation) and is testable via the existing CSV fixture corpus.

**Surface deferred to v1.1** — Phase 18 already shipped; opens after v1.0.0 ships.

---

## DISCO-05 migration drift — Path C ratified (2026-05-01, v1.0.0 Phase 16 prep)

**Decision:** Path C — accept the local-only state for migrations 091 (DISCO-05
seed `is_example` backfill) + 092 (positions duration NUMERIC) + 093 + 094
(Phase 15 strategy_verifications + RLS polish), and defer the coordinated
remote push to v1.0.0 ship time via CI workflow #71's production-approval gate.
Phase 15 already operated this way de-facto by shipping 093 + 094 local-only;
this entry ratifies that policy for the rest of v1.0.0.

**Why not Path A/B:** workflow #71 makes `supabase db push` a CI-only operation
behind manual approval, so local pushes are wrong by policy regardless of
drift state. The 8 unknown remote timestamps (`20260424012820` …
`20260428190907`) span the Sprint-13 window and need provenance audit before
`supabase migration repair` can be run safely — that audit is owned by the
v1.0.0 release operator at ship time, not by individual phase work.

**Convergence document:** `.planning/phase-16/migration-drift-resolution.md`
holds the full reasoning + ship-time playbook. Phase 16 prep gate 2 of 3 is
closed by this decision.

**Supersedes:** Phase 13 TODOS.md DISCO-05 backfill section
(`.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/TODOS.md` lines
45–93). That document's Path A/B/C analysis remains the authoritative
historical record but its operator decision is overridden here for v1.0.0.

---

## v0.23.0.0 — vitest concurrent-worker timeout flakes (deferred 2026-05-20)

Full-suite vitest runs hit rotating timeouts on heavy RTL render tests
(`outcomes.test.tsx` 200-row truncation, `ScenarioCommitDrawer.test.tsx`
focus chain, `deletion-requests/[id]/approve/reject` rate-limit tests).
Each individual test passes in isolation in ~1s. The 5s default timeout
is borderline under concurrent worker CPU contention.

**Workaround applied:** bumped two confirmed flakes to 15s timeout in
`outcomes.test.tsx` and `ScenarioCommitDrawer.test.tsx`. Rotating set
suggests systemic — likely vitest worker pool exceeds CPU cores.

**P0 — Fix root cause**

Audit `vitest.config.ts` pool settings. Suggested investigations:
1. Cap `poolOptions.threads.maxThreads` to `Math.max(1, cpus - 1)` so
   workers don't starve each other under heavy RTL renders.
2. Move slow integration-style suites (deletion-requests, scenario
   commit) to a separate vitest project with sequential execution.
3. Profile a full-suite run to see which tests are actually contended.

Acceptance: 3 consecutive full-suite runs pass without timeout flakes.

---

## PR #149 (audit-2026-05-07 P97) — flaky live-DB fence tests (deferred 2026-05-13)

Three of the twelve P97 fence regression tests in
`analytics-service/tests/test_compute_jobs_fencing.py` were marked
`@pytest.mark.skip` because they hit `httpx.ReadTimeout` at ~120s when run
inside the full live-DB python suite. The suite doubled in size today when
v0.22.25.3 wired test-Supabase secrets into the python CI job (drain
semantics + transition rpc + fence ~ 30 new live-DB tests).

**P1 — Re-enable the 3 flaky tests**

Skipped tests (all in `test_compute_jobs_fencing.py`):
- `test_late_mark_done_with_stale_token_raises_serialization_failure`
- `test_late_mark_failed_with_stale_token_raises_serialization_failure`
- `test_late_mark_done_after_w2_completed_raises_serialization_failure`

Investigation summary (2026-05-13):
- 989 other live-DB tests pass on the same admin client, including 9 of 12
  fence tests (claim, reclaim, token rotation, unexpected-status raise,
  idempotent already-done, mark_failed on done).
- Mocked equivalents pass: `_is_serialization_failure` classifier,
  `LATE_MARK_IGNORED` contract, `dispatch_tick` token threading.
- `mark_compute_job_done` in mig 117 was read carefully: UPDATE → NOT FOUND
  → SELECT → RAISE serialization_failure has no hang path. No `FOR UPDATE`
  in the affected branch, no nested loops, no row locks held beyond a
  millisecond UPDATE.
- Math: 415s total wall time, 3 tests × ~120s timeout ≈ 360s + ~50s for the
  other 989 tests = consistent with each flaky test waiting near the
  default `postgrest_client_timeout=120` for the server to respond.
- Root cause is environmental, not product: the test Supabase project
  (`qmnijlgmdhviwzwfyzlc`) appears to slow under the new live-suite load.
  PostgREST connection pool exhaustion or statement_timeout misconfiguration
  are likely.

Possible fixes (try in order):
1. Bump `postgrest_client_timeout` to 300s in the test admin fixture and
   re-run. If green, lock in.
2. Split the live-DB suite into smaller pytest invocations so connection
   churn doesn't pile up before the 3 tests run.
3. Check the test project's PostgREST `db-pool` / `max-rows` config and
   raise as needed.
4. If still flaky, profile the RPC server-side (Supabase dashboard → Logs)
   to see whether `mark_compute_job_done` actually takes 120s+ or whether
   the request never reaches the function.

When re-enabled, remove the three `@pytest.mark.skip` decorators in
`test_compute_jobs_fencing.py`.

---

## Phase 17 review-fix follow-ups (deferred from /ship pre-landing review, 2026-05-03)

The /ship Step 9.1 specialists flagged 21 findings on the Phase 17 diff
(1 CRITICAL design + 20 INFO across testing/maintainability). The CRITICAL
(WCAG AA contrast in ErrorEnvelope debug_context) was fixed inline before
the v0.20.0.0 cut. The architectural cleanups (operation prop drop,
TrustTier type move, PII scrub consolidation, `{sizeMb}` const extraction)
were also fixed inline. Eight new tests were generated for the testing
specialist's gaps. The remaining items are deferred here.

**P1 — formatCsvRuleCauseMulti — keep, re-evaluate after Phase 19**
The helper is exported from `src/lib/wizardErrors.ts` and tested, but its
only intended consumer (`CsvValidationEnvelope`) inlines its own multi-rule
sentence with humanized labels because the helper signature takes raw rule
keys. Maintainability specialist flagged it as dead surface. Decision (per
/ship 2026-05-03): keep the helper through Phase 19 in case a future
consumer arrives that DOES want raw-key joining. If no consumer appears
by Phase 20+, delete the helper + its test.

**P1 — `e2e/admin-csv-status-axe.spec.ts` admin-user seed**
The spec is gated on `seedTestAllocator()` which mints a regular allocator.
`/admin/csv-status` redirects non-admins to `/discovery/crypto-sma`, so
even when the seed env vars are wired the spec test.skips with a clear
message. The URL assertion (added per ME-02) prevents a false-green scan.
Add `seedTestAdmin()` (parallel to `seedTestAllocator()`) so DESIGN-05's
"axe-core CI scans /admin/csv-status" promise is fully enforced.

**P2 — testing specialist gaps not yet covered**
Several test gaps from the /ship review are intentionally not generated
because the existing suite is already rich. If a regression appears, prefer
adding the targeted assertion over expanding scope:
- DOM-order tests in `ErrorEnvelope.test.tsx` use unscoped
  `document.querySelector`; refactor to `within(getByRole('alert'))`
  queries when next touched.
- `buildDiagBlock` is exported but tested only through the React click
  path. Direct unit tests would be cheaper than render + clipboard mocking.
- `formatCsvRuleCauseMulti` empty-`byRule` edge case (`{}` input) is
  unasserted; only the helper's eventual user can decide whether the
  current "Across 0 rule categories" output is desired.
- `buildEnvelope` recoverable-true path for `KEY_HAS_TRADING_PERMS` (the
  `try_another_key` action) is unpinned in tests.

---

## Phase 16 review-fix follow-ups (deferred from /ship pre-landing review, 2026-05-02)

The /ship Step 9.1 specialists + red-team flagged 16 critical findings on
the Phase 16 diff. Seven were fixed inline before the v0.19.0.0 cut (see
CHANGELOG.md ### Fixed). The remaining nine are deferred here as P1
follow-ups — non-blocking but should land before the milestone closes.
Three INFORMATIONAL findings from the Claude adversarial pass on the
fixes themselves are also tracked.

### P1: Email cron-context chain fragmentation (`src/lib/email.ts`)
**Skill/Component:** observability / email
**Found:** red-team review-pass on Phase 16 diff
**Description:** `resolveCorrelationId()` falls back to `crypto.randomUUID()`
when called outside request scope. Cron-triggered batches (alert digests,
notification fan-out) currently produce a unique cid per email, so the
webhook recovery side sees N unrelated audit chains for what conceptually
should be one event. Fix: thread an optional `correlationId` parameter
through `send()` / `sendAlertDigest()` / `notify*` so cron callers can
pass one cid for the whole batch.
**Confidence:** 8/10. **Severity downgraded:** real but defensive — the
cid still propagates per-email, just doesn't aggregate.

### P1: Email retry false-alarm on UNIQUE violation (`src/lib/email.ts`)
**Skill/Component:** observability / email
**Found:** red-team review-pass on Phase 16 diff
**Description:** `insertCorrelationMapping` retries on transient client error
after the first insert may have committed at the DB level. The retry then
hits migration 098's `UNIQUE (resend_message_id)` constraint and logs
`correlation_chain_broken` even though the row IS present. Fix: detect
`err.code === '23505'` (Postgres unique_violation) on retry and treat as
success. **Confidence:** 7/10.

### P1: VCR cassette substring over-redaction (`analytics-service/tests/conftest_vcr.py`)
**Skill/Component:** observability / testing
**Found:** red-team review-pass
**Description:** `_REDACT_BODY_SUBSTRINGS = ('sign', 'key', 'pass', 'secret')`
matches legitimate non-secret broker fields (`signal`, `signedAt`, `pubkey`,
`keyid`, `passport`, `keyspace`) AND misses real secrets in fields named
`token` / `hmac` / `digest` / `nonce`. Fix: replace substring match with
an allowlist of exact secret-bearing field names per broker, AND extend the
substring set with `token` / `hmac` / `digest` / `nonce` for defense-in-depth.
**Confidence:** 7/10.

### P1: Diagnostic placeholder always returns green (`analytics-service/routers/debug_key_flow.py`)
**Skill/Component:** observability / diagnostics
**Found:** red-team review-pass; also flagged in STATE.md as founder gate
**Description:** Step handlers hard-code `valid: True` and `fetched: 0` —
the placeholder unconditionally returns `status: ok` regardless of actual
broker behavior. If invoked before founder-gate wiring, the diagnostic
tool reports green for all brokers even when test creds are missing or
the broker is down. Fix when 16-07 Task 5 lands: gate router behind an
env flag (e.g., `DEBUG_KEY_FLOW_PLACEHOLDER_OK!=true → 503`) so a green
diagnostic is impossible until real wiring is connected.
**Confidence:** 8/10.

### P1: SSE cancel-path audit-row reliability (`src/app/api/debug-key-flow/route.ts`)
**Skill/Component:** observability / diagnostics
**Found:** red-team review-pass
**Description:** `cancel()` calls `logAuditEvent` after the response has
flushed; the `after()` primitive inside `logAuditEvent` may throw or drop
on Vercel cold-finish because request scope is gone. The closed-loop
client_aborted audit row can be silently lossy under exactly the abort
scenarios the docstring promises to cover. Fix: move the cancel-path
emission into `start()`'s `finally`, gated by a sentinel set by `cancel()`,
so `logAuditEvent` runs while the request scope is still alive.
**Confidence:** 8/10.

### P1: Resend webhook svix-id idempotency (`src/app/api/webhooks/resend/route.ts`)
**Skill/Component:** observability / webhooks
**Found:** api-contract specialist + red-team
**Description:** Webhook handler returns 200 on every event without
storing svix-id for replay protection. Resend retries on >=500 and
receiver timeouts. Path A/Path B are read-only today, but any future
mutation (notification_dispatches.delivered_at, metric counters) becomes
silently double-firing on retry. Fix: add a `webhook_idempotency` table
keyed on svix-id with UNIQUE constraint; INSERT ... ON CONFLICT DO NOTHING
and short-circuit on conflict.
**Confidence:** 6/10.

### P1: API status-code drift between sibling internal routes (`analytics-service/routers/`)
**Skill/Component:** observability / api-contract
**Found:** api-contract specialist
**Description:** New `debug_key_flow.py` returns 401 for bad token and 503
for missing token; sibling `internal.py` returns 403 for both. Operators
relying on status-code conventions get inconsistent behavior across
sibling endpoints. Fix: align both files on 403 (with `detail: "Forbidden"`)
and document the sibling-route contract once.
**Confidence:** 7-8/10.

### P1: repro-key-flow.sh CI Layer A no-op (`scripts/repro-key-flow.sh`)
**Skill/Component:** observability / ci
**Found:** security specialist + maintainability
**Description:** Layer A leak gate reads `DEBUG_KEY_FLOW_*` env vars from
the runner shell; CI doesn't set them, so every loop iteration short-circuits
with `[ -z "$val" ]` and `leak_count` stays 0 regardless of cassette
contents. Fix: replace Layer A with a static known-bad-prefix scan
(e.g. `grep -rE '(whsec_|sk_live_|sk_test_)' tests/cassettes/`) that does
not depend on env presence.
**Confidence:** 7-8/10.

### P1: Wizard fetch missing X-Correlation-Id header
**Skill/Component:** observability / wizard
**Found:** red-team review-pass
**Files:** `src/app/(dashboard)/strategies/new/wizard/steps/{ConnectKeyStep,SyncPreviewStep,SubmitStep}.tsx`
**Description:** Wizard steps display correlationId from `<meta>` in the
error envelope, but the fetch to /api/strategies/create-with-key omits
`X-Correlation-Id` header. Server-side `getCorrelationId()` mints a fresh
cid via crypto.randomUUID(); the cid the user copies from the error
envelope NEVER matches the server's cid. Fix: add `headers: { 'X-Correlation-Id': correlationId }` to the wizard fetch calls so server and client agree.
**Confidence:** 6/10.

### P2: Adversarial-pass INFORMATIONAL findings on the inline fixes

Three findings from the post-fix Claude adversarial pass that did not
warrant an immediate re-fix but should be tracked:

- **`src/app/layout.tsx` `force-dynamic` is redundant** with the existing
  `await headers()` call (Next.js 16 auto-detects). Comment in the file
  documents the migration step when cacheComponents lands. Defensive flag
  is acceptable — drop when migrating to cacheComponents.
- **`src/lib/admin/pii-scrub.test.ts` BAD_SAMPLES not updated** to cover
  the three new denylist entries (`api_key`, `api_secret`, `x-internal-token`).
  Python `test_sentry_init.py` covers the equivalent paths. Add TS samples
  next maintenance pass.
- **`analytics-service/sentry_init.py` frame-vars walker perf** — recursive
  scrub on every captured exception's frame locals can dominate `before_send`
  latency under exception storms with deep middleware stacks. Defer until
  observed perf signal; cap iteration at top-N frames if it ever shows up.

### P2: Python regression tests for new Sentry scrub paths

The TypeScript regression test for the WR-03 cancel-path UUID fix landed
in `route.test.ts` (`[WR-03 cancel] non-UUID inbound cid still produces
UUID entity_id on cancel audit`). Python regression tests for the new
`before_send` walk paths (request.data, request.json, breadcrumbs[*].data,
exception.values[*].stacktrace.frames[*].vars) were added to
`test_sentry_init.py` but **not run locally** because the phase-16 worktree
has no `.venv`. CI pytest run on push will exercise them. If CI fails any
of those new tests, treat as P0.

### P3: pii-scrub.ts test coverage drift

The TS-side `pii-scrub.test.ts` BAD_SAMPLES list (asserted `toHaveLength(20)`)
was not updated when three new denylist entries were added. Add corresponding
positive samples + bump the length assertion. Low priority — Python tests
exercise the parallel paths.

---

## 🔴 HIGHEST PRIORITY

(Previous HIGHEST PRIORITY entry — the "Multistrategy Dashboard (allocator
overview page)" idea — shipped in v0.4.0.0 as the My Allocation restructure.
It evolved during /plan-design-review: instead of a new `/overview` page, the
existing `/allocations` was renamed to "My Allocation" and refocused on the
allocator's single real portfolio. The scope toggle became a Favorites panel
with a dashed "+ Favorites" overlay curve, and saved favorite combinations
land in the renamed "Test Portfolios" section. See CHANGELOG.md and the plan
file at `~/.claude/plans/adaptive-puzzling-yao.md`.)

### ~~P1: Column-level REVOKE on api_keys encrypted columns (SEC-005)~~ — ✅ DONE in v0.5.1.0 (Sprint 1 Task 1.7)
Shipped as 3 migrations (027, 028, 029):
- 027: REVOKE SELECT on encrypted columns + GRANT allowlist + self-verifying DO blocks
- 028: CRITICAL cross-tenant `api_key_id` trigger (found by 3 independent adversarial reviewers as a live attack vector)
- 029: Follow-up hardening (retro-scan, `WITH CHECK`, `FOR SHARE` lock, hardened search_path, `has_column_privilege` verification)
Plus: regression tests, live-DB probe, shared test helpers, demo seed fix.

### ~~Sprint 1 Task 1.1: `/for-quants` public landing page~~ — ✅ DONE in v0.5.2.0
Shipped with 11-voice adversarial review: 5 critical findings resolved + 7 taste decisions.
- Public `/for-quants` page with Hero → Trust → How → Factsheet Sample → CTA
- Codex copy rewrites adopted verbatim ("List a verified track record without exposing trading permissions")
- `/security` page + `public/security.txt` (RFC 9116)
- `RequestCallModal` + `/api/for-quants-lead` public endpoint (CSRF + rate limit + Zod + service-role insert)
- Migration 030: `for_quants_leads` service-role-only table
- `FactsheetPreview` shared server component (extracted from factsheet/[id], reusable by Task 1.2 wizard)
- PostHog dual-layer analytics (server-side `for_quants_view`, client-side CTA click + submit)
- Proxy exemption so logged-in managers can share the page with colleagues
- E2E smoke test + unit + component + static projection tests

### ~~Sprint 1 Task 1.2: "Connect Your Strategy" wizard~~ — ✅ DONE in v0.6.0.0
Shipped with 12-voice adversarial review + review/simplify/ship pipeline:
- 4-step wizard at `/strategies/new/wizard` (ConnectKey / SyncPreview / Metadata / Submit) with visible inline permission block, exchange cards, show/hide secret toggle, progress rail, Delete draft, Request a Call, desktop-only 640 px gate
- Migration 031: `strategies.source` column + `create_wizard_strategy` + `finalize_wizard_strategy` SECURITY DEFINER RPCs + `guard_wizard_draft_updates` trigger + `for_quants_leads.wizard_context`
- New API routes: `/api/strategies/create-with-key`, `/api/strategies/finalize-wizard`, `/api/strategies/draft`, `/api/strategies/draft/[id]`
- `/api/keys/sync` refactored to fire-and-forget via Next.js `after()` pattern
- `FactsheetPreview.verificationState` prop (draft/pending/verified)
- `src/lib/strategyGate.ts` pure helper (used by admin review + wizard)
- `src/lib/wizardErrors.ts` 16-code scripted error matrix
- Task 1.3 admin card enhancement rolled in: source badge, CAGR/Sharpe/Max DD, computed-at recency, View factsheet link
- 16 PostHog wizard funnel events with `wizard_session_id`
- `/security` per-exchange setup guides (Binance, OKX, Bybit) + thresholds, sync-timing, draft-resume anchors
- Fix: pre-existing `ApiKeyManager.tsx:201` retry closure bug

### Sprint 1 follow-ups (deferred from Task 1.1 review)

- **~~security@quantalyze.com DNS alias~~** — ✅ Runbook shipped in v0.6.1.0 at `docs/runbooks/security-contact.md` (full DNS/SPF/DKIM/DMARC setup + smoke-test recipe). DNS config itself is still external infrastructure work; track as a dated checklist item in the runbook once done.
- **~~`for_quants_leads` admin CRM view~~** — ✅ DONE in v0.6.1.0. Page at `/admin/for-quants-leads` with mark-processed / unmark toggle, "from wizard" pill, 500-row truncation warning, shared minute-bucket clock. New "For-quants leads" sidebar entry.
- **~~PostHog dashboard + Slack alert~~** — ✅ Runbook shipped in v0.6.1.0 at `docs/runbooks/posthog-wizard-funnel.md` (5 insights + dashboard layout + SQL ship-metric cross-check). Actual PostHog UI wiring is a 15-minute manual setup per the runbook; Slack alert deferred to Sprint 2 (needs qualified-visit cohort definition first).
- **Signup `?role=manager` handoff** — the query param is currently informational. Wire it into `SignupForm` + `OnboardingWizard` so the role is pre-selected for users arriving from `/for-quants`.
- **Cloudflare Turnstile on `/api/for-quants-lead`** — IP rate limit is enough for Sprint 1; add a captcha if we see spam.

### Sprint 1 follow-ups (deferred from Task 1.2 review)

- **Wizard draft cleanup cron** — Sprint 2. `DELETE FROM strategies WHERE source = 'wizard' AND status = 'draft' AND created_at < now() - interval '24 hours'`. Write it as a single atomic DELETE, not SELECT-then-DELETE, so a concurrent finalize at the 24h boundary races cleanly per Postgres READ COMMITTED semantics.
- **Orphaned `api_keys` cleanup** — Sprint 2. Sweep `api_keys` rows not referenced by any `strategies` row after the wizard draft cleanup runs.
- **Partner pilot CSV export source filter audit** — Sprint 2. Confirm the partner-pilot export path filters by `source` or `status` so any future draft/wizard rows can never leak.
- **Per-exchange setup screenshot walkthroughs** — Sprint 2 polish. The `/security#binance-readonly`, `#okx-readonly`, `#bybit-readonly` anchors currently ship with numbered steps only. Add 3 screenshots per exchange (API management page, edit dialog with only Read checked, save button).
- **~~Downloadable security packet~~** — ✅ DONE in v0.11.1.0 (Sprint 5 Task 5.7). Shipped as `public/security-packet.pdf` (one-page institutional layout) plus the full `/security` editorial page covering AES-256-GCM spec, permissions, SOC 2 posture, data retention, and contact. Regeneration via `scripts/build-security-packet.mjs`; runbook at `docs/runbooks/security-packet-update.md`.
- **Live key permission viewer** — Sprint 2. 3/3 CEO voices wanted the wizard to show the detected scopes returned by the exchange before accepting the key (e.g., "Read ✓ Trade ✗ Withdraw ✗" with color coding). Currently we infer from the read-only check. **Status:** Still deferred — Sprint 5 plan v3 moved 5.8 Key Permission Viewer to a later session; `/security` page is the first half of the trust surface.
- **Status=OPEN cleanup for legacy StrategyForm** — Sprint 3. Once the wizard has been live for a sprint and no one's using `/strategies/[id]/edit` for net-new strategies, remove the legacy StrategyForm flow entirely.
- **~~Allocator intent capture surface~~** — ✅ DONE in v0.14.0.0 (Sprint 8 Phase 2). Shipped as the Mandate tab on `/profile?tab=mandate` via `MandateForm` + 5 sub-components, auto-save on blur, `update_allocator_mandates` SECURITY DEFINER RPC, `allocator_preferences` extended with max_weight / correlation_ceiling / style_exclusions / liquidity_preference / risk_budget_pct / mandate_archetype / preferred_strategy_types / excluded_exchanges. Phase 3 immediately makes the scoring engine consume it (`mandate_fit_score` inside `W_PREFERENCE_FIT`).
- **Founder triage dashboard for allocator intent** — Sprint 3. Pair with the intent capture surface. Still deferred — the Bridge Outcomes widget on `/allocations` partially addresses this from the allocator side, but a founder-facing view across all allocators' mandates hasn't shipped.
- **Strategy sync failure checkpointing** — Sprint 3. If `fetchTrades` succeeds but `computeAnalytics` fails, the current retry re-fetches trades from scratch. Track a `last_fetched_trade_timestamp` so retries resume from the checkpoint.
- **SOC 2 Type II certification + audit report** — Sprint 7. Institutional quants want to see the report.
- **Wizard mobile responsive polish** — Sprint 10. Desktop-only gate at 640 px is a Sprint 1 shortcut; the final product should support mobile without the gate.
- **Extend `withAuth` to forward dynamic route context** — chore. Eliminates the `getAuthedUserIdOrError` inline helper in `/api/strategies/draft/[id]/route.ts` and 8+ other dynamic routes that already inline the same pattern.
- **Extract `useStrategySyncPoller` hook** — chore. Both `SyncProgress.tsx` and `SyncPreviewStep.tsx` implement the same 3-second `strategy_analytics` polling pattern. A shared hook would prevent divergence on the next change.

### Follow-ups from the My Allocation restructure (v0.4.0.0)

These were flagged during `/plan-design-review` and `/plan-eng-review` but
intentionally deferred out of the restructure PR to keep scope tight:

- **STRATEGY_PALETTE colorblind + WCAG AA audit.** Pulled forward by the
  multi-line YTD chart on My Allocation, which makes palette quality more
  visible than the single-portfolio chart on `/portfolios/[id]`. Same concern
  the existing correlation heatmap has. File a tracking issue, audit the
  current palette against colorblind simulators + AA contrast against white.
- **Refactor `PortfolioKPIRow` to the shared-panel pattern.** It currently
  renders four separate `Card` components with centered content on
  `/portfolios/[id]` — the exact "3+ cards in a row" anti-pattern DESIGN.md
  rejects. The new `FundKPIStrip` in the portfolio components folder is the
  reference implementation. Refactor needs design sign-off on the detail
  page visual change.
- **Replace the hardcoded 10% "favorites sleeve"** in
  `computeFavoritesOverlayCurve` with the portfolio optimizer. The optimizer
  already exists (`/api/portfolio-optimizer`) but uses a different input
  shape — wire it through.
- **Favorites sorting/grouping** — v1 is `created_at DESC`. Tags, priority,
  Sharpe-sort, or category groups are all reasonable next moves.
- **Bulk toggle in the Favorites panel** — "toggle all on", "toggle all off".
- **Narrative tooltips on each KPI strip cell** — two sentences each: what
  it means, why it matters. Removes the need for the founder to narrate
  every metric by memory during the demo.
- **Partial unique index integration test** (real Postgres) — proves a
  second real-portfolio insert for the same user hits 23505. Currently
  covered only by the self-verifying `DO $$` block in migration 023 at
  migration time. Same for the `user_favorites` RLS policies.
- **`PortfolioEquityCurve` overlay regression test** — lightweight-charts
  mocking is non-trivial but the `overlayCurve` prop deserves a real test
  that asserts the dashed series is added when non-null and not added when
  null. Today it's protected by TypeScript defaults + lint.
- **Full e2e walkthrough** — `e2e/my-allocation.spec.ts` (Playwright) that
  logs in, lands on My Allocation, toggles a favorite, saves as test
  portfolio, verifies Test Portfolios picks it up, verifies /connections
  still works.

### My Allocation Dashboard -- Widgets Needing New Endpoints

Six widgets are wired into the grid but render placeholder UI because they
depend on data sources that don't exist yet. Listed by priority.

#### ~~P2: Trading Activity Log (Widget 26)~~ — ✅ DONE in v0.10.0.0 (Sprint 4)
Upgraded to prefer real fill data (is_fill=true) over daily P&L summaries. Footnote removed when fills present.

#### ~~P2: Trade Volume Over Time (Widget 27)~~ — ✅ DONE in v0.10.0.0 (Sprint 4)
Same upgrade as Widget 26. Uses real fill data when available.

### Sprint 4 follow-ups (deferred from eng review)

#### ~~P2: Funding rate ingestion (Sprint 5+)~~ — ✅ DONE in v0.11.1.0 (Sprint 5 Task 5.6)
- Shipped: dedicated funding endpoints per exchange (Binance `fapiPrivate_get_income` FUNDING_FEE, OKX `account_bills` type=8, Bybit `v5/account/transaction-log` SETTLEMENT), new `funding_fees` table with 8-hour bucket match_key dedup, `positions.funding_pnl` column populated synchronously in `reconstruct_positions`. Forward-only cutover (existing `daily_pnl` aggregates retain historical funding). PositionsTab now shows "Total ROI (incl. funding)" with per-row price/funding breakdown when funding data is present.

#### P3: Rollback runbook for raw fill data
- What: Document SQL cleanup for derived positions/metrics after USE_RAW_TRADE_INGESTION flag-off.
- SQL: `DELETE FROM positions WHERE strategy_id = X; UPDATE strategy_analytics SET trade_metrics = NULL, volume_metrics = NULL, exposure_metrics = NULL WHERE strategy_id = X;`

#### P3: Daily PnL deprecation (Sprint 6+)
- What: Migrate returns pipeline from daily_pnl to raw fills. Stop generating daily_pnl rows.
- Blocked by: Funding rate ingestion + 2 sprints of stable fills.
- Why: Two parallel data sources is tech debt. The fills are ground truth.

#### P2: Exposure by Asset Class (Widget 28)
- Needs: position-level data from exchange APIs (current holdings per asset)
- Blocked by: exchange position data not currently fetched
- File: `src/app/(dashboard)/allocations/widgets/positions/ExposureByAsset.tsx`

#### P2: Net Exposure Over Time (Widget 29)
- Needs: historical position data aggregated over time
- File: `src/app/(dashboard)/allocations/widgets/positions/NetExposure.tsx`

#### P3: Allocation Over Time (Widget 18)
- Needs: historical weight snapshots (weight changes over time)
- Blocked by: no weight history in current schema
- File: `src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx`

#### P3: Notes Widget (Widget 38)
- Needs: user_notes storage (Supabase table or localStorage with sync)
- File: `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx`

---

## North star — the portfolio story a demo allocator should feel

When an allocator opens their portfolio dashboard in the demo, they should hit
three moments in sequence, in under 60 seconds:

1. **"Oh — this tells me what's working."** A glance shows which strategies
   are earning their weight and which aren't.
2. **"Wait — this told me something I didn't know."** An insight surfaces that
   the allocator couldn't have computed in their head. Correlation regime
   shift. Concentration creep. A strategy quietly underperforming its peer
   group.
3. **"And here's what I should DO about it."** A concrete, plain-English
   recommendation. Rebalance, trim, add — with an expected-outcome framing.

Every idea below is in service of one of those three moments. If an idea
doesn't reinforce one of them, it's probably bloat.

---

## Moment 1 — "What's working?" ideas

- **Winners & losers hero card.** Top 3 contributors and bottom 3 detractors
  to portfolio return over the last 30 / 90 / 365 days. Color-coded, no chart
  needed. Should be the first thing an allocator sees, not buried in a table.
- **Portfolio health score.** One 0-100 number combining Sharpe, drawdown
  recovery, correlation spread, capacity utilization. Gives the allocator one
  thing to react to before they dig into details.
- **Return attribution, trailing 90 days.** Which strategies drove returns,
  which dragged. We already have the attribution bar — it needs to be the
  opening move of the dashboard narrative, not a secondary panel.
- **Drawdown story card.** Not just "you beat BTC" but "you beat BTC on the
  way up (+18% vs +12%) AND on the way down (-5% vs -22% drawdown)." The
  drawdown half is what wins LP meetings.
- **Peer benchmark.** Anonymized comparison against other institutional
  allocators on the platform with similar mandates. "Your Sharpe is 1.4; the
  median L/S Equity Stat Arb mandate on Quantalyze is 0.9." Social proof on
  top of quant data — only Quantalyze has this because only Quantalyze has
  verified peer data.

## Moment 2 — "What I didn't know" ideas

- **"Biggest risk right now" sentence.** One plain-English call-out generated
  from the correlation matrix + concentration + drawdown signals. "55% of your
  portfolio trades on one exchange — that's counterparty concentration, not
  diversification." Or: "Your highest-Sharpe strategy is also your highest-
  drawdown — concentration risk masked as alpha."
- **Correlation regime change alert.** Rolling 30-day average pairwise
  correlation vs. prior 30. "Your portfolio was 0.12 correlated last month;
  it's 0.35 now. Aurora × Nebula flipped from -0.05 to +0.41." Detects the
  stealth regime shift most allocators don't notice until after a drawdown.
- **Underperformance detection.** "Stellar Neutral Alpha has trailed its
  market-neutral peer group by 4% over the last 8 weeks." Proactive, not
  something the allocator has to go fishing for.
- **Capacity health per strategy.** % of max_capacity allocated, surfaced as
  a gauge. A strategy at 90% of its cap is a flag — the allocator should know
  before they add a ticket.
- **Concentration creep warning.** "Your Marcus Okafor exposure was 22% last
  month; it's 31% now due to strong performance." A rebalance nudge without
  being preachy.
- **Monthly performance commentary.** Auto-generated plain-English paragraph.
  "In March, your portfolio returned 2.3%, beating BTC by 1.1%. Stellar drove
  60% of the gain; Aurora was flat; Nebula lost 0.3% from a brief drawdown
  in week 3." The LLM infra is already on the stack.
- **Stress test.** "What happens if BTC drops 30% over 2 weeks?" Simulate
  against the current portfolio using historical covariance. Output is a
  single drawdown number with a confidence band and a "would you survive
  this?" framing.

## Moment 3 — "What should I do?" ideas

- **"What we'd do in your shoes" narrative.** Reads the optimizer output and
  frames it as a 2-sentence recommendation. "If you trim Stellar by 10% and
  redistribute to Aurora + Nebula, expected Sharpe goes from 1.2 to 1.5 at
  equivalent drawdown. Here's why." The optimizer is 80% built — the framing
  is what's missing.
- **"Where would the next $5M go?"** Concrete dollar decision, not abstract
  weights. "We'd put $2M into Aurora, $2M into Orion from the exploratory
  lane, $1M into cash." This is the unique Quantalyze value prop: we tell
  you where the next dollar goes.
- **Rebalance to target.** If any strategy's current weight has drifted more
  than 5% from its target, surface a one-click "rebalance" action. Needs the
  target_weight column the schema was supposed to have.
- **"Show me a strategy that would diversify this."** Button-driven. Runs
  the optimizer in "add a strategy" mode and returns the top match from the
  full directory. The match engine's allocator-facing incarnation.
- **Side-by-side portfolio alternatives.** "Portfolio A: your current
  allocation. Portfolio B: our recommendation. Same risk, 20bps higher
  expected return. Here's what changed." A before/after comparison inside
  the dashboard itself.
- **"One thing to do this week."** A single recommended action, not a list.
  The weekly nudge that keeps the relationship alive between allocations.

---

## Ideas for making the demo narrative land

Not portfolio features. The scaffolding that makes the hero story hit.

- **Three seeded allocator personas with distinct stories.** "The
  concentrated winner" (2 strategies, high Sharpe, high concentration). "The
  over-diversified underperformer" (6 strategies, low correlation, mediocre
  return). "The balanced target" (4 strategies, positive alpha vs. BTC,
  healthy risk). The founder picks which persona to demo based on the
  prospect's own situation.
- **Narrative through-line.** Don't demo features, demo the story. "Meet
  Alice. Here's her portfolio. Here's where she's bleeding. Here's what we
  do about it. Here's the before/after outcome." The dashboard should feel
  like watching a story unfold, not browsing a control panel.
- **Live alert that fires during the demo.** Seeded so a "correlation spike
  detected" banner appears mid-walkthrough. Shows the platform is alive, not
  a static screenshot.
- **Sample portfolio PDF report.** The portfolio-pdf route exists but the
  demo needs a sample that looks like an LP report someone would actually
  forward to their investment committee. A one-click download at the end of
  the walkthrough, with a visible "This is what you'd send to your IC" label.
- **One-click "send this to my IC" export.** PDF or email with the hero
  cards + insights. Ends the demo with a concrete next step the allocator
  can actually take.
- **Narrative tooltips on every KPI.** Two sentences: what it means, why it
  matters. Helps the founder present without narrating every metric from
  memory, and gives the allocator a reason to hover.
- **Mobile-first portfolio dashboard.** If the friend opens the link on
  their phone, the hero cards must work on mobile. Desktop-first is the
  current state.

---

## Ideas worth deferring

Tempting but not the hero. Don't spend the two sessions on these unless the
above is complete.

- Custom benchmark per allocator (BTC is fine for v1).
- ML / collaborative filtering for the optimizer (needs historical data).
- Save / dismiss / feedback loop on the allocator side.
- Full white-label partner portal (CSV-upload sketch is enough).
- Manager-side "who was I recommended to" dashboard.
- Real-time WebSocket refresh (hourly cron is fine).
- Organizations / teams model.
- Dark mode.

---

## Tech debt that could visibly break the demo

Kept short on purpose. Only the things that would lose the partner's trust
if they surfaced during a live walkthrough.

- Puppeteer cold-start hang on portfolio PDF — no timeout guard. First PDF
  download of the day could hang the Vercel function.
- Analytics service Railway cold start on the first request of a session.
  Catch it with a pre-flight warm-up.
- Mobile layout breakage below 375px on the portfolio dashboard, never
  tested at that viewport.
- Eval dashboard empty-state copy reads "No intros shipped" for a fresh
  partner pilot — should read as a promise, not an apology.
- Correlation heatmap uses a color palette we haven't audited against
  DESIGN.md. Colorblind safety unchecked.

---

## Shipped (reference)

The cap-intro sprint on 2026-04-08 merged 9 PRs covering the disclosure-tier
render guard, the match engine allocator-context fix, the Active Allocator
portfolio seed, hourly match-engine cron, the `/demo` public shareable URL,
the partner ROI simulator, the partner-pilot CSV upload + filtered eval
dashboard, and the friend meeting script. Earlier work (Sprint 1-6
portfolio intelligence platform, perfect match engine, disclosure tier +
compliance shell, tear sheet, recommendations) is on `main` and documented
in git history.

The portfolio intelligence platform already includes: portfolio dashboard,
equity curve, composition donut, correlation heatmap, risk attribution,
attribution bar, benchmark comparison, founder insights, allocation
timeline, strategy breakdown table, the optimizer endpoint and component,
alerts list, documents tab, and PDF export. Most of the "Moment 1-3"
ideas above are re-framings of existing components, not greenfield builds.

---

## Open follow-ups from the `/simplify` reviews (2026-04-08)

Small cleanup debt the reviewers flagged on the cap-intro sprint PRs, kept
here so the next session can opportunistically close them.

- ~~`/api/demo/match` is a near-verbatim copy of `/api/admin/match`; extract a
  shared query helper.~~ **DONE in hardening PR 6** — extracted to
  `src/lib/admin/match.ts::getAllocatorMatchPayload`.
- `/demo/page.tsx` re-implements `formatPercent`, `formatNumber`,
  `formatCurrency`, and `extractAnalytics` instead of importing them from
  `lib/utils`.
- ~~`ensureAuthUser` in the partner-import route duplicates the seed script's
  user-exists handling — promote to a shared helper.~~ **DONE in hardening
  PR 6** — extracted to `src/lib/supabase/admin-users.ts::ensureAuthUser`.
  Seed script keeps its own inline handling (intentional — it has different
  "fixed-UUID idempotent" semantics that the shared strict-mode helper
  doesn't fit).
- ~~`ALLOCATOR_ACTIVE_ID` and the `^[a-z0-9-]+$` partner-tag regex are
  hard-coded in three files each.~~ **DONE in hardening PR 6** — extracted
  to `src/lib/demo.ts` and `src/lib/partner.ts`.
- ~~Four "left-border-accent" banners (filtered eval, read-only preview,
  partner pilot hero, partner import success) should be a `ScopedBanner`
  primitive so the trust-critical filter banner stays structurally in sync.~~
  **DONE in hardening PR 8** — extracted to
  `src/components/ui/ScopedBanner.tsx` with 4 tones (accent/neutral/warning/
  success) and 4 call sites consolidated. Filtered vs. unfiltered symmetry on
  the eval dashboard is now enforced at the component level.
- `useAnimatedNumber` rapid-change behavior: verify the tween doesn't
  degrade to a snap-to when the target updates every frame.
- `match_eval.py` N+1 query pattern: each intro triggers two sequential
  Supabase round-trips in `_find_strategy_rank_in_latest_batch_before`.
- Partner-import processes CSV rows sequentially — a 10-row CSV is 30-40
  round-trips. Batch-upsert profiles + strategies in one call per table.

---

## ~~Claude design deferred items pr4~~ — ✅ DONE in PR4

All four items shipped in a single PR:
- **#1 Equity card single-row header**: lifted `period` / `customRange` /
  `pickerOpen` state into `EquityChartWidget` (controlled-state escape
  hatch on `EquityChart` via new `period` / `onPeriodChange` /
  `customRange` / `onCustomRangeChange` / `hideHeader` / `hideLegend`
  props). Uncontrolled mode preserved for ScenarioComposer + standalone
  tests. Wrapper now renders title + legend chips + period toggle +
  CUSTOM picker + sync stamp on a single header row, byte-aligned with
  `designer-bundle/project/src/app.jsx:142-200`.
- **#2 KPI strip cell separators**: `KpiStripWidget` was already
  rendering `borderLeft` separators but referenced an undefined
  `var(--border)`; fixed to `var(--color-border)` so the dividers
  resolve through the Tailwind v4 `@theme inline` token.
- **#3 `displayFont` Tweaks knob**: `TweaksProvider` now writes
  `body[data-display-font]` and `globals.css` carries a single rule
  that swaps `.font-display { font-family: var(--font-sans); }` when
  the attribute reads `"sans"`. Zero consumer-side changes.
- **#4 Y-axis tick density**: `EquityChart`'s `yTicks` walker now
  enforces a 5-tick minimum by selecting the LARGEST nice-candidate
  step that still produces ≥ 5 ticks, accepting sub-1% steps like
  `0.25%` on tight ranges so test-data renders never collapse to 3
  ticks.

Source: `.gstack/qa-reports/qa-report-allocations-2026-04-26.md` §Remaining
minor deltas. Original write-up retained below for reference.

### 1. Equity card single-row header
**Severity: Low.** Truth has `Equity curve` title + Portfolio/BTC legend
chips + period toggle (1M/3M/6M/YTD/1Y/ALL/CUSTOM) + `sync 2m ago` stamp
all on the SAME row inside the card header. Production currently splits
into two rows (card header with title alone; chart body with the
toggle/legend/sync stamp).

To match exactly we need to lift `period` and `customRange` state from
`EquityChart` up into `EquityChartWidget`, then render the rich header in
the wrapper card. The internal SVG component then becomes presentational
(props in, no internal toggle state). Touches: `EquityChart.tsx`
(state-removal + props), `EquityChartWidget` (header markup +
state owner), `EquityChart.test.tsx` (most period-click tests move up to
the widget level), every other consumer of `EquityChart` (none today,
but worth checking before lifting). Not invasive in raw LOC, but it's
the kind of refactor that needs its own commit and its own QA pass.

### 2. KPI strip cell separators
**Severity: Low (cosmetic).** Truth has a subtle `1px var(--color-border)`
vertical rule between adjacent KPI cells (AUM | YTD TWR | Sharpe | Max DD
12M | Avg ρ). Production renders them as a clean 5-column grid with no
divider. The fix is one CSS change in `KpiStrip.tsx` — likely a
`divide-x divide-border` Tailwind utility on the row, or per-cell
`border-l border-border first:border-l-0`.

### 3. `displayFont` Tweaks knob is a no-op
**Severity: Low.** PR3's `TweaksContext` exposes `displayFont` as a
`"serif" | "sans"` knob in the panel, but no consumer reads it yet.
Production headings already use `.font-display` (which resolves to
Instrument Serif via `--font-serif`); the knob would need to flip every
display-headline consumer to either the serif class or a sans fallback.

Approach: add a `useDisplayFontClass()` hook in `TweaksContext.tsx` that
returns `"font-display"` or an empty string, then wire it into every
heading where the knob should bite (My Allocation H1, KPI cell labels,
Bridge "All clear" headline, Equity curve title, Holdings header,
Allocation by style header, etc.). Probably 8-15 sites. Or — simpler —
toggle a `data-display-font="sans"` attribute on `<body>` in the provider
and add a single CSS rule that swaps `.font-display { font-family:
var(--font-sans); }` when the attribute is set. The attribute approach
is one-line and avoids touching every consumer.

### 4. Y-axis tick density on narrow ranges
**Severity: Low.** The `yTicks` calculation in `EquityChart.tsx` adapts
to the visible data range — when returns hover near zero (test data
case), only 3 ticks render (`+0% / -0.5% / -1.0%`). Truth shows 5 evenly
spaced ticks (`0.0% / 7.1% / 14.2% / 21.4% / 28.5%`) because the truth
data has a much wider return range.

The algorithm IS working as designed (snap to "nice" 1/2/2.5/5/10
percentage steps based on span). The PR4 question is whether to force a
minimum of 5 ticks regardless of span — at the cost of awkward
fractional steps like `0.25%` on tight ranges. Probably worth a /qa pass
on a real account with realistic returns before deciding.

---

## Phase 18 v0.22.1.0 hotfix — deferred follow-ups

**Priority:** P1 — surface during v0.22.1.0 landing review; not in scope for the hotfix because they require design or touch out-of-branch code.

### Founder LP cron idempotency (H2 from adversarial review 2026-05-07)

The monthly founder LP cron (`src/app/api/cron/founder-lp-report/route.ts`) sends the Resend success email FIRST then returns 200. Vercel cron retries on non-2xx. If the lambda dies AFTER Resend accepted the message but BEFORE the 200 is returned (e.g., the 60s `maxDuration` ceiling fires during the post-send timing window), Vercel retries and **the founder receives two LP emails**.

Blast radius is small (founder only, once a month), but on a credit-counted Resend plan it's real cost and the per-month idempotency was explicitly scoped out in v0.22.0.0 ("manual POST blast radius is one extra email"). Fix path: write a `compute_jobs`-style row keyed on `(cron_name, year_month)` and short-circuit if a successful row exists. Design call — needs its own plan.

### Founder LP cron timeout-budget math doesn't fit lambda (L2 from adversarial review 2026-05-07)

Worst-case timeout sum in `src/app/api/cron/founder-lp-report/route.ts:81-107`: 25s (initial fetch) + 20s (max retry-after) + 25s (retry fetch) + 15s (Resend send) = 85s vs 60s `maxDuration`. The comment claims "leave plenty of headroom" but math doesn't add up. Won't bite on most ticks (retry-after caps don't fire often) but a flaky factsheet endpoint could wedge the lambda at 60s, Vercel retries, idempotency bug above (H2) double-fires.

Fix path: shrink `FETCH_TIMEOUT_MS` from 25s → 15s and `MAX_RETRY_AFTER_S` from 20s → 5s. New worst case: 15 + 5 + 15 + 15 = 50s, comfortable inside 60s. Or extend `maxDuration` to 90s explicitly. Touches code outside the hotfix branch — separate PR.

### `/api/alert-digest` cron verb mismatch (A3 from api-contract specialist 2026-05-07)

`vercel.json` lists `/api/alert-digest` as a daily cron at `0 9 * * *`. Vercel cron dispatches GET. `src/app/api/alert-digest/route.ts:24` only exports POST → every cron tick has been returning 405 Method Not Allowed since the cron was added. Pre-existing on `main`, not introduced by this hotfix, but the same class of bug as the founder LP cron's proxy-redirect issue — silent failure that the alerting system can't see because Vercel cron failure detection happens at the orchestrator level.

Fix path: add `export const GET = POST;` to `src/app/api/alert-digest/route.ts` (matches the pattern in all 6 `/api/cron/*` handlers). Verify Sentry/structured logs show actual digest emissions before declaring fixed. Separate PR.

### Migrate `extractAnalytics` consumers off `@/lib/queries` barrel (M2 from maintainability specialist 2026-05-07)

Four files still import `extractAnalytics`/`EMPTY_ANALYTICS` from `@/lib/queries` (a barrel that transitively pulls in `@/lib/supabase/admin` → `"server-only"`). All four are Server Components or API route handlers, so they're fine today — but the asymmetric pattern (some files use `@/lib/utils`, some `@/lib/queries`) is the trap that bit the readiness helper. Delete the re-export at `src/lib/queries.ts:167` and migrate the four consumers to import from `@/lib/utils` directly.

Fix path: mechanical refactor across `src/app/portfolio-pdf/[id]/page.tsx`, `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts`, `src/app/api/factsheet/[id]/pdf/route.ts`, `src/app/(dashboard)/compare/page.tsx`. Also remove the now-redundant `vi.mock` in `src/app/(dashboard)/compare/page.test.tsx:22`. Once done, the explanatory comment in `readiness.ts` can shrink further.

### P2: Cross-process portfolio-recompute UNIQUE INDEX (red-team HIGH from v0.22.39.0 audit-2026-05-07 cron.py round)

**Priority:** P2 — known structural limitation; v0.22.39.0 documents the gap honestly in `analytics-service/routers/cron.py` comment but does not close it.

`analytics-service/routers/portfolio.py:46` defines `_compute_semaphore = asyncio.Semaphore(3)` and `_compute_portfolio_analytics` INSERTs a new `portfolio_analytics` row with `computation_status='computing'` unconditionally. The cron-sync TOCTOU guard at `analytics-service/routers/cron.py` (`_guarded_recompute`) does a SELECT for an in-flight row before the compute, but: (a) the semaphore is process-local so two Vercel function instances or worker pods can both pass through their own caps, and (b) even in the same pod the Semaphore(3) admits 3 coroutines concurrently, so two cron coroutines both SELECT-see-empty and both INSERT a `computing` row for the same portfolio.

Fix path: add a Postgres migration `UNIQUE INDEX portfolio_analytics_one_computing_per_portfolio_idx ON portfolio_analytics(portfolio_id) WHERE computation_status='computing'`, then catch `UniqueViolation` in `_compute_portfolio_analytics`'s INSERT branch and map it to the same "skip — already in-flight" path the cron router uses. Alternative: `pg_try_advisory_xact_lock(hashtext(portfolio_id))` inside the compute. Either closes the gap cross-process; current state is "best-effort within-process throttle" and v0.22.39.0's comment says so honestly.

Blast radius if it bites: two duplicate `portfolio_analytics` history rows for the same portfolio, two competing computes hitting Supabase, alert fan-out triggering twice. Hasn't been observed in prod, but the architectural seam is real.

### P2: holdingsSummary symbol-only dedup loses spot+perp rows for the same symbol (Grok adversarial 2026-05-20)

**Priority:** P2 — pre-existing structural bug surfaced during the spot/futures split (v0.23.1.0). Not introduced by that PR; not worsened by it either.

`src/lib/queries.ts:1779` builds `holdingsMap = new Map<string, ...>()` keyed by `r.symbol` only and does `holdingsMap.set(r.symbol, r)` for the latest-asof-per-symbol collapse. If an allocator holds BOTH spot BTC and a BTC perpetual position on the same or different venues, the two rows share `symbol = "BTC"` and the second-processed wins — the first row is silently dropped from `holdingsSummary`. After the v0.23.1.0 spot/derivative partition, this manifests as one of the two surfaces being empty for that symbol (spot section missing OR Open Positions section missing, depending on row ordering).

Fix path: key the map by `(venue, symbol, holding_type)` instead of `symbol`. The unique-index anchor on `allocator_holdings` is `(allocator_id, venue, symbol, asof)`, but the IN-RAM collapse predates the spot/derivative split and never accounted for the multi-row-per-symbol case. Single-file change, no migration needed.

Blast radius if it bites: an allocator with leveraged BTC perp + spot BTC sees only one of the two rows on the dashboard. Equity curve is still correct (computed server-side from full `allocator_equity_snapshots`).

---

## queries / SSR payload

### P1 — Remove dead `holdingReturnsByScopeRef` SSR pipeline

Remove `reconstructHoldingReturnsByScopeRef` (`src/lib/queries.ts:2994`) and the
`holdingReturnsByScopeRef` payload field (`:1730` type + `:3101`/`:3411`
construction sites) plus the orphaned tests that pin it. The field has had **zero
production consumers since v1.6 phase 63** — nothing in the component tree reads
it, so it is pure per-request compute plus dead RSC payload weight on every
allocator SSR render.

Deferred at ship 2026-07-03 (user decision, planning-locked — LEAVE IT for now).
Documented here so the removal is a deliberate follow-up, not silently lost.

