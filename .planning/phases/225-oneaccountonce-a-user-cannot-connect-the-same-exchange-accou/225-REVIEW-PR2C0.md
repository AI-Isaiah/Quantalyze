---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-25T15:25:48Z
round: 1
depth: standard
# Scope: PR-2c0 (plan 20), `git diff c7aec0505..d306c214e`, reviewed at d306c214e.
# HEAD (d74594028) adds only 225-20-SUMMARY.md on top of it; no source changed after d306c214e.
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/mt5_read.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/tests/test_mt5_read.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_sync_path.py
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
  necessity: 0
status: issues_found
---

# Phase 225: Code Review Report, PR-2c0 (plan 20), round 1

**Reviewed:** 2026-11-25T15:25:48Z
**Scope:** `git diff c7aec0505..d306c214e`, 6 files (3 source, 3 test), no migrations
**Depth:** standard, plus cross-file traces into `mt5_probe.py` on both branches, `mt5_handover.py`, `mt5_validation.parse_mt5_credentials`, `job_worker._make_mt5_session`, `services/logging_config.py`, `services/redact.py`, `routers/exchange.py` and `services/ingestion/mt5.py`
**Files Reviewed:** 6
**Status:** issues_found

## Summary

I read the change against `225-20-PLAN.md`, PR-2c's `assert_expected_server` (`git show gsd/phase-225-pr2c:analytics-service/services/mt5_probe.py`) and the MT5 `account_info` docs page (fetched 2026-11-25). The page says `account_info()` returns a named tuple or None on error. Its example output lists `server=MetaQuotes-Demo` as a string field next to `login`, `name` and `company`. Nothing on the page says the reported server equals the name passed to `login()`.

**The diff does what the plan asks, and I could not make it change poll behaviour.**

- **No exception can escape.**
  - `info.get("server")` runs on a dict. At all three sites `info` is `Mt5Client.account_info()`'s `_materialize` dict, and `.get("login")` has already run on it.
  - `normalise_mt5_server` is `server.strip().casefold()`, and the code calls it only on a `str`. `session.server` is a non-blank `str` by construction (`parse_mt5_credentials`, `mt5_validation.py:187-189`, reached through `job_worker._make_mt5_session`).
  - `normalize_mt5_holder` is total over `object`.
  - The redaction record factory is documented never to raise.
- **Order relative to the login checks.**
  - All three calls sit after their login check.
  - The derive call sits after the PRE bracket only, so it writes one line per read. The POST re-read writes nothing.
  - Nothing the read returns is modified.
- **Per-poll volume:** one INFO line per poll. `read_mt5_deal_ledger` has one production caller, `job_worker.py:7816`. The only other mentions are comments, in `allocator_equity_derive.py:1207`, `mt5_concurrency.py` and `mt5_relogin.py`. `SITE_BACKFILL` has no lease user.
- **Predicate parity with PR-2c:**
  - The helper is the exact complement of `assert_expected_server`'s raise condition. True means pass. False and not_captured both mean refuse.
  - `normalise_mt5_server` is byte-identical on both branches (diffed).
  - The requested value comes from the same `parse_mt5_credentials` strip that feeds `run_probe`'s `server` in both PR-2c enforcement paths (`routers/exchange.py:600`, `services/ingestion/mt5.py:193`).
- **Leaks:**
  - The rendered line is a static message plus a closed-set site, the normalised holder and the verdict.
  - I passed a real `LogRecord` through `configure_logging()`'s factory. The line came out unchanged for all three values, because the `session` key alternate needs `[:=]` straight after `session`. A UUID holder arrives lower-cased.
  - No login, server or password value reaches the line.
- **Imports:** no new cycle. `mt5_concurrency` already imports `services.mt5_handover`.
- **Tests:**
  - These all passed at d306c214e:
    - the four target files: 295 passed;
    - every test file that touches the three reads: 1289 passed;
    - `-k mt5`: 2974 passed, 1 skipped;
    - the source-scanning suites: 190 passed.
  - `mypy --strict` is clean on the three modules.

**What remains:**

- **One MEDIUM, WR-01.** It is a limit on what the gate covers, not a defect in this diff. Task 3's PASS would gate PR-2c, but every line is measured on the worker gateway's terminal. Both of PR-2c's enforcement paths run on the separate validation terminal.
- **Four Info items.** The most useful is IN-01: nothing pins the derive site's "after the login bracket" order. I proved it with a neuter.

`$HOME/.claude/gsd-core/references/necessity-review.md` was read and applied. The not_captured arm handles data from another process (a trust boundary). The `holder=None` default is a test seam. Neither is a necessity finding.

## Warnings

### WR-01: Task 3's PASS gates PR-2c, but every line comes from a terminal PR-2c never enforces on (gate-coverage limit, user-facing)

**File:** `analytics-service/services/mt5_read.py:363-365`, `analytics-service/services/job_worker.py:860-862`, `analytics-service/services/allocator_positions.py:981-986`. The enforcement side is `routers/exchange.py:911` and `services/ingestion/mt5.py:350`.

**Issue:**

- **Where the lines come from.** All three verdict sites run on sessions built by `job_worker._make_mt5_session` against `MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT` (`job_worker.py:1760`). That is the terminal serving live jobs.
- **Where PR-2c enforces.** PR-2c's `assert_expected_server` runs only inside `run_probe`. Both of its callers lease the validation terminal through `read_env_validation_gateway_endpoint()`:
  - the wizard route, `routers/exchange.py:630-634` (D-02: "a validation leases the VALIDATION terminal"; D-05: it never falls back to `MT5_GATEWAY_HOST`);
  - the worker adapter, `services/ingestion/mt5.py:210`, `SITE_VALIDATE_WORKER`.
- **What the measurement leaves open.** The plan says this line exists so that PR-2c's bracket is "shown not to refuse correct sessions on any live broker server before it ships". Plan 18 Task 3 step 1 treats Task 3's PASS as that evidence. But `account_info().server` is the name as a given terminal knows it, and the docs do not promise that the name is the same across terminals. The validation terminal is a separate process with its own state. It is also scrubbed after every verdict (Phase 164.6.6.1 MT5SCRUB). So a clean poll measurement is strong indirect evidence, not a direct measurement of the terminal where PR-2c refuses.
- **Cost if the proxy is wrong.** Every correct connect or re-validation on the affected broker is refused. That is user-facing, and it is the exact outcome the gate exists to prevent.
- **Why it is not a defect in this diff.** The code measures what the plan specified. The predicate is identical to PR-2c's, and the requested value is identical too.

**Fix:** pick one before Task 3's PASS is allowed to gate PR-2c.

- **(a) Measure the validation terminal too.** No file is shared with PR-2c, because `run_probe` already returns the PRE `account_info`:
  - After `run_probe` returns at `routers/exchange.py:911` and `services/ingestion/mt5.py:350`, add `log_mt5_poll_server_verdict(info, requested_server=server, site=SITE_VALIDATE_WIZARD or SITE_VALIDATE_WORKER, holder=HOLDER_VALIDATION)`.
  - Extend Task 3's PASS rule with "0 False and 0 not_captured on the validation sites".
  - Validation lines cannot be attributed to a server. Any False there is still a STOP.
- **(b) Record the proxy explicitly.**
  - Write in `225-20-SUMMARY.md` that the evidence is on a proxy terminal.
  - Have plan 18 Task 3 add a first-validation check after PR-2c deploys, so a refused correct connect is spotted at once.
  - Name the founder decision accepting the proxy.

## Info

### IN-01: Nothing pins the derive site's "after the login bracket" order (neuter run, 163 passed)

**File:** `analytics-service/services/mt5_read.py:355-365`

**Issue:** In a scratch copy I moved the `log_mt5_poll_server_verdict(...)` call above `assert_expected_login(info, login=session.login)` and ran `tests/test_mt5_read.py tests/test_mt5_derive_branch.py tests/test_mt5_sync_path.py`. The result was **163 passed, 0 failed**.

- **The other two sites are pinned.** The balance site is covered by the SUMMARY's neuter (g). For the holdings site I ran the same neuter in a scratch copy: `test_a_holdings_read_on_a_mismatched_login_writes_no_verdict_and_keeps_its_disposition` went RED (1 failed, 160 passed).
- **The plan's first truth is unpinned for the derive.** "judged on the snapshot whose login the bracket just accepted" can regress there silently. A wrong-account snapshot would then log a verdict under this key's holder and skew Task 3's per-server counts.
- **Also unpinned:** PRE versus POST. The fake returns the same account on both reads, so moving the call after the POST bracket stays green too.

**Fix:** Add a `test_mt5_read.py` case. Use `_account(_OTHER_LOGIN, server=_REQUESTED_SERVER)`, then assert two things: `read_mt5_deal_ledger` raises `Mt5AccountMismatchError`, and `_verdict_records(caplog) == []`.

### IN-02: A body that outlived its timeout can still write a line for a poll its caller recorded as timed out

**File:** `analytics-service/services/job_worker.py:878-880`, `analytics-service/services/allocator_positions.py:1014-1016`, `analytics-service/services/job_worker.py:7814-7826`

**Issue:** All three reads run in `asyncio.to_thread` under `asyncio.wait_for`.

- Say the timeout fires after `account_info()` returned but before the verdict is logged. The abandoned thread can still write its line, even though the caller has already restarted the terminal or returned None.
- The verdict is still accurate for the snapshot it judged. But Task 3 will count a poll the job recorded as a timeout.
- The window is microseconds, so the effect on counts is negligible.

**Fix:** None needed. Optionally note in Task 3 that a line does not imply the poll succeeded.

### IN-03: The SUMMARY's neuter table does not list an order neuter for the derive or the holdings site

**File:** `.planning/phases/225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou/225-20-SUMMARY.md` (neuter table, row (g))

**Issue:** Row (g) proves the order for the balance site only. Holdings is pinned, as measured in this review. The derive is not (IN-01).

**Fix:** When IN-01's test lands, add a derive order-neuter row.

### IN-04: The derive site is hard-coded inside the shared read

**File:** `analytics-service/services/mt5_read.py:356-365`

**Issue:** `read_mt5_deal_ledger` writes `site=SITE_DERIVE` for every caller. The comment says a second caller "must add a site argument", but nothing enforces it. A future backfill caller would mislabel its lines as derive lines. There is one caller today, `job_worker.py:7816`.

**Fix:** None needed now. If a second caller is added, make `site` a keyword argument with no default.

---

_Reviewed: 2026-11-25T15:25:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter, round 1 (2026-11-25)

No CRITICAL or HIGH. One MEDIUM:

- **SF-M1:** Task 3's PASS rule could pass even when keys that fail before the line is written were never measured.

LOW findings, recorded here only:

- the derive line is written before the read's outcome is known;
- "cannot raise" holds only for production inputs;
- the tests force the logger level;
- Railway labels every line as error severity, so search by message text;
- the import graph.

## Orchestrator dispositions (2026-11-25)

| Finding | Disposition |
|---------|-------------|
| WR-01 | Fixed in 161eb8b45. `run_probe` writes the same log-only verdict on the validation terminal, after the PRE login check, with `holder=validation`. Task 3's PASS rule now also needs 0 False and 0 not_captured on the validation sites (b397dbf70). |
| SF-M1 | Fixed in b397dbf70. Task 3 now counts coverage per key: distinct live MT5 keys polled in the window, against the distinct holders seen in lines. Keys with zero lines are reported per site. |
| IN-01..IN-04 and the SF LOWs | Recorded only. |
