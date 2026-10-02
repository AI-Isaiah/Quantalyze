---
phase: 66-carry-forward-burn-down
plan: 04
subsystem: allocation-dashboard-composer
tags: [scenario, coverage-gantt, key-labels, type-safety, red-team-burndown, cf-05]
requires:
  - "plan 66-01 (ScenarioComposer.tsx dataSourceLabel + save-error helpers — rebased on)"
  - "plan 66-03 (payload-field removal — the compare payload no longer carries holdingReturnsByScopeRef)"
provides:
  - "per-key (book-member) coverage-gantt rows render the friendly dataSourceLabel, never a raw api_key_id"
  - "ScenarioComparePanel mount receives a compile-time-checked payload (the AllocationsTabs double-cast is gone; tsc is the standing contract gate)"
  - "D3 source-toggle no-persistence decision (YAGNI) recorded in code at the toggle site"
affects:
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
tech-stack:
  added: []
  patterns:
    - "one small pure helper reused across sites (dataSourceLabel idiom — reused, not re-implemented)"
    - "explicit structural narrow annotated by its target type (tsc as the contract gate; no zod for server-trusted SSR props)"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
decisions:
  - "CF-05: per-key gantt row names resolve through the EXISTING dataSourceLabel/payload.apiKeys idiom in the timelineRows useMemo — the ONE place the name reaches CoverageTimeline; no second label formatter, and CoverageTimeline (which only renders row.name) is untouched"
  - "CF-05: the AllocationsTabs:964 double-cast is replaced with an explicit ScenarioComparePanelProps['payload']-annotated object built from props — no zod (server-trusted SSR props), tsc is the standing gate (T-66-08)"
  - "CF-05 / D3: source-toggle persistence DECIDED no persistence (YAGNI) — the Phase-36 D3 toggle is deliberately transient exploration UI state; revisit only on real user demand"
metrics:
  duration: ~18m
  tasks: 2
  files: 4
  completed: 2026-07-04
requirements: [CF-05]
---

# Phase 66 Plan 04: Carry-Forward Burn-Down (CF-05 code smalls) Summary

Closed the CF-05 code smalls: per-key (book-member) coverage-gantt rows now
render the friendly exchange/account label the composer already shows in its
"Data sources" control (reusing the existing `dataSourceLabel`/`payload.apiKeys`
idiom, resolved once in the `timelineRows` useMemo) instead of a raw
`api_key_id`; the `AllocationsTabs` `ScenarioComparePanel` payload double-cast is
replaced with an explicit, type-annotated structural narrow so `tsc` is the
standing payload/panel contract gate; and the D3 source-toggle no-persistence
decision (YAGNI) is recorded in code at the toggle site.

## What Was Built

### Task 1 — CF-05: friendly key labels on the coverage gantt + D3 decision (TDD; commits ab061ded RED, f37e04a7 GREEN)

**Trace / root cause.** A per-key unit's `name` is born at `scenario-adapter.ts:140`
in `buildPerKeyStrategyForBuilderSet` as `` `key ${apiKeyId}` `` (the raw UUID).
That name flows `engineSet.strategies → timelineRows → CoverageTimeline`, which
renders `row.name` verbatim as the row text, the `title` tooltip, and the bar
`aria-label`. The adapter helper has no access to `payload.apiKeys`/`dataSourceLabel`
and is shared by `scenario-compare.ts`, so — per the plan's `key_links` — the fix
lives at the `timelineRows` row-build, the ONE place the name is resolved before
rows reach the (render-only) `CoverageTimeline`.

**Fix (`ScenarioComposer.tsx`).**
- Added an `apiKeyLabelById` useMemo: `payload.apiKeys` → `Map<id, "${Exchange} — ${nickname|••••tail}">`,
  built through the existing `dataSourceLabel` helper (the file's key→label idiom)
  and the SAME `${exchange} — ${label}` composition the "Data sources" control
  renders (DESIGN.md: no new label vocabulary).
- `timelineRows` now maps `name: apiKeyLabelById.get(s.id) ?? s.name` — per-key
  rows get the friendly label; strategy rows (no `apiKeys` entry) keep `s.name`
  unchanged. `CoverageTimeline.tsx` needed no change (it renders, never derives),
  so its STATIC GUARD (no `new Date(`, `utcEpoch` present, no recharts) is intact.
- Recorded the **D3 no-persistence decision** as a comment at the
  `includeByApiKeyId` toggle-state site: "DECIDED no persistence (YAGNI, Phase 66
  CF-05) … deliberately transient exploration UI state … revisit only on real
  user demand."

**Tests.**
- `CoverageTimeline.test.tsx` — APPENDED one `it` (render contract): a friendly
  `name` surfaces in the row text, the `title`, AND the aria-label, and the raw id
  never leaks into any user-facing text/attr. Every pre-existing phase-58
  COVERAGE-01/WCAG/timezone test is untouched (git diff = additions only).
- `ScenarioComposer.test.tsx` — added a composer-level regression in the Phase-57
  coverage-window describe: a per-key book-member row (`apiKeys: [{bybit, "Main"}]`
  + per-key returns) renders "Bybit — Main" (scoped to the gantt body) and NOT the
  raw `api_key_id`; a `member_ids` sanity assertion pins that the asserted row is
  the real book member. **Proven RED** against pre-fix code (rendered `key <uuid>`).

### Task 2 — CF-05: replace the AllocationsTabs payload double-cast with a typed narrow (commit 6a899de5)

- Replaced `payload={props as unknown as ScenarioComparePanelProps["payload"]}`
  at the `ScenarioComparePanel` mount with `payload={comparePanelPayload}`, where
  `comparePanelPayload` is a `const … : ScenarioComparePanelProps["payload"]`
  built explicitly from `props` (holdingsSummary, strategies, and the three
  optional per-key fields — the exact slice the panel type requires). The
  `props` field shapes are structural supersets of the panel's narrow shape, so
  the annotated object type-checks with **zero casts**. Per the Don't-Hand-Roll
  table: NO zod schema — the data is server-trusted SSR props, a structural narrow
  is proportionate. `tsc` is now the standing gate (T-66-08): deleting a required
  field, or the panel widening its requirement, fails the build.

## D3 Source-Toggle Decision Record (CF-05, per D — YAGNI)

**DECIDED: no persistence.** The Phase-36 D3 per-data-source include/exclude toggle
(`includeByApiKeyId`) is deliberately **transient exploration UI state** — it resets
on reload, is never routed into `scenario.draft`, and is out of the commit diff
(modeled on the sibling `leverageByRef` ephemeral state). No user has asked to
persist an exclusion set across sessions, and persisting it would add draft-schema
surface, a save/restore path, and cross-session-drift questions for no demonstrated
need. Revisit only on real user demand. The decision is now recorded both in code
(comment at the toggle site) and here.

## Verification

- **Targeted vitest** (`--no-file-parallelism`): the four touched suites —
  `CoverageTimeline.test.tsx`, `ScenarioComposer.test.tsx`,
  `AllocationsTabs.test.tsx`, `AllocationsTabs.scenario-composer.test.tsx` →
  **238 passed**.
- **RED proof:** the composer-level gantt test fails against pre-fix code
  (`within(body).getByTitle("Bybit — Main")` throws — the row rendered
  `key 11111111-…`); passes after the `timelineRows` label resolution. Committed
  as a `test(66-04)` RED gate before the `feat(66-04)` GREEN gate.
- **tsc:** `npx tsc --noEmit` → exit 0 (proves the constructed compare payload
  satisfies `ScenarioComparePanelProps["payload"]` with no cast).
- **Lint:** `npx eslint` on both changed source files → 0 errors, 0 warnings.
- **Acceptance greps:**
  - `grep -c "as unknown as" AllocationsTabs.tsx` → **0** (was 1; the mount line
    carries no cast; the explanatory comment avoids the literal phrase).
  - `grep -c "no persistence" ScenarioComposer.tsx` → 1; `grep -c "YAGNI"` → 1
    (both within the D3 toggle block).
  - Name resolution goes through `dataSourceLabel` (the `apiKeyLabelById` memo) —
    no second label formatter was written.

## TDD Gate Compliance

- RED: `ab061ded` `test(66-04): add failing gantt friendly-key-label regression` —
  the composer-level test fails against current code.
- GREEN: `f37e04a7` `feat(66-04): friendly key labels on the coverage gantt …`.
- REFACTOR: none needed (Task 1). Task 2 is a standalone `refactor(66-04)` commit
  (`6a899de5`) — a non-behavioral type-safety change, guarded by the existing
  AllocationsTabs suites + tsc.

## Deviations from Plan

None. Both fixes were implemented as written:
- Task 1 fixed at the `timelineRows` row-build (the plan's `key_links` primary
  site), not upstream in the shared adapter and not in the render-only
  `CoverageTimeline` — `CoverageTimeline.tsx` was correctly left untouched.
- Task 2 used an explicit typed narrow with no zod, exactly as the plan and the
  Don't-Hand-Roll table direct.

The only judgment call: the Task-2 explanatory comment was reworded to avoid the
literal substring `as unknown as` so the acceptance grep count reaches 0 (the
substring in a comment would otherwise keep the count at 1). Cosmetic; no behavior.

## Known Stubs

None. Both fixes wire real behavior against real data (`payload.apiKeys` /
`props` fields); no placeholder/empty-value stubs introduced.

## Threat Flags

None new. Per the plan's threat register:
- **T-66-08** (type confusion via the `as unknown as` double-cast) — **mitigated**:
  the cast is gone, `tsc` now enforces the payload/panel contract.
- **T-66-09** (friendly labels leaking key nicknames into gantt attrs) —
  **accepted, honored**: the labels come from the user's OWN `payload.apiKeys` via
  the same `dataSourceLabel` that already renders them in the "Data sources"
  control — no new audience, no new data, no new endpoint or trust boundary.

## Self-Check: PASSED

Files verified present and commits verified in git log (see self-check block below).
