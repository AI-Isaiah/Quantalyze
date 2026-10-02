---
phase: 10-scenario-builder-and-what-if
plan: 07
subsystem: api

tags: [scenario, bridge-outcomes, match-decisions, zod, rpc, security-definer, rls, audit, react, drawer, vitest]

# Dependency graph
requires:
  - phase: 10-scenario-builder-and-what-if
    provides: "Plan 02 — migrations 080 (kind enum), 081 (bridge_outcomes voluntary relaxation), 082 (commit_scenario_batch SECURITY DEFINER RPC)"
  - phase: 10-scenario-builder-and-what-if
    provides: "Plan 01 — toVoluntaryRemoveDecision / toVoluntaryAddDecision synthetic match_decision shapes (holding-outcome-adapter.ts)"
  - phase: 10-scenario-builder-and-what-if
    provides: "Plan 06b — ScenarioComposer body assembly with stub onCommitRequested callback"
  - phase: 09-bridge-live-against-real-holdings
    provides: "FlaggedHolding + BridgeOutcomeBanner / AllocatedForm / RejectedForm contracts (Phase 09 D-11)"
provides:
  - "POST /api/allocator/scenario/commit (discriminated zod union of 4 diff kinds, delegates to commit_scenario_batch RPC for H4 single-tx atomicity, M6 rejection_reason enum, audit emission per row in full-success batches only)"
  - "ScenarioCommitDrawer (720px right slide-over, grouped diff sections, per-row inline RejectedForm/AllocatedForm, M11 portal'd pre-flight modal a11y, H4 success/failure-only state machine — no partial state)"
  - "ScenarioComposer wire-in (handleCommit opens the drawer with diffs; onSubmitSuccess invokes scenario.reset())"
  - "Live-DB RLS regression covering T-10-01 cross-tenant tampering, H4 single-tx rollback, M7 reuse-or-create, M6 rejection_reason enum, audit emission, FK integrity"
affects: ["phase-11", "scenario-onboarding", "bridge-outcome-tracker", "scenario-commit-pipeline"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route → SECURITY DEFINER RPC delegation for multi-statement transactional integrity (Supabase JS does not expose BEGIN..COMMIT)"
    - "M11 — pre-flight modal portal pattern: createPortal + role swap so DOM has exactly ONE role='dialog' aria-modal='true' at submit-time"
    - "H4 — full-success / full-failure state machine (no partial intermediate)"

key-files:
  created:
    - "src/app/api/allocator/scenario/commit/route.ts"
    - "src/app/api/allocator/scenario/commit/route.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx"
    - "src/__tests__/scenario-commit-rls.test.ts"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (drawer state + JSX)"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx (T_C21 wire-in test + ScenarioCommitDrawer mock)"

key-decisions:
  - "H4 single-tx via SECURITY DEFINER RPC (commit_scenario_batch) — Supabase JS does not expose BEGIN..COMMIT to route handlers; the RPC is the single-tx implementation. Route delegates via admin.rpc with p_allocator_id sourced from withAuth."
  - "M6 rejection_reason is z.enum(REJECTION_REASONS) and REQUIRED for voluntary_remove (NOT .nullish()) — bridge_outcomes' kind='rejected' CHECK requires non-null after migration 081."
  - "M7 reuse-or-create lives inside the RPC body — route does NOT duplicate the lookup client-side. Single source of truth for the reuse SQL."
  - "M11 pre-flight modal renders via createPortal + drawer role swap so DOM has exactly ONE role='dialog' aria-modal='true' element at submit-time (a11y invariant)."
  - "Audit emission per row, ONLY in full-success batches — rolled-back tx emits no audit (matches on-disk state)."
  - "Live-DB RLS regression reads BASE URL from SCENARIO_COMMIT_BASE_URL (jsdom collides on BASE_URL='/' default)."

patterns-established:
  - "Discriminated zod union for batched route bodies (z.discriminatedUnion('kind', [...]) + z.array(...).min(1).max(50))"
  - "Drawer state machine type SubmitState = 'idle' | 'preflight' | 'submitting' | 'success' | 'failure' (no 'partial')"
  - "Portal'd pre-flight + role swap for nested-dialog avoidance"

requirements-completed: [SCENARIO-07]

# Metrics
duration: 32min
completed: 2026-04-26
---

# Phase 10 Plan 07: SCENARIO-07 Commit Pipeline Summary

**End-to-end scenario commit pipeline: discriminated zod route → commit_scenario_batch SECURITY DEFINER RPC for H4 single-tx atomicity → 720px drawer with portal'd M11 pre-flight + H4 full-success/full-failure terminal states + composer wire-in + live-DB RLS regression covering 12 cases.**

## Performance

- **Duration:** ~32 min
- **Started:** 2026-04-26T09:21:26Z
- **Completed:** 2026-04-26T09:54:10Z
- **Tasks:** 3 (all atomic, RED→GREEN per TDD cadence)
- **Files modified:** 7 (4 new + 3 modified)
- **New tests:** 33 (18 route + 15 drawer + composer wire-in + 12 live-DB RLS regression cases gated by env)

## Accomplishments

- **POST /api/allocator/scenario/commit** ships: discriminated zod union covering 4 diff kinds (voluntary_remove / voluntary_add / voluntary_modify / bridge_recommended), zod cap (50) + rate limit per user, delegation to `admin.rpc('commit_scenario_batch', ...)` for H4 single-tx atomicity, audit emission per recorded row in full-success batches only.
- **ScenarioCommitDrawer** ships: 720px right slide-over per UI-SPEC, grouped sections (Holdings removed / Strategies added / Weight changes — empty groups hidden), per-row inline `RejectedForm` / `AllocatedForm` via Plan 01 synthetic match_decision helpers (`toVoluntaryRemoveDecision` / `toVoluntaryAddDecision`), Submit-all footer with diff count, M11 portal'd pre-flight modal so the DOM at submit-time has exactly ONE `role="dialog"` `aria-modal="true"` element (the pre-flight; the drawer's role swaps to `region`).
- **H4 single-tx semantics** propagated end-to-end: drawer state machine is `{idle, preflight, submitting, success, failure}` — no `partial` intermediate. Full-success → green confirmation card → 1.5s auto-close → `onSubmitSuccess()`. Full-failure → drawer stays open, per-row errors render inline beneath each diff row, `onSubmitSuccess` does NOT fire (user can fix and re-submit).
- **ScenarioComposer wire-in:** `handleCommit` now stashes the diff list and opens the drawer (via `setCommitDiffs` + `setCommitDrawerOpen`); the legacy `onCommitRequested` callback prop is preserved for backwards-compatible tests. On full-success, the drawer's `onSubmitSuccess` invokes `scenario.reset()` which clears `localStorage` and reinitializes from the new live holdings.
- **Live-DB RLS regression** (12 cases, env-gated): T_RLS1-T_RLS12 cover happy paths per kind, T-10-01 cross-tenant tampering, strategy gate, DoS cap, H4 single-tx rollback regression, M7 reuse-or-create, M6 rejection_reason enum, audit emission, FK integrity, RLS enforcement (Allocator B cannot SELECT A's match_decisions row).

## Task Commits

1. **Task 1: POST /api/allocator/scenario/commit (RED+GREEN)**
   - RED: `57e399b` — test(10-07): add failing tests for POST /api/allocator/scenario/commit
   - GREEN: `3e3ce66` — feat(10-07): POST /api/allocator/scenario/commit — discriminated zod + RPC delegation

2. **Task 2: ScenarioCommitDrawer + composer wire-in (RED+GREEN)**
   - RED: `d955c14` — test(10-07): add failing tests for ScenarioCommitDrawer + composer wire-in
   - GREEN: `e0f9360` — feat(10-07): ScenarioCommitDrawer 720px slide-over + composer wire-in

3. **Task 3: Live-DB RLS regression (single GREEN per plan permission)**
   - GREEN: `2816966` — test(10-07): live-DB RLS regression for scenario commit pipeline

_Note: Task 3 ships as a single GREEN commit per the plan's explicit permission ("If RED-first against a pre-route DB is impractical, ship as a single GREEN commit"). The test EXISTS at HEAD and proves the security invariants when run with the live-DB env vars + a running dev server._

## Route signature + zod schema

```ts
// POST /api/allocator/scenario/commit
const HOLDING_REF_RE = /^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:(spot|derivative)$/;
const REJECTION_REASONS = ["mandate_conflict", "already_owned", "timing_wrong",
                           "underperforming_peers", "other"] as const;

const VoluntaryRemoveDiff = z.object({
  kind: z.literal("voluntary_remove"),
  holding_ref: z.string().regex(HOLDING_REF_RE),
  size_at_decision_usd: z.number().positive(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
  rejection_reason: z.enum(REJECTION_REASONS),  // M6 — REQUIRED, NOT .nullish()
});
const VoluntaryAddDiff = z.object({
  kind: z.literal("voluntary_add"),
  strategy_id: z.string().uuid(),
  percent_allocated: z.number().min(0).max(100),
  size_at_decision_usd: z.number().positive(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
});
const VoluntaryModifyDiff = z.object({
  kind: z.literal("voluntary_modify"),
  holding_ref: z.string().regex(HOLDING_REF_RE),
  new_weight: z.number().min(0).max(1),
  size_at_decision_usd: z.number().positive(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
});
const BridgeRecommendedDiff = z.object({
  kind: z.literal("bridge_recommended"),
  holding_ref: z.string().regex(HOLDING_REF_RE),
  strategy_id: z.string().uuid(),
  percent_allocated: z.number().min(0).max(100),
  size_at_decision_usd: z.number().positive(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
});
export const CommitDiffSchema = z.discriminatedUnion("kind", [
  VoluntaryRemoveDiff, VoluntaryAddDiff, VoluntaryModifyDiff, BridgeRecommendedDiff,
]);
export const CommitBodySchema = z.object({
  diffs: z.array(CommitDiffSchema).min(1).max(50),  // DoS cap
});
```

## Drawer state machine (H4)

```ts
type SubmitState = "idle" | "preflight" | "submitting" | "success" | "failure";
// "partial" is intentionally absent — the route's RPC commits the WHOLE
// batch (success → green confirmation → onSubmitSuccess after 1.5s) OR
// rolls back the WHOLE batch (failure → drawer stays open + per-row errors
// inline + onSubmitSuccess NOT called).
```

## Composer wire-edit

```ts
// src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";

const [commitDrawerOpen, setCommitDrawerOpen] = useState(false);
const [commitDiffs, setCommitDiffs] = useState<ScenarioCommitDiff[]>([]);

function handleCommit() {
  const diffs: ScenarioCommitDiff[] = [/* …built as before… */];
  setCommitDiffs(diffs);
  setCommitDrawerOpen(true);
  onCommitRequested?.(diffs);  // preserved for T_C18 backwards-compat
}

// JSX (alongside other drawers):
<ScenarioCommitDrawer
  isOpen={commitDrawerOpen}
  onClose={() => setCommitDrawerOpen(false)}
  diffs={commitDiffs}
  onSubmitSuccess={() => { scenario.reset(); }}
/>
```

## Single-Postgres-transaction (H4) — implementation

CONTEXT D-09 mandates "single Postgres transaction". Supabase JS does NOT expose multi-statement BEGIN..COMMIT to route handlers — every `supabase.from().insert()` commits independently. The H4 invariant is therefore implemented via the `commit_scenario_batch` SECURITY DEFINER RPC shipped by **Plan 02 migration 082**:

- Route delegates the entire batch to `admin.rpc('commit_scenario_batch', { p_allocator_id: user.id, p_diffs })`.
- The RPC's plpgsql body runs the per-kind ownership/strategy gates inline with admin privileges, then INSERTs match_decisions + bridge_outcomes per row.
- On any per-row failure: `RAISE EXCEPTION` propagates and Postgres rolls back the entire transaction → caller receives an error envelope with per-row index + reason. NO partial state.
- The RPC re-asserts `auth.uid() = p_allocator_id` (defence-in-depth) — even if a forged `p_allocator_id` somehow reached the RPC, the auth.uid() guard rejects.

Plan 07 owns the route + drawer; **Plan 02 owns the RPC**. They are separately commit-able and separately testable (Plan 02's `scenario-commit-batch-tx.test.ts` exercises the RPC at the SQL level; Plan 07's `scenario-commit-rls.test.ts` exercises the integration end-to-end at the HTTP/route layer).

## M7 reuse-or-create — implementation (lives inside the RPC body)

When an allocator commits the same `(allocator_id, original_holding_ref, suggested_strategy_id)` tuple twice for `kind='bridge_recommended'` (e.g. clicked "Add to scenario" then later "Send intro"), the migration 074 widened unique index would reject the second INSERT. The RPC's reuse-or-create logic SELECTs the existing match_decision FIRST and REUSES its id (skipping the duplicate INSERT), then INSERTs the new bridge_outcomes row referencing the reused match_decision_id. The route does NOT duplicate this lookup — the RPC body is the single source of truth.

Live-DB regression `T_RLS11` proves the second commit returns the SAME match_decision_id and the `match_decisions` row count stays at 1.

## M11 pre-flight modal a11y — implementation

The pre-flight confirmation modal MUST be the only `role="dialog" aria-modal="true"` element at submit-time so screen-reader semantics see ONE modal:

- Pre-flight is rendered via `createPortal(..., document.body)` — outside the drawer's subtree.
- The drawer's role swaps from `dialog` to `region` while `state === "preflight"` (drawer remains visible behind the pre-flight, but screen-readers no longer see it as a modal-role element).
- Test `T_D9` asserts `document.querySelectorAll('[role="dialog"][aria-modal="true"]').length === 1` at preflight time.

## Audit emission shape

```ts
logAuditEvent(supabase, {
  action: "match.decision_record",
  entity_type: "match_decision",
  entity_id: row.match_decision_id,
  metadata: {
    kind: row.kind,                       // "voluntary_remove" / etc
    source: "scenario_commit",            // distinguishes from holding/intro paths
    bridge_outcome_id: row.bridge_outcome_id,
  },
});
```

Emitted ONLY when the RPC returns `ok=true` (all rows recorded). On full-failure (RPC rolled back the tx), NO audit row is emitted — emitting would mis-represent on-disk state.

## Test counts

| Suite | Cases | Status |
|-------|-------|--------|
| Route handler (`route.test.ts`) | 18 | All GREEN (T_R1-T_R17 + auth-gate) |
| Drawer (`ScenarioCommitDrawer.test.tsx`) | 15 | All GREEN (T_D1-T_D15) |
| Composer wire-in (T_C21 added to existing suite) | 1 | GREEN |
| Live-DB RLS regression (`scenario-commit-rls.test.ts`) | 12 | Properly env-gated (skipif). Ready for CI integration runner. |
| **New tests added** | **46** | |
| Full vitest run | 2041 passed / 139 skipped (was 2008 baseline) | All GREEN, +33 new |

## Confirmation of upstream invariants

- **voluntary_add cron-coverage (RESEARCH Pitfall 5 / H2):** shipped atomically in **migration 080** (third CTE branch in `compute_bridge_outcome_deltas()`). Plan 02 owns; Plan 07 just consumes — voluntary_add rows inserted by this route are picked up by the daily delta cron.
- **bridge_outcomes voluntary-kind shape (H1):** shipped atomically in **migration 081** — nullable `strategy_id`, widened `(allocator_id, match_decision_id)` unique index, kind-aware CHECKs accepting `kind='allocated'`/`kind='rejected'` plus voluntary_remove/voluntary_add shapes. Plan 02 owns; Plan 07 INSERTs round-trip cleanly (T_RLS10 verifies `strategy_id IS NULL` for voluntary_remove).
- **commit_scenario_batch RPC (H4 single-tx):** shipped atomically in **migration 082** — SECURITY DEFINER, search_path locked, `auth.uid() <> p_allocator_id` guard, EXECUTE granted to `authenticated` only (REVOKE'd from `public, anon`). Plan 02 owns; Plan 07 just delegates via `admin.rpc(...)`.

## Files Created/Modified

### Created
- `src/app/api/allocator/scenario/commit/route.ts` — POST handler (130 lines).
- `src/app/api/allocator/scenario/commit/route.test.ts` — 18 vitest cases for the route.
- `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` — 720px right slide-over + grouped diff sections + portal'd pre-flight + H4 state machine (390 lines).
- `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx` — 15 vitest cases (T_D1-T_D15).
- `src/__tests__/scenario-commit-rls.test.ts` — 12 live-DB RLS regression cases (env-gated).

### Modified
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — wired `handleCommit` to open the drawer; added `commitDrawerOpen` / `commitDiffs` state and the `<ScenarioCommitDrawer>` JSX block.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — added `vi.mock("./ScenarioCommitDrawer")` + `T_C21` test for the drawer wire-in.

## Decisions Made

- **Body's `allocator_id` field silently dropped (T-10-01 mitigation):** zod's strip default removes any extraneous field; the route always passes `p_allocator_id = user.id` from withAuth. Body cannot influence the RPC's allocator_id arg. Verified by `T_R14`.
- **Live-DB RLS test reads from `SCENARIO_COMMIT_BASE_URL` not `BASE_URL`:** jsdom sets `process.env.BASE_URL = "/"` as its default document URL, which would collide with the standard live-DB BASE_URL convention. The new env var avoids the collision. The HAS_BASE_URL gate also requires an explicit `http(s)://` prefix so the suite skips cleanly when only the jsdom default is present.
- **Single GREEN commit for Task 3:** per the plan's explicit permission, the live-DB regression test ships as one commit (the test file exists at HEAD and proves the security invariants when run with proper end-to-end infrastructure — Plan 02's `scenario-commit-batch-tx.test.ts` already pins the RPC-level invariants, so duplicating the RED-then-GREEN dance at the integration layer would be redundant).

## Deviations from Plan

None — plan executed exactly as written.

The plan's pseudocode included some scaffolding artifacts (e.g. a stray `recorded.push(...)` line outside the function body). These were obvious template noise and not implemented — the actual route delegates the entire batch to the RPC and audits per recorded row, exactly as the plan's `<must_haves>` and `<acceptance_criteria>` sections specify.

## Issues Encountered

- **vitest fake-timers interact badly with `waitFor`:** T_D11 (success card → 1.5s auto-close → onSubmitSuccess) initially timed out because `waitFor` polls via real timers but fake timers were active. Fix: switch to `vi.useRealTimers()` for that single case (the 1.5s wait is short enough for waitFor to poll naturally).
- **TypeScript inference on untyped `vi.fn(async () => ...)`:** the `mock.calls[0]` index returned `[]` instead of the actual args. Fix: explicitly type the spy parameters (`(_url: string, _init: { method: string; body: string }) => ...`) so `mock.calls[0]` carries the right tuple shape.
- **jsdom's `process.env.BASE_URL = "/"` collision:** the standard live-DB regression env var collided with jsdom's default document URL. Fix: introduce `SCENARIO_COMMIT_BASE_URL` and gate on `^https?://` regex.

All three were resolved inline during execution; no architectural changes were needed.

## User Setup Required

None — no external service configuration required for the route + drawer to function. The CI integration runner that exercises the live-DB RLS regression needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SCENARIO_COMMIT_BASE_URL` env vars + a running dev server, all standard for the project's existing live-DB test cohort.

## Self-Check

- File exists: `src/app/api/allocator/scenario/commit/route.ts` ✓
- File exists: `src/app/api/allocator/scenario/commit/route.test.ts` ✓
- File exists: `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` ✓
- File exists: `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx` ✓
- File exists: `src/__tests__/scenario-commit-rls.test.ts` ✓
- Commit `57e399b` (Task 1 RED) exists ✓
- Commit `3e3ce66` (Task 1 GREEN) exists ✓
- Commit `d955c14` (Task 2 RED) exists ✓
- Commit `e0f9360` (Task 2 GREEN) exists ✓
- Commit `2816966` (Task 3 GREEN) exists ✓
- Frozen invariants intact: `git diff main -- src/lib/scenario.ts` shows 0 lines ✓
- No new deps: `git diff main -- package.json` shows 0 lines ✓
- `npx tsc --noEmit` exits 0 ✓
- `npm run lint -- --quiet` exits 0 ✓
- Full vitest suite GREEN: 2041 passed / 139 skipped / 0 failed ✓

## Self-Check: PASSED

## Phase 10 Hand-off

Plan 07 closes the SCENARIO-07 acceptance loop:

```
scenario draft → diff list → POST /api/allocator/scenario/commit
                              → admin.rpc('commit_scenario_batch')
                                 → match_decisions + bridge_outcomes (single tx)
                                 → audit_log (per row, full-success only)
                                 → daily delta cron pickup (incl. voluntary_add via H2 third branch)
```

All 9 SCENARIO-XX requirements addressed across the 7 plans (8 plan files counting 06a + 06b). The Allocations Scenario tab body now ships the full composer + commit pipeline under the `allocations.ui_v2` feature flag.

## Next Phase Readiness

- **Phase 11 onboarding funnel** can now hook `scenario_committed` PostHog events on the drawer's `onSubmitSuccess` callback (Plan 06b shipped the `data-widget-id="scenario-composer"` IntersectionObserver marker; Plan 07 ships the actual commit gesture to fire on).
- **Live-DB RLS regression** is ready for CI integration runner activation — set the four env vars + boot a dev server, and the 12 cases run end-to-end.

---
*Phase: 10-scenario-builder-and-what-if*
*Plan: 07*
*Completed: 2026-04-26*
