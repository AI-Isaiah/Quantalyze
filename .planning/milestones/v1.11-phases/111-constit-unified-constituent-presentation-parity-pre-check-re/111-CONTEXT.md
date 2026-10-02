# Phase 111: CONSTIT — unified constituent presentation (⚠️ PARITY PRE-CHECK) - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss. Design decisions locked from ROADMAP Success Criteria + the CONSTIT premise + DESIGN.md; the PARITY OUTCOME is deliberately NOT pre-decided (it is the empirical first deliverable). This CONTEXT doubles as the design contract → plan with `--skip-ui` (no separate UI-SPEC: this is a reshape of the existing composer under the now-codified DESIGN.md, not a greenfield surface).

<domain>
## Phase Boundary

Reshape the scenario composer so every source (api-key / CSV / catalog / composite) is ONE uniform weightable constituent row in a single list — the v1.10 dailies-canonical backbone applied to the composer: in a scenario every constituent IS a strategy, source is metadata. This is a WIRING/PRESENTATION reshape, not new math and not a new engine.

**The gate that governs everything:** before ANY CONSTIT UI lands, an independent numpy/pandas re-derivation must prove the per-key daily series equals the current per-position weighted blend on a real multi-position fixture — or a deliberate re-baseline is recorded and re-verified. No papering over a divergence.

**Out of scope (fenced):**
- `scenario.ts` stays BYTE-FROZEN (SC-3 keep-gate must stay green). No engine edits.
- No weights/leverage editing (Phase 112/113), no E1/E2 backbone absorption (114/115), no "+ Allocation" dispatch (116).
- Per-coin holdings stay on the Holdings tab only — NOT promoted into the constituent list.
</domain>

<decisions>
## Implementation Decisions

### CONSTIT-05 — Parity pre-check (GATE, FIRST DELIVERABLE) [outcome deferred to execution]
- The FIRST plan/task is an independent numpy/pandas re-derivation on a REAL multi-position fixture proving: per-key daily series == the current per-position weighted blend the composer renders today. Independent = do NOT call `scenario.ts`/the app blend; re-derive from raw per-position/per-key data with pandas and compare.
- **Protocol if it MATCHES:** record "parity verified" + the fixture + tolerance in the phase docs; proceed to the UI.
- **Protocol if it DIVERGES:** STOP the UI. Record a deliberate re-baseline decision in `.planning/PROJECT.md` Key Decisions (what the new canonical blend definition is + why), re-verify the re-derivation against the NEW definition, and only then proceed. Surface the divergence to the founder before committing the re-baseline (it changes displayed numbers) — this is a genuine either/or worth a pause.
- No CONSTIT UI code merges before this task's gate is green.

### CONSTIT-01/02 — Unified constituent row presentation
- The composer presents every source as ONE uniform constituent row in a single list. DELETE the separate "Data Sources" section in `ScenarioComposer.tsx` (grep the WHOLE repo incl. `e2e/` for orphaned "Data Sources"/`dataSources` strings BEFORE disclosure-delete — SC-3 lesson: grep-gates scan `src/` only).
- Each row shows a provenance badge with the fixed taxonomy: **api-verified · csv · self-reported · composite** (CONSTIT-02). Badge is presentation-only, driven by the constituent's existing source metadata; follow DESIGN.md badge/token conventions (no new colors outside the DESIGN.md allowlist).
- Row layout follows DESIGN.md (mono numerics per the Numbers Contract, sign-only color, radius ladder). Reuse existing composer row components where they exist; do not fork styling.

### CONSTIT-03 — Book-seed collapse + off-toggle
- A book seed collapses to strategy/key-level constituents (NOT per-coin rows — per-coin holdings remain on the Holdings tab).
- Toggling a source off uses the SAME include/exclude mechanism as toggling any other constituent off (one mechanism, not a special-case path for data sources).

### CONSTIT-04 — Engine freeze + clean delete
- `scenario.ts` byte-frozen: the SC-3 keep-gate test must stay green; if any change appears needed there, STOP — it means the reshape leaked into the engine.
- Whole-repo grep (incl. `e2e/`) confirms zero orphaned deleted Data-Sources strings before the disclosure-delete commit.

### Regression / gate tests (MANDATORY)
- CONSTIT-05: the parity re-derivation is a committed, re-runnable test/script (not a one-off), asserting equality within tolerance — fails if the blend definition drifts.
- CONSTIT-01/02: a test asserts the composer renders a single unified list with a provenance badge per row and NO "Data Sources" section.
- CONSTIT-04: SC-3 `scenario.ts` byte-freeze gate stays green; a repo-wide grep gate for orphaned Data-Sources strings.

### Claude's Discretion
- Exact fixture chosen for the parity check (must be a real multi-position/multi-key case — the test allocator `a11ca111-...` or an existing composite fixture).
- Provenance badge visual (within DESIGN.md), exact row component reuse, test file placement.
</decisions>

<code_context>
## Existing Code Insights

### Reusable / target files
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — hosts the current "Data Sources" section to unify into the constituent list (+ `.test.tsx`).
- `src/lib/scenario.ts` — the FROZEN engine (consumes a unified constituent list already — per the milestone premise the engine is ready; this phase is presentation). DO NOT edit.
- `src/lib/scenario-blend-adapter.ts` (+ `.test.ts`) — Phase-108 blend adapter (`deriveBlendPanels` via canonical `factsheet/rolling.ts` primitives). Relevant to the parity re-derivation baseline.
- `src/lib/scenario-backbone-gates.test.ts` — permanent SC-2/SC-3 delete/freeze gates.

### Established patterns
- Provenance/source metadata already exists on constituents (api-key/csv/catalog/composite) — CONSTIT-02 is surfacing it, not computing it.
- DESIGN.md codified (Numbers Contract, badge tokens, radius ladder, AI-Slop Ban) — the design contract for the row/badge presentation.
- Whole-repo grep before disclosure-delete (SC-3 lesson: gates scan `src/` only; strings linger in `e2e/`).

### Integration points
- The composer's constituent list state/selection; the frozen `scenario.ts` consumes the unified list; the parity re-derivation compares raw per-key/per-position data to the rendered blend.
</code_context>

<specifics>
## Specific Ideas
- Milestone premise (memory `project_scenario_composer_add_allocation_role_gate`): the frozen `scenario.ts` ALREADY consumes a unified constituent list → CONSTIT is UI-only presentation over an engine that's ready.
- This phase LIKELY needs a research pass (`gsd-phase-researcher`) for the parity method + the current blend definition — plan with research enabled.
</specifics>

<deferred>
## Deferred Ideas
- Per-constituent weights + leverage editing → Phase 112/113.
- E1/E2 backbone absorption (Sharpe/TWR/equity) → Phase 114/115.
- Per-coin holdings promotion — deliberately NOT done (holdings stay on Holdings tab).
</deferred>
