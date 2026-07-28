---
phase: 67
slug: deribit-live-harness-exchange-ground-truth
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 67 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) + mypy --strict vs CI-pinned uv venv |
| **Config file** | `analytics-service/pyproject.toml` / `requirements.txt` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/<touched> -q` |
| **Full suite command** | `cd analytics-service && .venv/bin/python -m pytest -q --cov=services --cov=routers --cov=main_worker --cov-fail-under=80` |
| **Estimated runtime** | quick ~10-30s; full suite ~minutes |

---

## Sampling Rate

- **After every task commit:** Run the touched-file pytest command
- **After every plan wave:** Run the full suite command
- **Before `/gsd:verify-work`:** Full suite green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 67-01/T1 | 67-01 | 1 | DRB-01 | T-67-01, T-67-02 | scope gate rejects write scope; sanitize_evidence strips secrets/masks ids; assert_sanitized raises on leaks | pytest unit (pure fns, TDD) | `pytest tests/test_deribit_ground_truth.py -x -q` | ⬜ Wave-0 (created by this task) | ⬜ pending |
| 67-01/T2 | 67-01 | 1 | DRB-01 | T-67-02, T-67-05 | scope gate BEFORE any private call; exit 3 without env vars, values never printed; pagination bounded by --max-pages | pytest unit + mypy --strict + exit-code check | `pytest tests/test_deribit_ground_truth.py -x -q && mypy --strict --follow-imports=silent scripts/deribit_ground_truth.py` | ⬜ (T1 creates) | ⬜ pending |
| 67-01/T3 | 67-01 | 1 | DRB-01 | T-67-03 | docs paths tracked (not gitignored); no evidence yet committed | git check-ignore + full suite | `git check-ignore docs/deribit-ground-truth.md; test $? -ne 0 && pytest -q --cov-fail-under=80` | ✅ | ⬜ pending |
| 67-02/T1 | 67-02 | 1 | BYB-01 | T-67-08, T-67-09 | funding compared by match_key bucket never native id; 1e-9 dailies bar; count_delta recorded even if zero; report masked | pytest unit (pure fns, TDD) | `pytest tests/test_bybit_reconcile.py -x -q` | ⬜ Wave-0 (created by this task) | ⬜ pending |
| 67-02/T2 | 67-02 | 1 | BYB-01 | T-67-06, T-67-07 | read-only invariant (zero .insert/.update/.upsert/.delete — grep gate); decrypted key never printed | pytest + mypy + read-only grep gate + full suite | `pytest tests/test_bybit_reconcile.py -x -q && mypy --strict scripts/bybit_reconcile.py && ! grep -E "\.(insert|update|upsert|delete)\(" scripts/bybit_reconcile.py` | ⬜ (T1 creates) | ⬜ pending |
| 67-03/T1 | 67-03 | 2 | DRB-01 | T-67-12, T-67-13 | key env-only, presence checked via booleans; deploy verified green | manual-only (orchestrator railway ssh; see Manual-Only table) | env-presence ssh check (booleans) | n/a | ⬜ pending |
| 67-03/T2 | 67-03 | 2 | DRB-01 | T-67-12 | exit=2 scope violation halts; capture is sanitized-by-construction | manual-only (orchestrator railway ssh) + JSON shape check | `python3 -c "json.load(...)"` shape assert on the capture | n/a | ⬜ pending |
| 67-03/T3 | 67-03 | 2 | DRB-01 | T-67-11, T-67-14 | assert_sanitized over the REAL committed artifact; answers cite verbatim excerpts; no fabricated marker | pytest-adjacent mechanical gate + full suite | `python -c "...assert_sanitized(json.load(open('docs/evidence/deribit-ground-truth-run.json')))"` + zero PENDING markers + full suite | ✅ (fn from 67-01/T1) | ⬜ pending |
| 67-04/T1 | 67-04 | 2 | BYB-01 | T-67-16, T-67-17 | SELECT-only key resolution; verdict-encoded exit code captured | manual-only (orchestrator railway ssh + Supabase MCP) | JSON shape assert on the capture (count_delta + verdict present) | n/a | ⬜ pending |
| 67-04/T2 | 67-04 | 2 | BYB-01 | T-67-15, T-67-18 | assert_sanitized over the REAL committed report; deltas recorded even if zero | mechanical gate + full suite | `python -c "...assert_sanitized(...); assert 'count_delta' in ..."` + full suite | ✅ (fn from 67-01/T1) | ⬜ pending |
| 67-04/T3 | 67-04 | 2 | BYB-01 | T-67-18 | conditional fix only on exit=1; regression test proven RED with fix reverted | pytest regression (bug-specific) or documented skip | full suite `--cov-fail-under=80`; if fix: new test RED-without-fix proof | conditional | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 test scaffolds are created BY the Wave-1 plans themselves (TDD tasks — RED commit precedes GREEN):

- [ ] `analytics-service/tests/test_deribit_ground_truth.py` — scope gate, txn-log `type` summary, instrument classification, masking, assert_sanitized (67-01/T1)
- [ ] `analytics-service/tests/test_bybit_reconcile.py` — dailies-within-1e-9, funding bucket compare, fills-diff wiring, report sanitization (67-02/T1)
- [ ] Fixture refresh (optional, post-live-run): trimmed masked real Deribit/Bybit responses may replace constructed fixtures for Phase 70 use

Framework install: none — pytest infra exists.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Authed Deribit harness run from Railway worker | DRB-01 | Live LTP key via Railway env + railway ssh — orchestrator-only (executors have no railway/Supabase access); founder must provision the key (checkpoint:human-action, 67-03/T1-T2) | Artifact JSON captured + sanitized; 3 recorded answers with raw evidence excerpts in analytics-service/docs/deribit-ground-truth.md |
| Bybit ground-truth reconciliation run | BYB-01 | Live prod key + worker egress; orchestrator-run via railway ssh / MCP (67-04/T1) | native-id set equality (fills), match_key (funding), dailies recompute within 1e-9; deltas recorded even if zero |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only live runs carry mechanical JSON-shape + assert_sanitized gates)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (created by the Wave-1 TDD tasks themselves)
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-07-04 (execution statuses pending)
