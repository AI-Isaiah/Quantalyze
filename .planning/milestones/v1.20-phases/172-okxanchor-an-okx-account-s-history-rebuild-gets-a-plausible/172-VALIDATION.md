---
phase: "172"
slug: "okxanchor-an-okx-account-s-history-rebuild-gets-a-plausible"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-27"
---

# Phase 172 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest with pytest-asyncio, `asyncio_mode = auto` (the main checkout's Python 3.12 venv; per-plan worktrees have none) |
| **Config file** | `analytics-service/pytest.ini`; mypy reads `analytics-service/pyproject.toml` |
| **Quick run command** | from `analytics-service/`: resolve `QZ_VENV_PY` as the plans do (`QZ_WT="$(git worktree list --porcelain)"`, first `worktree` line, `/analytics-service/.venv/bin/python`), then `"$QZ_VENV_PY" -m pytest -q -p no:cacheprovider tests/test_okx_opening_balance.py tests/test_okx_anchor_rule.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py tests/test_ana_recon_audit.py` (only the files that exist at that point of the phase) |
| **Full suite command** | from `analytics-service/`: `"$QZ_VENV_PY" -m pytest -q -p no:cacheprovider`, plus CI's mypy line verbatim: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | quick run about 40 s (measured 2026-10-27 in the phase worktree: force-rebuild + probe + recon-audit files, 111 passed in 25.7 s; equity-reconstruction + whole-account + fallback + marker-writer, 225 passed in 28.3 s; mypy about 15 s). Full suite not measured locally; CI shards it and is authoritative |

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` commands (targeted pytest files, plus the mypy line whenever a `services/` file changed)
- **After every plan wave:** the quick run command over every phase test file that exists, plus the mypy line
- **Before `/gsd-verify-work`:** full suite green; `SC1_OK` and `DECISION_OK` recorded (plan 03); `SC3_OK` recorded (plan 05)
- **Max feedback latency:** 60 seconds per task command

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 172-01-01 | 01 | 1 | SC-1, SC-2 | T-172-01, T-172-03 | the opening comes from the bills' own `bal - balChg`, never from the replay or the anchor; nothing in production calls it | unit, end to end on fakes; mypy; scope diff | `pytest -rA tests/test_okx_opening_balance.py` (three named tracers PASSED); mypy line; `equity_reconstruction.py` and `exchange.py` unchanged from the merge-base | ❌ W0 (created by the task) | ⬜ pending |
| 172-01-02 | 01 | 1 | SC-2 | T-172-01, T-172-02, T-172-03, T-172-04 | every structural gap is a named token; venue errors propagate; the module cannot write | unit; static pin; mutations (chain check, reach proof) | `pytest -rA tests/test_okx_opening_balance.py` (at least 12 gap cases); temp-copy mutations of the chain-check line and `return reached` go RED | ❌ W0 | ⬜ pending |
| 172-01-03 | 01 | 1 | SC-2 | T-172-05 | the 5x arm is pinned for OKX through production; no test restates the formula | handler level and direct call; mutation | `pytest -rA tests/test_ana_recon_audit.py tests/test_reconstruct_force_rebuild.py`; restated-formula grep is 0 (baseline 1); 5x multiplier neutered on a temp copy puts both OKX pins in FAILED | ✅ (files exist; one test rewritten, one added) | ⬜ pending |
| 172-02-01 | 02 | 2 | SC-1 | T-172-06, T-172-07 | the refused member stays refused; counters count the forced pass only; no amount on stdout | end to end through `hp.run()`; RED commit | `pytest -rA tests/test_allocator_history_probe.py`; the RED commit's tree fails the tracer | ✅ (file exists) | ⬜ pending |
| 172-02-02 | 02 | 2 | SC-1 | T-172-06, T-172-09 | every D-01 reading prints as a count, bool, token or 3-figure ratio; a failed diagnostic never hides the refusal | unit (pure readings); end to end | `pytest -rA tests/test_allocator_history_probe.py`; key-set check of the 26 diagnostic keys | ✅ | ⬜ pending |
| 172-02-03 | 02 | 2 | SC-1 | T-172-06, T-172-08, T-172-10 | vocabulary refuses unrounded, non-finite, bool-as-count and out-of-set values; probe still read-only; Phase 173's ordering read untouched | unit; static pins; AST identity; mutation N6 | `pytest -rA tests/test_allocator_history_probe.py tests/test_okx_opening_balance.py`; AST identity of six functions against the merge-base; `_is_sig3_float` neutered puts the vocabulary test in FAILED | ✅ | ⬜ pending |
| 172-03-01 | 03 | 3 | SC-1 | T-172-11, T-172-12, T-172-13, T-172-14 | read-only PROD run; worker restored; measured code bound by sha256; only whitelisted lines tracked | operator checkpoint; SUMMARY gate | `SC1_OK` gate over `172-03-SUMMARY.md` (probe section, binding, restore, label, closed-set `sc1-cause:`, no uuid, no long digit run, scratch deleted) | ❌ (written by the operator) | ⬜ pending |
| 172-03-02 | 03 | 3 | SC-1 (decision) | T-172-15 | the founder decides with the reading in hand; a refusal branch amends CONTEXT and ROADMAP together | founder decision checkpoint | `DECISION_OK` gate over `172-03-SUMMARY.md` (`founder-decision:`, `sc1-branch:`, and `tolerance-rel:` or `plan-04: not executed`) | ❌ | ⬜ pending |
| 172-04-01 | 04 | 4 | SC-2 | T-172-16, T-172-18, T-172-20 | a bills-proven opening anchors and writes; the old code refused it; the audit flag is set | handler-level tracer; RED commit; mypy; tolerance-equals-record check | six-file `pytest -rA` run including the tracer, merge, implausible, c01_03 and closed-set pins; the RED tree fails the tracer on an assertion; mypy; `OPENING_TOLERANCE_REL` equals the recorded `tolerance-rel:` | ❌ W0 (`tests/test_okx_anchor_rule.py` created by the task) | ⬜ pending |
| 172-04-02 | 04 | 4 | SC-2 | T-172-16 | a disagreeing or unprovable opening refuses by name and writes nothing; the boundary is inclusive and bites | handler level; direct calls; pure; mutations N1, N3, N4 | `pytest -rA tests/test_okx_anchor_rule.py tests/test_okx_opening_balance.py` (at least 6 unprovable cases); N1, N3, N4 RED on temp copies | ❌ W0 | ⬜ pending |
| 172-04-03 | 04 | 4 | SC-2 | T-172-17, T-172-18, T-172-19 | scope is forced OKX only; unforced, Bybit and non-positive replays make no bills call; a 429 propagates | direct calls; handler level; mutations N2, N5 | nine-file `pytest -rA` run including the closed-set pin; N2, N5 RED on temp copies | ❌ W0 | ⬜ pending |
| 172-05-01 | 05 | 5 | SC-3 | T-172-21, T-172-22, T-172-23, T-172-24 | the deployed probe re-reads a4; the outcome is checked against the branch; nothing is enqueued | operator checkpoint; SUMMARY gate | `SC3_OK` gate over `172-05-SUMMARY.md` | ❌ (written by the operator) | ⬜ pending |
| 172-05-02 | 05 | 5 | SC-1, SC-3 | T-172-24 | the ledger is closed with counts and tokens only | text gate | grep gate over `TODOS.md` (new section and entry exactly once, both dated readings present, no uuid in added lines, tolerance entry on a rule branch) | ✅ (`TODOS.md`) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/_okx_bills.py` — OKX raw balance and bills-archive fakes (plan 01 Task 1; reused by plans 02 and 04)
- [ ] `analytics-service/tests/test_okx_opening_balance.py` — the oracle's tests (plan 01 Tasks 1-2; comparator tests added by plan 04 Task 2)
- [ ] `analytics-service/tests/test_okx_anchor_rule.py` — the rule's tests (plan 04 Task 1, RED commit first)

Existing infrastructure covers the probe (`tests/test_allocator_history_probe.py`), the forced-rebuild pins
(`tests/test_reconstruct_force_rebuild.py`) and the merge-telemetry pins (`tests/test_reconstruct_whole_account.py`). No
framework install.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| a4's live reading on PROD (the cause of the refusal) | SC-1 | needs the deployed worker, live OKX keys decrypted only there, and a temporary PROD start-command change; `railway ssh` is broken | plan 03 Task 1 (payload, background run, restore, sha256 binding, fixed cause table); gate `SC1_OK` |
| the branch and tolerance decision | SC-1 into SC-2 | founder decision (D-01 items 2 and 3) | plan 03 Task 2 (AskUserQuestion with the derived recommendation); gate `DECISION_OK` |
| a4's post-deploy re-read | SC-3 | needs the merged and deployed code on the worker | plan 05 Task 1; gate `SC3_OK` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s per task command
- [ ] `nyquist_compliant: true` set in frontmatter (set by validate-phase after execution)

**Approval:** pending
