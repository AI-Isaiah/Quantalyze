---
phase: 162-honest-what-the-user-sees-is-true
reviewed: 2026-08-26T09:40:00Z
depth: standard
files_reviewed: 49
files_reviewed_list:
  - .github/workflows/ci.yml
  - analytics-service/routers/portfolio.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_computation_error_curated.py
  - src/__tests__/retention-orphaned-running-terminalize.test.ts
  - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx
  - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
  - src/app/(dashboard)/my-strategies/page.tsx
  - src/app/(dashboard)/portfolios/[id]/equity-curve-series.test.tsx
  - src/app/(dashboard)/portfolios/[id]/page.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.preselect-refusal-class.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/api/strategies/[id]/returns/route.test.ts
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/components/connect/KeyPermissionBadge.test.tsx
  - src/components/connect/KeyPermissionBadge.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/components/strategy/StrategyTable.pending-chip.test.tsx
  - src/components/strategy/StrategyTable.stale-analytics.test.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/lib/analytics-schemas.test.ts
  - src/lib/analytics-schemas.ts
  - src/lib/types.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.ts
  - supabase/migrations/20260826120000_computation_error_curated_copy.sql
  - supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql
  - supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql
  - supabase/tests/test_compute_jobs_error_kind_copy_parity.sql
  - supabase/tests/test_create_wizard_strategy_for_key.sql
  - supabase/tests/test_retention_orphaned_running.sql
  - supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
  - supabase/tests/test_sync_status_marked_refresh_protected.sql
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
status: findings
---

# Phase 162: Code Review Report

**Reviewed:** 2026-08-26T09:40:00Z
**Depth:** standard
**Files Reviewed:** 49
**Status:** findings (1 Warning, 4 Info — **none blocking** under the stopping rule; no user-facing or data-integrity defect found)

## Summary

Reviewed all 49 in-scope files against `3fa26831..HEAD`, with weight on the parallel-worktree
fix commits, the TypeScript ↔ SQL ↔ Python boundary, and `ci.yml` per the review brief. Verification
performed during review (all green, measured — not assumed):

- `npx tsc --noEmit` — clean.
- All 21 phase test files run under vitest: **1,238 tests, 0 failures** (including the NUL-byte
  `wizardErrors.test.ts`, executed via vitest which is not grep-blind to it).
- `src/__tests__/contracts/check-zod-db-check-parity.test.ts` and
  `ci-anti-skip-gate.contract.test.ts` — green at this HEAD.
- `python3 -m pytest tests/test_computation_error_curated.py` from `analytics-service/` — 3 passed.
- `python3 -m mypy --strict routers/portfolio.py services/job_worker.py` — clean (the latent-mypy
  ship trap does not fire here).

**Cross-boundary parity, verified directly:** `ErrorKind` (types.ts:1677) ==
`GetUserComputeJobsRowSchema.error_kind` z.enum (analytics-schemas.ts:198) ==
`compute_jobs_error_kind_check` in mig 20260826140000 (`transient|permanent|unknown|orphaned`),
and the parity contract resolves the NEW named constraint (latest-file-wins), not the stale
20260411144407 inline set. `computation_error_copy`'s CASE arms match the CHECK's admitted set and
are cross-gated both directions by `test_compute_jobs_error_kind_copy_parity.sql`.

**ci.yml floors (edited by two agents), re-derived from the corpus:** 7 sentinel-declaring files,
declared arms 9+6+10+10+8+4+16 = 63 — matches `SENTINEL_FLOOR=7` / `ARMS_FLOOR=63` exactly; the
new gate declares 9 arms against 18 `RAISE EXCEPTION` sites (lower-bound check satisfied). The two
agents' edits landed as one coherent hunk; no drift.

**Migrations:** all three parse-and-apply (the SQL-function snapshot regeneration at `8ed54d424`
proves a real apply). Self-verify canaries were confirmed present in the actual function/cron
bodies (`CANARY_162_F3_PROSE_ONLY` at mig-120000:269, `CANARY_162_05_PROSE_ONLY` inside the
`$fn$` body at mig-130000:116, `CANARY_162_V1_PROSE_ONLY` in the cron body at mig-140000:224) —
each self-verify's "stripper ran" arm has its witness. The `v_fn ~* 'last_error'` tripwire in
mig-120000 was checked against the full function body *including comments*: no hit, so the
migration cannot self-abort on its own prose. Ordering dependency (140000's verify calls
`computation_error_copy`) is satisfied by timestamp order. `create_wizard_strategy_for_key` holds
the three-layer tenant boundary as claimed; the advisory xact-lock + post-lock draft lookup closes
the double-mint race; the `strategies`/`strategy_keys` EXISTS pair fail-closed covers composite
membership the client resolver cannot see (routed to 55006 → `VENUE_ALREADY_CONNECTED`).

**Parallel-worktree fix interaction (the brief's main worry):** the B-1/B-2/B-2a/B-2b fixes
(13217d365, b2922d3ce) and the 162-05/162-06 base landed coherently — `surfaceIsNot` defaults
render-on-absence as documented, every `fixRequires` array is index-aligned to its `fix` array,
`KEY_REUSE_UNAVAILABLE` is a member of `KNOWN_CREATE_WITH_KEY_CODES`, and the Retry routing in
ConnectKeyStep's preselect branch is consistent with each code's `actions` (verified arm by arm:
shape-refused 400 suppresses Retry; `SERVICE_UNREACHABLE` re-sends; `try_another_key` codes route
to "Use a different key"; non-recoverable codes render no Retry regardless of the passed handler).
The chip fix (298bebc12) and the F-4 amendment (0630f4bc0/7ad707d5a) agree; `FreshnessChip` has
exactly one call site, so the signature change strands no caller. The `next build` page-export
question was checked against Next 16.2.11's actual validator (`.next/dev/types/validator.ts`):
it is a structural `extends AppPageConfig` check, so the new named exports from
`portfolios/[id]/page.tsx` are legal — no build break.

**Explicitly clean areas:** no hardcoded secrets, no debug artifacts, no injection surface in the
new route arm (both refusal discriminators are SQLSTATE, not message substrings; body values
never reach SQL unparameterized), scrub discipline intact on every new log line, the RSC-boundary
strip in `stripConstituentSeries` discloses nothing beyond what RLS-readable rows already serve,
and the STALE-01 gate (`isRankableAnalyticsRow`) is applied at the value site on both widened
surfaces (`/returns` scalars, portfolio equity curves) as the CONTEXT constraint demands.

Per the brief, the following were NOT re-derived: the ScenarioComposer seam-fault class, the
wizard preselect refusal class, the `orphaned` error_kind design, the freshness badge decision,
the comment-satisfiable SQL-gate class, the `service_role` uid ceiling (T-162-05-E), the two new
gates' RED-until-applied state on TEST, and HONEST-07.

## Narrative Findings (AI reviewer)

### Warnings

#### WR-01: D-162-4's strict sweep left two in-repo writers of developer-audience copy into the user-visible `strategy_analytics.computation_error` — and they are filed nowhere

**Files:**
- `analytics-service/services/job_worker.py:5095-5124` — the MT5-12 verdict refusal stamps
  `_detail`, which interpolates a scrubbed *repr of producer metadata*
  (`series_completeness={_verdict_repr}`) and the developer sentence "MT5-12: every daily-series
  producer must state whether the venue inputs it consumed were whole." into the column the
  portfolio/wizard surfaces render.
- `analytics-service/services/job_worker.py:7032-7037` — the composite annualization-clock stamp
  interpolates `({periods_per_year}/yr)` / `({_venue_blend_periods}/yr)` and instructs
  "Re-derive asset_class (crypto for a crypto-venue composite)." — a remedy addressed to an
  engineer, rendered to an account holder.

**Issue:** D-162-4 ("strict — map the prefixed-`scrubbed` writers too") was scoped to the
`message + scrubbed` suffix sites, all of which were correctly converted to the `detail=` split.
These two sites are the same class through a different mechanism — interpolated internals rather
than appended exception text — and were untouched (both pre-date the phase; neither line is in
the diff). `deferred-items.md` D2 files the two *SQL* siblings of exactly this class
(`'watchdog: stale row'`, the PI-07 migration-filename string) but not these two Python sites,
so the class closure is incompletely recorded.

**Failure scenario:** an MT5 strategy whose producer omits the completeness verdict, on any path
where the stamp lands and `mark_compute_job_failed` is delayed or fails (network fault between
the stamp and the RPC), shows the account holder
`Series completeness verdict missing or unrecognised (series_completeness=None). MT5-12: …`.
Exposure is a window in the common case because the SQL bridge overwrites the column on the job
transition (the 164.2 measurement), which is also why this is **not blocking**: transient,
pre-existing, no data-integrity effect, and 164.2's provenance work will subsume the boundary.

**Fix:** at both sites, move the interpolated internals into the `detail=` channel the phase
built (or the `DispatchResult.error_message` operator string) and leave a fixed sentence in
`message`. One-line-per-site change; alternatively append both sites to `deferred-items.md` D2 /
the Phase 164.2 scope so the class is at least fully enumerated. **Classification: hygiene
(non-blocking) — residual of an already-swept class, transient exposure.**

### Info

#### IN-01: The "RED until applied to TEST" set is four SQL test files, not the two accepted

**Files:** `supabase/tests/test_sync_status_marked_refresh_protected.sql:210-214` (new gate 0b
hard-fails unless the function comment carries `20260826120000`);
`supabase/tests/test_retention_orphaned_running.sql:261-266` (V-1 canary + the F-3
`'orphaned'`×2 / `'permanent'`×0 counts hard-fail against the pre-140000 cron body).

**Issue:** the accepted-findings list names only the two *new* gates
(`test_create_wizard_strategy_for_key.sql`, `test_compute_jobs_error_kind_copy_parity.sql`) as
RED until their migrations reach TEST. The two *amended* files above will be RED on the same
TEST database for the same reason. Deliberate design (fail-loud, never skip) and correct — but
whoever watches the db-test job should expect four red files, not two, or the extra two reds
will read as regressions. Hygiene; not blocking.

#### IN-02: Four curated stamp sentences end with a trailing space

**File:** `analytics-service/services/job_worker.py:3950-3954, 4376-4379, 4645-4649, 4716-4719`
**Issue:** the `stamp_detail` literals passed to `_dispose_broker_nav_error` retain the trailing
space that used to separate them from the now-removed `+ scrubbed` suffix (e.g.
`"…non-finite NAV/flow amount). "`). The value lands verbatim in the user-visible column.
**Fix:** drop the trailing space inside the four string literals (the sibling direct-stamp sites
already did this in the same diff). Cosmetic.

#### IN-03: Coverage caption grammar breaks at `omitted === 1`

**File:** `src/app/(dashboard)/portfolios/[id]/page.tsx:340-345`
**Issue:** `EquityCurveCoverage` renders
"…— 1 without a usable return series **are** omitted." when exactly one constituent is omitted.
**Fix:** `omitted === 1 ? "is" : "are"` (or reword to avoid the copula, e.g.
"…— ${omitted} omitted (no usable return series)."). Cosmetic, on a disclosure line this phase added.

#### IN-04: The 42501 arm tells the user to sign out for a fault that is ours

**File:** `src/app/api/strategies/create-with-key/route.ts:674-679` (new reuse arm; mirrors the
incumbent credential arm at :1447-1452)
**Issue:** `create_wizard_strategy_for_key` raises `insufficient_privilege` only when the
*server's* client is not `service_role` — a deployment/credential misconfiguration. The response
copy "Permission denied. Please sign out and back in." attributes it to the user's session and
prescribes a remedy that cannot work. The new arm faithfully matches the existing convention
(Rule 11), so this is filed as a copy-honesty observation for the 164.2 curated-copy pass, not a
defect introduced here. A `SEAM_MISCONFIGURED`-style 503 would be the truthful shape.

---

**Blocking assessment (project stopping rule):** no finding above is user-facing-false-at-rest or
data-integrity; WR-01's exposure is a transient window on a pre-existing class already owed to
Phase 164.2. **Nothing in this review blocks the phase.**

_Reviewed: 2026-08-26T09:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
