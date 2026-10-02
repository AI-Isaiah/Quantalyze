# Phase 64: Presentation Purification (AUM out, share caption) - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Position-space facts leave the scenario tab's presentation: the KPI strip becomes
return-form only (AUM KPI removed, matching the share page's "no USD, no AUM"
contract), and the public share page gains a one-line honest caption for mixed
shares. Commit sizing (weight × AUM at the COMMIT boundary) is byte-untouched.

In scope: PRESENT-01 (AUM KPI out), PRESENT-02 (commit sizing unchanged — a
constraint, not a change), PRESENT-03 (mixed-share caption reading Phase-62
persisted membership).
Out of scope: any engine change (Phases 62-63 done), canary (65), payload/SSR
changes, frozen engine (GUARD-03 milestone-wide).

Depends on Phase 62 (persisted membership drives the caption condition); lands
after 63 on the same branch.
</domain>

<decisions>
## Implementation Decisions

### KPI Strip after AUM removal (PRESENT-01/02)
- Nothing replaces the AUM slot — the strip reflows to its remaining return-form
  KPIs (grid/flex reflow per DESIGN.md); no new KPI invented (no-invented-data).
- DESIGN.md read BEFORE the layout edit; the strip matches the share page's
  return-form presentation contract.
- scenarioAum keeps feeding the commit diff modal UNCHANGED; pinned by existing
  commit-modal tests staying green verbatim.
- Only the KPI-strip CONSUMER is removed — the scenarioAum computation stays
  (commit boundary consumes it); no payload/SSR change.

### Share-Page Mixed Caption (PRESENT-03)
- Render condition: shared draft is MIXED — persisted `memberKeyIds` non-empty
  AND `addedStrategies` non-empty (the renormalized-added-legs case, red-team F3).
  Book-only shares are unreachable (409 at mint). Pre-v4 shares (underived
  membership) keep the honest-absence path unchanged — no caption invented for
  drafts whose membership is unknown.
- Copy locked verbatim: "computed from this scenario's catalog strategies only".
- Quiet one-line caption in the share page's existing note register (text-muted,
  near the methodology/coverage line; exact placement per DESIGN.md + existing
  hierarchy); never accent/warning.
- Reads ONLY the draft JSONB already resolved server-side (memberKeyIds +
  addedStrategies) — zero private data, no RPC change.

### Claude's Discretion
- Exact reflow treatment of the strip (within DESIGN.md).
- Caption DOM placement among the existing share-page notes (within DESIGN.md).
- Test naming, following phase conventions.
</decisions>

<code_context>
## Existing Code Insights

- KPI strip: the scenario tab's KpiStrip renders the AUM KPI; share page already
  renders return-form-only ("No USD, no AUM" contract) — it is the analog.
- Phase 62 landed `memberKeyIds` (persisted, verbatim through share mint/resolve)
  and `isBookOnlyDraft`; Phase 63 landed series-space-only engines. share-resolve
  threads the draft whole — the caption condition reads decoded draft fields.
- Commit modal: scenarioAum consumed at the commit boundary (ScenarioComposer),
  pinned by commit-modal tests (T_C18/T_C21/B11 class — survived Phase 63 verbatim).
- Share page: scenario-share/[token]/page.tsx + share-resolve.ts (server-side,
  public route in proxy.ts PUBLIC_ROUTES — no change needed, route exists).

## Integration Points
- Scenario KpiStrip component (find exact file during research/pattern-map).
- scenario-share/[token]/page.tsx (caption render) + its axe/a11y scans
  (composed scans filter serious+critical — keep them green).
- Golden/e2e: KPI-strip changes may touch golden bakes — check for baked
  scenario-tab snapshots (v1.4 golden bake precedent) and plan reviewed re-bakes
  if any pin the AUM KPI.
</code_context>

<specifics>
## Specific Ideas
- The share page's existing "no USD" contract is the exact presentation target
  for the tab's strip — parity, not invention.
- e2e coverage should include the public/share role (memory: cover all user
  groups — public share page is the public-role surface here).
</specifics>

<deferred>
## Deferred Ideas
- Removing holdingsSummary / holdingReturnsByScopeRef from the SSR payload
  (future cleanup, locked LEAVE IT).
- Friendly gantt labels (P61 B1 polish).
</deferred>
