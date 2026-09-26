---
phase: "168"
slug: "drboptions-a-deribit-options-account-can-be-ingested-end-to"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-26"
---

# Phase 168 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service venv) |
| **Config file** | analytics-service pytest config (existing) |
| **Quick run command** | `cd analytics-service && QZ_VENV_PY="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')/analytics-service/.venv/bin/python" && test -x "$QZ_VENV_PY" && env -u TEST_SUPABASE_DB_URL -u SUPABASE_TEST_DB_URL -u SUPABASE_TEST_URL -u SUPABASE_TEST_SERVICE_KEY "$QZ_VENV_PY" -m pytest tests/test_deribit_unclassified_evidence.py tests/test_deribit_txn.py tests/test_deribit_ingest.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && QZ_VENV_PY="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')/analytics-service/.venv/bin/python" && test -x "$QZ_VENV_PY" && env -u TEST_SUPABASE_DB_URL -u SUPABASE_TEST_DB_URL -u SUPABASE_TEST_URL -u SUPABASE_TEST_SERVICE_KEY "$QZ_VENV_PY" -m pytest -q -p no:cacheprovider` |
| **Estimated runtime** | ~168 seconds |

---

## Sampling Rate

- **After every task commit:** Run `quick run command`
- **After every plan wave:** Run `full suite command`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 168 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner per task) | — | — | DERIBIT-ASSIGNMENT-UNCLASSIFIED / D-01..D-08 | — | refusal text whitelisted; no identifiers | unit | quick run command | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` (D-03)
- [ ] new tests for D-01/D-02/D-07 (census shape summed; co-occurrence refuses; since_ms backstop; option-book constant)
- [ ] re-point `tests/test_deribit_unclassified_evidence.py` census tests to a still-unknown type; update `test_type_sets_pinned_to_evidence`

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A Deribit options account ingests end to end after deploy | DERIBIT-ASSIGNMENT-UNCLASSIFIED close condition / D-06, D-08 | needs PROD + a live broker account; agents may not touch either | Founder retries the strategy that failed on 2026-09-23 and reports terminal status, return-point count, and the class of any refusal, by type only |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 168s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
