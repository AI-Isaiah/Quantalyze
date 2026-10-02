---
phase: 22-methodology-honesty-scaffolding
reviewed: 2026-06-21T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/lib/sample-floor.ts
  - src/components/scenarios/SampleFloorEmptyState.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/components/scenarios/ScenarioBuilder.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: resolved
resolved_at: 2026-06-21
resolution_commit: 17508509
---

> **Resolution (2026-06-21, commit `17508509`):** 0 Critical; core correctness all
> verified clean. WR-01 (pin-comment overclaim) and WR-02 (empty-state mis-render on
> `ok` verdict, now `return null` + regression test) FIXED. WR-03 (extract a shared
> `EmptyStateCard` primitive — DRY/drift across the 4 expected consumers) deferred to
> the pre-ship `/simplify` pass. IN-01/IN-02 deferred (low-pri, revisit at P26/27
> wiring). IN-03 is intentional forward-wiring (export-for-P26/27) — allowlist in any
> dead-export sweep, do not delete. tsc clean; suites green.

# Phase 22: Code Review Report

**Reviewed:** 2026-06-21
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 22 ships two honesty primitives against the `d6c11c89..HEAD` diff:

- **HONEST-01** — an in-place copy upgrade of the scenario coverage caveat on both
  `ScenarioComposer.tsx` (line 1063) and `ScenarioBuilder.tsx` (line 300), to
  `"Historical realized · {N} overlapping days · not a forecast."`. The diff is a
  pure text change: the `data-testid="scenario-coverage-caveat"` is kept, the live
  `n` read (`scenarioMetrics.n` / `metrics.n`) survives, the conditional
  shortest-history clause survives, and the scenario engine (`scenario.ts`) is
  untouched. **Verified correct.**
- **HONEST-02** — net-new pure `src/lib/sample-floor.ts` (the `SAMPLE_FLOOR_OVERLAPPING_DAYS = 60`
  const + `evaluateSampleFloor` gate + three copy builders) and a net-new
  `SampleFloorEmptyState.tsx` render-only component. Registered in `CONTRACT_GUARDS`.
  Confirmed build+pin+export only — **zero consumers** of `evaluateSampleFloor`,
  `SampleFloorEmptyState`, or any body builder exist outside the module and its
  own tests (the wiring lands in Phases 26/27 per the plan).

Core correctness is sound. The gate's guard-first branch order is correct, the
boundary (`n === floor` passes) is right and pinned, the reason enum is
exhaustively covered, and the empty-state copy is honest (names actual N + floor,
no fabricated precision, no `role="alert"`). The CorrelationHeatmap shell tokens
are reused verbatim. The "Historical realized" method label is accurate — the
engine computes a realized-return blend, not a bootstrap/MC forecast, so the new
label is *more* honest than the old "Projected from…".

The findings below are quality/robustness defects, not correctness bugs in the
shipped path. The most material one (WR-01) is a test that documents a guarantee
it does not actually provide — directly answering the review's non-vacuity
question.

## Warnings

### WR-01: Pin comment claims fork-detection it cannot deliver (the "hardcoded 60" guarantee is false)

**File:** `src/lib/sample-floor.test.ts:14-17`
**Issue:** The registered guard's header states the pin "MUST FAIL if a future
feature hardcodes `60` instead of overriding per-call." It does not. The test only
asserts `SAMPLE_FLOOR_OVERLAPPING_DAYS === 60` (the const's own value) plus the
gate branches. There is **no grep sweep and no AST rule banning a raw `60` literal
in a consumer.** Confirmed: the `tools/eslint-plugin-quantalyze` rule set is
`no-raw-localstorage`, `no-raw-published-predicate`, `no-raw-retry-after-parse`,
`no-passthrough-on-ipc`, `no-raw-staleness-derivation` — none guard a floor literal.
A Phase-26/27 consumer that wrote `if (overlappingDays < 60)` instead of importing
`SAMPLE_FLOOR_OVERLAPPING_DAYS` would compile, ship, and keep this pin green. The
value-pin and fork-detection are different guarantees; the comment conflates them
(violates CLAUDE.md Rule 9 — a test that encodes an intent it can't enforce, and
Rule 12 — silently implies a protection that isn't there). This is exactly the
"non-vacuous" property the phase brief asked to confirm, and it fails.
**Fix:** Either (a) downgrade the comment to state the true scope ("pins the
canonical VALUE and the gate branches; it does NOT detect a forked `60` literal —
that defense lands when consumers exist in P26/27"), or (b) add the actual teeth: a
grep/AST sweep that fails when a numeric `60` appears in a sample-floor consumer
outside `sample-floor.ts`. Until consumers exist, (a) is the honest choice.
```ts
// Pins the floor VALUE + EVERY gate branch. NOTE: this does NOT yet detect a
// consumer that hardcodes `60` — no consumer exists until P26/27. When they do,
// add a literal-ban sweep (or an eslint-plugin-quantalyze rule) here.
```

### WR-02: `SampleFloorEmptyState` silently mis-renders a passing (`ok`) verdict instead of failing loud

**File:** `src/components/scenarios/SampleFloorEmptyState.tsx:51-60`
**Issue:** The component's contract (JSDoc line 12) is "the gate decided this is
below-floor," but nothing enforces it. If a caller passes an `ok` verdict
(`reason === "ok"`, `n >= floor`), the branch logic falls through to the `else`
arm and renders `belowFloorBody(n, floor, feature)` — i.e. it shows
*"These strategies share {n} overlapping days — fewer than the {floor} needed…"*
for a verdict where `n >= floor`. That is a self-contradictory, dishonest message
("100 days, fewer than the 60 needed"). Because the whole module is unwired today
this can't fire in production yet, but it is a latent trap for the P26/27 call
sites this component exists to serve, and it violates CLAUDE.md Rule 12 (fail loud,
don't silently mis-render). The `reason` field is destructured but never used to
reject the `ok` case.
**Fix:** Guard the precondition — render nothing (or throw in dev) when the verdict
is `ok`, so a mis-wired call site is caught instead of producing a lying card:
```tsx
const { n, floor, reason } = verdict;
if (reason === "ok") return null; // gate said this passes — caller must not render the empty state
```

### WR-03: Empty-state shell is a verbatim copy of CorrelationHeatmap, not a shared primitive — drift risk

**File:** `src/components/scenarios/SampleFloorEmptyState.tsx:62-67`
**Issue:** The card markup (`rounded-lg border border-border bg-surface px-4 py-8
text-center text-text-muted text-sm`, the `font-semibold text-text-secondary`
heading, the `mt-1 text-[11px]` body) is copy-pasted from
`CorrelationHeatmap.tsx:188-191`. I verified the tokens match exactly today, and
`widget-state-no-duplicate-empty.test.ts` is a registered guard against duplicate
empty-state *copy* — but the *shell tokens* are duplicated structurally. The JSDoc
even advertises this as "reuses the shell VERBATIM," which means a future UI-SPEC
token change to CorrelationHeatmap's empty state will silently NOT propagate here,
producing two visually divergent "honest absence" cards. Three more consumers
(P26 stress, P27 MC) are expected to lean on this same shell, multiplying the drift
surface.
**Fix:** Extract the shell into a shared primitive (e.g. `EmptyStateCard`) that both
`CorrelationHeatmap` and `SampleFloorEmptyState` render, so the pinned UI-SPEC §2
tokens live in one place. The `SampleFloorEmptyState.test.tsx:68-76` test that pins
the verbatim class list would then point at the shared primitive instead of a copy.

## Info

### IN-01: `belowFloorBody` / `noUsableSampleBody` return raw `string`, defeating the empty-state's reason routing at the type level

**File:** `src/lib/sample-floor.ts:88-117`
**Issue:** The three body builders all return `string`, and `SampleFloorEmptyState`
re-derives which one to call from `reason` + `n == null` + `strategyCount`. The
gate already computed `reason`; the component re-implements the routing. This is
benign today but couples the copy-selection logic to two places (the gate's reason
enum and the component's `if/else`), so adding a future reason means editing both.
**Fix:** Consider a single `sampleFloorBody(verdict, { feature, strategyCount })`
helper in the lib that owns the routing, leaving the component to render only.
Low priority — defer until P26/27 wiring forces the second consumer.

### IN-02: `feature` default `"distributional"` produces awkward copy

**File:** `src/components/scenarios/SampleFloorEmptyState.tsx:48` + `sample-floor.ts:94-95`
**Issue:** When `feature` is omitted it defaults to `"distributional"`, yielding
*"…needed for an honest distributional estimate."* — grammatically fine but reads as
jargon to an allocator. The two real call sites (P26 "stress", P27 "Monte-Carlo")
will pass explicit nouns, so the default is only a fallback, but a fallback that
reaches a user should still read cleanly.
**Fix:** Default to a plainer noun, e.g. `"this"` → "…needed for an honest this
estimate" is worse, so prefer `"risk"` or keep but never rely on the default at a
real call site. Minor.

### IN-03: HONEST-02 module + component are fully unreferenced (intentional, but flag for dead-export tooling)

**File:** `src/lib/sample-floor.ts` (whole), `src/components/scenarios/SampleFloorEmptyState.tsx` (whole)
**Issue:** Confirmed zero non-test consumers of `evaluateSampleFloor`,
`SampleFloorEmptyState`, `belowFloorBody`, `noUsableSampleBody`, `fewStrategiesBody`,
`SAMPLE_FLOOR_HEADING`. This is correct per the phase plan (export-for-P26/27), and
the contract-registry entry + tests keep them live, so this is NOT a defect. Flagged
only so a `ts-prune`/knip dead-export pass (if run in CI) is expected to list these
and should be allowlisted rather than "cleaned up."
**Fix:** No action — note in the phase summary that these exports are
forward-wiring for Phases 26/27 so a later dead-code sweep doesn't delete them.

---

_Reviewed: 2026-06-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
