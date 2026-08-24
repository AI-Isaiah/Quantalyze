# Phase 161 — deferred items

Out-of-scope discoveries made during execution. Logged, NOT fixed (executor scope boundary).

---

## D-161-01 — the `first_rule.upper()` CSV code family is invisible to the derived vocabulary

**Found during:** 161-03 Task 1 (full-suite run, `seam-venue-vocabulary.invariant.test.ts`).

`services/ingestion/csv_adapter.py` sets `error_code=first_rule.upper()` on a CSV
rejection, so EVERY pandera rule name is a real wire code (`COLUMN_IN_DATAFRAME`,
`MONOTONIC_DATES`, `DAILY_RETURN_LOWER_BOUND`, …). The seam vocabulary law derives its
population from **literals** in the Python tree, so a computed code is invisible: none of
the family is in `derived`, none has a row in `VENUE_WIRE_CODE_TO_VERDICT`, and none has a
reasoned exemption. They fall through the substring cascade to whatever an English sentence
earns — the exact defect class that law exists to catch.

This predates 161-03; `src/lib/wizardErrors.ts`'s `CSV_VALIDATION_FAILED` docblock already
records it as its third measured reason ("THE CODE IS A RULE NAME"). 161-03 only made it
visible, by adding a test fixture that names one member of the family.

**Why not fixed here:** closing it means either enumerating the rule family as literals at
the adapter (so the scanner sees them) or giving the family one disposition — a vocabulary
decision, not a copy fix, and outside WIZERR-12/13's scope.

---

## D-161-02 — `formatColumnInDataframeMessage` matches a shape this producer has never emitted

**Found during:** 161-03 Task 1.

`src/lib/wizardErrors.ts:3898` matches `/Column\s+'[^']*'\s+failed:\s+(\S+)/` — "Column 'x'
failed: daily_return". `csv_validator.py` emits "Column 'x' failed rule 'y' at row N." and
always has. The regex therefore never matches and every `column_in_dataframe` row falls
through to the raw message.

Consequence after 161-03's nan-guard: the user is told *that* a required column is missing
(via `CSV_RULE_LABELS.column_in_dataframe`) but not *which* one. The name lives only in
pandera's `failure_case`, which T-161-07 forbids forwarding.

**Why not fixed here:** recovering the column name needs a producer-side change (carry the
expected column as a first-class field beside `rule`/`row`/`message`, never via
`failure_case`), plus a client change. Both are outside WIZERR-13's stated behaviour.

---

## D-161-03 — the column-less message still renders "at row 0"

**Found during:** 161-03 Task 1.

For a dataframe-level check there is no row, and `csv_validator.py` reports the absent index
as `0` (its existing sentinel). The 161-UI-SPEC's approved copy for this case is
`"Failed rule '{rule_name}' at row {row_idx}."`, so the shipped sentence reads "Failed rule
'column_in_dataframe' at row 0." — a row number for a failure that has no row.

**Why not fixed here:** 161-UI-SPEC § Copy Spec WIZERR-13 is the binding copy contract and
states this sentence explicitly. Changing it is a UI-SPEC amendment, and improvising against
an approved contract is the failure mode this phase's discipline exists to prevent. Raised
for the phase owner.
