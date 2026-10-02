---
phase: 67-deribit-live-harness-exchange-ground-truth
plan: 01
subsystem: analytics-service
tags: [deribit, ground-truth, harness, ccxt, secrets, evidence, drb-01]
requires:
  - services/exchange.py::create_exchange / aclose_exchange
  - services/redact.py::scrub_freeform_string / truncate_account_id
  - services/geo_block.py::is_geo_blocked
provides:
  - scripts/deribit_ground_truth.py (DRB-01 harness: scope gate, per-currency
    paginated trades + txn-log capture, instrument classification, sanitized JSON)
  - docs/deribit-ground-truth.md (tracked answers template for Phases 68/70)
  - assert_sanitized (reused by Plans 67-03/67-04 to verify real artifacts pre-commit)
affects:
  - Phase 68 (DRB-02) designs against the recorded scope string
  - Phase 70 (DRB-04..07) designs against funding-netting shape + instrument mix
tech-stack:
  added: []
  patterns:
    - probe_exchange_egress.py one-off script idiom (WHY/USAGE/RUNBOOK docstring,
      main() -> int exit-code contract, python -m scripts.X)
    - lazy ccxt/services.exchange import to keep the pure-logic layer I/O-free
    - reuse services.redact masking (never reimplement)
key-files:
  created:
    - analytics-service/scripts/deribit_ground_truth.py
    - analytics-service/tests/test_deribit_ground_truth.py
    - analytics-service/docs/deribit-ground-truth.md
    - analytics-service/docs/evidence/.gitkeep
  modified: []
decisions:
  - Pagination advances to the last trade's timestamp (inclusive) with trade_id
    dedup rather than last_ts+1, prioritising completeness over overlap avoidance
    (Phase 70 verifies exact counts against 18,778 / 21,014 / 61,248).
  - Deny-key sanitization REMOVES secret/token/api_key/password entries entirely;
    mask-keys (username/user_id/email/system_name/id) truncate to ***<last4>.
  - assert_sanitized is a reusable pre-commit gate (email-shape + 40+char opaque
    token detection) for Plans 67-03/67-04 real artifacts.
metrics:
  duration: 28m
  completed: "2026-07-04"
  tasks: 3
  files: 4
---

# Phase 67 Plan 01: Deribit Ground-Truth Harness Summary

DRB-01 offline harness — a committed one-off `scripts/deribit_ground_truth.py` that
authenticates a read-only Deribit LTP key, fail-loud rejects any write scope BEFORE
fetching, captures fully-paginated per-currency trades + transaction-log rows
(whitelisted fields only), classifies the instrument mix, and prints a
sanitized-by-construction JSON evidence object — plus its pure-logic unit tests and
a tracked answers-doc template that Phases 68/70 design against.

## What Was Built

- **`scripts/deribit_ground_truth.py`** (two layers in one module):
  - *Pure-logic layer* (Task 1, TDD): `scope_is_read_only`, `summarize_txn_log`,
    `classify_instrument`, `sanitize_evidence`, `assert_sanitized`. Stdlib +
    `services.redact` only — no ccxt/network import at module load, so the unit
    tests stay I/O-free (verified: `'ccxt' in sys.modules` is False after import).
  - *Async I/O layer* (Task 2): `run()` (read-only scope gate via `public_get_auth`
    BEFORE any private call → `ScopeViolationError` → exit 2; currency enumeration
    from the account; `_paginate_trades` following `has_more`; `_paginate_txn_log`
    following `continuation`; subaccount count-only observation; geo-block
    observation with no fabricated marker) and `main()` (argparse, exit codes
    0/1/2/3, `assert_sanitized` before `json.dumps` stdout). ccxt/services.exchange
    imported lazily inside `run()`.
- **`tests/test_deribit_ground_truth.py`** — 20 pure-fn tests across 5 groups; each
  docstring encodes WHY the gate matters (Rule 9): funding-evidence integrity,
  key-scope safety, secret-leak prevention.
- **`docs/deribit-ground-truth.md`** — tracked answers template: 3 mandated answer
  H2 sections (funding-netting shape, instrument mix, geo-block marker) each with
  Answer/Evidence/`PENDING LIVE RUN` placeholders, plus bonus (subaccounts +
  per-currency counts) and run-metadata sections.
- **`docs/evidence/.gitkeep`** — tracked evidence dir (populated in Plan 67-03).

## Verification Evidence

| Check | Result |
|-------|--------|
| `pytest tests/test_deribit_ground_truth.py -q` | 20 passed |
| `run` is coroutine + `main.__annotations__['return'] is int` | OK |
| Module import does NOT pull in ccxt | confirmed (`'ccxt' in sys.modules` False) |
| `mypy --strict --follow-imports=silent scripts/deribit_ground_truth.py` | Success: no issues |
| env-less `python -m scripts.deribit_ground_truth` | exit code 3 (no values printed) |
| Scope gate (`public_get_auth` L452) precedes all private calls in run() flow (raise at L463) | confirmed |
| `has_more` + `continuation` present in script | 3 + 6 occurrences |
| `grep -c "from services.redact import"` | 1 (masking reused, not reimplemented) |
| `git check-ignore` docs paths | exit 1 (tracked, not ignored) |
| docs: H2 sections / `PENDING LIVE RUN` / "Funding-netting shape" | 5 / 9 / present |
| `pytest test_deribit_ground_truth.py + test_reconciliation.py` | 29 passed (no import breakage) |

## Threat Model Coverage

- **T-67-01 (Info Disclosure — evidence/stdout):** `sanitize_evidence` +
  `assert_sanitized` run BEFORE print (in `main()`, not optional); deny-keys removed,
  ids masked via `truncate_account_id`, every string scrubbed via
  `scrub_freeform_string`; unit-tested.
- **T-67-02 (EoP — key scope):** `scope_is_read_only` gate on `public_get_auth`
  result, raises `ScopeViolationError` → exit 2 with zero subsequent private calls;
  unit test proves `:read_write` / `:read_trade` rejection.
- **T-67-03 (Info Disclosure — secrets in repo):** creds env-only (exit 3 if absent,
  values never printed); docs/evidence committed only via `assert_sanitized`-verified
  artifacts.
- **T-67-04 (Tampering — untrusted responses):** whitelisted-field capture only;
  `classify_instrument` never raises on junk; JSON-only handling.
- **T-67-05 (DoS — unbounded pagination):** `--max-pages` cap (default 500) with
  recorded `max_pages_hit` flag on both trades and txn-log.
- **T-67-SC:** zero dependencies added by this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Dev test/type tooling not installed in the local venv**
- **Found during:** Task 1 (RED run) — `.venv` had only production deps (`ccxt`),
  no `pytest`/`mypy`.
- **Fix:** Installed the legitimate pinned dev tooling directly
  (`pytest pytest-cov pytest-asyncio pytest-mock mypy==2.1.0`). This is a local
  environment setup, not a package substitution — every package is exactly what
  `requirements-dev.txt` already pins (no slopsquat risk; excluded-install rule
  N/A because these are the project's own declared dev deps, not a plan-referenced
  new package).
- **Files modified:** none (venv only; not committed).

**2. [Rule 3 — Blocking] `requirements-dev.txt` full install fails on this venv**
- **Issue:** `pip install -r requirements-dev.txt` fails building `pyarrow==18.1.0`
  (no cp314 wheel; source build fails). Installed the tooling subset instead;
  later installed `pyarrow>=18` (24.0.0, which has a cp314 wheel) to attempt the
  full-suite gate.
- **Files modified:** none (venv only).

## Deferred Issues

**Full-suite coverage gate (Task 3 verify) cannot run in this local Python 3.14 venv
— native pandas segfault at collection.**
- The venv is Python 3.14 with `numpy 2.4.6`, but `pandas==2.2.3` is pinned for
  `numpy==2.2.4`; `numpy 2.2.4` has no cp314 wheel, so the pinned scientific-stack
  ABI cannot be reproduced on this Python. `pytest --co` (collection ONLY, before any
  test runs) segfaults in native `pandas._libs.tslibs.timestamps.as_unit` during a
  module-level datetime operation in an unrelated test module. This is the
  STATE.md-documented "local venv drift" blocker, entirely independent of this
  plan's additive files.
- **Impact on this plan: none by construction.** The new script lives under
  `scripts/`, which is OUTSIDE the coverage denominator
  (`--cov=services --cov=routers --cov=main_worker`), so it adds zero coverage
  regression. The new test file passes in isolation (20) and alongside the
  reconciliation analog (29). The `--cov-fail-under=80` gate is a **blocking CI
  gate** (per CLAUDE.md) enforced on the pinned CI Python where the ABI matches —
  it will run there. No code change can fix a native ABI mismatch caused by the
  local Python version; repinning the whole scientific stack / installing an older
  Python is out of scope for this plan.
- **Recommendation:** run the full suite in CI (or a Python 3.12/3.13 venv synced to
  `requirements.txt` + `requirements-dev.txt`) to confirm the 80% gate before the
  phase gate.

## Known Stubs

The `docs/deribit-ground-truth.md` answer sections contain `PENDING LIVE RUN
(Plan 67-03)` placeholders and empty fenced-JSON blocks. **These are intentional by
design** — the plan defines this file as a *template* populated by Plan 67-03 after
the orchestrator-only live `railway ssh` run (the live run cannot happen in this
plan; executor subagents have no railway auth). The resolving plan is explicitly
67-03. This is not a data-wiring stub that blocks the plan's goal (the goal is the
committed harness + template, both delivered).

## Commits

- `3a604c30` test(67-01): RED — failing pure-logic tests (module absent)
- `73641fcb` feat(67-01): GREEN — pure-logic layer (5 functions)
- `87d82701` feat(67-01): async harness main (scope gate, pagination, sanitized JSON)
- `2e59359b` docs(67-01): tracked answers template + evidence dir

## Self-Check: PASSED

All 4 created files exist on disk; all 4 commit hashes present in git history.
