---
phase: 118-sfox-research-adapter-contract
plan: 02
subsystem: api
tags: [sfox, live-smoke, skipif, founder-gated, sc-3, aiohttp, sandbox]

# Dependency graph
requires:
  - phase: 118-sfox-research-adapter-contract
    provides: "118-01 SfoxClient adapter (SFOX_SANDBOX_BASE_URL, get_balances, get_balance_history, aclose, SfoxApiError)"
provides:
  - "test_sfox_client_live.py — the SC-3 empirical gate: a founder-credential-gated live smoke test that authenticates against api.staging.sfox.com and asserts get_balances()/get_balance_history() return real list payloads; skips loudly with NO mock/fallback path so it can never fake a pass"
  - "Phase-118 composed-state verification: full analytics-service suite green with the sFOX files present, EXCHANGE_CLASSES still ccxt-only, SfoxClient write-surface-free"
affects: [119-key-routes-db-widen, 120-equity-reconstruction, 121-static-ip-proxy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Founder-credential-gated live smoke test: module-level pytest.mark.skipif with a verbose Rule-12 reason; a skip is explicitly NOT a pass and leaves SC-3 human_needed"
    - "Live-credential test file contains ZERO mocking/fixture-stub/fallback — a real network request or a skip, nothing in between (anti-fake-green)"
    - "Assertion messages carry only payload type/length, never contents or the key — output may be pasted into phase evidence"

key-files:
  created:
    - analytics-service/tests/test_sfox_client_live.py
  modified: []

key-decisions:
  - "Standardized the canonical env var on SFOX_SANDBOX_KEY (RESEARCH sketched SFOX_SANDBOX_API_KEY); documented the single name in the module docstring for the founder runbook"
  - "An EMPTY balances list is a PASS — the SC-3 bar is auth + real payload, not non-empty data (RESEARCH Open Question 3: a fresh sandbox account may hold nothing)"
  - "Added the optional get_balance_history smoke as a second skipIf-gated test (A1 historical-depth probe) without weakening the primary balances assertion"
  - "Task 2 is verification-only: check 4 exposed no defect in Task 1's gate, so no file was modified/committed for Task 2"

requirements-completed: []  # SFOX-01 closed by 118-01; SC-3 remains human_needed

# Metrics
duration: ~10min
completed: 2026-07-18
---

# Phase 118 Plan 02: SC-3 founder-gated live sandbox smoke + phase-close regression sweep Summary

**A founder-credential-gated live smoke test (`test_sfox_client_live.py`) that, given `SFOX_SANDBOX_KEY`, performs a real Bearer-authed read against `api.staging.sfox.com` and asserts `get_balances()`/`get_balance_history()` return real list payloads — and skips loudly (never fake-passes) without the credential, keeping CI green while SC-3 stays `human_needed`.**

## SC-3 Status: human_needed

SC-3 (auth succeeds + ≥1 read endpoint returns a real payload vs `api.staging.sfox.com`) is **human_needed**. The empirical gate is committed and honest but the live green is founder-credential-gated.

**Founder runbook to flip SC-3 → green:**
1. Mint a sandbox API key at `beta.sfox.com` (separate from prod keys).
2. Ask `support@sfox.com` to fund/enable the sandbox account if needed.
3. `export SFOX_SANDBOX_KEY=<sandbox key>`
4. `cd analytics-service && python -m pytest tests/test_sfox_client_live.py -q`

Expect: auth 200 + a (possibly empty) list from `get_balances()` and a list from `get_balance_history()`. A raised `SfoxApiError` (e.g. 401) is a FAIL — it propagates, never caught-and-passed.

## Performance
- **Duration:** ~10 min
- **Tasks:** 2 (Task 1 wrote + committed the live test; Task 2 was verification-only)
- **Files created:** 1 (`tests/test_sfox_client_live.py`)

## Accomplishments
- Committed the SC-3 empirical gate: 2 async smoke tests, module-level `pytest.mark.skipif(not SFOX_SANDBOX_KEY)` with a verbose Rule-12 reason that states a skip is NOT a pass.
- Zero mocking / zero network-stub fixture / zero fallback path in the file — a real request or a skip, nothing between (T-118-06 anti-fake-green).
- Standardized on `SFOX_SANDBOX_KEY` and documented it as the single canonical name in the module docstring (RESEARCH had sketched `SFOX_SANDBOX_API_KEY`).
- Secret-safe by construction: the key lives only as an env var; assertion messages carry only payload type/length (T-118-05 / T-118-07).
- Verified the fully-composed phase-118 state (P115 lesson: verify the composed state, not each task in isolation).

## Task Commits
1. **Task 1: SC-3 founder-gated live sandbox smoke test** — `b5eddfe5` (`test(118-02)`)
2. **Task 2: phase-gate regression sweep** — verification-only; no defect found, so no commit (per plan: "modifies test_sfox_client_live.py only if check 4 exposes a defect").

_Note: `.planning/**` is gitignored/local in this repo — no metadata commit; SUMMARY/STATE/ROADMAP are written to disk only._

## Task 2 — Composed-State Regression Sweep (verbatim outcomes)

**Check 1 — Full analytics-service suite** (`cd analytics-service && python -m pytest -q`):
`3825 passed, 95 skipped, 1045 warnings in 39.90s` → **exit 0**. The live sFOX smoke is among the skips; unit contract suite (25 tests from 118-01) green. Only pre-existing `RuntimeWarning`/`DeprecationWarning` noise (unawaited-coroutine warnings in `test_job_worker.py`, numpy divide, supabase timeout/verify deprecations) — none introduced by this phase, none a failure.

**Check 2 — EXCHANGE_CLASSES purity** (`sed -n '/^EXCHANGE_CLASSES/,/^}/p' services/exchange.py | grep sfox`):
**exit 1** (no match). The ccxt-typed dict is still `binance`/`okx`/`bybit`/`deribit` only — sFOX never entered it (SFOX-01 locked decision).

**Check 3 — Read-only surface** (`grep -E '^\s*(async )?def (create_order|place_order|cancel_order|withdraw|transfer)' services/sfox_client.py`):
**exit 1** (no match). No order/withdraw/transfer write-surface on `SfoxClient`.

**Check 4 — Skip honesty** (`python -m pytest tests/test_sfox_client_live.py -q -rs`):
`2 skipped in 0.07s`, both reported `SKIPPED ... FOUNDER-GATED SC-3 smoke: SFOX_SANDBOX_KEY unset. Mint a sandbox key at beta.sfox.com ... a skip is NOT a pass.` → CI-green does not mean SC-3-green. No defect exposed in Task 1's gate.

**exchange.py unmodified:** `git status --short services/exchange.py` → empty (untouched this phase, as required).

## Deviations from Plan
None — plan executed exactly as written. Task 2 correctly performed no file modification (no defect surfaced by check 4).

## Note on the coverage gate
There is no `--cov-fail-under`/`addopts` in the repo's `pytest.ini`/`setup.cfg`/`pyproject.toml`/`tox.ini`; the `--cov-fail-under=80` gate referenced in CLAUDE.md is applied via the CI invocation, not the local config. The plan's Task-2 check 1 (`python -m pytest -q` → exit 0) is satisfied; the CI coverage gate is unchanged by this test-only addition and is out of scope for a local sweep.

## Known Stubs
None. The live test is a real-request-or-skip gate by construction; the skip is an intentional, loud, documented founder gate (not a stub).

## Threat Model Coverage
- **T-118-05 (info disclosure — key in test output):** key is env-only; never printed/asserted; assertion messages carry only payload type/length.
- **T-118-06 (repudiation — fake green):** verbose Rule-12 skip reason; no mocking/fallback path; `SfoxApiError` propagates as FAIL; this SUMMARY records SC-3 human_needed explicitly.
- **T-118-07 (info disclosure — committing the credential):** key exists only as env var; the committed file contains no credential (mirrors deribit_ground_truth runbook).
- **T-118-SC (supply chain):** zero new packages this phase.

## Next Phase Readiness
- SC-1 (RESEARCH GO verdict) and SC-2 (adapter contract, 118-01) are done; SC-3 is human_needed pending the founder's sandbox-key run.
- Phase 119 can build the `is_sfox` ingestion-boundary dispatch seam + key-route/DB-constraint widening; the live smoke provides the founder-runnable auth proof once the sandbox key is minted.

---
*Phase: 118-sfox-research-adapter-contract*
*Completed: 2026-07-18*

## Self-Check: PASSED
- `analytics-service/tests/test_sfox_client_live.py` present on disk.
- Task 1 commit `b5eddfe5` present in git history.
- Live file skips 2/2 with verbose founder-gated reason (exit 0); EXCHANGE_CLASSES + write-surface grep gates exit 1; full suite 3825 passed / 95 skipped; exchange.py untouched.
