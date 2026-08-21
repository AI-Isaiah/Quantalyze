# Phase 150: OWN-03 — The wizard asks whose capital this is - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

<domain>
## Phase Boundary

When an allocator adds a key, the product asks the question it never asked — own capital, or a
trading team's key being verified — stores the answer as a PERSISTENT OWNERSHIP MARK, and lets
ONLY marked own-capital strategies be added to the allocation from the HOLDINGS tab. Plus the
same-pass founder mandates: the strategy-profile step is culled to essentials, and an allocator
can rename their own private/draft strategies (OWN-05). Requirements: OWN-03, OWN-05.

Out of scope: publication flow; wizard error-handling/validation UX (Phase 153); AUM/book
mechanics beyond the position write (Phase 151); any change to how public/anon viewers see
anything.

</domain>

<decisions>
## Implementation Decisions

### The capital question + mark (founder model 2026-08-05, verbatim in REQUIREMENTS OWN-03)
- **D-01:** Question fires at allocator key-add, as the FIRST question of the categorization
  step (MetadataStep). Two-way, crisp copy: (a) "a key with my own capital in it" vs
  (b) "a trading team's key I am verifying". **(b) is the DEFAULT.**
- **D-02:** The answer is stored as a persistent ownership mark. The wizard writes NO position
  and asks NO amount (mark in wizard, allocate in Holdings — supersedes the 2026-08-04
  finalize-form reading).
- **D-03:** ⛔ HARD INVARIANT: a team-review-marked strategy can NEVER become a position — no
  code path creates an allocation from it. Assert structurally (phase-gate style, like the
  visibility gates).
- **D-04 (mark storage, Claude analysis — planner to confirm against schema):** the mark is
  STRATEGY-level (allocation is strategy-level; a multi-key strategy like Alpha Centauri has
  ONE mark; adding a key to an existing strategy inherits the strategy's mark). Question is
  asked at key-add; answer lands on the derived strategy.

### Cull list (founder decision 2026-08-06)
- **D-05:** Keep THREE fields visible: codename, description, category. Category survives
  because it drives percentile population and crypto-vs-trad annualization.
- **D-06:** Everything else — strategy types, subtypes, markets, supported exchanges, leverage
  range, AUM, max capacity — moves behind a collapsed optional "More details" disclosure.
  NOT deleted: collapsed fields keep downstream factsheet panels possible without fabricating;
  absent answers keep hiding panels per no-invented-data.
- **D-07:** Cull applies to the step for ALL users (one form); the capital question renders for
  allocator-role users.
- **D-08:** ⚠️ Check every culled field's downstream consumers (factsheet panels, browse filter
  pills, mandate-fit chips, StrategyTable AUM column) — hiding, never fabricating.

### Retro mark affordance (founder decision 2026-08-06)
- **D-09:** The mark is SET from a /my-strategies row action ("Mark as own capital" / "Mark as
  team review"); the row shows the current mark as a small tag. The owner factsheet shows the
  mark READ-ONLY. Primary surface = the Phase-149 My Strategies ranking.
- **D-10:** NO wizard "allocate now" shortcut — strictly mark in wizard, allocate in Holdings.
- **D-11:** Retro path: existing own strategies (Black Swan, Alpha Centauri, Arctic Fox — all
  currently unmarked) become markable via D-09, then allocatable from Holdings.

### Holdings add interaction (founder decision 2026-08-06)
- **D-12:** The Holdings STRATEGIES panel lists own-capital-marked strategies with an
  "Allocate…" action asking a USD AMOUNT (matches existing `portfolio_strategies.allocated_amount`
  + `current_weight` machinery; weight derives from book equity). Approved mock:
  unallocated own-capital rows show "— not allocated" + [Allocate…]; allocated rows show
  amount · weight + [Edit allocation…].
- **D-13:** Duplicate-add is impossible by construction: selecting an already-allocated
  strategy opens EDIT of the existing position — never a second row, never a double-count
  (satisfies ROADMAP SC4).
- **D-14:** Reuse the existing `portfolio_strategies` write path/RLS — no new table. The
  money-path review scopes to THIS write.
- **D-15:** The Holdings empty state stops being a dead end: when marked-own strategies exist
  but none are allocated, the panel names them (honest state) instead of "No strategies
  onboarded yet."

### Rename — OWN-05 (founder decision 2026-08-06)
- **D-16:** Rename affordance on BOTH the /my-strategies row and the owner factsheet header.
- **D-17:** Allowed while status is private/draft ONLY (published rename deferred — trust
  surface).
- **D-18:** Rename writes `strategies.name`. The public codename/disclosure-tier redaction
  contract (C-0112) is byte-untouched — public surfaces render codename per disclosure rules
  regardless; the proper name is the owner's label.

### Amendments — 2026-08-06 (orchestrator decisions at plan-check; binding, do not re-litigate)
- **D-03-A (trigger predicate — third-party allocation paths preserved):** the D-03 trigger RAISEs
  when `capital_ownership = 'team_review'` (UNCONDITIONAL — SC 2b literally) OR when the strategy's
  `user_id` equals the inserting portfolio's owner `user_id` AND `capital_ownership IS DISTINCT FROM
  'own_capital'`. Third-party inserts (strategy owner ≠ portfolio owner: discovery
  `AddToPortfolio.tsx:54`, manager `MigrationWizard.tsx:72`, `scripts/seed-full-app-demo.ts:1697,1929`)
  PASS — those strategies are unmarkable by the allocator (owner-authz). A self-owned never-asked
  (NULL) strategy stays non-allocatable (SC 3). pgTAP carries a third-party-insert regression case
  (the INSERT-side twin of the alias-UPDATE regression).
- **D-12-A (Holdings STRATEGIES panel population — union-shaped):** the panel lists
  (marked own-capital strategies) ∪ (strategies with existing positions). Positions-but-unmarked rows
  KEEP rendering — no allocated money ever leaves the money surface — but expose no `Allocate…`/`Edit
  allocation…` affordance (and no Mark affordance where third-party-owned). A read-only PROD
  `portfolio_strategies` census (Plan 05 verification) replaces the unsupported "PROD has no real user
  positions" claim, which is deleted everywhere.
- **D-12-B (Weight cell — render-derived):** the Weight cell renders `allocated_amount /
  Σ allocated_amount` across the panel's allocated own-capital row set, formatted with the UI-SPEC's
  unsigned `formatPercent(w, 2, { signed: false })`, with the denominator named honestly (column-header
  tooltip "share of allocated capital"). `current_weight` remains UNWRITTEN — that pin stays. Rows with
  no `allocated_amount` render `—`. This satisfies the approved mock (`$120,000 · 24.00%`) with zero DB
  write and zero analytics contamination; it supersedes the UI-SPEC's book-equity weight-fallback line.
- **D-03-B (lazy real-portfolio provisioning — 2026-08-06, round-4 scope addition, founder-flagged):**
  the allocation route resolves the caller's REAL portfolio (`user_id = auth.uid() AND is_test =
  false`) and, when absent, CREATES it server-side: `{ user_id: auth.uid(), name: 'Active
  Allocation', is_test: false }` (the migration-023 real-book seed convention), handling the
  `portfolios_one_real_per_user` 23505 race by re-selecting and proceeding (the CreatePortfolioForm
  docblock's own prescription). This is the ONLY `is_test=false` creation path in the repo — the
  /portfolios form deliberately inserts `is_test: true` and nothing else creates a real portfolio,
  so without provisioning EVERY allocator's book is portfolio-less and SC 2 is unreachable.
  Provisioning a container is NOT auto-add: the position write remains behind the explicit
  `Allocate…` action + amount (SC 3 intact). Supersedes the round-3 no-portfolio remedy modal
  (that state no longer exists); the client never sends a portfolio id.

### Claude's Discretion
- Exact copy of the two-way question (crisp; founder tone), the "More details" disclosure
  styling per DESIGN.md, mark tag styling, where the mark column/tag sits in the row, dialog
  vs inline for the Allocate amount input, validation of the amount (positive, bounded by
  sanity), and the structural-gate mechanics for D-03.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & model
- `.planning/REQUIREMENTS.md` — OWN-03 entry (2026-08-05 founder model refinement, verbatim
  two-step mark→allocate + hard invariant) and OWN-05 entry (rename). MUST-read.
- `.planning/ROADMAP.md` — Phase 150 section (SC 1/1b/1c/2/2b/3/4 + binding notes incl. the
  retro-path note and AUM-04 coordination trap).

### Phase-149 surfaces this phase extends
- `.planning/phases/149-nav-my-strategies-a-ranking-at-discovery-parity/149-CONTEXT.md` +
  `149-UI-SPEC.md` — the My Strategies ranking (row actions land here), placeholder-row and
  owner-marker anatomy, structural-gate architecture.

### Design
- `DESIGN.md` — tokens, chip/badge families, radius ladder, no-disabled-buttons direction.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` — the categorization step
  to cull: codename/description/category stay; types/subtypes/markets/exchanges/leverage
  (:283-:347), AUM (:353), max capacity (:360) collapse behind a disclosure.
- `src/components/strategy/StrategyTable.tsx` — Phase-149 owner surface (visibility prop,
  Delta-3 owner status marker); the mark tag + row actions extend this.
- `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` + `lib/strategies-row-adapter.ts` —
  the Holdings STRATEGIES panel (renders `props.strategies` = portfolio strategies via
  `toStrategyRows`; ps.alias precedent for owner labels).
- `src/app/api/portfolio-strategies/alias/route.ts` — existing owner-scoped
  portfolio_strategies write precedent (authz shape for the new allocate/rename writes).
- Phase-148 owner factsheet lane (`src/app/factsheet/[id]/v2/`) — rename affordance + read-only
  mark surface on the owner banner.

### Established Patterns
- Structural phase gates: `src/__tests__/phase-149-my-strategies-parity.test.ts` (12-pin
  architecture + mutation-proven) — D-03's never-allocatable invariant wants this shape.
- No-invented-data: absent metadata hides panels; the cull must not fabricate.
- Owner-authz: `.eq("user_id", uid)` own-only predicate idiom (149); RLS-owned writes.

### Integration Points
- Wizard finalize flow (`create-with-key` / `finalize-wizard` routes) — where the mark answer
  travels from the step to persistence. ⚠️ Do NOT widen wizard error handling (153 owns it).
- `portfolio_strategies` — the position write (money-path review target).
- Phase 151 (AUM) coordination: the position write must not double-count against live
  holdings (ROADMAP trap); keep the write shape compatible.

</code_context>

<specifics>
## Specific Ideas

- Approved form mock (founder 2026-08-06): capital question first, three fields, "▸ More
  details (optional)" collapsed group listing types · subtypes · markets · exchanges ·
  leverage · AUM · max capacity.
- Approved Holdings mock: "Black Swan — own capital — not allocated → [Allocate…] amount
  (USD)"; "Alpha Centauri — own capital — $120K · 24% → [Edit allocation…] (same strategy,
  never a 2nd row)".
- ⚠️ A schema migration for the mark (and possibly nothing else) is expected — new migrations
  MCP→TEST before merge; merging supabase/migrations/** to main AUTO-applies to PROD.

</specifics>

<deferred>
## Deferred Ideas

- Published-own rename (D-17 deferral) — trust-surface implications; revisit post-v1.17.
- Wizard-side "allocate now" shortcut (D-10) — only if the two-step flow proves annoying in
  dogfooding.
- Role-gated form variants (allocator vs manager forms diverging beyond the capital question).
- Header "+ Allocation" path-to-existing-strategy affordance (DEFERRED 2026-08-06, plan-check
  rev-2 orchestrator decision): the header button offers no route to allocate an
  already-onboarded strategy; arm-2's "Go to My Strategies →" empty-state link is this phase's
  mitigation. A full affordance needs its own UI-SPEC surface. Booked in root TODOS.md
  (UX / product polish).

</deferred>

---

*Phase: 150-OWN-03 — The wizard asks whose capital this is*
*Context gathered: 2026-08-06*
