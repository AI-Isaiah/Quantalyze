---
phase: "173"
slug: "rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-28"
---

# Phase 173 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `173-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest with pytest-asyncio (`asyncio_mode = auto`), run from `analytics-service/` |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_allocator_history_probe.py -q` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate (CI, verbatim)** | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Probe type check** | `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py` |
| **Estimated runtime** | ~5 seconds (quick run) |

---

## Sampling Rate

- **After every task commit:** quick run + probe mypy line
- **After every plan wave:** quick run + CI's mypy line + `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

Filled by the planner per task (`<automated>` + `<fails_when>`). Behaviours that must be able to fail (mutation checks 1-8 in RESEARCH): refusal-arm ordering read, snapshot-sourced instrument type, swallowed raw-read failure, truncated/non-OKX arms, per-kind transfer filter, strict `bybit-transfers` gate (no pooled count), `okx-order` verdict precedence, declared-vocabulary pins, static no-write pins.

Every code task's `<automated>` runs its named tests by node id (a missing test is `ERROR: not found`, exit 4), the whole probe test file, probe mypy and CI's mypy line verbatim; the interpreter is derived from `git worktree list --porcelain` (first entry = main checkout).

| Task | Behaviour | Automated (named tests / gate) | Mutation seen RED | Status |
|------|-----------|--------------------------------|-------------------|--------|
| 173-01 T1 (tracer) | a refused OKX member carries one reading from the forced pass's type; a raised raw read keeps the refusal and prints its class | `test_a_refused_okx_member_carries_an_ordering_reading`, `test_the_refused_members_ordering_read_uses_the_forced_pass_instrument_type`, `test_a_raw_order_read_that_raises_leaves_the_refusal_and_names_its_class`; awaited-call count 1 | m1, m2, m3 | ⬜ |
| 173-01 T2 | read and cut-short OKX members take the same read; other arms make none; a raised read keeps a read member read | `test_a_raw_order_read_that_raises_after_a_good_read_keeps_the_member_read`, `test_a_truncated_okx_member_carries_an_ordering_reading`, `test_no_raw_order_read_after_another_failure_or_on_a_bybit_member`; awaited-call count 3, raw-call literal once inside the helper | m4a, m4b, m4c | ⬜ |
| 173-01 T3 | `okx_members_with_trades`, summary `okx_order_gate` (violated first, absent evidence unmeasured), runbook P4 | `test_the_okx_order_verdict_puts_violated_first_and_absent_evidence_is_unmeasured`, end-to-end summary equality, static pins, neighbour tests; `src/__tests__/marksource-okx-census-sql.test.ts` (reads the whole runbook: no uuid, home path or planning-directory path) | m6a, m6b | ⬜ |
| 173-02 T1 (tracer) | per-kind counts older than 365 days; pooled equals their sum | per-account transfer test, zero-fetcher test, declared-vocabulary pin | m5a, m7 | ⬜ |
| 173-02 T2 | corroboration evidence (in-window totals, age buckets, ordering booleans), redacted | `test_fills_older_than_the_first_transfer_are_recorded_as_evidence`, `test_the_transfer_evidence_keys_refuse_values_outside_their_vocabulary`; key-set import check | none (evidence feeds no gate) | ⬜ |
| 173-02 T3 | strict `bybit_transfers_gate` from both per-kind counts only | `test_the_bybit_transfers_verdict_needs_both_kinds_on_a_full_bybit_window`, `test_one_kind_older_than_a_year_keeps_the_bybit_gate_unmeasured`; import line `0 16 True True True True` | m5b, m8 | ⬜ |
| 173-03 T1 | live gates on the deployed worker | SUMMARY grep chain ending `GATES_OK`; `sc1-met: yes` only with `okx-order:` `ok`/`violated` and `readings=` at least 1 | n/a (operator) | ⬜ |
| 173-03 T3 | decision carried out, ledger closes only on its own conditions | SUMMARY and `TODOS.md` grep chain ending `DECISION_OK` | n/a (operator) | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (test file, stubs and emitter pins exist). Small fixture extensions only (raw ordering answer on the OKX stub; a diagnostic pass on a different instrument type).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `okx-order` and `bybit-transfers` readings on the deployed worker | SC-1, SC-2 | needs the deployed code, a PROD read and live venue keys | operator checkpoint plan: run the full probe on the backfill worker, restore it, record gate lines |
| Founder's rebuild decision | SC-3 / D-04 | founder decision | AskUserQuestion at the checkpoint; record verbatim |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
