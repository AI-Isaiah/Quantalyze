# Phase 63: Holdings-Snapshot Fallback Engine Removal - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

The scenario surfaces build their engine set purely in series space: the
holdings-snapshot fallback engine (`buildStrategyForBuilderSet`) and its alias
machinery are DELETED, the legacy holdings path leaves `scenario-compare.ts`, and
gate=false books fall back to blank mode honestly (D1). Phase 62's persisted
`memberKeyIds` is the source-of-truth selector this deletion stands on — it is
already live on branch `v1.6-membership-schema-v4`.

In scope: ENGINE-01..05, GUARD-01 (prod residue cleanup), GUARD-02 (P61 net),
GUARD-03 (frozen engine — highest risk this phase).
Out of scope: AUM/caption presentation (Phase 64), canary (Phase 65), removing
`holdingsSummary` from the SSR payload (Holdings tab + commit sizing still consume
it), any blend-math change in `src/lib/scenario.ts` / `scenario-window.ts`.

</domain>

<decisions>
## Implementation Decisions

### Removal & Retirement Mechanics (ENGINE-01/02/04/05)
- Staged deletion, each an atomic revertable commit: composer call sites
  (ENGINE-01) → compare legacy path (ENGINE-02) → adapter builder deletion →
  dealias retirement LAST (ENGINE-04). Never one big deletion commit.
- ENGINE-04 verification BEFORE deleting `scenario-dealias.ts`: (a) avg-|ρ|
  honesty tests green, (b) an explicit no-alias assertion (per-key ids are
  api-key UUIDs, added ids are strategy UUIDs — disjoint by construction),
  (c) grep proves 0 remaining production importers. The deletion lands as a
  reviewed re-baseline commit whose message carries the rationale.
- ENGINE-05 guard: a vitest guard test (same class as the frozen-spine guards)
  asserting no scenario-surface source constructs `holding:` scopeRefs as engine
  unit ids; fails loud on reintroduction. Written after the removals, in-phase.
- `holdingsSummary` STAYS in queries.ts (scenario CONSUMERS only are removed).

### Blank-Mode Fallback (ENGINE-03, D1 locked)
- gate=false ⇒ composer initializes to BLANK mode (added-only); the existing calm
  DSRC-02 note ("per-source modeling needs per-key history") explains why; book
  entry is unavailable-with-note — never a broken or empty book UI.
- Exact toggle/affordance treatment at Claude's discretion within DESIGN.md.
- Read-only-empty book mode was explicitly rejected at kickoff.

### Prod Cleanup (GUARD-01)
- Delete ONLY the holdings rows of the two `phase10-rpc-*@test.local` residue
  users on prod (khslejtfbuezsmvmtsdn) via Supabase MCP; keep the auth.users rows
  (conservative — they may pin other FK residue).
- Verify afterward: 0 gate=false holders remain (re-run the empirical grounding
  query from .planning/v1.6-SERIES-SPACE-INPUT.md).
- Timing inside the phase is free (the fallback serves nobody real). This is a
  prod destructive op executed autonomously per standing user policy.

### Regression Net (GUARD-02) & Watch Items
- P61 suites (composer P61 block, compare per-key block, T_CP8, share T_SH13/14)
  survive VERBATIM; any repoint is its own individually reviewed commit with
  rationale — never blind-updated.
- `buildLiveBookDraft` + live-baseline (Phase-36 D3 basis) stay on the per-key
  basis (already gate-threaded by Phase 62 WR-02); the Atlas golden + P61 verify
  numbers pin them.
- GUARD-03: `src/lib/scenario.ts` + `scenario-window.ts` zero-diff — assert with
  `git diff origin/main..HEAD` on the branch at every wave gate.

### Claude's Discretion
- Exact blank-fallback affordance styling (within DESIGN.md + existing note).
- Guard-test file naming/placement (follow the existing guard-test class).
- Order of GUARD-01 within the phase.

</decisions>

<code_context>
## Existing Code Insights

### What Phase 62 already landed (this phase builds on it, same branch)
- `memberKeyIds` persisted at v4; codec double-upgrade branches; helpers
  `deriveMembershipFromGate` / `isBookOnlyDraft` / `setMemberKeyIds` exported from
  scenario-state.ts.
- Compare: `computeMetricsForDraft` selects the per-key channel from persisted
  membership; the holdings else-branch ALREADY runs only for `opts.liveBook`
  (Phase-62 WR-01 fix) — so ENGINE-02's remaining work is deleting the legacy
  holdings machinery (buildStrategyForBuilderSet import/usage, symbolByHoldingId,
  collapse call), not re-gating it.
- `buildLiveBookDraft(perKeyDailiesGateSatisfied, eligibleApiKeyIds)` stamps
  derived membership (WR-02).
- Composer stamps membership at save (entryMode-aware) and derives+stamps on
  reopen of underived drafts; ineligible-member disclosure note exists.

### Deletion targets (verify exact call sites during research)
- `buildStrategyForBuilderSet` in scenario-adapter.ts + composer/compare call sites.
- `collapseAliasedHoldingStrategies` / `src/lib/scenario-dealias.ts` (+ its test
  file `src/lib/scenario-dealias.test.ts` — was touched in Phase 62, check why).
- `symbolByHoldingId` maps, `buildHoldingRef`-as-engine-id on scenario surfaces.

### Established Patterns
- Reviewed re-baseline acts for guard/spine changes (v1.5 precedent).
- Frozen-spine guard tests as the class for the new ENGINE-05 grep-guard.
- Atomic per-step commits with rationale in messages.

### Integration Points
- ScenarioComposer engine-set selection (entryMode/book path), scenario-compare,
  scenario-adapter, share-resolve (already series-space).
- Supabase MCP (prod project khslejtfbuezsmvmtsdn) for GUARD-01.

</code_context>

<specifics>
## Specific Ideas

- Empirical grounding (prod, verified 2026-07-03): 0 real gate=false users; only
  the 2 `phase10-rpc-*@test.local` residue holders. The deletion serves honesty
  and code health, not a behavior change for real users.
- GUARD-03 is milestone-wide but assigned here because deletion pressure makes
  accidental engine edits most likely in this phase.

</specifics>

<deferred>
## Deferred Ideas

- Friendly labels for from-book gantt rows (raw "key <uuid>" — P61 B1 polish).
- Removing `holdingsSummary` from the SSR payload (needs Holdings-tab rework).

</deferred>
