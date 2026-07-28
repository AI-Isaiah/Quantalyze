# Phase 13: Discovery v2 Polish - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

`/discovery/[slug]` reaches IA parity with Quants.Space — Watchlist sub-tab on the existing
`StrategyFilters` row, per-user-keyed Customize prefs in localStorage, single-accent
Sparkline rule (DESIGN.md DIFF-05), default "Hide examples" backed by a seed-row data
backfill, and (audit-gated) filter-by-team with privacy gate via
`organizations.is_public`. No changes to the Python `analytics-service`. No DDL beyond
the conditional migration `088_organizations_is_public.sql` (only ships if
`SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND status='published'`
returns > 0).

Phase 13 is independent of Phase 12 (parallel wave) and does not block Phase 14a/14b.

</domain>

<decisions>
## Implementation Decisions

### Watchlist UX & Star Toggle (DISCO-01)
- "My Watchlist" sub-tab lives **inside the existing `StrategyFilters` row** as a 2-tab
  segmented control "All / My Watchlist", visible above the table/grid surface. The
  Watchlist tab carries a count badge sourced from the watched-set length.
- Star icon position in **table rows: leading column** (left of strategy name) — matches
  Quants.Space convention and is fast to scan in dense tables.
- Star icon position on **grid cards: top-right corner overlay** — standard card
  affordance (matches existing `StrategyGrid` card layout).
- Rapid double-click idempotency is **server-side**: `PUT /api/watchlist/[strategyId]`
  upserts to `user_favorites` (`ON CONFLICT DO NOTHING` for add, `DELETE` for remove);
  the client uses optimistic UI with no client-side debounce. The PUT body carries
  `{ action: "add" | "remove" }`.

### Customize Prefs Modal (DISCO-02)
- Customize trigger is a **settings-cog icon button at the right end of the existing
  `StrategyFilters` row** (next to sort dropdowns). No new top-level header surface.
- Customize panel is a **right-edge slide-out drawer** matching DESIGN.md
  "Modals: White surface, subtle shadow, slide-out panels from right edge".
- **No migration of any prior `discovery_view_preferences*` localStorage keys** — the
  `{auth.uid}:{slug}` keying scheme is fresh; no prior version was deployed to
  allocators.
- **Defaults when localStorage key is missing**: `view = "table"`,
  `sort = { key: "sharpe", dir: "desc" }`, `hide_examples = true`. The
  `hide_examples = true` default is required by DISCO-05.

### Audit Gate, Seed Backfill & Visual Regression (DISCO-03 / DISCO-04 / DISCO-05)
- The `organization_id` population audit SQL runs **inline via Supabase MCP at
  plan-phase time** against the production DB (`khslejtfbuezsmvmtsdn`). The single
  query is `SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND
  status='published'`. The integer result is recorded in
  `.planning/phases/13-discovery-v2-polish/TODOS.md` (under a "DISCO-03 audit" section
  header) **before any DISCO-03 plan task is generated** — gate decision is locked
  before planning continues.
- **If audit count = 0**: migration `088_organizations_is_public.sql` is **not shipped**;
  DISCO-03 (filter-by-team UI) is **deferred to v0.18** with a TODOS entry. This
  matches phase success criterion 4 verbatim.
- **If audit count > 0**: migration 088 ships (adds `is_public BOOLEAN DEFAULT false`
  to `organizations`); the filter dropdown reads only orgs `WHERE is_public = true`;
  surface only orgs whose strategies are visible to the allocator under existing RLS.
  Default-false avoids leaking private/stealth fund names; admin can flip orgs to
  public manually during v0.17. The `/strategies/team` opt-in toggle is deferred to
  v0.18 (out of Phase 13 scope).
- **Seed UUID source for `is_example = true` backfill**: pull the seed-strategy UUIDs
  by querying production for strategies whose `created_by` matches the seed-admin
  auth uid (with a fallback `name ILIKE 'demo_%'` pattern if the seed-admin uid is
  not available). The final UUID list is captured in the data-only migration
  produced by Phase 13. No DDL — `is_example` column already exists (migration
  001:64).
- **Sparkline visual regression harness**: add a Playwright spec under `tests/e2e/`
  that visits `/discovery/[slug]`, snapshots both the table and grid sparklines, and
  asserts no SVG `path` element mixes `#16A34A` and `#DC2626` strokes (per the
  DESIGN.md DIFF-05 single-accent rule). The spec is wired into the existing
  Playwright CI lane.

### Claude's Discretion
- Component file layout (e.g., `WatchlistTab.tsx`, `CustomizeDrawer.tsx`,
  `StarToggle.tsx`) is at Claude's discretion provided imports follow the existing
  `src/components/strategy/` and `src/components/discovery/` conventions.
- Exact API route handler structure (single PUT vs PUT + DELETE) is at Claude's
  discretion provided the success-criterion grep `PUT /api/watchlist/[strategyId]`
  is satisfied and the operation is idempotent under rapid double-click.
- Whether to read the audit count via `mcp__plugin_supabase_supabase__execute_sql`
  vs `mcp__plugin_supabase_supabase__list_tables` + a follow-up query is at
  Claude's discretion — both surface the same integer.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/strategy/StrategyTable.tsx` — already has `viewMode` (table | grid),
  `showExamples` state, `StrategyFilters`, `StrategyGrid`. Phase 13 extends rather than
  replaces.
- `src/components/strategy/StrategyFilters.tsx` — receives `viewMode`, `sortKey`,
  `sortDir`, `advancedFilters`. Add the All/Watchlist segmented control + Customize
  cog button to this row.
- `src/components/charts/Sparkline.tsx` — already single-color (`color` prop, no
  per-point segmentation). Phase 13 wires the final-value sign → color rule
  (`#1B6B5A` / `#DC2626` / `#94A3B8`) at the call site, not inside Sparkline.
- `src/lib/queries.ts` — already exports `getStrategiesByCategory`. Phase 13 adds
  `getMyWatchlist(userId)` querying `user_favorites` (migration 024 — RLS-protected,
  schema already shipped).
- `src/components/discovery/SimulateImpactButton.tsx` — pattern for row-action
  components in discovery; Star toggle follows the same structure.
- `src/lib/database.types.ts` — already has the `user_favorites` row type.

### Established Patterns
- **Client components** for any stateful UI (`"use client"` directive at top).
  StrategyTable is already a client component — Watchlist sub-tab + Customize drawer
  attach inside it.
- **Server actions / route handlers** for mutations: `PUT /api/watchlist/[strategyId]`
  follows the existing `src/app/api/.../route.ts` pattern with `createClient` from
  `@/lib/supabase/server`.
- **Optimistic UI** via `useOptimistic` or local state mirror — pattern already used in
  `OutcomesWidget.tsx` for inline edits.
- **localStorage scoping** — pattern already used in Sprint 10 Scenario Builder
  (per-allocator scoped key, `{auth.uid}` segment).
- **Visual snapshot testing** — Playwright is already in the project; `tests/e2e/` is
  the standard directory.

### Integration Points
- Discovery list page: `src/app/(dashboard)/discovery/[slug]/page.tsx` — passes
  strategies + portfolio to `StrategyTable`. Phase 13 also fetches the user's
  watched-set in parallel and threads it through.
- Watchlist API route: new file `src/app/api/watchlist/[strategyId]/route.ts`.
- `user_favorites` schema (migration 024) — full RLS already in place; Phase 13
  consumes, no DDL needed.
- Conditional new migration `088_organizations_is_public.sql` — only emitted if the
  audit returns > 0. Lives in `supabase/migrations/`.
- Data-only migration for `is_example = true` seed backfill — lives in
  `supabase/migrations/` next to 088 if it ships, or as a standalone file
  (`089_seed_is_example_backfill.sql` or similar — final number assigned at
  plan-phase time relative to whatever 088 ends up being).
- Playwright e2e spec — `tests/e2e/discovery-sparkline-regression.spec.ts` (or
  similar) — runs in the existing CI lane.

</code_context>

<specifics>
## Specific Ideas

- DESIGN.md DIFF-05 single-accent sparkline rule is the visual contract — `#1B6B5A`
  when final value > 0, `#DC2626` when < 0, `#94A3B8` when = 0. The Playwright
  regression spec exists specifically to catch any future split-color reintroduction.
- The `localStorage` key format is exactly
  `discovery_view_preferences:{auth.uid}:{slug}`. The phase success criterion explicitly
  calls for a Playwright spec that proves login-as-A-then-login-as-B leaves no A-keys
  in B's localStorage — this should be the same spec or a sibling spec.
- The audit gate behaviour is binary: 0 → defer DISCO-03 + 088, > 0 → ship both.
  No middle ground (no "ship migration without UI", no "ship UI with empty dropdown").

</specifics>

<deferred>
## Deferred Ideas

- `/strategies/team` opt-in settings UI for managers to flip their org public
  (deferred to v0.18). Phase 13 only ships the schema + read path; admin manually
  flips orgs as needed during v0.17.
- Multi-benchmark sparkline overlays (ETH/SOL) — descoped at milestone level
  (UC#6); not relevant to Phase 13.
- Keyboard navigation polish for the Customize drawer (full a11y is the Phase
  14a/14b A11Y-XX work — Phase 13 only ships standard tab order + ESC-to-close).

</deferred>
