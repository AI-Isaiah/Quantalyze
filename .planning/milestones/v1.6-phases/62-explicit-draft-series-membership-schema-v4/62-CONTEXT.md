# Phase 62: Explicit Draft Series Membership (schema v4) - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Saved scenario drafts become self-describing about which series they blend: membership
is a persisted per-key id list (D2, locked at kickoff), not inferred from the runtime
gate (`perKeyDailiesGateSatisfied`) or the ephemeral `entryMode`. This phase is PURE
ADDITIVE — schema v3→v4 + codec branch + the three consumers (composer reopen, compare,
share mint/resolve) reading the new field. No deletion happens here; Phase 63's
fallback-engine removal stands on this persisted selector.

In scope: MEMBER-01 (field + v4 codec), MEMBER-02 (compare reads membership, closes
red-team F5), MEMBER-03 (one "book-only" definition across mint/resolve/compare),
MEMBER-04 (ineligible-member drop disclosed on reopen).

Out of scope: any engine deletion (Phase 63), AUM/caption presentation (Phase 64),
prod canary (Phase 65), persisting data-source toggles (D3 — stays ephemeral),
any change to frozen `src/lib/scenario.ts` / `scenario-window.ts` (GUARD-03).

</domain>

<decisions>
## Implementation Decisions

### Membership Field Shape & Codec (MEMBER-01)
- Persisted field: `memberKeyIds: string[]` REQUIRED at v4 (empty array = blank-authored
  draft); zod-bounded `.max(64)` following the bounded-array convention
  (`addedStrategies` `.max(200)`). NOT optional — the field is load-bearing for compare,
  so absence must be impossible in a v4 draft (an absent field would resurrect
  gate-inference).
- Codec: `SCENARIO_SCHEMA_VERSION` 3→4, `SCENARIO_SCHEMA_VERSION_PREV` 2→3. A v3 draft
  decodes `outcome:"ok"` with `reason:"upgraded_v3_membership"`, membership left
  UNDERIVED for consumer derivation — the exact `upgraded_v2_windowless` pattern
  (scenario-state.ts:741 branch). Codec stays pure: it has NO access to liveInputs,
  so it never derives membership itself.
- v2 drafts (two versions back): keep a v2 chain-upgrade branch — v2 decodes ok with
  BOTH window-absent AND membership-underived (distinct reason), preserving the v1.5
  no-drop guarantee. v2 must never fall to reset.
- Derivation rule lives in ONE shared exported helper (`deriveMembershipFromGate`-style):
  gate=true ⇒ all currently-eligible per-key ids; gate=false ⇒ empty. Consumed by
  composer-open, compare, and share-resolve — never re-implemented inline.
- Forward-compat unchanged: rawVersion > current (now 5+) → readonly branch as today.

### Compare Semantics (MEMBER-02)
- For saved drafts, persisted `memberKeyIds` REPLACES `perKeyDailiesGateSatisfied` as
  the engine-set selector — an empty membership computes added-only even when the live
  gate is true (closes F5 by construction; `entryMode` stops being load-bearing).
- Live-book column: `buildLiveBookDraft()` stamps explicit membership at build time via
  the shared helper (all eligible per-key ids). The Phase-55 windowless own-book union
  lock stays byte-untouched (no `window` on the synthetic draft).
- Upgraded (v2/v3) drafts in compare derive membership via the same shared helper at the
  compare boundary — old drafts compute IDENTICALLY post-upgrade. Golden: the P61 verify
  numbers (Cum +0.06% / Sharpe 0.11 @ the 40-day window, Atlas book book-only draft).
- A persisted member id no longer eligible at compare time: drop that member, compute
  the remainder with honest `member_count` (existing mechanics). Provenance-note
  disclosure stays scoped to composer reopen (MEMBER-04) — no compare caption this phase.

### Share Mint/Resolve & "book-only" (MEMBER-03)
- ONE exported predicate in scenario-state.ts (`isBookOnlyDraft`-style): membership
  contains ≥1 per-key id AND `addedStrategies` is empty. Consumed by the mint gate,
  share-resolve, and compare — no surface re-derives it.
- Minted share payload mechanics unchanged: the draft persists WHOLE (no RPC/SQL
  change), so `memberKeyIds` rides along automatically; share-resolve reads it verbatim
  the way it reads `window`.
- Shared drafts minted before v4 (v2/v3): share-resolve derives membership via the SAME
  shared helper using the owner-scoped inputs it already loads to compute the scenario —
  old shares resolve identically (no honest-absence regression).
- Mixed keys+added share behavior unchanged this phase — the honest caption is Phase 64
  (PRESENT-03) and will read this membership field.

### Ineligible-Member Disclosure on Reopen (MEMBER-04)
- Reuse the v1.5 ProvenanceNote pattern: DefaultChangeNote shell, EPHEMERAL
  component-local dismissal, keyed on `loadedScenarioId` so it re-shows per affected
  draft. No new machinery, no blocking modal.
- After the drop the composer RECOMPUTES over the remaining members with the note
  visible — the recompute is fine as long as it is DISCLOSED (MEMBER-04 forbids the
  silence, not the recompute). Engine memo recomputes today's numbers as normal.
- Note copy locked at plan time following DESIGN.md + the existing calm note register
  ("A data source saved with this scenario is no longer available — showing the
  remaining sources" register); exact wording at Claude's discretion within that tone.
- Dismissal is ephemeral (component-local useState), re-shows on every reopen of an
  affected draft; grep-asserted no cross-tab storage key (v1.5 provenance contract).

### Claude's Discretion
- Exact note copy (within the locked register above).
- Exact helper/predicate names and file placement (scenario-state.ts vs a sibling lib
  module) — follow existing convention.
- Test naming/organization, following the phase-59 RED-first pattern.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scenario-state.ts` (838 lines) — schema constants (`SCENARIO_SCHEMA_VERSION=3` at
  :66, `_PREV=2` at :73), `scenarioDraftSchema` zod (:623-651), codec decode with the
  readonly branch (:697), current-version branch (:709), and the non-destructive PREV
  branch with `upgraded_v2_windowless` (:741-751) — the exact pattern v4 extends.
- `ProvenanceNote.tsx` — the v1.5 ephemeral disclosure component (DefaultChangeNote
  shell, keyed on loadedScenarioId) to reuse/extend for MEMBER-04.
- `scenario-compare.ts` — `computeMetricsForDraft` (gate selector at :157
  `usePerKeySources = liveInputs.perKeyDailiesGateSatisfied === true`) and
  `buildLiveBookDraft` (:297, hardcoded `schema_version: 2` — will need the v4 stamp +
  explicit membership).
- `share-resolve.ts` — threads `draft.window` verbatim; membership follows the same
  verbatim-thread pattern.

### Established Patterns
- Non-destructive codec upgrades: version-keyed branch BEFORE the final reset, decodes
  ok + reason string, consumer reacts to reason (composer re-seed / helper derivation).
- Version-relative test fixtures (Pitfall 2 from v1.5): bumping the version breaks
  fixtures pinned to `SCENARIO_SCHEMA_VERSION - 1` and version-ahead pins — expect to
  rebase share-resolve.test.ts version-ahead pin and T_SAVE6-class fixtures again,
  preserving test intent.
- RED-first test discipline: prove the new codec branch fails against the old constant
  before implementing.
- Bounded zod arrays; additive-optional fields only when truly optional (window);
  REQUIRED fields ride a version bump (this phase).

### Integration Points
- Composer reopen: `ScenarioComposer.openSavedScenario` (seeds window on ok+readonly
  branches; membership derivation + MEMBER-04 eligibility check hook in here).
- Save path: composer save handlers' POST/PUT payload persists the draft whole —
  `memberKeyIds` must be stamped by the draft writers (default-init at :227, add/remove
  strategy helpers).
- Compare: `computeMetricsForDraft` + `buildLiveBookDraft` in scenario-compare.ts.
- Share: mint gate in ScenarioComposer, resolve in scenario-share/[token]/share-resolve.ts.
- P61 regression suites (composer P61 block, compare per-key block, T_CP8, share
  T_SH13/14) must stay green — they pin the per-key + added path this phase builds on
  (GUARD-02 is Phase 63's, but breaking them here would be a regression).
- Frozen: `src/lib/scenario.ts`, `src/lib/scenario-window.ts` — zero-diff (GUARD-03,
  milestone-wide).

</code_context>

<specifics>
## Specific Ideas

- Follow the v1.5 Phase-59 execution shape: RED codec tests first, then the field +
  bump, then consumers, then the leak-scan/RLS additive assertions if the persisted
  shape reaches `test_scenario_shares_rls.sql` round-trips.
- Prod grounding: 0 real gate=false users (only 2 `phase10-rpc-*@test.local` residue
  holders) — so the v3→v4 derivation rule (gate=true ⇒ eligible per-key ids) upgrades
  every real saved draft to a book-membered draft, which is exactly what compare infers
  today. Zero behavior change for real users is the expected outcome.

</specifics>

<deferred>
## Deferred Ideas

- Persisting data-source include/exclude toggles with the draft (D3 — deliberately
  ephemeral this milestone; MEMBER-01 makes it trivial later).
- Compare per-column caption for dropped ineligible members (kept to honest
  member_count this phase; reopen disclosure covers the requirement).
- Mixed-share honest caption — Phase 64 PRESENT-03.

</deferred>
