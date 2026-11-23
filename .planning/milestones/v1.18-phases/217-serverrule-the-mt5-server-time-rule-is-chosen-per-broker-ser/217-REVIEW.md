---
phase: 217-serverrule-the-mt5-server-time-rule-is-chosen-per-broker-ser
reviewed: 2026-11-18T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_deals.py
  - analytics-service/services/mt5_server_clock.py
  - analytics-service/services/mt5_server_clock_reading.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_server_clock.py
  - analytics-service/tests/test_mt5_server_clock_readings_parity.py
  - docs/runbooks/mt5-go-live.md
  - docs/runbooks/navmtm-chain-move-go-live.md
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
  necessity: 1
status: issues_found
---

# Phase 217: Code Review Report

**Reviewed:** 2026-11-18
**Depth:** standard (diff `e2c15996d..HEAD`)
**Files Reviewed:** 10
**Status:** issues_found (LOW / INFO only; nothing at MEDIUM or above)

## Summary

I reviewed the Phase 217 diff against 217-CONTEXT.md, which records the Q1, Q2 and utc-is-fixed-0
decisions plus the "What still refuses" list. Each item in that list was traced through
`run_derive_broker_dailies_job`, and each one is implemented as CONTEXT states it:

- **Mapped mismatch still refuses** (`job_worker.py:7796-7830`). It returns FAILED transient with
  the `clock_mismatch` page and `arm=server_clock_mismatch`. `mapped` is a flag the selection
  returns (`mt5_server_clock.py:219-227, 280-283`). It is never worked out by comparing clocks, so
  a map entry that equals the default still refuses. The parametrized test pins this, including
  the case where the entry equals the default.
- **Malformed map faults before the read.** `parse_mt5_server_time_rules()` runs in the same `try`
  as `resolve_mt5_server_clock()` (`job_worker.py:7181-7197`), before any terminal call. The
  job-level test asserts `transport.calls == []` and no writes. The grammar covers every malformed
  form CONTEXT names: no `=`, a key that is not 64 lowercase hex characters (checked by character
  set, so upper-case and non-ASCII keys are refused), a value outside eu/us/utc, and a duplicate
  hash.
- **Unmapped mismatch writes and pages** (`job_worker.py:7769-7795`). It has no `return`, uses its
  own arm name and its own cause, `unmapped_clock_mismatch`. That cause matches
  `OPS_ALERT_CAUSE_RE`. The ops_alert window key is (source, cause, event), so an unmapped page
  can never suppress a mapped refusal page inside the hour, and a mapped page cannot suppress an
  unmapped one.
- **The reading-insert failure still refuses for every verdict**, because the insert arm sits above
  the mapped/unmapped split. The J9 parametrization pins this.
- **No values leak.** The page detail holds only the rule id and offsets in hours. The logs hold
  the job id and the key id. `_MALFORMED_RULES_MESSAGE` is closed-set text. The tests assert that
  neither the planted server name nor its hash appears in any log record, the page detail or its
  args, or the error message.
- **One clock per derive.** `_mt5_clock` is now bound once, after the read (`job_worker.py:7670`),
  and every later use sits after that binding. The `_mt5_read` and `_mt5_info` names that the
  selection depends on were already used at that point before this phase, so moving the binding
  adds no path where `_mt5_clock` is unbound. `test_one_clock_per_derive` pins the binding count,
  the order (config, then read, then selection, then the offset sites) and the six offset sites.
- **Hash parity.** The lookup key is `server_label_hash(_mt5_info.get("server"))`, the same
  function the reading row hashes with. `normalise_mt5_server` is `strip().casefold()`, which
  matches the independent `hashlib` oracle in the tests.

The three phase test files pass locally: **166 passed**. No other worker path dates deals with the
clock (`grep server_utc_offset_s=` over `services/` hits only `job_worker.py` and the offline
`mt5_parity.py` / scripts), so no other handler is left on the default rule for a mapped server.

Every finding below is LOW or INFO. Under the project rule they are recorded here only and are not
booked in TODOS.md.

## Info

### IN-01: [LOW] A blank-server account mismatching the default has no mapping remedy, but the alert and runbook say "map it"

**File:** `analytics-service/services/job_worker.py:7666-7670, 7769-7795`; `docs/runbooks/navmtm-chain-move-go-live.md:205-208`; `docs/runbooks/mt5-go-live.md:228-236`
**Issue:** CONTEXT settles that a blank or missing `account_info().server` is unmapped, and that
an unmapped mismatch writes (Q2). Taken together, that account can never be mapped: it has no
hash, and its reading row stores `server_label_hash = NULL`, so the runbook's "read the hash from
`mt5_server_clock_readings`" step returns NULL. If such an account's clock disagrees with the
default, it writes days under the wrong rule on every derive, with no fix except changing the
global default. The `unmapped_clock_mismatch` page and the `arm=server_clock_unmapped_drift` log
look the same as a mappable server's, and both runbooks name "a map entry" as the fix. The code
matches CONTEXT, so this is not a deviation. It is a gap in how the case is reported. It is LOW
because a live MT5 terminal is not expected to return an empty `server`.
**Fix:** Add `server_hash=present|absent` (a boolean, never the value) to the unmapped-drift log
line. Add one runbook sentence: a `mismatch` row with a NULL `server_label_hash` cannot be mapped,
so investigate why the terminal returns no server name.

### IN-02: [INFO] The navmtm runbook states "must give today's reading" twice in a row

**File:** `docs/runbooks/navmtm-chain-move-go-live.md:194-198`
**Issue:** The new text says "...either must give today's reading. Both services must carry the
same map value; ... The setting must give today's reading." The second sentence is the old one,
left in after the new sentence superseded it.
**Fix:** Delete the trailing "The setting must give today's reading."

### IN-03: [INFO] The pre-read comment still says the clock is "resolved ONCE ... and handed to every offset site"

**File:** `analytics-service/services/job_worker.py:7153-7156`
**Issue:** The 175 / D-01 comment above the `try` still describes a clock that is resolved before
the read and passed to every offset site. Since Phase 217, only the DEFAULT is resolved there, and
the per-server clock is selected after the read. The new three-line comment inside the `try`
corrects this, but the paragraph above it now says the opposite.
**Fix:** Reword it to "the DEFAULT clock and the per-server map, parsed ONCE before the first
terminal read; the clock is selected once after the read (`_mt5_selection`)".

### IN-04: [INFO] Nothing in code checks that the map is identical on the two worker services

**File:** `docs/runbooks/mt5-go-live.md:203-207`; `docs/runbooks/navmtm-chain-move-go-live.md:197-202`
**Issue:** `quantalyze-analytics` and `quantalyze-analytics-backfill` both run the derive. If their
`MT5_SERVER_TIME_RULES` values differ, a mapped key's days are dated one way or the other
depending on which service claimed the job, and a re-derive can move days between dates. Only the
runbook's operator-run abort check guards this. The same was already true for the default
variables, so Phase 217 adds no new kind of risk.
**Fix:** No code change is needed for this phase. If it is wanted later, a deploy-verify step could
compare a hash of the variable across both services, printing a digest and never the value.

### IN-05: [INFO] Impossible-state guard: `server_hash is not None` in `select_mt5_server_clock`

**File:** `analytics-service/services/mt5_server_clock.py:280-281`
**Category:** necessity
**Issue:** The only producer of `rules` is `parse_mt5_server_time_rules`, which inserts only
64-character hex `str` keys (`mt5_server_clock.py:255-266`). So `None in rules` is always False,
and the explicit `None` check cannot change the result. The test that plants a `None` key
(`test_a_missing_server_hash_is_never_looked_up`, using a `type: ignore`) exercises a dict that
production cannot build. This is judgment rather than proof, because the function is public and
typed `Mapping[str, ...]`.
**Fix:** Optional. The guard costs nothing and documents intent. Leave it as is, or drop the
`sneaky` half of the test.

---

_Reviewed: 2026-11-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter pass (2026-11-18)

No CRITICAL, HIGH or MEDIUM findings. Recorded here only (LOW/INFO are never booked in TODOS.md, never fixed):

- SF-01 [LOW] The unmapped continuation's only live signal is the `unmapped_clock_mismatch` page plus the ERROR log; if Sentry and email delivery both fail the derive ends DONE and only the `mismatch` reading row remains. Worst case one lost night (the next derive pages again). Inside the Q2 acceptance.
- SF-02 [LOW] The hourly page window names only the first key; other keys on the same unmapped server show only in per-key ERROR log lines.
- SF-03 [LOW] The runbook validation one-liner prints `0` for an empty or unset `$CANDIDATE`, which is a valid empty map; the operator must compare the count with the intended number of entries.
- SF-04 [INFO] A well-formed but wrong hash is accepted and never matches; the runbook's post-deploy `match` check is the only catch.
- SF-05 [INFO] Days written after an unmapped mismatch carry no marker; the evidence is the reading row and the page (accepted in Q2).
- SF-06 [INFO] A malformed map or default config fault is log-only, then retries, then `failed_final` (the 175 / D-04 shape reused by Q1).
- SF-07 [INFO] `services/ops_alert.py` comment on the `mt5_server_clock` source still says "a server-clock mismatch refused a derive" (not in the diff).
