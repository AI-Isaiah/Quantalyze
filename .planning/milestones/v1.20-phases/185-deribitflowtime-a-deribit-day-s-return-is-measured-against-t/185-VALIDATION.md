---
phase: "185"
slug: "deribitflowtime-a-deribit-day-s-return-is-measured-against-t"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-01"
---

# Phase 185 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `185-RESEARCH.md` § Validation Architecture, as re-researched on 2026-11-01 for the D-04 replan (open options valued at market in key mode). The flow-split strategy this file carried before is superseded; git history keeps it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), vitest (frontend) |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/test_mtm_single_key.py tests/test_smoothed_mtm_core.py tests/test_allocator_equity_writer_basis.py tests/test_nav_marks_compose_roundtrip.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && .venv/bin/python -m pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`; frontend `npm run typecheck && npm run lint && npx vitest run <files>` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~25 s quick; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the quick run command, plus the type gate for any Python touched
- **After every plan wave:** the touched files of both suites, plus `npm run typecheck` and `npm run lint`
- **Before `/gsd-verify-work`:** full suites green and CI checks counted on the head SHA
- **Max feedback latency:** 60 seconds

---

## Per-Requirement Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SC-1 | verdict recorded | record | `grep -a "^gate: B" .planning/phases/185-*/185-01-SUMMARY.md` | ✅ | ✅ met |
| SC-2 | key mode on cash gives (−0.4839, +0.0280, +3.3339); on the options basis (0, +0.1740, +0.9586); same cumulative +1.2994 | derive | `pytest tests/test_deribit_key_mode_options_basis.py -q` | ❌ W0 | ⬜ pending |
| SC-2 | option-activity keys only; a perp-only key is byte-identical | derive | same module | ❌ W0 | ⬜ pending |
| SC-2 | raw option rows through the real assembler, one crawl: the cash basis shows a day with an absolute return above 0.5, the options basis none beyond the fixture's typed mark-driven bound (plan 185-07 A6) | ingest | `pytest tests/test_deribit_options_basis_ledger.py -q` | ❌ W0 | ⬜ pending |
| SC-2 | seam: pre-`S` days from the options ledger, marks from `S`, disjoint; the compose round trip lands on `L(S−1)` | derive | same module + `tests/test_nav_marks_compose_roundtrip.py` | ❌ W0 / ✅ | ⬜ pending |
| SC-2 | an options-step failure or budget overrun falls back to cash with the flag set; transient errors still retry | derive | same module | ❌ W0 | ⬜ pending |
| SC-2 | the old key-mode gate pin is rewritten deliberately | derive | `pytest tests/test_mtm_single_key.py -q` | ✅ (edit) | ⬜ pending |
| SC-3 | the writer sets the caveat flag only when true and strict, and clears it once the options basis applies | derive | new tests | ❌ W0 | ⬜ pending |
| SC-3 | literal pin Python to TypeScript; strict reader; each hop RED when neutered; the sentence renders | vitest | `npx vitest run` on the new pin and the edited reader tests | ❌ W0 / ✅ | ⬜ pending |
| SC-4 | the founder's book has no day over 50% attributed to cash-basis options after the recompute; cumulatives reported; key C 2026-10-28 explained | PROD read (orchestrator, marker first) | read-only SQL after the derive | manual | ⬜ pending |
| SC-5 | tests RED on today's cash basis; an uncomputable day follows founder question F2 | neuter drill | byte backup, neuter, `pytest`, restore, `cmp` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Read-only dry run in the worker (orchestrator only): the options ledger for keys A and C from one crawl, per-day cash against options-basis returns on the 24 days with |r| > 0.3, held-instrument counts, wall times, pre-retention day counts, error classes, the two env flags, and a pre-change baseline of the founder's book. **If most big days remain, the phase replans again.**
- [ ] `analytics-service/tests/test_deribit_key_mode_options_basis.py` and an option-book ledger fixture with a marks start `S`
- [ ] The frontend flag module and its literal-pin test

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dry-run evidence that the options basis removes the big days | SC-2 gate | needs live Deribit reads in the PROD worker | orchestrator runs the dry-run plan; counts and ratios only |
| Post-deploy PROD reading of the founder's book | SC-4 | PROD data after the derive | orchestrator, marker query first, read-only |
| The interim caveat on PROD between the PR-1 and PR-2 deploys | SC-3 | PROD state that exists only between two deploys | orchestrator, plan 185-10 Task 2 step 0: `key_inputs` flag per option-activity key and the /allocations sentence, or the omission recorded with both deploy times |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
