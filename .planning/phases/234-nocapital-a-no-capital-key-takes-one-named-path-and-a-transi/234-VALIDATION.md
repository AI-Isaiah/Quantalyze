---
phase: "234"
slug: "nocapital-a-no-capital-key-takes-one-named-path-and-a-transient-read-never-drops-a-funded-key"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-24"
---

# Phase 234 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `234-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + pytest-asyncio (`analytics-service/pytest.ini`) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_no_capital_exit.py tests/test_allocator_equity_inception.py -q -p no:cacheprovider && python3 -m pytest tests/test_derive_allocator_equity_job.py -k no_capital -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_*.py tests/test_e2_*.py tests/test_derive_allocator_equity_job.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider` plus CI's strict mypy |
| **Estimated runtime** | ~80 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite command plus `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`
- **Before `/gsd-verify-work`:** full analytics pytest (CI pins ccxt 4.5.89) green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task. Requirement coverage: NOCAP-01, NOCAP-02, NOCAP-03, NOCAP-04 and the out-of-window ruling, per the RESEARCH map. Every task's `<automated>` command runs in about 25 to 40 s locally (measured at HEAD: the three-file job set 11 s, the wide allocator set 879 passed in 21 s, strict mypy 10 s). Plans run in waves 1 to 4 strictly in order, because every plan edits `job_worker.py` and a test file another plan also edits.

| Plan-Task | Wave | Requirement | Test type | Automated command (from `analytics-service/`) | Gate it proves (PROOF-01 arm) |
|---|---|---|---|---|---|
| 01-T1 (tracer) | 1 | NOCAP-03 | job + compose | `python3 -m pytest tests/test_derive_allocator_equity_job.py tests/test_allocator_equity_no_capital_exit.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider` + strict mypy | `replay_refused` counted in the row and on `compose_empty_blocked` (neuter the compose increment; drop the `_persist_refusal` keyword) |
| 01-T2 | 1 | NOCAP-03 | job + compose + unit | same as 01-T1 | per-route counts once per key, absence on clean runs, closed set (neuter each job count and the compose blocking count) |
| 01-T3 | 1 | NOCAP-04 | compose | wide allocator set + strict mypy | missing-terminals candidate equals the no-candidate payload minus the field (restore the unconditional `key_inputs_mismatch`) |
| 02-T1 (tracer) | 2 | NOCAP-01, NOCAP-03 | job | three-file job set + strict mypy | transient zero over a funded MT5 ledger keeps `dropped_key` (skip the `ledger_level_funded` refusal) |
| 02-T2 | 2 | NOCAP-01, NOCAP-03 | job + unit | wide allocator set + strict mypy | no basis, negative-terminal pair, "MT5" case, Deribit scope, gate order (neuter each refusal and the venue normalisation) |
| 03-T1 (tracer) | 3 | NOCAP-02, NOCAP-03 | job | three-file job set + strict mypy | apply-loop `KeyError` reverts across two runs (narrow the handler to `NavReconstructionError`) |
| 03-T2 | 3 | NOCAP-02, NOCAP-03 | job + dispatch | wide allocator set + strict mypy | compose `ValueError` reverts, dispatch DONE, controls (delete the compose handling; drop the count) |
| 04-T1 (tracer) | 4 | ruling (PROOF-01) | job | `python3 -m pytest tests/test_allocator_equity_inception.py tests/test_derive_allocator_equity_job.py tests/test_allocator_equity_no_capital_exit.py -q -p no:cacheprovider` + strict mypy | stored tail day reaches the count (drop the `_compose` keyword) |
| 04-T2 | 4 | ruling (PROOF-01) | replay + reader + job | wide allocator set + strict mypy | exact scope, strict reader, departed key (drop the exemption; make the reader tolerant; drop the departed read) |

"Wide allocator set" is `python3 -m pytest tests/test_allocator_equity_*.py tests/test_e2_*.py tests/test_derive_allocator_equity_job.py tests/test_derive_refusal_rows.py tests/test_nav_marks_compose_roundtrip.py tests/test_tiny_base_marks.py -q -p no:cacheprovider`.

---

## Wave 0 Requirements

Each item is written inside the task that needs it, test first, so no separate Wave 0 plan exists.

- [ ] Re-fixture the MT5 candidate tests that carry no basis: five exits get a hand-derived basis, four venue-independent gates move to a Deribit row without a basis (plan 02 Task 1; planning found a fifth exit test and four hollowed tests beyond RESEARCH's list)
- [ ] New fixtures: funded-ledger MT5 candidate (02-T1), no-basis MT5 candidate and negative-terminal pair (02-T2), missing-terminals hole candidate (01-T3), stated-tail-day replay and job books (04-T1, 04-T2)
- [ ] Pop-the-field helper `_pop_refusal_field` for the two whole-payload equality tests (01-T1, 01-T2)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none: every task's command runs against existing files)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

## Plan-time gate notes (orchestrator, 2026-11-25)

- **Decision coverage gate (plan-phase 13a): proceeded with an override.** `check.decision-coverage-plan` returned `could-not-parse`. A smart-discuss CONTEXT.md carries no `D-NN` decision ids by design, and the parser treats the prior-phase references in it (166.3.1 `D-02`, `D-10`) as decision-shaped. Coverage was checked another way instead. The plan checker confirmed CONTEXT compliance for every locked decision, with 0 blockers and 0 warnings. Plan 01's source audit marks every row COVERED. The post-planning gap analysis shows 4/4 requirements covered. Verify-phase should re-check decision coverage by reading CONTEXT.md, not by relying on that parser.
- The override is recorded here and not in STATE.md, because parallel phases share STATE.md's Current Position. The `state.planned-phase` handler overwrote another phase's position and truncated `stopped_at`, so its diff was reverted.
- Plan-checker advisories (INFO, no revision): the DEC-02-B gate order is not pinned by a test that bites; the apply-loop `candidate_exception` count and plan 04's scope edges have no neuter arm of their own; the 155.2 freeze is an orchestrator push-time check (`155.2-12-SUMMARY.md` must be absent from origin/main); "payload flag" is satisfied by the counts field in `payload["inputs"]`.
