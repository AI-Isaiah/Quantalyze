---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
plan: 06
subsystem: ui
tags: [typescript, react, vitest, zod, scenario-composer, money-surface, copy]

# Dependency graph
requires:
  - phase: 151-05
    provides: "canEnterBook on the split gate — the AUM-03 book-reachable refusal variant is only honest because a partial book now renders the segment"
  - phase: 150-02
    provides: "isValidDollar + formatUsd — the ONE money kit this surface reuses"
  - phase: 90.5-03
    provides: "leverageOverrides — the optional/additive/no-refine draft-field precedent"
provides:
  - "ScenarioDraft.manualAumUsd?: number — the manual portfolio-AUM override, riding the v4 codec additively"
  - "scenario.setManualAum(value | undefined) — the draft write-through on the useScenarioState mutator family"
  - "liveHoldingsSum (the renamed toggle-scan memo) + scenarioAum = sanitizedManualAum ?? liveHoldingsSum"
  - "the PORTFOLIO AUM (USD) input, data-testid scenario-aum-input, both entry modes"
  - "AUM_REFUSAL_NO_BOOK / AUM_REFUSAL_BOOK_REACHABLE — the two commit-refusal variants"
affects: [151-07 per-strategy dollar input + commit persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A persisted field whose schema is safeParsed on EVERY codec branch must tolerate every corruption it can encounter — including the `null` JSON.stringify writes for NaN — because rejection routes to the draft-DELETING reset, not to a validation error"
    - "Sanitize-on-read at the point of use (isValidDollar) as the twin of a deliberately-unrefined codec"
    - "Seed-once-then-never-re-snap (touched-ref) for any input whose default is derived from live server data"
    - "An engine-call-count assertion is a sharper invariance falsifier than value equality: it fails on a dep-array widening even when the recomputed values are identical"
    - "A rationale comment must PARAPHRASE a banned string, never quote it — quoting re-introduces the literal the grep-gate exists to keep out"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/lib/scenario-state.ts
    - src/app/(dashboard)/allocations/lib/scenario-state.test.ts
    - src/app/(dashboard)/allocations/hooks/useScenarioState.ts
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx

key-decisions:
  - "The zod entry is `z.number().nullish()`, not `.optional()`. The plan's own Test 3 requires a NaN-as-null blob to decode ok, and `JSON.stringify` writes exactly that for a NaN. A bare `z.number()` REJECTS null → safeParse fails on the shared schema → the codec's schema_invalid reset → the user's whole saved scenario is deleted over one corrupt number. The TS interface stays `manualAumUsd?: number` per the plan's interface contract; the codec's existing `as unknown as ScenarioDraft` cast absorbs the widening and every read goes through `isValidDollar`, which rejects null."
  - "`useScenarioState.ts` was edited although it is not in the plan's `files_modified`. The plan's Task 2 directs 'mirror the existing draft-mutation API (the same store/setter family as setWeightOverride)' — that family structurally spans the pure mutator (scenario-state.ts) AND its `setValue`/`baseOf` wrapper (the hook). A composer-local state channel was the alternative and the plan explicitly forbids it ('do NOT invent a parallel state channel')."
  - "A blank blur SNAPS THE TEXT BACK to the committed value instead of leaving the field empty. The :5456 recipe's blank-guard ('a blank field is no value, not a 0') is preserved exactly — nothing is committed — but for AUM an empty field sitting over a live manual value is the displayed-vs-state divergence the composer's own commitError comment (:951) exists to prevent."
  - "`aumTouchedRef` is set on the first KEYSTROKE, not at commit time, so a holdings refresh arriving mid-typing cannot re-seed the field out from under the allocator."
  - "`handleReset` releases the AUM seed, mirroring `resetWindowToDefaultOnReopen`. `scenario.reset()` drops `manualAumUsd`, so a touched input would otherwise keep displaying an override the fresh draft no longer holds."
  - "`setManualAum` (the pure mutator) landed in Task 2's commit rather than Task 1's, so Task 1's acceptance criterion — exactly two `manualAumUsd` declaration sites in scenario-state.ts — stayed literally true at its own gate."

patterns-established:
  - "When adding an optional field to a schema that a codec safeParses on every branch, enumerate the CORRUPTIONS it can receive (out-of-range, wrong type, null-from-NaN) and prove each one decodes, not just that the happy path round-trips"
  - "Pin a copy contract by equality against a literal typed into the test; a regex cannot catch a sentence that grows a second, false clause"

# Metrics
duration: ~61min
completed: 2026-08-07
---

# Phase 151 Plan 06: Portfolio AUM input + honest refusal (AUM-01, AUM-03) Summary

A blank-slate scenario can now set its own portfolio AUM through one editable
field that pre-fills from the live book and stays overridable, the value rides
the v4 draft codec additively without any path by which it can delete a saved
scenario, and the commit refusal names only affordances that exist on the
screen.

## What Was Built

**Task 1 — the draft field.** `ScenarioDraft.manualAumUsd?: number`, optional
and additive, `SCENARIO_SCHEMA_VERSION` unchanged at 4 (the
`userWeightOverrides` / `window` / `leverageOverrides` precedent). The zod entry
is declared — `z.object` STRIPS unknown keys and the save route persists
`parsed.data.draft`, so an undeclared field would silently drop a POSTed AUM on
the way to the DB — and carries NO range refine, because a refine failure on
this shared schema routes the codec to the draft-deleting reset.

**Task 2 — the input.** The `scenarioAum` toggle-scan memo was renamed to
`liveHoldingsSum` (body byte-unchanged) and `scenarioAum` became
`sanitizedManualAum ?? liveHoldingsSum`, so all five pre-existing consumers —
drawdown USD scaling, the commit refusal gate, the per-row size gate, the
illustrative-shape note, and the `ScenarioCommitDrawer` prop — keep reading
`scenarioAum` unchanged. `sanitizedManualAum` applies `isValidDollar` at the
point of use and treats a stored `0` as UNSET (a zero is a claim, so a 0 must
keep tripping the honest refusal). `setManualAum` is a `setWindow`-shaped pure
mutator plus a hook write-through, so the draft stays the authority and the
value rides autosave, save and reopen. The input is one field in the composer
summary, present in both modes: blank starts EMPTY with "Required to size and
commit."; book seeds from the live sum via `aumTouchedRef` and renders
"Overrides live-holdings total {formatUsd(liveSum)}." once the two diverge.

**Task 3 — the copy.** Two module constants selected on `canEnterBook`, so the
"From my book" clause appears only when that segment actually renders. The old
string offered two remedies and both were lies: the live-holding toggle was
deliberately never built (CONSTIT-03), and the founder hit the refusal with four
venues already connected.

## Task Commits

| Task | Gate  | Commit     | Description |
| ---- | ----- | ---------- | ----------- |
| 1    | RED   | `94f3f67d` | 5 codec pins; 3 failed (round-trip, no-refine, strip-guard) |
| 1    | GREEN | `23e9e2f1` | `manualAumUsd` interface field + `z.number().nullish()` entry |
| 2    | RED   | `46b97859` | AUM-01 Tests 5–9; 5 failed on the missing `scenario-aum-input` |
| 2    | GREEN | `42a122b4` | rename + derivation + `setManualAum` + the input |
| 3    | RED   | `c1a7ea11` | Tests 10/11/12; 2 failed on the copy equality |
| 3    | GREEN | `c8a4f9b4` | the two refusal constants, chosen on `canEnterBook` |

## Verification

- `npx vitest run ScenarioComposer.test.tsx scenario-state.test.ts --no-file-parallelism`
  → **325 passed** (313 pre-existing + 11 new + 1 rewritten).
- `npx vitest run "src/app/(dashboard)/allocations"` → **122 files / 1712 tests
  passed**.
- `npx vitest run "src/app/api/allocator/scenario"` → **140 passed / 1 skipped**
  (run because this plan widened a schema the two save routes share).
- `npm run typecheck` → exit 0. `npm run lint` → **0 errors** (1 pre-existing
  `EquityChart.tsx` exhaustive-deps warning — the same baseline 151-02 and
  151-05 recorded).

**Grep gates:**
- `manualAumUsd` in `scenario-state.ts` → exactly **2** declaration sites
  (`:160` interface, `:904` zod). The zod line carries no `.refine/.min/.max`.
- `SCENARIO_SCHEMA_VERSION = 4` → **1** (no bump).
- `liveHoldingsSum` in the composer → **10** (criterion was `>= 3`).
- `scenario-aum-input` → **1**; `PORTFOLIO AUM (USD)` → **1**.
- `portfolio AUM is zero` in the composer → **0** (old string extinct).
- `toggle on a live holding` in non-test `src/` → **0**. All four surviving
  repo-wide occurrences are in the test file, as negative assertions or their
  rationale.
- The AUM input JSX carries no `defaultValue`/`value` literal `0` — the value is
  `aumInputText`, which seeds to `""` in blank mode.

**Mutation falsifier (observed first-hand, then reverted; `grep -rn MUTANT` → 0).**
Adding `scenarioAum` to the `scenarioMetrics` dep array turned **Test 8 RED**.
That is the plan's stated acceptance criterion and it is the guard that keeps
AUM-01 from being mistaken for the SCEN-01 fix: AUM rescales DOLLARS, it does
not touch returns, so Sharpe / CAGR / max-DD must not move when it changes. The
test asserts both the metric values AND the engine call count — the call count
is what catches a dep-array widening even when the recomputed numbers are
byte-identical.

**Non-vacuity.** Test 5 asserts the defect's shape first (`drawerAum() === 0`,
the illustrative note present) before setting AUM. Test 8 asserts `n > 0` and a
non-null Sharpe before claiming invariance, so "identical" is a claim about real
engine output rather than two empty metric objects. Test 9 opens with a POSITIVE
CONTROL — a valid persisted `750_000` is adopted and displayed — proving the
localStorage seeding genuinely reaches the composer, so the three corrupt cases
are refused by the sanitizer and not by a broken fixture. Test 11 asserts the
"From my book" radio is on screen before pinning the copy that names it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] the zod entry is `.nullish()`, not `.optional()`**

- **Found during:** Task 1, writing behaviour 3
- **Issue:** The plan's own Test 3 requires "NaN-as-null" to decode ok.
  `JSON.stringify({ manualAumUsd: NaN })` emits `{"manualAumUsd":null}`, and a
  bare `z.number().optional()` REJECTS null. Because `scenarioDraftSchema` is
  safeParsed on EVERY codec branch, that rejection is not a validation error —
  it is `outcome: "reset"`, which hands back `defaultDraft` and deletes the
  user's entire saved scenario over one corrupt number. This is the same
  data-loss class the no-refine rule exists to prevent, arriving through the
  type check instead of through a range check.
- **Fix:** `manualAumUsd: z.number().nullish()`. The TS interface stays
  `?: number` per the plan's interface contract (151-07 consumes that shape);
  the codec's pre-existing `as unknown as ScenarioDraft` cast absorbs the
  widening, and the composer's `isValidDollar` read rejects null anyway — which
  Test 9 pins directly by seeding a null.
- **Files modified:** `scenario-state.ts`
- **Commit:** `23e9e2f1`

**2. [Rule 3 - Blocking] `useScenarioState.ts` edited (outside `files_modified`)**

- **Found during:** Task 2, reading the mutation surface before writing (Rule 8)
- **Issue:** The plan directs "mirror the existing draft-mutation API (the same
  store/setter family as `setWeightOverride`)" and, in the same breath, forbids
  a parallel state channel. That family structurally spans two files: the pure
  mutator in `scenario-state.ts` and its `setValue(baseOf(prev))` wrapper in the
  hook. There is no way to satisfy the directive without the hook.
- **Fix:** `setManualAum` added to `UseScenarioStateReturn`, wired through the
  same `useCallback(setValue + baseOf)` shape as `setWindow`. No other hook
  behaviour touched; the hook's 419 lib+hook tests stay green.
- **Files modified:** `useScenarioState.ts`
- **Commit:** `42a122b4`

**3. [Rule 2 - Missing critical functionality] `handleReset` releases the AUM seed**

- **Found during:** Task 2, tracing the reset seam
- **Issue:** `scenario.reset()` replaces the draft with the default, dropping
  `manualAumUsd`. A touched input would keep DISPLAYING the override the fresh
  draft no longer holds — the exact displayed-vs-state divergence the composer's
  `commitError` comment documents for weights, and the same hole the window
  state's `resetWindowToDefaultOnReopen()` call already closes on this seam.
- **Fix:** `aumTouchedRef.current = false` in `handleReset`, immediately after
  the window release, with a comment naming the shared reason.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `42a122b4`

**4. [Rule 1 - Bug] a blank blur snaps the text back instead of leaving it empty**

- **Found during:** Task 2, applying the :5456 recipe
- **Issue:** The recipe's blank-guard is about not COMMITTING (`Number("") === 0`
  must never become a 0 target). Applied literally to a controlled input it also
  leaves an EMPTY field sitting over a live manual AUM, which misrepresents the
  draft.
- **Fix:** the blank branch commits nothing (the guard is preserved verbatim)
  but restores the text via the single `committedAumText()` helper that the seed
  rule and the invalid-input refusal also read — one source for what the field
  should show. In blank mode with no manual value that helper returns `""`, so
  Test 6 is unaffected.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `42a122b4`

**5. [Rule 1 - Bug] the AUM-03 rationale comment tripped its own grep-gate**

- **Found during:** Task 3, running the acceptance greps
- **Issue:** The comment explaining WHY the never-strings are banned quoted them
  verbatim, so `grep -rn "toggle on a live holding" src/ | grep -v ".test."`
  returned 2 — the criterion requires 0. A future automated gate would have
  fired on the very comment justifying the gate.
- **Fix:** the comment now paraphrases ("the live-holding toggle", "the
  connect-a-key instruction") and says explicitly that it does so because a
  grep-gate asserts the literals absent. All documentation value retained.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `c8a4f9b4`

### Infrastructure

The worktree had no `node_modules`, so nothing could run. Resolved by
symlinking the main checkout's `node_modules` (already gitignored — `git status`
stays clean). No package was installed; zod resolves to the repo's pinned
4.4.3.

### Judgement Calls

**`setManualAum` landed in Task 2's commit, not Task 1's.** Task 1's acceptance
criterion counts `manualAumUsd` declaration sites in `scenario-state.ts` and
expects exactly two. A mutator body referencing the field would have made that
grep ambiguous at its own gate, so the setter shipped with the consumer that
needed it. `scenario-state.ts` is in the plan's own `files_modified`, so this is
placement, not scope.

**`aumTouchedRef` is set on the first keystroke rather than at commit.** The
`windowTouchedRef` precedent sets the flag at the moment of the applied value,
but a window is applied by a single click while an AUM is typed over several
seconds. Flagging at commit time leaves a window in which a holdings refresh
re-seeds the field mid-typing.

**`text-fixed-10`, not `text-micro`.** The repo's eyebrow convention is
`text-micro font-mono uppercase tracking-[0.18em]`, but `--text-micro` is a
fluid `clamp(10px → 11px)`. The UI-SPEC binds this label to exactly 10px "no
11px variant; keep this a 4-size surface", and the adjacent PROJECTED pill
already uses `text-fixed-10` — so the fixed token is both the spec's letter and
the immediate neighbour's convention.

### Not Deviations

The input sits directly under the composer's "Compose a draft portfolio…"
summary line and above the coverage caveat — the "composer summary/header
region" the UI-SPEC names, one instance, both modes.

## Deferred Issues

**DEF-151-05-B is NOT closed by this plan.** A reopened book draft still lands
in blank mode under a partial book, because `targetEntryMode` stays frozen on
the old all-or-nothing flag. This plan owns `ScenarioComposer.tsx` this wave but
none of its three tasks touch `targetEntryMode` — the AUM input reads the
draft and the live sum, not the reopen mode-sync — so per the wave-3 handoff the
item stays deferred rather than being unfrozen as scope creep.

One interaction is worth recording for whoever takes it: because manual AUM now
persists on the draft and is mode-independent, a reopened book draft that lands
in blank mode keeps its AUM (blank mode has no live sum, so the manual value is
simply the only source). The mode bug's blast radius therefore did NOT grow
here, and closing it later will not disturb this field.

## Known Stubs

None. Every value on this surface is derived from real state: the seed from
`liveHoldingsSum`, the override note from `formatUsd(liveHoldingsSum)`, and the
refusal variant from `canEnterBook`. The input's empty blank-mode default is
the honest absence the UI-SPEC mandates ("a zero is a claim"), not a placeholder.

## Threat Flags

None new. The register's three mitigations all landed:

- **T-151-15** (tampering / local DoS on `manualAumUsd`) — `isValidDollar` at
  the input boundary AND again on read; `0` / negative / `>= 1e12` / `null` all
  resolve to unset; no refine, so a corrupt blob can never delete the draft.
  Pinned by codec Test 3 and composer Test 9.
- **T-151-16** (illustrative-note honesty) — the note keys off `scenarioAum <= 0`
  and clears once manual AUM is set (recorded UI-SPEC decision); the persistent
  PROJECTED pill still carries the hypothetical disclosure. Pinned by Test 5.
- **T-151-17** (copy honesty) — equality-pinned copy plus the repo grep-gate.
- **T-151-SC** — zero package installs this plan.

## Self-Check: PASSED

All five claimed files exist on disk and all six claimed commits resolve in
`git log`.

## TDD Gate Compliance

All three tasks ran RED → GREEN with the failure observed before any
implementation edit (Task 1: 3 failed; Task 2: 5 failed; Task 3: 2 failed), and
each gate is a separate `test(...)` then `feat(...)` commit. No REFACTOR commit
was needed. Task 1's Tests 1 and 5 passed at RED by design — they are pins on
behaviour that must NOT change (backward decode, no version bump), and the plan
names them as such.
