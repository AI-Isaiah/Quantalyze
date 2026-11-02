---
phase: "183"
slug: "dupcount-a-book-whose-marked-duplicate-key-is-already-counte"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-01"
---

# Phase 183 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `183-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service venv) and vitest |
| **Config file** | `analytics-service/pytest.ini`; `vitest.config.ts` |
| **Quick run command** | from `analytics-service/`: `.venv/bin/python -m pytest tests/test_derive_allocator_equity_job.py tests/test_holder_matrix_parity.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider`; from repo root: `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/queries.benchmark-feed.test.ts src/lib/__tests__/holder-matrix-parity.test.ts src/lib/__tests__/derive-refusal-rows.test.ts src/__tests__/accounttruth-census.test.ts` |
| **Full suite command** | `npx vitest run`; analytics full pytest from `analytics-service/`; mypy `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; `npm run lint`; `npm run typecheck` |
| **Estimated runtime** | ~20 seconds (quick runs) |

---

## Sampling Rate

- **After every task commit:** the two quick runs
- **After every plan wave:** quick runs plus `npx vitest run "src/app/(dashboard)/allocations"`, the mypy line, `npm run lint`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 30 seconds

---

## Per-Requirement Verification Map

| SC | Behavior | Test Type | Automated Command | File Exists |
|----|----------|-----------|-------------------|-------------|
| SC-1 | marked duplicate behind a working holder composes once | unit + shared table | `pytest tests/test_holder_matrix_parity.py tests/test_derive_allocator_equity_job.py` | edit + new PROD-shaped test |
| SC-1 | two counted keys on one account still refuse (`account_identity_collision`) | unit | same files, `-k collision` | stays + new marker-pair unit |
| SC-2 | reader reads `ready` for the same cells; never `duplicate_account` from the key list | vitest | `npx vitest run src/lib/__tests__/holder-matrix-parity.test.ts src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts` | edit |
| SC-2 | stale `account_duplicate` and live `account_identity_collision` tokens map to `duplicate_account` | vitest | `npx vitest run src/lib/__tests__/derive-refusal-rows.test.ts src/lib/queries.test.ts` | edit + `legacy_refusals` consumer |
| SC-2 | census mirror agrees with the reader | real-PG throwaway cluster | `npx vitest run src/__tests__/accounttruth-census.test.ts` | edit |
| SC-3 | tests RED on the current refusal | RED log + neuter/restore from byte backups | recorded by the executor | to be produced |
| SC-4 | PROD: 0 `account_duplicate` rows, book trustworthy, QUANTALYZE-2H stops | manual, orchestrator only | read-only SQL after the marker query, Sentry read | post-deploy |
| D-02 (plan 05) | the per-key share note on both key cards says "This key reads the same exchange account as <holder>. We count that account once." in the muted tone, names no remedy, and shows in the same cases as before | vitest (unit + rendered cards) | `npx vitest run src/lib/account-share-note.test.ts src/components/exchanges/AllocatorExchangeManager.test.tsx src/components/exchanges/AllocatorExchangeManager.liveness.test.tsx src/components/strategy/ApiKeyManager.test.tsx` | edit + new no-remedy guard; RED 23 named tests first, mutations m1 (old note) and m3 (amber tone) |
| D-03, D-04 (plan 05, non-change) | the rebuilding panel's `duplicate_account` line is unchanged; no UI reads `duplicate_shared_account_counted_once` | vitest + git diff | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx"`; plan 05 changes nothing under `src/app/` | stays |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] RED tests committed before any source change (fixture flip, PROD-shaped derive test, marker-pair collision unit, census arm, reader flips)
- [ ] `legacy_refusals` section in `derive_refusal_rows.json` plus its consumers
- [ ] Plan 05 (D-02): the moved note pins and the no-remedy guard committed RED before the `account-share-note.ts` change

*No framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD reading after deploy | SC-4 | needs PROD and the nightly derive | orchestrator runs the operator plan |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
