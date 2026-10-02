# Phase 2: Mandate Profile Builder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 02-mandate-profile-builder
**Areas discussed:** Route + /preferences reconciliation, Style + liquidity taxonomy, NULL vs default semantics, Admin PreferencesPanel reconciliation

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Route + /preferences reconciliation | Where MandateForm lives vs existing /preferences | ✓ |
| Style + liquidity taxonomy | Enum values for style_exclusions + liquidity tier mapping | ✓ |
| NULL vs default semantics | First-visit blank vs pre-filled defaults | ✓ |
| Admin PreferencesPanel reconciliation | Admin write path + field visibility after self-edit opens | ✓ |

**User's choice:** All four areas

---

## Route + /preferences reconciliation

### Q1: Where should the MandateForm live?

| Option | Description | Selected |
|--------|-------------|----------|
| /allocations/settings (new) | New route under My Allocation. /preferences stays as-is. (Recommended.) | |
| Replace /preferences entirely | New MandateForm replaces existing content at /preferences. Migrate mandate_archetype + ticket_size in. | ✓ |
| Tab within existing /preferences | Keep route; add 'Mandate' tab alongside existing section. | |

**User's choice:** Replace /preferences entirely
**Notes:** Route path stays at `/preferences`; page content swapped. Page title/copy updates to "My Allocation Settings" per MANDATE-01.

### Q2: How should excluded_exchanges be handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Move to MandateForm; remove from /preferences legacy | Single source of truth. (Recommended.) | ✓ |
| Mirror in both places | Dual-edit, same column. | |
| Keep only on /preferences | Mandate form skips it. | |

**User's choice:** Move to MandateForm; remove from /preferences
**Notes:** Since /preferences is being replaced, excluded_exchanges naturally consolidates in MandateForm.

### Q3: What about preferred_strategy_types (admin-only today)?

| Option | Description | Selected |
|--------|-------------|----------|
| Promote to self-editable in MandateForm | Via RPC. Admin retains direct UPDATE. (Recommended.) | ✓ |
| Keep admin-only; allocator sees read-only | Less self-service. | |

**User's choice:** Promote to self-editable in MandateForm
**Notes:** SELF_EDITABLE_PREFERENCE_FIELDS in preferences.ts extends to include preferred_strategy_types.

---

## Style + liquidity taxonomy

### Q1: What values populate 'style exclusions'?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse SUBTYPES constant | 8 values: Trend Following, Momentum, Breakout, Mean Reversion, Statistical Arbitrage, Market Making, Basis Trading, Funding Rate. (Recommended.) | ✓ |
| Curated subset of SUBTYPES | 4-5 most meaningful. | |
| New style_categories enum | Coarser taxonomy (Directional/Systematic/Neutral/Event-driven). | |

**User's choice:** Reuse SUBTYPES constant
**Notes:** No new enum. Consistent with existing strategy classification.

### Q2: What does each liquidity tier mean?

| Option | Description | Selected |
|--------|-------------|----------|
| Mapped to strategy AUM thresholds | High >$10M, Medium $1M–10M, Low <$1M. (Recommended.) | ✓ |
| Mapped to average daily volume (ADV) | Needs ADV computation; may not exist yet. | |
| Human-curated tag on each strategy | Quants self-declare tier; trust-dependent. | |

**User's choice:** Mapped to strategy AUM thresholds
**Notes:** Uses existing data; Phase 3 scoring joins on strategy AUM column. Mapping documented in migration comment and runbook.

### Q3: Is there a sensible default Basic vs Advanced split?

| Option | Description | Selected |
|--------|-------------|----------|
| Requirements-spec split | Basic: max_weight + preferred_types + excluded_exchanges. Advanced: correlation + risk_budget + liquidity + style_exclusions. (Recommended.) | |
| Claude's discretion — UI agent decides | Leave split to UI-SPEC / planner. | ✓ |

**User's choice:** Claude's discretion — UI agent decides
**Notes:** Requirements hint at the split but UI phase refines.

---

## NULL vs default semantics

### Q1: First-visit rendering?

| Option | Description | Selected |
|--------|-------------|----------|
| Blank / unset (NULL) | Saving untouched field persists NULL → mandate_fit=1.0 (SCORING-04 graceful). (Recommended.) | ✓ |
| Pre-filled with defaults, explicit lock-in | User must confirm/Save; until saved, all NULL in DB. | |
| Pre-filled with defaults, auto-saved on first view | Every allocator ends up non-NULL. | |

**User's choice:** Blank / unset (NULL)
**Notes:** Preserves "no mandate = no penalty" contract; onboarding is not gated.

### Q2: Clearing a previously-set field?

| Option | Description | Selected |
|--------|-------------|----------|
| Allowed — writes NULL, reverts to 'no constraint' | Maximal user control. (Recommended.) | ✓ |
| Not allowed — field sticky once set | Simpler backend; feels coercive. | |

**User's choice:** Allowed — writes NULL, reverts to 'no constraint'
**Notes:** Symmetrical with Q1 choice. needs_recompute / mandate_edited_at invalidates scoring cache.

### Q3: Per-field 'Reset to default' affordance?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — tiny 'Reset' link next to each field | Explicit; user can experiment and back out. | ✓ |
| No — user types/slides manually to clear | Lean UI; DESIGN.md favors minimal chrome. (Recommended.) | |

**User's choice:** Yes — tiny 'Reset' link next to each field
**Notes:** Minimal visual treatment (xs text, muted color). Triggers same auto-save path. No confirmation modal.

---

## Admin PreferencesPanel reconciliation

### Q1: What does the admin PreferencesPanel look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Admin writes direct UPDATE (bypass RPC) | Current behavior kept; audit via log_audit_event on UPDATE path. (Recommended.) | ✓ |
| Admin also routes through RPC (elevated claim) | Single write path; unified audit; bigger RPC surface. | |
| Admin read-only | Forces full self-service; no admin escalation route exists today. | |

**User's choice:** Admin writes direct UPDATE (bypass RPC)
**Notes:** Minimal change; admin-editable fields whitelist already exists in preferences.ts. Both paths audit via log_audit_event.

### Q2: Does admin panel surface new mandate fields?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add them to admin panel too | Admin needs full visibility to help allocators. (Recommended.) | ✓ |
| No — admin only sees legacy fields | Less admin management; harder to diagnose. | |

**User's choice:** Yes — add them to admin panel too
**Notes:** ALLOCATOR_PREFERENCES_COLUMNS smoke test ensures parity between admin panel columns and information_schema.columns.

### Q3: 'Last edited by' indicator?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — small indicator in admin panel only | Shows whether allocator engaged; helps admin diagnostics. (Recommended.) | ✓ |
| No — trust log_audit_event alone | Simpler; audit trail only in log. | |

**User's choice:** Yes — small indicator in admin panel only
**Notes:** Sourced from existing edited_by_user_id column + new mandate_edited_at. Allocator-facing form shows only "Last saved" (no admin-edit surfacing).

---

## Claude's Discretion

- Basic vs Advanced split in the UI (Q3 of taxonomy area)
- Auto-save debounce granularity beyond "on blur"
- "Last saved N min ago" format (relative vs absolute, refresh cadence)
- Exact RPC signature: parameter names, return shape, error codes
- Whether to reuse `max_drawdown_tolerance` for `risk_budget` or add a new column
- Component structure: single MandateForm vs composed sections
- Toast library, error copy, slider/chip/accordion styling
- Route guard / redirect if any other page links to the old /preferences content model

## Deferred Ideas

- Onboarding nudge / first-visit banner
- Field-level history / audit timeline UI
- Cross-field validation (e.g., max_weight × portfolio_size warnings)
- Bulk import of mandate from CSV / legacy system
- Admin "impersonate allocator" write path
- Coarser `style_categories` taxonomy (revisited if SUBTYPES feels overwhelming)
- Per-field admin-override lock
