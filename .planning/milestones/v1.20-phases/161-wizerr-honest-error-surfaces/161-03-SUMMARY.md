---
phase: 161-wizerr-honest-error-surfaces
plan: 03
subsystem: csv-validation-surfaces
status: complete
tags: [wizerr, csv, copy-truth, pii, no-echo, coverage-law, anti-vacuity]
requires:
  - "analytics-service/services/ingestion/csv_adapter.py — puts validate_csv's `errors` under debug_context.violations"
  - "src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx — has always read debug_context.pandera_errors"
  - "src/app/api/strategies/csv-finalize/route.ts refuse() — the optional humanMessage param (146.2-01 / R1)"
provides:
  - "nan-guarded column clause in csv_validator.py's SchemaErrors message builder"
  - "_forwarded_pandera_rows() — the {rule,row,message} projection in process_key.py"
  - "_envelope_error(source_debug_context=…) — the submit path's per-row forward"
  - "the A2 terminal-status-mismatch case-specific humanMessage in csv-finalize/route.ts"
affects:
  - "every submit-path CSV rejection envelope (validate-only, the 424 venue-transient pre-gate, the 403 rejection)"
  - "the csv-finalize A2 409 body"
  - "seam-venue-vocabulary.invariant.test.ts's `tests` scan-exclusion pin (57 → 59)"
tech-stack:
  added: []
  patterns:
    - "projection-not-passthrough at a trust boundary: name the keys that may cross, so an added upstream key is dropped by construction rather than by remembering"
    - "pd.isna as the absence guard, never a string match on 'nan' — a column may legitimately be named nan"
    - "hand-typed copy oracles with a machine-confirmed byte-equality anti-control"
key-files:
  created:
    - ".planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md"
  modified:
    - "analytics-service/services/csv_validator.py"
    - "analytics-service/routers/process_key.py"
    - "analytics-service/tests/test_csv_validator.py"
    - "analytics-service/tests/test_process_key.py"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.test.tsx"
    - "src/app/api/strategies/csv-finalize/route.ts"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.upstream-arm.test.tsx"
    - "src/__tests__/csv-finalize-c14-regression.test.ts"
    - "src/lib/seam-venue-vocabulary.invariant.test.ts"
decisions:
  - "The UI-SPEC's proposed A2 sentence was ADJUSTED: both halves of 'this track record, different flow' are unestablished at that arm. Shipped what the arm has actually established."
  - "The nan-guard is pd.isna, never a substring match on 'nan' — a CSV may legitimately have a column named nan, and for that file the column clause is correct."
  - "val.debug_context is threaded at ALL THREE arms holding a `val`, not just the one the plan named — a one-site fix leaves the panel empty on whichever arm the caller hits."
  - "The scan-exclusion pin was ARGUED and moved with a dated reason, per the law's own instruction, not silently bumped."
metrics:
  duration: "~50 min"
  completed: 2026-08-24
actuals:
  tokens: 12461
  tasks: 3
  commits: 4
---

# Phase 161 Plan 03: CSV surfaces tell the truth about their data — Summary

The per-row CSV breakdown stops naming a column called `nan`, actually arrives on the submit
path in a shape that cannot carry an untrusted cell, and the csv-finalize A2 409 stops
claiming a track record it has not read.

## What changed, per task

### Task 1 (tracer, tdd) — nan-guard at the producer + forward the data half
**Commit `a371de7d`.**

**The nan half.** `csv_validator.py`'s `SchemaErrors` loop interpolated
`row.get('column')` unconditionally. For a DATAFRAME-level pandera check there is no column,
pandera reports `column` as a float NaN, and the f-string rendered its `str()`. Measured
first-hand at pre-fix HEAD, driving a `daily_returns` upload whose value column is misnamed:

```
Column 'nan' failed rule 'column_in_dataframe' at row 0.
```

The column clause is now OMITTED when there is no column, per 161-UI-SPEC § Copy Spec
WIZERR-13. The guard is `pd.isna`, deliberately **not** a string match on `"nan"`: a CSV is
free to have a column literally named `nan`, and for that file the clause is correct.

**The forwarding half.** `CsvValidationEnvelope.tsx:123` has always read
`debug_context.pandera_errors`; `_envelope_error` rebuilt `debug_context` from the
verification id alone and never looked at `val.debug_context`, where the CSV adapter puts its
rows under `violations`. Every submit-path CSV rejection therefore rendered a headline with
nothing beneath it. `_envelope_error` gained `source_debug_context`, threaded at **all three**
arms that hold a `val` — `_run_validate_only`'s `not val.valid` return, the PYAPIFIX-02
venue-transient 424 pre-gate, and the 403 rejection. The plan named the first; fixing one site
only would leave the panel empty on whichever arm the caller happens to hit (a CSV rule code
like `COLUMN_IN_DATAFRAME` is absent from `PERMANENT_VALIDATION_ERROR_CODES`, so a CSV
rejection in the synchronous pipeline routes to the 424 arm, not the 403).

**Acceptance criteria, checked:**
- Both no-echo discipline comments are byte-identical. `git diff` on `csv_validator.py` removes
  exactly two lines, both halves of the old f-string. Nothing else.
- No forwarded row carries a key beyond `rule`/`row`/`message` — enforced by construction, not
  by assertion: `_forwarded_pandera_rows` names the three keys rather than copying the dict.
- The NaN fixture drives a real dataframe-level failure through `validate_csv`, not a
  hand-built `failure_cases` frame. The wiring is tested.

### Task 2 (auto, tdd) — client render pins for the data half
**Commit `2916bbe0`.** Five cases added to `CsvValidationEnvelope.test.tsx`; **no production
change to the component** — every case passed against the untouched render, so no render fix
was needed. Fixtures are hand-typed wire envelopes (a `renderWire` helper takes `unknown` and
casts at the boundary, so a fixture can smuggle a key the typed shape does not have).

- zero rows ⇒ the `<details>` region is ABSENT (`querySelectorAll("details")` length 0), not an
  empty shell that opens onto nothing
- 1..N rows ⇒ rule label, `Row N:` and message all render
- the column-less producer shape renders cleanly: no `'nan'`, no dangling `Column ''`
- NO-ECHO: a `failure_case`-shaped key with a PII-looking value never reaches the DOM — **and**
  the row it rides on still renders, so the pin is not satisfied by dropping the row wholesale
- long-text backstop: a long rule key and message do not cost the row index

### Task 3 (auto) — WIZERR-12, the A2 case-specific humanMessage
**Commit `c31ff18c`.** See the truth validation below. New A2 pin in
`csv-finalize-c14-regression.test.ts` (route level, real) and in
`CsvSubmitStep.upstream-arm.test.tsx` (render level, wire-mocked), plus an ANTI-CONTROL case
asserting the DEFAULT sentence is byte-identical on the name-mismatch arm.

### Follow-on — the scan-exclusion pin
**Commit `251ddcc7`.** See "Deviations".

---

## THE WIZERR-12 TRUTH VALIDATION (the plan's explicit obligation)

**What the UI-SPEC proposed:**

> "This wizard session already committed **this track record** through **a different flow**, so
> we refused before writing anything of this submission. ${START_NEW_STRATEGY_LABEL} to make a
> separate submission."

**What I read.** The A2 arm's own docblock (`csv-finalize/route.ts` ~`:1293-1329`), the arm's
code, the two callers that supply `terminalStatus`, and the sibling refusal suite.

**What the arm has ESTABLISHED when it fires:**
1. A 23505 on the partial unique index `(user_id, wizard_session_id, source) WHERE
   wizard_session_id IS NOT NULL`.
2. A committed row re-fetched under `user_id` + `wizard_session_id` + `source='csv'`.
3. `typeof existingRow.status === "string" && existingRow.status !== args.terminalStatus`.

**What it has NOT established — and both halves of the proposed sentence are in this list:**

- **"this track record" is unestablished.** A2 runs BEFORE the name check (`CR-01 check 1`) and
  BEFORE the series-equality check (`CR-01 check 2`). Nothing about the track record has been
  read at that point. This is not an inference — the sibling suite's own case
  (`csv-finalize-cross-submission-merge.test.ts`, *"the STATUS comparison runs BEFORE the name
  check"*) arms the committed row with name `"Renamed"` precisely because the names may differ
  too. The docblock's mechanism paragraph says the same thing from the other end: because
  `wizard_session_id` is restored **unconditionally** from one shared localStorage key,
  *"unrelated wizard runs arrive carrying the same session id"*.
- **"a different flow" is unestablished too**, and this is the half the UI-SPEC's warning did
  not anticipate. The docblock names the manager-vs-contribution collision, and that IS the case
  A2 was built for: the two flows differ ONLY in the `terminalStatus` they pass
  (`"private"` for `entry_context === "contribution"`, `"pending_review"` for the manager flow).
  But `existingRow.status` is the row's **current** status, read live from a `select("id, name,
  status, …")`, and `src/app/api/admin/strategy-review/route.ts:278` writes
  `{ status: "published" }` onto a reviewed row. A manager resubmit onto an already-published
  row of the **same** flow reaches this arm too, and calling that "a different flow" would be a
  new false sentence.

**Result — ADJUSTED, and this is what shipped:**

> "This wizard session already committed a strategy that is not in the state this submission
> asked for, so we refused before writing anything of this submission. ${START_NEW_STRATEGY_LABEL}
> to make a separate submission."

It claims only (2) and (3). Checked against the Copy Principles: names the actual blocker (1);
the remedy CAN succeed (2) — `handleCsvStartNewStrategy` (`WizardClient.tsx:727-751`) mints a
fresh `wizardSessionId`, so the resubmit no longer collides on the partial index, and the
escape control is gated on `code === CSV_SESSION_REUSED` so it is offered on this arm; no
internals (3) — no status names, no ids, no flag names; no invented number (5); declarative
sentence case, active, no filler (6). The second half is structurally identical to the default
sentence's, and `START_NEW_STRATEGY_LABEL` is **interpolated**, preserving the W-1 invariant
that the escape control is never named in prose here.

**Not changed:** the internal `reason` string (which names both statuses for the operator
reading Sentry), the 409 / `CSV_SESSION_REUSED` / `no-store` / one-capture shape, the zero-write
property, and the DEFAULT sentence for the name / series / date arms where it is true.

### IN-05 fixture ↔ route byte-equality — hand-verified AND machine-confirmed

The plan asked me to re-verify by hand and state it. I did, and then went one better: the c14
ANTI-CONTROL case types the **default** sentence by hand and asserts `toBe` against the live
route. It passed **on the unmodified route**, before I touched anything — so the hand-typed pin
is machine-confirmed byte-identical, not merely claimed. The shared string, once:

```
This wizard session already created a strategy with a different track record, so we refused
before writing anything of this submission. Start a new strategy to upload a different file.
```

The same discipline was applied to both new A2 fixtures (`ROUTE_A2_STATUS_MISMATCH` in c14,
`ROUTE_SESSION_REUSED_STATUS_MISMATCH` in the upstream-arm file). Both are hand-typed with the
escape label spelled out in words while the route interpolates the constant. The c14 one is
asserted `toBe` against the real route response, which is what makes it a genuine oracle; the
upstream-arm one is on both sides of a mocked wire, which that file's own docblock already
states cannot detect drift — its job is the PAIRING (the panel renders the route's sentence,
not the copy table's title), and it does that.

---

## Anti-vacuity — every RED observed first-hand, with the message

**Note on the guard rule.** `"anything".includes("")` and `"" in "anything"` are both true.
Every substring assertion I wrote is guarded at BOTH ends before it is relied on: the needle
gets an explicit length assertion (`expect(CELL.length).toBeGreaterThan(10)`,
`assert len(_PII_MARKER) > 10`, `expect(ROUTE_DEFAULT_TRACK_RECORD_MISMATCH.length).toBeGreaterThan(60)`)
and the haystack gets one too (`expect(text.length).toBeGreaterThan(20)`,
`assert isinstance(message, str) and len(message) > 20`).

| # | Pin | Neuter | Observed RED |
|---|-----|--------|--------------|
| 1 | `test_dataframe_level_failure_never_renders_the_literal_nan` | the unguarded interpolation (i.e. pre-fix HEAD — RED-first TDD, so the "neutered" state was the real code) | `AssertionError: the per-row breakdown named a column called 'nan' — the float NaN pandera reports for a dataframe-level check: "Column 'nan' failed rule 'column_in_dataframe' at row 0."` |
| 2 | `test_dataframe_level_failure_omits_the_column_clause_entirely` | same | `AssertionError: assert "Column 'nan' failed rule 'column_in_dataframe' at row 0." == "Failed rule 'column_in_dataframe' at row 0."` |
| 3 | `test_validate_only_forwards_the_per_row_breakdown` | `_envelope_error` not yet threading `source_debug_context` | `KeyError: 'pandera_errors'` |
| 4 | `test_sync_pipeline_rejection_also_forwards_the_breakdown` | same | `KeyError: 'pandera_errors'` |
| 5 | `NO-ECHO: an untrusted cell value smuggled onto a row never reaches the DOM` | rendered `{(e as unknown as { failure_case?: string }).failure_case}` in the `<li>` (working tree only) | `AssertionError: the raw failing cell was rendered — untrusted CSV content on screen and, through this envelope, in strategy_verifications metadata: expected '1 row failed validationRule violated:…' not to contain 'ZZ-PII-acct-4411-Jane-Doe'` |
| 6 | c14 `a manager resubmit onto a committed 'private' row does NOT claim a different track record` | pins written, route sentence not yet changed | `Expected: "This wizard session already committed a strategy that is not in the state this submission asked for, …"` / `Received: "This wizard session already created a strategy with a different track record, …"` |
| 7 | `seam-venue-vocabulary` scan-exclusion pin | none needed — it reddened on its own against my change | `expected { sites: 59, codes: [ COLUMN_IN_DATAFRAME, … ] } to deeply equal { sites: 57, codes: […] }` |

**Restoration verified byte-identical** for #5: `git diff` on
`CsvValidationEnvelope.tsx` is EMPTY after restore, and the suite returned to 13 passed.
For #1–#4 and #6 the RED was observed against the *pre-fix* tree (RED-first TDD), which is the
same evidence as a neuter and does not require a restore step.

**Counterparts, so no pin is satisfiable by deletion:**
- `test_a_real_column_still_gets_its_column_clause` — omitting the clause for EVERY error would
  red this.
- `each row renders its rule, its row index and its message` — pairs with the zero-row absence.
- the NO-ECHO case asserts the row's own message DOES render.
- the c14 ANTI-CONTROL asserts the default sentence survives byte-identical on its own arm.
- `test_no_violations_means_the_key_is_absent_not_an_empty_list` — pairs with the forwarding
  cases, so "always forward" is not a passing strategy.

---

## How the nan-guard and no-echo pins are written

**nan-guard (`csv_validator.py`).** `column_raw = row.get("column")`;
`has_column = column_raw is not None and not pd.isna(column_raw)`;
`column_name = str(column_raw).strip() if has_column else ""`; the message branches on
`column_name` being truthy. Three properties, each deliberate:
- `pd.isna` catches float NaN, `None`, `pd.NA` and `NaT` — the mechanism, rather than the
  symptom.
- **No string match on `"nan"`.** A CSV may have a column literally named `nan`, and for that
  file `Column 'nan' failed rule …` is CORRECT copy. Matching the string would suppress a true
  sentence to fix a false one.
- `.strip()` + truthiness folds a whitespace-only column name into the absent branch, so an
  empty clause cannot render either.

**no-echo (three layers, each independently falsifiable).**
1. **Producer** — `csv_validator.py` never reads `failure_case`; the two discipline comments
   are byte-identical after this edit, pinned by
   `test_no_produced_error_carries_the_raw_failing_cell` (`set(err.keys()) == {"rule","row","message"}`)
   and `test_the_failing_cell_value_is_not_echoed_into_the_message` (a distinctive marker
   value driven through a real `currency_usd_or_blank` violation).
2. **Forwarder** — `_forwarded_pandera_rows` is a PROJECTION, not a passthrough. It names the
   three keys rather than copying the dict, so a fourth key added by any future producer is
   dropped by construction. Pinned by
   `test_forwarded_rows_carry_no_key_beyond_rule_row_message`, whose fixture smuggles BOTH a
   row-level `failure_case` AND a sibling `debug_context["raw_sample"]`, and which asserts the
   marker is absent from the whole `r.text`, not just from the rows.
3. **DOM** — the component test's `renderWire` helper takes `unknown` and casts at the
   boundary, so the fixture can carry a key the typed wire shape forbids. The assertion is on
   `screen.getByTestId("wizard-csv-error").textContent` — a DOM-level pin, so it would fail if
   the value appeared anywhere in the panel, in any slot.

---

## Deviations from Plan

### 1. [Plan-authorised] The A2 sentence was adjusted against the docblock
Fully documented above. The plan authorised adjustment ("adjusted ONLY if the docblock
contradicts it — state any adjustment + why"), and the docblock does contradict it, on both
halves. Shipping the proposed sentence would have been a new false sentence.

### 2. [Rule 2 — completeness] `val.debug_context` threaded at three arms, not one
**Found during:** Task 1. The plan named `_envelope_error` generally; the measured reality is
that a CSV rejection can leave by three different arms, and the 424 venue-transient pre-gate is
the one a CSV rule code actually selects (`COLUMN_IN_DATAFRAME` is not in
`PERMANENT_VALIDATION_ERROR_CODES`). A single-site fix would have shipped an empty panel on the
most likely arm. Pinned by `test_sync_pipeline_rejection_also_forwards_the_breakdown`.

### 3. [Plan correction] The existing WIZERR-12 fixtures did not need re-pointing — they needed a sibling
**Found during:** Task 3. The plan's action assumed the verbatim fixtures pin the A2 arm and
would go stale ("with the route sentence changed but fixtures not yet re-pointed, run the two
suites and observe the RED"). **Measured: they do not.** `ROUTE_SESSION_REUSED`
(`upstream-arm.test.tsx:148`) and the c14 `human_message` assertion (`:380`) both pin the
DEFAULT sentence on the NAME-mismatch arm, which this plan holds byte-identical. Changing the
route alone would have produced NO red — a silent pass, and the plan's falsifiability evidence
would not have existed.

So the A2 arm had **no copy pin at all**. I wrote the pins first with the new expected
sentence, ran them against the unchanged route, and observed the RED (#6 above) — the standard
TDD RED, and stronger evidence than the plan's version, since it also proves the arm was
previously unpinned. The existing default-sentence pins were left byte-identical and are now
joined by an explicit ANTI-CONTROL.

### 4. [Rule 3 — blocking] `seam-venue-vocabulary.invariant.test.ts` scan-exclusion pin, 57 → 59
**Found during:** the wave-level full-suite run. Task 1's fixtures added two `error_code`
literals under `analytics-service/tests/`, and the `tests` scan-exclusion pin reddened —
working exactly as designed. Its own failure message forbids bumping it without argument, so
the argument is written into the file (commit `251ddcc7`): the exclusion guards "does the tests
subtree contain an emitter a USER can reach", and a test file emits nothing to anyone.

⚠️ Worth reading rather than skimming: unlike the three fictions the exclusion's reason names,
`COLUMN_IN_DATAFRAME` **is a real wire code** — `csv_adapter.py` sets
`error_code=first_rule.upper()`, so every pandera rule name is one. What the finding exposes is
a pre-existing hole (a computed code is invisible to a literal scan, so the whole family has no
TypeScript disposition), which is `wizardErrors.ts`'s own third measured reason on
`CSV_VALIDATION_FAILED`. Booked in `deferred-items.md`, not absorbed.

### 5. [Plan verification adjusted] `mypy --strict .` → the CI invocation
The plan's verify says `python3 -m mypy --strict .`. Per 161-02-SUMMARY note #5 (re-confirmed
this session), that reports ~6000 pre-existing errors across `tests/` and is not a regression
signal. Used CI's scoped invocation instead:
`mypy --strict --follow-imports=silent services/ routers/ models/` → **Success: no issues found
in 91 source files.**

### 6. [Declined — out of scope] Three findings booked, not fixed
See `deferred-items.md`: the `first_rule.upper()` vocabulary hole (D-161-01);
`formatColumnInDataframeMessage`'s regex matching a message shape this producer has never
emitted, making it a dead branch (D-161-02); and the column-less sentence still rendering "at
row 0" for a failure that has no row (D-161-03).

**D-161-03 deserves the phase owner's eye.** It is the same defect class this phase kills — a
fabricated number in user copy — but `161-UI-SPEC § Copy Spec WIZERR-13` states that exact
sentence, and the UI-SPEC is the binding copy contract. Improvising against an approved
contract is precisely the failure mode this phase's discipline exists to prevent, so I surfaced
it rather than silently "improving" it. Same shape as 161-02's arm-3 call.

**Total deviations:** 6 — 1 plan-authorised, 1 completeness (Rule 2), 1 plan correction with
stronger evidence, 1 auto-fixed blocking law (Rule 3), 1 verification-invocation adjustment,
1 declined as out of scope.

---

## Verification

| Gate | Result |
|------|--------|
| `cd analytics-service && python3 -m pytest tests/ -k "csv_validator or process_key" -x -q` | **195 passed, 3 skipped** |
| `python3 -m mypy --strict --follow-imports=silent services/ routers/ models/` (CI scope) | **Success: no issues found in 91 source files** |
| `npx vitest run '…/CsvValidationEnvelope.test.tsx'` | **13 passed** |
| `npx vitest run src/__tests__/csv-finalize-c14-regression.test.ts '…/CsvSubmitStep.upstream-arm.test.tsx'` | **56 passed** |
| `npm run test` (full suite — required, contract tests scan all of `src/`) | **788 files, 12119 passed, 281 skipped, 0 failed** |
| `cd analytics-service && python3 -m pytest` (full) | **5238 passed, 89 skipped** |
| `npx tsc --noEmit` | clean |
| `npx eslint src/` | 0 errors, 2 pre-existing warnings (`StrategyForm`, untouched) |

The 281 TS skips and 89 Python skips are pre-existing and unchanged (161-02-SUMMARY records the
same 89). No test was skipped, `xfail`-ed or left unrun by this plan.

**CI-gate wording (ledger rule):** branch protection is off until there are paying clients, so
every CI gate is advisory at merge. The `frontend` aggregator **would have** caught the
scan-exclusion pin regression; it did not stop anything, because nothing was merged.

## Known Stubs

None. No hardcoded empty values, placeholder text, TODO/FIXME, or unwired data sources were
introduced. Every `<verify>` in the plan was run.

## Threat Flags

None — no new security-relevant surface. The plan's register is honoured, and one property is
stronger than the register asked for:

- **T-161-07 (Tampering / Information Disclosure, `mitigate`)** — `{rule,row,message}` only, at
  three layers (producer, forwarder, DOM), each with its own falsifiable pin. The forwarder is
  the addition: because it NAMES the keys rather than copying the dict, the producer's no-echo
  discipline is no longer a promise held in another file — a fourth key added upstream is
  dropped by construction.
- **T-161-08 (Information Disclosure at `_envelope_error`, `mitigate`)** — the forwarded rows
  are server-built templated sentences over rule names and indices; no raw cell exists in the
  shape by construction. `_forwarded_pandera_rows` is additionally defensive about every
  reading (non-dict debug context, non-list `violations`, non-dict member, non-int row) so a
  malformed upstream payload degrades to an empty list rather than turning a 403 verdict into a
  500.
- **T-161-09 (Repudiation — A2 sentence describes the wrong flow, `mitigate`)** — the sentence
  was validated against the docblock AND against the code, and the docblock's own case turned
  out to be narrower than the arm's reachable set. The shipped sentence claims neither. Default
  retained for its true case, pinned by an anti-control.

## Notes for the next executor

1. **⚠️ The A2 arm is reachable outside the manager-vs-contribution collision.**
   `existingRow.status` is read live and `admin/strategy-review` moves `pending_review` →
   `published`, so a same-flow resubmit onto a reviewed row lands there too. Any future copy on
   this arm must survive that case. This is not in the docblock; it was measured this session.
2. **`refuse()`'s default sentence now has an ANTI-CONTROL** (c14). If you give a third arm its
   own `humanMessage`, add a pin for it — the code carries four sentences now and the client
   arms key on the CODE, so a lost sentence is invisible to the render suites.
3. **`COLUMN_IN_DATAFRAME` is a real wire code, not a test fiction** — `first_rule.upper()`.
   Adding another `error_code` literal under `analytics-service/tests/` will move the
   `seam-venue-vocabulary` scan-exclusion pin again; the law wants the delta ARGUED, and there
   are now three dated precedents in that file showing the format.
4. **The upstream-arm fixtures are on BOTH sides of their arm** (mocked wire AND expected DOM),
   so editing a word changes both and the suite stays green. That file's docblock says so.
   Route↔fixture correspondence is enforced by hand — but the c14 file now asserts the default
   sentence `toBe` against the live route, which IS a real coupling for that one string. If you
   want the same protection for the A2 sentence, c14's A2 case already gives it.
5. **`pd.isna` on a pandera `failure_cases` cell is safe** (they are scalars). Do not
   generalise the helper to array-valued columns without re-checking — `pd.isna` on a list
   returns an array and the `not` would raise.
6. **`_forwarded_pandera_rows` is where a fourth wire field would go** if D-161-02 is ever
   closed (carrying the expected column name as a first-class field). Adding it means moving
   the `set(...) == {"rule","row","message"}` assertions in three files, deliberately. That
   friction is the point.

## Self-Check: PASSED

- `analytics-service/services/csv_validator.py` — FOUND, contains the `pd.isna` column guard
- `analytics-service/routers/process_key.py` — FOUND, contains `_forwarded_pandera_rows` and
  `source_debug_context` at three call sites
- `src/app/api/strategies/csv-finalize/route.ts` — FOUND, contains the A2 `humanMessage`
- `.planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md` — FOUND
- Commit `a371de7d` — FOUND
- Commit `2916bbe0` — FOUND
- Commit `c31ff18c` — FOUND
- Commit `251ddcc7` — FOUND
