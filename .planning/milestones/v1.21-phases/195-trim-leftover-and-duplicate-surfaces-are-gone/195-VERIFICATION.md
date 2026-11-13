---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
verified: 2026-11-07T15:40:00Z
status: passed
score: 12/12 must-haves verified (4 real-browser/CI-backstop checks and 9 judgment-tier prohibitions routed to human review)
verified_at_sha: 0ed4c8d9db90981919a0f026ebdab4191e93adbf
drift_subjects:
  - next.config.ts
  - src/proxy.ts
  - src/lib/routing/route-contract-manifest.ts
  - src/app/portfolio-pdf/[id]/page.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/Breadcrumb.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/app/factsheet/[id]/v2/factsheet-context.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/browse/page.tsx
  - src/app/browse/browse-categories.ts
  - src/app/browse/layout.tsx
  - src/app/browse/[slug]/page.tsx
  - src/app/browse/[slug]/[strategyId]/page.tsx
  - src/components/ui/Disclaimer.tsx
  - src/app/factsheet/[id]/tearsheet/page.tsx
  - src/lib/email.ts
  - src/components/exchanges/ExchangesTabContent.tsx
  - src/__tests__/trim-removed-surfaces.test.tsx
  - src/__tests__/no-store-coverage.test.ts
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 12/12
  previous_sha: 67ede6a93a1306405df6e1d6cf61c8754d7d6ae1
  gaps_closed: []
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "The tearsheet and the `custody` Disclaimer variant still say 'Strategy monitored via read-only exchange API' for every trust tier, the same unconditional claim WR-01 removed from the strategy-page variant (round-2/3 REVIEW IN-03, carried, never fixed)."
    category: other
    reason: "Outside every Phase 195 success criterion (D-09 is about repetition, not about the truth of a surviving sentence). Recorded so the next phase that touches the tearsheet (196 ONESTRATEGYPAGE) decides it."
    evidence_status: "none provided"
human_verification:
  - test: "UC-6: in a real browser, seed localStorage allocations.tweaks = {density:tight, accentIntensity:full, displayFont:sans, bridgeVariant:subtle, chartStyle:line, showBench:false, showOutcomes:false}, open /allocations"
    expected: "Every default renders: accent #1B6B5A, serif display font, Outcomes tab visible, 44px table rows, area chart with benchmark line; no body[data-density] / data-display-font / data-show-outcomes, no html[data-accent-intensity]"
    why_human: "Plan declares this verification: backstop. A jsdom test (AllocationsTabs.test.tsx, 'a stored Tweaks value changes nothing') covers the attribute and tab logic, but computed colour, font and row height need a real layout engine."
  - test: "UC-7: open a factsheet with ?dark=1, and another with stored view state holding dark '1'"
    expected: "Both render with data-theme=light and the light palette; the next view-state write contains no dark key"
    why_human: "Plan declares this verification: backstop. factsheet-context.provider.test.tsx proves the flag is never read or re-written and FactsheetView hard-codes data-theme=light, but palette rendering needs a browser."
  - test: "UC-20: load /portfolio-pdf/00000000-0000-0000-0000-000000000000 at 320px width"
    expected: "No horizontal overflow; the two CTAs wrap. CI's reflow-sweep, no-clip-sweep and axe-app-wide specs already list this path (e2e/*.spec.ts) and must be green on the PR head SHA."
    why_human: "Plan declares this verification: backstop; e2e is CI-only and was not run here."
  - test: "E2E redirect cases (e2e/route-redirects.spec.ts): /portfolios, /portfolios/x, /portfolios/x/manage?add=y, /portfolios/x/documents, /portfolios/x/strategies/y each answer 308 to /allocations; /decks answers 307 to /discovery/crypto-sma; /api/portfolio-pdf/:id answers 308 to /portfolio-pdf/:id. Also, on a deployed build: /browse with one populated category answers a redirect to that category, and on /browse/<that-slug> and /browse/<that-slug>/<id> the 'Browse' crumb is plain text while on any other category it is a link."
    expected: "All pass on the head SHA, in particular the bare /portfolios matching /portfolios/:path* (plan assumption A3)"
    why_human: "The source rules are byte-matched to the manifest by check:route-contract and pinned by the guard (now including permanence), but the live status codes and the data-driven /browse redirect are only observable against a running server (CI e2e)."
  - test: "Judgment-tier prohibition review (unverified-prohibition, human review recommended). I recorded a non-authoritative LLM-judge verdict of HELD for all nine; see the Prohibitions section. The one worth a human eye is the wording one: the 'strategy-page' disclaimer on /browse/<cat>/<id> drops the sentence 'Past performance is not indicative of future results.' and relies on FOOTER_TEXT's 'Past performance does not guarantee future results.'; and, since e587587cd, it omits 'Strategy monitored via read-only exchange API.' for every tier except api_verified."
    expected: "Founder or counsel accepts that the surviving sentence is the same legally required statement (UI-SPEC A-5, plan 195-05), and that a non-API-verified strategy carrying no exchange-monitoring claim is the intended, more honest wording."
    why_human: "Judgment-tier, per ADR-550 D4 a flagged prohibition is never a silent pass."
---

# Phase 195: TRIM Verification Report (re-verification at HEAD `0ed4c8d9d`)

**Phase Goal:** `/portfolios` is removed, Decks is hidden until it works, and the user-visible leftovers are gone: the "Tweaks / Design variations" panel, the dark-mode option, toggles that do nothing useful, the single-card `/browse` and duplicated disclaimers.
**Verified:** 2026-11-07, HEAD `0ed4c8d9db90981919a0f026ebdab4191e93adbf`, branch `feat/195-trim`
**Status:** passed (human items closed by 195-UAT.md, 2026-11-07; UC-6 rests on unit tests only)
**Re-verification:** Yes. Previous report issued at `67ede6a93` (human_needed, 12/12). Every must-have was re-checked at HEAD; none regressed.

The five review-round fixes (`e587587cd`, `2864b9868` + `8b5e4c0df`, `c575d1f51`, `7ffdba541`, `afd974efa`) were read as diffs and checked against each success criterion. None weakens one. The status stays `human_needed` for the same reason as before: the plans tag four truths as real-browser/CI-backstop, and flagged judgment-tier prohibitions are never a silent pass.

## Goal Achievement

### Observable Truths (ROADMAP success criteria, the contract)

| # | Truth | Status | Evidence at HEAD |
|---|-------|--------|------------------|
| SC-1 | `/portfolios` and sub-routes gone, a visit lands on a named page not a 404, no link points to them, stored rows kept | VERIFIED | `src/app/(dashboard)/portfolios`, `src/app/api/portfolio-pdf` and `src/lib/pdf-render-token.ts` do not exist. `next.config.ts` redirects `/portfolios/:path*` to `/allocations` (`permanent: true`), `/api/portfolio-pdf/:id` to `/portfolio-pdf/:id` (308); the named retired page `src/app/portfolio-pdf/[id]/page.tsx` remains. Manifest in lockstep: `npm run check:route-contract` OK (52 routes), also run inside `npm run lint`. `git diff --stat` against the merge-base with origin/main is empty for `supabase/` and `src/lib/queries.ts`, so no migration and no row touched. The caller-less `/api/portfolio-documents` route deleted by `c575d1f51` is a code-only removal: the `portfolio_documents` table and its migration are untouched, the only other repo mentions are a lineage comment in `no-store-coverage.test.ts`, the ESLint rule's own fixtures, CHANGELOG and old docs, and the census moved 38 to 37 in step with the deletion (`no-store-coverage.test.ts` passes). |
| SC-2 | Decks appears in no navigation and no link | VERIFIED | `Sidebar.tsx` has only a comment (`:126`) where the entry was; `/decks` redirects to `/discovery/crypto-sma` with `permanent: false` (307), and the guard now pins that flag (`7ffdba541`), so a cached 308 cannot defeat un-hiding it. Page, `DeckCard` and `getDecks` stay on disk. |
| SC-3 | No Tweaks panel and no dark-mode option for any user | VERIFIED | No `Tweaks*` file under `allocations/components`; `FactsheetView.tsx:454` hard-codes `data-theme="light"`; `factsheet-context.tsx` mentions `dark` only in two comments (`:110`, `:360`) and the guard's new `DARK_KEY_RE` check ("no `dark` token in code", comment-stripped) passes. The guard's dark-mode matcher is now case-insensitive (`DARK_MODE_RE`), covering "Dark Mode", "DARK-MODE", "Dark theme". Real-browser rendering stays a human item (UC-6, UC-7). |
| SC-4 | No do-nothing toggle in the discovery table, `/browse` with one category leads straight to it, each page shows its disclaimer once | VERIFIED | Density: `StrategyTable.tsx` carries no density state, view toggle kept. **D-08 after the refactor:** the rule moved into `src/app/browse/browse-categories.ts` (`getBrowseCategories` returns `onlySlug`, non-null only when the populated read is non-empty AND exactly one category remains; the slug comes from the fixed `DISCOVERY_CATEGORIES` list). `browse/page.tsx` calls `redirect(\`/browse/${onlySlug}\`)` outside any try/catch. 0 or a failed read gives `onlySlug === null` and the fallback cards; 2+ gives the cards. `page.test.tsx` covers 0/1/2+. **Neuter proof (mine):** replacing the redirect with `void onlySlug;` made `page.test.tsx > redirects to the category page when exactly one category is populated` go RED; restored. **Breadcrumb fix:** `[slug]/page.tsx:52` and `[slug]/[strategyId]/page.tsx:61` drop the "Browse" link only when `onlySlug === slug`; any other slug keeps the link, a null `onlySlug` can never equal a slug. Neutering the check to `false` made `breadcrumb-root.test.tsx > one populated category -> no href on the Browse crumb` go RED; restored. `Breadcrumb.tsx:42` now gives `aria-current="page"` and current-page styling to the LAST item only; the other callers (all linked except the leaf) render identically. **D-09:** `/browse` and `/browse/<cat>` mount one `<Disclaimer variant="footer">` each; `/browse/<cat>/<id>` mounts one `<Disclaimer variant="strategy-page">` (`:200`) and nothing else; `browse/layout.tsx` mounts only `LegalFooter` (a link footer, not a disclaimer, asserted by the guard's counts). `e587587cd` changes only the text inside that one block: `CUSTODY_TEXT` (with the read-only exchange-API monitoring sentence) for `api_verified`, `CUSTODY_CORE` (custody + analytics-only) for csv_uploaded, self_reported and a missing tier, followed by provenance and `FOOTER_TEXT`. Count stays one; custody and analytics-only sentences survive for all tiers. **Neuter proof (mine):** forcing `CUSTODY_TEXT` for every tier made two `Disclaimer.test.tsx` WR-01 cases go RED; restored. |
| SC-5 | A test lists every removed route and control and goes RED if one renders or is linked again | VERIFIED | `src/__tests__/trim-removed-surfaces.test.tsx` passes at HEAD. Since the prior report it gained: case-insensitive `TWEAKS_RE` / `DARK_MODE_RE` / `ADD_TO_PORTFOLIO_RE` with mixed-case positive self-tests, the `DARK_KEY_RE` check on `factsheet-context.tsx`, and `hasRedirectRule` pinning source, destination AND `permanent` per rule (self-tested for a flipped flag, wrong destination, wrong source). The prior report's two neuter-RED proofs (redirect rename plus link append: 3 RED; second Disclaimer plus "Dark mode" span: 2 RED) were not repeated; the new matchers carry their own positive self-tests and the three neuters above hit the guard's neighbours (browse, Disclaimer). The allowlist remains pinned by its own self-test. |

### Plan must-have truths (re-checked)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| P1-a | Retired page reads no database row, works signed in or out | VERIFIED | Unchanged since prior report; page imports no data client; `/portfolio-pdf` still public and bounce-exempt in `proxy.ts`. Guard sections a and b pass. |
| P1-b | Retired page carries no disclaimer block, still renders LegalFooter | VERIFIED | Unchanged. |
| P1-c | crypto-decks / tradfi-decks discovery categories unaffected | VERIFIED | `DISCOVERY_CATEGORIES` is read, not modified, by the new `browse-categories.ts`; no discovery code in the diff. |
| P2 | Add to portfolio removed everywhere, optimizer keeps "View strategy" | VERIFIED | Guard section d (now case-insensitive) passes. |
| P2-b | phase-150 OWN-03 census moved, trigger pins not weakened | VERIFIED | `phase-150-capital-ownership-invariant.test.ts` passes; the post-verification fixes did not touch it. |
| P3 | Equity chart fixed to area plus benchmark, Outcomes tab always present | VERIFIED | `allocations` tree passes. |
| P6 | Orphan components removed, survivors intact, data layer unchanged | VERIFIED | `src/components/portfolio` tests pass; `queries.ts` and `supabase/` diff empty against origin/main merge-base; `tsc` clean. |
| P7 | Whole-repo gates | VERIFIED | My runs at HEAD below. |

**Score:** 12/12 truths verified; 0 PRESENT_BEHAVIOR_UNVERIFIED; 4 `backstop` truths and 9 flagged prohibitions listed under human verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/browse/browse-categories.ts` | One shared rule for redirect and crumb | VERIFIED | 34 lines, substantive, imported by `browse/page.tsx`, `[slug]/page.tsx`, `[slug]/[strategyId]/page.tsx` (WIRED); data flows from `getPopulatedCategorySlugs()` (real query, unchanged) |
| `src/components/layout/Breadcrumb.tsx` | `aria-current` on last item only | VERIFIED | `:42` index test; `Breadcrumb.test.tsx` passes |
| `src/components/ui/Disclaimer.tsx` | `strategy-page` variant, tier-honest custody sentence | VERIFIED | `CUSTODY_CORE` / `CUSTODY_TEXT`; neuter-RED proven |
| `src/app/portfolio-pdf/[id]/page.tsx`, `next.config.ts`, route-contract manifest, `trim-removed-surfaces.test.tsx` | As before | VERIFIED | Re-read at HEAD, unchanged except the guard hardening above |
| `src/app/api/portfolio-documents/` | Deleted (caller-less) | VERIFIED (absent) | Directory gone; no import or fetch of `/api/portfolio-documents` remains in `src`, `scripts`, `e2e` |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| `browse/page.tsx` | `getBrowseCategories()` | WIRED | redirect on `onlySlug`, outside try/catch |
| `[slug]` and `[slug]/[strategyId]` pages | `getBrowseCategories()` | WIRED | crumb href chosen by `onlySlug === slug`; both reads in `Promise.all` with the page's own data |
| strategy page | `Disclaimer variant="strategy-page"` | WIRED | single mount, `trustTier={strategy.trust_tier}` |
| `next.config.ts redirects()` | manifest `redirectFrom` | WIRED | check-route-contract passes |
| guard | `next.config.ts` rules incl. `permanent` | WIRED | `hasRedirectRule` self-tested |

### Data-Flow Trace (Level 4)

`onlySlug` and the crumb href derive from `getPopulatedCategorySlugs()` (existing real query). The disclaimer text derives from `strategy.trust_tier`, a real column the page already reads. No hardcoded or static data sources.

### Behavioral Spot-Checks (all run by me at HEAD)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Guard, browse, retired page, layout, Disclaimer, email, no-store, ownership gate | `npx vitest run src/__tests__/trim-removed-surfaces.test.tsx src/app/browse src/app/portfolio-pdf src/components/layout src/components/ui/Disclaimer.test.tsx src/lib/email.test.ts src/__tests__/no-store-coverage.test.ts src/__tests__/portfolio-ownership-gate.test.ts src/__tests__/phase-150` | 18 files, 300 tests pass | PASS |
| Censuses and phase-touched trees | `npx vitest run` dashboard-disclaimer-once, phase-150, phase-32, display-sign (2 files), check-route-contract, critical-regressions, `src/app/factsheet`, `src/app/(dashboard)/allocations`, `src/components/strategy`, `src/components/portfolio`, `src/app/api` | 461 files, 8429 tests pass, 3 skipped (pre-existing skips) | PASS |
| Types | `npx tsc --noEmit` | exit 0, no output | PASS |
| Lint | `npm run lint` | exit 0: eslint 0 errors, 2 warnings (`MetricsColumn.tsx` and `composite-read-path.ts` unused imports; neither file is in the phase diff against the origin/main merge-base), plus check-admin-route-manifest, check-route-contract (52 routes), check-planning-hygiene, check-canonical-domain all OK | PASS |
| Route contract | `npm run check:route-contract` | OK, 52 page routes | PASS |
| Fixes can fail | three neuters from byte backups (browse redirect removed; custody sentence forced for every tier; crumb rule forced to `false`) | 4 RED (2 Disclaimer, 1 `page.test.tsx`, 1 `breadcrumb-root.test.tsx`); all three files restored, `git status` clean | PASS |

The full workspace vitest run was not repeated; the two known `compute.conventions.test.ts` failures (fixtures B and C) are outside this phase and outside the trees run here.

### Probe Execution

SKIPPED: the phase declares no `probe-*.sh`.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LEAN-03 | 195-01, 195-02, 195-06, 195-07 | `/portfolios` removed and Decks hidden until it works | SATISFIED | SC-1, SC-2 |
| LEAN-07 | 195-03, 195-04, 195-05, 195-07 | Tweaks panel, dark-mode option, do-nothing toggles, single-card `/browse`, duplicated disclaimers gone | SATISFIED | SC-3, SC-4 |

No orphaned requirements. REQUIREMENTS.md traceability still reads "Pending"; that is bookkeeping for the orchestrator's `phase complete`.

### CONTEXT Decisions D-01..D-10

All honored at HEAD. D-08 (data-driven `/browse` redirect) and D-09 (one block per page) survive the refactor and the disclaimer wording change, with neuter proofs above. D-10: the guard is stronger than at the prior verification (case-insensitive matchers, `dark` key pin, redirect permanence pin).

### Prohibitions (judgment-tier, all flagged `unverified-prohibition`, human review recommended)

NON-AUTHORITATIVE LLM-judge readings:

1. 195-01 no row deleted or migrated: HELD (no `supabase/` or `queries.ts` diff; deleting the `portfolio-documents` route removes code, not rows).
2. 195-01 old share link never lands on a login wall, 404 or error: HELD statically; live behavior is a CI e2e item.
3. 195-02 no row hidden or deleted, no SQL-trigger assertion weakened: HELD.
4. 195-03 view toggle stays, no column hidden: HELD.
5. 195-04 persisted view-state fields undisturbed: HELD.
6. 195-05 no legally required sentence dropped or reworded: HELD WITH NOTE. Two wording facts: the "Past performance is not indicative..." duplicate is covered by FOOTER_TEXT; since `e587587cd` a non-`api_verified` strategy page omits "Strategy monitored via read-only exchange API." That is a factual monitoring claim, not a required disclaimer, and omitting it where untrue is the point of the fix. Recommend a human glance.
7. 195-05 no redirect on a failed or empty read: HELD (`browse-categories.ts` gates on a non-empty read; tested 0/1/2+; neuter RED).
8. 195-06 no component still used by a surviving surface deleted: HELD (`tsc` 0, trees green).
9. 195-07 guard not made to pass by widening the allowlist: HELD (allowlist pinned by its own self-test; the round-1 fix widened matchers, not the allowlist).

### Anti-Patterns Found

None blocking. No `TBD`, `FIXME` or `XXX` on lines added since the prior report (checked in the diff of the touched source files). The two lint warnings are in files outside the phase. Carried INFO items from the review (stale cite of the deleted route in `tools/eslint-plugin-quantalyze/rules/no-unchecked-supabase-read.mjs`, unused `DOC_TYPES`/`PortfolioDocument`, inert "Browse" crumb looks like a resting link, no test renders the three-item breadcrumb with the real component) are LOW and not goal gaps; they do not touch a success criterion.

### Human Verification Required

See frontmatter `human_verification` (5 items): UC-6, UC-7, UC-20, the e2e redirect cases (CI, now also the data-driven `/browse` redirect and the crumb), and the prohibition review with the disclaimer wording note.

### Gaps Summary

No gaps. Every roadmap success criterion holds at HEAD. The five post-verification fixes tighten the phase (truthful custody sentence, no self-redirecting crumb, correct `aria-current`, a dead route removed with its census row, a harder guard) and none regresses D-08, D-09 or D-10; three of them were neutered by me and went RED. The remaining items are real-browser and CI-run confirmations the plans declared as backstop, plus the flagged judgment-tier prohibitions. One advisory (the tearsheet/`custody` variant's unconditional exchange-monitoring sentence) is recorded for Phase 196.

---

_Verified: 2026-11-07_
_Verifier: Claude (gsd-verifier)_
