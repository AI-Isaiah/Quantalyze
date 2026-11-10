---
phase: 196-onestrategypage
verified: 2026-11-09T12:10:00Z
status: passed
score: 5/5 must-haves verified (3 in code; SC-4 and SC-5 closed by the 2026-11-10 production UAT and founder decision D-13)
verified_at_sha: 9bc83f894fa4a249ea3582fb26282c86d86797b3
drift_subjects:
  - next.config.ts
  - src/lib/routing/route-contract-manifest.ts
  - src/lib/factsheet/origin.ts
  - src/lib/factsheet/viewer.ts
  - src/components/factsheet/BackLink.tsx
  - src/components/factsheet/ViewerBar.tsx
  - src/components/factsheet/VisitorHeader.tsx
  - src/app/factsheet/[id]/page.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/AdvancedDisclosure.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/chart-hint.tsx
  - src/app/factsheet/[id]/tearsheet/page.tsx
  - src/app/factsheet-share/[token]/page.tsx
  - src/app/browse/layout.tsx
  - src/app/browse/page.tsx
  - src/app/browse/session.ts
  - src/app/api/factsheet/[id]/pdf/route.ts
  - scripts/factsheet-census/count.ts
behavior_unverified: 0
gaps: []
human_verification:
  - test: "Run the production after-run census (SC-5) on the deployed phase"
    expected: "Anonymous, Chromium 1440 x 900, Advanced closed then open, scrolled twice: the named strategies Momentum Sphinx and Fibonacci Ghost show 4 sections, 2 charts, 0 repeated metrics (closed), at most 1 small-sample warning, 1 hint, 0 on-request rows; then the print snapshot and the share-link counts, recorded in 196-CENSUS.md under Production after-run"
    why_human: "Needs the deployed site; the build was made with no production access, and the CENSUS 'Production after-run' section is explicitly pending"
  - test: "Decide whether the rolling-window Sharpe, Sortino and Volatility rows under Advanced count as 'a metric shown twice' (TODOS 196-ROLLING-REPEATS-01)"
    expected: "Either the rolling rows are relabelled, merged or exempted and the census target reads met with Advanced open, or the founder records that rolling-window figures are different statistics and SC-4's 'no metric twice' applies to the opening view"
    why_human: "A design call the plan and UI-SPEC left open. The census counter reports sharpe and sortino (and volatility on one fixture) repeated with Advanced open, against a UI-SPEC target of 0 in both states"
  - test: "Live status check of the redirects and of the not-found statuses (no build, no e2e was run in this verification)"
    expected: "curl -I of the four old URLs returns 308 to /factsheet/<id> with from/cat preserved; an unpublished id's /factsheet/<id> returns 404 to an anonymous request; /factsheet/<id>/tearsheet keeps a real 404/500 (no streamed 200) after the loading.tsx move"
    why_human: "Config shape and unit seams are verified; the live 308 status, destination-query interpolation and the streamed-status behaviour are confirmed only from docs and unit seams (e2e/route-redirects.spec.ts is the named canary)"
  - test: "Founder call on intro attestation scope (TODOS 196-INTRO-API-ATTESTATION-01)"
    expected: "Founder records that UI-only attestation gating (factsheet buttons hidden for an unattested allocator, /api/intro unchanged) is intended, or asks for /api/intro to enforce it"
    why_human: "Compliance scope decision, booked unrouted; does not contradict a success criterion"
  - test: "Visual pass of the document layout, viewer bar, visitor header and Advanced disclosure against DESIGN.md / UI-SPEC at 1440 and a narrow width"
    expected: "Opening view reads as a short document; back link and actions sit in one bar; sign-up line sits above the footer; print view has no ControlBar or Advanced"
    why_human: "Visual appearance cannot be asserted by grep or jsdom"
---

# Phase 196: ONESTRATEGYPAGE Verification Report

> **Update 2026-11-10: human items closed, status passed.** Measured on production (https://quantalyze.xyz, main `9bc83f89`). (1) Production census: met with Advanced closed and in print for Momentum Sphinx and Fibonacci Ghost; table and runner caveat in `196-CENSUS.md` "Production after-run"; share-link pass not run. (2) Rolling repeats: founder decision D-13 "Opening view only", SC-4 narrowed to the opening view (CONTEXT and ROADMAP). (3) Live statuses: `/strategy/<id>`, `/strategy/<id>/v2`, `/browse/<cat>/<id>`, `/discovery/<cat>/<id>` each 308 to `/factsheet/<id>` with `from`/`cat` kept; unpublished factsheet 404; unpublished and unknown tearsheet 404 (no streamed 200); published 200. (4) Intro attestation: founder decision D-14 "Enforce in /api/intro" with an attest step on every entry point, routed to Phase 194.2. (5) Visual at 1440 and 390 CSS px: opening view reads as a short document, visitor header and sign-up line above the footer, Advanced closed, no horizontal overflow at 390; print view has no ControlBar and no Advanced. Found and routed, not phase-196 defects: the tearsheet manager card and `<title>` use the "Strategy #<id>" pseudonym (founder: "Real name everywhere", Phase 201); chart controls (log/linear/export) still print (LOW, not booked). `verified_at_sha` moved to the main commit the UAT was read on; the code verification was issued at `21107f35`.

**Phase Goal:** A strategy has one page, the factsheet. The tearsheet is its print view and every other strategy detail route leads to it. A signed-in user is never shown visitor prompts, an owner can open their own unpublished strategy, a signed-in reader has a way back and a next step, a shared factsheet carries a header and a sign-up link, and the factsheet opens as a summary, one chart and one metrics table with the rest under "Advanced".
**Verified:** 2026-11-09 at 21107f354
**Status:** passed (human items closed 2026-11-10, see above)
**Re-verification:** No, initial verification

All evidence below was read from the codebase at HEAD of the phase branch, not from SUMMARY claims. Requirements covered: LEAN-02, ROUTE-02, ROUTE-04, LEAN-05.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every strategy detail route leads to the factsheet, the tearsheet is its print view, existing links and shared URLs keep working | VERIFIED (live 308 status is a human item) | `next.config.ts:235-252`: four permanent, unconditional rules (`/strategy/:id`, `/strategy/:id/v2`, `/browse/:slug/:strategyId`, `/discovery/:slug/:strategyId`) to `/factsheet/...`, the last two carrying `from` and `cat`. The `src/app/strategy/` tree is gone, and `discovery/[slug]` and `browse/[slug]` hold list pages only. `src/app/factsheet/[id]/page.tsx` still re-exports the v2 page, `/factsheet/[id]/v2` and `/factsheet-share/[token]` still exist. Tearsheet: `tearsheet/page.tsx:265` renders `<FactsheetView ... printView />` from the same payload builder, then the tear sheet's kept blocks. Manifest lockstep: `npm run check:route-contract` OK (48 routes). `strategy-route-redirects.test.ts`, `one-strategy-page-links.test.ts` (guards against old-route hrefs in `src`) pass. A grep for old-route hrefs in non-test `src` finds none (only stale comments, and `proxy.ts` public-route handling). |
| 2 | Signed-in user sees no "Sign up" prompt on `/browse` or a strategy page; owner can open own unpublished strategy; after the owner viewed it an anonymous request still gets not-found | VERIFIED | `browse/session.ts` `hasBrowseSession` (request-cached `auth.getUser()`, failures reported); `browse/layout.tsx:23-47` swaps Log in / Sign up for `BrowseDiscoveryLink` when signed in; `browse/page.tsx:62` and `browse/[slug]/page.tsx:83` gate their sign-up blocks on `!signedIn`. No static or revalidate export on those pages. The strategy page no longer exists (redirects to the factsheet, which shows `ViewerBar`, never "Sign up", to a session). Owner lane: `factsheet/[id]/v2/page.tsx` Lane B owner probe (session-keyed, built uncached). `page.owner-lane.test.tsx` arm 5 (owner renders a draft, then an anon request for the same id 404s, cache never populated) and `page.viewer-chrome.test.tsx:592` pass. |
| 3 | From a factsheet a signed-in user can go back and take a next step (request intro, add to allocation); a shared factsheet carries a header and a sign-up link | VERIFIED | `ViewerBar.tsx`: back link always for a signed-in viewer, `Add to my allocation` (`/allocations?add=<id>`) and `RequestIntroButton` for an approved, attested allocator, `Edit strategy` for the owner. `origin.ts` closed-set `parseOrigin` / `backTargetFor` (own-property lookups, repeated `from` rejected, `cat` validated against `DISCOVERY_CATEGORIES`, no raw value reaches an href); `BackLink.tsx` falls back to "Go to Discovery" / same-origin history. The `?add=` deep link is consumed by `AllocationsTabs.tsx:599-620` and `AddAllocationFlow.tsx`. Share route: `factsheet-share/[token]/page.tsx:431,451,458` renders `VisitorHeader showSignUp={!signedIn}` and `SignUpLine` before the footer. `VisitorHeader.tsx` carries the "Sign up" link to `/signup`. Review-round fixes confirmed present: viewer attestation gate (`viewer.ts:67-78`), pending-payload page still gets the header (WR-01), session-read failures captured (SF-01). Tests: `origin.test.ts`, `viewer.test.ts`, `page.viewer-chrome.test.tsx`, `factsheet-share/*` pass. |
| 4 | The factsheet opens as a summary, one chart and one metrics table, rest under "Advanced"; no metric shown twice, chart hint once, one small-sample warning, empty sections and "— on request" rows hidden | UNCERTAIN (WARNING, human decision): opening view VERIFIED, Advanced-open repeated metrics not met | Factsheet, share and print mounts all pass `layout="document"` (`FactsheetView.tsx:416`); the allocator mounts keep the full layout. `AdvancedDisclosure.tsx`: native `<details id="factsheet-advanced">`, closed on the server render, contents mount on first open, persisted under the registered `factsheet-collapse:` prefix with a tolerant codec, omitted when empty. `MandatePanels.tsx:141-162`: the seven "— on request" rows render only when `!documentVariant`. `chart-hint.tsx`: one hint element shared by `aria-describedby`. `FactsheetBody.census.test.tsx` (27 arms, run here, pass): closed state on fixtures A, B, C is 4 sections, 2 charts, 0 repeated metrics, at most 1 small-sample warning, 1 hint, 0 on-request rows; arms carry positive controls so they cannot pass vacuously. Not met: with Advanced open the two Rolling Metrics tables repeat sharpe, sortino (and volatility on A) against a UI-SPEC target of 0 in both states (`196-CENSUS.md` After, booked `196-ROLLING-REPEATS-01`, undecided). Also the census counter cannot read the Style Drift table (`196-STYLE-DRIFT-CENSUS-BLIND-01`). The ROADMAP wording "one chart" is delivered as the equity curve with its drawdown beneath (2 figures), per CONTEXT D-04. |
| 5 | Before/after count of sections, charts, repeated metrics and warnings on three named strategies is recorded; print and shared views follow the new layout | UNCERTAIN (WARNING, human item): print and share layout VERIFIED, production after-run pending | `196-CENSUS.md`: Before is measured on the live site for two named strategies (B Momentum Sphinx, C Fibonacci Ghost) plus a supplementary one; profile A has no matching published strategy and is carried by a fixture row, stated openly. After is recorded from fixtures only (jsdom, 27 arms pass); the "Production after-run" section is explicitly pending deploy. The census method is re-runnable (`scripts/factsheet-census/count.ts`, `run.ts`) and refuses to print ids. Print view: `tearsheet/page.tsx` uses the same `FactsheetView` in `printView`, with its ranks, identity panel and contact block in named homes; `tearsheet.pdf` refuses a page without `#tearsheet-main`. Share view: `factsheet-share/[token]/page.tsx:453` uses `FactsheetView` with `recipientShare`. |

**Score:** 3/5 truths verified; 2 uncertain, routed to human decision (none failed).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `next.config.ts` redirects | 4 permanent unconditional 308s | VERIFIED | lines 235-252, manifest `redirectFrom` byte-equal |
| `src/lib/factsheet/origin.ts` | closed origin set, builder | VERIFIED, WIRED | used by page, link sites, redirects; tests pass |
| `src/lib/factsheet/viewer.ts` | per-request viewer, never in payload/cache key | VERIFIED, WIRED | called after the lane decision in `v2/page.tsx` |
| `ViewerBar`, `BackLink`, `VisitorHeader`, `SignUpLine` | chrome | VERIFIED, WIRED | page, pending fallback and share route |
| `AdvancedDisclosure` | collapsed-by-default disclosure | VERIFIED, WIRED | `FactsheetView.tsx` document layout |
| Tearsheet print view | same layout, kept blocks | VERIFIED, WIRED | `tearsheet/page.tsx` |
| Deleted route trees and shell | `strategy/`, discovery/browse detail, `StrategyV2Shell` | VERIFIED | absent at HEAD; no dangling references (tsc clean) |
| `196-CENSUS.md` | before/after record | PARTIAL | production after-run pending (human item 1) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Old detail URLs | `/factsheet/:id` | config 308 | WIRED | unconditional; reads no database row |
| `/factsheet/[id]?from&cat` | back link | `parseOrigin` -> `backTargetFor` -> `BackLink` | WIRED | closed set, no open redirect |
| `ViewerBar` | `/allocations?add=<id>` | `AllocationsTabs` -> `AddAllocationFlow` | WIRED | id validated server-side |
| `ViewerBar` | `/api/intro` | `RequestIntroButton` | WIRED | route unchanged versus pre-phase |
| Owner lane | no shared cache | uncached build, `unstable_cache` 0 invocations | WIRED | `page.owner-lane.test.tsx` arms 4-5 |
| Share route | `VisitorHeader` / `SignUpLine` | session read after HMAC and 410 paths | WIRED | |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Factsheet opening view | `FactsheetPayload` | `buildFactsheetPayloadCached` / owner uncached build | yes | FLOWING |
| Tearsheet | payload | `fetchAndBuildPayloadWithReason`, same builder family | yes | FLOWING |
| `ViewerBar` | `FactsheetViewer` | `resolveFactsheetViewer` reading `profiles`, `investor_attestations` | yes, fail closed | FLOWING |
| Browse chrome | `hasBrowseSession` | `auth.getUser()` | yes | FLOWING |

### Behavioral Spot-Checks (single targeted runs, nothing written, no database)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Census, viewer chrome, owner lane, metadata, boundaries, tearsheet, share, browse, redirects, origin, viewer, advanced, tearsheet-homes, api/factsheet | `npx vitest run` on those paths | 25 files, 465 tests passed | PASS |
| Old-route link guard and contract tests | `npx vitest run src/__tests__/one-strategy-page-links.test.ts src/__tests__/contracts` | 12 files, 386 tests passed | PASS |
| Type safety | `npx tsc --noEmit` | exit 0, no errors | PASS |
| Route contract | `npm run check:route-contract` | OK, 48 page routes | PASS |

Not run, by instruction: e2e, build, the full suite. `compute.conventions.test.ts` fixtures B and C were not run and are the known Node 25 versus 22 skew.

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| plan anchors | `node scripts/verify-plan-anchors.mjs --pending` | 0 pending plan files of 111, 0 stale claims, 2 deferred (phase 192, not this phase) | PASS |

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| LEAN-02 | 196 plans | One page, tearsheet is print view, `/strategy/<id>` leads to it | SATISFIED | SC-1 |
| ROUTE-02 | 196 plans | No visitor prompts to a signed-in user; owner opens own unpublished strategy | SATISFIED | SC-2 |
| ROUTE-04 | 196 plans | Back and next step; shared factsheet header and sign-up | SATISFIED | SC-3 |
| LEAN-05 | 196 plans | Summary opening, Advanced, no repeats, one hint, one warning, hidden empties | NEEDS HUMAN | opening view met; Advanced-open rolling repeats undecided (SC-4) |

No orphaned requirement IDs: all four mapped to Phase 196 in REQUIREMENTS.md are claimed by plans.

### Review survivors versus the success criteria

The three code-review rounds' fixes are on the branch (CR-01 attestation gate on the factsheet buttons, WR-01 pending-lane chrome, WR-02 canonical link, WR-03/SF-02 PDF deadline and marker, SF-01 session captures, SF-03/04/05, R2-01 loading.tsx placement and `#tearsheet-main` marker, R3-01 pending marker kept off the read-failure render, confirmed at `v2/page.tsx:832`). The booked survivors (`196-INTRO-API-ATTESTATION-01`, `196-PDF-ROUTE-RETRY-CLASSES-01`, `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01`, `196-ORPHANS-01`, `196-V2-PANELS-REVIVAL-01`, `196-STYLE-DRIFT-CENSUS-BLIND-01`, `196-HINT-COPY-PARITY-01`) do not contradict a success criterion. `196-ROLLING-REPEATS-01` is the exception that touches SC-4 and is carried as a human decision above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/proxy.ts`, `FactsheetView.tsx`, `unit-view.tsx` | various | comments still naming the retired `/strategy/[id]/v2` shell | Info | stale prose only, no behavior |
| `MandatePanels.tsx` | 155-161 | "— on request" rows still present in the full (non-document) layout | Info | by design: only the allocator mounts use it; document layout hides them (census-verified) |

A grep for TBD, FIXME and XXX across every non-test source file added or modified by the phase returns nothing. No blocker anti-pattern found.

### Human Verification Required

See the `human_verification` list in the frontmatter: (1) production after-run census, (2) the rolling-repeats design decision, (3) live redirect and status checks, (4) intro attestation scope, (5) visual pass. None are failures; each is something code reading and unit tests cannot settle.

### Gaps Summary

No success criterion failed. The phase delivers the one-page routing, the viewer-aware chrome, the share header and sign-up link, and the summary-plus-Advanced layout, with the census proving the opening state on three fixtures. Two success criteria cannot be signed off without a human: SC-4 because the rolling Sharpe, Sortino and Volatility rows under Advanced still share labels with the main metrics table and the design call is undecided, and SC-5 because the production after-run, print snapshot and share-link counts need the deployed site.

---

_Verified: 2026-11-09_
_Verifier: Claude (gsd-verifier)_
