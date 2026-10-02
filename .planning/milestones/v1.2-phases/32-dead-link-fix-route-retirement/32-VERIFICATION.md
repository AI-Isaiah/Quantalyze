---
phase: 32-dead-link-fix-route-retirement
verified: 2026-06-23T00:00:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification_resolved: "2026-06-24 — FLOW-02 (/scenarios → 307 → /allocations?tab=scenario) and FLOW-03 (role-nav: allocator sees only 'My Allocation' in MY WORKSPACE; no Strategy Sandbox / /scenarios entry) re-confirmed live via headed-browser /qa (Playwright MCP, prod). NOTE: the FLOW-01 human test text above is STALE — it describes the pre-ship ?portfolio= auto-attach design that /ship (#520) REMOVED as a dead/unreachable feature. The shipped+corrected FLOW-01 (manage '+ Add Strategy' → /discovery/crypto-sma listing, manual add-dropdown) was confirmed live in the #520 v0.30.0.0 /qa and is code-verified (revert netted those files zero-diff; AddToPortfolio.test rewritten for the real manual path). It is a manager/portfolio surface not present on this allocator-only account, so it was not re-exercised this session."
human_verification:
  - test: "Navigate to /portfolios/[real-id] as an allocator. Click '+ Add Strategy' on the manage page and on the empty-state portfolio view. Verify the discovery page opens with ?portfolio=<id> in the URL, and after opening AddToPortfolio dropdown, the correct portfolio is pre-selected / auto-attached."
    expected: "Strategy attaches back to the portfolio the user navigated from (FLOW-01 end-to-end, one gesture)."
    why_human: "Auto-attach fires on open of the dropdown (useEffect gated on `open`). Browser-level interaction + Supabase RLS-scoped insert can only be confirmed by a real render with real auth."
  - test: "Navigate to /scenarios as a logged-in user. Confirm you land on /allocations?tab=scenario (the unified composer) and not a blank page or error."
    expected: "307 redirect fires; browser URL becomes /allocations?tab=scenario; composer renders with no console errors. No self-loop occurs."
    why_human: "Next.js redirect() in a Server Component only fires on real request handling — the vitest mock confirms the redirect call, but actual HTTP status + browser redirect chain must be confirmed live."
  - test: "Check the sidebar as an allocator-only user (role='allocator'). Confirm 'My Allocation' (/allocations) is the only workspace nav item; no 'Strategy Sandbox' or /scenarios entry is present. Check that a manager-only user still sees /portfolios."
    expected: "Allocator: one workspace entry (/allocations). Manager: Strategies + Portfolios entries. No /scenarios item for any role."
    why_human: "Role-conditional nav rendering can only be fully confirmed with real session tokens in a browser — the Sidebar.tsx code is verified correct by grep, but hydration + role-prop plumbing needs live confirmation."
---

# Phase 32: Dead-Link Fix & Route Retirement — Verification Report

**Phase Goal:** Every end-to-end allocator flow attaches back with no dead links; `/scenarios` + the legacy allocator Portfolios path resolve into the unified composer; a new allocator has one discoverable entry point — WITHOUT breaking managers' `/portfolios` or its 30+ consumers, and NO table DDL.
**Verified:** 2026-06-23
**Status:** passed (FLOW-02 + FLOW-03 re-confirmed live 2026-06-24; FLOW-01 corrected-design confirmed in #520 /qa + code-verified — see human_verification_resolved)
**Re-verification:** 2026-06-24 — human gates only

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Portfolio-context "+ Add Strategy" links carry `?portfolio=${id}` (not a bare slug) | ✓ VERIFIED | `portfolios/[id]/manage/page.tsx` line 56: `href={\`/discovery/crypto-sma?portfolio=${id}\`}`; `portfolios/[id]/page.tsx` line 93: `href={\`/discovery/crypto-sma?portfolio=${portfolioId}\`}` |
| 2 | `AddToPortfolio` reads `?portfolio` param and auto-attaches to the owned portfolio in one gesture | ✓ VERIFIED | `AddToPortfolio.tsx` lines 25-68: `useSearchParams()` → `defaultPortfolioId`, RLS-scoped owned-set match, `autoAttachedRef` one-shot guard, calls `handleAdd(defaultPortfolioId)` |
| 3 | No bare `href="/discovery/crypto-sma"` (without `?portfolio=`) anywhere in the portfolios tree | ✓ VERIFIED | Exit-gate guard test covers this; grep of both portfolio page files confirms no bare slug; frozen-spine test asserts with non-vacuous self-pins |
| 4 | `/scenarios/page.tsx` is a 307 redirect to `/allocations?tab=scenario`; no `createAdminClient`, no `ScenarioBuilder`, no institutional-universe read | ✓ VERIFIED | File is 13 lines, imports only `redirect` from `next/navigation`, single call `redirect("/allocations?tab=scenario")`; `page.test.ts` pins the exact redirect target |
| 5 | `ScenarioBuilder.tsx` is deleted; `ScenarioBuilder.honesty.test.tsx` is deleted; `page.role-gate.test.ts` is deleted | ✓ VERIFIED | All three paths return `No such file or directory`; no `import … from.*ScenarioBuilder` in any non-test source file; `scenario.ts` comment references are historical prose, not live imports |
| 6 | Sidebar has no `/scenarios` nav item and no `BeakerIcon`; allocator gets one entry (`/allocations`); manager keeps `/portfolios` | ✓ VERIFIED | `Sidebar.tsx` grep for `"/scenarios"` returns no matches (exit code 1 = not found); `buildNavSections` pushes `/allocations` for allocators, `/strategies` + `/portfolios` for managers; comment at line 67-74 explicitly documents FLOW-03 intent |
| 7 | `ScenarioComposer.tsx` has no `href="/scenarios"` self-loop; IMPACT-02 peer-rank suppression coverage survives in `ScenarioComposer.test.tsx` | ✓ VERIFIED | grep for `href="/scenarios"` in ScenarioComposer exits 1 (not found); `ScenarioComposer.test.tsx` lines 2977-3218 carry the sole IMPACT-02 peer-rank guard with explicit comment noting it is "the SOLE peer-rank-suppression coverage" after ScenarioBuilder retirement |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/scenarios/page.tsx` | 307 redirect only (no admin read, no ScenarioBuilder) | ✓ VERIFIED | 13 lines; `redirect("/allocations?tab=scenario")` only |
| `src/components/layout/Sidebar.tsx` | No `/scenarios` entry; `/allocations` for allocators; `/portfolios` for managers | ✓ VERIFIED | Confirmed by code read; FLOW-03 comment at line 67 |
| `src/components/portfolio/AddToPortfolio.tsx` | Reads `?portfolio` param; RLS-scoped auto-attach | ✓ VERIFIED | Full implementation present; security note at line 49 |
| `src/app/(dashboard)/portfolios/[id]/page.tsx` | Empty-state link carries `?portfolio=${portfolioId}` | ✓ VERIFIED | Line 93 |
| `src/app/(dashboard)/portfolios/[id]/manage/page.tsx` | "+ Add Strategy" link carries `?portfolio=${id}` | ✓ VERIFIED | Line 56 |
| `src/__tests__/phase-32-frozen-spine-guards.test.ts` | Exit-gate guard present, 7 `it()` blocks | ✓ VERIFIED | File exists; 7 test cases covering SCENARIO-05 / FLOW-01 / FLOW-02 / FLOW-03 / landmine #2; non-vacuous self-pins for each regex |
| `src/app/(dashboard)/scenarios/page.test.ts` | Pins redirect target `/allocations?tab=scenario` | ✓ VERIFIED | File exists; `toHaveBeenCalledWith("/allocations?tab=scenario")` + `toHaveBeenCalledTimes(1)` |
| `src/components/scenarios/ScenarioBuilder.tsx` | DELETED | ✓ VERIFIED | Does not exist |
| `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` | DELETED | ✓ VERIFIED | Does not exist |
| `src/app/(dashboard)/scenarios/page.role-gate.test.ts` | DELETED | ✓ VERIFIED | Does not exist |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `portfolios/[id]/page.tsx` EmptyState | `AddToPortfolio.tsx` defaultPortfolioId | `?portfolio=${portfolioId}` query param on `/discovery/crypto-sma` href | ✓ WIRED | Line 93 passes `portfolioId`; AddToPortfolio reads via `useSearchParams().get("portfolio")` |
| `portfolios/[id]/manage/page.tsx` | `AddToPortfolio.tsx` defaultPortfolioId | `?portfolio=${id}` query param on `/discovery/crypto-sma` href | ✓ WIRED | Line 56 passes `id`; same reader path |
| `/scenarios/page.tsx` | `/allocations?tab=scenario` | `redirect()` from `next/navigation` | ✓ WIRED | Direct call; no intermediate routing; test pins exact string |
| `Sidebar.tsx` allocator workspace | `/allocations` | `href: "/allocations"` in `workspaceItems` | ✓ WIRED | Line 62; no second workspace item for allocator-only users |
| `ScenarioComposer.test.tsx` | IMPACT-02 peer-rank guard | `ingestSource:"api"` pattern assertion at line 3218 | ✓ WIRED | Explicit comment at line 2986 declares it the "SOLE" coverage after ScenarioBuilder deletion |

### Data-Flow Trace (Level 4)

Not applicable. Phase 32 is routing + nav + two file deletions — zero new data-fetching paths introduced. The existing `portfolio_strategies` INSERT in `AddToPortfolio.handleAdd()` (line 82-91) pre-existed Phase 32; Phase 32 only adds the `defaultPortfolioId` pre-selection layer on top.

### Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `/scenarios/page.tsx` contains redirect call | `grep 'redirect.*allocations' src/app/(dashboard)/scenarios/page.tsx` | Match found | ✓ PASS |
| ScenarioBuilder file is absent | `ls src/components/scenarios/ScenarioBuilder.tsx` | No such file | ✓ PASS |
| Sidebar has no `/scenarios` string | `grep '"/scenarios"' src/components/layout/Sidebar.tsx` | No match (exit 1) | ✓ PASS |
| ScenarioComposer has no self-loop | `grep 'href="/scenarios"' src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | No match (exit 1) | ✓ PASS |
| No migration files touching portfolios in phase commits | `git diff --name-only b8a0337b 58fdd682 -- supabase/migrations/` | Empty (no matches) | ✓ PASS |
| No live `import … from.*ScenarioBuilder` in source | grep over `src/` excluding test files | Only comment/prose references in `scenario.ts` and test files | ✓ PASS |
| No orphaned `EquityCurveChart` or `MetricCard` import from ScenarioBuilder | grep over `src/` | `MetricCard` exists as file-private functions in `strategy/[id]/page.tsx` and `landing/VerificationResults.tsx` (unrelated to ScenarioBuilder); no `EquityCurveChart` anywhere — both were file-private to ScenarioBuilder per RESEARCH.md | ✓ PASS |

### Probe Execution

No probes declared for Phase 32. The frozen-spine guard (`phase-32-frozen-spine-guards.test.ts`) is the functional equivalent and runs in the vitest suite (reported GREEN at 6578 passed per the phase context).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FLOW-01 | 32-01-PLAN.md | Adding a strategy attaches back to that portfolio; dead `/discovery/crypto-sma` link fixed | ✓ SATISFIED | `?portfolio=` on both portfolio-tree links; `AddToPortfolio` auto-attach via owned-set match |
| FLOW-02 | 32-02-PLAN.md | `/scenarios` + allocator Portfolios path resolve into unified composer; no dead links; no manager breakage; NO DDL | ✓ SATISFIED | `/scenarios/page.tsx` is a clean 307; no migration files; manager `/portfolios` untouched; 30+ non-route consumers unaffected (no schema change) |
| FLOW-03 | 32-03-PLAN.md | New allocator has one nav entry; managers keep `/portfolios` | ✓ SATISFIED | Sidebar: `/allocations` for allocators; `/strategies` + `/portfolios` for managers; no `/scenarios` item |

**Note:** REQUIREMENTS.md traceability table still shows FLOW-01 and FLOW-02 as `Pending` and only FLOW-03 as `Complete`. This is a documentation state issue — the code satisfies all three. The table should be updated to mark FLOW-01 and FLOW-02 `Complete` to keep the roadmap metadata accurate.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TBD/FIXME/XXX markers found in phase-modified files. No stubs. No hardcoded empty data paths introduced.

### Human Verification Required

The automated checks confirm correct routing wiring and code structure. The following require a live browser session (deferred to post-ship /qa, per phase instructions):

#### 1. FLOW-01 End-to-End Attach-Back

**Test:** As an allocator, open a real portfolio. Click "+ Add Strategy" on the manage page (or "Add your first strategy" on the empty-state portfolio view). Confirm the discovery page URL contains `?portfolio=<correct-id>`. Open the AddToPortfolio dropdown; confirm the portfolio auto-selects / auto-attaches.
**Expected:** Strategy is inserted into `portfolio_strategies` for THAT portfolio in one gesture; feedback shows "Added!".
**Why human:** `useEffect` on `open` + Supabase RLS insert cannot be observed without a real auth session and real browser interaction.

#### 2. FLOW-02 /scenarios Redirect in Live Browser

**Test:** Navigate to `https://quantalyze-rho.vercel.app/scenarios` as any logged-in user.
**Expected:** Browser lands on `/allocations?tab=scenario` (the unified composer); HTTP status is 307; no error page, no self-loop.
**Why human:** Next.js `redirect()` in a Server Component fires during SSR; vitest mocks the call but only a real HTTP request confirms the 307 chain and that the composer renders correctly at the target URL.

#### 3. FLOW-03 Role-Conditional Nav in Live Browser

**Test:** Log in as an allocator-only account; confirm sidebar shows "My Allocation" (/allocations) with no "Strategy Sandbox" or /scenarios entry. Log in as a manager-only account; confirm "Strategies" and "Portfolios" entries are present.
**Expected:** Allocator: exactly one workspace item. Manager: Strategies + Portfolios, no /allocations unless role=both.
**Why human:** Role-prop plumbing goes through server-side session read → DashboardChrome → Sidebar. The Sidebar.tsx code is correct by code inspection, but role-conditional hydration can only be fully confirmed with real session tokens.

### Gaps Summary

No gaps. All 7 must-have truths are VERIFIED by code evidence. The `human_needed` status reflects the standard post-ship /qa requirement for live-browser UX confirmations, not any code deficiency.

The REQUIREMENTS.md traceability table (`FLOW-01: Pending`, `FLOW-02: Pending`) is a cosmetic documentation inconsistency — the roadmap metadata was not updated when the phase completed. This does not reflect any missing implementation.

---

_Verified: 2026-06-23_
_Verifier: Claude (gsd-verifier)_
