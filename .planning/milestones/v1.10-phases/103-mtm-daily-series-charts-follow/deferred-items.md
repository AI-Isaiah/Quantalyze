# Phase 103 — Deferred / Out-of-Scope Items

## D-103-01 — Pre-existing audit taxonomy TS↔Python drift (NOT caused by 103-01)

**Discovered:** 2026-07-12 during 103-01 full-suite verification.
**Test:** `analytics-service/tests/test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union`
**Failure:** `user_note.dashboard.update` exists in TS `src/lib/audit.ts` but not in
Python `services/audit.py` AuditAction Literal.
**Why out of scope:** unrelated to the MTM basis-series work — none of the 103-01
commits touch audit/taxonomy files, and the fix lives in `src/lib/audit.ts` /
`services/audit.py` (frontend + audit taxonomy), which Wave 1 must not touch. This
is a cross-runtime taxonomy sync that predates the phase. Fix belongs to whoever
added the `user_note.dashboard.update` TS action (mirror it into `services/audit.py`
or remove it from the TS union). Do NOT bundle into Phase 103.
