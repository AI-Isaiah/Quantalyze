---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
round: 3
reviewed: 2026-11-07T13:25:38Z
depth: standard
diff_base: 58e2ec0fb
fix_commits:
  - afd974efa
  - 8b5e4c0df
files_reviewed: 5
files_reviewed_list:
  - src/components/layout/Breadcrumb.tsx
  - src/components/layout/Breadcrumb.test.tsx
  - src/app/browse/[slug]/page.tsx
  - src/app/browse/[slug]/[strategyId]/page.tsx
  - src/app/browse/breadcrumb-root.test.tsx
callers_checked:
  - src/components/layout/PageHeader.tsx
  - src/app/(dashboard)/strategies/[id]/edit/page.tsx
  - src/app/(dashboard)/discovery/[slug]/page.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
  - src/app/(dashboard)/decks/page.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/(dashboard)/compare/page.tsx
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
medium_plus: 0
resolved_from_round_2:
  - WR-01
  - WR-02
carried_unchanged_from_round_2:
  - IN-01
  - IN-02
  - IN-03
  - IN-04
  - IN-05
status: issues_found
---

# Phase 195: Code Review Report (round 3)

**Reviewed:** 2026-11-07T13:25:38Z
**Depth:** standard
**Files Reviewed:** 5 (`git diff --name-only 58e2ec0fb..HEAD`), plus every `Breadcrumb` caller under `src`
**Status:** issues_found (INFO only; **0 MEDIUM+**)

## Summary

This round re-reviews the two fix commits for round 2's warnings: `afd974efa` (WR-01) and `8b5e4c0df` (WR-02). What I measured in the worktree:

- `npx tsc --noEmit` prints nothing.
- 19 vitest files pass (459 tests): everything under `src/components/layout`, `src/app/browse`, `src/app/(dashboard)/compare` and `src/app/(dashboard)/strategies/[id]/edit`, plus `trim-removed-surfaces.test.tsx`.
- **The new tests can fail.** In a throwaway detached worktree (since removed), I put back `Breadcrumb.tsx` from `58e2ec0fb`. The new WR-01 case went RED (1 failed, 4 passed). I then put back both browse pages from `58e2ec0fb` with the fixed component in place. Both new WR-02 cases went RED (2 failed, 5 passed). The worktree under review was not modified.

| Round-2 finding | Verdict |
|---|---|
| WR-01: the unlinked "Browse" crumb is announced and styled as the current page | **RESOLVED.** `Breadcrumb.tsx:42` now uses `i === items.length - 1`, not "has no href", to pick the `aria-current="page"` + `text-text-primary font-medium` leaf. An unlinked crumb that is not last renders a bare `<span>` (`:53`) and takes the nav's `text-text-muted`. The new test renders the exact category-page shape (`[{label:"Browse"},{label:"Crypto SMA"}]`). It asserts that exactly one `[aria-current]` element exists, that it is the leaf, and that the root has neither `aria-current` nor the current-page classes. |
| WR-02: the "Browse" link is dropped on every category, not only the one `/browse` redirects to | **RESOLVED.** Both pages now compare `onlySlug === slug` (`[slug]/page.tsx:52`, `[slug]/[strategyId]/page.tsx:61`). `onlySlug` is `null` on an empty or failed read (`browse-categories.ts:30-31`), so a null can never equal a real slug. The two new tests render `slug: "cfd"` with only `crypto-sma` populated and expect `{ label: "Browse", href: "/browse" }`. A case-variant URL such as `/browse/Crypto-SMA` keeps the link. That is correct, because `/browse` redirects to a different URL (`/browse/crypto-sma`), not back to the same page. |

**Regression check across the other `Breadcrumb` callers:** none. Every other caller passes an `href` on every non-last item and leaves the last item unlinked. Those callers are `strategies/[id]/edit`, `discovery/[slug]`, `discovery/[slug]/[strategyId]`, and through `PageHeader` the pages `decks`, `recommendations` and `compare` (both `COMPARE_BREADCRUMB` and the inline array). For that shape the old rule ("no href") and the new rule ("last index") pick the same element, so markup, `aria-current` and styling are byte-identical for them. Linked crumbs are untouched (`:32-41`).

One limit is unchanged and was not introduced here. A last item that DOES carry an `href` renders as a link without `aria-current`. No caller passes that shape today, so it is noted and not raised.

## Info

### IN-01: The inert "Browse" crumb looks the same as a resting link — LOW, not MEDIUM+, user-facing (minor affordance)

**File:** `src/components/layout/Breadcrumb.tsx:50-53`, as rendered by `src/app/browse/[slug]/[strategyId]/page.tsx:61-65`

**Issue:** The unlinked non-leaf span inherits `text-text-muted` from the `<nav>`. A linked crumb at rest has the same colour and no underline (`:38` only changes colour on hover). On `/browse/crypto-sma/<id>`, PROD's current state, the trail reads "Browse › Crypto SMA › <name>". The first two crumbs look identical, but only the second responds to hover or click. A sighted visitor gets no cue that "Browse" is inert. Screen-reader users are fine, because the span is not exposed as a link.

**Fix (optional):** Give the inert crumb a visibly different, non-current treatment, e.g. `<span className="text-text-muted/70">`, or leave the item out when it would not link (the alternative round 2 offered). Check DESIGN.md before choosing a token.

### IN-02: No test renders a browse page with the REAL `Breadcrumb` — LOW, not MEDIUM+, not user-facing

**File:** `src/app/browse/breadcrumb-root.test.tsx:35-40`, `src/components/layout/Breadcrumb.test.tsx:60-77`

**Issue:** The page test mocks `Breadcrumb`, and the component test covers the two-item category shape only. Nothing asserts the composed result on the strategy page (three items: unlinked, linked, unlinked), i.e. that exactly one `aria-current` exists there. The component logic depends only on the index, not on the shape, so the risk is low. The guarantee for the strategy page is still an inference from two separate tests, not something a test measures.

**Fix (optional):** Add a three-item case to `Breadcrumb.test.tsx`, `[{label:"Browse"},{label:"Crypto SMA",href:"/browse/crypto-sma"},{label:"Strategy"}]`, asserting `querySelectorAll("[aria-current]")` has length 1 and is the last item.

## Carried from round 2, unchanged by these commits (not re-counted)

The two fix commits did not target round 2's IN-01..IN-05, and all five still stand at HEAD:
- IN-01: `no-unchecked-supabase-read.mjs:55` still cites the deleted `src/app/api/portfolio-documents/route.ts:61`.
- IN-02: `DOC_TYPES`/`DocType` (`src/lib/utils.ts:194-195`) and `PortfolioDocument` (`src/lib/types.ts:1768`) still have no runtime user.
- IN-03, IN-04, IN-05: the tearsheet/`custody` monitoring sentence, the "Exchange-verified" meta description (`[slug]/[strategyId]/page.tsx:27`), and the missing guard against `/api/portfolio-documents` coming back. None of these was touched.

---

_Reviewed: 2026-11-07T13:25:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Round: 3_
