# Deferred items — Phase 104

Out-of-scope discoveries found during execution. NOT fixed here (SCOPE BOUNDARY:
only auto-fix issues directly caused by the current task's changes).

## 1. Pre-existing Python/TS audit-taxonomy drift (unrelated to Phase 104)

- **Found during:** 104-02 Task 2 full-suite coverage sweep.
- **Failing test:** `analytics-service/tests/test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union`
- **Symptom:** `src/lib/audit.ts` `AuditAction` union contains `user_note.dashboard.update`, which is absent from the Python `AuditAction` Literal in `analytics-service/services/audit.py`.
- **Root cause:** introduced by `d45ff646 feat(100-01): add dashboard scope_kind for user_notes (PI-04)` — the TS union gained the action but the Python Literal was not updated in lockstep.
- **Why deferred:** entirely unrelated to Phase 104 (a tests-only phase adding `test_cash_basis_series_sc4.py`). Fixing it requires editing `services/audit.py` (add `user_note.dashboard.update` to the `AuditAction` Literal) — an unrelated production change that must not be bundled into this tests-only plan. The Phase-104 SC-3 cash golden sweep itself is GREEN (all cash-pin / golden / basis-series / seam-regression tests pass), and the coverage gate passed at 92.50% (>= 80%).
- **Suggested owner:** a Phase-100 follow-up or an audit-taxonomy sync fix PR — add `"user_note.dashboard.update"` to the Python `AuditAction` Literal in `analytics-service/services/audit.py`.
