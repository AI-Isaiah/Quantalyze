---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
plan: 07
subsystem: ui
tags: [typescript, react, vitest, zod, scenario-composer, audit-trail, money-surface]

# Dependency graph
requires:
  - phase: 151-06
    provides: "scenarioAum = sanitizedManualAum ?? liveHoldingsSum — the denominator the dollar input divides by, and the manual value the commit forwards"
  - phase: 150-02
    provides: "isValidDollar — the ONE money validator, applied at both the input edge and the route boundary"
  - phase: 112
    provides: "handleWeightChange — the ONE weight-write path, with the clamp banner, the mixed-book engine-unit basis and the sole-unit refusal already in it"
provides:
  - "the per-strategy dollar input (data-testid scenario-constituent-dollar, id alloc-usd-<ref>) on every added-strategy row"
  - "the AUM-unset read-only em-dash cell (data-testid scenario-constituent-usd-unset) carrying its remedy in an sr-only span"
  - "ScenarioCommitDrawer.manualAumUsd?: number — the conditionally-spread manual_aum_usd body field"
  - "_size_source: \"client_manual_aum\" — the seventh audit sentinel, ranked BELOW server_aum"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A second VIEW of a value (dollars over weights) routes its commit through the existing WRITE path, so every guard on that path is inherited rather than re-implemented — and the inheritance is proven by neutering the shared function, not by reading the call"
    - "An uncontrolled input re-keyed on its DERIVED display value: state changes refresh the field, keystrokes between commits are left alone, and the rounded display is never written back"
    - "A client-asserted number may size an audit row only under a sentinel that names it as client-asserted, and only where the server has no figure of its own"
    - "A conditional body spread is the idempotency contract: an unconditionally-added key changes the request_hash for every caller that never sets it"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx
    - src/app/api/allocator/scenario/commit/route.ts
    - src/app/api/allocator/scenario/commit/route.test.ts

key-decisions:
  - "The dollar input is UNCONTROLLED with `key={displayed}` + `defaultValue`, plus an `el.value = String(displayed)` snap-back on every commit. The snap-back is correct in BOTH branches by construction: if the commit moved the derived dollar, the key changed and the remount supplies the fresh defaultValue; if it did not move, `displayed` IS the post-commit value. That closes the displayed-vs-state divergence 151-06 fixed for the AUM field without a controlled mirror that would fight the user mid-type."
  - "The sole-unit refusal is structurally UNREACHABLE from a dollar edit, so Test 5 pins it where it IS reachable (a per-key weight edit) and pins the mixed-book BASIS inheritance on the dollar path instead. See Deviations."
  - "The dollar path refuses an invalid amount (isValidDollar) and keeps the previous value rather than clamping — mirroring handleWeightChange's non-finite posture. A typed 0 IS accepted (weight 0 is a legitimate allocation and the existing per-row size gate refuses it at commit); this is deliberately unlike the AUM field, where 0 is refused because a zero AUM is a claim."
  - "`manual_aum_usd` is ranked BELOW `server_aum`, not above. A client assertion may only fill a hole the server cannot fill; when allocator_holdings supplies a denominator the server figure wins outright, or the NEW-C18-04 audit-trust fix would be undone by the very field this plan adds."
  - "`.finite()` is kept on the zod entry even though Zod v4's `z.number()` already rejects NaN/Infinity (documented in simulatorSchema.ts:46). It costs nothing and states the intent at the trust boundary where a hostile payload arrives; the repo already carries both conventions."

patterns-established:
  - "Prove a guard is INHERITED by mutating the shared function, not by asserting the call — the neuter turns the economic assertion red, so the test cannot pass through a forked path"
  - "When a plan's behaviour is structurally unreachable in the shipped surface, say so in the test's own comment with the reason, pin the guard where it IS reachable, and record it as a deviation — never delete the behaviour silently"

# Metrics
duration: ~48min
completed: 2026-08-07
---

# Phase 151 Plan 07: Per-strategy dollar input + manual-AUM commit persistence Summary

"Allocate $500k to this strategy" is now a sentence the product can hear: a
dollar field on every added-strategy row back-computes the weight through the
one existing weight-write path, and a blank-slate commit carries the allocator's
manual AUM to the audit trail as an explicitly client-asserted sidecar instead
of recording a decision with no magnitude.

## What Was Built

**Task 1 — dollars as a second VIEW of the weight.** Each added-strategy row
gains `alloc-usd-<ref>` beside its weight input: sr-only label
"{name} allocation (USD)", whole dollars, right-aligned mono, `w-24`, the
composer's existing number-input recipe verbatim. At rest it shows
`Math.round(weight × scenarioAum)`; on blur/Enter it validates with
`isValidDollar` and calls `onSetWeight(ref, amount / scenarioAum)` — which is
`handleWeightChange`, the ONE weight-write path. The clamp banner, the
mixed-book engine-unit basis and the sole-unit refusal are therefore inherited,
not duplicated: the file gains **zero** new `setWeightOverride` /
`applyWeightOverrides` call sites (3 before, the same 3 after, on the same three
lines). When `scenarioAum <= 0` the cell is a read-only em-dash carrying
`title="Set portfolio AUM to size in dollars"` **and** an `sr-only` span with the
same sentence — never a disabled input, never `$0`, and no division executes.

**Task 2 — the manual AUM reaches the audit trail.** The composer passes
`sanitizedManualAum` (never `scenarioAum`) as a new optional
`ScenarioCommitDrawer.manualAumUsd`; the drawer spreads `manual_aum_usd` into
the POST body only when it is non-null, mirroring the
`init_holdings_fingerprint` precedent so the idempotency `request_hash` is
byte-unchanged for every caller without it. The route declares the field on
`CommitBodySchema` (a non-strict `z.object` would otherwise strip it silently)
bounded `positive().lt(MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD)`, and adds the
seventh `_size_source` state, `client_manual_aum`, in the three coordinated
edits: the union type, the branch chain, and the enumeration comment (now
honestly "seven states"). Precedence is `serverAumUsd > 0` **first**, manual AUM
only as the fallback — the server-recomputed figure is never overwritten by a
client number.

## Task Commits

| Task | Gate  | Commit     | Description |
| ---- | ----- | ---------- | ----------- |
| 1    | RED   | `4245318e` | Tests 1–7; 7 failed on the missing `alloc-usd-*` input |
| 1    | GREEN | `7c95ce1f` | the dollar input + `scenarioAum` threading + the em-dash state |
| 2    | RED   | `16abfb79` | Tests 8–12 + drawer spread; 5 failed, 8a showing `no_holdings_snapshot` |
| 2    | GREEN | `c6a2d74a` | drawer prop + body spread, composer threading, route schema + sentinel |

## Verification

- `npx vitest run ScenarioComposer.test.tsx ScenarioCommitDrawer.test.tsx
  route.test.ts --no-file-parallelism` → **353 passed / 1 skipped**.
- **Plan-final gate:** `npm run test` → **11,149 passed / 287 skipped, 765
  files**. `npm run test:coverage` → thresholds **cleared** (lines 88.0 vs 82,
  statements 85.93 vs 80, functions 82.68 vs 74, branches 80.35 vs 72).
- `npm run typecheck` → exit 0. `npm run lint` → **0 errors** (1 pre-existing
  `EquityChart.tsx` exhaustive-deps warning — the identical baseline 151-02,
  151-05 and 151-06 each recorded).

**Grep gates (all acceptance criteria):**
- `scenario-constituent-dollar` in the composer → **1** (one input site; the
  em-dash branch uses the distinct `scenario-constituent-usd-unset` so this
  count stays honest).
- `scenario.setWeightOverride(` / `scenario.applyWeightOverrides(` → **3 sites,
  lines 1304 / 1344 / 4788 — identical to `git show HEAD`** before the change.
  (A raw `grep -c` reads 13 vs 12 only because the new landmine comment *names*
  those functions in prose.)
- `client_manual_aum` in route.ts → **4** (criterion `>= 3`: union, branch,
  enumeration comment, and the binding comment).
- `seven states` → **1**; `six states` → **0**.
- `manual_aum_usd` in the drawer → the conditional form
  `...(manualAumUsd != null && { manual_aum_usd: manualAumUsd })`, never an
  unconditional key.

**Mutation falsifiers (both observed first-hand, then reverted;
`grep -rn MUTANT src/` → 0).**

1. **SC1 / 07-T1 — neuter `handleWeightChange`** (an early `return` at the top
   of the function). **Test 3 went RED**: `expected '1.000' to be '0.250'`. The
   dollar edit changed nothing, which is the whole claim — if the input had
   written the weight through any other path the test would have stayed green.
2. **SC1 / 07-T2 — flip the sentinel branch order** (prefer the client value
   over `server_aum`). **Test 10 went RED**: `expected 'client_manual_aum' to be
   'server_aum'`. That is NEW-C18-04's audit-trust guarantee under a live
   falsifier, not a comment claiming it.

**Non-vacuity.** Test 1 asserts the field OPENS at the full AUM before the edit,
so the 0.250 is a real move. Test 4 pins `0.500` before clamping so the landing
at `1.000` is not the starting state. Test 6 asserts the AUM field is genuinely
empty first, then reverses the state (setting an AUM turns the em-dash back into
a live input) so the em-dash is not a rendering accident. Test 7 asserts the
engine call count RISES on the dollar edit before claiming it does not rise on
the AUM edit. Test 8a's RED output was literally `no_holdings_snapshot` — the
defect this plan closes, printed by the test that closes it.

**Economic oracles.** Every money figure is a literal typed into the test:
`500,000 = 25% of 2,000,000`; `250,000 + 750,000 = 1,000,000`;
`2,250,000 = 25% of 9,000,000`; `10,000 = 5% of 200,000` (server) versus the
`100,000` the client asserted. No assertion recomputes `weight × AUM` from the
implementation's own formula.

## Deviations from Plan

### Auto-fixed Issues

None. No bug, missing-critical-functionality or blocker surfaced during
execution; both tasks landed as specified apart from the two judgement calls
below.

### Judgement Calls

**1. Test 5's sole-unit dollar refusal is structurally unreachable — pinned
where it IS reachable, and recorded here.**

- **Found during:** Task 1, reading `handleWeightChange` before writing (Rule 8).
- **Finding:** the plan's Test 5 asks for a *dollar* edit that surfaces
  "A single constituent is always 100%.". That state cannot exist. The refusal
  fires only when `isMixedPerKeyBook` is true (⇒ some SELECTED **non-added**
  engine unit exists) **and** `otherIds.length === 0` (⇒ the edited ref is the
  only selected engine unit). The dollar input lives only on ADDED rows
  (UI-SPEC §2), so those two conditions are mutually exclusive: the per-key unit
  that makes the book "mixed" is itself an `otherId`.
- **What shipped instead:** Test 5 carries two halves. **5a** pins the
  inheritance that IS reachable from a dollar edit — the mixed-book
  ENGINE-UNIT-BASIS branch, where a typed 0.25 must reproduce as 0.250 with
  0.750 flowing to the per-key unit. That is precisely the v1.11 CR-01 failure
  the basis choice exists to prevent (under `enabledIdsOf` the typed fraction
  renders as ~0% against raw per-key equity dollars). **5b** pins the sole-unit
  refusal on the shared function via a per-key weight edit, and asserts in the
  same breath that no dollar input is on screen in that state — so the
  unreachability is a recorded, tested fact rather than a gap. The test's own
  comment carries the full reasoning.
- **Why not extend the dollar input to per-key rows:** that would make the
  refusal reachable, but UI-SPEC §2 scopes the field to added-strategy rows, and
  a per-key row is an exchange key rather than a strategy — "allocate $500k to
  this strategy" is not a sentence about a Binance key.

**2. Test 11 pins `size_at_decision_usd: null`, not `0`.**

- **Found during:** Task 2, reading the sentinel chain.
- **Finding:** the plan describes the pre-phase blank-mode audit row as
  "`no_holdings_snapshot` / size 0". The actual pre-phase behaviour is
  `serverSizeUsd = null` — the variable is initialised to `null` and the
  `no_holdings_snapshot` arm never assigns it.
- **Resolution:** the test pins `null`, because the criterion is
  *byte-identical to the pre-phase audit path* and `null` is what that path
  emits. Pinning `0` would have asserted a behaviour the code has never had.

### Not Deviations

The extra `T-151-21` route test (same Idempotency-Key + same field-less body →
same `p_request_hash`) is inside the plan's Test 11 scope ("a body WITHOUT the
field produces the same request-shape hash as before"), split into its own `it`
because it needs two POSTs and its own RPC mocks.

Composer Test 12 (the drawer threading seam) implements the plan's action
directive "pass `sanitizedManualAum` … book-mode-unedited commits must omit the
field"; the plan listed it under Task 2's action rather than its behaviour list,
so it is numbered past the seven of Task 1.

## Deferred Issues

None opened by this plan. `deferred-items.md` is unchanged — nothing
out-of-scope surfaced, and no auto-fix attempt was needed on either task.

**DEF-151-05-B remains open** and is untouched here, exactly as 151-06 left it:
a reopened book draft still lands in blank mode because `targetEntryMode` stays
frozen on the old all-or-nothing flag. Neither task in this plan reads that
seam. Worth recording for whoever takes it: the dollar input derives from
`scenarioAum` only, and manual AUM is mode-independent, so a reopened book draft
that lands in blank mode keeps a usable dollar column. The mode bug's blast
radius did not grow here.

## Known Stubs

None. Every value on this surface is derived from live state: the dollar figure
from `weight × scenarioAum`, the em-dash from the honest absence of an AUM, the
audit size from either the server's holdings snapshot or the number the
allocator actually typed. The AUM-unset cell is the UI-SPEC-mandated
non-derivable state, not a placeholder — it renders the remedy in text, twice
(title + sr-only), rather than a fabricated zero.

## Threat Flags

None new. The register's four mitigations for this plan all landed:

- **T-151-18** (tampering / repudiation on audit size) — `server_aum` is the
  FIRST branch and unconditional; the client value can only land under
  `client_manual_aum`, and `size_at_decision_usd_client` is untouched. Pinned by
  Test 10 **and by the branch-order mutation observed RED**.
- **T-151-19** (tampering on `manual_aum_usd`) — declared on the schema (or it
  is stripped) and bounded `positive().lt(MAX_DOLLAR_VALUE_USD).finite()`;
  `isValidDollar` gates the client edge. Pinned by Test 8b across `-1`, `0`,
  `null`, `1e12` and a string, each asserting the RPC was never reached.
- **T-151-20** (local DoS — division by a zero AUM) — the `scenarioAum <= 0`
  branch returns before any division; Test 6 asserts the rendered list contains
  no `NaN`.
- **T-151-21** (idempotency drift) — conditional spread; Test 11's companion
  proves two field-less bodies hash identically, and the drawer's own suite
  proves the key is absent from the body when the prop is.
- **T-151-SC** — zero package installs this plan.

## Infrastructure Note

The worktree spawned on the WRONG BASE (an ancestor of the expected
`5953c178`) and with no `node_modules` — both of the measured failure modes this
phase has hit before. Resolved by the `<worktree_branch_check>` reset and by
symlinking the main checkout's already-gitignored `node_modules`. `git status`
stays clean; no package was installed.

## Self-Check: PASSED

All six claimed files exist on disk and all four claimed commits resolve in
`git log`.

## TDD Gate Compliance

Both tasks ran RED → GREEN with the failure observed before any implementation
edit (Task 1: 7 failed; Task 2: 5 failed), each gate a separate `test(...)` then
`feat(...)` commit. No REFACTOR commit was needed. In Task 2's RED run, Tests 10
and 11 passed by design — they pin behaviour that must NOT change (server-truth
precedence, absent-field byte-identity), so they are regression pins rather than
new-behaviour gates, and the branch-order mutation is what proves Test 10 can
fail.
