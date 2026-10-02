---
phase: 110-contrib-private-by-default-contribution
verified: 2026-07-16T16:15:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live overlay contribution flow — no URL change"
    expected: "As an allocator, clicking 'Add a Strategy' (nav) opens the wizard overlay with NO change to the browser URL; completing a CSV or API-key contribution closes the overlay and stays put (no bounce to /strategies)."
    why_human: "Requires a running app + real session; the no-URL-change and no-redirect behavior is a runtime/visual property grep cannot confirm (createPortal + callback-gated pushes are verified statically, but the live render is not)."
  - test: "Owner sees their own private contribution in Browse; second account never does"
    expected: "After contributing, the owner reopens the composer Browse drawer and the new private row is selectable; a second, non-owner account opening Browse never sees that row."
    why_human: "Cross-owner isolation is proven at the RLS layer (SQL test) and query-builder layer (unit tests), but the end-to-end live-DB round-trip (real insert → refetch → second-session absence) needs a deployed environment with two real accounts."
  - test: "RLS isolation SQL test green in CI sql-tests job post-merge"
    expected: "supabase/tests/test_strategies_private_owner_isolation.sql runs green in the CI sql-tests job against the caught-up test project (all 5 arms pass)."
    why_human: "Executor/verifier has no Supabase MCP or test-DB access; the migrations were MCP-applied to the test project per 110-01 SUMMARY, and CI re-proves the test post-merge — neither is runnable from here."
---

# Phase 110: CONTRIB — Private-by-Default Contribution Verification Report

**Phase Goal:** An allocator can contribute an off-catalog strategy through the existing role-neutral wizard, private by default, and select it in the composer Browse drawer — with zero cross-owner leakage.
**Verified:** 2026-07-16T16:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria = CONTRIB-01..05)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 (CONTRIB-01) | Allocator adds an off-catalog strategy via the existing wizard, reached from an allocator-scoped "Add a Strategy" nav entry that finalizes UNpublished (no manager_status write, no "your investors" copy) | ✓ VERIFIED | `Sidebar.tsx:135-137` + `:270` push `{label:"Add a Strategy", action:"add-strategy"}` INSIDE `showsAllocatorWorkspace` in BOTH builders; `grep "Add a Strategy" ... \| grep -c href` = 0 (client action, no navigation). `DashboardChrome.tsx:12,66-74` hosts `ContributionWizardOverlay` at chrome level (`onSuccess`→router.refresh). WizardClient branches sell-side copy on `entryContext` (SubmitStep/CsvSubmitStep allocator copy). Finalize terminates `'private'` (truth 2). Tests: Sidebar/MobileNav/DashboardChrome green. |
| 2 (CONTRIB-02) | A contributed strategy is private by default — never enters the public catalog, never auto-published | ✓ VERIFIED | RPC guard: `finalize_terminal_status_param.sql:95,238` — first-statement `IF p_terminal_status NOT IN ('pending_review','private') THEN RAISE` (published unreachable from any caller). Status write threads the param (`:155` wizard UPDATE, `:294` CSV INSERT `p_terminal_status`). Routes select it: `finalize-wizard/route.ts:417-418` derives `terminalStatus`, diverts contributions to `runLegacyFinalize` (`:673-674`, `:796 p_terminal_status`) BEFORE the unified arm; `csv-finalize/route.ts:1063-1064,1333` calls `finalize_csv_strategy` directly with `p_terminal_status:'private'`. Admin publish queue filters `pending_review` only (`admin/page.tsx:40`); promotion UPDATE is status-pinned to `pending_review` (`strategy-review/route.ts:333`) — a private row can never be promoted. Notify suppressed on contribution; analytics enqueue kept. |
| 3 (CONTRIB-03) | Allocator sees/selects own private contributions in the composer Browse drawer (owner-inclusive discovery via withPublishedOrOwner) | ✓ VERIFIED | `visibility.ts:115-123` realizes `withPublishedOrOwner` (`status.eq.published,user_id.eq.${authUserId}`). `browse/route.ts:129-141` calls it with `user.id` from `withAllocatorAuth` (session-only), on the user-scoped client (0 `createAdminClient`). ScenarioComposer onSuccess reopens Browse (once-per-open refetch surfaces the new row). Unit tests: owner-inclusive predicate + owner-own-row + session-only. |
| 4 (CONTRIB-04) | A second, non-owner user never sees the first user's unpublished strategy in Browse — proven at RLS + query-builder layers (session-only userId) + a lint banning `.or('...user_id...')` on service-role clients | ✓ VERIFIED | RLS: `test_strategies_private_owner_isolation.sql` — 5 content-asserted arms (owner-B→0 private, owner-B→1 published control, owner-A→1 own private, anon→0, guard-pin finalize(published) RAISEs); BEGIN…ROLLBACK, `request.jwt.claims` session switch, no pgTAP. Query-builder: browse route tests pin session-only id (a `?user_id` param cannot alter the filter). Lint: `no-owner-or-on-admin-client.mjs` (regex `/user_id\.eq\./`, marker-exempt) registered in `index.mjs` + `eslint.config.mjs` at error, in contracts-registry `REPO_WIDE_ERROR_RULES`. `npx eslint` on visibility+browse → EXIT 0. |
| 5 (CONTRIB-05) | The Browse drawer surfaces a "Can't find it? Add your own" CTA linking to the contribution path | ✓ VERIFIED | `StrategyBrowseDrawer.tsx:85,555-563` — optional `onAddOwn` renders "Can't find it? Add your own" `<button>` beneath results/empty/error. `ScenarioComposer.tsx` wires `onAddOwn` at BOTH drawer mounts (`:3300`, `:4608`) + 2 `ContributionWizardOverlay` mounts (`:3308`, `:4615`) sharing `contributeOpen`; onSuccess reopens Browse. Drawer + composer tests green. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/20260716130000_strategies_status_private.sql` | status CHECK widened to include 'private', no policy | ✓ VERIFIED | 5-value CHECK (`:60-61`), self-verify DO block, 0 CREATE/ALTER POLICY |
| `supabase/migrations/20260716130500_finalize_terminal_status_param.sql` | both finalize RPCs re-created with guarded p_terminal_status | ✓ VERIFIED | DROP FUNCTION+CREATE (no overload), first-statement guard on both, status write uses param, REVOKE/GRANT footer, SECURITY DEFINER, self-verify overload count |
| `supabase/tests/test_strategies_private_owner_isolation.sql` | RLS cross-owner isolation (CONTRIB-04 DB layer) | ✓ VERIFIED | 5 arms, BEGIN…ROLLBACK, fixture-scoped counts, guard-pin; execution deferred to CI/MCP (human item 3) |
| `src/lib/visibility.ts` → `withPublishedOrOwner` | owner-inclusive helper | ✓ VERIFIED | exact predicate string, B10 marker intact, no server-only import |
| `src/app/api/strategies/browse/route.ts` | owner-inclusive discovery, session id | ✓ VERIFIED | helper call with user.id, 0 withPublishedOnly, 0 createAdminClient |
| `tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs` | build-time backstop | ✓ VERIFIED | registered (index.mjs + eslint.config.mjs = error), lint passes |
| `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` | reusable createPortal overlay (≥60 lines) | ✓ VERIFIED | 171 lines, createPortal, 0 useSearchParams/router.push, {isOpen,onClose,onSuccess} contract, keyed source remount |
| `WizardClient.tsx` | entryContext/onSuccess/onClose/sourceOverride params | ✓ VERIFIED | all 5 terminal router.push("/strategies") callback-gated (`if isContribution → onClose/onSuccess; else push`); manager page mounts byte-compatibly (no new props) |
| `finalize-wizard/route.ts` + `csv-finalize/route.ts` | entry_context → p_terminal_status='private' | ✓ VERIFIED | validated closed-set (400 on garbage), terminalStatus derivation, RPC arg threaded on both paths |
| `Sidebar.tsx`/`DashboardChrome.tsx`/`StrategyBrowseDrawer.tsx` | nav action + host + CTA | ✓ VERIFIED | all present, role-scoped, no-href, wired |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| finalize migration | strategies.status | `status = p_terminal_status` | ✓ WIRED (`:155` UPDATE, `:294` INSERT) |
| RLS test | strategies_read policy | request.jwt.claims session switch | ✓ WIRED |
| browse/route.ts | visibility.ts | withPublishedOrOwner(…, user.id) | ✓ WIRED |
| eslint.config.mjs | lint rule | error severity | ✓ WIRED |
| ContributionWizardOverlay | WizardClient | entryContext="contribution" + callbacks | ✓ WIRED |
| WizardClient steps | finalize endpoints | entry_context POST field | ✓ WIRED (SubmitStep:91, CsvSubmitStep:135) |
| finalize routes | finalize_*_strategy RPC | p_terminal_status arg | ✓ WIRED |
| DashboardChrome / ScenarioComposer | ContributionWizardOverlay | state-driven mount | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript compiles | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Phase 110 test files | `vitest run <13 files>` | 13 files / 256 tests passed | ✓ PASS |
| Composer + contracts registry | `vitest run ScenarioComposer + contracts-registry` | 2 files / 206 tests passed | ✓ PASS |
| Lint rule active, no false-positive | `npx eslint visibility.ts browse/route.ts` | exit 0 | ✓ PASS |
| Browse route uses no admin client | `grep -c createAdminClient browse/route.ts` | 0 | ✓ PASS |
| Overlay has no navigation | `grep -c "useSearchParams\|router.push" overlay` | 0 | ✓ PASS |
| Nav action has no href | `grep "Add a Strategy" Sidebar.tsx \| grep -c href` | 0 | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| RLS isolation SQL test | requires Supabase MCP / CI sql-tests | not runnable from verifier (no DB access) | ? SKIP → human item 3 |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| CONTRIB-01 | 110-03, 110-05 | ✓ SATISFIED | truth 1 |
| CONTRIB-02 | 110-01, 110-03, 110-04 | ✓ SATISFIED | truth 2 |
| CONTRIB-03 | 110-02 | ✓ SATISFIED | truth 3 |
| CONTRIB-04 | 110-01, 110-02 | ✓ SATISFIED | truth 4 |
| CONTRIB-05 | 110-05 | ✓ SATISFIED | truth 5 |

No orphaned requirements — REQUIREMENTS.md maps CONTRIB-01..05 to Phase 110; all appear in plan `requirements` fields and are code-verified.

### Anti-Patterns Found

None. No TBD/FIXME/XXX in the phase's modified files. The unified API-key arm's retained `pending_review` literals are documented as manager-only-reachable (contributions divert to `runLegacyFinalize` before that arm, verified at `finalize-wizard/route.ts:673-674`) — not a stub. The direct `finalize_csv_strategy` call on the user-scoped client is behind the same SECDEF `auth.uid()=p_user_id` guard as every other finalize.

### Human Verification Required

1. **Live overlay contribution flow (no URL change)** — as an allocator, "Add a Strategy" opens the wizard overlay with no browser-URL change; complete a CSV/API-key contribution; the overlay closes and does not bounce to /strategies.
2. **Owner-only visibility round-trip** — the contributed private row appears in the owner's composer Browse on refetch; a second, non-owner account never sees it.
3. **RLS SQL test in CI** — `test_strategies_private_owner_isolation.sql` runs green in the CI sql-tests job against the caught-up test project (migrations MCP-applied per 110-01 SUMMARY; verifier has no DB access to re-run).

### Gaps Summary

No code-layer gaps. All 5 ROADMAP success criteria (CONTRIB-01..05) are verified in the codebase: the DB widens `status` to `'private'` and both finalize RPCs RAISE on any terminal status outside `('pending_review','private')` so `'published'` is unreachable from any caller; both finalize routes select `'private'` on `entry_context='contribution'` and divert away from the unpublish-only unified arm; Browse discovery is owner-inclusive with a session-only id, backed by an RLS isolation test, query-builder tests, and an error-severity lint rule; the wizard overlay mounts inline via createPortal with zero navigation and all terminal `router.push` sites callback-gated; and both launch surfaces (allocator nav action + Browse "Add your own" CTA) are role-scoped client actions. tsc is clean and 462 phase-relevant tests pass. Status is `human_needed` solely because the live end-to-end flow (inline overlay render, live-DB two-account isolation round-trip) and the CI/MCP execution of the RLS SQL test are runtime/deploy verifications outside the verifier's reach — as the 110-VALIDATION.md manual-only section anticipated.

---

_Verified: 2026-07-16T16:15:00Z_
_Verifier: Claude (gsd-verifier)_
