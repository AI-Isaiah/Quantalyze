---
phase: 66-carry-forward-burn-down
verified: 2026-07-04T09:15:00Z
status: passed
score: 14/14 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 66: Carry-Forward Burn-Down Verification Report

**Phase Goal:** The accumulated v1.6 debt is honestly gone — red-team findings fixed at root, planning-ledger smalls closed, and TODOS.md reflects only live debt
**Verified:** 2026-07-04
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Share-mint gate carries no dead `isBookOnlyDraft` disjunct; comment corrected (SC1 / CF-01) | ✓ VERIFIED | `grep -c isBookOnlyDraft share/route.ts` → 0; no non-test call sites repo-wide; `export function isBookOnlyDraft` gone from scenario-state.ts; route.ts:188-198 rewritten honest ("book-only ⇔ ZERO added strategies", no shared-predicate claim) |
| 2  | Book-only drafts still 409 via `nothingShareable` alone (regression-pinned) | ✓ VERIFIED | T_SH17 at route.test.ts:421 asserts 409 + `book_only_draft` for a 2-memberKeyIds/zero-added draft; T_SH13/T_SH15 intact |
| 3  | 65..1000 memberKeyIds pass validation, 1001 rejected, never silently clamped (SC2 / CF-02) | ✓ VERIFIED | `export const MAX_MEMBER_KEY_IDS = 1000` at scenario-state.ts:741; `.max(MAX_MEMBER_KEY_IDS)` at :799 (per-id `.max(MAX_DRAFT_KEY_LENGTH)` retained; `lastEditedAt .max(64)` untouched); tests 65/exact-1000/1001 build arrays from the const (scenario-state.test.ts:768-800); no `slice(0,` clamp on any non-test memberKeyIds path |
| 4  | Over-cap save 400 renders honest ceiling copy, never the generic connection error (SC2) | ✓ VERIFIED | `saveErrorMessage` at ScenarioComposer.tsx:676 interpolates `MAX_MEMBER_KEY_IDS` (imported :126); wired at both `!res.ok` sites (:1635 POST, :1676 PUT) via `readSaveIssues`; catch paths keep `SAVE_ERROR_GENERIC` (honest for network failures); generic literal appears exactly once (the const); T_SAVE9b/T_SAVE9c at save.test.tsx:600/:639, T_SAVE9 unchanged |
| 5  | F-4 sweep detection predicate + re-derive transform proven by CI fixture independent of prod (SC3 / CF-03) | ✓ VERIFIED | `supabase/tests/test_scenario_downgrade_sweep.sql` (429 lines, 2 `DO $$` blocks, no pgTAP, no psql meta-commands, auto-discovered glob); seeds downgraded + genuine-populated + blank-save-`[]` + pre-v4 + non-finite-series shapes; discriminator `schema_version >= 4 AND NOT (draft ? 'memberKeyIds')` + `jsonb_set` copied verbatim from the sweep |
| 6  | Sweep mirrors the runtime series filter (WR-01 fixed) | ✓ VERIFIED | `has_series` in f4-memberkeyids-restamp.sql:150-152 excludes `'NaN'/'Infinity'/'-Infinity'::float8` (mirrors `Number.isFinite` drop); same predicate in both fixture copies (:262-264); NF-allocator fixture case seeds NaN/±Inf rows (:176-178) proving gate-false → `[]`; fix commit 08d3f8b2 on branch; corrected fixture PASSED on TEST project post-fix (session evidence) |
| 7  | Prod carries zero downgraded v4 rows — honest 0-row closure (SC3) | ✓ VERIFIED | Session-evidenced prod checkpoint (66-02-SUMMARY embedded verbatim): SANITY + DETECT both 0 rows, prod scenarios table empty, post-condition `remaining_downgraded_rows=0` asof 2026-07-04 07:38Z; RESTAMP never run (sanctioned 0-row path) |
| 8  | phase10-rpc auth.users residue deleted from prod with before/after evidence (SC5 / CF-05) | ✓ VERIFIED | Session-evidenced: BEFORE SELECT 8 rows (resolves 6-vs-2 dispute), dependent-data check (8 profiles, 2 synthetic api_keys, 0 scenarios), same-pattern DELETE, AFTER count 0 asof 2026-07-04 07:39Z |
| 9  | Dead `holdingReturnsByScopeRef` SSR pipeline removed end-to-end; no consumer breaks (SC4 / CF-04) | ✓ VERIFIED | `grep -rni holdingReturnsByScopeRef src/` → nothing (fn, type field, call site, construction lines, prose, all test stubs/pins gone); tsc exit 0 proves no consumer read it |
| 10 | `holdingsSummary` untouched and live (RISK-1 scope correction) | ✓ VERIFIED | 14 refs remain in queries.ts; live consumers intact (HoldingsTabPanel, AllocationDashboardV2, AllocationsTabs, ScenarioComposer, ScenarioComparePanel, useScenarioState, mandate-gates, holdings-adapter); 66-03-SUMMARY records the already-satisfied-in-phase-63 verdict |
| 11 | Per-key gantt rows render friendly labels, never raw key UUIDs (SC5) | ✓ VERIFIED | `apiKeyLabelById` useMemo (ScenarioComposer.tsx:2409) via existing `dataSourceLabel`; `timelineRows` maps `name: apiKeyLabelById.get(s.id) ?? s.name` (:2426); composer regression at ScenarioComposer.test.tsx:5234 ("Bybit — Main", raw id absent, RED-proven commit ab061ded); CoverageTimeline.test.tsx CF-05 render-contract test appended (:184), phase-58 suite + STATIC GUARD intact (236 lines, additions only) |
| 12 | ScenarioComparePanel mount is compile-time-checked — the `as unknown as` double-cast is gone (SC5) | ✓ VERIFIED | `grep -c "as unknown as" AllocationsTabs.tsx` → 0; `const comparePanelPayload: ScenarioComparePanelProps["payload"]` at :949, passed at :981; tsc exit 0 is the standing gate |
| 13 | D3 source-toggle no-persistence decision recorded at the toggle site (SC5) | ✓ VERIFIED | ScenarioComposer.tsx:855 "D3 source-toggle persistence: DECIDED no persistence (YAGNI, Phase 66 CF-05)…"; decision also in 66-04-SUMMARY |
| 14 | TODOS.md reflects only live, verified debt; quick wins fixed (SC5 / CF-06) | ✓ VERIFIED | 690 lines (was 1001); 0 `~~` markers; 0 F-3/F-4/F-5 refs; 0 isBookOnlyDraft/holdingReturnsByScopeRef refs; 0 stale holdingsSummary-dedup entry (deletion evidenced by live triple-key dedup — evidence-over-pin deviation documented); `formatBadgeCount` shared helper (Sidebar.tsx:30, wired :382 + MobileNav.tsx:87), 99+ tests on both surfaces (MobileNav.test.tsx:199, Sidebar.test.tsx:282), aria-label keeps true count (:379); DesktopGate comments in for-quants-lead/route.ts now describe the Phase-46-removed component as back-compat-token-only (:176, :194); 62-row evidenced triage table in 66-05-SUMMARY |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/allocator/scenario/share/route.ts` | Gate keyed purely on addedStrategies emptiness, honest comment | ✓ VERIFIED | 0 isBookOnlyDraft refs; honest MEMBER-03 block :188-198 |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | Exported MAX_MEMBER_KEY_IDS=1000 wired into zod bound | ✓ VERIFIED | :741 const, :799 `.max(MAX_MEMBER_KEY_IDS)` |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | One shared save-error helper at all save sites | ✓ VERIFIED | `saveErrorMessage` :676, wired POST+PUT, single generic literal |
| `supabase/tests/test_scenario_downgrade_sweep.sql` | CI-discovered PL/pgSQL fixture proving discriminator + transform | ✓ VERIFIED | Exists, convention-compliant, WR-01 mirror + NF case included |
| `scripts/sweeps/f4-memberkeyids-restamp.sql` | Detection-first sweep: SANITY / DETECT / RESTAMP | ✓ VERIFIED | Exists; discriminator in DETECT and UPDATE WHERE (idempotent) |
| `src/lib/queries.ts` | Payload without dead field; holdingsSummary intact | ✓ VERIFIED | 0 dead-field refs; 14 live holdingsSummary refs |
| `src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx` | Friendly-label regression extending phase-58 suite | ✓ VERIFIED | CF-05 test :184; existing suite + STATIC GUARD preserved |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | Explicit structural narrow for compare-panel payload | ✓ VERIFIED | `comparePanelPayload` typed const :949; zero casts |
| `TODOS.md` | Only live, verified debt | ✓ VERIFIED | All five end-state gates green (see truth 14) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| ScenarioComposer.tsx | scenario-state.ts | import MAX_MEMBER_KEY_IDS interpolated into copy | ✓ WIRED | Import :126, interpolation :685 |
| scenario-state.ts memberKeyIds field | zod bound | `.max(MAX_MEMBER_KEY_IDS)` | ✓ WIRED | :797-800 |
| f4-memberkeyids-restamp.sql | scenarios.draft JSONB | discriminator + jsonb_set | ✓ WIRED | Discriminator in DETECT (:68) and UPDATE WHERE (:86); jsonb_set restamp |
| fixture | sweep script | verbatim same discriminator + transform | ✓ WIRED | Same WHERE + jsonb_set + WR-01 predicate in both (fixture :262-264) |
| queries.ts | payload consumers | tsc proves no consumer reads dead field | ✓ WIRED | grep → nothing; tsc exit 0 |
| ScenarioComposer timelineRows | payload.apiKeys via dataSourceLabel | apiKeyLabelById memo | ✓ WIRED | :2409-2430 |
| AllocationsTabs.tsx | ScenarioComparePanelProps["payload"] | annotated constructed object, no cast | ✓ WIRED | :949, :981 |
| MobileNav.tsx | Sidebar.tsx formatBadgeCount | shared import | ✓ WIRED | MobileNav.tsx:6/:87 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| saveErrorMessage | `issues` | `readSaveIssues(res)` — defensive res.json() parse of the save route's real 400 body | Yes (save route emits `{issues:[{code:"too_big",path:["draft","memberKeyIds"]}]}`; nested-path match confirmed by review) | ✓ FLOWING |
| apiKeyLabelById | `payload.apiKeys` | SSR dashboard payload | Yes (same source the "Data sources" control renders) | ✓ FLOWING |
| comparePanelPayload | `props.*` (5 fields) | SSR props | Yes (panel reads exactly the supplied slice) | ✓ FLOWING |
| formatBadgeCount | `badge` (flaggedCount) | buildPrimaryMobileNav / Sidebar props | Yes (display-only cap; aria keeps true count) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full regression gate on final branch state | `npx tsc --noEmit` / `npm run lint` / `npm test` | exit 0 / exit 0 / 7448 passed, 288 skipped, 0 failures | ✓ PASS (session-evidenced) |
| Corrected fixture (incl. Assertion 2c) on TEST project | Supabase MCP run post-08d3f8b2 | No exception — all assertions passed | ✓ PASS (session-evidenced) |
| Prod post-conditions (F-4 detect, residue count) | Supabase MCP, prod | 0 downgraded rows; 0 residue rows | ✓ PASS (session-evidenced, do-not-re-run) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in the repo and no plan/summary declares probes. The phase's runnable proof is the SQL fixture (executed on the test project post-WR-01-fix, session-evidenced) plus the full vitest gate. Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CF-01 | 66-01 | F-3 dead disjunct resolved, comment fixed | ✓ SATISFIED | Truths 1-2 |
| CF-02 | 66-01 | F-5 cap raised to real ceiling + honest over-cap copy | ✓ SATISFIED | Truths 3-4 |
| CF-03 | 66-02 | F-4 re-derive/re-stamp sweep for the deploy-skew window | ✓ SATISFIED | Truths 5-7 |
| CF-04 | 66-03 | Dead SSR pipeline removed (holdingsSummary half honestly resolved as already-satisfied in v1.6 P63) | ✓ SATISFIED | Truths 9-10 |
| CF-05 | 66-02, 66-04 | Prod residue deleted; D3 decided; gantt labels; payload-cast type-safety | ✓ SATISFIED | Truths 8, 11-13 |
| CF-06 | 66-05 | TODOS.md triaged to only live debt; quick wins fixed | ✓ SATISFIED | Truth 14 |

No orphaned requirements: REQUIREMENTS.md maps exactly CF-01..CF-06 to Phase 66; all six are claimed by plans and verified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/app/api/allocator/scenario/share/route.test.ts | 392-396 | Stale test-file comment: T_SH15's lead comment still claims "the mint gate reads the SAME null-safe isBookOnlyDraft predicate" — that predicate was deleted this phase (the test itself is repointed correctly and green; production route.ts comment is honest) | ℹ️ Info | Comment rot only; no behavior claim in code; trivially fixable in a later pass |
| src/app/(dashboard)/allocations/components/ScenarioComposer.tsx | 682 | IN-01 (from 66-REVIEW): `path.includes("memberKeyIds")` also matches per-id-length too_big at a nested index — misattributed copy in an unreachable-via-UI edge | ℹ️ Info | Documented open info in REVIEW.md; out of default fix scope; not a goal gap |

No TBD/FIXME/XXX debt markers in any phase-modified file. No stubs, no empty implementations, no hardcoded-empty props.

### Human Verification Required

None. All truths are grep/test-verifiable or carry session-embedded prod evidence; no PLAN deferred `<human-check>` blocks exist; both checkpoint:human-action tasks (prod SQL) were executed with verbatim before/after evidence in 66-02-SUMMARY.

### Gaps Summary

None. All five ROADMAP success criteria and all plan-frontmatter must-haves are observably true in the tree. The CF-04 "holdingsSummary" half of SC4 is closed as an evidenced scope-correction (RISK-1, already satisfied by v1.6 phase 63) rather than a deletion — this matches the locked decision in 66-CONTEXT.md, and the live holdingsSummary surface is byte-untouched. The F-4 closure is the sanctioned 0-row-detection path with the transform nonetheless CI-proven (and hardened post-review by WR-01/08d3f8b2, including the non-finite mirror fixture case).

---

_Verified: 2026-07-04_
_Verifier: Claude (gsd-verifier)_
