---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
plan: 01
subsystem: analytics-worker
tags: [mt5, concurrency, refactor, import-graph, aum-02]
requires:
  - services/mt5_client.py (MT5_REQUEST_TIMEOUT_S, Mt5Client)
provides:
  - services/mt5_concurrency.py — the SINGLE MT5 terminal-lock registry, importable from any leaf-safe consumer
  - _MT5_TERMINAL_LOCKS, _mt5_terminal_lock_for, _mt5_bounded_restart
  - _MT5_DERIVE_READ_TIMEOUT_S, _MT5_RESTART_TIMEOUT_S, _Mt5PostReadVerificationError
affects:
  - services/job_worker.py (re-imports the six symbols; all call sites byte-unchanged)
  - services/allocator_positions.py (plan 151-03 will import the registry from here)
tech-stack:
  added: []
  patterns:
    - "leaf-module extraction (closed_sets.py convention) to break an import cycle"
    - "registry idiom: module-level dict + setdefault lock factory (position_reconstruction.py:308-317)"
    - "object-identity oracle (`is`) for shared-singleton invariants"
key-files:
  created:
    - analytics-service/services/mt5_concurrency.py
    - analytics-service/tests/test_mt5_concurrency.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/mt5_client.py
    - .planning/phases/151-aum-a-book-you-can-reach-and-a-size-you-can-set/151-RESEARCH.md
decisions:
  - "Logger channel for the moved helper is `quantalyze.analytics.mt5_concurrency`, not job_worker's — the ONE observable delta, documented below"
  - "MT5_REQUEST_TIMEOUT_S imported from mt5_client at runtime rather than the derivation being re-hardcoded in the leaf"
  - "Removed job_worker's now-dead TYPE_CHECKING Mt5Client import (its only annotation moved out)"
metrics:
  duration: ~17 min
  completed: 2026-08-07
requirements: [AUM-02]
---

# Phase 151 Plan 01: MT5 Concurrency Leaf Extraction Summary

Extracted the MT5 terminal-serialization machinery out of `job_worker.py` into a new leaf module `services/mt5_concurrency.py`, so the lazily-imported holdings path can share the ONE lock registry instead of minting a second one that serializes nothing.

## What Was Built

`analytics-service/services/mt5_concurrency.py` (157 lines) now owns six symbols MOVED — not copied — from `job_worker.py`:

| Symbol | Kind |
|--------|------|
| `_MT5_TERMINAL_LOCKS` | the registry `dict[str, asyncio.Lock]` |
| `_mt5_terminal_lock_for` | setdefault lock factory |
| `_mt5_bounded_restart` | MT5CONC-01 bounded terminal restart |
| `_MT5_DERIVE_READ_TIMEOUT_S` | FLIPRETRY-01 read ceiling |
| `_MT5_RESTART_TIMEOUT_S` | MT5CONC-01 restart ceiling |
| `_Mt5PostReadVerificationError` | IN-01 transient POST-bracket error |

`job_worker.py` re-imports all six at top level, so every existing call site and every test monkeypatch target (`jw._MT5_TERMINAL_LOCKS`, `services.job_worker._mt5_terminal_lock_for`) binds the **identical objects**. The job_worker diff is **+14 / −118**, and every one of the 14 added lines is an import or a comment — zero logic added, derive-arm untouched.

The registry is now singular repo-wide: `grep -rn "dict\[str, asyncio.Lock\]"` returns the MT5 registry exactly once (the other three hits are the unrelated `match.py` force/recompute locks and `position_reconstruction._RECONSTRUCT_LOCKS`).

## Why It Matters

`allocator_positions.py` is imported **lazily** by the job_worker handler precisely to avoid an import cycle. It therefore could never have imported the registry from `job_worker`, and a local copy would have been a second `dict` — two distinct `Lock` objects per `terminal_key`, both job kinds entering the ONE shared Wine terminal's IPC region concurrently while every lock "worked" (ROADMAP binding trap / RESEARCH Pitfall 2). A leaf module is the root fix; plan 151-03 can now import it.

## Drift Handled (plan predates hotfix PR #667)

The plan enumerated the lock consumers as of before `e0493913`. Handled during execution:

1. **New consumer found and repointed.** `_fetch_mt5_account_balance` (job_worker `:413` pre-move, `:305` post-move) is a `sync_trades` balance-read arm added by #667 that uses `_mt5_terminal_lock_for` **and** `_MT5_DERIVE_READ_TIMEOUT_S`. It was not in the plan's consumer list. It is covered by the re-import and its two call sites are byte-unchanged.
2. **Line numbers shifted ~+72** after `:410`. Every anchor was located by symbol name via grep, never by the plan's line numbers.
3. **`tests/test_mt5_sync_path.py`** (new in #667, 7 wiring tests through the real handlers) runs green — included explicitly in the task-1 verification run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical work] Second stale pointer in `mt5_client.py`**
- **Found during:** Task 1
- **Issue:** The plan named only the `terminal_key` docstring (`:444`) as pointing at `job_worker._MT5_TERMINAL_LOCKS`. A second cross-reference at `:417` named "job_worker `_mt5_bounded_restart`" — the same stale-pointer defect class (PATTERNS Correction 5) for another symbol this plan moved.
- **Fix:** Repointed to ``mt5_concurrency._mt5_bounded_restart``.
- **Files modified:** `analytics-service/services/mt5_client.py`
- **Commit:** `a85a1100`

**2. [Rule 3 — blocking] Two now-dead imports in `job_worker.py`**
- **Found during:** Task 1
- **Issue:** After the move, `MT5_REQUEST_TIMEOUT_S as _MT5_REQUEST_TIMEOUT_S` (used only by the moved derivation) and the `TYPE_CHECKING` import of `Mt5Client` (used only by the moved `_mt5_bounded_restart` annotation) were both unused.
- **Fix:** Removed both; left a comment where the `Mt5Client` type-import was, noting that `_make_mt5_session` still imports the class lazily at runtime so the "module import does not require mt5linux" contract is intact. Verified no remaining `"Mt5Client"` annotation in the file.
- **Files modified:** `analytics-service/services/job_worker.py`
- **Commit:** `a85a1100`

**3. [Deviation — plan gate command was wrong] `mypy .` is not this project's gate**
- **Found during:** Task 2
- **Issue:** The plan's acceptance criterion was `cd analytics-service && mypy .`, which type-checks `tests/` too and reports **5565 pre-existing errors in 194 files** — it has never been the gate and could not pass.
- **Fix:** Ran the real CI gate from `.github/workflows/ci.yml:1189`: `mypy --strict --follow-imports=silent services/ routers/ models/` → **Success, 90 source files**. That count reconciles exactly with the historically recorded 89 plus this plan's one new module.
- **Not a code change** — recorded so the next plan does not re-derive the wrong command.

### Documented Behavior Delta (deliberate, single)

The moved `_mt5_bounded_restart` now logs on `quantalyze.analytics.mt5_concurrency` instead of `quantalyze.analytics.job_worker`. Its warning **text is byte-identical**, and both channels sit under the same `quantalyze.analytics` parent, so handler config is unaffected. Verified first that no test asserts on that record's logger name (the four files that filter on `quantalyze.analytics.job_worker` assert on unrelated warnings) and that no `dictConfig`/`basicConfig` enumerates logger names. The dedicated name matches the repo convention (`quantalyze.analytics.<module>`, used by 12+ service modules). Flagged here because an ops log filter pinned to the exact `.job_worker` channel would no longer see this one warning.

## Falsifier Observed (not merely asserted)

Re-declared `_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock] = {}` in `job_worker.py` and ran the new suite:

```
FAILED tests/test_mt5_concurrency.py::test_registry_object_is_shared_across_modules
E       assert {} is {}
1 failed, 3 passed
```

That output is the point: **two empty dicts**. An `==` oracle would have shipped green under the exact defect the test exists to catch, which is why the oracle is `is` (RESEARCH Pitfall 2 — "assert object identity, not merely that a lock was acquired"). Mutation reverted via `git checkout -- <single file>`; `grep -rn MUTANT` → 0; tree clean.

## Verification

| Gate | Result |
|------|--------|
| Cross-module identity of all 6 symbols | PASS |
| `pytest tests/test_mt5_concurrency.py -q` | 4 passed |
| `pytest tests/test_mt5_derive_branch.py tests/test_mt5_sync_path.py tests/test_mt5_client_contract.py -q` | 73 passed |
| **Full `pytest -q` from `analytics-service/`** | **4897 passed, 96 skipped, 0 failed** |
| **`mypy --strict --follow-imports=silent services/ routers/ models/`** | **Success, 90 source files** |
| New `# type: ignore` in plan diff | 0 |
| `grep -rn MUTANT` | 0 |

Task 1 grep acceptance criteria, all as specified:

| Criterion | Want | Got |
|-----------|------|-----|
| `dict[str, asyncio.Lock]` in job_worker | 0 | 0 |
| `from services.mt5_concurrency import` in job_worker | 1 | 1 |
| `job_worker._MT5_TERMINAL_LOCKS` in mt5_client | 0 | 0 |
| `mt5_concurrency._MT5_TERMINAL_LOCKS` in mt5_client | 1 | 1 |
| job_worker imports in the leaf | 0 | 0 |
| `MT5CONC-02` in the leaf | ≥1 | 2 |
| RESEARCH row names `mt5_concurrency` | 1 | 1 |
| RESEARCH stale `job_worker.py` registry pointer | 0 | 0 |

Artifact minimums: `mt5_concurrency.py` 157 lines (min 60), `test_mt5_concurrency.py` 158 lines (min 40).

## Known Stubs

None. No placeholder values, no unwired data paths — this plan moves existing, exercised code.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change. T-151-01 (registry tampering) is mitigated as planned: the single registry MOVED and is pinned by an `is`-identity test whose falsifier was observed. T-151-02 (event-loop DoS) is preserved: the bounded-restart and `wait_for` machinery moved verbatim and the derive-arm suite is green. T-151-SC: zero package installs.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `a85a1100` | `refactor(151-01)`: extract the registry into the leaf; repoint stale pointers |
| 2 | `adcea6af` | `test(151-01)`: pin the ONE registry by object identity |

## Self-Check: PASSED

All three created files exist on disk; all three commits (`a85a1100`, `adcea6af`, `ce3ba0a8`) present in `git log`; working tree clean.

## Notes for Plan 151-03

Import the registry as `from services.mt5_concurrency import _mt5_terminal_lock_for` inside `allocator_positions.py`. Do **not** re-declare a terminal-lock dict there — `test_registry_object_is_shared_across_modules` only pins job_worker↔leaf identity, so a third registry in `allocator_positions` would not be caught by it. Consider extending that test with an `allocator_positions` arm when 151-03 lands.
