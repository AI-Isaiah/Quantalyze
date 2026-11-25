---
phase: "250"
slug: "binancefills-a-binance-fills-read-walks-every-window-and-never-stalls-its-cursor"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 250 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `250-RESEARCH.md` `## Validation Architecture` (the arm table and neuters N1-N17 live there and are binding on the plans).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest with pytest-asyncio (`asyncio_mode = auto`) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_cursor.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && .venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Estimated runtime** | ~30 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** quick run command plus the migrated Binance tests in `tests/test_exchange.py`
- **After every plan wave:** `tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py` plus CI mypy strict
- **Before `/gsd-verify-work`:** full suite green with `--cov-fail-under=80`, mypy strict green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per task; every row cites one arm of the research table with its RED-on-pre-fix reading and its PROOF-01 neuter.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 250-01-01 | 01 | 1 | SC-1..3 | — | N/A | unit | quick run command | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/_binance_fills.py` — real `ccxt.binance`, recorded markets, venue-modelling fake
- [ ] recorded markets fixture (unified market dicts from a public `load_markets()`)
- [ ] `tests/test_binancefills_walk.py`, `tests/test_binancefills_cursor.py`
- [ ] migrate the 14 census tests to the fake; replace the source-inspection test with a behavioural same-ms pin

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Precondition recorded at the flag declaration | SC-4 | prose is not tested (CONTEXT) | read the `_RAW_TRADE_INGESTION_ENABLED` comment and the CHANGELOG entry |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
