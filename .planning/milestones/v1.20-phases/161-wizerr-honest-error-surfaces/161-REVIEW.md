---
phase: 161-wizerr-honest-error-surfaces
reviewed: 2026-08-24T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - analytics-service/routers/exchange.py
  - analytics-service/routers/process_key.py
  - analytics-service/services/csv_validator.py
  - analytics-service/services/ingestion/mt5.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_client.py
  - analytics-service/services/mt5_probe.py
  - analytics-service/services/mt5_validation.py
  - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/api/admin/match/eval/route.ts
  - src/app/api/admin/match/recompute/route.ts
  - src/app/api/bridge/route.ts
  - src/app/api/keys/[id]/permissions/route.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/portfolio-strategies/allocation/route.ts
  - src/app/api/simulator/route.ts
  - src/app/api/strategies/[id]/name/route.ts
  - src/app/api/strategies/[id]/ownership/route.ts
  - src/app/api/strategies/composite/add-key/route.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/verify-strategy/route.ts
  - src/components/strategy/MarkOwnershipDialog.tsx
  - src/components/strategy/RenameStrategyDialog.tsx
  - src/lib/analytics-client.ts
  - src/lib/api/seam-retry-after.ts
  - src/lib/strategyGate.ts
  - src/lib/wizardErrors.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 161: Code Review Report

**Reviewed:** 2026-08-24
**Depth:** standard (per-file, plus the five new/edited coverage laws, which are deliverables here)
**Files Reviewed:** 31 production files (+ 5 invariant test files reviewed as deliverables)
**Status:** issues_found

## Summary

Reviewed against the phase goal — *no `code: UNKNOWN`, no false sentence, no unwinnable
remedy* — rather than generic quality. The mechanical work is strong: `tsc --noEmit` is clean at
HEAD, the NUL byte in `src/lib/wizardErrors.test.ts` is intact (measured: exactly 1, 240 949
bytes), both `EXPECTED_TABLE_SIZE` pins read 88, no `as any` / `@ts-ignore` / `console.log` /
TODO was introduced anywhere in the production diff, and no prod URL, project ref or credential
appears in added lines (the only URLs are `analytics.invalid` fixtures and the pre-existing
`security@quantalyze.com` contact).

The four new coverage laws are, on inspection, genuinely falsifiable in the way they claim:
populations are derived from disk, counts and rosters are two independent hand-typed oracles,
`derived.length` is never its own expectation, blank-needle floors are lengths rather than
truthiness, and each carries positive + negative scanner self-tests. One exception (WR-02).

The defects that matter are **copy that asserts more than the code established** — the exact
class the phase exists to close, reintroduced by the phase's own new copy. Both Criticals are
of that class; one of them is on the money/ownership write path.

Excluded per instruction and not re-reported: the MT5 generic fallback naming an unproven
option (`mt5_probe.py` arm 3) and the composite arm's hardcoded provenance reason
(D-161-07-A).

---

## Critical Issues

### CR-01: `DASHBOARD_WRITE_FAILED` asserts "Nothing was saved" on arms whose own comments say the write may have landed

**File:** `src/lib/wizardErrors.ts:3133-3136` (the copy)
**Emitters:** `src/app/api/strategies/[id]/ownership/route.ts:317-320`,
`src/app/api/portfolio-strategies/allocation/route.ts:379-382` (and, less certainly,
`ownership/route.ts:302-305`, `allocation/route.ts:364-370`)

**Issue:** The newly minted copy reads:

> "Our own service failed part-way through the change and stopped. **Nothing was saved** — the
> strategy is as it was before you pressed save."

It is emitted unconditionally for every `internal error` 500 on all three dashboard routes. Two
of those arms are documented **in the route itself** as having an unknown outcome:

- `ownership/route.ts:309-316` — the flip-RPC-returned-no-row arm. Its own comment:
  *"A RETURNS TABLE function that yields no row leaves the counts unknown. Reporting success
  here would claim a flip that may not have happened."* The RPC is
  `flip_capital_ownership_to_team_review`, which **removes the caller's live allocations**. So
  the user can be told "Nothing was saved" while their strategy has been flipped to
  `team_review` and their positions stranded.
- `allocation/route.ts:373-382` — the upsert-returned-zero-rows arm. Its own comment:
  *"An upsert that returns nothing is an anomaly (RLS ate the row, or the conflict target
  drifted)."* "RLS ate the row" means the **write succeeded** and the returning row was
  suppressed. The user is told nothing was saved about a money allocation that may be live.

This is not a style objection; it is this repo's own written standard. `wizardErrors.ts:709-714`
records that a code whose outcome is unknowable *"may not say 'Nothing was saved'… in either
direction"*, and `wizardErrors.ts:2470-2481` states the rule outright: **"'NOTHING WAS SAVED' IS
VERIFIED, NOT ASSERTED"**, then spends nine lines showing the three layers that verify it for
`CSV_UPSTREAM_FAIL`. `DASHBOARD_WRITE_FAILED` does no such verification and covers arms that
cannot support it.

Aggravating: `actions: ["clear_and_retry", …]` and the union-member comment justify recoverability
with *"these writes set a stated value so a retry cannot double anything."* That is true of the
name/amount writes; it is **not** obviously true of a flip that also deletes allocation rows, and
the user is invited to "Try the same change again" on top of a state they have been told is
unchanged.

**Fix:** Either split the code, or claim only what is established. Minimal split:

```ts
// strategyGate-style: one code per verified property, not per call site.
| "DASHBOARD_WRITE_FAILED"        // verified zero-write: the failure is a READ
| "DASHBOARD_WRITE_INDETERMINATE" // the write was issued and the outcome is unknown
```

- `DASHBOARD_WRITE_FAILED` keeps today's copy and is emitted only where nothing was issued:
  `ownership/route.ts:228` (portfolio lookup), `:254` (position lookup),
  `allocation/route.ts:~230` (strategy lookup), `resolved.kind === "error"` arms.
- `DASHBOARD_WRITE_INDETERMINATE` covers `ownership:302`, `ownership:317`, `ownership:365`,
  `allocation:364`, `allocation:379` and the DELETE-arm 500s, with a cause that states only the
  truth, e.g.:

```ts
cause:
  "Our own service failed while making the change and we cannot tell whether it landed. "
  + "Reload the page and check the strategy's current state before trying again.",
actions: ["leave_and_return", "expand_log"],   // NOT clear_and_retry
```

If splitting is out of budget for this phase, the minimum acceptable edit is to strike
"Nothing was saved" from `DASHBOARD_WRITE_FAILED`'s cause and remove `clear_and_retry`, since
neither claim is established for every arm the code covers.

---

### CR-02: the CSV per-row breakdown still prints a fabricated row index — on the exact founder case WIZERR-13 was measured against

**Files:** `analytics-service/services/csv_validator.py:770` and `:808`;
`src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx:201`;
`src/lib/wizardErrors.ts:4671-4676`

**Issue:** Two co-operating defects leave the requirement's own measured specimen — a
`daily_returns` upload whose value column is misnamed — reading worse than "a column called nan".

1. `csv_validator.py:770` computes `row_idx = int(idx) + 1 … else 0`. Real rows are **1-based**,
   so `0` is a sentinel that no row can carry. For a dataframe-level check (`index` is NaN) it
   is always `0`, and `:808` interpolates it: **`Failed rule 'column_in_dataframe' at row 0.`**
   161-03 removed the invented column name and left the invented row number in place. An
   invented number in user copy is the class this phase kills (161-UI-SPEC Copy Principle 5).
2. `CsvValidationEnvelope.tsx:201` routes exactly this rule through
   `formatColumnInDataframeMessage`, whose regex (`wizardErrors.ts:4672`)
   `/Column\s+'[^']*'\s+failed:\s+(\S+)/` cannot match this producer's shape (`… failed rule
   '…' at row N.`) and never could — so `:4673` returns the raw sentence and the *actionable*
   copy the formatter exists to supply (*"The required column `X` is missing… Rename a column
   to `X`"*) is dead code that has never rendered.

Net user-visible result for the phase's headline CSV case: a rule name they cannot act on, a row
number that does not exist, and no remedy. Both halves are booked (D-161-02, D-161-03) with the
UI-SPEC named as the blocker — but the UI-SPEC is a proposal that has been defective five times
this phase, and 161-05 / 161-07 both overrode it on precisely this ground (an unwinnable or false
line). Shipping this one verbatim is inconsistent with those two calls.

**Fix (both halves are small):**

```python
# csv_validator.py — the row clause is OMITTED when there is no row, exactly as the
# column clause now is. Do not substitute another number.
row_idx_raw = row.get("index")
has_row = row_idx_raw is not None and pd.notna(row_idx_raw)
row_idx = int(row_idx_raw) + 1 if has_row else 0   # 0 stays the WIRE sentinel
...
if column_name and has_row:
    message = f"Column '{column_name}' failed rule '{rule_name}' at row {row_idx}."
elif column_name:
    message = f"Column '{column_name}' failed rule '{rule_name}'."
elif has_row:
    message = f"Failed rule '{rule_name}' at row {row_idx}."
else:
    message = f"Failed rule '{rule_name}'."
```

and either delete `formatColumnInDataframeMessage` (dead branch, `wizardErrors.ts:4671-4676`,
plus its call at `CsvValidationEnvelope.tsx:201`) or re-point its regex at the shape the
producer actually emits. Deleting is the honest move until D-161-02's producer field exists;
leaving a formatter that has never fired is a false claim in code shape.

Add a regression pin asserting the rendered `<li>` for a dataframe-level failure contains
neither `'nan'` nor `row 0` — the existing 161-03 pin only covers the column half.

---

## Warnings

### WR-01: `keyRouteFailureHeaders` puts an unvalidated number on the `Retry-After` wire, contradicting its own docblock

**File:** `src/lib/api/seam-retry-after.ts:100-107`

**Issue:** The seam branch guards `Number.isFinite(advertisedWait) && advertisedWait > 0` but not
`Number.isInteger`. `parseRetryAfterSeconds` (`src/lib/retry/retry-after.ts:42-46`) returns
`Number(raw)` for any finite positive value, so `Retry-After: 0.5` or `Retry-After: 1e3` from an
intervening proxy/CDN is relayed verbatim onto **our** response as `"0.5"` — not a valid
RFC-9110 `delta-seconds`, and the wizard then renders it as `Try again in 0.5s`
(`ErrorEnvelope.tsx:171`). `CircuitOpenError` (`src/lib/seam-errors.ts:76-81`) carries an explicit
`Number.isInteger` guard *for exactly this reason*, quoted in its own comment: *"it is forwarded
as a `Retry-After` HEADER by both seam clients."* 161-06 created a second value forwarded onto
the wire and did not inherit the guard.

The file's TRAP-3 section also states the absence rule for **both** sources ("Never `\"0\"`,
never `\"\"`, never a default"), but the breaker branch stamps `String(err.retryAfterS)`
unconditionally. Today that is safe (both `new CircuitOpenError` sites at
`resilient-fetch.ts:2370` / `:2495` pass `Math.ceil` over a strictly-future expiry, so ≥ 1) —
which means the docblock is describing a property the code does not enforce, only inherits.

**Fix:**

```ts
return err instanceof CircuitOpenError
  ? Number.isInteger(err.retryAfterS) && err.retryAfterS > 0
    ? { ...NO_STORE_HEADERS, "Retry-After": String(err.retryAfterS) }
    : NO_STORE_HEADERS
  : typeof advertisedWait === "number" && Number.isInteger(advertisedWait) && advertisedWait > 0
    ? { ...NO_STORE_HEADERS, "Retry-After": String(advertisedWait) }
    : NO_STORE_HEADERS;
```

(Or normalise in `parseRetryAfterSeconds` with `Math.ceil` — but that changes a shared parser and
needs its own pin.) Add a case with `Retry-After: "0.5"` on the fixture response.

### WR-02: `dialog-envelope.invariant.test.ts`'s ARRIVAL half is not derived — a new route arm cannot red it

**File:** `src/lib/dialog-envelope.invariant.test.ts:152-233` (`emittedCodes`), `:341-383`
(the assertion)

**Issue:** The case is named *"A. ARRIVAL: every code a route emits is rostered OR an explicit
disposition"*, but `emittedCodes` is a **hand-typed array in the test file**, never read from the
route. The population of *files* is derived from disk; the population of *codes* is not. So the
regrowth vector the law exists to close — a fourth arm added to `portfolio-strategies/allocation`
with a code nobody rosters — produces no RED. The law's docblock argues against deriving
`emittedCodes` *from the roster* (correct — that would be self-reference), but does not consider
deriving them from the **route source**, which is a third independent artefact.

The sibling law does exactly that: `wizardErrors.invariant.test.ts:325-390` (the 4th `ROUTES`
row) derives route codes with `deriveEmittedCodes` + `emitterRe`. All three dashboard routes were
made `code:`-first in `31d0333a` / `0b8f08c1`, so the derivation is available today.

**Fix:** derive per route with the existing helper and keep the hand-typed list as the
independent expected-set oracle — the shape `[161-05 / WIZERR-03]`'s 409 population already
uses:

```ts
const derivedCodes = deriveEmittedCodes(stripped(ROUTE_PATHS[dialog.route]), "[45]\\d\\d");
expect(derivedCodes.length).toBeGreaterThan(0);              // vacuity fence
expect([...new Set(derivedCodes)].sort()).toEqual([...dialog.emittedCodes].sort()); // drift
// …then run the existing rostered/dispositioned loop over `derivedCodes`.
```

Until then, downgrade the case title so it states what it checks ("every HAND-TYPED code…").

### WR-03: the phase's own new emitter on `keys/[id]/permissions` is written `{ error, code }` — the shape 161-09 measured as invisible to every coverage law

**File:** `src/app/api/keys/[id]/permissions/route.ts:570-575`

**Issue:** 161-09's central finding, restated at `wizardErrors.ts` and at
`keys/validate-and-encrypt/route.ts:266-278`, is that **every** coverage law in this repo derives
its population with a `code:`-first predicate, so `{ error, code }` is invisible to all of them —
a hazard now confirmed three times. 161-05, 161-09 and 161-10 all wrote their new literals
`code:`-first. 161-01's `KEY_UNDECRYPTABLE` arm did not:

```ts
return NextResponse.json(
  {
    error: "This stored key can no longer be decrypted. …",
    code: "KEY_UNDECRYPTABLE",
  },
```

It is covered today **only** because `probe-vocabulary.invariant.test.ts:113` brings an
order-agnostic `\bcode:\s*"…"` scanner of its own. The day this route joins `ROUTES`, or a
repo-wide `NextResponse.json({ error:` contract scan lands (161-09's own note #3 proposes
exactly that), this arm and the seven beside it go invisible while continuing to work.

**Fix:** transpose the two keys (`code:` first) in that literal, and — since the file has other
error-first arms — record the same key-order note the sibling routes carry. Zero behaviour
change; `probe-vocabulary.invariant.test.ts` stays green because its needle is order-agnostic.

### WR-04: `verify-strategy`'s sfox arm ships the copy the UI-SPEC explicitly forbids on the anonymous surface, guarded only by a fact nothing detects

**File:** `src/app/api/verify-strategy/route.ts:186-209`

**Issue:** `161-UI-SPEC § Copy Spec WIZERR-08` is unambiguous for this route: *"Public copy for
that arm reads as unsupported-here … **never 'not open here YET'**"* (F3). The shipped code is
`KEY_VENUE_NOT_ENABLED`, whose `WIZARD_ERROR_COPY` entry reads *"This exchange is not open on
Quantalyze yet."* — the forbidden wording. The route's own comment
(`:200-208`) acknowledges this, calls it a "LATENT HAZARD", and defers on the measured basis that
`VerificationForm` never reads `code`.

Two problems with that mitigation:

- **Nothing detects the day it stops holding.** The comment says "F3 must be re-decided AT THAT
  MOMENT", but there is no test, no law and no roster row that reddens when an anonymous surface
  starts translating this route's codes. Compare 161-10, which added a law for exactly that class
  of regrowth.
- **The nine arms are invisible** to every coverage law (derived population zero, deliberately
  left `{ error, code }`, deviation 4), so a future consumer wiring the code channel will not
  even show up in a scan.

The *sentence* is byte-identical and already says "sFOX integration is not yet available.", so
there is no live disclosure regression — this is a latent one with no tripwire, on a public
unauthenticated route.

**Fix (cheapest sufficient):** add a guard case to `verify-strategy/route.test.ts` (or to the
seam-vocabulary law) asserting that no non-test file under `src/components/landing/` or any
anonymous surface references `recogniseSeamErrorCode` / `WIZARD_ERROR_COPY` while consuming
`/api/verify-strategy` — i.e. pin the premise the deferral rests on, so it reds when it moves.
Alternative: give this arm a route-local code (`VENUE_NOT_OFFERED_HERE`) that is not a
`WizardErrorCode`, which makes the hazard unrepresentable rather than deferred.

### WR-05: `INSUFFICIENT_CSV_HISTORY`'s operator-visible gate reason still names a CSV the strategy does not have

**File:** `src/lib/strategyGate.ts:346-353`

**Issue:** The reason string is rendered raw on the admin surface as
`Cannot approve: CSV history has only 3 day(s) of returns. A minimum of 7 days is required.`
161-07's own measurement (recorded in the SUMMARY and at `wizardErrors.ts:287-300`) establishes
that this arm is reached by **keyed** accounts — deribit / mt5 / sfox stamp `ledger_complete`,
their dailies are derived from the venue ledger, and `strategyGate.test.ts:385` already pins that
case. That is precisely why the wizard copy was corrected off the word "CSV". The admin sentence
was left describing a source the strategy does not have, on the surface a reviewer triages from.

The UI-SPEC held the reason string "unchanged", but the UI-SPEC also proposed the false wizard
bullet 161-07 replaced on the same evidence; the two calls should be consistent.

**Fix:**

```ts
reason: `The return series covers only ${csvRowCount} day(s). A minimum of ${STRATEGY_GATE_MIN_CSV_ROWS} days is required.`,
```

Number-attached form and `detail: { rows, min }` preserved. Re-point the one admin pin.

### WR-06: stale docstring in the file 161-02 changed — `Mt5GatewayMisconfigured` still describes the sink it replaced

**File:** `analytics-service/services/mt5_probe.py:160-164`

**Issue:** The class docstring still reads *"so `job_worker.classify_exception` can map it onto
`("permanent", MT5_GATEWAY_MISCONFIGURED_DETAIL)`"*. 161-02 changed that sink to
`curated_gateway_detail(exc)` (`job_worker.py:684`), which is the whole point of the plan — the
generic constant is now the *degradation target*, not the return value. 161-02 Task 2's declared
job was to correct every prose carrier of the superseded claim across nine locations; this one is
in the same file as the new builder and was missed. A comment describing behaviour that no longer
exists is this phase's own defect class.

**Fix:**

```python
    Raised by ``services/ingestion/mt5.py`` where a bare ``RuntimeError`` used to
    be, so ``job_worker.classify_exception`` can map it onto ``("permanent",
    curated_gateway_detail(exc))`` — the allow-list read that lets the raise
    site's derived cause reach the operator while raw remote text degrades to
    ``MT5_GATEWAY_MISCONFIGURED_DETAIL`` — instead of falling through to
    ``("unknown", str(exc))`` …
```

---

## Info

### IN-01: `LiveAllocationRefusal`'s docblock describes a field the same commit deleted

**File:** `src/components/strategy/MarkOwnershipDialog.tsx:50-57`
The comment says *"`error` is kept on the type only because the route still sends it"* — but the
diff removed `error?: unknown` from the interface and added `code?: unknown`. Delete the clause.

### IN-02: the Principle-4 correlation-id argument is not backed by the renderer

**Files:** `src/lib/wizardErrors.ts:3097-3103` (and the `KNOWN_VALIDATE_AND_ENCRYPT_CODES` /
`DASHBOARD_DIALOG_ROUTE_CODES` docblocks); `src/components/error/ErrorEnvelope.tsx:201-212`
The reasoning is that "no correlation id on an actionable arm" holds because `expand_log` is
present only on terminal members. `ErrorEnvelope` renders the `<details> Diagnostics` block —
`code` and `correlation_id` — **unconditionally**, with no reference to `actions`. The property
happens to be satisfied today because the actionable arms' copy also asks the user to quote the
id; it is not enforced. Either gate the block on `actions.includes("expand_log")` (behaviour
change, needs its own pin) or restate the docblocks so they do not claim a mechanism.

### IN-03: `GATE_SERIES_EXAMINED_REFUSED`'s first remedy names no venue the user can choose

**File:** `src/lib/wizardErrors.ts:1926-1928`
*"Connect a key from a venue we can read end to end — one that gives us a complete transaction
ledger rather than a fill feed."* The qualifying set is knowable at HEAD (the venues whose
producers stamp `ledger_complete`), and `venueCapability` / `venueIs` machinery already exists to
name them conditionally. As written the user must guess which of the six venues qualifies —
short of "unwinnable", but short of actionable too.

### IN-04: `keys/validate-and-encrypt`'s declared vocabulary understates what the route can emit

**Files:** `src/lib/wizardErrors.ts` (`KNOWN_VALIDATE_AND_ENCRYPT_CODES`, 6 members);
`src/lib/wizardErrors.invariant.test.ts:325-390` (`expectedSites: 11`)
Both deliberately exclude the twelfth site — the terminal 500 arm — because its code is computed.
That arm is the one 161-08 widened to forward arbitrary upstream `seamCode`s; 161-08's own W1
inventory lists **fifteen** service-emitted ≥500 codes that can now cross it. So the route's
"declared vocabulary" is 6 while its emittable set is ~21. The exclusion is reasoned at the row,
but a reviewer auditing roster coverage will read 6 as complete. Worth one sentence at the roster
naming the computed channel and pointing at 161-08's table.

---

## Verified clean (spot-checks worth recording)

- `tsc --noEmit -p tsconfig.json` — clean at HEAD.
- `src/lib/wizardErrors.test.ts` NUL count = **1** (240 949 bytes); `EXPECTED_TABLE_SIZE = 88`
  appears at exactly 2 sites (`grep -ac`).
- No `err.message` reaches a 5xx body on any of the five WIZERR-06 routes: every `error:
  err.message` site is inside an arm guarded by `err.status < 500`
  (bridge:191, simulator:206, eval:266, recompute:207, validate-and-encrypt:756).
- `keys/validate-and-encrypt`'s credential scrubbing is untouched by 161-08/161-09:
  `scrubSeamError(err, perRequestSecrets)` and `captureToSentry(err, { secrets: perRequestSecrets })`
  have no diff hunk, and every reordered arm keeps `headers: NO_STORE_HEADERS`.
- `_forwarded_pandera_rows` (`process_key.py:82-112`) is a genuine projection: three named keys,
  `isinstance` guards at every level, bool excluded from the int check. `failure_case` cannot
  cross. (`message` content is unchanged from what the upload path already renders and what
  `csv_adapter.py:173-177` already puts in `human_message`, so no new channel is opened.)
- `mt5_gateway_misconfigured_detail` is `KeyError`-proof: `isinstance(…, Mapping)` first, `.get()`
  throughout, absent key cannot select arm 2. `curated_gateway_detail` is an exact-membership
  allow-list over a `Final[tuple]` — no substring, no interpolation.
- The two self-reported `git checkout --` incidents left no half-restored edit:
  `ConnectKeyStep.tsx`'s diff is exactly the `KEY_ORPHANED` roster row plus its comment, and
  `verify-strategy/route.ts` carries all four re-coded arms, the retained email arm and the F3
  ordering intact (`grep -n 'code: "'` returns the expected nine sites).
- `checkStrategyGate`'s new `SERIES_EXAMINED_REFUSED` arm is mutually exclusive with the
  provenance arm by construction (`has(v)` / `get(v)` on the same Map with the same `?? ""`
  coercion) and cannot fall through to the trade floor while `csvRowCount > 0`.
- The parity, terminal-arm and probe-vocabulary laws each carry a non-empty population fence, two
  independent hand-typed oracles, blank-needle length floors (not truthiness), and positive +
  negative scanner self-tests. None uses `derived.length` as its own expectation.

---

_Reviewed: 2026-08-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## ORCHESTRATOR DECISION (2026-08-24) — disposition of the two Criticals

Both Criticals are **BLOCKING**. Under the project stopping rule a review blocks only on
user-facing or data-integrity findings; CR-01 is both (it mis-describes the outcome of a money
write), and CR-02 is a fabricated number on the very requirement that exists to kill fabricated
numbers. Neither may be deferred to TODOS.

### CR-01 — take the SPLIT, not the strike

Fix option (a): introduce a distinct **indeterminate** code alongside the verified-zero-write one.
Do NOT take option (b) (strike the clause), because "we could not complete that" with no statement
about persistence leaves the user unable to decide whether to retry — trading a false sentence for
an unusable one. The phase goal is copy that *names the actual state*, and "we do not know whether
this landed" IS the actual state on these arms.

Binding requirements for the fix:
- The verified-zero-write arms keep today's "Nothing was saved" sentence **byte-identical** and keep
  `clear_and_retry`.
- The indeterminate arms (at minimum `ownership/route.ts:317-320` "flip rpc returned no row" and
  `portfolio-strategies/allocation/route.ts:379-382` "upsert returned zero rows") get the new code.
  Its copy must NOT claim persistence either way, and must NOT offer `clear_and_retry` — a blind
  retry against a possibly-applied money write is the unwinnable-remedy defect wearing a new hat.
  Direct the user to re-read current state instead.
- Walk **every** emitter of `DASHBOARD_WRITE_FAILED` and classify it verified-zero vs indeterminate
  from the route's own code, not from its comment. Record the per-arm verdict in the SUMMARY.
- `EXPECTED_TABLE_SIZE` moves 88 → 89. Re-measure at HEAD; move **both** pins in the same commit.
- Honour `wizardErrors.ts:2470` and `:709-714` explicitly in the new entry's docblock.

### CR-02 — fix, do not re-defer

The UI-SPEC citation behind D-161-02/D-161-03 is not a sufficient reason: `161-05` and `161-07` both
overrode the UI-SPEC on precisely this ground after measuring the producer, and the UI-SPEC has been
found defective five times this phase. Treat it as a proposal.
- `csv_validator.py:770` uses `0` as the absent-row sentinel and `:808` interpolates it, so a
  dataframe-level failure renders `at row 0`. Suppress the row clause entirely when the sentinel is
  present — never print a row number for a failure that has no row.
- `formatColumnInDataframeMessage` (`wizardErrors.ts:4671-4676`) carries a regex
  `/Column\s+'[^']*'\s+failed:\s+(\S+)/` that **cannot match this producer's shape** — it is dead
  code that has never rendered, so the actionable "rename a column to X" remedy has never reached a
  user. Either repair the regex against the producer's real message shape (measure it) or delete the
  formatter and its call site. Do not leave a formatter that cannot fire.
- Both halves need a test that fails without the fix.

### Warnings

Fix **WR-01** (a proxy-injected fractional `Retry-After` reaching our own wire is a correctness bug,
and `CircuitOpenError` already carries the `Number.isInteger` guard for exactly this reason) and
**WR-06** (a stale docblock in the file the change landed in). WR-02, WR-03, WR-04 and WR-05 are
real but are the `code:`-first / law-derivation class already booked for follow-up — record them in
TODOS.md rather than widening this phase further. The four Info items are non-blocking.
