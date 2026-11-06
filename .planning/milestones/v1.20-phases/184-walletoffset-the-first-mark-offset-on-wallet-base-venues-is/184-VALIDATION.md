---
phase: "184"
slug: "walletoffset-the-first-mark-offset-on-wallet-base-venues-is"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-01"
---

# Phase 184 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `184-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (`analytics-service/pytest.ini`, `asyncio_mode = auto`) |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/test_walletoffset_probe.py -q -x` |
| **Full suite command** | `cd analytics-service && .venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate (CI, verbatim, from analytics-service/)** | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~20 seconds (quick) |

pytest runs only from `analytics-service/`; never `importlib.reload` in tests. `scripts/` is outside CI's mypy scope; the script is still type-annotated and may be checked locally.

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command and the mypy line
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Filled by the planner per task (each PLAN.md `<verify>` carries the exact command and its `<fails_when>`):

| Plan / Task | Wave | Behavior | Automated command (from `analytics-service/` unless noted) | Status |
|-------------|------|----------|-------------------|--------|
| 184-01 T1 (tracer) | 1 | one marked OKX key end-to-end through `run()` | quick command `-k tracer`; the two walker consumer files (baseline 167 passed, about 5 s); ADDITIVE_OK (repo root) | ⬜ |
| 184-01 T2 | 1 | window edges, offset arithmetic, OKX walk and sums (funding_rows_in_window = type 8 bill count), flow term, `failure_token`; mutations W1, W2 | quick command `-k "window or offset or okx or flows"` | ⬜ |
| 184-01 final gates | 1 | `tests/_okx_bills.py` consumers unchanged; scope | plan-level `<verification>`: the nine consumer files (baseline 615 passed, about 36 s); CI mypy line; SCOPE_OK (repo root) | ⬜ |
| 184-02 T1 | 2 | refusals before decrypt (`eligible_key_predicate`: an error or sign_in_failed key is read, not refused), timeout and venue-error class, summary counts, shares_account | quick command `-k "unmeasurable or shares_account"` | ⬜ |
| 184-02 T2 | 2 | read-only pins with control, redaction with leaky control, emit rejections, main; mutation W3 | quick command `-k "read_only or source or redaction or leaks or emit or main"`; CI mypy line; SCOPE_OK (repo root) | ⬜ |
| 184-03 T1 | 3 | Bybit end-to-end, `fetch_daily_pnl` parity, Bybit edges | quick command `-k bybit` | ⬜ |
| 184-03 T2 | 3 | Binance, sFOX `reader_not_built`, mixed-venue summary, deploy fingerprint | quick command `-k "binance or sfox or summary or fingerprint"`; the fingerprint print | ⬜ |
| 184-03 T3 | 3 | mutations B1 to B4, test file, mypy, scope | the test file; CI mypy line; local mypy on the script; SCOPE_OK (repo root) | ⬜ |
| 184-03 final gates | 3 | full suite and the SUMMARY lines | plan-level `<verification>`: full suite command (baseline 14078 passed, 102 skipped, about 5.5 min); SUMMARY_OK (repo root, after the SUMMARY is written) | ⬜ |
| 184-04 T1 | 4 | live run on the worker, worker restored, records pasted | RUN_OK shell gate over `184-04-SUMMARY.md` (repo root; orchestrator) | ⬜ |
| 184-04 T2 | 4 | readout lines equal to the records, caveats, sc1-met | LINES_OK shell gate (repo root; orchestrator) | ⬜ |
| 184-05 T1 | 5 | founder answers with recommendations, at most four questions a call and three calls, the ledger offer (RESEARCH Open Question 1) | ANSWERS_OK shell gate (repo root; orchestrator) | ⬜ |
| 184-05 T2 | 5 | D-02 in CONTEXT and ROADMAP, follow-up booked, SC-3 from the merge | DECISION_OK shell gate; `npx tsx scripts/check-planning-hygiene.ts` (repo root; orchestrator) | ⬜ |

Every task-level command above runs in under 30 seconds (measured 2026-11-01: the comparable probe test file `tests/test_allocator_history_probe.py` runs 196 tests in 9.9 s, the two walker consumer files 167 tests in about 5 s, CI's mypy line 3.5 s with an empty cache). The two commands that do not (the nine-file consumer run, about 36 s, and the full suite, about 5.5 minutes) are plan-level final gates in 184-01 and 184-03 `<verification>`, each backed by a fast task-level command; so is SUMMARY_OK, which needs the SUMMARY that execute-plan writes after the tasks.

The operator gates (RUN_OK, LINES_OK, ANSWERS_OK, DECISION_OK) were each run at planning time against a synthetic SUMMARY under bash and zsh, printed their OK line on the unmutated input and went RED on every listed mutation. ANSWERS_OK was re-run at plan revision (2026-11-01) after the ledger offer was added to it.

Behaviors to cover (SC-1, SC-3):

| Behavior | Test Type | Automated Command (-k filter on the quick command) |
|----------|-----------|-------------------|
| Window `[midnight(marked_at), marked_at]` edges | unit | `-k window` |
| Offset terms: P + F, ratio over NAV and wallet, `nav <= 0` unmeasurable, never 0 | unit | `-k offset` |
| OKX bills-archive sum and walker reach | unit | `-k okx` |
| Bybit closed-pnl formula parity with `fetch_daily_pnl` | parity | `-k bybit_parity` |
| Flow term from `ccxt_rows_to_dated_flows(instants=)` | unit | `-k flows` |
| Unmeasurable keys give a closed token, never a ratio; an eligible key in sync_status error is read, not refused | unit | `-k unmeasurable` |
| Read-only static pins (no writes to DB or venue) with a failing control | static | `-k "read_only or source"` |
| Redaction: planted ids/amounts never printed, with a leaky control that fails | integration on fakes | `-k "redaction or leaks"` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_walletoffset_probe.py` — all behaviors above
- [ ] `analytics-service/tests/_okx_bills.py` — additive, default-off `pnl` / `fee` parameters on `okx_bill`
- [ ] a Bybit closed-pnl / transaction-log fake (reuse an existing one if it models the endpoints)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The worker run prints one record per marked key, counts and ratios only | SC-1 | needs stored PROD keys and live venue reads inside the Railway worker | orchestrator runs the deployed script in the worker, restores the worker, pastes the sanitized record |
| Founder decision recorded | SC-2 | founder product call | AskUserQuestion with the numbers; record in CONTEXT and ROADMAP |
| No published number changed | SC-3 | PROD state | the script has no write path (static pins) and the phase ships no derive change |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
