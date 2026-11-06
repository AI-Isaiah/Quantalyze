---
phase: 161-wizerr-honest-error-surfaces
plan: 07
subsystem: wizard-error-surfaces
tags: [wizerr, strategy-gate, csv-verdicts, copy-honesty, toctou]
requires:
  - 161-04 (WIZERR-02 — `onTryAnotherKey` is a pure step transition, which is what
    makes `try_another_key` a safe remedy for the new fourth outcome)
  - 161-05 (both `EXPECTED_TABLE_SIZE` pins at 82 on entry)
provides:
  - "GateFailureCode `SERIES_EXAMINED_REFUSED` + two producer-validated reason sentences"
  - "WizardErrorCode `GATE_INSUFFICIENT_CSV_HISTORY` (pins 82 → 83)"
  - "WizardErrorCode `GATE_SERIES_EXAMINED_REFUSED` (pins 83 → 84)"
  - "the 7-day floor evaluated on the wizard COMPOSITE arm"
  - "three re-cut strategyGate oracles (D-15 acceptance, FIX-1 split, sampled_gapped)"
  - "admin TOCTOU pins that convert A5 from assumption to measurement"
affects:
  - src/lib/strategyGate.ts
  - src/lib/wizardErrors.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/api/admin/strategy-review/route.ts (behaviour, via the shared gate; file unedited)
tech-stack:
  added: []
  patterns:
    - "a Set whose members each owe a sentence becomes a Map whose VALUE is the sentence — membership and message cannot drift apart"
    - "an atomic pair proven from `git show --stat`, not asserted in prose"
    - "an oracle re-cut is falsified by running it UNMODIFIED against the changed production code first"
key-files:
  created: []
  modified:
    - src/lib/strategyGate.ts
    - src/lib/strategyGate.test.ts
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
    - src/app/api/admin/strategy-review/route.test.ts
    - .planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md
decisions:
  - "BOTH of 161-UI-SPEC's WIZERR-10 clauses were corrected against the producer registry, and its WIZERR-09 remedy bullet was corrected too — a fifth UI-SPEC copy defect found during execution"
  - "the composite floor uses the exported threshold constant rather than `checkStrategyGate` wholesale, because that function also owns the four analytics-status arms and a THROW this arm's catch would book as a heavy-fetch fault"
  - "the examined-refused Set became a ReadonlyMap so a sixth verdict cannot join the class without bringing a sentence"
  - "three oracles were re-cut, not the two the plan named — the intermediate RED run surfaced the third"
metrics:
  duration: ~85 min
  completed: 2026-08-24
status: complete
actuals:
  tokens: 20900
  tasks: 3
  commits: 4
---

# Phase 161 Plan 07: CSV verdicts tell the truth Summary

The wizard's composite arm now applies the same 7-day floor the publish gate applies and the
refusal has copy of its own (one commit, WIZERR-09); and a strategy whose daily-return series
carries a completeness record that does not earn admission stops being told "Strategy has only
0 trade(s)" and gets a fourth outcome whose sentences were validated, clause by clause, against
the Python producer that stamps the verdict (WIZERR-10).

---

## ⭐ The truth obligation: what I measured, and what I shipped

The plan required this as a **task step**, not a preamble. I read
`analytics-service/services/broker_dailies.py` first-hand — the `SERIES_COMPLETENESS_VALUES`
producer-registry docstring (§ "Who stamps what", ~:98-140) **and both emitters**
(`combine_realized_and_funding` ~:218-265, `combine_sfox_balance_history` ~:515-542), because
the registry's summary and the emitter's own reasoning are two different things and the copy
had to be true of both.

### Measured semantics

| Verdict | Producer | Condition, verbatim from the source |
|---|---|---|
| `sampled_gapped` | `combine_sfox_balance_history` | `"ledger_complete" if nav_gap_days == 0 else "sampled_gapped"` — **any** interior hole. The comment: *"sFOX HANDS us a SAMPLED NAV series, so a hole is a real coverage gap in the record… any hole ⇒ `sampled_gapped`, computable but not complete."* |
| `fill_derived_unproven` | `combine_realized_and_funding` (binance / bybit / okx) | `out_meta["series_completeness"] = "fill_derived_unproven"`, unconditional. The docstring: *"ALWAYS — a CONSTANT, not a data-driven refinement… there is no residual, no reconciliation, and nothing in the output that distinguishes 'the venue had no fills that day' from 'the fills fetch silently truncated'."* |

**The plan's two named defects are both REAL, and its corrections are both sound.** I verified
each against the source rather than inheriting either the UI-SPEC's wording or the plan's
correction:

1. `sampled_gapped` fires at `nav_gap_days > 0`. The UI-SPEC's *"gaps **too large** to verify"*
   asserts a magnitude test that does not exist and would be **false of a one-day hole**.
2. `fill_derived_unproven` is stamped unconditionally. The UI-SPEC's *"was **examined and
   refused**"* / *"the data was **found wanting**"* assert a per-series finding. Nothing looked
   at this series. What is true is a property of the **method**.

I also confirmed a third constraint the UI-SPEC did not mention: the producer's own **T-73-02 /
T-74-03 leak discipline** — *"the verdict is an ENUM STRING and nothing else. Never a gap-day
count, never a row count, never money. A magnitude on this channel is an account-size leak."*
Both shipped sentences carry no magnitude, and a test asserts it (`/\d+ day/i`, `/\d+ gap/i`).

### What shipped, and why each is true

**Gate `reason` (operator-visible RAW behind `Cannot approve: `):**

| Verdict | Shipped sentence | Why it is true of the producer |
|---|---|---|
| `sampled_gapped` | "The return series is built from sampled balance snapshots with interior gaps, so it is not a complete record." | Names the sampling (sFOX hands us a sampled NAV) and the holes, and claims **no threshold**. "not a complete record" is the producer's own phrasing. |
| `fill_derived_unproven` | "The return series is derived from individual fills, which cannot establish that the record is complete." | States the **method's limit**, not a verdict about the data. "cannot establish" is exactly the constant's justification: two summed streams with no residual, so completeness is unprovable by construction. I moved off the plan's candidate ("…for this venue") because a per-venue phrasing still implies a venue-specific judgment; the constant is a property of the derivation. |

**Wizard copy** (`GATE_SERIES_EXAMINED_REFUSED`): title *"We can't verify this strategy's returns
from the venue's own data."*; the cause describes **the two methods** rather than an
examination, and states the enumeration is exhaustive because the gate's map has exactly two
members (with the obligation written at the map for whoever adds a third). Negative assertions
pin that `examined and refused`, `found wanting` and `too large` can never come back.

---

## ⚠️ A FIFTH UI-SPEC copy defect, found during execution — WIZERR-09's remedy

The plan's warning that the UI-SPEC has been found defective four times held for a fifth. Its
WIZERR-09 copy reads *"Not enough **CSV** history…"* with the fix bullet **"Upload a CSV
covering at least 7 daily returns, then submit again."**

**Measured at every emitter, that remedy names a control no reader of this copy has:**

- the wizard **composite** arm counts `series.length` — a **stitched** series assembled from
  keyed member windows. No upload exists to extend.
- the wizard **single-key** arm reaches this code only on the daily-returns branch, i.e. a
  **keyed** account (deribit / mt5 / sfox stamp `ledger_complete`) whose dailies were **derived
  from the venue's ledger**. Also no upload. (Not hypothetical: `strategyGate.test.ts:385`
  already pinned `keyed ledger_complete below the CSV floor → INSUFFICIENT_CSV_HISTORY`.)
- the keyless CSV upload path **never reaches `SyncPreviewStep`** at all — it validates through
  `csv-finalize`.

Shipped instead: the copy talks about the **series** ("This strategy needs at least 7 days of
return history"), which is true on all three emitters including the admin one, and its single
bullet points at the one thing that can change the outcome. An unwinnable remedy on a real
refusal is precisely the class this phase exists to close, so shipping the UI-SPEC's bullet
would have closed WIZERR-09 by committing WIZERR-02's mistake.

The same commit also deleted the mapper arm's comment claiming the code "never flows through
the wizard error mapper" — **two of its three clauses were already wrong when written** (the
single-key arm has passed `csvRowCount` since MT5-11/12; "never CSV-sourced" conflates the
`csv_daily_returns` storage with the source), and the third became wrong in this commit.

---

## Proof that the WIZERR-09 pair landed in ONE commit

```
3782bae6 feat(161-07): the composite arm applies the 7-day floor, and the floor has copy — one commit
 .../SyncPreviewStep.composite.render.test.tsx      | 220 ++++++++++++++++++++-
 .../new/wizard/steps/SyncPreviewStep.tsx           |  56 +++++-      ← the floor
 src/lib/wizardErrors.test.ts                       | 140 ++++++++++++-
 src/lib/wizardErrors.ts                            |  95 ++++++++-   ← the copy + mapper arm
 4 files changed, 494 insertions(+), 17 deletions(-)
```

Both halves are in one `--stat`. There is no commit in this history in which the composite arm
can refuse on row count while the mapper still answers `UNKNOWN` — provable from the commit,
not asserted in prose (SC-4).

---

## Observed RED — every neuter cycle, first-hand

Each neuter was applied to the **working tree only**, run, then restored and verified
**byte-identical by `shasum -a 256`** (and, for Neuter D, by a clean `git status` on the file).

### Neuter A — the composite floor removed (`if (false && series.length < …)`)
```
× REFUSES a stitched composite whose series covers only 1 day(s), with copy of its own
× REFUSES a stitched composite whose series covers only 6 day(s), with copy of its own
× names the threshold as the NUMBER 7, and offers a remedy this surface can actually reach
TestingLibraryElementError: Unable to find an element by: [data-testid="error-envelope"]
```
The `>= 7` and evaluation-order cases stayed green, which is correct — neither depends on the
floor firing.

### Neuter B — the mapper arm returned to `UNKNOWN`
```
× the gate code maps to a real member — the UNKNOWN fallthrough is gone
AssertionError: expected 'UNKNOWN' to be 'GATE_INSUFFICIENT_CSV_HISTORY'
```

**⚠️ Neuter B falsified a comment I had written**, which is the reason the plan demands the
cycle. My first draft of the composite test claimed *"without the mapper flip the envelope
renders with data-error-code UNKNOWN"* — the composite render suite stayed **fully green**
under Neuter B. The composite arm calls `setErrorCode("GATE_INSUFFICIENT_CSV_HISTORY")`
**directly** (exactly as the FIX-3 arm sets its own literal) and never routes through
`gateFailureToWizardError`; the mapper is the **single-key** arm's path. The comment now says
so and points at the describe that does pin it. This is the trap the plan names verbatim
("verify your pin actually pins the arm you think it does") — it caught me on the first try.

### Intermediate RED — the D-15 re-cut's own falsifiability
Production changed **first**; the three oracles run **unmodified** against it:
```
× ⭐ D-15 ACCEPTANCE: keyed perp with an UNPROVEN fill-derived series + 135 csv rows + 0 trades is REFUSED
  AssertionError: expected 'SERIES_EXAMINED_REFUSED' to be 'INSUFFICIENT_TRADES'
× FIX 1: the split is 'did a producer look?', NOT 'do we like the answer?'
  AssertionError: fill_derived_unproven was EXAMINED and found wanting:
                  expected 'SERIES_EXAMINED_REFUSED' to be 'INSUFFICIENT_TRADES'
× sampled_gapped → trade branch → REFUSED (a gapped NAV sample is not a complete series)
  AssertionError: expected 'SERIES_EXAMINED_REFUSED' to be 'INSUFFICIENT_TRADES'
```
**The third oracle was not in the plan's list of two.** The plan named
`strategyGate.test.ts:193-217` and `:259-279`; the run surfaced `:430` as a third pin on the
same deleted fallthrough. Had I re-pointed only the two the plan named, the third would have
gone red at commit time and the tempting fix would have been to "restore" the routing. Each
re-cut oracle now carries its own observed-RED quote in its docblock, and in every one the
`passed === false` line is **untouched** — only the code moved.

### Neuter C — the examined arm falls through to the trade floor again
```
7 RED, including:
  AssertionError: expected 'INSUFFICIENT_TRADES' to be 'SERIES_EXAMINED_REFUSED'
  AssertionError: a verdict was recorded and does not earn admission:
                  expected 'INSUFFICIENT_TRADES' to be 'SERIES_EXAMINED_REFUSED'
  AssertionError: expected 'Strategy has only 0 trade(s). A minim…' to match /sampled balance snapshots/i
  AssertionError: expected 'Strategy has only 0 trade(s). A minim…' not to be 'Strategy has only 0 trade(s). A minim…'
```
⚠️ Honest note: the case *"each sentence reads as a complete sentence after the admin prefix"*
**passed** under Neuter C — `"Cannot approve: Strategy has only 0 trade(s)…"` also starts with a
capital and ends with a period. That case pins sentence **shape**, not routing, and its shape
guarantee is what it claims; routing is pinned by the six cases that went red.

### Neuter D — Task 2's routing reverted, run against the ADMIN surface (Task 3)
```
× [161-07] an examined-but-refused series renders its own sentence, not 'only 0 trade(s)'
× [161-07] a gapped sampled series renders ITS sentence — the two verdicts do not share one
AssertionError: expected 'Cannot approve: Strategy has only 0 t…'
              to be 'Cannot approve: The return series is …'
```
**This is what converts A5 from assumption to measurement.** The admin surface rendered the old
false sentence the instant the gate's routing changed underneath it — so it genuinely shares the
one `checkStrategyGate` rather than carrying its own copy. The 7-day-floor case stayed green
under D, correctly: it does not depend on Task 2.

---

## The two pin-move measurements

Measured at HEAD before each move with `grep -an` (never bare `grep` — the deliberate NUL byte
at line 1572 makes `ugrep` skip the file silently and return zero):

| Move | Member | Before | After | Sites |
|---|---|---|---|---|
| Task 1 | `GATE_INSUFFICIENT_CSV_HISTORY` | `82` × 2 | `83` × 2 | `[140.3-10 / TRAP-4]`, `[140.3-12 / SEAMUX-04]` |
| Task 2 | `GATE_SERIES_EXAMINED_REFUSED` | `83` × 2 | `84` × 2 | same two |

Both entries were read against **all four FORBIDDEN fragments** and against the
destructive-action class by hand before each number moved, and the reasoning is recorded in
both docblocks in the house format. The divergence guard at the end of the file was green at
every commit boundary (both pins moved in the same edit, and the full suite ran after each).

**File handling:** every edit to `wizardErrors.test.ts` went through a Node `latin1`
byte-preserving round-trip (the `Edit` tool was deliberately not used on it, per 161-05's note).
**NUL count re-asserted as exactly 1 after every write** — verified again at the end.

---

## Task-by-task

### Task 1 — WIZERR-09, the atomic pair (`3782bae6`)

- Composite arm evaluates `STRATEGY_GATE_MIN_CSV_ROWS` **after** the admissibility return,
  mirroring `checkStrategyGate`'s order (the floor lives *inside* the admitted branch). The
  self-recorded *"NOT ADDRESSED, deliberately"* note was **replaced**, not left standing.
- **Why not `checkStrategyGate` wholesale** (the plan required this be stated): that function
  also owns the four `computationStatus` arms — a question this arm has already answered through
  its own poll state machine — and all three of `ANALYTICS_MISSING` / `_PENDING` / `_COMPUTING`
  map to `UNKNOWN` by design, so a second evaluation could put a generic sentence on a screen
  that knows the real state. It also owns `StrategyGateUnevaluableError`, a **throw** this arm's
  catch would book as a heavy-fetch fault. Both are trade/status logic that is zero by
  construction for a composite. The **threshold** is imported, so only the comparison is
  restated, and its direction is pinned on both sides (the exactly-7 case each side).
- New member + copy + the mapper flip, all in the same commit.

### Task 2 — WIZERR-10, the fourth outcome + the deliberate re-cut (`62a05346`)

- `SERIES_EXAMINED_REFUSED` routed **before** the trade floor.
- `SERIES_EXAMINED_BUT_REFUSED` went from `ReadonlySet` to `ReadonlyMap<string, string>` whose
  **value is the sentence**. With a Set plus a parallel lookup, a sixth verdict added to one and
  forgotten in the other refuses with `undefined` as its reason; here that state is
  unrepresentable. The negated membership test at the FIX-1 arm is unchanged (`.has`).
- The refusal property is asserted **separately and first** (`passed === false`), plus a
  four-outcome mutual-exclusivity case whose oracle is that four inputs produce four **distinct**
  codes, plus an anti-over-reach case pinning `INSUFFICIENT_TRADES`'s sentence byte-identical for
  a genuine trade shortage.
- Three oracles re-cut with their intermediate RED quoted at each.

### Task 3 — the publish-time TOCTOU re-check (`ae7873d6`)

Three cases in the `M-0285` describe (which already `vi.doUnmock`s the gate, so the **real** gate
runs), asserting the **full rendered string including the `Cannot approve: ` prefix** with
`toBe`, the `GUARD_BLOCKED` code channel unchanged, and `publishUpdateIssued === false`.

---

## Deviations from Plan

**1. [Rule 1 — false copy in the source document] The UI-SPEC's WIZERR-09 remedy bullet was
replaced, not just reworded.** Found during Task 1; argued in full above and at the copy entry;
pinned by two negative assertions (`not.toContain("upload a csv")`, `not.toContain("submit
again")`). The plan authorised correcting WIZERR-10's clauses; this is the same class in the
requirement next door, so I applied the same standard rather than shipping a known-false remedy.

**2. [Rule 1 — false comment I wrote] The composite test's mapper claim.** Caught by Neuter B and
corrected in the same commit (above).

**3. [Plan under-count] Three oracles re-cut, not two.** The third (`sampled_gapped → trade
branch`) was surfaced by the intermediate RED run and is recorded at the test itself.

**4. [Rule 1 — stale comment my own change depends on] `SyncPreviewStep`'s
`keyReplacementIsEarned` docblock** still claimed `onTryAnotherKey` fires `handleDeleteDraft()`
and "DESTROYS the draft and every `strategy_keys` member under it". **Measured false at HEAD**:
161-04 made it `setStep("connect_key")` + `persistPointer` + telemetry, and `WizardClient.tsx` is
its only production render site. Corrected in Task 2's commit because the new member's
`try_another_key` is exactly what that comment would have argued against — a reader trusting it
would strip the one remedy that can succeed for this code.

**5. [Fixture surgery, expected consequence] Seven pre-existing composite tests went red on the
new floor.** `ATTR_SERIES` (4 days) and `DECLARED_FALLBACK_SERIES` (2 days) modelled composites
that, after this commit, can no longer reach the passed render on **either** surface. Extended to
7 days: `ATTR_SERIES` with three **zero-return** days (neutral under both `+Σ` and `×Π`, so every
pinned contribution — `+20.0%` / `−20.0%` and `+21.0%` / `−19.0%` — is byte-identical), with
`ATTR_PERKEY` seq 2 extended to own them so `Σ days == series.length` still holds for the
reconciliation-caption cases. Each fixture carries a ⛔ note against "simplifying" it back, since
at the old length the whole describe would go green against a refusal card.

**6. [Declined — out of scope, recorded]** The composite arm still renders the **provenance**
sentence for `sampled_gapped`, which is false on that arm (see Known Issues / `D-161-07-A`).

---

## Known Issues (recorded, not fixed)

**`D-161-07-A` — the composite arm's provenance sentence is false for `sampled_gapped`.**
The composite arm hardcodes `GATE_SERIES_PROVENANCE_UNVERIFIED` for *every* inadmissible verdict,
so after this plan it tells a `sampled_gapped` composite "nothing on our side recorded how that
series was built" — when the stitch job's FIX-2 downgrade is precisely a record of it. Reachable
(that downgrade is the documented path); `fill_derived_unproven` is **not** reachable there
(unprovenness is deliberately not inherited), so the exposure is the gapped composite only.
Not fixed because Task 1's behaviour list explicitly holds this arm at the provenance code and
Task 2's file scope excludes `SyncPreviewStep.tsx`; closing it means re-cutting a 142.2 oracle,
which is the kind of act this phase performs with a plan behind it. **Booked in
`deferred-items.md` with the one-line fix.**

**`D-161-07-B`** — the `vercel-functions` plugin flags `route.test.ts:601` (a vitest mock, not a
handler, predating this plan) as "polling logic in a serverless handler". Out of scope.

## Known Stubs

None. No hardcoded empty values, placeholder text, `TODO` / `FIXME`, `.skip(` or `.todo(` were
introduced. The 19 skipped files / 281 skipped tests in the full run are pre-existing and
unchanged from 161-06's measurement.

## Threat Flags

None — no new network surface, auth path, file access or schema change. The plan's register is
honoured:

- **T-161-19 (Repudiation — a verdict sentence misdescribing the producer, `mitigate`)** — the
  truth obligation was executed as a task step against the producer registry **and both
  emitters**; both plan-time defects were re-verified rather than inherited; a fifth defect was
  found in the requirement next door; every corrected clause is pinned **negatively** so the
  wrong wording cannot return.
- **T-161-20 (EoP — a refusal becoming an admission, `mitigate`)** — `passed === false` asserted
  explicitly on the new arm and separately from the code; four-outcome mutual exclusivity pinned
  by distinct-code count; `FIX 1 changes NO admission` (the pre-existing whole-vocabulary
  admission sweep) still green unchanged; no publish write on either admin refusal.
- **T-161-21 (Tampering — allow-list coupled to the producer registry, `mitigate`)** — the TS
  structures remain hand-typed and un-imported. No TypeScript file imports anything from
  `broker_dailies.py`, and the two-sides-are-different-questions rationale is restated at the map.
- **T-161-22 (Info disclosure on the admin surface, `accept`)** — the two new reasons name series
  properties only: no key ids, uids, venue names, gap counts or money. Pinned by
  `not.toMatch(/\d+ day/i)` and `not.toMatch(/\d+ gap/i)`, which is the producer's own T-73-02
  discipline carried across the language boundary.

---

## Verification

| Command | Result |
|---|---|
| `npx vitest run src/lib/wizardErrors.test.ts SyncPreviewStep.composite.render.test.tsx` (Task 1) | **244 passed** |
| `npx vitest run src/lib/strategyGate.test.ts src/lib/wizardErrors.test.ts` (Task 2) | **259 passed** |
| `npx vitest run src/app/api/admin/strategy-review/route.test.ts` (Task 3) | **50 passed** |
| `npx vitest run 'src/app/(dashboard)/strategies/new/wizard/steps/'` + admin route | **563 passed (23 files)** |
| `npx tsc --noEmit` | clean, after every task |
| `npx eslint` on all seven touched files | clean |
| **`npm run test`** (full suite, repo ROOT — mandatory; contract tests scan all of `src/`) | **789 files / 12 190 tests passed, 19 files + 281 tests skipped (pre-existing), 162.82 s** |

No Python was edited — `broker_dailies.py` was the **truth source, read only** — so `pytest` and
`mypy --strict` were not owed.

`[B25]` did not bite this run. `[D-161-04]`'s 5 s budget note stands for the next executor.

⚠️ **Verification wording (ledger rule).** Branch protection is deliberately off until there are
paying clients, so every CI gate is **advisory at merge**. Each law above is stated as one that
**would have** caught the drift it names, never as one that did stop it.

---

## Must-haves ledger

| Truth | Status |
|---|---|
| The composite arm evaluates the 7-row floor; a 1..6-day CSV-sourced composite is refused with a code that has its own copy, never UNKNOWN | ✅ pinned at 1 and 6 days, with `not.toMatch(/something went wrong/i)` |
| The floor and its copy land in ONE commit | ✅ `git show --stat 3782bae6` carries both halves |
| An examined-but-refused verdict renders a fourth outcome true of the PRODUCER's semantics | ✅ both sentences validated against `broker_dailies.py` and pinned negatively against both UI-SPEC wordings |
| Both examined-refused sentences validated before shipping; any misdescribing clause corrected | ✅ both corrected; the reasoning is in this SUMMARY, at the map, and in the pin docblocks |
| The refusal PROPERTY survives the D-15 re-cut; the re-cut oracles are provably falsifiable | ✅ `passed === false` untouched in all three; intermediate RED quoted at each |
| The publish-time TOCTOU re-check renders the new reason — verified by test, not assumed | ✅ three cases on the real gate; Neuter D is the receipt |
| `Object.keys(WIZARD_ERROR_COPY).length` and BOTH pins move together, guard green at every boundary | ✅ 82 → 83 → 84, both sites each time; full suite green after each commit |
| The four CSV verdict outcomes stay mutually exclusive | ✅ four inputs → four distinct codes, asserted as a set size |
| No loading / success / existing-empty-state branch on E6 is edited | ✅ the `SyncPreviewStep.tsx` diff is two refusal arms and two comment blocks; the R2-5 repoll guard, the passed render and the poll state machine are untouched |
| The new cause and two-bullet fix wrap without truncation (backstop) | ⏳ backstop — no fixed-height container exists on this surface and the new entries grow in the same mounts as `GATE_SERIES_PROVENANCE_UNVERIFIED` (a longer cause than either new one) |

---

## Notes for the next executor

1. **⛔ `D-161-07-A` is the live half-truth this plan leaves behind.** The composite arm answers
   `sampled_gapped` with "nothing on our side recorded how that series was built" — false, and
   pinned by a 142.2 test. If wave 4 has any budget for it, the fix is: route the composite arm's
   refusal through the same examined/unexamined split instead of a literal, then re-point that one
   expectation. **Do it deliberately, with the neuter cycle** — it is an oracle re-cut.
2. **⚠️ The composite arm does NOT use `gateFailureToWizardError`.** It sets `WizardErrorCode`
   literals directly. Any future law that assumes "wizard gate copy is reached through the mapper"
   is blind to that whole arm — Neuter B proved it by staying green.
3. **`SERIES_EXAMINED_BUT_REFUSED` is a Map now, and its value is a user-visible sentence.**
   Adding a verdict costs a sentence, by construction. A third member also makes
   `GATE_SERIES_EXAMINED_REFUSED`'s "There are two ways a series lands here" **incomplete** — that
   obligation is written at the map and at the copy entry.
4. **⚠️ `SyncPreviewStep.tsx` still contains other 161-04-falsified destructiveness prose.** I
   corrected only the `keyReplacementIsEarned` block my change depends on. `:335-336` ("the
   destructive `onTryAnotherKey` path is single-key only") and condition 2's ":2012" phrasing still
   describe the pre-161-04 world. They are not load-bearing for anything shipped here, but they are
   the same class.
5. **`try_another_key` is safe ONLY because of 161-04.** If anything ever re-attaches a delete to
   that handler, `GATE_SERIES_EXAMINED_REFUSED` immediately becomes a destructive-remedy violation.
   The dependency is written at the union member and in the `[140.3-10 / TRAP-4]` pin docblock.
6. **The pins are at 84.** Both sites, plus a hand-written reasoning paragraph each. Note that
   161-05's move 81 → 82 did **not** leave a paragraph in either docblock; my Task 1 record names
   `KEY_ORPHANED` as 82 so the narrative reads continuously, without claiming reasoning I did not
   perform on someone else's entry.
7. **`npm run test` took 163 s this run** (faster than 161-05's ~260 s and 161-06's ~192 s).

## Self-Check: PASSED

- `src/lib/strategyGate.ts` — FOUND; contains `| "SERIES_EXAMINED_REFUSED"`, the
  `ReadonlyMap<string, string>` with both sentences, and the arm routed above the trade floor.
- `src/lib/wizardErrors.ts` — FOUND; contains `| "GATE_INSUFFICIENT_CSV_HISTORY"`,
  `| "GATE_SERIES_EXAMINED_REFUSED"`, both copy entries, and both flipped mapper arms.
- `src/lib/wizardErrors.test.ts` — FOUND; both `EXPECTED_TABLE_SIZE` pins read `84`
  (measured with `grep -an`); **NUL count = 1**, re-asserted after every write.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — FOUND; contains the
  floor on the composite arm and the corrected `keyReplacementIsEarned` docblock.
- `src/app/api/admin/strategy-review/route.test.ts` — FOUND; contains the three `[161-07]` cases.
- `.planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md` — FOUND; contains
  `D-161-07-A` and `D-161-07-B`.
- Commits `3782bae6`, `62a05346`, `ae7873d6`, `cb8b6ab0` — all FOUND in `git log`.
- Working tree clean on every neutered file after restore (`shasum` match, and `git status`
  empty on `src/lib/strategyGate.ts` after Neuter D).
