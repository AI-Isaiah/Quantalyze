---
phase: 55
slug: coverage-window-compute-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 55 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 55-RESEARCH.md § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.2 (package.json:70) |
| **Config file** | `vitest.config.ts` (coverage thresholds pinned there) |
| **Quick run command** | `npx vitest run src/lib/scenario.test.ts src/lib/scenario-window.test.ts` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Coverage gate** | `npm run test:coverage` — lines 82 / stmts 80 / fns 74 / br 72 (blocking CI) |
| **Estimated runtime** | ~quick <10s; full suite ~minutes (sharded in CI) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/scenario.test.ts src/lib/scenario-window.test.ts`
- **After every plan wave:** Run `npm test` (full suite — includes all 12 consumers + 5 frozen-spine guards)
- **Before `/gsd:verify-work`:** Full suite + `npm run test:coverage` green; **BLEND-07 numpy artifact committed and its vitest gate green BEFORE any Phase 60 activity**
- **Max feedback latency:** ~10 seconds (quick run)

---

## Per-Requirement Verification Map

> Task IDs assigned by the planner; this maps requirements → tests (task-level filled at validate-phase).

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| BLEND-01 | Engine accepts `state.window`, blends over it (absent → union) | unit | `npx vitest run src/lib/scenario.test.ts -t "window"` | ❌ W0 (new cases) | ⬜ pending |
| BLEND-02 | Member iff covers window; ended strategy excluded; boundary cells | unit | `npx vitest run src/lib/scenario-window.test.ts` | ❌ W0 (new file) | ⬜ pending |
| BLEND-03 | Interior gap 0-filled; member + divisor unchanged | unit | `npx vitest run src/lib/scenario.test.ts -t "interior gap"` | ❌ W0 | ⬜ pending |
| BLEND-04 | Weighted renorm over surviving members; narrow-back restores typed weight | unit | `npx vitest run src/lib/scenario.test.ts -t "renorm"` | ❌ W0 | ⬜ pending |
| BLEND-05 | Zero-member window → empty-state, no ÷0 | unit | `npx vitest run src/lib/scenario.test.ts -t "empty"` | ❌ W0 | ⬜ pending |
| BLEND-06 | `member_count`/`member_ids`/effective window/N in output | unit | `npx vitest run src/lib/scenario.test.ts -t "member_count"` | ❌ W0 | ⬜ pending |
| BLEND-07 | Blend == numpy over max-overlap; divisor == member count | unit (golden) | `npx vitest run src/lib/scenario-blend07.test.ts` | ❌ W0 (new file + fixture + artifact) | ⬜ pending |
| PARITY-02 | Consumers correct on shorter window; stale union comments cleared | existing suites + grep | `npm test` (benchmark/stress/MC/compare/KPI suites) | ✅ existing (re-run) | ⬜ pending |
| PARITY-03 | Frozen-spine guards re-baselined; no-invented-data/252/WCAG green | guard suites | `npx vitest run src/__tests__/phase-{29,30,31,32,52}-frozen-spine-guards.test.ts` | ✅ existing (re-baseline in-place) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/scenario-window.ts` + `src/lib/scenario-window.test.ts` — new helper (`coverageSpanOf`, `defaultWindowFor`, `intersectionOf`) + boundary-cell tests (BLEND-02)
- [ ] New coverage-window cases in `src/lib/scenario.test.ts` — ended-tail no-dilution, divisor==member count, single-member window, interior-gap 0-fill, empty-intersection empty-state, weighted renorm-after-drop, narrow-back typed-weight restore (BLEND-01…06); absent-`window` union byte-compat pin
- [ ] `src/lib/scenario-blend07.test.ts` + committed 6-series fixture + `BLEND-07-verification.md` artifact (numpy script + numbers) (BLEND-07)
- [ ] Frozen-spine guard re-baselines (edit frozen-`scenario.ts` assertions in phases 29/30/31/32; remove `scenario.ts` from phase-52 `FROZEN_ISLANDS`), each annotated `// v1.5 coverage-window re-baseline (ADR-001)`

*Framework already installed — no install task.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | All Phase-55 behaviors have automated verification (compute-core; no UI). Live authed canary is Phase 61. | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter (at validate-phase)

**Approval:** pending
