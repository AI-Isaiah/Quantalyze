---
phase: "212"
slug: "wiztruth-the-wizard-and-key-screens-name-the-real-cause-and"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-14"
---

# Phase 212 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `212-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) ; pytest + mypy strict (analytics-service, Python 3.12) |
| **Config file** | `vitest.config.ts` ; `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| **Quick run command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <file>` ; `cd analytics-service && pytest <file> -x` |
| **Full suite command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test && npm run lint && npm run typecheck` ; `cd analytics-service && make test && make typecheck` |
| **Estimated runtime** | ~600 seconds (full) ; <60 seconds (per file) |

---

## Sampling Rate

- **After every task commit:** Run the owning test file(s) for that task.
- **After every plan wave:** Run that wave's files plus `npm run typecheck` (and `make typecheck` for Python plans).
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 60 seconds per task.

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SC1 | composite `sampled_gapped` / `fill_derived_unproven` → `GATE_SERIES_EXAMINED_REFUSED`; null/unknown → provenance | component render | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx" src/lib/strategyGate.test.ts` | edit existing | ⬜ pending |
| SC2 | founder sentence byte-exact; fence green; default-argument pin | pytest | `cd analytics-service && pytest tests/test_mt5_validate_parity.py tests/test_job_worker.py tests/test_ingestion_mt5.py -x && make typecheck` | edit existing | ⬜ pending |
| SC3 code channel | both live forms render `ErrorEnvelope` from `code`; status-aware `RATE_LIMITED`; curated fallback inside the envelope; sweep fifth surface | component + sweep | `npx vitest run src/components/strategy/StrategyForm.test.tsx src/components/exchanges/AllocatorExchangeManager.test.tsx src/lib/wizardErrors.roster-render.test.tsx` | edit + new cases | ⬜ pending |
| SC3 bare 401/403 | classifier answers `SEAM_MISCONFIGURED` for 401/403 with null seamCode on all callers | unit + route | `npx vitest run src/lib/wizardErrors.test.ts src/lib/wizardErrors.invariant.test.ts src/app/api/strategies/composite/add-key/route.test.ts src/app/api/strategies/create-with-key/route.bare-401.test.ts "src/app/api/keys/[id]/rotate-secret/route.test.ts" src/app/api/keys/validate-and-encrypt/route.test.ts` | new + edit | ⬜ pending |
| SC4 | validate and job leases use different keys; job hold does not delay validation acquisition; equal config shares a lock (RED control) | pytest | `cd analytics-service && pytest tests/test_mt5_concurrency.py -x` | new test in existing file | ⬜ pending |
| SC5 | MT5 orphan → `KEY_ORPHANED` before validate; ccxt orphan unchanged; resolver fault falls through | route | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` | edit existing | ⬜ pending |
| SC6 | each string rewritten; links render with topic + newTab rules; no-email sweep extended; census returns only comments | component + route + census | `npx vitest run src/__tests__/no-email-in-copy.test.ts src/app/api/strategies/csv-finalize/route.test.ts src/components/strategy/ApiKeyManager.test.tsx src/components/auth` | edit existing | ⬜ pending |
| SC7 | no migration | file census | `git diff --name-only origin/main...HEAD -- supabase/migrations` prints nothing | n/a | ⬜ pending |
| SC8 | each fix RED when reverted | neuter protocol (byte backup, never git checkout/stash) | per RESEARCH `RED-on-revert method per SC` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm ci` (Node 22) and `cd analytics-service && make install` in the worktree before any task proves anything.
- [ ] `src/app/api/strategies/create-with-key/route.bare-401.test.ts` — new file for SC3 bare 401.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Envelope and pointer wrapping at 320px | UI-SPEC long-text backstop | jsdom has no layout | Real browser at 320px on the StrategyForm modal, allocator Add-key form, ProfileForm, SignupForm |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
