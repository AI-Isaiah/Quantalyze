---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 01
subsystem: testing
tags: [mt5, parity, python, pytest, mypy-strict, fixtures, sha256-seal]

requires:
  - phase: 175-mt5offset
    provides: "services.mt5_server_clock, services.mt5_deals: the broker clock and deal fold the ledger integrity test folds through"
provides:
  - "services/mt5_parity.py: MT5_PARITY_TOLERANCE (0.01, D-B), MT5_INCEPTION_IDENTITY_BAND, the closed 8-bucket taxonomy, ordered EXPLAINERS registry, Gate B legs, typed Verdict, render_verdict_markdown"
  - "services/mt5_parity_intake.py: PROVENANCE_VALUES, ProvenanceRefused, WorksheetRefused, require_provenance, load_worksheet"
  - "services/mt5_parity_capture.py: CAPTURE_FILES (10 slices), seal_capture / load_capture / load_bundle, our-side adapters, render_per_ordinal"
  - "the ONE synthetic account (ledger_synthetic.json), its capture bundle and capture-contract.json"
affects: [155-02, 155-03, 155-04, 155-05, 155-06, 155-07, 155-08, 155-09, 155-10, 155-11]

actuals:
  tokens: 22465
  tasks: 2
  commits: 3
plan_head_before: 3f5797601e612849e452a044ef1e8e918021726b
plan_head_after: 98fa3325f573e312b652959017c7493e1bb241f8

tech-stack:
  added: []
  patterns:
    - "Fail-closed taxonomy via an ordered explainer registry; unexplained only after every explainer ran (parity_diff.py shape)"
    - "Redaction by type: Verdict has no amount or id field, the renderer writes fixed words and 3-s.f. ratios"
    - "Canonical JSON (allow_nan=False) + per-file sha256 sidecar + manifest, verified before any parse"
    - "One hand-written ledger; every other fixture is a rendering pinned to it, to the baseline DDL and to the contract file"

key-files:
  created:
    - analytics-service/services/mt5_parity.py
    - analytics-service/services/mt5_parity_intake.py
    - analytics-service/services/mt5_parity_capture.py
    - analytics-service/tests/test_mt5_parity_pipeline.py
    - analytics-service/tests/test_mt5_parity_capture.py
    - analytics-service/tests/fixtures/mt5_parity/capture_synthetic.json
    - analytics-service/tests/fixtures/mt5_parity/worksheet_synthetic.json
    - analytics-service/tests/fixtures/mt5_parity/ledger_synthetic.json
    - docs/runbooks/mt5-parity/capture-contract.json
  modified: []

key-decisions:
  - "Labels are sealed into manifest.json at seal time (labels.json must exist when seal_capture runs, and an ordinal with no label is refused); load_capture reads them from the manifest, so a label cannot be edited after sealing"
  - "An analytics row is 'non-archived' when its strategy_id is a non-archived id in the strategy slice or the key map row; zero or several such rows means not measurable"
  - "Only a Verdict is accepted by verdict_to_json / render_verdict_markdown; a mapping (which could carry extra keys) raises TypeError"
  - "AccountVerdict refuses a label that is not a plain account label or that carries a 5+ digit run (a login)"

requirements-completed: [PARITY-01, PARITY-02, PARITY-03]

coverage:
  - id: D1
    description: "A sealed synthetic capture plus a synthetic worksheet produce a rendered Gate B verdict for SYN-A end to end (GREEN, within_tolerance); one moved reading turns it RED/unexplained with the gap computed independently in the test"
    requirement: "PARITY-02"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_pipeline.py#test_green_pipeline_end_to_end"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_pipeline.py#test_one_moved_reading_turns_the_same_pipeline_red_and_unexplained"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_pipeline.py#test_registry_is_consulted_before_the_unexplained_fallback"
        status: pass
    human_judgment: false
  - id: D2
    description: "A worksheet reading with provenance gateway is refused by name before any comparison runs"
    requirement: "PARITY-01"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_pipeline.py#test_gateway_provenance_is_refused_by_name_before_any_comparison"
        status: pass
    human_judgment: false
  - id: D3
    description: "seal_capture refuses a moved bind witness, a row_count, first/last day or length witness that disagrees with the rows, a NaN, a symlink, an unlabelled ordinal; load_capture refuses a tampered sealed slice and loads again after a byte restore"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_capture.py#test_a_tampered_sealed_slice_is_refused_and_a_byte_restore_loads_again"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_capture.py#test_seal_refuses_a_moved_bind_witness"
        status: pass
    human_judgment: false
  - id: D4
    description: "The ledger, the capture bundle and capture-contract.json describe ONE account: the ledger folds through mt5_day_pnl to its literals and to the capture's pre-mark P&L, stored returns are recomputed from the ledger NAV table, the inception identity is 0, a one-hour shift moves exactly the 500.00 deal across a UTC midnight, whole_row slices carry exactly the baseline DDL columns"
    requirement: "PARITY-02"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_capture.py"
        status: pass
    human_judgment: false
  - id: D5
    description: "No raw PROD figure, login, server, label text, PROD UUID or home path in any committed fixture (invented values and all-zero-pattern UUIDs only)"
    requirement: "PARITY-03"
    verification: []
    human_judgment: true
    rationale: "The repo-owned redaction scan is a later plan; this plan's prohibition is verified by judgment plus a grep (no non-zero-pattern UUID, no home path) recorded below"

duration: 52min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 01: Tracer slice and the one synthetic account Summary

**A sealed synthetic capture and a provenance-checked worksheet go end to end to a Gate B verdict that is GREEN on the committed fixtures, RED/unexplained on one moved reading, edge_instant_mismatch only through the explainer registry, and refused by name on a gateway provenance; the single hand-written ledger fixes the account every later plan renders.**

## Performance

- **Duration:** about 52 min
- **Completed:** 2026-11-13T20:00Z
- **Tasks:** 2 (tracer, then tdd)
- **Files:** 9 created, 0 modified (2223 lines)

## Accomplishments

- Tracer: `load_bundle` -> `seal_capture` -> `load_capture` -> `load_worksheet` -> `evaluate_account` -> `render_verdict_markdown` on SYN-A, Gate B window 2026-11-06..2026-11-13. GREEN gaps are about 1e-13 against `MT5_PARITY_TOLERANCE`; moving the oracle end equity by 250 on 11900 gives a reported gap equal to 250/11900 to 1e-12 on both `end_level` and `cum_return`, and `start_level` still passes.
- `classify_breach` loops over every registered explainer and returns `unexplained` only after the loop; test (e) proves the registry is consulted (a mark taken after the weekend interval gives `edge_instant_mismatch` with the same breach).
- The synthetic account is one hand-written ledger designed backward from the three PARITY-02 mutations. Deal 1007 sits at server wall 02:30 in the eu/us divergence week, so a shift moves exactly the 500.00 deal from 2026-10-26 to 2026-10-27; deal 1004 is the mid-window deposit; deal 1001 (the oldest) moves only the inception identity.
- `capture-contract.json` is pinned equal to `CAPTURE_FILES` for plans 03, 04 and 09; whole_row slices are pinned to the real `CREATE TABLE` blocks in `supabase/schema/baseline.sql` by regex, so the fixture cannot drift from the schema.

## Task Commits

1. **Task 1: tracer (capture, intake, engine, verdict, 6 pipeline tests)** - `003f999f7` (feat)
2. **Task 2 RED: failing tests for the account, contract and seal refusals** - `523ab2a85` (test)
3. **Task 2 GREEN: ledger, full capture bundle, contract, render_per_ordinal** - `98fa3325f` (feat)

## Verification

- `cd analytics-service && python3 -m pytest tests/test_mt5_parity_capture.py tests/test_mt5_parity_pipeline.py -q -p no:cacheprovider` -> **23 passed** (17 capture, 6 pipeline; plan floor 14).
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/mt5_parity.py services/mt5_parity_intake.py services/mt5_parity_capture.py` -> `Success: no issues found in 3 source files` (local mypy 2.0.0, CI pins 2.4.0; Python 3.14 locally, CI 3.12: the CI run is the verdict).
- `node scripts/verify-plan-anchors.mjs` on the plan -> OK, 12 claims.
- `grep -c MT5_PARITY_TOLERANCE services/mt5_parity.py` -> 4; the literal `0.01` appears once in `services/mt5_parity*.py` (its definition).
- No import of `mt5_client`, `mt5_read`, `mt5_soak`, `services.db` or `supabase` in the three modules (grep).
- Redaction grep over the fixtures, the contract and the modules: no UUID outside the `00000000-0000-4000-8000-` pattern, no `\/Users\/` path.

## Neuter, RED, restore, GREEN (data-integrity gates able to fail)

Each neuter was applied to the real fixture with a byte backup in scratch plus a sha256; each restore was checked by sha256 equality before the GREEN re-run (final run: 23 passed).

| Neuter | Result |
|---|---|
| ledger deal 1007 wall time 02:30 -> 12:30 (no longer straddles midnight) | RED: ledger fold, one-hour-shift and Balance-column tests fail (3 failed) |
| capture composed P&L for one day moved by 1.00 | RED: pre-mark P&L comparison and inception identity fail (2 failed) |
| contract `day_column` of marks -> null | RED: contract-equals-CAPTURE_FILES fails |
| analytics row column renamed | RED: whole-row-columns-equal-DDL fails |
| sealed `marks.json` one byte flipped (in-test) | RED: `CaptureRefused` naming marks; byte restore loads again |
| pipeline: one worksheet reading moved / mark moved / provenance gateway | RED/unexplained, edge_instant_mismatch, ProvenanceRefused (permanent tests) |

## TDD record (Task 2)

- **RED (`523ab2a85`):** 8 failed, 9 passed. The 8 failures are `FileNotFoundError` / `KeyError` / `ImportError` on the artefacts that did not exist yet (ledger, contract, the full bundle, `render_per_ordinal`). Semantic assessment, stated plainly: under the strict RED taxonomy this is fixture/load failure, not an assertion failure, because the artefacts under test are data files and one function; the behaviour assertions (fold equals literals, identity zero, shift moves 500.00) could only fail on assertions once the data existed. The neuter table above is the substitute proof that those assertions can fail. The 9 passing tests exercise the seal refusals, which Task 1 had already implemented.
- **GREEN (`98fa3325f`):** 23 passed.

## Decisions Made

See `key-decisions` above. Assumptions from the plan stand: A8 (the base clock is the `us` rule), flow-free Gate B windows with a money gap and a curve gap, weekend interval Friday 22:00 UTC to Sunday 21:00 UTC.

## Deviations from Plan

**1. [Rule 1 - Bug] Holdings fixture row uses `holding_type: "spot"`, not `balance`**
- **Found during:** Task 2
- **Issue:** the plan names `balance`; `allocator_holdings_holding_type_check` allows only `spot` and `derivative`, so a `balance` row could never exist in the table the contract describes.
- **Fix:** `spot`. Side `long`, symbol `USD`, value and quantity as planned. holdings is a `columns`-shape slice, so no test depends on it.
- **Files modified:** `analytics-service/tests/fixtures/mt5_parity/capture_synthetic.json`

**2. [Rule 1 - Bug] The holdings column-contract test compares column sets, not order**
- **Found during:** Task 2
- **Issue:** the plan's holdings column list puts `quantity_unit` before `created_at`; the DDL has it last. An order-sensitive assertion failed on a difference that carries no meaning.
- **Fix:** compare sorted lists.
- **Files modified:** `analytics-service/tests/test_mt5_parity_capture.py`

**3. [Rule 2 - Missing critical] Extra seal and loader refusals beyond the plan's list**
- **What:** `seal_capture` also refuses an ordinal with no label, a duplicate ordinal inside one file, a `columns`-shape row whose keys are not the contract columns, a per-ordinal fallback that is not exactly one row for its own ordinal; `load_bundle` refuses a bundle that is not `synthetic: true` (so a real capture can never arrive through the fixture format) and a raw file name that is not a plain name; `render_per_ordinal` refuses a statement holding an interior semicolon; `AccountVerdict` refuses a label that is not a plain account label or carries a 5+ digit run.
- **Why:** each closes a way a truncation, a mislabelled account or a login-shaped label could pass silently. All are covered by tests or by the contract the SQL plans build to.

**Total deviations:** 3 (2 Rule 1, 1 Rule 2). **Impact:** none on the plan's interfaces; every name in the interfaces block exists with the stated signature.

## Notes for later plans

- `Verdict` carries `run_day: date` as the interface block specifies, so "no field that can hold a date" holds for `AccountVerdict` and for the rendered markdown (which never prints it), not for `Verdict` itself. `verdict_to_json` emits it as an ISO day.
- `bind-before.json` / `bind-after.json` rows are free-form in this plan (any equal lists seal); the fixture uses `key_ordinal`, `analytics_computed_at`, `marks_count`, `marks_max_created_at`. Plan 03's `bind.sql` should emit witnesses of that shape.
- The sealed manifest holds the labels, so plan 10 must write `labels.json` BEFORE running `seal_capture`.
- Census files (`census-accounts`, `census-edges`) are sealed in canonical JSON form, content-verbatim, without a witness check.
- Gate A is not evaluated here: `evaluate_account` raises on a gate other than B (via `gate_b_legs`); plan 06 adds it.

## Known Stubs

None. The fixtures contain deliberately empty slices for `series`, `equity_curve` and `btc` (a USD account needs none); these are real zero-row witnesses, not placeholders.

## Threat Flags

None. No new network endpoint, auth path or schema; the modules read files only.

## Self-Check: PASSED

- Created files: all 9 present on disk (checked below with `[ -f ]`).
- Commits: `003f999f7`, `523ab2a85`, `98fa3325f` are ancestors of HEAD.
- `commits: 3` is measured (`git rev-list --count 3f5797601e612849e452a044ef1e8e918021726b..HEAD`).
