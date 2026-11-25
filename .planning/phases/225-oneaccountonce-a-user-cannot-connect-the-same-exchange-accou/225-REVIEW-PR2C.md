---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-25T14:20:51Z
round: 1
depth: standard
# Scope: PR-2c (plan 18), `git diff 5ef1cff15..HEAD -- . ':!.planning'` at 7d378684a.
# Cross-file traces done where a finding needed them: both run_probe callers, the
# park/scrub `finally` blocks on both paths, long_fetch resync, classify_exception,
# and the three poll-path login brackets.
files_reviewed: 11
files_reviewed_list:
  - analytics-service/services/mt5_client.py
  - analytics-service/services/mt5_probe.py
  - analytics-service/tests/test_ingestion_mt5.py
  - analytics-service/tests/test_long_fetch.py
  - analytics-service/tests/test_mt5_client_contract.py
  - analytics-service/tests/test_mt5_validate.py
  - analytics-service/tests/test_mt5_validate_parity.py
  - analytics-service/tests/test_mt5_validation_park.py
  - analytics-service/tests/test_validate_key_permanent_400.py
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/strategies/create-with-key/route.test.ts
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
  necessity: 0
status: issues_found
---

# Phase 225: Code Review Report, PR-2c (plan 18)

**Reviewed:** 2026-11-25T14:20:51Z
**Scope:** PR-2c, `git diff 5ef1cff15..HEAD -- . ':!.planning'`, 11 files, no migrations, no route source changes
**Depth:** standard, with cross-file traces of every `run_probe` caller and the poll brackets
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Read against `225-18-PLAN.md`, `225-CONTEXT.md` Q6 (founder ruling 2026-11-25) and the MT5 Python
docs (`mt5login_py`, `mt5accountinfo_py`, `mt5initialize_py`, fetched 2026-11-25).
`$HOME/.claude/gsd-core/references/necessity-review.md` was read and applied. The server bracket
checks data that comes from another process (the terminal), which is a trust boundary, so it is not
a necessity finding.

The bracket itself is correct and the tests catch its removal. There is no CRITICAL or HIGH finding.
Two MEDIUMs:

- **WR-01** (latent, data integrity): the poll paths keep a login-only bracket. The PR's own premise
  is that `login()` returning success does not prove the server, and on the polls that premise is
  not answered.
- **WR-02** (non-user-facing, operability): when the server bracket fires, the wizard path logs and
  pages it as a "concurrent validate" login mismatch. Nobody can tell it fired, and the Task 3
  revert gate depends on telling exactly that.

### Verified clean (cited, not assumed)

- **The docs match the code's assumptions.** `mt5login_py` reads: `server="SERVER" // server name as
  it is specified in the terminal`, "If no server is set, the last used server is applied
  automatically", and returns True "in case of a successful connection to the trade account". On an
  already-connected terminal the page is silent. `mt5accountinfo_py` returns a namedtuple carrying
  `server` (example `server=MetaQuotes-Demo`), or None on error. `mt5initialize_py` is silent on an
  already-connected terminal. The docstrings in `mt5_probe.py:308-335` and `mt5_client.py:1068-1090`
  quote these accurately and claim nothing more.
- **`server` reaches the dict the bracket reads.** `Mt5Client.account_info` (`mt5_client.py:3090-3098`)
  materializes every namedtuple field through `_materialize` / `_coerce` (`:1320-1326`), so
  `info["server"]` is a `str` whenever the terminal reports one. `Mt5Client.login` passes
  `server=server` to `mt5.login` (`:2873-2878`), and the new contract test
  `test_login_passes_the_requested_server_to_mt5` pins it.
- **Both sides are normalised the same way.** The requested server is `parse_mt5_credentials`'s
  `.strip()` of the passphrase (`mt5_validation.py:187`). Both sides go through
  `normalise_mt5_server` (`strip().casefold()`, `mt5_probe.py:686-689`), the same normaliser the
  known-server pre-check uses. The TS store writes `toLowerCase` of the Python-stripped value
  (`venue-identity.ts:59-83`). Casefold of the lowercase form equals casefold of the original for
  every server name on the curated list, and the bracket never reads the stored copy anyway.
- **Disposition on both callers.** Router `exchange.py:984-1000`: `except Mt5AccountMismatchError`
  sits ahead of `except Mt5ClientError`. It catches the subclass, answers 424 NETWORK_UNAVAILABLE
  with `recoverable=True`, and sets `probe_disqualified`, so there is no park. Adapter
  `ingestion/mt5.py:407-414` propagates it untouched. `Mt5ServerMismatchError` is not an
  `Mt5ClientError`, so no classify arm can turn it into `auth` or `wrong_server`.
- **No wedge and no unbounded retry.**
  - The router answers once per request. The scrub is scheduled on every post-login exit in both
    `finally` blocks (`exchange.py` around `:1560-1590`; `ingestion/mt5.py` `schedule_validation_terminal_scrub`
    after the park block). So the session the skipped park leaves behind does not outlive the scrub.
  - On the worker, `long_fetch.py:463` calls `adapter.validate` with no `try`. The exception reaches
    `job_worker.classify_exception` and lands on the `("unknown", str(exc))` catch-all, which is
    retried.
  - `compute_jobs.max_attempts` defaults to 3 (`20260411144407_compute_jobs_queue.sql:122`), so a
    deterministic mismatch ends `failed_final` after 3 serialized logins. The fixed message carries
    no server.
  - The park alert is rate-limited per cause (`mt5_probe.py:575-610`).
- **Secret hygiene.** The new type carries only the login int. Its fixed message is asserted free of
  both server labels in `test_ingestion_mt5.py`. No new log line names a server.
- **The tests can fail.** I patched in-memory mutations through a scratch pytest plugin (no source
  edit) and ran them over `test_mt5_validate.py`, `test_ingestion_mt5.py`,
  `test_mt5_validate_parity.py`, `test_mt5_validation_park.py` and
  `test_validate_key_venue_transient.py`:

  | mutation | result |
  |---|---|
  | bracket a no-op | 11 red |
  | raw equality instead of the normaliser | 1 red (case (c)) |
  | absent or blank server accepted | 7 red |
  | raises a plain `RuntimeError` | 11 red |
  | PRE site (`:448`) skipped | 6 red |
  | probe-path POST site (`:503`) skipped | 1 red |
  | short-circuit POST site (`:498`) skipped | **0 red**, see IN-01 |

  Touched suites: 663 passed. `mypy --strict` is clean on both changed services. The 13 `225-18` TS
  cases pass.
- **TS store paths.** In `src/app/api`, `venue_server` is written only by the two connect routes.
  Both call `validateKey(exchange, api_key, api_secret, passphrase, …)` (`validate-and-encrypt/route.ts:620`,
  `create-with-key/route.ts:1615`) before any write. The new tests pin call order and the stored
  normalised value against literal oracles (`SERVER_NORMALISED = "metaquotes-demo"`, `"broker-live"`).
  These are literals, not the normaliser's own output.

## Warnings

### WR-01 (MEDIUM, latent, data integrity): the poll paths still prove only the login, so under this PR's own premise a poll can read another broker's account that has the same login number

**Files:** `analytics-service/services/mt5_read.py:276-293` and `:347-348`;
`analytics-service/services/job_worker.py:845-854`; `analytics-service/services/allocator_positions.py:961-977`
(context: `analytics-service/services/mt5_probe.py:308-343`)

**Issue:** The PR exists because `login(login, pw, server)` returning True "does not prove which
server the terminal ended up on" (`mt5_probe.py:313-315`). The three poll reads do the same thing:

```python
session.client.login(session.login, session.investor_password, session.server)
info = session.client.account_info()
assert_expected_login(info, login=session.login)   # login only
```

They then read deals, equity or balances and stamp them on the key. If the premise holds, a poll for
key A (login L on server S_A) can run on a terminal still holding login L on server S_B. Both
brackets pass, and B's numbers are read and stamped as A's.

This is reachable before migration B. The login-only index is per owner, so two owners at different
brokers can already hold the same login number. Q6 item 1 then admits it for one owner as well.

The plan scopes the polls out: "log in with the server already stored. The connect gate is where a
wrong server would enter". That reasoning covers what gets stored. It does not cover which account a
login-only bracket proves when one login number exists at two brokers. That is the case Q6 item 1
makes legitimate, and it is the read-side twin of T-225-58.

**Fix:** Call the same bracket beside each poll bracket. `session.server` is already the stripped
passphrase (`job_worker.py:1750`, `parse_mt5_credentials`). Each site already disposes of
`Mt5AccountMismatchError` as no-stamp, no-persist and transient (for example
`job_worker.py:7985-8000`), and the subclass inherits that:

```python
info = session.client.account_info()
assert_expected_login(info, login=session.login)
assert_expected_server(info, login=session.login, server=session.server)
```

Do the same at the POST bracket in `mt5_read.py:348`, and in the two local closures in
`job_worker.py:853` and `allocator_positions.py:968`. Every existing MT5 key would meet this on its
next poll, and its spelling is unmeasured (see IN-03). So either land a log-only verdict first
(`session_server_matches`, as `session_snapshot` already does), or book this explicitly as a PR-3
prerequisite with an owner. Do not leave it unrecorded.

### WR-02 (MEDIUM, non-user-facing, operability): a server-bracket refusal is logged and paged as a "concurrent validate" login mismatch, so nobody can see that the bracket fired, including Task 3's revert gate

**Files:** `analytics-service/routers/exchange.py:984-1000`; `analytics-service/services/mt5_probe.py:836-840`
(the `probe_account_mismatch` park cause); `analytics-service/services/mt5_client.py:1092-1102`

**Issue:** The subclass reuses the parent's arm unchanged. So on the wizard path a server mismatch
produces:

- the fixed WARNING "MT5 terminal account mismatch mid-probe (concurrent validate)";
- `trace.outcome = "transient"`;
- a park-skip ERROR plus a Sentry capture with cause `probe_account_mismatch`, whose text says a
  master-password session may remain.

None of these names the server bracket, and the exception class is not logged. A user sees the same
424 NETWORK_UNAVAILABLE that a timeout, a lease fence or a network blip produces.

Two consequences:

1. **Task 3 step 4 cannot be read.** Its revert trigger is "a transient answer here means the bracket
   refuses correct sessions". A transient answer is also every other transient arm, and the logs
   cannot separate them. The founder would either revert on a blip or keep a bracket that is
   refusing correct sessions.
2. **False refusals in PROD would be invisible.** If the bracket wrongly refused other users'
   correct sessions after deploy (the unmeasured spelling risk in IN-03), operators would see it as
   a concurrency race.

On the worker path the fixed message reaches `compute_jobs.error_message`, so that path can be told
apart. The router path cannot.

**Fix:** Distinguish it, with no secret involved:

```python
except Mt5AccountMismatchError as exc:
    server_kind = isinstance(exc, Mt5ServerMismatchError)
    probe_disqualified = "probe_server_mismatch" if server_kind else "probe_account_mismatch"
    logger.warning(
        "validate_key: MT5 session %s — failing closed transient",
        "is on another broker server than requested" if server_kind
        else "account mismatch mid-probe (concurrent validate)",
    )
```

Add `"probe_server_mismatch"` to `_PARK_ALERT_CAUSES`. Mirror the cause in `ingestion/mt5.py:407-409`.
Have Task 3 step 4 read that log line (Railway, read-only) next to the founder's answer.

## Info (LOW / Info, brief, not for TODOS.md)

### IN-01: The short-circuit POST server bracket is unpinned

**File:** `analytics-service/services/mt5_probe.py:498`

Skipping only this call site leaves all 360 tests in the five suites green. The plan's Task 1 asks
for the bracket at all three sites. Impact is small, because the short-circuit already returns an
`undetermined` refusal and the bracket only changes which refusal. Add a test with an undetermined
terminal whose second `account_info` reports another server.

### IN-02: Normalisation is pinned by one router case, and no test pins "no park" for the subclass

**Files:** `analytics-service/tests/test_mt5_validate.py` (case (c)); `analytics-service/tests/test_mt5_validation_park.py:557`, `:1249`

The raw-equality mutation reds only case (c). The adapter has no case or whitespace positive test.
"No park" for a server mismatch rests on inheritance from the login-mismatch park tests. Test (a)
asserts neither the park skip nor its alert cause.

### IN-03: The terminal's spelling of non-house servers is unmeasured, and the bracket now applies to every MT5 resync

**Files:** `analytics-service/services/ingestion/long_fetch.py:400-421` (resync decrypts the stored
passphrase and validates through `run_probe`)

Task 3 step 1's `session_server_matches_env` evidence uses raw equality against the house server
only. The step 4 positive control proves one account on one server. The docs say the login server
is the name "as it is specified in the terminal", which supports exact equality, but whether
`account_info().server` can differ from an accepted login name is not measured: for example a
broker redirect or a renamed server. A divergence would refuse a correct connect as
NETWORK_UNAVAILABLE indefinitely. On resync it would end `failed_final` after 3 attempts. This is
recorded as unmeasured, not as a defect. WR-02's distinct log line is what would make it visible.

### IN-04: The transient answer tells a user with a deterministic wrong server to "try again"

**File:** `analytics-service/routers/exchange.py:984-1000`

This was a deliberate plan choice: the session fact cannot separate a stuck terminal from a wrong
input, so the user is not blamed. The cost is that the copy invites endless retries whenever the
mismatch is deterministic. Revisit with Task 3's measurement.

### IN-05: The three TS `it.each` refusal rows exercise one arm

**Files:** `src/app/api/keys/validate-and-encrypt/route.test.ts` (225-18 `it.each`); `src/app/api/strategies/create-with-key/route.test.ts` (the same)

Each row rejects `validateKey` with a bare `Error`. The real client throws a typed error for the
424, which these rows do not reproduce. "Nothing stored" holds for any rejection, because the await
comes before every write. So the rows cannot fail for a server-specific reason. They are kept as
pins of existing behaviour, as the plan allows.

### IN-06: Task 3 is still open, and PR-2c must not merge before steps 1 and 3b

**File:** `.planning/phases/225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou/225-18-PLAN.md` Task 3

The SUMMARY records Tasks 1-2 done and Task 3 pending. The relogin verdict counts and the 155.2
freeze check gate the merge. The pre-deploy founder attempt is recorded, not gating.

---

_Reviewed: 2026-11-25T14:20:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter, round 1 (2026-11-25)

No CRITICAL or HIGH. MEDIUM findings:

- **SF-M1:** a server that is permanently wrong is answered "transient, try again".
- **SF-M2:** a server mismatch is logged and paged as a concurrency mismatch. This is the same finding as WR-02.
- **SF-M3:** nothing has measured whether `account_info().server` matches the requested spelling for any broker. This is the same finding as IN-03.
- **SF-M4:** several tests cannot fail on the bracket, and some pin the transient answer.

## Orchestrator dispositions (2026-11-25)

| Finding | Disposition |
|---------|-------------|
| WR-02 / SF-M2 | Fixed in 5ab503a22. A server mismatch now has its own warning line, trace outcome `transient_server_mismatch` and park cause `probe_server_mismatch`. The user-facing answer is unchanged. |
| WR-01 / SF-M3 / IN-03 | Routed to new plan 20 (PR-2c0). It adds a log-only server verdict at the three poll sites and ships before PR-2c merges. Enforcement on the poll paths becomes a precondition in plan 19. |
| Task 3 step 1 | **FAILED** on 2026-11-25. The analytics service's Railway logs held 0 `session_server_matches_env=` verdicts. The search started 2026-11-18. Every relogin line retrievable, the oldest at 2026-11-25 11:37Z, was `already_authorized`. Per the plan, PR-2c does not merge yet. Plan 18 step 1 now reads plan 20's poll verdicts instead. |
| SF-M1, SF-M4 | Held until the plan 20 measurement. A permanent "wrong server" answer is right only if every measured verdict is True. Tightening the tests now would pin an answer that may change. |
| IN-01..IN-06 and the SF LOWs | Recorded only. |
