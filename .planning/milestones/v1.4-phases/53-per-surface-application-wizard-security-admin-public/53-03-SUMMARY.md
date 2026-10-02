---
phase: 53-per-surface-application-wizard-security-admin-public
plan: 03
subsystem: ui
tags: [marketing, security, fluid-type, design-tokens, eslint, no-clip, wcag, tailwind-v4]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "the named fluid --text-* @theme tiers (page-title/h2/body/caption/hero/micro) the bodies migrate onto"
  - phase: 52-allocator-journey-per-surface-application
    provides: "the per-surface no-raw-font-px error-ratchet strangler block + the per-file ratchet precedent"
  - phase: 51-shell-ia
    provides: "the (marketing) route group shell/masthead/LegalFooter + route-contract guard this plan leaves byte-unchanged"
provides:
  - "/security migrated to the 4-tier prose spine (page-title/h2/body/caption); 6 persistent-underline accent links + 9 stable wizard-deeplink anchors preserved"
  - "marketing page BODIES (home, for-quants, demo, demo/founder-view, legal/{disclaimer,privacy,terms}) conformed to the fluid tiers"
  - "two accidental /demo line-clamp-2 description clips recovered via break-words wrap (no clip relocated)"
  - "marketing/security PAGE-BODY globs + (auth)/** ratcheted to no-raw-font-px error (npm run lint green)"
affects: [phase-54-app-wide-verification, BP-03-repo-wide-font-px-flip, marketing-conformance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-surface prose tier budget: marketing/security category = page-title/h2/body/caption (4 tiers) + --text-hero (landing-home-only exception) + --text-micro (badge-only exception)"
    - "no-raw-font-px error ratchet scoped per-FILE to page bodies (not directory glob) so the still-dirty shared P51 shell + component files stay at repo-wide warn"
    - "no-clip recovery on prose descriptions = drop line-clamp + add break-words (wrap, never a new bare clip)"

key-files:
  created:
    - ".planning/phases/53-per-surface-application-wizard-security-admin-public/53-03-SUMMARY.md"
  modified:
    - "src/app/(marketing)/security/page.tsx"
    - "src/app/(marketing)/page.tsx"
    - "src/app/(marketing)/for-quants/page.tsx"
    - "src/app/(marketing)/demo/page.tsx"
    - "src/app/(marketing)/demo/founder-view/page.tsx"
    - "src/app/(marketing)/legal/disclaimer/page.tsx"
    - "src/app/(marketing)/legal/privacy/page.tsx"
    - "src/app/(marketing)/legal/terms/page.tsx"
    - "eslint.config.mjs"

key-decisions:
  - "no-raw-font-px rule only flags text-[Npx]/fontSize:'Npx' (NOT Tailwind named scales); migrated BOTH bracket-px AND named scales (text-sm/base/lg/xl/2xl) to satisfy the plan's verify grep + the DESIGN.md ≤4-tier conformance contract"
  - "Kept font-display (Instrument Serif) on /security section H2s while swapping the SIZE token text-2xl→text-h2 — conform the zoom-safe size without an unrequested family restyle (editorial document hero is locked copy/layout)"
  - "for-quants H1 → --text-page-title (it is a marketing BODY page, not the home hero); --text-hero reserved for the landing home H1 only"
  - "home stat-counter numbers → --text-page-title (font-metric family); /demo rank pill → --text-micro (badge exception)"
  - "Scoped the eslint error ratchet per-FILE to the 8 page bodies + (auth)/** — excluded the still-dirty shared shell (legal/layout.tsx, demo/layout.tsx) + for-quants component files (RequestCallModal.tsx, ForQuantsCtas.tsx), which stay at repo-wide warn"

patterns-established:
  - "Marketing prose tier budget enforced per-surface: 4 tiers + landing-hero + badge-micro exceptions"
  - "Per-file no-raw-font-px ratchet excludes shared-shell debt"

requirements-completed: [APPLY-03, BP-02]

# Metrics
duration: 9min
completed: 2026-06-29
---

# Phase 53 Plan 03: /security + Marketing Bodies Fluid-Type Conformance Summary

**Migrated /security (31 raw font tokens) + 6 public marketing page bodies onto the named fluid --text-* tiers, recovered two accidental /demo description clips, and ratcheted the marketing/security/auth no-raw-font-px glob to error — P51 shell, masthead, footer, and the /demo Meeting-hero editorial layout left byte-unchanged.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-29T16:57:16Z
- **Completed:** 2026-06-29T17:06:26Z
- **Tasks:** 2
- **Files modified:** 9 (8 page bodies + eslint.config.mjs)

## Accomplishments
- /security: all 31 raw font tokens → page-title/h2/body/caption (exactly 4 prose tiers); the 6 persistent-underline accent body links (WCAG 1.4.1, codified Phase 48) and all 9 stable wizard-deeplink anchors (#readonly-key … #thresholds) preserved.
- Marketing bodies migrated: home (hero H1 → --text-hero landing-only; sections → h2; stat counters → page-title), for-quants (H1 → page-title; sections → h2), demo (Meeting-hero editorial layout untouched; rank pill → micro badge), demo/founder-view, and the three legal pages (H1 → page-title, dates → caption).
- Two accidental `/demo` `line-clamp-2` strategy-description clips (holdings list :266 + recommendation card :486, both "no expand" per the truncation audit) recovered with `break-words` wrap — full text now visible, no clip relocated.
- no-raw-font-px ratcheted to `error` for the /security tree, the 7 marketing page bodies (per-file), and `(auth)/**`; `npm run lint` green (0 errors); route-contract + admin-route-manifest guards green; PUBLIC_ROUTES unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate /security + marketing body type to fluid tiers and fix in-scope clips** - `1752a929` (feat)
2. **Task 2: Flip the marketing + /security no-raw-font-px glob to error** - `cf554e24` (chore)

**Plan metadata:** (final docs commit — this SUMMARY + STATE/ROADMAP/REQUIREMENTS)

## Files Created/Modified
- `src/app/(marketing)/security/page.tsx` - 31 raw tokens → 4 fluid prose tiers; accent links + anchors preserved
- `src/app/(marketing)/page.tsx` - landing hero → --text-hero; sections → h2; stats → page-title; labels → caption
- `src/app/(marketing)/for-quants/page.tsx` - H1 → page-title (body page, not home hero); sections → h2
- `src/app/(marketing)/demo/page.tsx` - tiers migrated; two line-clamp-2 clips → break-words; rank pill → micro; Meeting-hero layout untouched
- `src/app/(marketing)/demo/founder-view/page.tsx` - back-link text-sm → body
- `src/app/(marketing)/legal/disclaimer/page.tsx` - H1 → page-title; date → caption
- `src/app/(marketing)/legal/privacy/page.tsx` - H1 → page-title; date → caption
- `src/app/(marketing)/legal/terms/page.tsx` - H1 → page-title; date → caption
- `eslint.config.mjs` - added the 8 migrated page-body globs + (auth)/** to the no-raw-font-px error block

## Decisions Made
- **Rule-vs-contract scope:** the `no-raw-font-px` rule only catches `text-[Npx]`/`fontSize:'Npx'`, NOT Tailwind named scales. Migrated BOTH (bracket-px and `text-sm/base/lg/xl/2xl`) because the plan's verify grep checks named scales too and the DESIGN.md ≤4-tier conformance contract requires it. This is why the surface is now genuinely tier-clean, not merely rule-passing.
- **Family preservation on /security H2s:** swapped only the size token (`text-2xl` → `text-h2`) and kept `font-display` (Instrument Serif), so the locked editorial document hero gets the zoom-safe fluid size without an unrequested serif→sans family restyle.
- **--text-hero discipline:** applied to the home H1 only (landing exception); for-quants H1 (a marketing body page) → `--text-page-title`.
- **Badge exception:** the /demo recommendation rank pill (`rounded-full bg-accent/10`) → `--text-micro` (the sanctioned badge-only 5th tier).
- **Per-file eslint ratchet:** scoped to the 8 page bodies + `(auth)/**`; deliberately EXCLUDED the still-dirty shared P51 shell (`legal/layout.tsx`, `demo/layout.tsx`) and for-quants component files (`RequestCallModal.tsx`, `ForQuantsCtas.tsx`), which stay at the repo-wide `warn` (deferred debt). A directory glob would have red CI on those.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Migrated Tailwind named font scales, not just bracket-px**
- **Found during:** Task 1 (all 8 page bodies)
- **Issue:** The plan's headline counts ("27 raw text-[Npx]" on /security) and the acceptance phrasing "0 raw text-[Npx]" could read as bracket-px-only, but the plan's own `<verify>` grep also matches `text-(xs|sm|base|lg|xl)` and the DESIGN.md/UI-SPEC conformance exit requires ≤4 named tiers per category. The `no-raw-font-px` lint rule itself only flags bracket-px — so a bracket-only migration would leave named scales (`text-sm`, `text-base`, `text-2xl`, `text-lg`, `text-xl`) on the surface, failing the verify grep and the conformance contract while still passing lint.
- **Fix:** Migrated every raw font token (bracket-px AND named scale) onto the named `--text-*` tiers across all 8 files.
- **Files modified:** all 8 marketing page bodies.
- **Verification:** `grep -RnE "text-\[[0-9]+px\]|text-(xs|sm|base|lg|xl)\b"` scoped to the 8 files = 0; tier census ≤4 per surface (+ hero/micro exceptions).
- **Committed in:** `1752a929`

---

**Total deviations:** 1 auto-fixed (1 missing-critical scope clarification)
**Impact on plan:** The fix makes the surface genuinely conformance-clean (the plan's true intent) rather than merely lint-passing. No scope creep — still only the 8 listed page bodies + eslint.config.mjs.

## Issues Encountered
- The Prettier/lint formatter rewrote `security/page.tsx` mid-edit (twice), invalidating Edit's exact-match. Resolved by re-reading and using anchored `perl -0pi` token swaps for the recurring class strings, then targeted edits for the unique ones. No content impact.

## Known Stubs
None — all changes are class-token swaps + two clip recoveries on existing rendered prose. No hardcoded empties, placeholders, or unwired data introduced.

## Threat Flags
None — no new network endpoint, auth path, file-access pattern, or schema change. The threat register's T-53-06 (route move / PUBLIC_ROUTES drift) is mitigated as planned: no route moved, all pages stay `page.tsx` in place, PUBLIC_ROUTES unchanged, route-contract + admin-route-manifest guards green.

## Verification
- `grep -RnE "text-\[[0-9]+px\]|text-(xs|sm|base|lg|xl)\b"` scoped to the 8 in-scope page bodies = **0** (clean).
- `npx tsc --noEmit` = exit 0.
- `npm run lint` = **0 errors**, 395 pre-existing repo-wide warnings (none on the migrated globs); `[check-route-contract] OK — 56 page routes`; `[check-admin-route-manifest] OK — 20 admin routes`.
- `(auth)/**` confirmed 0 `text-[Npx]`/`fontSize:px` before the error flip (PATTERNS A4).
- PUBLIC_ROUTES (/security, /demo, /for-quants, /legal) present + `src/proxy.ts` byte-unchanged.
- P51 shell/masthead/LegalFooter + nested `legal/layout.tsx`/`demo/layout.tsx` NOT in the diff (git diff = page bodies + eslint only; 100 ins / 100 del = pure token swaps).
- **Not run:** `npx playwright test e2e/reflow-sweep-authed.spec.ts -g "security"` — the Bash sandbox has no network and the spec is authed/headed. Risk is low: the change is pure type-token swaps on static RSC prose (no layout/structure change), and the only structural edit removed two clips and added `break-words`, which reduces (never increases) horizontal-overflow risk. Static diff scan confirmed no overflow-causing classes (whitespace-nowrap / fixed widths) were introduced. Defer the live 320px reflow row to the Phase-54 verification sweep.

## Next Phase Readiness
- /security + the public marketing bodies are now on the fluid spine and lint-locked at `error`.
- Remaining Phase-53 marketing debt (deferred to a later 53/54 surface, still at repo-wide `warn`): the shared P51 shell `legal/layout.tsx` + `demo/layout.tsx`, and the for-quants component files `RequestCallModal.tsx` + `ForQuantsCtas.tsx`.
- Phase-54 BP-03 (repo-wide no-raw-font-px flip) + the 320px authed reflow row remain open as planned.

## Self-Check: PASSED

- Files: all 8 modified page bodies + eslint.config.mjs FOUND on disk; SUMMARY created.
- Commits: `1752a929` (Task 1) and `cf554e24` (Task 2) FOUND in git log.

---
*Phase: 53-per-surface-application-wizard-security-admin-public*
*Completed: 2026-06-29*
