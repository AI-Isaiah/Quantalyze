---
phase: 37-honest-per-data-source-toggle
plan: 02
subsystem: allocations / scenario composer (client adapter)
tags: [scenario, scenario-adapter, per-key-dailies, allocations, dsrc-01]
requirements: [DSRC-01]
dependency_graph:
  requires:
    - "37-01 payload channel (perKeyReturnsByApiKeyId, perKeyDailiesGateSatisfied, eligibleApiKeyIds on MyAllocationDashboardPayload)"
    - "Frozen computeScenario engine (scenario.ts) — renormalizes per-day over the selected set (r / activeWeightSum); SCENARIO-05, never forked"
    - "StrategyForBuilder + ScenarioState types (scenario.ts)"
  provides:
    - "buildPerKeyStrategyForBuilderSet(perKeyReturnsByApiKeyId, equityByApiKeyId) → { strategies, state } — one StrategyForBuilder per api_key_id (id === api_key_id), RAW equity-share weights, default selected=true"
  affects:
    - "Plan 37-03 (the composer toggle): wraps this builder in a useMemo, overlays the ephemeral per-key include/exclude map onto state.selected, collapses, and runs computeScenario for an honest per-source recompute"
tech_stack:
  added: []
  patterns:
    - "Sibling pure builder (NOT a branch inside the B4 function) — keeps buildStrategyForBuilderSet's positional signature + H-0132 commit oracle byte-identical (RESEARCH §Alternatives A4)"
    - "RAW equity-share weights — the frozen engine owns sum-to-1 renormalization (Pitfall 1); the builder never normalizes"
    - "Per-key unit-construction loop lifted from the verified SSR helper liveBaselineMetricsFromPerKeyDailies (queries.ts:2321–2348), duplicated locally to avoid a module cycle"
key_files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-adapter.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts"
decisions:
  - "Added buildPerKeyStrategyForBuilderSet as a SIBLING export beside buildStrategyForBuilderSet (not a per-key branch inside the B4 function). The B4 positional signature and the H-0132 commit round-trip oracle stay byte-identical — git diff shows the hunk anchored AFTER the function's closing brace, only an additive append."
  - "Weights are RAW clamped equity-share USD (Math.max(0, equityByApiKeyId[id] ?? 0)) — NOT renormalized to sum-to-1. The frozen computeScenario engine renormalizes per-day over the selected set (r / activeWeightSum). Renormalizing in the builder would double-normalize (Pitfall 1). Pinned by the PK3 raw-weight test (equity {A:70,B:30} → weights.A===70, NOT 0.7)."
  - "Mirrored the SSR helper's unit shape (id, name `key {id}`, disclosure_tier:\"exploratory\", null scalar metrics) but set start_date = returns[0]?.date ?? null and startDates = returns[0]?.date ?? \"2022-01-01\" per the plan / PATTERNS template + the existing adapter startDates convention (the SSR helper does not populate startDates because it computes immediately)."
  - "Literal unit shape duplicated locally rather than imported from queries.ts to avoid a module cycle (consistent with the existing per-key duplication, PATTERNS §No Analog Found)."
metrics:
  duration: "~12 min"
  completed: "2026-06-25"
  tasks: 2
  files_changed: 2
  commits: 2
---

# Phase 37 Plan 02: Per-key scenario-adapter sibling builder Summary

`buildPerKeyStrategyForBuilderSet` is a new pure sibling builder in
`scenario-adapter.ts` that keys projection units per `api_key_id` (one
`StrategyForBuilder` per data source, `id === api_key_id`) from Plan 01's
per-key series — with RAW equity-share weights so the frozen `computeScenario`
engine owns renormalization — while `buildStrategyForBuilderSet`'s B4 signature
and the H-0132 commit oracle stay byte-identical (DSRC-01).

## What Was Built

**Task 1 — `scenario-adapter.ts` (feat, `610ffad1`):**
- New exported pure function
  `buildPerKeyStrategyForBuilderSet(perKeyReturnsByApiKeyId: Record<string, DailyPoint[]>, equityByApiKeyId: Record<string, number>): { strategies: StrategyForBuilder[]; state: ScenarioState }`,
  placed BESIDE (after the closing brace of) `buildStrategyForBuilderSet`.
- Iterates `Object.entries(perKeyReturnsByApiKeyId)`; `continue` on
  empty/absent series; pushes one `StrategyForBuilder` per key with
  `id === apiKeyId`, `disclosure_tier: "exploratory"`, `daily_returns` from the
  series, null scalar metrics; sets `selected[id]=true` (default included),
  `weights[id]=Math.max(0, equityByApiKeyId[id] ?? 0)` (RAW clamped equity
  share), `startDates[id]=returns[0]?.date ?? "2022-01-01"`.
- The unit-construction loop mirrors the verified SSR helper
  `liveBaselineMetricsFromPerKeyDailies` (queries.ts:2321–2348); the literal
  shape is duplicated locally (no `queries.ts` import) to avoid a module cycle.
- **Did NOT touch `buildStrategyForBuilderSet`** or its B4 positional signature
  — the `git diff` hunk (`@@ -188,3 +188,75 @@`) is anchored at the line AFTER
  the function's `};`, an additive append only.

**Task 2 — per-key builder unit cases (test, `4beb0d98`):**
- New `describe("buildPerKeyStrategyForBuilderSet — per-key keying (DSRC-01)")`
  block (9 cases, modeled on T2):
  - PK1 empty inputs → empty strategies + empty state.
  - PK2 two keys with full series → `ids.sort()` === the api_key_ids, both
    `selected===true`, `weights` === the clamped equity-share values,
    `disclosure_tier==="exploratory"`.
  - **PK3 raw-weight guard** (Pitfall 1): equity `{A:70,B:30}` →
    `weights.A===70`, `weights.B===30` (NOT 0.7/0.3); their sum is 100. Adding a
    sum-to-1 normalize to the builder turns this red.
  - PK4 a key with `[]` series is skipped entirely (absent from strategies +
    state).
  - PK5 negative equity share → weight clamped to 0.
  - PK6 a key absent from `equityByApiKeyId` → weight 0 (`?? 0`), still selected.
  - PK7 `startDates`/`start_date` = `returns[0].date` when present.
  - PK8 `startDates` falls back to `"2022-01-01"` when the leading point carries
    no date.
  - PK9 sibling-isolation sanity: a B4 call in the same test still yields
    holding-scope-ref ids.
- The full file runs in ONE invocation, so the B4 T1–T10 suite and the H-0132
  commit oracle confirm green alongside the new block (DSRC-01 regression guard).

## Verification

- `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts"`
  → **1 file, 31 tests passed** (23 prior incl. H-0132 oracle + 8 new per-key).
- `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts" -t "per-key"`
  selects and passes the new block.
- `npx tsc --noEmit` → **0 errors** (return type matches
  `{ strategies: StrategyForBuilder[]; state: ScenarioState }`).
- **RED→GREEN confirmed:** before the implementation the 8 new cases failed
  (`buildPerKeyStrategyForBuilderSet` not exported) while the 23 existing tests
  stayed green; after the GREEN commit all 31 pass.
- Acceptance greps:
  - `grep -c "export function buildPerKeyStrategyForBuilderSet"` → **1**.
  - `git diff` of `scenario-adapter.ts`: the hunk is anchored AFTER
    `buildStrategyForBuilderSet`'s closing brace — the function body + B4
    signature are byte-identical (every `buildStrategyForBuilderSet` string in
    the diff is the new sibling's JSDoc referencing it).
  - No `normalize|sum.*1|/ total` in the new function body — the only matches
    are comments forbidding renorm (Pitfall 1 honored); the impl is
    `Math.max(0, equityByApiKeyId[apiKeyId] ?? 0)`, raw equity-share with no
    division.

## Deviations from Plan

None — the plan executed exactly as written. No authentication gates occurred.

The plan's PATTERNS template set `start_date: returns[0]?.date ?? null` and
`startDates = returns[0]?.date ?? "2022-01-01"`, which differs from the SSR
helper's `start_date: null` (no startDates) — this is the documented,
intentional adaptation in the plan's `<action>` (the SSR helper computes metrics
inline and never threads startDates to a composer, whereas this builder must
emit a `ScenarioState` for the Plan 03 overlay). Followed the plan/PATTERNS
template, not the SSR literal. Not a deviation — it is the plan's spec.

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`.
- T-37-02-01 (Tampering on the frozen engine / B4 signature): **mitigated** —
  sibling-only; `buildStrategyForBuilderSet` + `computeScenario` untouched; the
  H-0132 oracle re-runs green in the same invocation (B4 commit contract intact).
- T-37-02-02 (Info Disclosure via `name = "key {api_key_id}"`): **accept** — the
  unit name embeds the allocator's OWN `api_key_id` (a uuid, not a secret); the
  display label is resolved separately in Plan 03 from the allocator's own
  `apiKeys[]`. No cross-tenant data, no cipher/secret in the unit.
- T-37-SC (package installs): **accept** — pure in-repo function, no install.

## Known Stubs

None. `buildPerKeyStrategyForBuilderSet` is a complete pure function over Plan
01's real per-key payload data. The composer-side wiring that consumes its
`{ strategies, state }` output (the ephemeral toggle → `projectionState.selected`
overlay → `computeScenario`) is the explicit scope of Plan 37-03.

## Self-Check: PASSED

- FOUND: `.planning/phases/37-honest-per-data-source-toggle/37-02-SUMMARY.md`
- FOUND: `src/app/(dashboard)/allocations/lib/scenario-adapter.ts`
- FOUND: `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts`
- FOUND commit: `610ffad1` (Task 1, feat — sibling builder)
- FOUND commit: `4beb0d98` (Task 2, test — per-key cases + H-0132 isolation)
