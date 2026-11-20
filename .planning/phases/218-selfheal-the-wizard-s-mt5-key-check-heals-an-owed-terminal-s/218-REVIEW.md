---
phase: 218-selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
reviewed: 2026-11-20T11:10:00Z
round: 3
depth: standard
files_reviewed: 3
files_reviewed_list:
  - analytics-service/routers/exchange.py
  - analytics-service/tests/test_mt5_validate.py
  - src/lib/wizardErrors.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
  necessity: 0
status: issues_found
---

# Phase 218: Code Review Report (round 3)

**Reviewed:** 2026-11-20T11:10:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found (Info only; nothing gates)

## Summary

Scope: the round-2 fix diff `git diff 12c157c7a..243770e3d -- . ':!.planning'` (commits `4cacdf8cb` CR-01 and `76dc83107` WR-01). I also read the router's inline clamp (`exchange.py:1238-1246`), the scrub guard (`mt5_terminal_scrub.py:510-516`), the `exchange_router` fixture, and `main.py`'s import order. `necessity-review.md` was not re-read in this round. No necessity findings were made.

Commands run at `243770e3d`:

- `npx vitest run src/lib/wizardErrors.test.ts`: **321 passed**, 0 failed. Round 2 had 1 failed.
- `cd analytics-service && python3 -m pytest -p no:cacheprovider -q tests/test_mt5_validate.py`: **123 passed, 1 skipped**.
- `python3 -m mypy routers/exchange.py`: no issues.
- `ruff check routers/exchange.py`: 2 F401 errors (`get_kek_version`, `db_execute`). Both are already present at `12c157c7a`, so the fix did not add them.

### Round-2 findings

| ID | Verdict | Evidence |
|---|---|---|
| CR-01 (D-07 census required the removed `report_scrub_owed_refusal` call) | **RESOLVED** | Arm 4 now checks only `scrubCall > -1 && scrubCall < raises[3]`. It also asserts `callAt(router, "report_scrub_owed_refusal") === -1`, so a second page coming back turns the test red. `callAt` anchors on `^[ \t]*name\(`, and the one remaining mention (the comment near `exchange.py:1238`) starts with `#`, so it does not match. The comment now gives the true reason. The file passes in full. |
| WR-01 (a clamp at or below 10 s refuses every owed validation as `abandoned`, with nothing naming the cause) | **RESOLVED** (see IN-10 and IN-11 for the remaining gaps) | `_check_inline_scrub_budget()` computes the router's clamp expression and logs one ERROR naming `MT5_VALIDATE_SCRUB_BUDGET_S`, `MT5_VALIDATE_DEADLINE_S` and `MT5_VALIDATE_PROBE_FLOOR_S` when the clamp is `<= _MIN_INLINE_SCRUB_WAIT_S`. Using `<=` is correct: at exactly 10.0 the scrub guard's `wait_timeout` is always a little under 10, so the guard fires. The parametrized test covers both 10.0 boundaries (floor 60, deadline 55) and a small budget (4). It also confirms the defaults log nothing, so switching to `<` would turn the test red. The fixer took a minimal third route instead of either fix in round 2. The per-request page still reads `abandoned`, but the misconfiguration is now named by env var at boot. |
| IN-07, IN-08, IN-09 | Unchanged (Info, not gating) | Recorded in the round-2 report. They stay here only, per the project rule. |

### Regression checks asked for in the brief

- **Import-time side effects.** The call at `exchange.py:254` only reads module constants and calls `logger.error`. It does no I/O and cannot raise on any float the `Final` parses accept. A non-finite env value can only make it log or stay silent. `configure_logging()` runs before the router import (`main.py`, the OPS-05 ordering gate), so the line goes through the redacting structlog chain. At the defaults the clamp is 30 and the check logs nothing. There is one limit, recorded as IN-10: the line is emitted before `init_sentry()`.
- **Test isolation.** The test calls the function directly after `monkeypatch.setattr` on the module attribute, and pytest undoes the patch. The function reads module globals at call time, so the patch takes effect. `caplog.records` covers only the call phase, so any import-time line logged during fixture setup cannot reach the "defaults are silent" assertion. No other test overrides the three env vars before importing the router (grep found only `setattr` on the module constants, at lines 1621 and 1820, and both run after import).
- **Private-constant import.** `routers/exchange.py` imports `_MIN_INLINE_SCRUB_WAIT_S`, which `mt5_terminal_scrub.py` does not list in `__all__`. That is a cross-module reach into a private name, but it keeps the startup check and the guard on one constant, so they cannot drift apart. That is better than copying the 10.0. mypy and ruff accept it. Not a finding.

## Info

### IN-10: The startup ERROR is emitted before Sentry is initialised, so it reaches only the process log

**File:** `analytics-service/routers/exchange.py:254`; `analytics-service/main.py:68` (`from routers import ... exchange ...`) and `main.py:97-99` (`init_sentry()`)
**Issue:** The router is imported at `main.py:68` and `init_sentry()` runs at `main.py:99`. So the import-time `logger.error` happens before Sentry's LoggingIntegration exists and never becomes a Sentry event. Sentry still gets one `abandoned` page per owed request, with the timing cause round 2 objected to. The only thing naming the misconfiguration is one line in the Railway boot log. This only applies to a non-default env, so it is Info.
**Fix (optional):** Call `exchange._check_inline_scrub_budget()` from `main.py` after `init_sentry()`, or fold the condition into the existing `alert_mt5_validation_timeout_chain_inverted` path, which already pages.

### IN-11: The clamp expression is written twice, and the import-time call is not pinned

**File:** `analytics-service/routers/exchange.py:233-241` and `:1238-1246`
**Issue:** `max(0.0, min(BUDGET, DEADLINE - RECORD - FLOOR))` appears in `_check_inline_scrub_budget` and again inline at the `pay_owed_validation_scrub_in_lease(..., budget_s=...)` call. If one copy is edited and the other is not, the startup check can stay silent on a clamp that really refuses. The test calls the function directly, so deleting the module-level `_check_inline_scrub_budget()` call at `:254` would leave the suite green.
**Fix (optional):** Extract a `_inline_scrub_budget_s()` helper and use it in both places.

### IN-12: `%.0f` can print a clamp under the minimum as equal to it

**File:** `analytics-service/routers/exchange.py:244-246`
**Issue:** A clamp of 9.6 prints as "clamps to 10s, at or below the 10s minimum". The message is still true, but the operator is not told the real value.
**Fix (optional):** Use `%.1f`.

---

_Reviewed: 2026-11-20T11:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
