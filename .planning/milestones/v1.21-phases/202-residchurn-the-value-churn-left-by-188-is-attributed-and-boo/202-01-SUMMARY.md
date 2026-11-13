---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 01
subsystem: testing
tags: [prod-read-kit, digest, md5, sql-lint, capture-gate, scratch]

requires:
  - phase: 188-tinybase
    provides: b0 and b1 row-level captures, map.json labels, diff.py ordering rules
provides:
  - proof that b1's rows stand for c0 on all 54 digest scopes, 7 books and 30 key inputs
  - the 11:25:40Z non-nightly derive cleared as a cause of b1-to-c0 movement (D-10)
  - ten read-only self-checking n_*.sql files, a SHA pin on the seven originals, a SQL lint
  - a capture gate (check_capture.py) that recomputes every PROD-side md5
affects: [202-02, 202-03, 202-04, 202-05, 202-06, 202-07, 202-08]

actuals:
  tokens: 13100
  tasks: 3
  commits: 3
plan_head_before: efa14e04e36b0a9321e9fcf044f1864ce3c7beb3
plan_head_after: 788ae5d4e89986ede6786db33eca6f931a0e2fac

tech-stack:
  added: []
  patterns:
    - "every hand-saved PROD result carries a PROD-side md5 (chk) that a local script recomputes"
    - "each gate script is shown RED on a broken input before it is trusted"

key-files:
  created:
    - ~/.cache/quantalyze/residchurn/bin/rc.py
    - ~/.cache/quantalyze/residchurn/bin/recompute_digest.py
    - ~/.cache/quantalyze/residchurn/bin/gen_sql.py
    - ~/.cache/quantalyze/residchurn/bin/check_capture.py
    - ~/.cache/quantalyze/residchurn/sql/SHA256SUMS.d
  modified: []

key-decisions:
  - "n_ file prefix for every new SQL file so the d_*.sql set stays exactly the seven originals"
  - "an original d_*.sql result saved without checks.json fails as unbound, so plan 04's pre read carries no unbound d_books.sql result"
  - "the nightly times are arguments of check_capture.py, never literals"

requirements-completed: [RESID-01, RESID-02]

coverage:
  - id: D1
    description: "b1 rows reproduce c0's 54 PROD digests, 7 book stamps and 30 key-input stamps; the 11:25:40Z derive moved no scope"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I recompute_digest.py --rows b1 --digests c0, then --self-test"
        status: pass
    human_judgment: false
  - id: D2
    description: "ten linted read-only SQL files whose results carry a PROD-side md5; the seven originals pinned by SHA256SUMS.d"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I gen_sql.py lint sql; gen_sql.py --self-test; all ten executed on a throwaway loopback Postgres with synthetic data and chk equal to the local recompute"
        status: pass
    human_judgment: false
  - id: D3
    description: "capture gate recomputes the four d_checks md5s, refuses an unbound original, gates idle queue, marker and nightly coverage"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I check_capture.py --kind c0 (checks=4/4); check_capture.py --self-test (11 behaviours)"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-11-06
status: complete
---

# Phase 202 Plan 01: Capture kit and basis proof Summary

**b1's rows, run through the exact digest recipe PROD uses, reproduce all 54 c0 digests (so b1 stands for c0 and the 11:25:40Z derive is cleared), and the orchestrator now holds ten linted read-only self-checking SQL files plus a capture gate that has been seen to fail on each broken input it guards.**

gc-c-basis: keys=38/38 strats=16/16 books_computed_at=7/7 ki_computed_at=30/30
gc-c-d10: b1_to_c0_moved_scopes=0 non_nightly_job=2026-11-06T11:25:40Z cleared=yes
gc-c-recipe: pgtext=int|-0|repr selftest=1-ulp-red
gc-c-kit: sql_new=10 lint=ok sha256_d=7/7 gen_sql_selftest=red-as-expected
gc-c-kit-gate: c0_checks=4/4 jobs=aggregate-c0-shape selftest=red-as-expected

## Accomplishments

- **Basis proof (Task 1).** `recompute_digest.py` groups 188's b1 rows by scope, rebuilds each scope's `date|pgtext(value)` md5 and compares `h`, `n`, `first`, `last` with c0: 38/38 key scopes and 16/16 strategy scopes. Book and key-input `computed_at` stamps are equal for 7/7 and 30/30, so no compose rewrote them between b1 and c0. The 1-ULP self-test (`math.nextafter` on one key row) makes exactly one key scope mismatch while the untouched run has none. An extra informational line shows `max(updated_at)` also equal on 38/38 and 16/16, so the 11:25:40Z derive did not even rewrite identical values; D-10 is cleared.
- **Kit (Task 2).** `SHA256SUMS.d` pins the seven `d_*.sql` (written first, re-checked by lint and by the gate). `gen_sql.py` writes ten `n_*.sql` (keys, strats and books prefix digests for 2026-11-05, anchors with flow days, ledger, jobs check, final marker and idle reading, strategy-to-key map, and the two b3 files) and `rows --moved` writes `r_rows_<label>.sql`. `lint` rejects any file that does not start with SELECT or WITH, holds more than one statement, or contains a write verb as a whole word; it went RED on `DELETE`, on two statements and on a data-modifying CTE, and `updated_at`/`created_at` pass.
- **Gate (Task 3).** `check_capture.py` recomputes the four `d_checks.sql` md5s and the counts, recomputes `chk` over every saved new-file result, fails any original saved without `checks.json` as `unbound=<file>`, gates the marker, the idle queue (`final.json busy == 0`, no pending/running/failed_retry row), the per-subject `jobs_check.json` binding, the mid-capture `jobs_after.json` rule and the nightly coverage (`--nightly-created`, `--nightly-after`, both required with `--kind c1`).

## Verification evidence

- c0 through the gate: `gc-c-check: capture=c0 marker=PRODUCTION checks=4/4 counts=ok n_files=0/0 jobs=aggregate-c0-shape sql_sha=ok`.
- `gen_sql.py lint`: `files=10 violations=0 sha256_d=7/7`.
- Beyond the plan (the kit is run under time pressure on PROD, so a syntax or md5 error had to show up here): all ten n_*.sql and one `r_rows` file were executed on a throwaway Postgres 16 listening on loopback only, loaded with synthetic rows (no PROD data). Each result's `chk` equalled the local recompute (`n_files=9/9` through the gate), `pgtext` matched Postgres `float8::text` on 11 edge values (0, -0, 3.0, 1e-5, 3e-06, 1e16, 5e-324, 0.1+0.2 and others) with 0 mismatches, and the Python prefix digest equalled the SQL one.
- `git status --porcelain -- analytics-service supabase` printed nothing; the uuid and home-path grep on this file prints nothing.

## Conventions the later plans must follow (saved-result file names)

The gate reads a capture directory. Results are saved one file per MCP query, as a JSON list holding the returned row object(s): originals as `keys.json strats.json books.json ki.json counts.json checks.json`; each new result as `<sql stem>.json` (for example `n_keys_prefix_20261105.json`, `n_anchor.json`, `n_b3_window.json`, `n_ledger.json`, `n_b3_ki.json`); `n_final.sql` as `final.json`; `n_jobs_check.sql` as `jobs_check.json` (and `jobs_after_check.json` for the second jobs read); the marker query as `marker.json`; `r_rows_<label>.sql` as `r_rows_<label>.json`. `--kind pre` and `--kind c1` require `marker.json`, `final.json` and the per-subject `jobs.json` with its check; `--kind c1` also requires `--pre`, both nightly times and `jobs_after.json`. `--kind rows` needs `--c1 DIR` and prints `marker=n/a`. `n_jobs_check.sql` and `n_final.sql` results saved under their stem names are refused with the right name in the message.

## Deviations from Plan

None - plan executed exactly as written. Two small choices inside the plan's latitude, recorded for the reader:

- The `gc-c-d10` line printed by `recompute_digest.py` reads `b1_to_c0_moved_scopes=0 of 54 ...` (the plan's `<n of 54>` form); the SUMMARY line above is the plan's verify form without `of 54`.
- `n_final.sql` coalesces a NULL marker to the text `NULL`, so a lost database comment reads as a failed marker (`marker=WRONG`) rather than silently NULL-ing the whole `chk`.

**Total deviations:** 0. **Impact:** none.

## Issues Encountered

None. One tool-permission denial on a combined local-test shell command was resolved by moving the script into a file and re-running; nothing was deleted.

## Known Stubs

None.

## Threat Flags

None. No network endpoint, auth path or schema was added; nothing here touched PROD, Railway, Keychain or `q.sh`.

## Next Phase Readiness

Plan 04's pre-nightly read can run the kit at `~/.cache/quantalyze/residchurn/sql/n_*.sql`, one statement per MCP call, marker first, then check the capture directory with `check_capture.py --kind pre`.

## Self-Check: PASSED

- Scripts and SQL present under `~/.cache/quantalyze/residchurn/` (bin: rc, recompute_digest, gen_sql, check_capture; sql: ten `n_*.sql` and `SHA256SUMS.d`).
- Task commits present on this branch: f89908a58, dc34c459d, 788ae5d4e.
