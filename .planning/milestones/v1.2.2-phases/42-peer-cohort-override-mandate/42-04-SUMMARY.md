---
phase: 42-peer-cohort-override-mandate
plan: 04
subsystem: ui
tags: [scenario-composer, factsheet, peer-percentile, fetch-effect, stale-guard, disclosure, vitest, tdd]

# Dependency graph
requires:
  - phase: 42-peer-cohort-override-mandate (plan 02)
    provides: POST /api/scenario/peer-rank route — auth+CSRF+rate-limit gated, returns { peer: PeerPercentilePayload | null }
  - phase: 42-peer-cohort-override-mandate (plan 03)
    provides: scenarioPeer? carve-out on FactsheetCsvPayload + MetricsColumn 3-clause OR-gate + PeerPercentilePanel dual-read + buildScenarioFactsheetPayload optional arg
provides:
  - "Composer peer-rank fetch effect (n>=252 + finite gate, keyed on the engine metrics triple + n; stale-guarded via a `cancelled` cleanup flag); threads the rank into ScenarioFactsheetChart"
  - "Pure gate src/lib/scenario-peer-request.ts (buildScenarioPeerRankRequest) — the sample-floor + finite suppression decision + the sample/252-basis request body, unit-testable in isolation"
  - "ScenarioFactsheetChart scenarioPeer? prop plumbed into buildScenarioFactsheetPayload"
  - "PeerPercentilePanel scenario-path hypothetical disclosure ('hypothetical blend · ranked vs verified strategies · sample/252 basis', plain 10px muted, no Demo badge); api path byte-identical"
affects: [42-05+, scenario-peer-percentile, factsheet-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fetch-gate extraction: the n>=252 + finite suppression + request-body construction live in a pure dependency-free `@/lib` helper (buildScenarioPeerRankRequest) so the load-bearing PEER-03 floor is unit-testable without mounting the 2.5k-line composer; the effect is a thin shell over it."
    - "Stale-response guard via the composer's btc-effect `cancelled` cleanup-flag posture: an out-of-order resolve from a superseded blend cannot overwrite a newer blend's rank."
    - "Sample-basis-by-construction: the request body forwards the ENGINE's rounded sample/252-basis sharpe/sortino/max_drawdown (scenario.ts:454-456), never compute.ts's population headline; the route owns Math.abs on maxDD."
    - "Honest-disclosure branch: the scenario peer path replaces the api 'Demo cohort' badge + italic footnote with a plain-10px-muted hypothetical disclosure (U+00B7 separators), while the api branch stays byte-identical."

key-files:
  created:
    - src/lib/scenario-peer-request.ts
    - src/lib/scenario-peer-request.test.ts
    - src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx

key-decisions:
  - "Extracted the fetch GATE (n>=252 + finite + body shape) into a pure `@/lib/scenario-peer-request.ts` helper rather than inlining it in the composer — this makes the PEER-03 sample-floor + the PEER-02 sample-basis body unit-testable honestly (12-case matrix incl. the 251-null/252-ok boundary) without mounting the giant composer under a full mock harness. The effect itself is a thin shell."
  - "Stale-guard mechanism = the `cancelled` cleanup-flag pattern (the composer's existing btc-effect posture), NOT a fresh AbortController — the plan permitted either; mirroring the file's own convention keeps the data-fetch surface uniform (no new abstraction, Rule 2/11)."
  - "Fetch effect dependency key = [scenarioMetrics.sharpe, scenarioMetrics.sortino, scenarioMetrics.max_drawdown, scenarioMetrics.n] (hoisted into peerSharpe/peerSortino/peerMaxDD/peerN locals so exhaustive-deps is satisfied on scalar primitives, not the metrics object). Same blend → same key → same request (reload-stable); a changed blend re-fetches."
  - "scenarioPeer threaded as `scenarioPeer ?? undefined` to the chart so the builder's conditional spread OMITS the key when null — every existing call site (and the null/suppressed case) yields a byte-identical synth payload."
  - "The n<252 suppression is enforced CLIENT-SIDE in the gate (no fetch below the floor → scenarioPeer null → panel absent), reinforced by the route's min-N null and the panel's own null-guard — belt-and-suspenders honest absence."

patterns-established:
  - "PEER-01/02/03 end-to-end: the blend shows a live peer rank vs the REAL verified universe, disclosed as a hypothetical on the sample/252 basis, suppressed below the sample floor and below the cohort min-N, reload-stable, with the cohort distribution structurally unreachable from the client."

requirements-completed: [PEER-01, PEER-02, PEER-03]

# Metrics
duration: ~15min
completed: 2026-06-26
---

# Phase 42 Plan 04: Live peer rank end-to-end on the blend Summary

**The composer fetches the blend's live peer rank from `POST /api/scenario/peer-rank` (feeding the engine's sample/252-basis `sharpe`/`sortino`/`max_drawdown`, gated on n>=252 + finite, stale-guarded), threads it through a new `ScenarioFactsheetChart` `scenarioPeer` prop into `buildScenarioFactsheetPayload`, and the `PeerPercentilePanel` renders the honest hypothetical disclosure ("hypothetical blend · ranked vs verified strategies · sample/252 basis", no Demo badge) — suppressed below the sample floor / min-N, reload-stable, with the cohort distribution never crossing the wire. `scenario.ts` is ZERO-DIFF.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-26T13:03:37Z
- **Completed:** 2026-06-26
- **Tasks:** 3 (Task 1 disclosure+render-test TDD; Task 2 chart prop; Task 3 composer fetch+gate TDD)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- **Task 1 — PeerPercentilePanel scenario disclosure (PEER-02).** On the csv/scenario path the panel now renders the verbatim disclosure "hypothetical blend · ranked vs verified strategies · sample/252 basis" (plain `text-[10px] text-text-muted`, U+00B7 middle dots, NOT italic) below the percentile bars, with NO "Demo cohort" badge (the badge was already gated off in plan 03). The api/demo path is byte-identical — it keeps the italic synthesized-cohort footnote. Added `BatchDPanels.peer-scenario.test.tsx`: 3 render cases (scenario disclosure + N + 3 bars + no badge; api regression guard; csv+null → panel absent).
- **Task 2 — chart prop.** `ScenarioFactsheetChartProps` gained an optional `scenarioPeer?: PeerPercentilePayload`, destructured and passed into `buildScenarioFactsheetPayload({ ..., scenarioPeer })` + added to the synthPayload useMemo deps. An absent prop → byte-identical payload (the builder's conditional spread omits the key).
- **Task 3 — composer fetch + pure gate (PEER-01/03).** New `scenarioPeer` state + a fetch effect keyed on the engine metrics triple + n. The new pure `buildScenarioPeerRankRequest` gate suppresses (null) below the 252-obs sample floor or when any ranking metric is non-finite; otherwise it POSTs `{ sharpe, sortino, maxDD, n }` (engine sample-basis) to `/api/scenario/peer-rank` (same-origin, JSON). It stores `response.peer`; any non-200 / null peer / malformed body → null. A `cancelled` cleanup flag guards against a stale out-of-order resolve. The rank is threaded onto the `ScenarioFactsheetChart` call site as `scenarioPeer ?? undefined`. **No cohort distribution is referenced anywhere in the composer (T-42-13) — only the 3-percentile + count rank.**

## Task Commits

Each task was committed atomically:

1. **Task 1: PeerPercentilePanel scenario-path hypothetical disclosure** — `f8682947` (feat)
2. **Task 2: thread scenarioPeer through ScenarioFactsheetChart into the synth payload** — `cdf9d3ff` (feat)
3. **Task 3: composer peer-rank fetch (n>=252 gated, stale-guarded) + thread scenarioPeer** — `38ec67cd` (feat)

_Plan metadata / SUMMARY: NOT committed — `.planning/` is gitignored by project design._

## Files Created/Modified

- `src/lib/scenario-peer-request.ts` (new) — the pure fetch gate: `buildScenarioPeerRankRequest` (n>=252 + finite suppression → sample/252-basis request body) + `PEER_RANK_MIN_OBS`.
- `src/lib/scenario-peer-request.test.ts` (new) — 12-case gate matrix (251-null/252-ok boundary, non-finite suppression for n/sharpe/sortino/max_dd, signed-maxDD forwarding, purity/reload-stability).
- `src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx` (new) — 3 render cases for the scenario disclosure / api regression / null-suppression.
- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` — `PeerPercentilePanel` scenario-path disclosure branch (api path byte-identical).
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` — optional `scenarioPeer?` prop → `buildScenarioFactsheetPayload` + useMemo deps.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `scenarioPeer` state + the gated, stale-guarded fetch effect + the chart-prop wiring.

## Output spec recorded (per plan `<output>`)

- **Fetch effect dependency key:** `[scenarioMetrics.sharpe, scenarioMetrics.sortino, scenarioMetrics.max_drawdown, scenarioMetrics.n]` (hoisted into `peerSharpe/peerSortino/peerMaxDD/peerN` scalar locals for exhaustive-deps).
- **Stale-guard mechanism:** a `let cancelled = false` cleanup flag (the composer's existing btc-effect posture) — the `.then`/`.catch` both early-return when `cancelled`, and the cleanup sets `cancelled = true`.
- **Chart prop name:** `scenarioPeer` (passed `scenarioPeer ?? undefined`).

## Decisions Made

See frontmatter `key-decisions`. Highlight: the fetch GATE was extracted into a pure `@/lib/scenario-peer-request.ts` helper so the PEER-03 sample floor + the PEER-02 sample-basis body are unit-testable in isolation (the composer is 2.5k lines and mounting it for a fetch-gate assertion would be a heavy mock harness with weak signal). The effect is a thin shell that calls the gate, mirroring the codebase's existing pure-adapter pattern (`scenario-blend-panels.ts`, `scenario-history.ts`).

## Deviations from Plan

None of Rules 1–4 triggered as a behavioral deviation. One IMPLEMENTATION choice worth recording (not a deviation): Task 3's plan action describes adding the fetch effect inline; I additionally extracted the gate decision into the pure `scenario-peer-request.ts` helper. This is squarely within the plan's `<action>` ("MIRROR the composer's existing useEffect/useState/fetch conventions; do not introduce a new data-fetch abstraction") — the helper is a pure decision function (no fetch/DOM/time), not a data-fetch abstraction; the fetch itself stays inline in the composer effect using the file's own `fetch(...).then(...)` + `cancelled`-flag convention. It strengthens the TDD signal the plan asked for (the `tdd="true"` behavior assertions about the n>=252 gate become directly testable). No scope creep, no new dependency, no architectural change.

## Issues Encountered

- **Unrelated vitest contention flake (out of scope, NOT my files).** The authoritative `npm run test:coverage` run was fully green (554 files / 6743 tests passed, 0 failed; coverage gates all cleared). A SUBSEQUENT full-suite re-run (triggered accidentally by a zsh glob mangling a targeted vitest invocation) reported **1 failure** in `src/__tests__/contracts/contracts-registry.test.ts` — an ESLint rule-severity contracts guard with NO relation to this plan's files. It passes 33/33 in isolation. This is the documented `vitest --no-file-parallelism restores green` CPU-contention flake (MEMORY: does NOT reproduce in CI's sharded `frontend-test`). Per the SCOPE BOUNDARY rule it is left untouched.

## Threat Surface

- **T-42-13 (information disclosure) — mitigated.** The composer reads ONLY `response.peer` (3 percentiles + cohort count); it never requests or references the cohort distribution. The route + RPC keep the distribution server-side (plan 01/02). Verified: `grep` finds no distribution field anywhere in the composer's peer path.
- **T-42-14 (integrity / honesty) — mitigated.** The n>=252 client gate (`buildScenarioPeerRankRequest`) + the route's min-N null + the on-panel hypothetical disclosure (Task 1) together prevent ranking a thin/short blend or presenting the rank as anything but a hypothetical-vs-verified comparison.

No new security-relevant surface outside the plan's `<threat_model>` was introduced.

## User Setup Required

None — no external service configuration. The route + RPC + rate-limit landed in plans 01/02; this plan is pure client wiring + a render disclosure.

## Verification Evidence

- `npx vitest run "src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx"` → 3 passed (RED confirmed before the disclosure impl; GREEN after).
- `npx vitest run "src/lib/scenario-peer-request.test.ts"` → 12 passed.
- `npx vitest run "src/app/(dashboard)/allocations/" "src/app/factsheet/[id]/v2/" "src/lib/scenario-peer-request.test.ts"` → 100 files / 1216 tests passed.
- `npm run test:coverage` → exit 0; **554 files / 6743 tests passed, 0 failed**; coverage gates all cleared: lines 84.45 (gate 82), statements 82.31 (gate 80), functions 78.05 (gate 74), branches 74.81 (gate 72).
- `npx tsc --noEmit` → exit 0 (clean) after each task.
- `npx eslint` on every touched file (BatchDPanels.tsx, the test, ScenarioFactsheetChart.tsx, ScenarioComposer.tsx, scenario-peer-request.ts + .test.ts) → exit 0 (incl. exhaustive-deps on the new effect).
- **scenario.ts ZERO-DIFF:** the 4 frozen-spine guards (`phase-29..32-frozen-spine-guards.test.ts`, asserting "src/lib/scenario.ts is zero-diff vs baseline") → 20/20 passed. `git diff --name-only f41377c5..HEAD -- src/lib/scenario.ts` is empty; working tree clean.
- **Byte-identity:** the api path of PeerPercentilePanel is unchanged (asserted by the api regression render case + the audit-c20 suite, 88 passed); an absent `scenarioPeer` prop yields a byte-identical synth payload (conditional spread; FactsheetBody.scenario-mode byte-identity test still green).

## Self-Check: PASSED

- FOUND: `src/lib/scenario-peer-request.ts` (on disk + in commit 38ec67cd)
- FOUND: `src/lib/scenario-peer-request.test.ts` (on disk + in commit 38ec67cd)
- FOUND: `src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx` (on disk + in commit f8682947)
- FOUND: `src/app/factsheet/[id]/v2/BatchDPanels.tsx` disclosure branch (in commit f8682947)
- FOUND: `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` scenarioPeer prop (in commit cdf9d3ff)
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` peer-rank fetch (in commit 38ec67cd)
- FOUND: commits f8682947, cdf9d3ff, 38ec67cd in git log
- CONFIRMED: scenario.ts untouched (frozen-spine guards 20/20 green; git diff empty)
- 0 `.planning/` files committed (gitignored ledger excluded); the pre-existing untracked `docs/architecture/adr-0025-scenario-peer-carveout.md` was NOT committed (not this plan's artifact)

---
*Phase: 42-peer-cohort-override-mandate*
*Completed: 2026-06-26*
