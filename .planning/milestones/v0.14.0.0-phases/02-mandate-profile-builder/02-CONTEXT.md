# Phase 2: Mandate Profile Builder - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Allocators self-serve their full mandate profile (`max_weight`, `preferred_strategy_types`, `excluded_exchanges`, plus Advanced: `correlation_ceiling`, `risk_budget`, `liquidity_preference`, `style_exclusions`) via a single auto-save form. All allocator writes route through `update_allocator_mandates(...)` SECURITY DEFINER RPC scoped to `auth.uid()`. Direct UPDATE on `allocator_preferences` remains admin-only. The existing `/preferences` route is replaced by the new MandateForm — `mandate_archetype` and `target_ticket_size_usd` migrate into the same surface. Every write (allocator or admin) is audit-logged via `log_audit_event` with `entity_type = 'allocator_preference_mandate'`. `ALLOCATOR_PREFERENCES_COLUMNS` in `src/lib/admin/match.ts` stays in schema-sync.

Scope is end-to-end for Phase 2: migration (new columns + `mandate_edited_at`) + `update_allocator_mandates` RPC + replace `PreferenceForm.tsx` with `MandateForm` (Basic + Advanced) + auto-save + "Last saved" indicator + per-field Reset + admin PreferencesPanel parity update + smoke test + audit integration.

</domain>

<decisions>
## Implementation Decisions

### Route + /preferences Reconciliation
- **D-01:** MandateForm **replaces** the existing `/preferences` page content. Route path stays at `/preferences`. Page title and copy update to "My Allocation Settings" (per MANDATE-01 language). No new route introduced.
- **D-02:** `excluded_exchanges` moves into MandateForm (single source of truth). The legacy `PreferenceForm.tsx` is deleted; its three fields (`mandate_archetype`, `target_ticket_size_usd`, `excluded_exchanges`) migrate into the new form.
- **D-03:** `preferred_strategy_types` is promoted from admin-only → self-editable via RPC. `SELF_EDITABLE_PREFERENCE_FIELDS` in `src/lib/preferences.ts` extends accordingly; admin retains direct-UPDATE write path (see D-10).

### Mandate Column Taxonomy
- **D-04:** `style_exclusions` column = `text[]`, values drawn from existing `SUBTYPES` constant in `src/lib/constants.ts` (Trend Following, Momentum, Breakout, Mean Reversion, Statistical Arbitrage, Market Making, Basis Trading, Funding Rate). Rendered as multi-select chips. No new enum.
- **D-05:** `liquidity_preference` column = `text` with CHECK constraint `IN ('high','medium','low')` (NULL allowed). Semantic mapping used by Phase 3 scoring engine:
  - `high` → strategy AUM > $10M
  - `medium` → strategy AUM $1M–$10M
  - `low` → strategy AUM < $1M
  - Join key is `strategy_factsheets.aum_usd` (or equivalent existing AUM field — planner to confirm during research).
- **D-06:** `risk_budget` column = `numeric` (max drawdown tolerance, 0–1 fraction). Semantically identical to existing `max_drawdown_tolerance`. Planner's choice: reuse `max_drawdown_tolerance` or add `risk_budget` as a new column + alias. Prefer reuse to avoid column duplication; rename UI label only.
- **D-07:** `correlation_ceiling` column = `numeric` (0–1, default 0.6 per MANDATE-03; NULL = no constraint). `max_weight` = `numeric` (0–1, 0.05–0.50 bounds, NULL = no constraint) — column already exists from Phase 1 D-09 wiring; confirm in migration.
- **D-08:** `mandate_edited_at` column = `timestamptz`, updated on every allocator-initiated mandate write. Separate from generic `updated_at` so admin edits don't bump the allocator-facing "Last saved" timestamp.

### Empty + Clear Semantics
- **D-09:** First-visit render: all mandate fields **blank / NULL**. No default pre-fill. Saving an untouched field persists NULL → Phase 3 `score_candidates()` returns `mandate_fit_score = 1.0` (SCORING-04 graceful fallback).
- **D-10:** Clearing a previously-set field is **allowed**: writes NULL via RPC, reverts to "no constraint". Symmetrical with D-09. `needs_recompute`-style flag on `match_batches` or cache-invalidation via `mandate_edited_at` ensures downstream scoring picks up the cleared state.
- **D-11:** Per-field **Reset** affordance — small `Reset` link next to each field label. Clicking sets the field to NULL (empty) and triggers the same auto-save path. Visual treatment minimal (text-size xs, muted color) per DESIGN.md minimalism. No confirmation modal.

### Admin PreferencesPanel Reconciliation
- **D-12:** Admin retains **direct UPDATE** write path via existing `/api/admin/match/preferences/[allocator_id]/route.ts`. Allocator writes exclusively via `update_allocator_mandates` RPC. Both paths call `log_audit_event` with `entity_type = 'allocator_preference_mandate'`. `pickAdminEditableFields` in `src/lib/preferences.ts` expands to include all new mandate columns.
- **D-13:** Admin `PreferencesPanel.tsx` gains UI controls for new mandate fields: `correlation_ceiling`, `risk_budget` (or `max_drawdown_tolerance` repurposed per D-06), `liquidity_preference`, `style_exclusions`, `max_weight`. Same taxonomy as allocator-facing form. Admin panel is authoritative on schema: the `ALLOCATOR_PREFERENCES_COLUMNS` const (`src/lib/admin/match.ts`) is the contract — MANDATE-07 smoke test asserts parity with `information_schema.columns`.
- **D-14:** Admin panel shows `Last edited by: allocator | admin [timestamp]` indicator, sourced from existing `edited_by_user_id` column + `mandate_edited_at` (or `updated_at` fallback). Allocator-facing form shows `Last saved: N min ago` using `mandate_edited_at` only. No admin-edit surfacing on the allocator form.

### Auto-Save Behavior (requirement-level — details Claude's Discretion)
- **D-15:** Auto-save trigger = **on blur per field** (MANDATE-04). Sliders save on thumb release. Chip multi-selects save on each toggle. No submit button. No debounced batch.
- **D-16:** Save feedback = toast ("Mandate saved") + "Last saved: N min ago" timestamp refresh. On RPC failure, inline field-level error + retry affordance; field value does not revert optimistically (keeps user input intact).

### Validation
- **D-17:** Validation rules (per-field bounds from REQUIREMENTS):
  - `max_weight`: 0.05–0.50 (5–50%)
  - `correlation_ceiling`: 0.0–1.0
  - `risk_budget` (or `max_drawdown_tolerance`): 0.0–1.0
  - `liquidity_preference`: one of `high | medium | low`
  - `style_exclusions`: subset of `SUBTYPES`
  - `preferred_strategy_types`: subset of `STRATEGY_TYPES`
  - `excluded_exchanges`: subset of `EXCHANGES`
  - `target_ticket_size_usd`: 0 – 1,000,000,000 (unchanged from `preferences.ts`)
  - `mandate_archetype`: ≤ 500 chars (unchanged)
- **D-18:** Validation lives in `src/lib/preferences.ts` (`validateSelfEditableInput`) — extended for new fields; RPC performs the same checks server-side. Out-of-range values from the client return structured errors; form surfaces inline per-field.

### Claude's Discretion
- Auto-save debounce granularity beyond D-15 (e.g., coalesce rapid slider drags)
- "Last saved: N min ago" format (relative vs absolute, refresh cadence)
- Basic vs Advanced split layout — requirements hint: Basic = `max_weight`, `preferred_strategy_types`, `excluded_exchanges`, `target_ticket_size_usd`, `mandate_archetype`; Advanced = `correlation_ceiling`, `risk_budget`, `liquidity_preference`, `style_exclusions`. Planner/UI-SPEC phase may refine.
- Component structure (single `MandateForm` vs composed `MandateBasicSection` + `MandateAdvancedAccordion`) — follow existing `(dashboard)` widget patterns
- Toast library — reuse whatever Phase 1's Bridge outcome flow uses (no new dependency)
- Error copy for RPC failures
- Slider, chip, accordion visual styling — must follow DESIGN.md; reuse existing `Button`, `Input`, `Textarea`, `Card` primitives
- Exact RPC signature: parameter names/types, return shape, error codes — follow `finalize_wizard_strategy` / `log_audit_event_service` conventions in supabase/migrations
- Whether to reuse `max_drawdown_tolerance` for `risk_budget` (D-06) or introduce a new alias column — planner picks the less-churn option
- Route guard / redirect if any other page links to the old `/preferences` content model

### Folded Todos
None — the cross-reference step found no pending repo-level TODOs relevant to Phase 2.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Sprint 8 vision; locked decisions (extend `allocator_preferences`, SECURITY DEFINER RPC, auto-save, `mandate_fit_score` composition)
- `.planning/REQUIREMENTS.md` — MANDATE-01 through MANDATE-08 (locked)
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, plan breakdown (02-01, 02-02)
- `DESIGN.md` — DM Sans body / Geist Mono numerics / 1px borders / 8px radius; all form styling must conform

### Architecture decision records
- `docs/architecture/adr-0001-rls-primary-authorization.md` — RLS as primary auth; SECURITY DEFINER RPC pattern for self-service writes
- `docs/architecture/adr-0004-mutation-api-contract.md` — API route shape for PUT/POST mutation endpoints
- `docs/architecture/adr-0005-admin-authorization.md` — admin role checks; admin write path
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — `entity_type` naming; Phase 2 uses `entity_type = 'allocator_preference_mandate'`
- `docs/architecture/adr-0018-error-handling.md` — structured error responses

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — app layering
- `.planning/codebase/STRUCTURE.md` — directory layout
- `.planning/codebase/CONVENTIONS.md` — code style
- `.planning/codebase/STACK.md` — Next.js 16 App Router + Supabase client patterns
- `.planning/codebase/TESTING.md` — unit + Playwright patterns
- `.planning/codebase/INTEGRATIONS.md` — external service touchpoints

### Existing self-edit surface (to replace)
- `src/app/(dashboard)/preferences/page.tsx` — existing preferences page; content replaced
- `src/components/preferences/PreferenceForm.tsx` — to be **deleted** after migration to `MandateForm`
- `src/app/api/preferences/route.ts` — existing PUT route; rewrites to call `update_allocator_mandates` RPC
- `src/lib/preferences.ts` — types + `SELF_EDITABLE_PREFERENCE_FIELDS` + `ADMIN_ONLY_PREFERENCE_FIELDS` + validation; extend for new columns
- `src/lib/preferences.test.ts` — validation test patterns to extend

### Admin surface (to extend with parity)
- `src/components/admin/PreferencesPanel.tsx` — admin edit UI; add controls for new mandate fields
- `src/app/api/admin/match/preferences/[allocator_id]/route.ts` — admin write path (direct UPDATE, keeps audit via `log_audit_event`)
- `src/lib/admin/match.ts` — `ALLOCATOR_PREFERENCES_COLUMNS` constant (MANDATE-07 smoke test target)

### SECURITY DEFINER RPC precedents
- `supabase/migrations/049_audit_log_hardening.sql` — `log_audit_event` signature
- `supabase/migrations/058_log_audit_event_service.sql` — service-role variant
- `supabase/migrations/031_wizard_source_column.sql` — wizard RPC pattern (reference shape)
- `supabase/migrations/011_perfect_match.sql` — original `allocator_preferences` table + RLS

### Enums
- `src/lib/constants.ts` — `STRATEGY_TYPES` (preferred_strategy_types source), `SUBTYPES` (style_exclusions source — D-04), `EXCHANGES` (excluded_exchanges source), `MARKETS`

### Phase 1 coupling
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — D-09 soft-warn on `max_weight` exceedance (no hard block)
- `supabase/migrations/059_bridge_outcomes.sql` — any `max_weight` references here should be cross-checked
- Existing Phase 1 E2E + unit test conventions (`HAS_SEEDED_SUPABASE` gating pattern)

### Phase 3 downstream consumer (read-only reference)
- `match_engine.py` (Python service) — will consume mandate columns from `allocator_preferences` row
- `match_batches.effective_preferences` JSONB — mandate snapshot at scoring time (per SCORING-06)
- Existing `ENGINE_VERSION = v1.0.0`; Phase 3 bumps to `v2.0.0`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Card`, `Button`, `Input`, `Textarea` primitives under `src/components/ui/` — base for Basic section
- `EXCHANGES`, `STRATEGY_TYPES`, `SUBTYPES` constants in `src/lib/constants.ts` — direct chip options
- `getOwnPreferences()` in `src/lib/preferences.ts` — already handles missing-row + missing-table graceful paths (keep the `PGRST205` fallback)
- `log_audit_event` SQL function — both allocator-RPC path and admin-UPDATE path call this; no new audit plumbing needed
- `DEFAULT_PREFERENCES` — expand to include new mandate defaults (for read-path fallbacks if needed; first-visit UI still shows blank per D-09)

### Established Patterns
- **Three-tier RLS** (owner-select / owner-insert / admin-select / service-role-all) — existing on `allocator_preferences` from migration 011; Phase 2 adds columns without touching policies
- **SECURITY DEFINER RPCs** for allocator writes (per adr-0001, adr-0005) — `update_allocator_mandates` follows the established pattern
- **Column whitelist pattern** (`SELF_EDITABLE_*` / `ADMIN_ONLY_*` arrays in `preferences.ts`) — extend to cover new fields
- **`ALLOCATOR_PREFERENCES_COLUMNS` schema-sync smoke test** — MANDATE-07 target; pattern already exists in preferences.test.ts
- **Audit-on-every-write** via `log_audit_event` — applies to both RPC (allocator) and UPDATE (admin) paths

### Integration Points
- **Migration file (next)**: `supabase/migrations/061_mandate_columns.sql` (or next number) — adds `correlation_ceiling`, `risk_budget` (if distinct from `max_drawdown_tolerance`), `liquidity_preference`, `style_exclusions`, `mandate_edited_at`; updates constraints; no new table
- **RPC**: `update_allocator_mandates(p_fields jsonb)` (or field-wise signature) SECURITY DEFINER on `auth.uid()`; writes to `allocator_preferences`; calls `log_audit_event` internally
- **API route**: `PUT /api/preferences` rewrites to call RPC; keeps endpoint URL for compatibility
- **Client component**: new `src/components/mandate/MandateForm.tsx` (or under `preferences/` — planner chooses) replaces `PreferenceForm.tsx`
- **Auto-save hook**: `src/components/mandate/useMandateAutoSave.ts` (new) or colocate in `MandateForm`
- **Admin panel**: extend `src/components/admin/PreferencesPanel.tsx` with new field controls
- **Column contract**: update `ALLOCATOR_PREFERENCES_COLUMNS` in `src/lib/admin/match.ts`; update TypeScript `AllocatorPreferences` in `src/lib/preferences.ts`; update tests
- **Page copy**: `src/app/(dashboard)/preferences/page.tsx` — update `PageHeader` title/description to "My Allocation Settings"

### Schema Sync Contract
- `information_schema.columns` for `allocator_preferences` ⇄ `ALLOCATOR_PREFERENCES_COLUMNS` (smoke test per MANDATE-07)
- `AllocatorPreferences` TS interface ⇄ `ALLOCATOR_PREFERENCES_COLUMNS` (human-maintained)
- `SELF_EDITABLE_PREFERENCE_FIELDS` + `ADMIN_ONLY_PREFERENCE_FIELDS` ⇄ actual column set

</code_context>

<specifics>
## Specific Ideas

- Auto-save UX language: toast copy "Mandate saved" (MANDATE-04); timestamp "Last saved: 2 min ago" is the target UX shape
- Reset link copy: simply `Reset` next to field label; muted color, no underline by default
- Page title on `/preferences`: update to "My Allocation Settings" — matches MANDATE-01 verbiage without introducing a new route
- RPC parameter naming: follow existing convention (`p_user_id` / `p_max_weight` / `p_correlation_ceiling` / `p_style_exclusions` / ...) — reject unknown keys to keep the RPC a tight contract
- Liquidity mapping (D-05) is a **scoring-engine concern** — mandate form surfaces the enum only; the AUM threshold mapping lives in Phase 3's `compute_mandate_fit_score()`. Document the mapping in the migration comment + in `docs/runbooks/match-engine.md` follow-up

</specifics>

<deferred>
## Deferred Ideas

- Onboarding nudge / first-visit banner ("Tell us about your mandate to unlock better recommendations") — could land in Phase 5 Outcomes Dashboard empty-state or as a standalone polish PR; out of Phase 2 scope
- Field-level history / audit timeline UI — Phase 2 surfaces only "last edited by + when"; rich timeline is a future admin feature
- Cross-field validation (e.g., warn if `max_weight` × portfolio_size < target_ticket_size) — simple bounds only for v1
- Bulk import of mandate from CSV / legacy system — not in scope; allocator fills manually
- Admin "impersonate allocator" write path (Option C from discuss) — rejected in favor of admin direct UPDATE; revisit only if audit pressure demands single write path
- Cross-field invariants checked in migration CHECK constraints vs application-layer only — planner's call; lean toward app-layer for easier iteration
- Coarser `style_categories` taxonomy (Directional / Systematic / Neutral / Event-driven) — rejected in favor of reusing existing `SUBTYPES`; revisit if allocator feedback shows the fine-grained list is overwhelming
- Per-field admin override lock ("admin set this, allocator cannot change") — rejected; allocator always wins on their own fields; admin edits are support-tool only

### Reviewed Todos (not folded)
None — `list-todos` returned `count: 0`. No repo-level pending items to defer.

</deferred>

---

*Phase: 02-mandate-profile-builder*
*Context gathered: 2026-04-18*
