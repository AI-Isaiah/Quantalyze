# Phase 116: ADDALLOC — context-aware "+ Allocation" - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas accepted verbatim (founder-aligned from live dogfood 2026-07-18 + on-file v1.11 UAT direction)

<domain>
## Phase Boundary

The header "+ Allocation" button performs a deterministic, context-aware action per active tab, and the zero-portfolio Simulate-Impact dead-end is fixed. In scope:

- Scenario tab: "+ Allocation" (labelled **"+ Strategy"** there) opens the strategy picker — others' published strategies + the allocator's own (including private contributions) — with an upload-a-key option.
- Holdings / Overview tabs: "+ Allocation" opens real-data onboarding — the existing Connect-Your-Strategy wizard (upload CSV or connect a read-only API key).
- The button always performs a deterministic per-tab action — never a silent no-op, never over-corrected into a dropdown-every-time.
- The zero-portfolio Simulate-Impact disabled affordance deep-links to the real allocator onboarding path (connect exchange) with honest copy — not the manager-only `/portfolios` dead-end.

Out of scope: the tooltip/overflow polish (Phase 117); per-key stitch-progress in the wizard (separate finding, not an ADDALLOC criterion).
</domain>

<decisions>
## Implementation Decisions

### Presentation model
- "+ Allocation" opens its target as an **inline overlay** (drawer/modal) over the current surface — no full-page navigation away. Matches the on-file UAT direction "overlays wizard inline".
- Applies to both the Scenario strategy picker and the Holdings/Overview connect wizard.

### Button label (context-aware)
- Reads **"+ Strategy"** on the Scenario tab (a scenario is composed of strategies), **"+ Allocation"** on Holdings/Overview. Founder's explicit request (live dogfood 2026-07-18).

### Real-data onboarding target
- Holdings/Overview "+ Allocation" opens the **existing Connect-Your-Strategy wizard** (`strategies/new/wizard/`) — upload CSV or connect a read-only API key — as an overlay. Reuse the proven multi-step flow, do not fork a slimmer variant.

### Simulate-Impact remedy (ADDALLOC-04)
- Replace the manager-only `/portfolios` link (`OptimizerPanel.tsx:104`) with a **deep-link to the allocator connect-exchange onboarding** + honest copy explaining why Simulate-Impact is disabled with no portfolio. Not the `/portfolios` dead-end.

### Claude's Discretion
- Exact overlay primitive (Dialog vs Drawer vs Sheet) — pick whatever the codebase already standardises on; reuse, don't introduce a new one.
- Copy wording within the honest-copy constraint.
- Whether the Scenario picker's "upload-a-key" option reuses the same wizard overlay or a lighter affordance — implementer's call, kept consistent with the existing picker.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AllocationsTabs.tsx:756-766` — the current "+ Allocation" header button (`onClick={() => changeTab("scenario")}`, the exact bug the founder hit). `activeTab` is derived from `searchParams` (`parseTab`), so per-tab branching is already available in-scope.
- `strategies/new/wizard/` — the Connect-Your-Strategy multi-step wizard (`WizardChrome.tsx`, `page.tsx`, steps `ConnectKeyStep` / `MultiKeyConnectStep` / `ReviewStep`). The real-data onboarding target for Holdings/Overview.
- `components/StrategyBrowseDrawer.tsx` — the existing scenario strategy picker (others' published + own). The Scenario-tab target; already a drawer (fits the overlay decision).
- `components/OptimizerPanel.tsx:104` — the `href="/portfolios"` dead-end for zero-portfolio Simulate-Impact (ADDALLOC-04). Covered by `OptimizerPanel.test.tsx:108`.

### Established Patterns
- Tab state is URL-derived (`router.replace`, `parseTab`), no local `activeTab` state — branch on `activeTab`.
- Overlays in this surface use drawers (`StrategyBrowseDrawer`). Prefer that primitive for consistency.

### Integration Points
- The button lives in `AllocationsTabs.tsx` where `activeTab` is already known → the per-tab dispatch happens there.
- Wizard overlay: reuse `strategies/new/wizard` — determine whether it can mount as an overlay component or needs a lightweight modal host.
- `OptimizerPanel.tsx` link swap + its test.

</code_context>

<specifics>
## Specific Ideas

- Founder's live wording (2026-07-18): on My Allocation, "+ Allocation" should open the wizard "so I can add the API keys that comprise my portfolio"; on the Scenario tab it "should be called +strategy, because it is not an allocation there, but a scenario, and in scenarios we only have strategies."
- No disabled dead-ends: a blocked affordance must offer a clickable remedy (generalises ROLE-06).

</specifics>

<deferred>
## Deferred Ideas

- Per-key progress on the multi-key stitching wizard screen (founder finding 2026-07-18: "I do not see a per key progress"). NOT an ADDALLOC success criterion — track as a separate UI item, likely a follow-up to the wizard, not this phase.

</deferred>
