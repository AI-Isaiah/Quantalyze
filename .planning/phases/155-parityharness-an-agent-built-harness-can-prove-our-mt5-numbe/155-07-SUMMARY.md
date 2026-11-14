---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 07
subsystem: testing
tags: [mt5, parity, python, pytest, mypy-strict, red-proofs, rehearsal-flag, import-purity]

requires:
  - phase: 155-parityharness (plan 01)
    provides: "Verdict, AccountVerdict, ratio_3sf, seal_bytes, load_bundle / seal_capture / load_capture, the synthetic ledger, capture bundle and worksheet"
  - phase: 155-parityharness (plan 05)
    provides: "parse_report, oracle_deals_bytes, load_oracle_deals, load_required_readings, require_complete, bind_report"
  - phase: 155-parityharness (plan 06)
    provides: "evaluate_account, propose_windows, validate_window, the bucket constants and the explainer registry"
  - phase: 155-parityharness (plan 08)
    provides: "mt5_parity_findings (in the purity glob) and the records CLI whose scanner checked this plan's renderings"
provides:
  - "services/mt5_parity_proofs.py: Mutation, MUTATIONS, EXPECTED_OUTCOME, MutationVacuous, OracleCopyRefused, apply_mutation, RedProofRecord, run_red_proof, render_red_proof_markdown, meets_expectation, restore_intact"
  - "services/mt5_parity.py additions: Verdict.final_green, AccountVerdict.oracle_label, OracleBindingRefused, evaluate_windows, REHEARSAL_HEADER, verdict_to_json keys final_green and oracle_label"
  - "scripts/mt5_parity_run.py: the verdict and red-proof CLI that plan 11 runs against the real capture"
  - "tests/test_mt5_parity_purity.py: transitive import purity and the single-constant pin"
affects: [155-10, 155-11]

actuals:
  tokens: 18900
  tasks: 3
  commits: 4
plan_head_before: 3e73f4d9585667ad8f95a401a00d7ae83bc60b44
plan_head_after: e1dc46fb342b5986e7311ca5cc71dd295d410eb5

tech-stack:
  added: []
  patterns:
    - "A RED proof mutates a byte COPY outside tests/fixtures, re-reads its own output to prove only the intended field moved, restores from the byte backup in a finally, and compares the restored verdict byte for byte with the baseline"
    - "The rehearsal flag is a property of the Verdict (final_green), not of the renderer: a synthetic worksheet can never yield a pass, and a verdict that judged nothing is not a pass either"
    - "Import purity is a closure property: ast.walk over services/mt5_parity*.py, resolving 'from services import x' as a module, with the scanner shown able to fail on a fake tree"

key-files:
  created:
    - analytics-service/services/mt5_parity_proofs.py
    - analytics-service/scripts/mt5_parity_run.py
    - analytics-service/tests/test_mt5_parity_red_proofs.py
    - analytics-service/tests/test_mt5_parity_cli.py
    - analytics-service/tests/test_mt5_parity_purity.py
  modified:
    - analytics-service/services/mt5_parity.py

key-decisions:
  - "The proof reads the label's Gate A verdict (the deal-ledger gate every mutation acts on), else its first verdict; baseline, mutated and restored pass flags are over ALL the label's verdicts"
  - "Windows are fixed once from the unmutated deals and reused for every mutated run, so a proof can never change its own window"
  - "A verdict that judged no account is never final_green (all() of nothing is True), and the CLI says so on stderr and exits 0"
  - "A refused window stays a RED verdict (evaluate_account's own window_refused:<reason>); the CLI does not pre-call validate_window, which would turn it into exit 2"

requirements-completed: [PARITY-02, PARITY-01]

coverage:
  - id: D1
    description: "Each of the three deliberately broken inputs flips the synthetic verdict GREEN to RED with its named bucket and leg (flow_placement/cum_return, clock_mismatch/day_placement, unexplained/inception_identity); the byte-backup restore gives the original sha256 and a GREEN, byte-identical verdict"
    requirement: PARITY-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_red_proofs.py#test_red_proof_flips_green_to_red_with_the_named_bucket_and_back"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each mutation is applied to a byte copy outside the fixtures, a vacuity guard proves the intended field only moved, and no committed fixture changes"
    requirement: PARITY-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_red_proofs.py#test_reclassify_changes_exactly_one_deals_type_the_earliest_balance_but_the_first"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_red_proofs.py#test_red_proof_refuses_a_copy_inside_the_committed_fixtures"
        status: pass
    human_judgment: false
  - id: D3
    description: "A synthetic-oracle verdict is flagged rehearsal, renders the DRESS REHEARSAL line first and is never final_green; a real worksheet cannot be bound to a different account label, a synthetic one can and the binding is recorded"
    requirement: PARITY-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_cli.py#test_final_green_is_false_for_a_rehearsal_whatever_the_legs_say"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_cli.py#test_cli_refuses_a_cross_label_binding_on_a_real_worksheet"
        status: pass
    human_judgment: false
  - id: D4
    description: "The verdict and red-proof CLI runs against a sealed capture or a synthetic bundle with exit 0 (run), 2 (input refusal) and 3 (a RED proof missed its expectation)"
    requirement: PARITY-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_cli.py#test_cli_red_proof_exits_three_when_the_expectation_is_wrong"
        status: pass
    human_judgment: false
  - id: D5
    description: "services/mt5_parity*.py reach no database, gateway or network through any import chain (function-level imports included), and the tolerance literal appears once"
    requirement: PARITY-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_purity.py#test_the_engine_closure_reaches_no_database_gateway_or_network"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_parity_purity.py#test_the_tolerance_literal_appears_once_and_it_is_the_constant_definition"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 07: RED Proofs, Rehearsal Flag and the Verdict CLI Summary

**Three byte-backup RED proofs (reclassified BALANCE deal, one-hour clock shift, dropped oldest deal) that each flip the synthetic verdict to a named bucket and leg and back byte-identical, a rehearsal flag that makes a synthetic oracle structurally unable to be `final_green`, the `verdict` / `red-proof` CLI, and a transitive import-purity pin.**

## Performance

- **Duration:** about 35 min. The start time was not captured, so this is estimated from the predecessor plan's last commit (`3e73f4d95`, 23:22 local) to the last task commit.
- **Completed:** 2026-11-13
- **Tasks:** 3 (plus one follow-up commit tightening a test)
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- On the synthetic pair, each mutation moves exactly what it should (measured on the committed fixtures):
  - `reclassify_balance` gives `flow_placement`, with `cum_return` and `day_placement` breaching at 0.2.
  - `clock_shift_1h` gives `clock_mismatch`, with `day_placement` breaching at 0.05.
  - `drop_oldest_deal` gives `unexplained`, with `inception_identity` at 5 and the four other legs unchanged (RESEARCH Pitfall 1).
  
  Gate B stays GREEN throughout. After the byte restore the sha256 equals the original and the canonical verdict JSON is byte-identical to the baseline.
- `apply_mutation` re-reads its own output through `load_oracle_deals` and raises `MutationVacuous` unless exactly the intended field moved. `run_red_proof` refuses a copy inside `tests/fixtures`, restores in a `finally`, and records sha equality and byte-identity as fields.
- `Verdict.final_green` is `(not rehearsal) and bool(accounts) and all passed`. A rehearsal renders `DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.` as its first line.
- `evaluate_windows` binds an account to another account's oracle label only on a synthetic worksheet (`OracleBindingRefused` otherwise) and records `oracle_label` on every account verdict.
- `scripts/mt5_parity_run.py` runs `verdict` and `red-proof` against a sealed capture or a synthetic bundle. Its two renderings on the synthetic pair were scanned with plan 08's record-profile scanner: exit 0, no hit.
- The purity test follows the real import closure of `services/mt5_parity*.py`: 21 internal modules, externals limited to stdlib, pandas and numpy. It reaches `mt5_deals`, `mt5_server_clock`, `broker_dailies`, `wealth_returns` and `parity_diff`, and reaches no forbidden module.

## Task Commits

1. **Task 1: the three RED proofs with byte-backup restore** - `07623fb14` (feat)
2. **Task 2: rehearsal flag, oracle binding and the verdict / red-proof CLI** - `a29be5f4f` (feat)
3. **Task 3: transitive import purity and the single-constant pin** - `b393e44a1` (test)
4. **Follow-up: count mantissa digits so the 3-s.f. assertion can fail** - `e1dc46fb3` (test)

**Plan metadata:** the SUMMARY commit follows this one, then the STATE and ROADMAP commit.

_TDD note: tests and implementation landed in one commit per task. The RED evidence is the neuter runs below, not a separate test-only commit._

## Files Created/Modified

- `analytics-service/services/mt5_parity_proofs.py` - mutations, vacuity guard, `run_red_proof`, the typed record and its renderer
- `analytics-service/services/mt5_parity.py` - `final_green`, `oracle_label`, `OracleBindingRefused`, `evaluate_windows`, the rehearsal header, two new JSON keys
- `analytics-service/scripts/mt5_parity_run.py` - thin argparse CLI; all logic stays in `services/`
- `analytics-service/tests/test_mt5_parity_red_proofs.py` - 21 tests: the three proofs, vacuity, restore, fixtures guard
- `analytics-service/tests/test_mt5_parity_cli.py` - 28 tests: rehearsal flag, binding, every refusal, exits 0, 2 and 3
- `analytics-service/tests/test_mt5_parity_purity.py` - 12 tests: closure, anti-vacuity, scanner and counter able to fail

## Gates shown able to fail (neuter, RED, restore from a byte backup, GREEN)

Every restore was from a `cp` backup in the scratchpad, checked by sha256. No git checkout, restore or stash was used.

| Neuter | Result |
|---|---|
| clock shift moves 7200 s instead of 3600 | 5 failed, including the vacuity guard |
| reclassify targets the oldest balance deal too | 4 failed; the mutated verdict stays GREEN (the vacuous proof RESEARCH Pitfall 3 warns of) |
| `apply_mutation` replaced by the identity | `MutationVacuous`, file untouched |
| fixtures-directory refusal removed | the refusal test fails; the committed fixture's sha256 was unchanged |
| byte-backup restore removed | 8 failed (`restored_sha_equal` False) |
| `final_green` ignores `rehearsal` | 5 failed |
| `final_green` accepts an empty verdict | the mixed/empty test fails |
| cross-label binding allowed on a real worksheet | the service test fails |
| rehearsal header removed | 2 failed |
| function-level `import services.db` added to the report module | the closure test fails |
| function-level `import socket` added to the intake module | the closure test fails |
| `from services import nav_marks` added to the capture module | the closure test fails |
| a second tolerance literal added to the proofs module | the single-constant test fails |

After every neuter the file's sha256 equalled the original and the suite was green again.

## Decisions Made

See `key-decisions`. The plan's recorded assumption stands: on rehearsal inputs (a real capture against a synthetic oracle) the baseline is RED by design, so `red-proof --capture-dir` fails only on a restore that is not intact. Plan 11 records the GREEN to RED to GREEN proof through `--capture-bundle` on the synthetic pair, and on each real account the named leg moving plus a byte-identical restored verdict.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] A verdict that judged no account must not be `final_green`**
- **Found during:** Task 2 design. The plan defines `final_green = (not rehearsal) and every account passed`; `all()` of an empty tuple is True, so a non-rehearsal run in which the picker proposed no window would have read as a parity pass.
- **Fix:** `final_green` also requires at least one account. The CLI prints `no window was given or proposed: the verdict judges no account` to stderr and exits 0.
- **Files modified:** `analytics-service/services/mt5_parity.py`, tested in `test_mt5_parity_cli.py`
- **Commit:** `a29be5f4f`

**2. [Rule 3 - Blocking] A shared builder was needed by both the CLI and the tests: `evaluate_windows`**
- **Issue:** the interfaces block lists no function that turns an account, a worksheet and windows into a `Verdict`, and applies the oracle-label binding. The CLI would have carried that logic, against the plan's rule that scripts hold none.
- **Fix:** `evaluate_windows` in `services/mt5_parity.py` (inside the plan's `files_modified`). It builds a one-account worksheet view for a rebinding, calls `evaluate_account` per window, and records `oracle_label`.
- **Commit:** `a29be5f4f`

**3. [Rule 2 - Missing critical functionality] Vacuity and refusal cases beyond the plan's list**
- `apply_mutation` also fails if the mutated bytes equal the input, and `run_red_proof` also fails if the sha256 did not change; an empty deal list raises `MutationVacuous`; `OracleCopyRefused` covers a path that is not a file; a record refuses a login-shaped label; a mutated run that raises still restores the bytes (a `finally`).
- **Commit:** `07623fb14`

**4. [Process] The 3-s.f. test could not fail for the reason its name gave**
- Found in review: the first version allowed 8 digits. It now counts mantissa digits and allows 3, which is what `ratio_3sf` guarantees.
- **Commit:** `e1dc46fb3`

**5. [Process] The CLI does not call `validate_window` itself**
- The plan's key link names it on the `verdict` path. `evaluate_account` already validates every window and turns a refusal into a RED verdict naming the reason, which is what the "a refusal is a RED verdict, never a skipped account" rule asks for. A pre-call would turn a refusal into exit 2 and lose the verdict. A test covers it (`window_refused:window_not_closed`, exit 0).

**Total deviations:** 5 (2 Rule 2, 1 Rule 3, 2 process). **Impact:** none on the interfaces block; every name in it exists with the stated signature, plus the additions listed under Notes.

## Issues Encountered

None blocking. The anchor verifier was re-run on 155-07, 155-09, 155-10 and 155-11 after the `mt5_parity.py` edit: 17 claims, no stale anchor.

## Notes for later plans (155-10, 155-11)

- **Additions beyond the interfaces block:** `evaluate_windows`, `REHEARSAL_HEADER`, `OracleCopyRefused`, `restore_intact`, `meets_expectation`, and the CLI's `UsageRefused`.
- **Shape change that plans 10 and 11 consume:** `verdict_to_json` now carries a top-level `final_green` and a per-account `oracle_label` (null when the verdict was not built through `evaluate_windows`). The markdown prints `- oracle label: X` when it is set.
- **CLI inputs plan 11 supplies:** run from `analytics-service/` as `python3 -m scripts.mt5_parity_run`. `verdict` and `red-proof` take `--capture-dir` (sealed) XOR `--capture-bundle` (synthetic), `--worksheet`, `--report`, `--account`, `--run-day`, optional `--oracle-label`, `--clock-rule`, `--gate-a-*` and `--gate-b-*`; `--required-readings` defaults to the runbook list. `verdict` writes `--out-json` (canonical bytes) and `--out-md`; `red-proof` writes `--out-md`. The CLI derives no output path and `--out-*` are required.
- **`rehearsal` comes from the worksheet only.** A synthetic bundle paired with a non-synthetic worksheet is not flagged by the verdict. The CLI's `--capture-bundle` mode is the synthetic-pair mode for exit-3 purposes, so use `--capture-dir` for any real capture.
- **Duplicated rule:** the cross-label refusal is checked in both `evaluate_windows` and the CLI's `_prepare` (so the CLI fails before it binds or parses the Report). A neuter of the service check fails only the service test, because the CLI test passes on its own copy.
- **Windows are fixed before the proofs run.** With no `--gate-*` flags the picker proposes from the unmutated deals, and every mutated run reuses those windows. Gate A may not be proposed for a real account whose first mark precedes any trading day the picker can use; then only Gate B is judged, and the `drop_oldest_deal` proof records `named_leg_absent` in its note rather than a moved leg.
- **Hand-run reading for plan 11:** the clock-shift proof on a real account moves `day_placement` only if a deal falls within an hour of a UTC midnight inside the chosen window (RESEARCH Pitfall 2); otherwise the record says `named_leg_unchanged`, which is a true reading and not a harness fault.
- `docs/runbooks/mt5-parity/README.md` names the records CLI and not this one; it is outside this plan's `files_modified`, so plan 10 or 11 decides whether to document `mt5_parity_run`.
- The scratchpad renderings (`verdict` and `red-proof` on the synthetic pair) were scanned with `python3 -m scripts.mt5_parity_records scan --profile record`: exit 0.

## Known Stubs

None.

## Threat Flags

None. The new modules read the files they are given and write only `--out-*` paths and a temp copy outside the repo; no endpoint, auth path or schema. T-155-16 (synthetic oracle read as a pass) is mitigated by `final_green`, the header line and the binding refusal, each tested and each shown able to fail; T-155-17 (tampering in the proof) by the fixtures-directory refusal, the byte backup and the committed-fixture sha256 guard, each shown able to fail.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 155-10 and 155-11: the CLI, the records and the proofs are in place; the real-account runs and the hand-run record are plan 11's.
- No blocker. Open item for the orchestrator: whether the runbook README should name `mt5_parity_run`.

## Self-Check: PASSED

- Created files present on disk: `services/mt5_parity_proofs.py`, `scripts/mt5_parity_run.py`, `tests/test_mt5_parity_red_proofs.py`, `tests/test_mt5_parity_cli.py`, `tests/test_mt5_parity_purity.py`.
- Commits `07623fb14`, `a29be5f4f`, `b393e44a1` and `e1dc46fb3` are ancestors of HEAD.
- `commits: 4` is measured (`git rev-list --count 3e73f4d9585667ad8f95a401a00d7ae83bc60b44..HEAD` at SUMMARY write time), with `plan_head_before` and `plan_head_after` recorded above.
- Plan verification re-run: 263 passed across the ten MT5 parity test files, mypy strict `Success: no issues found in 138 source files` over the CI surface, ruff clean on the six touched files, `grep -c "phases/155"` on the CLI is 0, anchor verifier OK on 155-07, 155-09, 155-10 and 155-11.

---
*Phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe*
*Completed: 2026-11-13*
