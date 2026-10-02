---
phase: 51-shell-information-architecture-restructure
verified: 2026-06-29T09:17:00Z
status: gaps_found
score: 6/8 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Navigation is role-scoped with no orphan / dead-end — the 4 orphans (/compare, /decks, /referral, /recommendations) are addressed"
    status: partial
    reason: "3 of 4 orphans are surfaced (/compare + /decks in the allocator workspace nav, /referral in ACCOUNT). /recommendations remains a genuine orphan/dead-end: it has NO nav entry, NO inbound <Link>/router.push anywhere in src/, and its own PageHeader is rendered WITHOUT a breadcrumb prop. The Sidebar.tsx comment (lines 70-73) asserts it is 'mandate-CTA-reachable (a child of the profile mandate tab) and gets its back-path via the breadcrumb' — but that mandate CTA does not exist in the codebase and the breadcrumb back-path is not wired on the page. The UI-SPEC contract (§Role-scoped nav COMPLETENESS) requires each orphan to be reachable via a nav entry OR a parent + breadcrumb back-path — /recommendations satisfies neither in code."
    artifacts:
      - path: "src/components/layout/Sidebar.tsx"
        issue: "Comment claims /recommendations is mandate-CTA + breadcrumb reachable; neither affordance exists in code (grep of all src/ finds zero inbound nav to /recommendations)."
      - path: "src/app/(dashboard)/recommendations/page.tsx"
        issue: "PageHeader is rendered with no `breadcrumb` prop (line 166-178) — no back-path. File was NOT modified by Phase 51."
    missing:
      - "Either add a labeled, role-gated nav entry for /recommendations, OR add a real mandate-CTA link to it (e.g. from the profile mandate tab / MandateQuickSetCard) AND pass a `breadcrumb` prop to its PageHeader so the back-path exists."
  - truth: "Breadcrumbs + consistent back-paths are present app-wide (the PageHeader breadcrumb prop)"
    status: partial
    reason: "The PageHeader `breadcrumb` prop was added and is internally wired (renders <Breadcrumb items> above the <h1> when passed; PageHeader.test pins it GREEN). BUT grep of src/app/**/*.tsx for `breadcrumb={` returns ZERO callers — no page actually passes the prop. The sidebar/breadcrumb a11y gaps (aria-current + focus-visible on both) ARE fully fixed and tested. The new PageHeader breadcrumb capability is an ORPHANED artifact: the wiring exists but is consumed nowhere, so the 'app-wide back-paths via PageHeader' outcome is not delivered. (Pre-existing direct <Breadcrumb> usages exist on browse/discovery/strategies-edit/compare, but those predate Phase 51 and do not route through the new prop.)"
    artifacts:
      - path: "src/components/layout/PageHeader.tsx"
        issue: "breadcrumb prop exists + renders correctly, but 0 callers pass it (orphaned wiring)."
    missing:
      - "Wire the breadcrumb prop into the dashboard surfaces that need a curated back-path (the recommendations / compare / decks / referral leaves the phase identified as orphans), so 'breadcrumbs app-wide' is observably true rather than capability-only."
human_verification:
  - test: "Anon canary for the (marketing) group — load /, /security, /for-quants, /legal/{privacy,terms,disclaimer}, /demo, /demo/founder-view as a logged-out visitor"
    expected: "Each returns <400 at its EXACT requested URL (no 307→login, no redirect away), with exactly one <main> and one <h1> visible"
    why_human: "e2e/marketing-shell.spec.ts is wired into CI but a runtime render against a live build cannot be executed in the verifier sandbox; the static structure (single <main>/<h1> per rendered page) is confirmed by code read, runtime status codes are not."
  - test: "Anon redirect canary — GET /scenarios with redirects NOT followed"
    expected: "HTTP 308 with Location containing /allocations?tab=scenario and never /login"
    why_human: "e2e/route-redirects.spec.ts asserts this in CI; next.config.ts redirects() is structurally correct (verified by read) but the live 308 status is only observable at runtime against a built server."
---

# Phase 51: Shell + Information-Architecture Restructure — Verification Report

**Phase Goal:** A user of any role can answer "where am I / how do I get back" on every surface — role-scoped nav, breadcrumbs, consistent active/hover/focus states, consistent back-paths — while share/deep links NEVER break, because the route-contract inventory + `proxy.ts` `PUBLIC_ROUTES` + a redirect map move in lockstep.
**Verified:** 2026-06-29T09:17:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (success criteria + plan must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC#1 — Nav role-scoped, no orphan/dead-end; the 4 orphans addressed | ✗ PARTIAL | /compare, /decks (allocator workspace), /referral (ACCOUNT) surfaced + role-gated. **/recommendations is still a dead-end** — zero inbound nav/Link/push in all of src/, no breadcrumb back-path; the claimed mandate-CTA does not exist. |
| 2 | SC#2 — Breadcrumbs + active/hover/focus + back-paths app-wide; the 3 a11y gaps fixed | ✗ PARTIAL | Sidebar aria-current+focus-visible ✓ (Sidebar.tsx L346-347). Breadcrumb leaf aria-current + linked-crumb focus-visible ✓ (Breadcrumb.tsx L38,45). PageHeader breadcrumb prop ✓ exists + renders above h1 (PageHeader.tsx L17,23) **but 0 callers pass it** — `grep "breadcrumb={" src/app` = 0. The app-wide back-path is capability-only. |
| 3 | SC#3 — Route-contract inventory exists + canary proves every public/deep-linked/shared route still resolves (no #512 307→login) | ✓ VERIFIED | 56-route manifest classifies all routes; guard exits 0; lockstep Rules 1-4 all real (not stubbed); 41 guard/registry unit tests pass; marketing + redirect anon canaries wired into CI. |
| 4 | SC#4 — (marketing) shared shell introduced WITHOUT changing any public URL or regressing SEO, proxy.ts allowlist + redirect map updated in same change | ✓ VERIFIED | (marketing) is a route group (parens → 0 URL change); old pages deleted, new in (marketing)/; metadata preserved on every page that had it; PUBLIC_ROUTES already covers /legal,/demo,/for-quants,/security (no public-surface widening); single main/h1 per page confirmed. |
| 5 | NAV-03 guard-unit RED→GREEN — runCheck drives 4 violation classes against a tmp fixture tree | ✓ VERIFIED | check-route-contract.test.ts passes (part of the 41); runCheck imports the manifest, parses PUBLIC_ROUTES + redirects() with the stripComments comment-bypass carve-out. |
| 6 | NAV-03 guard wired into `npm run lint` + registered in contracts registry | ✓ VERIFIED | package.json lint chain ends `&& tsx scripts/check-route-contract.ts`; `check:route-contract` script present; CONTRACT_GUARDS + REGISTRY.md both list it. |
| 7 | NAV-01 — /scenarios is a next.config 308 to /allocations?tab=scenario, stub retired, manifest lockstep | ✓ VERIFIED | next.config.ts redirects() { source:'/scenarios', destination:'/allocations?tab=scenario', permanent:true }; (dashboard)/scenarios/ dir deleted; manifest redirectFrom:'/scenarios' satisfied by Rule 3; frozen-spine guard repointed to assert the 308 + page absence. |
| 8 | Role OR-logic (T-45-01) unchanged; frozen invariants intact | ✓ VERIFIED | Sidebar showsAllocator/Manager/Discovery derivations byte-identical to main; no LOCKED file (scenario.ts/compute.ts/FactsheetBody/next-font/css/tailwind) touched. |

**Score:** 6/8 truths verified (2 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/check-route-contract.ts` | 4 lockstep rules, exits 0 | ✓ VERIFIED | All 4 rule bodies real; runs OK — 56 page routes. |
| `src/lib/routing/route-contract-manifest.ts` | All routes classified | ✓ VERIFIED | 56 page routes + 4 exceptions; data-only. |
| `package.json` | lint chain + check:route-contract | ✓ VERIFIED | Both present. |
| `src/__tests__/contracts/contracts-registry.test.ts` + REGISTRY.md | Guard registered | ✓ VERIFIED | CONTRACT_GUARDS + REGISTRY.md entry. |
| `src/components/layout/Sidebar.tsx` | orphans + aria-current + focus-visible | ⚠️ PARTIAL | a11y ✓; /compare,/decks,/referral surfaced; /recommendations not. |
| `src/components/layout/Breadcrumb.tsx` | aria-current leaf + focus-visible links | ✓ VERIFIED | Both present. |
| `src/components/layout/PageHeader.tsx` | breadcrumb prop above h1 | ⚠️ ORPHANED | Prop exists + renders, but 0 callers pass it. |
| `src/app/(marketing)/layout.tsx` | shared chrome only | ✓ VERIFIED | Header + LegalFooter, no main/h1/metadata; server component. |
| `src/app/(marketing)/demo/layout.tsx` | nested demo banner | ✓ VERIFIED | role=region notice, single main, no dup landmark. |
| `next.config.ts` | /scenarios 308 | ✓ VERIFIED | permanent redirect to composer. |
| `e2e/marketing-shell.spec.ts` | anon canary, <400 single landmark | ✓ VERIFIED | Wired into ci.yml unseeded list. |
| `e2e/route-redirects.spec.ts` | /scenarios 308 never /login | ✓ VERIFIED | Wired into ci.yml unseeded list. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| package.json lint | check-route-contract.ts | `&& tsx scripts/check-route-contract.ts` | ✓ WIRED |
| check-route-contract.ts | route-contract-manifest.ts | `import { ROUTE_CONTRACT_MANIFEST }` | ✓ WIRED |
| check-route-contract.ts | src/proxy.ts | parse PUBLIC_ROUTES (Rule 2) | ✓ WIRED |
| next.config.ts | /allocations?tab=scenario | redirects() source/destination | ✓ WIRED |
| manifest | next.config redirects() | redirectFrom:'/scenarios' ↔ Rule 3 | ✓ WIRED |
| (marketing)/layout.tsx | LegalFooter | shared footer mounted once | ✓ WIRED |
| marketing-shell.spec / route-redirects.spec | ci.yml | unseeded playwright list (FLOW-01) | ✓ WIRED |
| WizardClient.tsx | (marketing)/for-quants/RequestCallModal | repointed import | ✓ WIRED |
| **PageHeader breadcrumb prop** | **dashboard pages** | **`breadcrumb={...}`** | **✗ NOT_WIRED (0 callers)** |
| **/recommendations** | **any nav/CTA/breadcrumb** | **inbound link** | **✗ NOT_WIRED (orphan)** |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Route-contract guard exits 0 | `npx tsx scripts/check-route-contract.ts` | "OK — 56 page routes" exit 0 | ✓ PASS |
| Guard via npm lint entry | `npm run check:route-contract` | OK exit 0 | ✓ PASS |
| Guard + registry unit tests | vitest check-route-contract + registry | 41 passed | ✓ PASS |
| a11y + frozen-spine tests | vitest Breadcrumb/Sidebar/PageHeader/phase-32 | 46 passed | ✓ PASS |
| Full phase-51 surface | vitest (9 files) | 108 passed | ✓ PASS |
| /recommendations inbound link | `grep -rn recommendations src --include=*.tsx \| grep href/push` | 0 hits | ✗ FAIL (orphan) |
| PageHeader breadcrumb consumers | `grep -rn "breadcrumb={" src/app` | 0 hits | ✗ FAIL (orphaned prop) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| NAV-01 | 51-03, 51-05 | role-scoped hierarchy, no orphan | ⚠️ PARTIAL | 3/4 orphans surfaced; /scenarios 308 move done; /recommendations still orphan. |
| NAV-02 | 51-01, 51-03 | breadcrumbs + active/hover/focus + back-paths app-wide | ⚠️ PARTIAL | a11y states fully fixed+tested; breadcrumb back-path prop orphaned (0 callers). |
| NAV-03 | 51-01, 51-02 | route-contract inventory + proxy/redirect lockstep | ✓ SATISFIED | Manifest + guard + lint + registry + canaries. |
| NAV-04 | 51-04 | shared shell, no URL change, no SEO regression | ✓ SATISFIED | (marketing) folder-only group, metadata + single-landmark preserved. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| Sidebar.tsx | 70-73 | Comment asserts /recommendations "mandate-CTA-reachable + breadcrumb back-path" | ⚠️ Warning | Claim is not backed by code — the affordance is absent. Misleading audit trail. |
| phase-32-frozen-spine-guards.test.ts | 17-20 | Stale header doc says scenarios/page.tsx "is a thin redirect" | ℹ️ Info | Doc-comment only; the actual test body (L249-281) correctly asserts the next.config 308 + page absence and passes. |

No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER debt markers in any modified source file.

### Human Verification Required

1. **(marketing) anon shell canary** — Load each marketing route logged-out; expect <400 at the exact URL with a single main + single h1. (CI: e2e/marketing-shell.spec.ts; not runnable in the verifier sandbox.)
2. **/scenarios 308 redirect canary** — GET /scenarios without following; expect 308 → /allocations?tab=scenario, never /login. (CI: e2e/route-redirects.spec.ts.)

### Gaps Summary

The routing-correctness half of the phase (SC#3 NAV-03 + SC#4 NAV-04) is solidly delivered: the route-contract guard is a real, exit-0, lint-wired, registry-pinned gate over a complete 56-route manifest; the (marketing) group is genuinely folder-only with zero URL change, preserved metadata and single landmarks; the one /scenarios move is a config-level 308 with manifest lockstep, the stub retired, and the frozen-spine guard correctly repointed. The role OR-logic (T-45-01) and all frozen invariants are untouched.

The "where am I / how do I get back" UX half (SC#1 NAV-01, SC#2 NAV-02) lands two real gaps:

1. **/recommendations is still an orphan/dead-end.** It is not in nav, has no inbound link anywhere in src/, and renders PageHeader without a breadcrumb. The phase's own comment claims a mandate-CTA back-path that does not exist in code — so SC#1's "no orphan/dead-end" is not fully true. (3 of the 4 named orphans ARE correctly surfaced.)

2. **The PageHeader breadcrumb prop is orphaned.** The capability was added and unit-tested, but no page passes it, so "breadcrumbs / back-paths app-wide" (SC#2) is delivered as a capability, not an observable app-wide behavior.

The a11y state work in SC#2 (sidebar + breadcrumb aria-current + focus-visible) IS fully done and tested. These two gaps are focused and share a root concern: the back-path affordance was built but not connected to the orphan surfaces it was meant to rescue.

---

## VERIFICATION FAILED

Specific gaps blocking goal achievement:

1. **SC#1 — /recommendations remains an orphan/dead-end.** No nav entry, no inbound link in all of src/, no breadcrumb back-path; the claimed mandate-CTA does not exist. Fix: add a role-gated nav entry OR a real CTA link + a PageHeader breadcrumb prop on the recommendations page.

2. **SC#2 — PageHeader breadcrumb back-path is orphaned (0 callers).** The prop exists and is unit-tested but is consumed by no page, so "breadcrumbs/back-paths app-wide" is capability-only. Fix: wire the breadcrumb prop into the dashboard surfaces the phase identified as orphans.

_Verified: 2026-06-29T09:17:00Z_
_Verifier: Claude (gsd-verifier)_
