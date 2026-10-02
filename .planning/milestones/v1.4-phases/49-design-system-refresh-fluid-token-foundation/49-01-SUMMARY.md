---
phase: 49-design-system-refresh-fluid-token-foundation
plan: 01
subsystem: design-tokens
tags: [design-system, fluid-typography, drift-test, wcag-1.4.4, tdd-red, wave-0]
requires: []
provides:
  - "src/lib/design-tokens/typography.ts — TypeTier interface + empty TYPE_SCALE skeleton + buildClamp helper (the TS mirror 49-02 fills and the drift test imports)"
  - "tests/visual/fluid-type-tokens.test.ts — DS-02 clamp guard (rem-term + 2.5x ratio over every --text-* in globals.css)"
  - "tests/a11y/design-token-drift.test.ts — DS-03 three-way drift + no-inline guard"
affects:
  - "49-02 (Wave 1): fills TYPE_SCALE, adds the plain @theme {--text-*} block to globals.css, adds px endpoints to DESIGN.md — turning all three RED tests GREEN"
tech-stack:
  added: []
  patterns:
    - "as-const-satisfies token SoT mirroring src/lib/design-tokens/trust-tier.ts"
    - "grep-over-source guard (strategy-v2-type-scale.test.ts) + globals.css regex-pin (chart-contrast.test.ts)"
    - "DESIGN.md-parse verbatim-includes drift gate (trust-tier-tokens.test.ts) + hand-rolled brace-balancer (no parser dep)"
    - "RED-first executable test contract before implementation (Nyquist)"
key-files:
  created:
    - src/lib/design-tokens/typography.ts
    - tests/visual/fluid-type-tokens.test.ts
    - tests/a11y/design-token-drift.test.ts
  modified: []
decisions:
  - "Both guard tests ship RED against the current tree — the executable spec precedes the tokens (Wave 0); GREEN is 49-02's job."
  - "extractBlock returns \"\" (not throw) when the plain @theme opener is absent, so a missing block fails the verbatim-contains assertions cleanly rather than erroring on collection."
  - "An explicit top-level it(\">= 8 tiers\") guard keeps the DS-03 suite RED (not vacuously green) while TYPE_SCALE is empty and the per-tier it.each blocks have zero cases."
metrics:
  duration: ~2 min
  completed: 2026-06-29
---

# Phase 49 Plan 01: Fluid Type-Token Foundation (RED Contract) Summary

Established the Wave-0 executable test contract for the fluid type spine — a `TypeTier`/`TYPE_SCALE`/`buildClamp` TS skeleton plus the DS-02 clamp guard and DS-03 three-way drift+no-inline guard — all RED against the current tree so DS-02/DS-03 have automated assertions the moment the tokens land in 49-02.

## What Was Built

| Task | Artifact | Result | Commit |
|------|----------|--------|--------|
| 1 | `src/lib/design-tokens/typography.ts` | `TypeTier` interface (readonly minPx/maxPx/clamp), empty `TYPE_SCALE` as-const-satisfies, pure `buildClamp` helper; framework-neutral, type-checks clean | `04b0a894` |
| 2 | `tests/visual/fluid-type-tokens.test.ts` | DS-02 clamp guard: greps `--text-*: clamp(...)` from globals.css, asserts >=8 tiers + per-token rem-term + max<=2.5x min. RED (0 tokens exist). | `d765c11d` |
| 3 | `tests/a11y/design-token-drift.test.ts` | DS-03: imports `TYPE_SCALE`, reads DESIGN.md + globals.css, `extractBlock` brace-balancer splits `@theme inline` vs plain `@theme`, four Pattern-4 asserts + explicit `>=8 tiers` guard. RED (TYPE_SCALE empty). | `f0c1a9cd` |

## RED-State Confirmation (the Wave-0 contract)

Both guard tests are intentionally RED against the current tree — this is the expected and required Wave-0 state, not a failure:

- `tests/visual/fluid-type-tokens.test.ts` → FAIL on `declares at least the 8 named tiers` (`expected 0 to be greater than or equal to 8`). No `--text-*: clamp(...)` declaration exists in `src/app/globals.css` yet (only the `@theme inline` block at line 3; no plain `@theme` block).
- `tests/a11y/design-token-drift.test.ts` → FAIL on `declares >= 8 tiers` (`expected 0 to be greater than or equal to 8`). `TYPE_SCALE` is the empty skeleton.

Both files **collect cleanly** (no import / module-resolution / collection error) — they fail on assertions, exactly as the plan requires. They go GREEN when 49-02 (Wave 1) fills `TYPE_SCALE`, adds the plain `@theme {--text-*}` block, and adds the px endpoints to DESIGN.md.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Both guards collect + RED | `npx vitest run tests/visual/fluid-type-tokens.test.ts tests/a11y/design-token-drift.test.ts` | 2 files / 2 tests FAILED — RED as required, no collection error |
| No type error from skeleton | `npx tsc --noEmit -p tsconfig.json` (filtered for `typography`) | no error originating in `typography.ts` |
| Framework-neutral | `grep -rL "react" src/lib/design-tokens/typography.ts` | returns the path (no React import) |
| Zero new dependencies | `git diff --stat package.json` (over the 3 task commits) | empty — no dep change |

## Acceptance Criteria

- [x] `typography.ts` exists, exports `TypeTier`, `TYPE_SCALE`, `buildClamp`; framework-neutral; type-checks; `TYPE_SCALE` is an empty `as const satisfies Record<string, TypeTier>`.
- [x] `tests/visual/fluid-type-tokens.test.ts` collected by Vitest, references `globals.css` via `readFileSync`, contains the `--text-` / `clamp(` literals, RED on the ">= 8 tiers" assertion, no external import.
- [x] `tests/a11y/design-token-drift.test.ts` imports `TYPE_SCALE` from `@/lib/design-tokens/typography`, reads DESIGN.md + globals.css, contains the `extractBlock` brace-balancer distinguishing `@theme inline` from plain `@theme`, RED via the explicit `>= 8 tiers` assertion, includes the `expect(inlineBlock).not.toContain("--text-…")` no-inline assertion.

## Deviations from Plan

None — plan executed exactly as written. Rules 1-3 (auto-fix bug / add critical functionality / fix blocking) were not triggered: the tasks are additive build/CI-tier artifacts with no runtime surface. The empty `TYPE_SCALE` and the two failing tests are the plan-mandated Wave-0 state, not defects.

## Known Stubs

The empty `TYPE_SCALE = {} as const satisfies Record<string, TypeTier>` in `src/lib/design-tokens/typography.ts` is an **intentional, plan-mandated** skeleton (the eight tier rows are deliberately deferred to 49-02 / Wave 1 per the plan's `<interfaces>` and Task 1 action). It is documented in the file's `// Tiers populated in 49-02 (Wave 1).` comment and is the reason the drift test fails on assertions rather than on a missing module. This is the RED-first contract — not a stub that prevents the plan's goal; the plan's goal *is* the RED contract.

## Threat Surface

No new security-relevant surface. Per the plan `<threat_model>`, this plan creates only build/CI-tier test files + a static TS const skeleton — no auth, session, network, input-handling, crypto, or data-access boundary is touched. The no-new-dependency posture (T-49-01 / T-49-SC) is asserted and verified (`package.json` diff empty). The drift/clamp tests `readFileSync` only author-controlled in-repo files (DESIGN.md, globals.css) at build time (T-49-02 accept).

## Notes for 49-02 (Wave 1)

To turn all three tests GREEN, Wave 1 must:
1. Fill `TYPE_SCALE` with the eight tiers (hero 48/32 · page-title 32 · h2 24 · h3 16 · body 14 · small 13 · caption 12 · micro 10-11), each `clamp` carrying a `rem` term and `maxPx <= 2.5*minPx`.
2. Add a **plain** `@theme {…}` block (NOT `@theme inline`) to `src/app/globals.css` whose `--text-${tier}: ${clamp}` lines match `TYPE_SCALE[tier].clamp` **verbatim**.
3. Add the px endpoints to DESIGN.md §Typography so `designMd.toContain(String(minPx))` passes.
The `buildClamp` helper is available to derive the strings, but the checked-in `clamp` field must be a literal string (the drift test reads it verbatim).

## Self-Check: PASSED

All created files exist on disk (`typography.ts`, both guard tests, `49-01-SUMMARY.md`) and all three task commits (`04b0a894`, `d765c11d`, `f0c1a9cd`) are present in the git log.
