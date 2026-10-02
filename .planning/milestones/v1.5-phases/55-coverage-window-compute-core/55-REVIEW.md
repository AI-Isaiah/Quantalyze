---
phase: 55-coverage-window-compute-core
reviewed: 2026-07-01T16:05:00Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - src/lib/scenario.ts
  - src/lib/scenario.test.ts
  - src/lib/scenario-window.ts
  - src/lib/scenario-window.test.ts
  - src/lib/scenario-blend07.test.ts
  - src/lib/__fixtures__/blend07-six-series.json
  - src/lib/__fixtures__/BLEND-07-verification.md
  - analytics-service/scripts/gen_blend07_fixture.py
  - src/__tests__/phase-29-frozen-spine-guards.test.ts
  - src/__tests__/phase-30-frozen-spine-guards.test.ts
  - src/__tests__/phase-31-frozen-spine-guards.test.ts
  - src/__tests__/phase-32-frozen-spine-guards.test.ts
  - src/__tests__/phase-52-frozen-spine-guards.test.ts
  - src/app/(dashboard)/allocations/lib/scenario-benchmark.ts
  - src/app/(dashboard)/allocations/lib/scenario-compare.ts
  - src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx
findings:
  blocker: 0
  high: 1
  medium: 0
  low: 2
  nit: 1
  total: 4
status: issues_found
---

# Phase 55: Coverage-Window Compute Core — Code Review

**Reviewed:** 2026-07-01T16:05:00Z
**Depth:** deep (cross-file, engine traced against numpy oracle + git-lifecycle simulation)
**Files Reviewed:** 16
**Status:** issues_found

## Summary

The engine rewrite is, on its merits, high quality. All five highest-priority
scrutiny areas hold up under adversarial tracing:

- **Union-when-absent byte-compat (LOAD-BEARING) — CLEAN.** The absent-`window`
  path is structurally identical to the pre-v1.5 code (the diff only *branches*
  around the union block; `members === activeStrategies`, same axis, same
  `startDates`/`"2022-01-01"` sentinel, same per-day renormalize divisor, same
  `effective_start/effective_end = commonDates[0]/[n-1]`). The union pin
  (`scenario.test.ts:351-377`, `n===60`, effective bounds = full union) genuinely
  still runs the OLD path — it passes no `state.window` — and was NOT weakened.
  Verified no consumer passes `state.window` today (both `queries.ts:2208/:2356`
  own-book callers and `computeCompositeCurve` are untouched; the two
  `defaultWindowFor` matches in app code are comments), so the coverage path is
  dormant until Phase 57. Byte-compat holds.
- **Coverage-window blend correctness (present path) — CLEAN.** Membership =
  `enabled AND coverageSpanOf ⊇ window` via inclusive-closed `covers()`; constant
  member-count divisor; interior gaps 0-fill in the numerator only; renorm over
  the surviving member set WITHOUT mutating `state.weights` (pinned by a
  `frozenWeights` equality assertion); zero-member → honest empty-state before
  the day loop (no ÷0, no fabricated zeros). Leverage still composes as
  `wᵢ·Lᵢ·rᵢ` over the member set. Off-by-one boundaries are exercised by the
  four boundary-cell tests in `scenario-window.test.ts`.
- **BLEND-07 gate — CLEAN and genuinely independent.** I re-ran
  `gen_blend07_fixture.py`: it reproduced the committed fixture **byte-identically**
  (deterministic, seeded, no network) and printed twr/cagr/vol/sharpe/maxDD that
  match the hardcoded `NUMPY` constants in `scenario-blend07.test.ts` to the
  recorded precision. The oracle computes the blend with its own numpy
  (`mat.mean(axis=0)`, `np.cumprod`, `np.std(ddof=1)`) — it does NOT call the TS
  engine, so the gate cannot pass while the engine is wrong. Anti-dilution
  6→5-member assertion is present. All 66 window/scenario/blend07 tests pass.
- **Invariants — CLEAN.** No-invented-data preserved (degenerate/empty windows
  return null metrics + empty series), 252-annualization intact, cumulative-
  RETURN-vs-wealth (NEW-C18-09) unchanged, zero new deps.

The one real problem is in **scrutiny area #2 (the frozen-spine re-baseline)**.
Four of the five guards were re-baselined by INVERTING `.not.toContain` →
`.toContain(FROZEN_ENGINE)`. This is green NOW, but it is a time-bomb: the guards
compute their delta against `merge-base(origin/main, HEAD)`, which advances the
moment Phase 55 merges to main — after which `scenario.ts` drops out of every
future phase's delta and all six inverted assertions go red on unrelated future
work. The phase-52 approach (removal from `FROZEN_ISLANDS`) is by contrast sound
and future-safe. See HIGH-01.

## High

### HR-01: Inverted frozen-spine assertions become CI landmines the moment Phase 55 merges to main

**Files:**
- `src/__tests__/phase-29-frozen-spine-guards.test.ts:179-188`
- `src/__tests__/phase-30-frozen-spine-guards.test.ts:154-173` (two assertions)
- `src/__tests__/phase-31-frozen-spine-guards.test.ts:179-197` (two assertions)
- `src/__tests__/phase-32-frozen-spine-guards.test.ts:241-249`

**Issue:**
Each guard resolves its diff baseline as `BASE = git merge-base origin/main HEAD`
(with a fixed FALLBACK_BASE_SHA only when `origin/main` is unreachable), then
computes `CHANGED = git diff --name-only BASE HEAD`. The re-baseline INVERTED the
protective assertion from `.not.toContain(FROZEN_ENGINE)` to
`.toContain(FROZEN_ENGINE)` (and, in phases 30/31, `.toContain(FROZEN_ENGINE_TEST)`)
— six assertions total, all running unconditionally (no ancestor-check, no skip).

This passes on the Phase-55 branch only because `origin/main` is still `e9a57671`,
so `scenario.ts` is legitimately in `CHANGED`. But `merge-base(origin/main, HEAD)`
advances as soon as this branch lands. I proved the failure empirically: I built a
`fake-origin-main` at the current Phase-55 HEAD, branched a future phase off it that
does NOT touch `scenario.ts`, and confirmed `git merge-base` resolves to the P55
commit and `git diff BASE HEAD` contains **0** references to `src/lib/scenario.ts`.
Under `.toContain(FROZEN_ENGINE)` that is a hard failure. These guards run in the
normal vitest suite (`vitest.config.ts` include `src/**/*.test.{ts,tsx}`) with
`fetch-depth: 0` in CI, so all six assertions will go **red on the first unrelated
phase branch after Phase 55 merges**, blocking innocent future work in the
`frontend` aggregator gate.

The SUMMARY's stated rationale (55-02-SUMMARY:120-123) — "if a future non-v1.5
phase reverts or re-freezes the coverage-window edit, the `.toContain` assertion
goes red" — reasons only about an explicit *revert*. It misses the routine
baseline-advance case: nobody reverts anything; the merge-base simply moves past
the edit and `scenario.ts` naturally leaves the per-phase delta. The inverted
assertion cannot distinguish "the reviewed edit is present in this delta" from
"the reviewed edit is already in the baseline" — and after merge it is always the
latter.

Note the phase-52 re-baseline does NOT have this problem: it REMOVES
`src/lib/scenario.ts` from the `FROZEN_ISLANDS` array (phase-52:157-171), which
simply stops asserting on that island forever — future-safe. That is the correct
shape; the phase-29/30/31/32 inversion is not.

**Fix:**
Replace the inverted `.toContain` assertions with the phase-52 pattern — stop
asserting on the (now-unfrozen) engine rather than asserting it IS in the delta.
Delete each inverted `scenario.ts` / `scenario.test.ts` `it(...)` block (the
engine is no longer frozen for these phases; the 252-annualization math is now
protected by `scenario.test.ts`'s pins + the BLEND-07 numpy gate, exactly as the
phase-52 comment already states). For example, in phase-29:

```ts
// REMOVE the inverted assertion entirely (the engine is no longer a frozen
// island for this phase — same reasoning the phase-52 FROZEN_ISLANDS edit uses).
// The no-schema-change migration gate and the two RLS-sql byte-unchanged gates
// (the assertions that actually protect THIS phase's spine) stay.
```

If a live assertion is genuinely wanted, gate it on "the edit is present OR
already an ancestor of the baseline" so it is stable post-merge, e.g.:

```ts
const engineTouchedOrBaselined =
  CHANGED.includes(FROZEN_ENGINE) ||
  // scenario.ts already carries the v1.5 coverage-window edit at the baseline
  git(["grep", "-q", "COVERAGE-WINDOW", `${BASE}:src/lib/scenario.ts`]) === "";
expect(engineTouchedOrBaselined).toBe(true);
```

— but the simplest, lowest-risk fix is to match phase-52 and drop the six inverted
assertions. Either way, the LAYOUT-02 (phase 31) CompositionList assertions and the
FLOW-01/02/03 (phase 32) route assertions must stay exactly as they are — those
were correctly left untouched by this phase and remain the real protective value of
those two guards.

## Low

### LR-01: `scenario-benchmark.ts` comment describes coverage-window emission in the present tense, but the benchmark consumer passes no window

**File:** `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` (header block, the PARITY-02 comment rewrite)

**Issue:**
The rewritten comment states, in the present tense, that "on the scenario surface
`computeScenario` now blends over an explicit coverage window ... so the portfolio
series it emits is the member-intersection window, no longer a union tail padded
with 0." That is only true when a `state.window` is passed. The benchmark consumer
(and every consumer in this phase) passes NO window today — the coverage path is
dormant until Phase 57 (confirmed: no non-comment `defaultWindowFor`/`window:` call
reaches `computeScenario`). So the portfolio series this inner-join actually
receives today is STILL the union series. The comment overstates current behavior
and could mislead a future reader into thinking the benchmark already runs on the
intersection window.

**Fix:**
Qualify the tense to match reality, e.g. "once the scenario tab passes an explicit
coverage window (Phase 57), the portfolio series `computeScenario` emits is the
member-intersection window ... until then this consumer still receives the union
series." The inner-join honesty point (never zero-fill the benchmark) is correct
regardless and can stay.

### LR-02: Absent-path `member_count` semantics differ from the present-path divisor meaning

**File:** `src/lib/scenario.ts:176-194` (doc) and `:634` / `:382` / `:492` (absent-path returns)

**Issue:**
On the present path, `member_count` is the constant blend divisor. On the absent
(union) path, `member_count = activeStrategies.length`, but the union path's
effective per-day divisor is NOT constant — it is the renormalized
`activeWeightSum` over only the strategies that have *started* by that date. So a
consumer that reads `member_count` as "the divisor" gets a correct answer on the
present path and a slightly misleading one on the union path (it is the active-set
size, not the per-day divisor). The doc-comment does call this out ("on the
absent-`window` union path it is the active-set size"), so this is a documented
divergence rather than a bug, but the single field carrying two different meanings
is a latent foot-gun for the ~12 consumers being re-verified.

**Fix:**
No code change required for this phase (the field is additive and unused by
current consumers). Consider, when Phase 57/58 surface `member_count` in the UI,
reading it only on the present-window path, or renaming the union-path value's
intent in the consumer that displays it. Flagging so it is not silently relied on
as "the divisor" on the union path.

## Nit

### NR-01: BLEND-07 oracle only exercises the equal-weight (all-weights-1) path against numpy

**File:** `analytics-service/scripts/gen_blend07_fixture.py:139-140`, `src/lib/scenario-blend07.test.ts:88-99`

**Issue:**
The numpy oracle blends with `mat.mean(axis=0)` (plain ÷N), and `buildState` sets
`weights[id] = 1` for all six with no leverage. This agrees with the engine's
`Σ w·L·r / Σ w` only because every weight is 1 and L is absent. So the fp-precision
numpy gate proves the equal-weight path but does NOT independently cross-check the
weighted-renorm or leverage arithmetic against numpy. Those paths ARE covered by
the `scenario.test.ts` BLEND-04 renorm cases (against closed-form expected values),
so coverage is not missing — but the "#1 correctness anchor" numpy oracle is
narrower than the phrase implies.

**Fix:**
Optional, out of this phase's scope: add a second numpy oracle case with unequal
weights (e.g. 0.6/0.2/0.2 with one dropped member) so the renorm-after-drop
arithmetic is also independently pinned to fp precision, not just to a hand-computed
TS expectation. Low value given the existing closed-form renorm tests; recording for
completeness.

---

_Reviewed: 2026-07-01T16:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
