---
phase: 63-holdings-snapshot-fallback-engine-removal
plan: 05
subsystem: allocations/scenario-engine — series-space durability guard + prod cleanup gate
status: complete
completed: 2026-07-03
tags: [ENGINE-05, GUARD-01, GUARD-02, GUARD-03, guard-test, source-scan, checkpoint]
requirements: [ENGINE-05, GUARD-01, GUARD-02, GUARD-03]
dependency_graph:
  requires:
    - "63-04 (whole holdings-engine deleted: builder + dealias gone; queries.ts gate=false → emptyDefault; tree clean of every banned identifier)"
  provides:
    - "ENGINE-05 standing invariant: a vitest guard fails loud if any deleted holdings-engine identifier (buildStrategyForBuilderSet, collapseAliasedHoldingStrategies, mapDeAliasedWeightsToRawBasis, symbolByHoldingId, scenario-dealias) reappears in a scenario-surface source, or if the 3-token subset reappears in queries.ts, or if any surviving series-space builder emits a 'holding:' engine unit id"
  affects:
    - "GUARD-01 (prod residue deletion) — orchestrator/checkpoint, still PENDING"
    - "Phase 63 gate (Task 3) — full suite + coverage + GUARD-02 verbatim survivors + GUARD-03 zero-diff — still REMAINING (sequenced after the GUARD-01 checkpoint)"
tech-stack:
  patterns:
    - "source-scan guard (readFileSync class, admin-csrf-ratelimit-grep.test.ts): per-file per-token ABSENCE assertion with an actionable failure message; missing-file-is-failure (Rule 12)"
    - "identifier-precise, NEVER blanket-string: bans the 5 deleted identifiers per scenario surface + the 3-token subset in queries.ts — the literal 'holding:' is deliberately NOT banned (scenarioAum DRAFT-ref read + buildHoldingRef stay legitimate, Pitfall 3)"
    - "dual-layer non-vacuity (Rule 9): source-scan + runtime id-format, both falsified during authoring and recorded in the commit message"
key-files:
  created:
    - src/__tests__/phase-63-series-space-guards.test.ts
  modified: []
  deleted: []
decisions:
  - "runtime layer reuses the adapter's own exported builders (buildPerKeyStrategyForBuilderSet / mergeAddedIntoPerKeySet / buildAddedOnlySet) with self-contained fixtures — the guard proves the value-layer invariant a source scan cannot reach (no 'holding:' unit id ever emitted)"
  - "scan paths resolved from process.cwd() (repo root under vitest) with an existsSync fail-loud pre-check, so a rename/move that dodges the guard breaks it rather than silently skipping"
metrics:
  duration: ~30m (Task 1 only; Tasks 2-3 pending)
  commits: 1
  tasks_completed: 1
  tasks_total: 3
  files_created: 1
---

# Phase 63 Plan 05: ENGINE-05 Guard + GUARD-01 Checkpoint + Phase Gate — PARTIAL (checkpoint)

Closed **ENGINE-05** — the source-scan + runtime guard that converts the Phase-63
holdings-engine deletion into a standing CI invariant. Then **PAUSED at Task 2
(GUARD-01)**, a `checkpoint:human-action` prod residue deletion that the executor
cannot perform (no Supabase MCP). Task 3 (phase gate) is sequenced after that
checkpoint and therefore remains.

## Tasks

**Task 1 — ENGINE-05 guard test (`227bc52d`): COMPLETE.**
Created `src/__tests__/phase-63-series-space-guards.test.ts` mirroring the
`admin-csrf-ratelimit-grep.test.ts` readFileSync class. Two layers:

- **Source-scan (comment-inclusive, identifier-precise):** each of the 5
  scenario-surface sources (`scenario-adapter.ts`, `scenario-compare.ts`,
  `ScenarioComposer.tsx`, `ScenarioComparePanel.tsx`, `share-resolve.ts`)
  asserts ABSENCE of all 5 banned identifiers (`buildStrategyForBuilderSet`,
  `collapseAliasedHoldingStrategies`, `mapDeAliasedWeightsToRawBasis`,
  `symbolByHoldingId`, `scenario-dealias`); `src/lib/queries.ts` asserts ABSENCE
  of its 3-token subset (`scenario-dealias`, `collapseAliasedHoldingStrategies`,
  `liveBaselineMetricsFromHoldings`). One `it()` per file×token with an
  actionable message; a missing scan-set file is a test FAILURE, not a skip
  (Rule 12).
- **Runtime id-format:** the three surviving series-space builders
  (`buildPerKeyStrategyForBuilderSet`, `mergeAddedIntoPerKeySet`,
  `buildAddedOnlySet`) driven with representative fixtures (2 per-key + 2 added,
  one added warm-up-gated to `[]`) emit NO strategy whose
  `id.startsWith("holding:")`.
- **Precision (Pitfall 3):** the literal `"holding:"` is deliberately NOT a scan
  token — `scenarioAum`'s DRAFT-ref `scopeRef.startsWith("holding:")` read and
  `buildHoldingRef` in Holdings/bridge surfaces stay legitimate. The invariant is
  "no `holding:` scopeRef as an ENGINE UNIT ID", enforced by (a) banned-identifier
  absence + (b) the runtime value layer — never a blanket string ban.

**Rule-9 falsification (both layers, recorded in the commit message):**
- Source-scan: planted `collapseAliasedHoldingStrategies` into
  `scenario-compare.ts` → that file's `it()` went red → reverted (file clean).
- Runtime: set a fixture id to `holding:FALSIFY-PROBE` → 3 runtime `it()`s went
  red (buildAddedOnlySet, mergeAddedIntoPerKeySet, empty-per-key reduction) →
  reverted.

**Task 2 — GUARD-01 prod residue deletion: CHECKPOINT (blocking, not executed).**
`checkpoint:human-action`. Deletes the two `phase10-rpc-*@test.local` residue
holders' `allocator_holdings` rows on prod `khslejtfbuezsmvmtsdn` (auth.users
rows KEPT). Requires Supabase MCP, which the gsd-executor does not have — the
ORCHESTRATOR session executes the four-step A1→A2→DELETE→VERIFY sequence from the
plan. **No DB operation was attempted by the executor.**

**Task 3 — Phase gate (GUARD-02 verbatim survivors + GUARD-03 zero-diff + full
suite/coverage): REMAINING.** Sequenced after the Task-2 checkpoint per the plan.
Not run.

## Evidence Recorded (Task 1 scope)

- `npx vitest run src/__tests__/phase-63-series-space-guards.test.ts
  --no-file-parallelism` → **33 passed / 0 failed**.
- `npx tsc --noEmit` → **0 errors**.
- Source-scan pre-check: all 6 scan-set files currently contain **none** of their
  banned tokens (empty grep on every file).
- **GUARD-03** (recorded here as standing evidence; formal re-check is Task 3):
  `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts`
  → **0 hunks** (frozen engine untouched by this plan).
- **ENGINE-04 grep gate:** `grep -rln "scenario-dealias" src --include="*.ts*" |
  grep -v "\.test\."` → **empty** (the guard test's `scenario-dealias` banned-token
  string is in a `.test.` file, correctly excluded).

## Deviations from Plan

None. Task 1 executed exactly as written; no bugs, missing functionality, or
blocking issues surfaced. The pause at Task 2 is the plan's designed checkpoint,
not a deviation.

## Land-Step Reminder (phase-wide, NOT a task commit)

Per the plan and Phase 62's carried note: bump `VERSION` + `package.json` in the
SAME commit at the phase-wide `/ship` LAND step (all Phase-63 plans land
together). This is NOT a per-task commit.

## Remaining Work (for the orchestrator / next executor pass)

1. **GUARD-01 (Task 2, orchestrator + Supabase MCP):** A1 column confirm → A2
   grounding re-run with hard STOP on drift → DELETE keyed to the two
   execution-time-confirmed UUIDs (holdings rows only, auth.users kept) →
   post-delete grounding returns 0 rows. Record the deletion row count + the
   0-row verification verbatim.
2. **Task 3 (phase gate):** full `npm test`, `npm run lint`, `npx tsc --noEmit`,
   `npm run test:coverage` (ratchet 82/80/74/72 — record actuals; deletion
   phases can DROP functions/branches), GUARD-02 verbatim-survivor suites,
   GUARD-03 diff empty, ENGINE-04 grep gate empty. Any red is a blocking finding
   to fix at root.

## Requirements

- **ENGINE-05: SATISFIED** — dual-layer guard committed, both layers Rule-9
  falsified, 33/33 green, tsc clean.
- **GUARD-01: PENDING** — orchestrator checkpoint (executor has no Supabase MCP).
- **GUARD-02 / GUARD-03: PARTIAL** — GUARD-03 zero-diff recorded (0 hunks); the
  formal phase-gate re-check (GUARD-02 verbatim survivors + full suite/coverage)
  is Task 3, remaining.

## Commits

- `227bc52d` test(63-05): ENGINE-05 series-space durability guard (source-scan + runtime)

## Self-Check: PASSED (partial — Task 1 scope)

- `src/__tests__/phase-63-series-space-guards.test.ts` exists: VERIFIED
- `63-05-SUMMARY.md` exists: VERIFIED
- Commit `227bc52d` reachable: VERIFIED
- Guard 33/33 green; tsc 0 errors; GUARD-03 0 hunks; ENGINE-04 grep gate empty: VERIFIED
- Tasks 2 (GUARD-01 checkpoint) + 3 (phase gate) intentionally NOT executed — returned at the blocking checkpoint

## Task 2 (GUARD-01) + Task 3 (phase gate) — completed by orchestrator (2026-07-03)

**GUARD-01 (prod, khslejtfbuezsmvmtsdn, via Supabase MCP):**
- A1: api_keys owner column = user_id ✓
- A2 grounding: 8 phase10-rpc residue *users* exist (plan expected literal 2 — imprecision:
  the "2" was about *holders*); the authoritative gate=false-holders query returned EXACTLY 2,
  both residue: 3cf1b8d3 (rpc-a-1777186777594, BTC+ETH) and 60f2e6c9 (rpc-b-1777186777594, SOL).
  No real users. Proceeded on the substantive grounding.
- DELETE keyed to the two confirmed UUIDs: 3 allocator_holdings rows returned/deleted.
- VERIFY: gate_false_holders = 0; both auth.users rows KEPT (residue_users_kept = 2).

**Task 3 phase gate (all green):**
- Full suite via npm run test:coverage: green; coverage 85.46/83.32/79.83/76.32 ≥ ratchet 82/80/74/72.
- tsc --noEmit 0 errors; lint 0 errors; route manifests OK.
- GUARD-03: git diff origin/main..HEAD on scenario.ts + scenario-window.ts = 0 lines.
- Banned-identifier tree greps clean (production sources; sole matches = the ENGINE-05 guard's own
  token list + gate-exempt test-file comments + one NEGATIVE assertion ScenarioComparePanel.test.tsx:328).
- Advisory doc-rot noted for review: scenario.test.ts:216 + EquityChart.scenario.test.tsx:275 comments
  still cite the deleted liveBaselineMetricsFromHoldings (test-comment class, excluded from gates by design).

Plan 63-05: 3/3 tasks complete.
