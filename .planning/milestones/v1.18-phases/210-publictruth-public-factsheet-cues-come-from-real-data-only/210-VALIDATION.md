---
phase: "210"
slug: "publictruth-public-factsheet-cues-come-from-real-data-only"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-14"
---

# Phase 210 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 210-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom + node projects); SQL gate files via the mutation runner / pg-lane and the `sql-tests` lane |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <file>` (TS); `node scripts/mutation-runner/run.mjs --subset-from <list>` (SQL) |
| **Full suite command** | `npm test`; `npx tsc --noEmit`; `npm run lint`; `node scripts/mutation-runner/run.mjs --parse-only` (FULL mutation run is CI-only on this host) |
| **Estimated runtime** | ~15 seconds per quick run |

---

## Sampling Rate

- **After every task commit:** the touched test file(s); `--parse-only` for SQL tasks
- **After every plan wave:** the vitest groups for the wave, `npx tsc --noEmit`, `npm run lint`
- **Before `/gsd-verify-work`:** full suite green, CI `sql-mutation`, `sql-tests`, `migration-drift-check`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per PLAN task; each success criterion maps as follows.

| SC | Behavior | Test (RED when the fix is reverted) | Automated Command | Status |
|----|----------|-------------------------------------|-------------------|--------|
| SC-1 | closed window ignored; window ending today counts as closed | new arms in `supabase/tests/test_get_published_trade_venues.sql` | `node scripts/mutation-runner/run.mjs --subset-from <list>` (biting == arms) | ⬜ pending |
| SC-1 | badge contract `[okx]` no cue / `[binance, okx]` cue; all-windows-closed composite gets no venue (D-06) | `src/components/strategy/SyncBadge.venue.test.tsx`, `src/lib/queries.trade-venues.test.ts` | `grep -q -a -F 'it("170.6.1-VENUES-CLOSED-KEY-WINDOWS (D-09)' src/components/strategy/SyncBadge.venue.test.tsx && grep -q -a -F 'it("D-06 (Phase 210): a composite whose every key window has closed' src/lib/queries.trade-venues.test.ts && npx vitest run src/components/strategy/SyncBadge.venue.test.tsx src/lib/queries.trade-venues.test.ts` (plan 210-01 Task 3; the greps fail while the cases are absent) | ⬜ pending |
| SC-2 | api payload lacks both fields; no demo names serialized | `build-payload.test.ts`, `FactsheetBody.no-demo-content.test.tsx` | `npx vitest run src/lib/factsheet/build-payload.test.ts` | ⬜ pending |
| SC-2 | cache key bumped | `page.public-cache-key.test.tsx`, `page.cache-isolation.test.tsx` | `npx vitest run` on both | ⬜ pending |
| SC-3 | reader flags malformed; Sentry once with reason only; flag set; sentence renders | `trade-fetch-provenance.test.ts`, `fetch-and-build-payload.test.ts`, `FactsheetView.unrecovered-gap.test.tsx` | `npx vitest run` on the three | ⬜ pending |
| SC-4 | every census agrees | `gate-family-meta`, `mutation-annotation-parser`, `mutation-runner-floors`, `return-stats.single-source` | `npx vitest run` on the four | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree
- [ ] new SQL arms + fixtures; new migration + rollback + regenerated function snapshot
- [ ] new SC-3 reader/caller/render cases; flipped SC-2 no-demo assertions

---

## Manual-Only Verifications

All phase behaviors have automated verification. Neuter-the-fix (byte backup, never git checkout/restore/stash) is run per TS fix as in RESEARCH.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
