---
phase: 49
slug: design-system-refresh-fluid-token-foundation
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
---

# Phase 49 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + ESLint (design-lint) |
| **Config file** | `vitest.config.ts` · `eslint.config.mjs` |
| **Quick run command** | `npx vitest run tests/a11y tests/visual` |
| **Full suite command** | `npm test && npm run lint` |
| **Estimated runtime** | ~60-120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file>`
- **After every plan wave:** Run `npx vitest run tests/a11y tests/visual && npm run lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

> Populated by the planner — each token/lint/contrast/drift invariant maps to an
> automated assertion. Anchored to these phase requirements:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 49-01-T2 | 49-01 | 0 | DS-02 (clamp guard: rem-term + ≤2.5×) | T-49-02 | N/A | unit/grep | `npx vitest run tests/visual/fluid-type-tokens.test.ts` | ❌ W0 (RED stub) | ⬜ pending |
| 49-01-T3 | 49-01 | 0 | DS-03 (3-way drift + no-inline guard) | T-49-02 | N/A | unit | `npx vitest run tests/a11y/design-token-drift.test.ts` | ❌ W0 (RED stub) | ⬜ pending |
| 49-01-T1 | 49-01 | 0 | DS-02/DS-03 (TS mirror skeleton) | T-49-01 | N/A | typecheck | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 49-02-T1 | 49-02 | 1 | DS-02 (TYPE_SCALE 8 tiers populated) | T-49-03 | N/A | unit | `npx vitest run tests/a11y/design-token-drift.test.ts` | ✅ (49-01) | ⬜ pending |
| 49-02-T2 | 49-02 | 1 | DS-02 (plain @theme block, GREEN) | T-49-04 | N/A | unit/grep | `npx vitest run tests/visual/fluid-type-tokens.test.ts tests/a11y/design-token-drift.test.ts` | ✅ (49-01) | ⬜ pending |
| 49-02-T3 | 49-02 | 1 | DS-01 (DESIGN.md refresh + Decisions row) | T-49-04 | N/A | unit | `npx vitest run tests/a11y/design-token-drift.test.ts tests/a11y/trust-tier-tokens.test.ts` | ✅ (49-01) | ⬜ pending |
| 49-03-T1 | 49-03 | 2 | DS-04 (2 lint rules + RuleTester) | T-49-05 | lint-rule backstop | lint (RuleTester) | `npx vitest run tools/eslint-plugin-quantalyze/tests/no-raw-font-px.test.ts tools/eslint-plugin-quantalyze/tests/no-rem-less-clamp.test.ts` | ❌ W0 | ⬜ pending |
| 49-03-T2 | 49-03 | 2 | DS-04 (scoped wiring + allow-list) | T-49-06 | scoped-not-bigbang | lint | `npm run lint` | ❌ W0 | ⬜ pending |
| 49-03-T3 | 49-03 | 2 | DS-05 (AA composed sidebar/accent/semantic) | T-49-05 | AA contrast gate | unit | `npx vitest run tests/a11y/palette-contrast.test.ts` | ❌ W0 (extends chart-contrast) | ⬜ pending |
| 49-04-T1 | 49-04 | 1 | TYPE-01 (truncation audit doc) | T-49-07 | N/A | manual+grep | `test -f .planning/audits/truncation-audit.md && grep -qi accidental-clip …` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/visual/fluid-type-tokens.test.ts` — assert every `--text-*` clamp in globals.css has a `rem` term and `max ≤ 2.5×min` (DS-02). **Plan 49-01 Task 2** (RED stub; GREEN after 49-02).
- [ ] `tests/a11y/design-token-drift.test.ts` — three-way DESIGN.md ↔ globals.css `@theme` ↔ TS mirror equality + fail-if-fluid-tokens-in-`@theme inline` (DS-03), extends `trust-tier-tokens.test.ts`. **Plan 49-01 Task 3** (RED stub; GREEN after 49-02).
- [ ] `src/lib/design-tokens/typography.ts` — empty `TYPE_SCALE` skeleton + `TypeTier` + `buildClamp` so the drift test imports cleanly. **Plan 49-01 Task 1** (filled in 49-02).
- [ ] design-lint rules in `tools/eslint-plugin-quantalyze` (`no-raw-font-px`, `no-rem-less-clamp`) + RuleTester tests + `index.mjs`/`eslint.config.mjs` scoped wiring + allow-list (DS-04). **Plan 49-03 Tasks 1-2.**
- [ ] AA contrast assertions in `tests/a11y/palette-contrast.test.ts` covering the composed sidebar + accent/semantic pairs (DS-05). **Plan 49-03 Task 3.**
- [ ] `.planning/audits/truncation-audit.md` (+ the `.planning/audits/` dir) (TYPE-01). **Plan 49-04 Task 1.**

*Existing infrastructure (vitest, eslint-plugin-quantalyze, DESIGN.md-parsing test pattern) covers the rest — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 400% browser zoom scales text without WCAG 1.4.4 failure | DS-02 | Real-zoom rendering is browser-runtime, not unit-testable here | Open the app, browser zoom to 400%, confirm text scales and no content is lost (the lint `rem`-term + `max≤2.5×min` rules are the automated proxy). |
| Truncation classification correctness (legit vs accidental) | TYPE-01 | Human judgment per site | Reviewer reads `.planning/audits/truncation-audit.md`, confirms each site's classification matches intent. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-06-29 (plans 49-01..49-04)
