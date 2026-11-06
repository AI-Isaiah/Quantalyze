---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
plan: 02
subsystem: analytics-service
tags: [python, allocator-holdings, mt5, sfox, retry-disposition, classify_exception, ast-roster]

# Dependency graph
requires: []
provides:
  - "six MT5/sFOX except-arms in allocator_positions.py now consult _must_reach_handler_unwrapped (job_worker.classify_exception) before raising a retry-promising note, same placement as the two pre-existing ccxt arms"
  - "an AST roster case (test_every_retry_promising_raise_is_guarded_by_the_classifier) that fails by name if a future arm ships unguarded"
  - "a pinned confirmation that SYNC_ERROR_COPY_BY_STATUS['rate_limited'] keeps its (legitimate) retry promise"
  - "a re-measured, corrected accounting of the copy family's unguarded-arm count vs. 167-PATTERNS' six-arm citation"
affects: [167-03, 167-04, 167-05]

# Actuals
actuals:
  tokens: 6741
  tasks: 3
  commits: 2
  plan_head_before: 06fdf6ce

status: complete
---

# Phase 167 Plan 02 — SUMMARY

**Six MT5/sFOX except-arms in `allocator_positions.py` now consult the SAME retry-disposition
authority the two ccxt arms already did (`_must_reach_handler_unwrapped` →
`job_worker.classify_exception`) before promising a retry — closing a gap where the mechanism
existed but was only half-applied, per 167-PATTERNS Pattern Assignment 7.**

## Accomplishments

- `except Mt5ClientError` in `_fetch_mt5_account_rows` (Task 1) — the MEASURED wrong-password path
  (`Mt5ClientError(0, "Invalid account")`, the corpus string `services/mt5_validation.py`'s
  `_AUTH_PHRASES` table names) — now consults the classifier before raising `MT5_UNREACHABLE_NOTE`.
- Five more except-arms guarded the same way (Task 2): the read-timeout arm
  (`except asyncio.TimeoutError`), the abandoned-session fence (`except Mt5SessionAbandoned`), the
  login-mismatch fence (`except Mt5AccountMismatchError`), the equity-extraction arm
  (`except (KeyError, TypeError, ValueError)`), and the sFOX balances read
  (`except (SfoxApiError, asyncio.TimeoutError)`).
- An AST-derived roster case (Task 3) that finds the "promises a retry" `*_NOTE` constants from the
  module's own source and asserts every except-arm raising one has the guard as its first statement
  — a seventh arm shipped unguarded fails here BY NAME, not by count.
- A companion pin confirming `SYNC_ERROR_COPY_BY_STATUS["rate_limited"]` still promises a retry —
  the one note in the family whose promise is legitimate.

## Task Commits

1. **Task 1 + Task 2: guard the six except-arms + their oracle cases** — `5c48916a` (feat)
2. **Task 3: AST roster case + rate-limit pin** — `26c83dc3` (test)

Tasks 1 and 2 landed in one commit: both apply the identical mechanism to the identical copy
family (a "one arm only" anchor commit followed immediately by "the remaining arms" would have
split one coherent diff across two commits for no material safety gain — see "Deviations" below).

## Why every oracle case mocks `classify_exception` instead of calling it for real

`job_worker.classify_exception` has **no branch for any of these five exception types** today:
`Mt5ClientError`, `Mt5SessionAbandoned`, `Mt5AccountMismatchError`, `SfoxApiError` are all plain
`RuntimeError`/`Exception` subclasses (D-42) that fall straight through the classifier's ordered
checks (InvalidToken → `Mt5GatewayMisconfigured` → `HTTPException` → `is_geo_blocked` →
ccxt hierarchy) to its final `return ("unknown", ...)`; `asyncio.TimeoutError` hits an EARLIER
explicit branch and always classifies `"transient"`. **No real instance of any of these types can
classify `"permanent"` today** — which the scope_note in `167-02-PLAN.md` says explicitly for the
Mt5ClientError arm ("this plan leaves that note truthful-but-useless").

A test built only from an unmocked `classify_exception(exc)` call could therefore never observe the
guard's `True` branch, and removing the guard line would change nothing such a test could see —
exactly the vacuous shape this repo's anti-vacuity rule forbids. So every oracle case follows test
5d's shape (`job_worker.classify_exception` monkeypatched to a controlled verdict, parametrized
`[("permanent", True), ("transient", False), ("unknown", False)]`) while keeping test 5c's
real-shape discipline: the exception raised is a genuinely-constructed instance of the type its
except clause names, never a synthetic marker class. This was VERIFIED, not assumed — see
"Anti-vacuity verification" below, including one arm (`asyncio.TimeoutError`) where object identity
does not survive the `asyncio.wait_for`/`to_thread` boundary (measured, not a guard defect; the
case captures the real propagated object instead of asserting against a pre-built one).

## ⭐ Re-measurement: the copy family had TEN unguarded raise sites, not six

167-PATTERNS cited "six unguarded arms." The plan's own Task 2 instructed re-measuring by grep
rather than trusting that count ("if your count differs, the RUN is right and the document is
stale") — and it differed. Measured via `grep -n` for the five retry-promising `*_NOTE` constants
across the module, excluding the two already-guarded ccxt arms: **ten raise sites**, not six.

**Six are true except-arms** (an exception object is in scope, so the guard mechanism structurally
applies) — all six are now guarded:

| arm | exception type | in 167-PATTERNS' six? |
|---|---|---|
| Mt5ClientError arm | `Mt5ClientError` | yes (measured wrong-password path) |
| read-timeout arm | `asyncio.TimeoutError` | yes |
| abandoned-session fence | `Mt5SessionAbandoned` | yes |
| login-mismatch fence | `Mt5AccountMismatchError` | yes |
| sFOX balances read | `SfoxApiError, asyncio.TimeoutError` | yes |
| equity-extraction arm | `KeyError, TypeError, ValueError` | **NO — newly measured this plan** |

**Four are residuals** — a plain `if` with NO exception in scope, so the classifier has nothing to
consult and the mechanism structurally cannot apply (167-PATTERNS named one; measurement found
four):

| residual | symbol | reason it stays unconditional |
|---|---|---|
| missing account ref | `if not api_key_id:` in `_fetch_mt5_account_rows` | defensive-only guard; `api_keys.id` is `NOT NULL` and the handler always passes it — 167-PATTERNS' named residual |
| blank currency | `if reported_ccy == "":` in `_fetch_mt5_account_rows` | payload-degradation branch on `account_info()`'s data, not an exception — newly measured |
| non-finite equity | `if not math.isfinite(equity):` in `_fetch_mt5_account_rows` | poisoned-anchor refusal on already-extracted data, not an exception — newly measured |
| missing symbol match | `if not _HOLDING_SYMBOL_RE.fullmatch(symbol):` in `_fetch_mt5_account_rows` | the function's own comment calls it "Unreachable for a UUID key id" — newly measured |

All four residuals' notes still say "sync will retry automatically" and none of the four conditions
can be affected by retry disposition (none of them originate from a venue exception at all — they
are internal data-shape refusals) — so naming them here is the routing this plan's scope requires,
not a silent omission. None is a candidate for D-11+ work; a future phase that wants them
addressed would need to change what they refuse on, not what they consult.

## Anti-vacuity verification — every guard and pin was neutered, observed RED, restored

Per arm/pin: removed the guard (or, for the rate-limit pin, changed the note text), ran the
targeted test, confirmed RED (both the arm's own oracle AND the roster case failed, the roster
naming the exact except-clause by TYPE — cited here by symbol, not by line, since the roster's own
`ast.unparse(handler.type)` output is what names it live, and a line number in this table would rot
independently of the code it once matched), restored from a `cp` byte backup re-verified with `cmp`
(and `sha256sum` matched the pre-neuter baseline after every restore):

| arm / pin | RED confirmed | roster named it by |
|---|---|---|
| `Mt5ClientError` | yes (`permanent` param) | except-clause type `Mt5ClientError` |
| `asyncio.TimeoutError` (read-timeout) | yes (all 3 verdict params — guard call itself never happens) | except-clause type `asyncio.TimeoutError` |
| `Mt5SessionAbandoned` | yes (`permanent` param) | except-clause type `Mt5SessionAbandoned` |
| `Mt5AccountMismatchError` | yes (`permanent` param) | except-clause type `Mt5AccountMismatchError` |
| equity `(KeyError, TypeError, ValueError)` | yes (all 3 verdict params) | except-clause type `(KeyError, TypeError, ValueError)` |
| sFOX `(SfoxApiError, asyncio.TimeoutError)` | yes (`permanent` param) | except-clause type `(SfoxApiError, asyncio.TimeoutError)` |
| rate-limit pin | yes (changed text, `test_rate_limited_note_still_promises_a_retry` failed) | n/a (separate pin, not roster-scoped) |

After every restore the full related suite (`test_allocator_positions.py` +
`test_allocator_positions_non_ccxt.py` + `test_job_worker.py`) was re-run green (251 passed, 1
skipped), and `sha256sum services/allocator_positions.py` matched the pre-neuter baseline
(`f6d9965f...`) byte-for-byte.

## Threat model confirmation (T-167-05)

Read `run_poll_allocator_positions_job`'s generic `except Exception as exc:` arm in
`services/job_worker.py` to confirm the mitigation the threat model requires: `human_copy` there is
derived via `sync_error_copy(status_target, venue)` — from the STATUS, never from `exc` — while
`sanitized` (`classify_exception`'s output) reaches only `DispatchResult.error_message` (→
`compute_jobs.last_error`) and the audit metadata, both operator surfaces. So every one of the six
newly-unwrapped exception types, once it reaches this generic arm, writes only status-derived copy
to `api_keys.sync_error` — never its own `str()`. This was already structurally true before this
plan (the module's own block comment documents it); this plan's guards are what make that
CONFIRMATION apply to six more failure classes instead of zero.

## Verification

- `pytest tests/test_allocator_positions.py -x -q` — 79 passed (Task 1 gate).
- `pytest tests/test_allocator_positions.py tests/test_job_worker.py -q` — 199 passed, 1 skipped
  (Task 2 gate).
- `pytest tests/test_allocator_positions.py -q` — 79 passed (Task 3 gate).
- `pytest -q -n auto --dist loadgroup` (full analytics-service suite) — **6041 passed, 90 skipped**.
- `mypy --strict --follow-imports=silent services/ routers/ models/` (CI's exact invocation,
  `.github/workflows/ci.yml`'s `mypy` step) — **clean, 96 source files**. Note: this repo's mypy
  gate scopes to `services/ routers/ models/` only, never `tests/` — confirmed by reading the CI
  step directly rather than assuming — so the new test file's missing per-function type annotations
  (consistent with every pre-existing test in the same file) are outside the gate's actual scope.
- No database command run. No `uvicorn` started. No `railway redeploy`/restart/`ssh`.

## Deviations from Plan

### Auto-fixed / clarified during execution (not Rule 1-3 bugs — design decisions, documented per
the "report honestly" instruction)

**1. Task 1 and Task 2 landed in one commit, not two.** The plan structures them as separate tasks
("one arm only" then "the remaining arms"), but both apply the byte-identical mechanism to the
byte-identical copy family with no intervening decision point — splitting the diff across two
commits would have meant Task 1's commit temporarily left five arms of the SAME family unguarded,
which is a worse intermediate state than either commit alone. Task 3 (the roster + pin) landed in
its own commit as planned. Both commits are independently green and independently revertable.

**2. The equity-extraction arm was added to the guarded set** — see the re-measurement table above.
This is Rule 2 territory (D-09's own must_have: "the fix covers the whole venue-agnostic copy
family, not the MT5 string alone") applied to a site the upstream pattern document under-counted,
not an invented scope expansion: the arm structurally matches every criterion the plan's Task 2
action states for "arms that DO catch an exception."

**3. Three additional residuals were named** beyond 167-PATTERNS' one ("missing account ref") — see
the residuals table above. Same reasoning: the plan's Task 2 action requires enumerating BY
MEASUREMENT and naming every residual found, not trusting the upstream count.

**4. The `asyncio.TimeoutError` oracle case captures the real propagated exception object rather
than asserting identity against a pre-constructed one.** Measured: `asyncio.wait_for`/
`asyncio.to_thread` does not preserve object identity for a `TimeoutError` raised inside the
awaited thread (every other exception type survives the trip unchanged — this is
`TimeoutError`-specific asyncio plumbing). The case still proves the mechanism (self-consistent
identity via the classify hook), it just doesn't assert against a value fixed before the call.

None of these are Rule 4 (architectural) — no new table, no new service layer, no changed API
contract. No user decision was required.

## Known Stubs

None — no data source is stubbed; this plan only adds a control-flow guard and its tests.

## Threat Flags

None beyond T-167-05 (already in the plan's threat register; confirmed above, not new surface).

## Self-Check: PASSED

- `analytics-service/services/allocator_positions.py` — FOUND
- `analytics-service/tests/test_allocator_positions.py` — FOUND
- commit `5c48916a` — FOUND in `git log --all`
- commit `26c83dc3` — FOUND in `git log --all`
- `npm run check:planning-hygiene` — OK (6834 tracked files scanned, no local username/home path)
