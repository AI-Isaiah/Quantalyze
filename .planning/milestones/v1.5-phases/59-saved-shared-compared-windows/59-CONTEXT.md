# Phase 59: Saved / Shared / Compared Windows - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Make the coverage window **durable** across the three ways a scenario leaves the composer —
saved, shared, and compared — so the honest windowed blend follows the scenario wherever it goes:

- **PERSIST-01** — the coverage window is saved as part of a scenario (`ScenarioDraft`
  schema_version bump 2→3); reopening recomputes **today's** numbers at the owner's saved window;
  pre-v1.5 windowless drafts default to intersection with a provenance note.
- **PERSIST-02** — a shared link recomputes-on-open at the owner's window under the coverage-window
  rule, with **no** live-book / cross-tenant leak, and the recipient's view matches the owner's
  (identical window derivation via the ONE shared helper `scenario-window.ts`).
- **PERSIST-03** — compare (2+ scenarios side-by-side) works with **each scenario's own** persisted
  window.

**Out of scope:** the compute engine (`scenario.ts`) stays FROZEN; `scenario-window.ts` helpers are
reused, not changed; own-book / live-book callers stay windowless (Phase 55 lock); the Phase-58
composer surfaces are unchanged except where a saved window flows in on reopen.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Persistence storage model (PERSIST-01)
- **Window lives INSIDE the `ScenarioDraft` JSONB** as `window?: CoverageWindow` (optional field on
  `ScenarioDraft`, `src/app/(dashboard)/allocations/lib/scenario-state.ts`). This is the Phase-55
  pre-decision ("Window IS persisted in ScenarioDraft"). Consequence: the `scenarios` table already
  stores `draft` JSONB + `schema_version INT`, so **NO SQL migration / NO ALTER TABLE**, and
  `get_shared_scenario` already returns `draft` whole so shares + compare get the window for free.
- **Bump `SCENARIO_SCHEMA_VERSION` 2 → 3.** The 2→3 transition is a **NON-DESTRUCTIVE upgrade**:
  a v2 draft (no window) loads fine (never reset/dropped), window defaults to intersection via
  `defaultWindowFor()`, and a provenance marker is set. Do NOT reuse the v1→v2 reset-on-mismatch path
  for 2→3 — that would delete users' saved scenarios.
- **"Migration" = the code-level draft-schema v2→v3 upgrade**, not a SQL migration (per Phase 55
  CONTEXT + REQUIREMENTS reading). No `supabase/migrations/*.sql` file is needed for the window
  field. (A migration IS still required if the leak-scan test or RPC needs a change — see Area 2 Q3.)
- **Reopen recomputes TODAY's numbers** at the saved window — never store/replay stale computed
  series (no-invented-data lock). Apply `draft.window` into `state.window` on hydrate, then
  `computeScenario` re-derives.

### Area 2 — Shared-link window (PERSIST-02)
- The window **rides in the returned `draft` JSONB** — `get_shared_scenario` already returns `draft`,
  so **no RPC / SQL change** to thread the window. `share-resolve.ts` (`scenario-share/[token]/`)
  reads `draft.window` and threads it into `state.window` before calling `computeScenario`.
  **LOAD-BEARING ASSUMPTION the executor MUST verify:** the RPC returns the `draft` JSONB whole
  (not a re-projected subset that strips unknown fields). If it re-projects, the window field must be
  added to the projection (a migration) — confirm first.
- **Recipient uses the owner's saved window VERBATIM** (deterministic; recipient view == owner view).
  Do NOT re-derive a fresh intersection on the recipient side (published series could differ →
  divergent membership). Both owner and recipient read the same persisted value; the "one shared
  helper" invariant holds because the value was derived once via `scenario-window.ts` at save time.
- **Leak safety:** the window is two ISO date strings — no tenant data, no new leak surface. Extend
  `test_scenario_shares_rls.sql` to assert the window round-trips AND that api_key / value_usd /
  holdings refs remain absent (the existing honesty assertions stay).
- **Pre-v1.5 shared draft** (v2, no window) → recipient defaults to intersection, same rule as owner
  reopen.

### Area 3 — Compare across windows (PERSIST-03)
- Each compared scenario is computed at **its own persisted `draft.window`** (heterogeneous windows
  are honest). Pass `draft.window` into `computeMetricsForDraft` (`scenario-compare.ts`) — the file
  already flags the heterogeneous-window path.
- **Each compare column shows its own effective-window label** (BlendHeader-style
  "· {start}–{end}") so the user sees columns are NOT force-aligned.
- **The live-book comparison column stays windowless** (Phase 55 lock — own-book callers keep union
  behavior; no window passed to the live column's `computeScenario`).
- A windowless v2 draft in a compare set → intersection default (same rule everywhere).

### Area 4 — Provenance / upgrade note (PERSIST-01)
- Shown **only** when reopening a pre-v1.5 (v2) windowless draft that gets defaulted to intersection.
- **Copy:** "This saved scenario predates coverage windows — showing the common period ·
  Show full range" (mirrors the POLISH-03 note; "Show full range" reuses the existing Full-range
  preset escape hatch).
- **Form/placement:** reuse the Phase-58 `DefaultChangeNote` inline **info** note pattern
  (`role="status"`, dismissible ×), above the window control. New copy variant, same component/tokens.
- **Dismissal is ephemeral per-open** (re-shows if another old draft is reopened) — it is a
  per-scenario provenance signal, NOT a one-time global localStorage flag.

### Claude's Discretion
- The exact `window?` field placement in the `ScenarioDraft` interface + `scenarioDraftSchema` codec,
  and the provenance-marker representation (a transient flag on hydrate result, not persisted).
- Whether the provenance note reuses `DefaultChangeNote` directly (new prop/copy) or a thin wrapper.
- The per-column compare window-label component (reuse/extract from BlendHeader).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ScenarioDraft` + `SCENARIO_SCHEMA_VERSION` (=2) + `scenarioDraftSchema` codec:
  `src/app/(dashboard)/allocations/lib/scenario-state.ts:57,75-96`.
- Save route: `src/app/api/allocator/scenario/saved/route.ts:66-142` (writes `{allocator_id, name,
  draft, schema_version}` to `scenarios` table). Load/hydrate: `useScenarioState.ts` (+
  `useScenarioState.hydrate.test.tsx`).
- Share: `scenario_shares` table + `get_shared_scenario` SECDEF RPC
  (`supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:141-209`), resolver
  `scenario-share/[token]/share-resolve.ts:107-196` (calls `computeScenario` at :185, NO window
  today), create route `.../scenario/share/route.ts`.
- Compare: `scenario-compare.ts:40-197` (`computeMetricsForDraft`, heterogeneous-window comment
  :27-31) + `ScenarioComparePanel.tsx:45-100` (codec trichotomy: ok/readonly/reset→NULL_METRICS).
- Window helpers: `src/lib/scenario-window.ts` (`coverageSpanOf`, `intersectionOf`, `unionOf`,
  `defaultWindowFor`, `covers`). Phase-58 `DefaultChangeNote.tsx` + `BlendHeader.tsx` for reuse.

### Established Patterns
- Codec trichotomy (`ok` / `readonly` / `reset`) — never bare-cast a persisted draft (M-0153).
  DI-23-01: only the `ok` outcome renders in share-resolve.
- `scenarios` table RLS `scenarios_owner` on `allocator_id = auth.uid()`; `scenario_shares` SECDEF
  RPC leak-scoped (published-only, revoked-excluded, no api_keys/portfolios join).
- Migration naming `YYYYMMDD120000_description.sql`; backdated-migration safety guard; SQL-fn-snapshot
  guard needs `npm run schema:functions` if the RPC changes.

### Integration Points
- Window in draft → save route + `useScenarioState` hydrate + `share-resolve` + `scenario-compare`
  all thread `draft.window` through the SAME `scenario-window.ts` helpers.
- Guards to keep green: `route.test.ts` (saved CRUD/RLS), `useScenarioState.hydrate.test.tsx`,
  `share-resolve.test.ts`, `test_scenario_shares_rls.sql` (leak-scan), `scenario-compare.test.ts`,
  `ScenarioComparePanel.test.tsx`, Phase-55 frozen-spine + BLEND-07 + parity.

</code_context>

<specifics>
## Specific Ideas

- Window-in-draft is the deliberate simplification that eliminates a SQL migration and an RPC change
  for the common case — but the executor MUST verify `get_shared_scenario` returns the `draft` JSONB
  whole before relying on it (if it re-projects, add the field + a migration + `schema:functions`).
- Recipient + compare + reopen all use the owner's saved window verbatim; membership stays
  deterministic and identical everywhere via the one `scenario-window.ts` helper.
- Non-destructive 2→3 upgrade is the load-bearing correctness point — a reset-on-mismatch here would
  silently delete saved scenarios.

</specifics>

<deferred>
## Deferred Ideas

- Golden / e2e re-bake to the new blend series — Phase 60 (VERIFY-01).
- Authed prod canary of the whole chain — Phase 61 (VERIFY-02).
- Any engine/`scenario-window.ts` change — out of scope (frozen).

</deferred>
