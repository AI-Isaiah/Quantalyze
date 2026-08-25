# 161 FIX — TOPIC C: operator-reason accuracy and component prose

**Scope:** WR-05, IN-01, IN-02 (renderer half)
**Tree:** MAIN working tree, branch `feat/v1.20-phase-161-wizerr`. **UNCOMMITTED** — the
orchestrator commits topics sequentially.
**Where verification ran:** the MAIN checkout (not a worktree), so every number below is
reproducible from the tree you are reading.

| Finding | Status | Files touched |
|---|---|---|
| WR-05 | **FIXED** — one out-of-list pin left for the orchestrator (below) | `src/lib/strategyGate.ts`, `src/lib/strategyGate.test.ts` |
| IN-01 | **FIXED** (prose-only) | `src/components/strategy/MarkOwnershipDialog.tsx` |
| IN-02 | **VERDICT: the TEXT is wrong, the renderer is right** — component left alone, decision pinned | `src/components/error/ErrorEnvelope.test.tsx` only |

---

## ⚠️ ONE FILE I DO NOT OWN IS NOW RED — read this first

`src/app/api/admin/strategy-review/route.test.ts:1523` pins the WR-05 sentence verbatim. It is
the "one admin pin" the REVIEW's own fix text says to re-point. It is **outside my file list**, so
per the parallel-fixer rule I stopped at the boundary rather than editing it. Measured failure:

```
FAIL src/app/api/admin/strategy-review/route.test.ts
  > [161-07] the 7-day floor still fires here, with its threshold-attached sentence
AssertionError: expected 'Cannot approve: The return series cov…' to be 'Cannot approve: CSV history has only …'
Expected: "Cannot approve: CSV history has only 3 day(s) of returns. A minimum of 7 days is required."
Received: "Cannot approve: The return series covers only 3 day(s). A minimum of 7 days is required."
  Tests  1 failed | 49 passed (50)
```

The exact one-line patch (lines 1523-1524):

```diff
-      "Cannot approve: CSV history has only 3 day(s) of returns. " +
+      "Cannot approve: The return series covers only 3 day(s). " +
         "A minimum of 7 days is required.",
```

Nothing else in the repo pins this sentence (`grep -rn "CSV history has only"` outside
`node_modules` returns exactly 4 hits: this pin, `strategyGate.ts:349`, and two `.planning/`
documents). **This RED is also the end-to-end proof that the fix reaches the operator surface** —
the admin route renders `gate.reason` raw with no copy hop, which is precisely why the sentence
had to be true.

---

## WR-05 — `INSUFFICIENT_CSV_HISTORY`'s operator reason named a CSV two thirds of its population do not have

### The measurement (which sources actually reach that branch)

The arm is reachable only through `isDailyReturnsSourced`, i.e. `seriesCompleteness ∈
SERIES_TRUSTED_FOR_DAILY_BRANCH` = `{ledger_complete, user_supplied, composite_stitched}`
(`strategyGate.ts:112-116`). I resolved each member against the producer registry docstring in
`analytics-service/services/broker_dailies.py:118-134` ("Who stamps what"), read first-hand:

| Verdict | Producer | Does the user have a CSV? |
|---|---|---|
| `ledger_complete` | `combine_native_ledger` (deribit, **both** return paths) · `combine_mt5_deal_ledger` (mt5) · `combine_sfox_balance_history` (sfox) when the observed NAV span has zero interior holes | **No** — keyed accounts, dailies folded from a venue ledger |
| `composite_stitched` | `run_stitch_composite_job` | **No** — a stitch of member series; no upload of its own |
| `user_supplied` | the keyless-CSV path (`analytics_runner`) | **Yes** — the only member for which "CSV" is true |

So **two of the three** admitted populations were refused with a sentence that names a source they
never used *and quotes a day-count from it*. `strategyGate.test.ts:420` already pinned the keyed
`ledger_complete` case as reaching this arm, so the reachability was never in doubt — only the
copy.

I did **not** invent a number: the count (`csvRowCount`) and the floor
(`STRATEGY_GATE_MIN_CSV_ROWS`) are the same two values the old sentence used and the same two the
`detail: { rows, min }` blob carries. Only the noun changed.

### The change

`src/lib/strategyGate.ts` — the reason string, plus a comment recording the measurement above:

```diff
-        reason: `CSV history has only ${csvRowCount} day(s) of returns. A minimum of ${STRATEGY_GATE_MIN_CSV_ROWS} days is required.`,
+        reason: `The return series covers only ${csvRowCount} day(s). A minimum of ${STRATEGY_GATE_MIN_CSV_ROWS} days is required.`,
```

"The return series" is the vocabulary the two `SERIES_EXAMINED_BUT_REFUSED` sentences in the same
file already use for the same artefact, and it is true of all three producers. Number-attached
form and `detail: { rows, min }` are preserved, per the REVIEW's fix text.

**The CODE still says `INSUFFICIENT_CSV_HISTORY`, deliberately.** It is a stable identifier
consumed by `gateFailureToWizardError` and the wizard's `GATE_INSUFFICIENT_CSV_HISTORY` copy key;
renaming it is a cross-file change into `wizardErrors.ts` (another fixer's file) with **no honesty
gain**, because the code never reaches the operator's sentence — the admin route test asserts
`expect(body.error).not.toContain("INSUFFICIENT_CSV_HISTORY")`. Only the sentence was wrong and
only the sentence moved.

### Falsifiability — observed RED first-hand

New `describe` block in `src/lib/strategyGate.test.ts` (4 cases), following the file's existing
oracle conventions: hand-typed verdict roster (nothing imported from `strategyGate.ts`), a
non-vacuity length floor before every negative assertion, and a hand-typed expected sentence
rather than an interpolation of `STRATEGY_GATE_MIN_CSV_ROWS`.

**Trap (b) guarded explicitly** — the first case is a REACHABILITY FENCE asserting all three
verdicts actually select `INSUFFICIENT_CSV_HISTORY` with `detail {rows:3, min:7}`, so the sentence
assertions cannot be silently testing a different arm.

**Neuter method:** restored the old sentence byte-for-byte in `strategyGate.ts`, ran, restored from
a scratchpad copy verified by `shasum` (`83236089fd43f692d3cb1e49a6e0c2abbddfb486` before and
after — no `git checkout --` was used anywhere).

Observed RED (verbatim):

```
 ❯ |jsdom| src/lib/strategyGate.test.ts (53 tests | 2 failed)
   × the sentence names NO CSV and NO upload, for any of the three producers
   × the sentence is EXACTLY this, hand-typed — and identical across producers

AssertionError: ledger_complete: expected 'CSV history has only 3 day(s) of retu…' not to match /csv/i
  ❯ src/lib/strategyGate.test.ts:1056:35

AssertionError: ledger_complete: expected 'CSV history has only 3 day(s) of retu…' to be 'The return series covers only 3 day(s…'
Expected: "The return series covers only 3 day(s). A minimum of 7 days is required."
Received: "CSV history has only 3 day(s) of returns. A minimum of 7 days is required."
  ❯ src/lib/strategyGate.test.ts:1072:71

 Tests  2 failed | 51 passed (53)
```

Restored: `Tests 53 passed (53)`. The reachability fence stayed green in **both** states, which is
correct — it pins the arm, not the sentence.

---

## IN-01 — `LiveAllocationRefusal`'s docblock described a field the same commit deleted

Verified against the current type before rewriting, as instructed:

- `MarkOwnershipDialog.tsx:57-60` — the interface has exactly two members, `code?: unknown` and
  `allocated_amount?: unknown`. **There is no `error` field.** So "…`error` is kept on the type…"
  was false.
- `src/app/api/strategies/[id]/ownership/route.ts:288-290` — the route *does* still send
  `code: "LIVE_ALLOCATION", error: "live_allocation", allocated_amount`. So the *other* half of the
  sentence ("the route still sends it") is true and worth keeping.

Rather than only deleting the clause, the replacement states the actual design decision — the key
exists on the wire and is deliberately absent from the type — because a bare deletion leaves the
next reader wondering whether the omission was an oversight:

```diff
- * 161-10 / WIZERR-07 — `code` is the discriminator; `error` is kept on the type
- * only because the route still sends it (byte-identical), not because anything
- * here reads it.
+ * 161-10 / WIZERR-07 — `code` is the discriminator. The route also still sends
+ * the legacy `error: "live_allocation"` key (byte-identical, route.ts:289), but
+ * it is deliberately NOT a field on this type: a shape nothing reads has no
+ * business being declared, and declaring it would invite the next reader to
+ * branch on it again.
```

**Named exception to the "every fix needs a failing test" rule.** This is a comment-only edit to a
non-exported local interface. No runtime test can observe a comment, and `LiveAllocationRefusal` is
not exported so no test can reference the type either. **I deliberately did not write a test here**
— any test I could write would pass identically before and after, which is precisely the
cannot-fail vacuity the founder rule bans. The falsifiability evidence is the two first-hand
measurements above. `MarkOwnershipDialog.test.tsx`: 30 passed, unchanged.

---

## IN-02 — VERDICT: change the TEXT, not the renderer

**I left `src/components/error/ErrorEnvelope.tsx` byte-identical** (confirmed absent from
`git diff --stat`; `shasum 3d4f0c463273c332bb83e425fe41b7c304ae18c6` before and after the neuter).
The claim text lives at `wizardErrors.ts:3192`, which another fixer owns — **not edited.**

### Why the renderer is right

Three measurements at HEAD, in descending order of how decisive they are:

1. **`actions` does not cross the envelope boundary.** The `ErrorEnvelope` *data shape*
   (`src/lib/envelope.ts:25-52`) has fields `ok, code, human_message, cause?, debug_context,
   correlation_id, recoverable, retry_after_seconds?` — **there is no `actions` field**.
   `buildEnvelope` collapses the whole action list into the single boolean `recoverable` via
   `RECOVERABLE_ACTIONS` (`envelope.ts:54-57, 88`), and `expand_log` is not a member of that set,
   so it survives nowhere the component can read. Gating on `actions.includes("expand_log")` is not
   a render tweak — it requires widening a shared envelope contract consumed far beyond the wizard.
2. **This component is not wizard-only.** Envelopes are hand-built as object literals by surfaces
   that never touch `WIZARD_ERROR_COPY` at all — `api/strategies/csv-validate/route.ts:95` and
   ~20 sites in `api/strategies/finalize-wizard/route.ts`, plus the CSV / factsheet / admin-status
   surfaces this component's own header names. Those envelopes have no `actions` in any form, so a
   gate would have to pick a default for them, and either default is a guess.
3. **Disclosure check (rule 5), performed rather than assumed.** A correlation id is a
   *self-referential* diagnostic identifier: it is shown to the same authenticated user whose
   request produced it, behind a collapsed `<details>`, alongside the error code, and the clipboard
   path is pii-scrubbed (`buildDiagBlock` → `scrubFreeformString`). It names no account, venue,
   amount or tenant. It crosses no trust boundary that the error page itself does not already
   cross. **There is no live disclosure regression, and hiding it on actionable arms would remove
   the support handle exactly where the user is most likely to ask for help.** The Principle-4
   concern is copy hygiene ("do not clutter an actionable error with a support id"), not a security
   boundary.

Note the *other* Principle-4 citation, `wizardErrors.ts:4539`, is **already consistent** with the
unconditional renderer: it argues that `NAME_REQUIRED` / `NAME_TOO_LONG` are kept out of the
envelope *entirely* because routing them through it "would show a correlation id on an ACTIONABLE
arm". That is a correct reading of an unconditional block. Only the `:3192` sentence — "three of
the four are terminal, so `expand_log` is present on those and the id is what the user is asked to
quote" — implies a mechanism that does not exist.

**Recommended text change for whoever owns `wizardErrors.ts:3192`** (I did not apply it): drop the
`expand_log`-implies-the-id clause and state the real reason, e.g. *"Principle 4 (a correlation id
is not a remedy — three of the four are terminal, so the id is what the user is asked to quote;
the renderer shows it on every arm, so an ACTIONABLE refusal is kept out of the envelope entirely
rather than gated inside it — see `DASHBOARD_DIALOG_ROUTE_CODES`'s deliberately-absent list)."*

### What I did apply, in a file I own

Two cases in `src/components/error/ErrorEnvelope.test.tsx` turning "the property happens to be
satisfied today… it is not enforced" (IN-02's actual complaint) into a **recorded, falsifiable
decision**: the block is unconditional *by design*.

**Trap (c) guarded explicitly** — the review's own history here is a fixer asserting an absence on
a component that could never render the thing. So both cases assert **presence**, and the
actionable case **first proves it reaches the actionable state** (`getByLabelText("Retry")`) before
asserting the block. Two cases on opposite sides of the gate-that-does-not-exist, so a pin covering
only the terminal arm would stay green under exactly the change IN-02 proposed.

**Neuter method:** applied the closest implementable form of IN-02's proposed gate
(`{!envelope.recoverable && (<details>…</details>)}` — `recoverable` is the only actions-derived
signal that reaches the component), ran, then restored from a scratchpad copy verified by `shasum`.

Observed RED (verbatim, filtered to the new cases):

```
× renders code + correlation_id on an ACTIONABLE arm (one that shows a Retry control) 1ms
```

…and the TERMINAL case stayed green — the pin discriminates precisely the proposed gate, rather
than reddening on anything. Full-file effect of the gate: `Tests 15 failed | 18 passed (33)`; the
other 14 REDs are pre-existing cases that also depend on the default (recoverable) envelope's
diagnostics block, which is independent evidence that unconditionality is load-bearing across the
existing suite. Restored: `Tests 33 passed (33)`.

---

## Scoped verification (MAIN checkout)

| Command | Result |
|---|---|
| `npx vitest run src/lib/strategyGate.test.ts` | **53 passed (53)** |
| `npx vitest run src/components/error/ErrorEnvelope.test.tsx` | **33 passed (33)** |
| `npx vitest run src/components/strategy/MarkOwnershipDialog` | **30 passed (30)** |
| `npx tsc --noEmit -p tsconfig.json` | **clean, exit 0** |
| `npx vitest run src/app/api/admin/strategy-review/route.test.ts` | **1 failed \| 49 passed** — the out-of-list pin above, expected |

Full `npm run test` deliberately not run (orchestrator runs the gate once after all three topics
land). No `git checkout --` was used at any point; both neuter/restore cycles went through
scratchpad copies with `shasum` confirmation.

### Files changed by this topic

```
src/lib/strategyGate.ts                          |  43 ++++++-   (WR-05: sentence + measurement comment)
src/lib/strategyGate.test.ts                     | 111 +++++++++  (WR-05: 4-case pin)
src/components/strategy/MarkOwnershipDialog.tsx  |   8 +-        (IN-01: prose only)
src/components/error/ErrorEnvelope.test.tsx      |  69 +++++++    (IN-02: verdict pinned)
src/components/error/ErrorEnvelope.tsx           |   UNCHANGED   (IN-02: verdict is text-side)
```

No file owned by another fixer was touched: `wizardErrors.ts`, `wizardErrors.test.ts`,
`wizardErrors.invariant.test.ts` and `dialog-envelope.invariant.test.ts` carry no edit of mine.
