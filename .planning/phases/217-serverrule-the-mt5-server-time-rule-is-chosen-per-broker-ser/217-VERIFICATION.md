---
phase: 217-serverrule-the-mt5-server-time-rule-is-chosen-per-broker-ser
verified: 2026-11-18T00:00:00Z
status: passed
score: 7/7 must-haves verified
verified_at_sha: 4cb92b8b91cd331c69fbf7b858b42d0b0a6f2df1
drift_subjects:
  - analytics-service/services/mt5_server_clock.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_server_clock_reading.py
  - analytics-service/services/mt5_deals.py
  - analytics-service/tests/test_mt5_server_clock.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_server_clock_readings_parity.py
  - analytics-service/tests/conftest.py
  - docs/runbooks/mt5-go-live.md
  - docs/runbooks/navmtm-chain-move-go-live.md
behavior_unverified: 0
overrides_applied: 0
re_verification: null
---

# Phase 217: SERVERRULE Verification Report

**Phase Goal:** The MT5 server time rule is chosen per broker server, not once per worker. A server that keeps UTC (measured offset 0) gets a `utc` rule, so its derive passes the Phase 155.1 clock guard instead of ending `failed_final`. The rule stays configuration and is never written back from a reading (155.1 D-12). Plus founder decisions Q1, Q2, utc = fixed 0 with no migration, and map set before deploy.
**Verified:** 2026-11-18
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Default `us` plus a map entry `<full hash>=utc`: a derive on a UTC-keeping server writes a `match` reading with `configured_rule='fixed'`, `expected_offset_s=0`, and persists days | VERIFIED | `parse_mt5_server_time_rules` maps `utc` to `fixed_server_clock(0)`; `job_worker.py` selects the clock after the read via `select_mt5_server_clock`. `test_a_server_mapped_to_utc_persists_a_fixed_zero_match_reading` passes; neutering selection (`if False:`) turns it RED, with `test_a_rules_map_entry_selects_its_clock_by_full_hash`. `test_a_fixed_zero_clock_row_fits_the_existing_checks` plus migration CHECK `IN ('eu','us','fixed')` (line 121) confirm no migration needed. |
| 2 | An unmapped server is assessed and dated under the default exactly as before | VERIFIED | `select_mt5_server_clock` returns `default, mapped=False` when the hash is absent or None. `test_a_map_entry_for_another_server_does_not_rescue_a_mismatch`, `test_a_blank_server_falls_back_to_the_default_rule`, `test_a_missing_server_hash_is_never_looked_up` pass. The only `resolve_mt5_server_clock` call site is the derive's pre-read block. |
| 3 | A MAPPED server whose measured offset disagrees refuses: FAILED transient, `clock_mismatch` page, only the reading written, even when the entry equals the default | VERIFIED | `else` arm in `job_worker.py` keeps `arm=server_clock_mismatch`, page `clock_mismatch`, `return DispatchResult(FAILED, transient)`. `mapped` is a returned flag (`Mt5ServerClockSelection`), not `clock != default`. Parametrized `test_a_server_clock_mismatch_refuses_...[map-equals-default]` and `[map-differs-from-default]` pass. Neuter `if not mapped:` to `if True:` turns both RED. |
| 4 | An UNMAPPED server whose offset disagrees with the default writes the mismatch reading, raises one `unmapped_clock_mismatch` page, and persists its days under the default (Q2 override) | VERIFIED | `if not _mt5_selection.mapped:` arm logs `arm=server_clock_unmapped_drift`, pages `unmapped_clock_mismatch`, and has no `return`, so the derive continues. `test_an_unmapped_server_clock_mismatch_persists_and_pages_once` passes (asserts upserts, one page, no `server_clock_mismatch` log). Neuter to `if False:` (always refuse) turns it RED. |
| 5 | A malformed `MT5_SERVER_TIME_RULES` fails every MT5 derive before any terminal call, transient, one closed value-free message | VERIFIED | The parse sits in the same pre-read `try` as the default resolve, so the fault returns `DispatchResult(FAILED, transient)` with the closed `_MALFORMED_RULES_MESSAGE` (fifth member of `MT5_SERVER_CLOCK_CONFIG_MESSAGES`). Faults covered: no `=`, key not 64 lowercase hex (non-ASCII and uppercase rejected by charset check), value outside `eu`/`us`/`utc`, duplicate hash. `test_a_malformed_rules_map_fails_transient_and_makes_no_terminal_read` and `test_a_malformed_rules_map_fails_loud_with_a_closed_value_free_message` pass. Neutering the parse (`_mt5_server_rules = {}`) turns the mapped-utc and malformed-map tests RED. I also ran the runbook's validation one-liner: valid value prints `1`; a malformed value raises the closed message without echoing the value. |
| 6 | Default-clock config faults and a failing readings insert still refuse, for every verdict | VERIFIED | `resolve_mt5_server_clock()` is unchanged and still faults pre-read in the same `try`; the reading-insert arm still sits above the mapped/unmapped split (J9 test parametrized for no-tick and unmapped-mismatch asserts the unmapped page never fires when the insert fails). Pre-existing config-fault tests in `test_mt5_server_clock.py` still pass. |
| 7 | One clock per derive; the server name and hash appear in no log, page detail, tag or error | VERIFIED | `_mt5_clock` is bound once (`_mt5_selection.clock`); the assessment, reading row (`clock=`), and the offset sites (`server_utc_offset_s=_mt5_clock`, `deal_utc_day`, `deal_utc_instant_ms`) all read that one binding. The hash used for lookup (`server_label_hash(_mt5_info.get("server"))`) is the same function and same source value as the reading row's `server=`. Log and page strings carry rule id and hour offsets plus uuid only. Adapted `test_one_clock_per_derive` and the AST pins pass. `test_the_server_name_is_normalised_before_the_map_lookup` and `test_a_utc_mapped_server_dates_the_winter_deposit_by_its_own_clock` (days dated by the mapped clock, 2025-11-11 versus 2025-11-10 unmapped) pass. |

**Score:** 7/7 truths verified, 0 behavior-unverified.

Founder-decision cross-check:

| Decision | Status | Evidence |
|----------|--------|----------|
| Q1 Railway map by full hash, default stays for unmapped | VERIFIED | Map keyed by 64-hex full hash with exact equality (no prefix matching); default variables untouched. |
| Q2 unmapped mismatch writes and alerts; mapped mismatch, malformed map, default faults, insert failure still refuse | VERIFIED | Truths 3 to 6 above. |
| utc = fixed 0, no migration | VERIFIED | `git diff 5ad0847ba..HEAD --name-only` outside `.planning` lists no `supabase/` path; the existing CHECK admits `fixed`. |
| Map set before deploy | VERIFIED (documentation) | `docs/runbooks/mt5-go-live.md` step 3 and `navmtm-chain-move-go-live.md` P6 state the order: set on both worker services before deploying the reader; operational action stays the coordinator's. |
| Rule never written back from a reading (155.1 D-12) | VERIFIED | No code path writes any env, config or map from `_mt5_clock_assessment`; the only inputs are the two env variable families. |
| Scope: Phase 216's `routers/process_key.py` untouched | VERIFIED | Not in the diff against the merge base `5ad0847ba`. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/mt5_server_clock.py` | env name, closed message, `parse_mt5_server_time_rules`, `Mt5ServerClockSelection`, `select_mt5_server_clock` | VERIFIED | All present, stdlib only, substantive, imported by `job_worker.py`. |
| `analytics-service/services/job_worker.py` | pre-read parse, post-read selection, two-way arm | VERIFIED | Present, wired, data flows from `_mt5_info.get("server")`. |
| `tests/test_mt5_derive_branch.py`, `tests/test_mt5_server_clock.py` | job-level and leaf proof | VERIFIED | 166 passed across the three clock test files. |
| `docs/runbooks/mt5-go-live.md`, `navmtm-chain-move-go-live.md` | grammar, order, failure modes | VERIFIED | Present and consistent with the code (grammar, validation command, `unmapped_clock_mismatch`). |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `job_worker.py` | `mt5_server_clock.py` | `resolve_mt5_server_clock` + `parse_mt5_server_time_rules` in the one pre-read try, `select_mt5_server_clock(` after the read | WIRED |
| `job_worker.py` | `mt5_server_clock_reading.py` | `server_label_hash(_mt5_info.get("server"))` | WIRED |
| `job_worker.py` | `ops_alert.py` | `ops_alert.page("mt5_server_clock", "unmapped_clock_mismatch", ...)` | WIRED |

### Behavioral Spot-Checks and Neuter Evidence

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Clock, derive-branch and parity suites | `pytest tests/test_mt5_server_clock.py tests/test_mt5_derive_branch.py tests/test_mt5_server_clock_readings_parity.py` (analytics-service) | 166 passed | PASS |
| mypy strict on changed services | `mypy services/mt5_server_clock.py services/job_worker.py` | no issues | PASS |
| N1 selection ignores map | sed neuter of `server_hash in rules`, byte-restored (`cmp` exit 0) | 3 tests RED incl. mapped-utc | PASS (gate bites) |
| N2 mapped treated as unmapped | `if True:` neuter, restored | 2 mapped-refusal tests RED | PASS |
| N3 unmapped refuses too | `if False:` neuter, restored | unmapped write-and-alert test RED | PASS |
| N4 map parse removed | `_mt5_server_rules = {}` neuter, restored | mapped-utc and malformed-map tests RED | PASS |
| Runbook validation command | valid and malformed candidate | prints `1`; malformed raises the closed value-free text | PASS |

All neuters were taken from byte backups in the scratchpad and restored with `cmp` exit 0; the worktree has no source modifications.

### Requirements Coverage

No requirement IDs for this phase (`requirements: []`; REQUIREMENTS.md maps none to 217). No orphaned requirements.

### Anti-Patterns Found

None blocking. No TBD/FIXME/XXX introduced in the phase's source changes. 217-REVIEW.md: 0 critical, 0 warning, 5 info; silent-failure pass SF-01..07 all LOW/INFO, recorded and not fixed per project rule (217-REVIEW-DISPOSITION.md). 217-SECURITY.md `status: verified`; 217-VALIDATION.md `status: validated`.

### Probe Execution

No probes declared by the phase.

### Post-deploy UAT (not a blocker, judged not required for the code-level goal)

The live PROD leg cannot be verified before deploy: once the coordinator sets the `MT5_SERVER_TIME_RULES` entry for the `13a451cff998…` full hash on both worker services (before merge, per the corrected ordering), the next derive for that key must write a `match` reading with `configured_rule='fixed'`, `expected_offset_s=0`, and the derive must end done, not `failed_final`. I judge this an operational confirmation of a Railway setting the phase explicitly does not write, not a missing piece of the delivered mechanism: the mechanism is proven at job level with a planted UTC server, including neuter evidence. It is recorded here for the coordinator and does not change the status.

### Gaps Summary

None. The per-server selection, both mismatch arms, the malformed-map pre-read fault, the no-migration utc, the runbook ordering, and the no-write-back invariant are all present in the code, wired, and covered by tests that go RED when their branch is neutered.

---

_Verified: 2026-11-18_
_Verifier: Claude (gsd-verifier)_
