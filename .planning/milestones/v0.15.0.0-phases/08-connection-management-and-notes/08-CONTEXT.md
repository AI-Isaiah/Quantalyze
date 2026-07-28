# Phase 08: Connection Management and Notes — Context

**Gathered:** 2026-04-21
**Status:** Ready for research & planning
**Prior-phase pickup:** Phase 06 Allocator API Ingestion (10/10 UAT) + Phase 07 Demo-Mode Purge (6/6 plans, verifier PASS) shipped. `/connections` route retired during Phase 06 UAT scope delta; `AllocatorExchangeManager.tsx` at `/profile?tab=exchanges` already ships list + 7-state sync pill + Sync-now + delete-key via migration 069 RPC. `user_notes` table exists (migration 037) but portfolio-scope only, plain text, 1s-debounced autosave via `/api/notes`. Phase 08 re-anchors the charter around this shipped IA and extends notes to 4 scopes.

<domain>
## Phase Boundary

A production-grade settings surface for allocator connections (already resident at `/profile?tab=exchanges`) gains a clean user-initiated Disconnect flow and a revoked-key holdings UI, AND a multi-scope `user_notes` capability (portfolio / holding / bridge_outcome / strategy) surfaces across the app with markdown-rendered, on-blur-autosaved, owner-private notes.

**In scope:**
- Rename the existing Remove-key action to "Disconnect" with a "Also delete historical holdings" checkbox, mapped to migration 069 `delete_allocator_api_key(p_cascade_holdings)` (no new RPC).
- Revoked-key holdings UI on the holdings table: strikethrough rows + amber "Key revoked" chip + allocator-togglable "Show revoked-key holdings" (default ON).
- Historical KPIs / equity curve / drawdown ALWAYS include revoked-key holdings — toggle is current-view-only (MANAGE-02).
- `user_notes` reshape to `(user_id, scope_kind, scope_ref)` with 4 scopes (MANAGE-04), data-migrating existing portfolio rows.
- Markdown-render-on-read via `react-markdown` + `rehype-sanitize`; plain-text storage unchanged.
- Four note UI surfaces: NotesWidget (portfolio, Performance tab via react-grid-layout), inline expandable holdings-row (holding), expandable OutcomesWidget row (bridge_outcome), `/strategy/[id]` factsheet card (strategy).
- On-blur autosave across all four surfaces mirroring Phase 02 `useMandateAutoSave`; upgrade existing `NotesWidget` off 1s-debounce for consistency.
- Audit taxonomy entries for four note-update kinds (ADR-0023 sync in the same commit).

**Out of scope (other phases or deferred):**
- User-initiated soft Revoke as a distinct action from Disconnect (deferred — consolidated into Disconnect cascade checkbox).
- Per-key rename / label column (deferred to backlog — new capability).
- Connection-health summary card ("2 keys connected, 1 stale") — Phase 11 onboarding polish candidate.
- /notes index page / journal UX (deferred post-v0.15 if requested).
- Multi-note threads per scope, note version history (deferred — institutional convention is one live note per target).
- Bridge-live wiring against `allocator_holdings` (Phase 09).
- Scenario builder composition + commit flow (Phase 10).
- Onboarding nudges (Phase 11).

</domain>

<prior_decisions_inherited>
## Inherited from Phases 06 / 07 (locked)

- **Connection surface:** `/profile?tab=exchanges` is canonical. No `/connections` alias, no full-page resurrection. Update MANAGE-01 wording during Phase 08.
- **Delete-key RPC:** `delete_allocator_api_key(p_api_key_id, p_cascade_holdings)` (migration 069) is the authoritative path. Phase 08 reuses verbatim — no new backend for disconnect.
- **Sync-status taxonomy:** `api_keys.sync_status` ∈ {`idle`, `syncing`, `computing`, `complete`, `complete_with_warnings`, `rate_limited`, `revoked`, `error`}. `revoked` is currently exchange-initiated only (401/permission). Phase 08 does NOT add a user-facing Revoke button.
- **Staleness semantics (Phase 07 D-10/D-11):** measured across the allocator's active keys; 24h threshold; blocks KPIs with `—` greyed out + overlay on charts. Staleness and revoked-key UI are orthogonal — revoked holdings are ALWAYS included in historical series; staleness only blocks current-view KPI rendering.
- **Dashboard IA (Phase 07 D-04):** `/allocations?tab=performance|scenario`. NotesWidget lives on Performance only.
- **Widget pattern (Phase 05 D-01):** single-file widget in react-grid-layout; `LAYOUT_VERSION` bump is localStorage-only per Sprint 8 tech debt (Voice-D8) — no banner needed for 2→3 transition.
- **Autosave pattern (Phase 02):** `useMandateAutoSave` hook + aria-live `MandateSaveStatus` — no toast dep. Phase 08 mirrors verbatim.
- **Expandable row pattern (Phase 01 + Phase 05):** inline expandable sub-row under a table/timeline row (Holdings outcome recording; Outcomes delta comparison) is the established pattern for "details inside a list view."
- **Symbol form (Phase 06 D-16):** CCXT-stripped (e.g. `BTCUSDT` for derivatives, `BTC` for spot) + `holding_type` ∈ `spot`/`derivative` as the disambiguator. Holding note scope_ref uses this form directly.

</prior_decisions_inherited>

<decisions>
## Implementation Decisions

### Connection surface + Disconnect flow (MANAGE-01 / MANAGE-02 / MANAGE-03)

- **D-01: Canonical surface = `/profile?tab=exchanges`.** MANAGE-01's literal `/connections` wording is obsolete (Phase 06 UAT retired the route). Phase 08 enhances `AllocatorExchangeManager.tsx` in place. REQUIREMENTS.md MANAGE-01/02/03 get a one-line update at phase commit to reflect the actual surface. No new route, no alias, no page shell duplication.

- **D-02: Rename "Remove key" → "Disconnect" with cascade checkbox.** Single destructive action on the key row. Modal shows:
  - Primary copy: "Disconnect {venue}?"
  - Explainer: "We'll stop syncing this key. Your historical holdings stay available for audit and are reflected in past performance."
  - Checkbox (**default UNCHECKED**): "Also delete historical holdings from this key"
  - Checked → passes `p_cascade_holdings=true` to `delete_allocator_api_key` (migration 069). Unchecked → `p_cascade_holdings=false` (retain rows).
  - Destructive-red button: "Disconnect"
  - Zero new backend. No new RPC. No migration.

- **D-03: User-initiated soft Revoke is NOT shipping.** The `revoked` sync_status is exchange-initiated only (worker observes 401/permission → stamps `revoked`). A separate soft-revoke action (keep-key, stop-sync, mark-stale) is deferred. Rationale: shipped Phase 06 flow covers the institutional need via Disconnect; adding a third action (Sync now / Disconnect / Revoke) is one affordance too many for v0.15.

- **D-04: Revoked-key holdings are always part of historical performance.** Holdings rows from a key whose current `sync_status='revoked'` (whether exchange-auto-revoked or user-disconnected-without-cascade) stay in `allocator_holdings` permanently. ALL historical computations — KPI backward-looking windows (30/90/180d realized return), equity curve reconstruction, drawdown chart, realized-delta cron, Bridge outcome attribution — include these rows without exception. This is "historic representation of actual performance" per user vision.

- **D-05: Revoked-key holdings UI = strikethrough + amber chip + current-view toggle.**
  - Holdings-table row renders with `line-through` on numeric columns + amber "Key revoked" chip adjacent to the venue cell.
  - Page-level toggle (top of holdings table): "Show revoked-key holdings" — **default ON**.
  - Toggle affects CURRENT-view holdings-table rendering only. Does NOT affect KPIs, equity curve, drawdown, or any historical metric (per D-04).
  - Toggle state persists to `localStorage` (key `allocations.showRevokedHoldings`). No DB state.
  - If an allocator toggles OFF: revoked rows hidden, but a muted footer line shows "{N} holdings hidden from revoked keys · [Show all]".

- **D-06: Phase 08 does not extend the exchange manager beyond D-02 + D-05.** No connection-health summary card, no per-key rename, no label field, no "sync all" button. Pure Disconnect UX + revoked-holdings UI + full notes work.

### Notes schema (MANAGE-04)

- **D-07: Reshape `user_notes` via new migration 071.**
  - Add: `scope_kind TEXT NOT NULL CHECK (scope_kind IN ('portfolio','holding','bridge_outcome','strategy'))` + `scope_ref TEXT NOT NULL`.
  - Replace the two existing partial unique indexes with a single `UNIQUE (user_id, scope_kind, scope_ref)`.
  - Data-migrate existing rows:
    - `portfolio_id IS NOT NULL` → `scope_kind='portfolio'`, `scope_ref = portfolio_id::text`
    - `portfolio_id IS NULL` (the Sprint-3 "global" note) → migrate to `scope_kind='portfolio'`, `scope_ref='global'` (preserves data; the literal "global" string is reserved). Planner verifies whether any such rows exist in production; if zero, drop them outright.
  - Drop the `portfolio_id UUID` column after migration (no back-compat need — `/api/notes` is the only consumer and Phase 08 rewrites it).
  - Update GDPR manifest `src/lib/gdpr-export.ts`: `user_notes` entry stays `{ kind: "direct", table: "user_notes", user_column: "user_id" }` (columns list isn't enumerated there; verify during planning).

- **D-08: Scope_ref formats (stringified, no typed FK):**
  - `portfolio` → `portfolios.id` UUID as text
  - `holding` → `{venue}:{symbol}:{holding_type}` (e.g. `binance:BTC:spot`, `okx:BTC/USDT:USDT:derivative`) using the CCXT-stripped symbol form from Phase 06 D-16
  - `bridge_outcome` → `bridge_outcomes.id` UUID as text
  - `strategy` → `match_strategies.id` UUID as text (or `verified_strategies.id` — planner confirms which is the public identity during research)

- **D-09: App-layer ownership checks in `/api/notes` PATCH** (not a SECURITY DEFINER RPC). Per `scope_kind`:
  - `portfolio` → verify `portfolios.user_id = auth.uid()` (existing check, extend to multi-scope shape)
  - `holding` → verify at least one `allocator_holdings` row exists with `allocator_id = auth.uid()` matching the venue/symbol/holding_type parts of scope_ref (parses `{venue}:{symbol}:{holding_type}`)
  - `bridge_outcome` → verify `bridge_outcomes.allocator_id = auth.uid()`
  - `strategy` → accept any strategy_id in the public identity table (all verified strategies are publicly notable for allocators)
  - On mismatch: 403, no audit event emitted.

- **D-10: One note per (user_id, scope_kind, scope_ref).** Enforced by the new unique index; route does ON-CONFLICT upsert. No append-only history table, no multi-note threads, no version rows.

### Content + Rendering (MANAGE-04 / MANAGE-06)

- **D-11: Storage = plain text. Render = markdown (read-only).** No storage format change required. New deps added to `package.json`:
  - `react-markdown` (latest stable)
  - `rehype-sanitize` (latest stable)
  - `remark-gfm` (latest stable — tables, strikethrough, task lists)
  - Edit surface = plain `<textarea>` with monospace font; render surface = `<Markdown>` component (single shared helper under `src/components/notes/NoteRender.tsx`).

- **D-12: 100KB per-note cap retained.** Migration 037's `CHECK (char_length(content) <= 100000)` persists through the 071 reshape. Byte-length validated server-side (`new TextEncoder().encode(content).length`). Unified across all 4 scopes.

- **D-13: Sanitization via `rehype-sanitize` default schema.** Allow: headings (h1-h6), paragraphs, lists, bold, italic, code blocks, inline code, blockquotes, hr, tables (GFM), `<a href>` where href matches `^https?://`, `<strike>`/`<del>`. Disallow: `<script>`, `<iframe>`, `<img>`, event handlers (`on*`), `javascript:` URLs, inline `style`. At render time, all `<a>` tags get `rel="noopener noreferrer"` + `target="_blank"` applied via rehype plugin or component override.

- **D-14: Owner-only visibility. No admin tier.** RLS on `user_notes` stays `user_id = auth.uid()` across SELECT/INSERT/UPDATE/DELETE. Notes are private to the author — admin support tooling does not read notes (contrast with `allocator_holdings` / `bridge_outcomes` which admin CAN read). Rationale: institutional confidentiality expectation + smallest surface.

### Note UI surfaces (MANAGE-05 / MANAGE-06)

- **D-15: Portfolio note = NotesWidget in react-grid-layout on Performance tab.**
  - Existing `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` UPGRADES in place:
    - Fetches with `scope_kind=portfolio` + `scope_ref=<portfolio.id>` instead of the legacy `portfolio_id` query param.
    - Renders markdown via `NoteRender.tsx` when not editing; textarea when editing.
    - Switches from 1s-debounce to on-blur autosave (D-19).
  - Widget does NOT appear on the Scenario tab stub (Phase 07 D-06).
  - `LAYOUT_VERSION` bumps `2 → 3` if the default layout changes the widget's default position/size; if the existing layout entry for the Notes widget id is preserved as-is, LAYOUT_VERSION stays at 2 (planner confirms during planning). Per Phase 05 tech debt, any bump is localStorage-only — no user-facing banner.

- **D-16: Holding note = inline expandable sub-row on the holdings table.**
  - Each holdings row gains a small note icon in a new leading (or trailing — planner picks by design review) column: outlined when empty, solid when a note exists, amber-tinted when the holding is from a revoked key.
  - Click expands a sub-row beneath the holding (pattern matches Phase 01's inline `BridgeOutcomeBanner` / `AllocatedForm` expansion under a Holdings row).
  - Expanded content: rendered markdown + "Edit" affordance → textarea with on-blur save + aria-live status.
  - Collapsed row shows no preview (keeps table density).
  - scope_ref derived from the row's `{venue, symbol, holding_type}` — aggregated across daily `asof` rows (a note on "BTC spot at Binance" persists across every day's ingestion).

- **D-17: Bridge-outcome note = expandable inside OutcomesWidget timeline row.**
  - Extends the existing expandable delta-comparison affordance in `OutcomesWidget.tsx` (Phase 05 D-01). Adds a Notes section below (or beside) the delta-comparison panel inside the same expanded state.
  - scope_ref = `bridge_outcomes.id` UUID.

- **D-18: Strategy note = right-rail card on `/strategy/[id]` factsheet.**
  - New `StrategyNoteCard.tsx` in the factsheet page shell, positioned as a right-rail card (or below the KPI strip if no right rail exists — planner confirms from the page layout during research).
  - On `/discovery` cards: note-indicator icon only (no preview). Click routes to `/strategy/[id]` where the full note is editable.
  - scope_ref = `match_strategies.id` (or `verified_strategies.id` — planner confirms which identity the URL param maps to).

- **D-19: On-blur autosave across all four surfaces.** New shared hook `src/components/notes/useNoteAutoSave.ts` that mirrors `useMandateAutoSave` contract:
  - `save(content)` fires on textarea blur (not on every keystroke).
  - Returns `{ state: 'idle' | 'saving' | 'saved' | 'error', lastSavedAt }` for the aria-live status component.
  - New shared component `src/components/notes/NoteSaveStatus.tsx` mirrors `MandateSaveStatus` layout/copy.
  - Upgrade existing `NotesWidget.tsx` off the Sprint 3 `setTimeout` debounce; unit tests gain an on-blur assertion.
  - No toast library dependency.

### Audit taxonomy (MANAGE-06)

- **D-20: New audit-event kinds.** Four new actions added to `docs/architecture/adr-0023-audit-event-taxonomy.md` (ADR sync in the same commit as migration 071 + `/api/notes` rewrite):
  - `user_note.portfolio.update` (**replaces** existing `portfolio_note.update` from Sprint 3 — rename is a breaking log-schema change; verify no dashboards depend on the old string before renaming)
  - `user_note.holding.update`
  - `user_note.bridge_outcome.update`
  - `user_note.strategy.update`
  - `entity_type = "user_note"` across all four; `entity_id` = synthetic `{scope_kind}:{scope_ref}` string (not a UUID — the table row's surrogate id is unstable across upserts).
  - `metadata = { scope_kind, scope_ref, content_length }` — no content echo.

- **D-21: Audit fires on every successful PATCH.** Even if the content is unchanged from the last save (consistent with existing `portfolio_note.update` behavior — a save event counts regardless of diff).

### Migration ordering + plan hint

- **D-22: Single new migration `071_user_notes_multiscope.sql`:**
  - Step 1: add `scope_kind` + `scope_ref` columns (NULLABLE initially), backfill existing rows, add NOT NULL + CHECK constraints.
  - Step 2: drop old partial unique indexes (`user_notes_unique_per_portfolio`, `user_notes_unique_global`), add new `UNIQUE (user_id, scope_kind, scope_ref)`.
  - Step 3: drop `portfolio_id UUID` column.
  - Step 4: self-verifying DO block asserts: schema present, index exists, RLS still enabled + policies still in place.
  - RLS policies unchanged — `user_id = auth.uid()` across SELECT/INSERT/UPDATE/DELETE (migration 037 policies survive).

- **D-23: Audit ADR-0023 sync** lands in the same git commit as `/api/notes` rewrite (MANAGE-06 requirement).

- **D-24: Expected plan count (planner decides final grain) — indicative:**
  - Plan 1: Migration 071 + `/api/notes` scope extension + ADR-0023 taxonomy sync + RLS regression test (multi-scope leakage probe)
  - Plan 2: `NoteRender.tsx` + `useNoteAutoSave.ts` + `NoteSaveStatus.tsx` shared components + NotesWidget.tsx upgrade (portfolio scope) + integration test
  - Plan 3: Holding-scope inline expandable + bridge_outcome-scope expandable + strategy-scope card (per-scope UI surfaces)
  - Plan 4: Disconnect rename + cascade-checkbox modal + revoked-holdings strikethrough/chip/toggle UI + `localStorage` persistence + tests
  - Planner may re-partition (e.g. split Plan 3 by scope if tests balloon, or fold Plan 4 before Plan 2 if Disconnect gates the notes UI work).

### Claude's Discretion

- **Exact react-markdown / rehype-sanitize / remark-gfm version pins** — researcher picks latest stable compatible with React 19 / Next.js 16.
- **Icon glyphs** for note-indicator (outlined/solid) — follow DESIGN.md iconography; default to the design-system sticky-note or chat-bubble glyph.
- **Precise sanitizer allowlist copy** — use rehype-sanitize's `defaultSchema` extended with `remark-gfm`'s table/strikethrough nodes and the custom `<a>` rel/target rewrite.
- **Aria-live status message copy** ("Saving…" / "Saved 3s ago" / "Save failed — retry") — match `MandateSaveStatus.tsx` wording verbatim unless designers propose a copy refinement.
- **Default NotesWidget position/size** in `dashboard-defaults.ts` react-grid layout entry — planner chooses a sensible default (e.g. 4×4 at bottom).
- **Disconnect modal copy** — copy-reviewer can refine; keep the institutional tone shipped in Phase 06's existing Remove-key modal.
- **Holding-row note-icon column placement** (leading vs trailing) — planner picks after design review of the current holdings-table layout.
- **Whether the Sprint-3 global note (portfolio_id IS NULL) rows exist in prod** — researcher runs a `SELECT count(*) FROM user_notes WHERE portfolio_id IS NULL` against the live DB; if zero, drop them outright during migration 071 instead of keeping the `scope_ref='global'` sentinel.
- **Whether to bump LAYOUT_VERSION** (2→3) or preserve it — depends on whether the NotesWidget default position/size changes in `dashboard-defaults.ts`. If no change, LAYOUT_VERSION stays.

### Folded Todos

None — no pending todos matched this phase's scope (no `gsd-sdk query todo.match-phase` matches surfaced).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase charter + requirements
- `.planning/ROADMAP.md` §Phase 08 — Goal, Depends-on, Requirements (MANAGE-01…MANAGE-06), Success Criteria
- `.planning/REQUIREMENTS.md` §MANAGE-01…MANAGE-06 — line-item acceptance criteria (note: MANAGE-01/02/03 text to update per D-01)
- `.planning/PROJECT.md` — milestone goal (Demo-to-Production), constraint + decision tables, institutional-tone guardrails
- `.planning/STATE.md` — current position (Phase 07 verifier PASS, awaiting ship)

### Design + repo guardrails
- `DESIGN.md` — DM Sans / Geist Mono, 1px borders, 8px radius, institutional minimalist palette (required before any UI decision per CLAUDE.md)
- `AGENTS.md` — "This is NOT the Next.js you know": read `node_modules/next/dist/docs/` before writing App Router code
- `CLAUDE.md` — project guardrails (Simplicity First, Root-Cause Obsession, Banned Packages including `axios`)

### Prior-phase context (inherited decisions)
- `.planning/phases/06-allocator-api-ingestion/06-CONTEXT.md` — `api_keys.sync_status` taxonomy (D-07), `allocator_holdings` schema (D-02), Remove-key + delete RPC IA (post-UAT), symbol-form convention (D-16)
- `.planning/phases/07-demo-mode-purge/07-CONTEXT.md` — `/allocations?tab=performance|scenario` IA (D-04), staleness semantics (D-10/D-11), EmptyState → `/profile?tab=exchanges` routing (D-07), "Phase 08 charter revisit" deferred idea
- `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` — react-grid widget pattern (single-file + `LAYOUT_VERSION` localStorage-only)
- `.planning/phases/02-mandate-profile-builder/02-CONTEXT.md` — on-blur autosave + aria-live `MandateSaveStatus` no-toast precedent
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — inline expandable sub-row pattern under a list row (Bridge outcome banner + forms)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — route group layout, widget registry shape
- `.planning/codebase/CONVENTIONS.md` — audit-log call sites, RLS policy style
- `.planning/codebase/TESTING.md` — Vitest multi-actor RLS helper pattern, pytest fixtures
- `.planning/codebase/CONCERNS.md` — `compute_jobs` RLS wide-open (unrelated), LAYOUT_VERSION tech-debt note

### Schema + backend (current state this phase extends)
- `supabase/migrations/037_user_notes.sql` — existing portfolio-scope table + RLS + triggers (migration 071 reshapes this)
- `supabase/migrations/069_delete_allocator_api_key_rpc.sql` — `delete_allocator_api_key(p_api_key_id, p_cascade_holdings)` RPC (reused verbatim by Disconnect)
- `supabase/migrations/059_bridge_outcomes.sql` — `bridge_outcomes` table shape (scope_ref target for bridge_outcome scope)
- `supabase/migrations/066_allocator_holdings.sql` — `allocator_holdings` unique key `(allocator_id, venue, symbol, asof)` (scope_ref parsing target for holding scope)

### Audit taxonomy
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — sync four new `user_note.*.update` kinds in the same commit as migration 071 (D-20)

### Existing surfaces to modify
- `src/components/exchanges/AllocatorExchangeManager.tsx` — rename Remove → Disconnect, add cascade checkbox; preserve the existing 7-state pill, Sync-now button, 5s polling
- `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` — upgrade in place: multi-scope fetch shape, on-blur save, markdown render
- `src/app/api/notes/route.ts` — rewrite GET/PATCH for `{scope_kind, scope_ref}` query + body shape with per-scope ownership checks
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx` — host the revoked-holdings toggle + pass props to the holdings table
- `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` — `LAYOUT_VERSION` + react-grid default layout (possibly unchanged)
- `src/app/(dashboard)/allocations/lib/widget-registry.ts` — widget registry entry for NotesWidget (likely already present)
- `src/app/strategy/[id]/` — factsheet page (new StrategyNoteCard; path confirmed during research)
- `src/lib/gdpr-export.ts` — `user_notes` manifest entry verification post-reshape

### Existing surfaces to extend (pattern reuse only)
- `src/components/mandate/useMandateAutoSave.ts` — clone contract for `useNoteAutoSave`
- `src/components/mandate/MandateSaveStatus.tsx` — clone layout/copy for `NoteSaveStatus`
- `src/components/mandate/MandateForm.tsx` — on-blur trigger reference
- Phase 05 `OutcomesWidget.tsx` — expandable timeline-row affordance to extend for bridge_outcome notes

### Test-pattern references
- `src/app/api/notes/route.test.ts` — existing tests to extend for multi-scope
- `src/__tests__/audit-fanout-integration.test.ts` — audit-event multi-write integration pattern
- `src/__tests__/gdpr-export-coverage-hook.test.ts` — GDPR manifest coverage hook (verifies `user_notes` stays in manifest post-reshape)
- `src/__tests__/allocator-holdings-rls.test.ts` (Phase 06) — two-user multi-actor RLS regression shape to mirror for multi-scope notes leakage probe

### New deps to add
- `react-markdown` (latest stable)
- `rehype-sanitize` (latest stable)
- `remark-gfm` (latest stable)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- **`AllocatorExchangeManager.tsx`** — ships 7-state pill, Sync-now button, 5s `router.refresh()` polling, existing Remove-key modal. Rename + cascade checkbox is a surgical diff, not a rewrite.
- **`delete_allocator_api_key` RPC (migration 069)** — already accepts `p_cascade_holdings BOOLEAN`. Disconnect UX maps checkbox → RPC parameter 1:1. No new SQL.
- **`user_notes` table (migration 037)** — table + owner-RLS + updated_at trigger + GDPR manifest entry already exist. Migration 071 is a reshape, not a create.
- **`NotesWidget.tsx`** — portfolio-scope widget exists; upgrade in place for multi-scope + markdown + on-blur.
- **`useMandateAutoSave` / `MandateSaveStatus`** — on-blur autosave + aria-live hook + component pair. Clone into `useNoteAutoSave` / `NoteSaveStatus` under `src/components/notes/`.
- **Expandable sub-row pattern (Phase 01 BridgeOutcomeBanner, Phase 05 OutcomesWidget)** — proven for inline-detail UX; holding + bridge_outcome notes reuse the same affordance.
- **`logAuditEvent` helper (`src/lib/audit.ts`)** — already used by existing `/api/notes` route for `portfolio_note.update`. Rename + extend to four kinds.

### Established patterns
- **Three-tier RLS** (owner + admin + service_role) is standard (migrations 059/061/066/070). Phase 08 notes DEVIATE by dropping the admin tier — owner-only per D-14 for institutional privacy.
- **Migration self-verifying DO block** — every migration ends with a `DO $$` block asserting schema invariants + RLS + trigger presence. Migration 071 follows suit.
- **Vitest multi-actor RLS regression** — `src/lib/test-helpers/` has two-user harness (see Phase 06's `allocator-holdings-rls.test.ts`); mirror for four-scope note leakage probe.
- **`log_audit_event` + ADR-0023 same-commit sync** — any taxonomy addition lands in the same git commit that emits the new event (Phase 03 + 04 + 06 precedent).
- **On-blur autosave + aria-live status + no toast lib** — institutional-tone pattern shipped in Phase 02; Phase 08 adopts verbatim.

### Integration points
- **`/profile?tab=exchanges`** — page already exists; `AllocatorExchangeManager` already mounted there. Disconnect + cascade-checkbox modal is an in-place component edit.
- **`/allocations?tab=performance`** — NotesWidget mounts in the existing react-grid. No tab-shell change.
- **Holdings table** (inside AllocationDashboard render tree) — scope_ref constructor for note icon lives with the row render; toggle state hoisted to page-level.
- **OutcomesWidget timeline** — expandable state already present; add Notes section below delta-comparison panel.
- **`/strategy/[id]`** — factsheet page shell exists (factsheet + preview component shipped v0.5.2.0). New StrategyNoteCard is a sibling component slot.
- **GDPR export** (`src/lib/gdpr-export.ts`) — `user_notes` entry already present; coverage-hook test will fail loudly if the table reshape drops it.

</code_context>

<specifics>
## User vision / specific asks

- **"Historic representation of actual performance"** (verbatim, user notes on stale-UI question): revoked-key holdings are real history. KPIs / equity curve / drawdown ALWAYS include them; the holdings-table toggle is purely a current-view clutter control, NEVER a KPI/chart filter. Captured in D-04/D-05.
- **Surface consolidation preference** — user chose "Stay at /profile?tab=exchanges" over resurrecting /connections. Institutional minimalism + zero route churn. Captured in D-01.
- **Single-action Disconnect** — user chose "Rename Delete → Disconnect with cascade checkbox" over adding a separate user-revoke action. One destructive affordance is cleaner for allocator UX. Captured in D-02.
- **Phase-scope minimalism** — user chose "Minimal: just revoke/stale UI + notes" over adding connection-health card or per-key rename. Keep phase tight. Captured in D-06.
- **Notes UX follows established patterns** — recommended defaults taken for every notes question (scope_kind+scope_ref storage, (venue,symbol,holding_type) holding identity, app-layer ownership, one-note-per-scope, markdown render-on-read, 100KB cap, rehype-sanitize default, owner-only RLS, widget-in-react-grid, inline expandable rows, on-blur autosave). Signal: user trusts the "match the shipped institutional patterns" recommendation across the board.

</specifics>

<deferred>
## Deferred Ideas

### Not shipping in Phase 08
- **User-initiated soft Revoke** (distinct from Disconnect) — deferred. If LP feedback requests it, revisit post-v0.15 or as a Phase 11 polish item.
- **Per-key rename / label column** (`api_keys.label TEXT`) — new capability, belongs in backlog.
- **Connection-health summary card** ("2 keys connected, 1 stale, 0 revoked · Sync all") — nice polish; Phase 11 onboarding candidate.
- **/notes index page / journal UX** — deferred post-v0.15 if allocators report needing cross-scope note browsing.
- **Multi-note threads per scope** — institutional convention is one live note per target; deferred unless LP feedback demands chronological history.
- **Append-only user_notes_history table** — undo/version-history; deferred.
- **Admin-readable notes (three-tier RLS)** — rejected for institutional privacy; revisit only if support tooling needs it.
- **Per-scope note size caps** (10KB holding/outcome, 100KB portfolio) — unified 100KB is fine; revisit if any LP hits the cap.
- **Full rich-text (TipTap) editor** — rejected (CEO review D.5 in migration 037 comment); markdown render-on-read is sufficient.
- **Image/iframe allowed in markdown** — rejected (security + tracking-pixel surface).

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 08-connection-management-and-notes*
*Context gathered: 2026-04-21*
