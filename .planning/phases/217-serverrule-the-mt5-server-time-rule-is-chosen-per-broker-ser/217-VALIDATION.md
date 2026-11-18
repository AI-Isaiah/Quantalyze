---
phase: "217"
slug: "serverrule-the-mt5-server-time-rule-is-chosen-per-broker-ser"
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-18"
---

# Phase 217 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> The behaviour-to-test map (P1-P8, J1-J11, R1, C1), with the neuter that turns each row RED,
> is in `217-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), mypy strict |
| **Config file** | `analytics-service/pyproject.toml` |
| **Quick run command** | `cd analytics-service && python3 -m pytest -p no:cacheprovider -q tests/test_mt5_server_clock.py tests/test_mt5_server_clock_reading.py tests/test_mt5_server_clock_readings_parity.py tests/test_mt5_derive_branch.py` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` and `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | quick ~60 s; full several minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick command
- **After every plan wave:** Run the full suite and mypy strict
- **Before verify:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 217-01-01 | 01 | 1 | ROADMAP goal (utc server passes) | T-217-05 | selection by full hash, `mapped` flag | unit + job | quick command + mypy strict | ✅ | ✅ green |
| 217-01-02 | 01 | 1 | CONTEXT Q2 | T-217-03, T-217-04, T-217-05 | mapped refuses, unmapped writes and pages, no name/hash in records | job | quick command + mypy + 3 vitest literal pins | ✅ | ✅ green |
| 217-01-03 | 01 | 1 | CONTEXT Q1 (malformed map faults) | T-217-01, T-217-02 | strict grammar, closed value-free text, pre-read | unit + job | quick + full CI pytest (15120 passed) + mypy | ✅ | ✅ green |
| 217-02-01 | 02 | 2 | runbook (Q1, ordering) | T-217-07, T-217-08, T-217-09 | placeholders only; count-only validation | grep + parser one-liner | `grep -ac MT5_SERVER_TIME_RULES docs/runbooks/mt5-go-live.md` (4) | ✅ | ✅ green |
| 217-02-02 | 02 | 2 | runbook P6 | T-217-07 | placeholders only | grep | `grep -ac MT5_SERVER_TIME_RULES docs/runbooks/navmtm-chain-move-go-live.md` (2) | ✅ | ✅ green |

Neuter proofs (each RED, restored from a byte backup, `cmp` exit 0): selection, mapped-refuse, unmapped-continue, malformed map (two neuters) — 217-01-SUMMARY.md.

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The `13a451cff998` key's next PROD derive writes a `match` reading under `configured_rule='fixed'`, expected 0 | ROADMAP goal | Needs the coordinator's Railway entry and a live nightly derive | PROD read via Supabase MCP after the next derive |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-11-18

## Validation Audit 2026-11-18

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
