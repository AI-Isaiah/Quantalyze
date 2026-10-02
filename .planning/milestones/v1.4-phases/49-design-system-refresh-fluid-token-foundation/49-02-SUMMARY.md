---
phase: 49-design-system-refresh-fluid-token-foundation
plan: 02
subsystem: design-tokens
tags: [design-system, fluid-typography, clamp, wcag-1.4.4, theme-vs-inline, drift-test, wave-1]
requires:
  - "49-01: TypeTier interface + empty TYPE_SCALE skeleton + buildClamp helper; the DS-02 clamp guard + DS-03 drift/no-inline guard (both RED)"
provides:
  - "src/lib/design-tokens/typography.ts — TYPE_SCALE populated with all 8 fluid tiers (hero/page-title/h2/h3/body/small/caption/micro), static clamp literals"
  - "src/app/globals.css — new sibling PLAIN @theme {--text-*} block (8 clamp tokens), verbatim-matching TYPE_SCALE; @theme inline colors + --space-grid-gap byte-unchanged"
  - "DESIGN.md — Fluid Type Spine subsection + one 2026-06-29 Decisions Log row"
affects:
  - "Phase 50 (UI-01 primitive refresh) + phases 52/53 (per-surface text-* migration) build on this locked spine"
tech-stack:
  added: []
  patterns:
    - "Tailwind v4 plain @theme (live var) vs @theme inline (baked literal) — fluid type stays var(--text-*) for zoom re-evaluation"
    - "static clamp literals checked in (never buildClamp at module-eval) so the drift test reads them verbatim"
    - "three-way drift gate DESIGN.md <-> plain @theme <-> TS mirror (extends trust-tier-tokens.test.ts)"
key-files:
  created: []
  modified:
    - src/lib/design-tokens/typography.ts
    - src/app/globals.css
    - DESIGN.md
    - tests/visual/fluid-type-tokens.test.ts
decisions:
  - "Used the plan's illustrative anchors verbatim (320→1280px band); all 8 satisfy rem-term + maxPx<=2.5*minPx (hero widest at 1.5x)."
  - "Rule-1 bugfix: the Wave-0 clamp guard's rem-term regex /\\brem\\b/ is unsatisfiable for any CSS length (no word boundary between a digit and `r` in `2rem`); changed to /\\d*\\.?\\d*rem|rem/ per the assertion's documented intent."
  - "Verified plain-@theme behavior against the installed @tailwindcss/postcss 4.3.1 compiler: text-hero emits font-size: var(--text-hero) (live var); @theme inline colors stay baked literals (A3 confirmed)."
metrics:
  duration: ~6 min
  completed: 2026-06-29
---

# Phase 49 Plan 02: Fluid Type-Token Spine Summary

Populated the fluid type spine: `TYPE_SCALE` now holds all eight named tiers as
static `clamp()` literals, a new **plain** `@theme {--text-*}` block in
`globals.css` mirrors them verbatim (keeping `text-*` utilities a live
`var(--text-*)` for zoom-safety), and DESIGN.md documents the spine + a
Decisions Log row — turning the two Wave-0 RED guards (DS-02 clamp guard, DS-03
three-way drift + no-inline guard) fully GREEN.

## What Was Built

| Task | Artifact | Result | Commit |
|------|----------|--------|--------|
| 1 | `src/lib/design-tokens/typography.ts` | `TYPE_SCALE` filled with 8 tiers (hero 32→48, page-title 24→32, h2 20→24, h3 16→18, body 14→16, small 13→14, caption 12→13, micro 10→11), each a static clamp literal; `as const satisfies Record<string, TypeTier>`; type-checks clean | `0d432645` |
| 2 | `src/app/globals.css` (+ Rule-1 fix to `tests/visual/fluid-type-tokens.test.ts`) | New sibling **plain** `@theme { … }` block with 8 `--text-*` clamp tokens copied byte-identically from `TYPE_SCALE`; colors + `--space-grid-gap` byte-unchanged; build-verified `text-hero → var(--text-hero)` | `31ac7eeb` |
| 3 | `DESIGN.md` | "Fluid Type Spine" subsection (8 tiers + px endpoints + plain-vs-inline rationale + rem-term/2.5× invariants + TS-mirror/drift-test refs + additive-migration note) and one appended 2026-06-29 Decisions Log row; no historical row altered | `7b65df42` |

## The two load-bearing subtleties (both handled)

1. **Plain `@theme` vs `@theme inline`.** The 8 `--text-*` tokens live in a NEW
   sibling **plain** `@theme` block, NOT appended into the existing `@theme
   inline` color block. Verified against the installed `@tailwindcss/postcss`
   4.3.1 compiler that `.text-hero { font-size: var(--text-hero); }` (live var,
   so the `clamp()` re-evaluates on zoom) while `.bg-page { background-color:
   #F8F9FA; }` stays a baked literal from `@theme inline`. This confirms
   49-RESEARCH assumption A3 / avoids Pitfall 1.
2. **Zoom-safe clamp shape.** Every tier carries a `rem` middle term and
   satisfies `maxPx ≤ 2.5 × minPx` (and the clamp's own min/max rems satisfy
   `max ≤ 2.5 × min`). The widest tier is hero 32→48 = 1.5×, well inside the cap.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| DS-02 clamp guard GREEN | `npx vitest run tests/visual/fluid-type-tokens.test.ts` | **17 passed** (was 8-failed RED) |
| DS-03 drift + no-inline GREEN | `npx vitest run tests/a11y/design-token-drift.test.ts` | **25 passed** (was 1-failed RED) |
| Both fluid guards together | `npx vitest run tests/visual/fluid-type-tokens.test.ts tests/a11y/design-token-drift.test.ts` | **42 passed** (and again with `--no-file-parallelism`) |
| No color/DESIGN drift | `npx vitest run tests/a11y/trust-tier-tokens.test.ts tests/a11y/chart-contrast.test.ts` (+ the 2 above) | **56 passed** total |
| Plain `@theme` is a live var | `@tailwindcss/postcss` compile of the two blocks | `text-hero → var(--text-hero)`; `bg-page → #F8F9FA` baked |
| `@theme inline` count == 1 ; plain `@theme {` present | grep | `inline: 1 \| plain: 1` |
| Colors + `--space-grid-gap` byte-stable | `git diff src/app/globals.css \| grep --color-/--space-grid-gap` | CLEAN — no such line changed |
| Zero new dependencies | `git diff --stat HEAD~3 -- package.json` | empty |
| Type-check clean | `npx tsc --noEmit` (filtered for typography/globals) | no error in our files |

## Acceptance Criteria

- [x] `TYPE_SCALE` has exactly the 8 named keys; each `clamp` is a static literal with a `rem` term and `maxPx ≤ 2.5*minPx`; type-checks clean.
- [x] New PLAIN `@theme { }` block (no `inline`) added after the `@theme inline` color block; 8 `--text-*` tokens, each byte-identical to `TYPE_SCALE[tier].clamp`.
- [x] No `--text-` token inside `@theme inline`; `@theme inline` count == 1; plain `@theme {` present.
- [x] `git diff src/app/globals.css` shows the new block ONLY — no `--color-*` line or `--space-grid-gap` changed.
- [x] DESIGN.md has a "Fluid Type" section with every tier's px endpoints as literal text; exactly one new Decisions Log row (2026-06-29); only additions in the diff.
- [x] DS-02 clamp guard + DS-03 drift test GREEN; `trust-tier-tokens.test.ts` still GREEN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wave-0 clamp guard's rem-term regex was unsatisfiable**
- **Found during:** Task 2 (running the DS-02 clamp guard against the new tokens).
- **Issue:** `tests/visual/fluid-type-tokens.test.ts` asserted `expect(/\brem\b/.test(args)).toBe(true)` for the rem-term check. In a CSS length like `2rem`, the character before `rem` is a digit (`2`) and `r` is also a word char — so there is **no word boundary** between them, and `/\brem\b/` returns `false`. The guard therefore failed for **every** conformant fluid token (all 8 tiers RED on "has a rem term"), and could never go GREEN for any valid CSS clamp value. This blocked the plan's done-criterion (turn the DS-02 guard GREEN).
- **Fix:** Changed the regex to `/\d*\.?\d*rem|rem/` (a `rem` unit optionally preceded by a numeric prefix, or a bare `rem`) — this exactly encodes the assertion's documented intent ("the clamp args carry a `rem` term") and matches `2rem`, `1.5rem`, `0.0625rem`, etc. Added an explanatory comment.
- **Files modified:** `tests/visual/fluid-type-tokens.test.ts`
- **Commit:** `31ac7eeb` (committed with the globals.css block, since the block + a satisfiable guard are one logical unit)
- **Note:** the DS-03 drift test (`design-token-drift.test.ts`) does NOT use `\brem\b` and was unaffected. Only the clamp guard's rem-term assertion had the bug. The substantive invariants (≥8 tiers, max≤2.5×min, no-inline, verbatim agreement) were already correct.

## Known Stubs

None. `TYPE_SCALE` is now fully populated (all 8 tiers); the Wave-0 skeleton's documented deferral is discharged. The `buildClamp` helper remains an unused-but-exported pure helper (kept per 49-01 for a future generator/derivation use; it is intentionally not called at module-eval so the drift test reads static literals).

## Threat Surface

No new security-relevant surface. Per the plan `<threat_model>`: static CSS `clamp()` literals (author-controlled, not user input — T-49-03 accept), the byte-stability of `--color-*`/`--space-grid-gap` is asserted by `git diff` + the still-green `trust-tier-tokens.test.ts`/`chart-contrast.test.ts` pins (T-49-04 mitigate), and zero package installs (T-49-SC mitigate — `package.json` diff empty). No auth/session/network/input/crypto/data boundary touched.

## Self-Check: PASSED

(See appended self-check block below.)
