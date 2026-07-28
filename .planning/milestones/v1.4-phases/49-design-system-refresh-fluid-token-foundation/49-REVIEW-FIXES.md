# Phase 49 — Specialist + Red-Team Review Fixes (guard hardening)

Date: 2026-06-29
Branch: `gsd/phase-49-design-system-refresh`
Scope: 5 fixes that harden Phase 49 guard tests / lint rules which were giving
false confidence. No frozen file touched (scenario.ts / compute.ts /
FactsheetBody / fonts / accent / `--color-*` / space ladder all byte-unchanged).
The DESIGN.md edit is additive prose only; the parsed token table cells are
byte-stable. `globals.css` was used only as a temporary proof harness and
reverted byte-stable (NOT in any commit).

## The 5 fixes

### FIX 1 [BLOCKER] — `tests/visual/fluid-type-tokens.test.ts` middle-term rem
Commit `c690be49`.
- Old assertion `/\d*\.?\d*rem|rem/.test(args)` matched "rem" ANYWHERE in the
  clamp string, so `clamp(2rem, 3vw, 4rem)` (rem in bounds, vw-only PREFERRED
  term = NOT zoom-safe, WCAG 1.4.4 / F94) passed GREEN — a false-confidence
  no-op.
- Ported `splitTopLevelArgs` verbatim from `no-rem-less-clamp.mjs` (paren-balanced
  top-level comma split, so a `min()`/`max()` term with its own commas isn't
  mis-split) so the Vitest guard and the ESLint rule share ONE definition of
  "rem-safe". Now splits on top-level commas and asserts `args[1]` (preferred
  term) carries a rem/em length (`/[\d.]+\s*r?em\b/`). Kept the proven
  `max ≤ 2.5×min` ratio check unchanged.
- **PROOF:** injected `--text-evil: clamp(2rem, 3vw, 4rem);` into globals.css →
  the middle-term assertion FAILED (`1 failed | 18 passed`), while the ratio
  check (4/2 = 2.0 ≤ 2.5) still PASSED — confirming the middle-term leg is the
  load-bearing addition. Real 8 tokens stay GREEN (17 passed). Injection
  reverted; globals.css byte-stable.

### FIX 2 [HIGH] — `tests/a11y/design-token-drift.test.ts` real DESIGN.md leg
Commit `fd02265e`.
- Old leg `expect(designMd).toContain(String(t.minPx))` was a bare-integer
  substring match anywhere in the 290-line doc — endpoints (or the whole table)
  could drift/vanish while green.
- Now slices the `### Fluid Type Spine` section (to the next `##`/`###` heading,
  the trust-tier-tokens section-slice idiom) and asserts each tier's FULL
  `clamp(...)` string AND its `minPx→maxPx` endpoint pair (the table's own
  format, e.g. `14→16`) appear in that slice. Added a "located the section"
  guard so a renamed/deleted heading can't yield a vacuous pass.
- **PROOF:** corrupting the body row `14→16`→`14→18` FAILED the body tier (the
  old bare `14` substring still matched inside `14→18` — silent drift). Reverted;
  DESIGN.md byte-stable; 26 passed.

### FIX 3 [WARNING] — independent no-inline guard (same file)
Commit `fd02265e` (with FIX 2).
- `extractBlock` used `.exec` (first match only), so a SECOND `@theme inline {`
  block could hide `--text-*` tokens unseen. Added `extractAllInlineBlocks`
  (`matchAll` + balanced-brace concat of every inline block) before the
  `not.toContain('--text-${tier}')` assertion.
- **PROOF:** a `--text-hero` smuggled into a second appended `@theme inline`
  block FAILED the no-inline assertion (invisible to the old single-exec path).
  Appended block removed; globals.css byte-stable.

### FIX 4 [WARNING] — harden the two lint rules + RuleTester cases
Commit `2b7b2a22`.
- `no-raw-font-px.mjs`: `\d+`→`\d+(?:\.\d+)?` and `i` flag, so `text-[14.5px]` /
  `text-[16PX]` / `fontSize:'14.5px'` are caught (rule is ERROR on
  `src/lib/design-tokens/**`). Added invalid RuleTester cases (14.5px className,
  16PX className, 14.5px style) and valid cases (`text-[0.875rem]`,
  `leading-[14px]`); `w-[14px]` stays valid.
- `no-rem-less-clamp.mjs`: viewport-unit regex `vw`→`v(?:w|h|min|max)` (a
  `clamp(2px, 3vh, 4px)` font-size is equally F94-unsafe). Deliberately NOT
  `cqw` (container queries intentional). Added invalid `clamp(2rem, 3vh, 4rem)`;
  numeric `clamp(2, n, 9)` and rem-middle `clamp(2rem, 1.5rem + 2.5vw, 3rem)`
  stay valid.

### FIX 5 [NIT] — honesty corrections
Commit `33afaf39`.
- `typography.ts`: already says "200% zoom reach" (≤2.5×min guarantees 200%, not
  the 400% of SC 1.4.10 reflow). No "400%" claim existed anywhere on the
  type-spine surface → no comment change needed.
- `DESIGN.md`: added a prose-only line to the §Fluid Type Spine migration
  posture noting `no-raw-font-px` errors only on the clean
  `src/lib/design-tokens/**` surface today (warn across `src/**`) and ratchets
  to error per-surface in phases 52/53 — so DS-04's raw-px rejection is honestly
  framed as scoped, not app-wide. Table cells byte-stable.

## Verification (all green on the real tree)

- `npx vitest run tests/visual/fluid-type-tokens.test.ts
  tests/a11y/design-token-drift.test.ts tests/a11y/palette-contrast.test.ts
  tools/eslint-plugin-quantalyze/tests/no-raw-font-px.test.ts
  tools/eslint-plugin-quantalyze/tests/no-rem-less-clamp.test.ts`
  → **5 files / 91 tests passed**.
- `npm run lint` → **0 errors, 577 warnings**. The hardened decimal/uppercase
  regex added no errors; `src/lib/design-tokens/**` lints clean in isolation
  (`npx eslint 'src/lib/design-tokens/**' ` exit 0). The 577 warnings are the
  pre-existing dirty `src/**` raw-px baseline (ratcheted in 52/53).
- `npx tsc --noEmit` → exit 0.

## Commits (5, atomic on `gsd/phase-49-design-system-refresh`)

- `c690be49` test(49-review): enforce rem in the clamp MIDDLE term (FIX 1)
- `fd02265e` test(49-review): real DESIGN.md drift leg + all inline blocks (FIX 2+3)
- `2b7b2a22` fix(49-review): harden the two DS-04 lint rules + RuleTester (FIX 4)
- `33afaf39` docs(49-review): scope-note DS-04 lint (FIX 5)

## Files touched (7, exactly the intended set)
- tests/visual/fluid-type-tokens.test.ts
- tests/a11y/design-token-drift.test.ts
- tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs
- tools/eslint-plugin-quantalyze/rules/no-rem-less-clamp.mjs
- tools/eslint-plugin-quantalyze/tests/no-raw-font-px.test.ts
- tools/eslint-plugin-quantalyze/tests/no-rem-less-clamp.test.ts
- DESIGN.md (additive prose only; token table byte-stable)
