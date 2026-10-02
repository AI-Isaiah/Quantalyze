---
phase: 52-per-surface-application-allocator-journey
plan: 05
subsystem: frontend
tags: [next-app-router, loading-tsx, error-tsx, fluid-type-tokens, prose-measure, frozen-spine, strategy-detail]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "the named fluid --text-page-title clamp tier the H1 px migration lands on"
  - phase: 52-01
    provides: "the frozen-spine git-delta guard (BP-01) this plan's Task 3 verifies zero-diff against"
provides:
  - "strategy/[id] route-level loading.tsx (STATE-01) — narrow-measure (max-w-3xl) page-title + headline-metric skeleton with sr-only role=status"
  - "strategy/[id] route-level error.tsx (STATE-01 / T-52-15) — subtree-wide digest-only boundary with unstable_retry, additive to the untouched v2 child"
  - "zero raw text-[Npx] on the strategy/[id] surface (clean for the Wave-3 no-raw-font-px=error ratchet in 52-07)"
affects: [52-07, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "prose-page route skeleton: the loading.tsx mirrors the page's narrow max-w-3xl measure (NOT the 1920 fluid-fill used on data surfaces) so a detail/prose page does not jump on arrival"
    - "digest-only route error boundary mirroring (dashboard)/error.tsx: console.error([scope-error]) for diagnostics + render error.digest only, never the thrown message (Information Disclosure mitigation)"

key-files:
  created:
    - "src/app/strategy/[id]/loading.tsx"
    - "src/app/strategy/[id]/loading.test.tsx"
    - "src/app/strategy/[id]/error.tsx"
    - "src/app/strategy/[id]/error.test.tsx"
  modified:
    - "src/app/strategy/[id]/page.tsx"

key-decisions:
  - "Single-strategy is a PROSE page (UI-SPEC layout table) — the loading skeleton and page keep the narrow readable max-w-3xl measure and do NOT fluid-fill to 1920 (that is reserved for data surfaces like compare/discovery)."
  - "The H1 px migration text-[32px] font-bold -> font-serif text-page-title leading-tight follows DESIGN.md (Instrument Serif for strategy names in detail view; --text-page-title clamps 24->32px) and matches the sibling discovery [strategyId] prose page migrated in 52-04 — consolidating the prose-title idiom rather than a bare px->tier swap that would leave the sans-bold family."
  - "The new error.tsx is the subtree-wide SIBLING boundary mirroring the canonical (dashboard)/error.tsx digest-only shape; the existing v2/error.tsx child (usePathname v1-fallback idiom) is left byte-untouched — they nest, the route-level one covers the v1 page too."
  - "Doc-comment wording was sanitized so the acceptance greps are unambiguous: loading.tsx contains no literal \"use client\" string and error.tsx contains no 'error.message'/'error message' substring (the grep . wildcard would otherwise match 'error message' prose) — keeps the Wave-3 audit greps clean without changing behavior."

patterns-established:
  - "A route's loading.tsx adopts the SAME width-measure decision as its page: narrow (max-w-3xl) for prose/detail, fluid (max-w-[1920px]) for data surfaces — pinned by an assertion in the loading test."

requirements-completed: [APPLY-01, TYPE-02, TYPE-03, STATE-01, STATE-02, BP-01]

# Metrics
duration: 5min
completed: 2026-06-29
---

# Phase 52 Plan 05: Single-Strategy Surface (loading/error + prose-measure type) Summary

**The `/strategy/[id]` prose surface reaches the v1.4 bar: a narrow-measure (max-w-3xl) page-title-anchored route `loading.tsx`, a subtree-wide digest-only `error.tsx` with `unstable_retry`, and the lone raw `text-[32px]` H1 migrated onto the `--text-page-title` Instrument-Serif tier — the surface is now raw-font-px-clean for the Wave-3 ratchet, with the frozen islands and the `v2` child boundary untouched.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-29T11:53:49Z
- **Completed:** 2026-06-29T11:58:30Z
- **Tasks:** 3 completed
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- **STATE-01 loading** — `strategy/[id]/loading.tsx` is an RSC skeleton at the narrow prose measure (`mx-auto max-w-3xl px-4 py-12 sm:px-6`, `animate-pulse` on the shell). Dominant anchor: an Instrument-Serif page-title line (`Skeleton h-8 w-2/3`, the 32px page-title upper bound) + a 6-card headline-metric block mirroring the page's `grid-cols-2 sm:grid-cols-3` summary panel + an equity-chart placeholder (`h-[280px] w-full`) at the same narrow width. Closed by an `sr-only role="status" aria-live="polite"` liveness hint. It does NOT fluid-fill to 1920 (single-strategy is prose, not a data surface).
- **STATE-01 / T-52-15 error** — `strategy/[id]/error.tsx` is the subtree-wide sibling boundary mirroring the canonical `(dashboard)/error.tsx`: `"use client"`, `unstable_retry` (Next 16.2.0 — not `reset`), `console.error("[strategy-error]", error)` on mount, and a digest-ONLY surface (`{error.digest && Error ID: {digest}}`) that never renders the thrown message. The existing `v2/error.tsx` child boundary is left untouched (additive nest).
- **TYPE-02/03 / STATE-02 px migration** — the single raw `text-[32px] font-bold` H1 migrated to `font-serif text-page-title leading-tight` (Instrument Serif, fluid 24→32px), matching the sibling discovery `[strategyId]` prose page. The surface now has ZERO raw `text-[Npx]` (clean for the 52-07 `no-raw-font-px=error` ratchet). The narrow `max-w-3xl` prose measure is preserved; the honest `notFound()` / `sparkline_returns.length >= 2` gate / "Analytics are being computed" degenerate branches are intact; `eslint.config.mjs` untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: route loading.tsx (narrow-measure page-title anchor) + test** — `14f42f2b` (feat)
2. **Task 2: route-level error.tsx (digest-only, unstable_retry) + test** — `4fc5f5b8` (feat)
3. **Task 3: migrate H1 raw text-[32px] onto --text-page-title** — `2d7e30a3` (refactor)

## Files Created/Modified

- `src/app/strategy/[id]/loading.tsx` — narrow-measure RSC skeleton (page-title + headline-metric + equity-chart placeholder, sr-only role=status).
- `src/app/strategy/[id]/loading.test.tsx` — smoke-render + `getByRole("status")` + asserts narrow `max-w-3xl` and absence of `max-w-[1920px]`.
- `src/app/strategy/[id]/error.tsx` — subtree-wide digest-only error boundary, `unstable_retry`, `console.error("[strategy-error]", …)`.
- `src/app/strategy/[id]/error.test.tsx` — heading + both CTAs, retry invokes `unstable_retry`, console.error fires on mount, and a Rule-9 digest-shown / raw-message-NOT-leaked assertion (renders a secret message, asserts it never reaches the DOM).
- `src/app/strategy/[id]/page.tsx` — H1 px→tier migration (1 line); everything else byte-unchanged.

## Verification

- `npx vitest run "src/app/strategy/[id]/loading.test.tsx" "src/app/strategy/[id]/error.test.tsx" src/__tests__/phase-52-frozen-spine-guards.test.ts` → **Test Files 3 passed, Tests 16 passed**.
- `npx vitest run "src/app/strategy/[id]/page.test.tsx"` → **3 passed** (the source-shape analytics-gate + StrategyNoteCard insertion guards still hold after the H1 migration).
- Coverage on the two new route files: **100% statements / 100% branches / 100% functions / 100% lines** (8/8, 2/2, 5/5, 8/8) — they raise the numerator, keeping the blocking `frontend-coverage` gate green.
- `npx tsc --noEmit -p tsconfig.json` → **no errors originate in the strategy/[id] loading/error/page files** (the loading/error prop shapes match Next 16.2.0).
- Acceptance greps: raw `text-[Npx]` on the surface = **0**; `loading.tsx` `"use client"` directive = **0**; `error.tsx` `error.message` = **0**; `max-w-3xl` in page.tsx = **1**, `max-w-[1920px]` = **0**; `getPublicStrategyDetail` still in page = present; `v2/error.tsx` in the plan diff = **0** (child untouched).
- Frozen-spine guard (BP-01) → **9 passed** — EquityChart/TouchTooltip/useTapPin and the other islands are zero-diff; the new sibling loading/error wrap the page in Suspense/error boundaries without RSC-ifying any island (T-52-16).

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, blocking issues, or architectural changes encountered. No package installs (CSS/route-file/test-only phase, per threat register T-52-SC). No auth gates.

Two cosmetic doc-comment rewordings were applied so the acceptance greps are unambiguous (not behavior changes): the loading.tsx comment no longer contains the literal `"use client"` string, and the error.tsx comment no longer contains the `error.message` / `error message` substring (the acceptance grep's `.` is a regex wildcard that matched the prose "error message"). The components are unchanged in behavior.

## Known Stubs

None. The `loading.tsx` is a complete skeleton; the `error.tsx` is a complete digest-only boundary. The page's "Analytics are being computed. Check back soon." block is the pre-existing HONEST degenerate state (analytics not yet computed) — it is not a stub and was preserved verbatim per the plan (no fabricated zeros).

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes were introduced. The new `error.tsx` is the in-register T-52-15 surface and is mitigated as planned (digest-only, asserted by Test 4). The frozen islands (T-52-16) are proven zero-diff by the BP-01 guard.

## Self-Check: PASSED

- Files: `loading.tsx`, `loading.test.tsx`, `error.tsx`, `error.test.tsx` exist; `page.tsx` modified — all present on disk.
- Commits: `14f42f2b`, `4fc5f5b8`, `2d7e30a3` all present in git log.
- `.planning/` is gitignored (local-only, per PR #530) — this SUMMARY is written to disk but not committed; the three code commits are the complete deliverable.
