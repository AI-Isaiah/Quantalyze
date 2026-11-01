---
phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
plan: 02
subsystem: analytics-service
tags: [probe, read-only, redaction, unmeasurable, eligibility, shares-account]

requires:
  - phase: 184-01
    provides: the read-only first-mark offset probe with the OKX reader, failure_token, Unmeasurable, the whitelist emitter, the fakes
provides:
  - every refusal that needs no venue is decided before decrypt_credentials (malformed mark, key_not_eligible, reader_not_built, window_outside_retention, window_too_recent)
  - failure_token maps a timeout and any venue error to a closed token and an exception class
  - eligibility is the backfill's own dispatch filter, so every key the backfill derives is read
  - shares_account from the selected key rows
  - read-only pins, a planted-needle redaction proof and emitter and main tests, each with a control proven able to fail
affects: [184-03, 184-04, 184-05]

actuals:
  tokens: 12700
  tasks: 2
  commits: 3
plan_head_before: cc919f97d22403ed1caa43356e682f98c4616c1b
plan_head_after: 811aa3ab72848b73e2ea567bb67c0ee4c0357e2d

tech-stack:
  added: []
  patterns:
    - "refusals that need no venue run before decrypt_credentials and each test asserts decrypt_calls == []"
    - "a safety pin ships with a control that fails: bare-fake write, leaky string, leaky emitter, planted write in the source"

key-files:
  created: []
  modified:
    - analytics-service/scripts/walletoffset_probe.py
    - analytics-service/tests/test_walletoffset_probe.py

key-decisions:
  - "Eligibility is eligible_key_predicate (the phase35 backfill's dispatch filter), not working_holder_predicate: the backfill derives a series for an error or sign_in_failed key, so that key's published numbers carry the offset and it must be read; error is also stamped for transient causes, so refusing on it would make a readable key unmeasurable. A key that cannot sign in prints read_failed with the venue's exception class."
  - "failure_token no longer re-raises: any exception that is not Unmeasurable, CallCeilingReached or a timeout becomes read_failed with classify_failure's class (the message is never read)."
  - "get_kek() stays lazy and outside the per-key mapping: a missing KEK is a run-level failure that main reports by type, not one key's read_failed."

requirements-completed: [SC-1, SC-3]

coverage:
  - id: D1
    description: "A key the probe cannot measure without a venue read names why before any credential is decrypted; every eligible key is read; a venue error prints its class only"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py -k 'unmeasurable or shares_account' (34 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The probe provably cannot write to the database or the venue, and a full run on planted needles leaks none"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py -k 'read_only or source or redaction or leaks or emit or main' (21 passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No published number changes: the phase's code diff still touches only the script, its test file and tests/_okx_bills.py; CI's mypy line is green"
    requirement: SC-3
    verification:
      - kind: other
        ref: "SCOPE_OK gate; CI mypy line; full analytics-service pytest 14183 passed"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-11-01
status: complete
---

# Phase 184 Plan 02: Unmeasurable keys, read-only and redaction proofs Summary

**The probe now refuses every marked key it cannot measure by name before any credential is decrypted, reads every key the backfill derives (an error or sign_in_failed key included) and fails a dead one by exception class only, with read-only pins and a planted-needle redaction proof each shown RED under a neutered control.**

## Performance

- **Duration:** about 45 min (approximate; the start instant was not recorded to the second)
- **Completed:** 2026-11-01
- **Tasks:** 2
- **Files modified:** 2 (the script and its test file)

## Accomplishments

- Refusals in `run()` order, all before `decrypt_credentials` and each asserting `decrypt_calls == []`: no mark, malformed mark (venue differs from the key's exchange, `marked_at` not an aware timestamp, mark day not the day before the read day), `key_not_eligible`, `reader_not_built`, `window_outside_retention` (B more than the venue's retention days before the run date; 90 days is inside, 91 is outside), `window_too_recent` (OKX read less than 24 h before the run; exactly 24 h is read).
- `failure_token` is complete: `Unmeasurable` keeps its reason, `CallCeilingReached` is `call_ceiling`, a `TimeoutError` (the `asyncio.wait_for` bound) is `("timeout", "Timeout")`, anything else is `("read_failed", classify_failure(exc))`. A `read_key_marks` failure goes through the same function and decrypts nothing.
- A failing key changes only its own record: a test with a failing first key shows the second key measured, and a revoked key added last leaves the other records byte-identical.
- The summary counts a refused marked key in `keys_unmeasurable` and a key with no mark nowhere; `run()` returns `EXIT_FAILED` whenever `keys_unmeasurable` is above 0; `shares_account` is true for a key carrying a share marker and for the key another selected key names as its holder.
- Read-only proof (SC-3): the allocator probe's wrapper, writer, forbidden-name and venue-write pins copied and pointed at this probe's source (plus a case-insensitive `private_?(post|put|delete)` for ccxt's camel-style names); one `.table(` literal (`api_keys`); every `supabase` parameter typed `ReadOnlySupabase`; the handle given to `read_key_marks` and to the price resolver is the wrapper; the fake database's `writes` stay empty through a full run.
- Redaction proof: a sync run through `main([])` on planted needles (key ids, user id, cipher text, NAV 7777.25, a 4321.5 P&L, a deposit amount, ten-digit bill ids, a transfer id, a venue exception message) leaves none in stdout or stderr, with the records populated so a leak had every chance to show.

Eligibility rule used: `eligible_key_predicate`, the phase35 backfill's own dispatch filter (is_active, sync_status not revoked, disconnected_at null), and not `working_holder_predicate`, because the backfill derives a series for an `error` or `sign_in_failed` key so that key's published numbers carry the offset, and `error` is also stamped for transient causes (a geo block, a failed positions poll) that would make a readable key unmeasurable; a key that cannot sign in is read and prints `read_failed` with its exception class.

## Task Commits

1. **Task 1 RED:** `8080ed979` test(184-02): add failing tests for the pre-decrypt refusals and venue-error arms
2. **Task 1 GREEN:** `e825c6a24` feat(184-02): refuse an unmeasurable key by name before any decrypt and read every derived key
3. **Task 2:** `811aa3ab7` test(184-02): prove the probe is read-only and leak-free by checks that can fail

## RED evidence and mutations

**Task 1 RED:** 20 of the 34 `-k "unmeasurable or shares_account"` tests failed before the feature commit, each on the planned behavior: `key_not_eligible` and `window_outside_retention` printed `reader_not_built` or `reach_unproven`, a venue `AuthenticationError`, `PermissionDenied`, `RateLimitExceeded` and `NetworkError` propagated out of `failure_token` (it re-raised), a reader past `KEY_READ_TIMEOUT_S` raised `TimeoutError`, a revoked or inactive key was decrypted (the fake had no client to hand it), `shares_account` was false for a key another key names. 14 passed on arrival because plan 184-01 already held those behaviors (an unparseable or naive `marked_at`, a healthy `error` key, a key with no mark). The `gsd_run check tdd-red-evidence` classifier does not support pytest's report format, so the semantic assessment above is the RED record, as in plan 184-01.

**Task 2:** its tests were green on arrival, because Task 1's code already follows the spec; their ability to fail is shown by the mutations below, each made on a byte-backed-up copy (`cp -p`, backup in a `mktemp -d` scratch directory outside the repo), restored with `cp -p` and confirmed with `cmp`. No `git checkout`, `git restore` or `git stash` was used.

mutation W3: RED `tests/test_walletoffset_probe.py::test_emit_rejects_every_out_of_contract_record` and `::test_emit_rejection_names_the_path_and_never_the_value` (`emit_record` skips `validate_record`); restored (cmp identical); GREEN

mutation W6: RED `::test_source_every_database_handle_the_probe_passes_on_is_the_wrapper` and `::test_read_only_the_handle_the_marks_read_and_the_price_resolver_get_is_the_wrapper` (`ReadOnlySupabase(get_supabase())` replaced by the bare client); restored (cmp identical); GREEN (105 passed)

mutation W7: RED `::test_read_only_a_full_run_leaves_the_fake_databases_writes_empty` plus `::test_source_calls_no_writer` and `::test_source_names_only_the_one_table_it_reads` (bare client and a planted `insert` on it: the fake database records `insert:api_keys`); restored (cmp identical); GREEN (105 passed)

mutation W8: RED `::test_source_calls_no_venue_write` (a planted `privatePostTradeOrder` call in the reader path); restored (cmp identical); GREEN (105 passed)

mutation W9: RED `::test_redaction_a_full_run_leaves_no_planted_needle_in_stdout_or_stderr` (a key id printed to stderr); restored (cmp identical); GREEN (105 passed)

mutation W10: RED `::test_unmeasurable_error_status_key_is_read_not_refused` and `::test_unmeasurable_sign_in_failed_key_fails_by_class` (eligibility widened to the working rule's statuses); restored (cmp identical); GREEN (105 passed)

mutation W11: RED `::test_unmeasurable_key_not_eligible_is_refused_with_no_decrypt` (three variants), `::test_unmeasurable_a_revoked_key_added_last_changes_no_other_record` and `::test_unmeasurable_eligibility_is_decided_before_the_reader_and_the_window` (the `key_not_eligible` refusal removed); restored (cmp identical); GREEN (105 passed)

Two further controls need no mutation because they are tests of the check itself: `test_read_only_the_bare_fake_records_a_write_so_the_empty_assertion_can_fail` and `test_leaks_the_check_finds_the_needles_in_a_deliberately_leaky_string` (plus `test_leaks_the_check_fails_a_run_whose_emitter_prints_the_raw_rows`, which runs the full world with a leaky emitter and finds the needles).

## Verification results

- `pytest tests/test_walletoffset_probe.py` from `analytics-service/`: 105 passed. `-k "unmeasurable or shares_account"`: 34 passed. `-k "read_only or source or redaction or leaks or emit or main"`: 21 passed.
- Full suite from `analytics-service/`: `.venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term`: **14183 passed, 102 skipped, 1171 warnings in 102.34s**, coverage 95% (gate 80). 14183 is 14133 from plan 184-01 plus the 50 tests of this plan; the 102 skips are existing skips elsewhere, this plan's tests skip nothing.
- CI mypy line, verbatim from `analytics-service/` with the venv's mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 131 source files`. Separately `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/walletoffset_probe.py`: `Success: no issues found in 1 source file`.
- SCOPE_OK printed: the phase's diff under `analytics-service/`, `supabase/` and `src/` is the script, its test file and `tests/_okx_bills.py` only.

## Decisions Made

See `key-decisions` above. One more: `get_kek()` is called only once a key reaches the read and outside the per-key exception mapping, so a missing KEK still fails the run loudly by type rather than printing one `read_failed` per key.

## Deviations from Plan

**1. [Note] Task 2's tests were green on arrival.** Task 1's implementation already satisfied them; their ability to fail is shown by mutations W3 and W6 to W9 (see above). Not a code deviation.

**2. [Note] The price-cache write is a caught failure, not a raised one.** The plan names the allocator probe's test whose title says the wrapper "turns the hidden price cache write into a caught failure"; the copied test asserts `writes == []` through the wrapper (the helper logs a warning and swallows the `AttributeError`), with the bare-client control recording `upsert:token_price_history`.

**3. [Note] One plan-184-01 test now documents a state plan 184-03 will change.** `test_okx_a_marked_key_on_a_venue_without_a_reader_is_never_decrypted` uses a Bybit key. It passes today and will stop being true when plan 184-03 adds the Bybit reader. The new `test_unmeasurable_sfox_key_has_no_reader_and_is_never_decrypted` is the one that stays true; plan 184-03 should retarget or remove the Bybit one. Left untouched here (surgical scope).

**Total deviations:** 0 auto-fixed, 3 notes. **Impact:** none on scope.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the script is read-only and outside `services/`. T-184-21, T-184-22 and T-184-23 are mitigated and each mitigation was seen RED under a neutered control (W3 and W6 to W9, W11, W10).

## Issues Encountered

None. Risk worth a reviewer's eye: `failure_token` now classifies every exception, so a programming error inside a reader would print as `read_failed` with class `other` and exit 1 rather than abort the run with a traceback type. That is what the plan prescribes ("any other exception gives read_failed"); the key's record and the non-zero exit make it visible, and the class is `other`, which is the signal to look.

## Next Phase Readiness

Plan 184-03 can add the Bybit and Binance readers to `_VENUE_READERS` (the refusals, retention table and timeout arm are already generic) and retarget the Bybit `reader_not_built` test from plan 184-01. Founder decisions needed: none.

## Self-Check: PASSED

- `analytics-service/scripts/walletoffset_probe.py` and `analytics-service/tests/test_walletoffset_probe.py`: found.
- Commits `8080ed979`, `e825c6a24`, `811aa3ab7`: ancestors of HEAD. `test(184-02)` and `feat(184-02)` commits present, GREEN after RED.
- `mutation W3:` line present and ends `restored (cmp identical); GREEN`; the eligibility sentence is present; CHANGELOG, VERSION, package.json, STATE.md and ROADMAP.md untouched.
