# Phase 08: Connection Management and Notes — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `08-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 08-connection-management-and-notes
**Areas discussed:** Charter re-anchor + revoke, Notes schema for 4 scopes, Notes content + identity, Notes surfaces + autosave

---

## Area-selection turn

**Question:** Which areas do you want to discuss for Phase 08?
**Options presented (multiSelect):**
- Charter re-anchor + revoke — ✓
- Notes schema for 4 scopes — ✓
- Notes content + identity — ✓
- Notes surfaces + autosave — ✓

**User's choice:** All four areas selected.

---

## Charter re-anchor + revoke

### Q1: Where does connection management live in Phase 08?

| Option | Description | Selected |
|--------|-------------|----------|
| Stay at `/profile?tab=exchanges` (Recommended) | Accept Phase 06 UAT's IA. AllocatorExchangeManager already there. Update REQUIREMENTS.md MANAGE-01 text. Zero route churn. | ✓ |
| Resurrect `/connections` as alias | Deep link rendering the same AllocatorExchangeManager component. Costs extra route + redundant shell. | |
| Full `/connections` page again | Full-page surface, undoes Phase 06 consolidation. Highest churn. | |

**User's choice:** Stay at `/profile?tab=exchanges` (Recommended)
**Notes:** Locked in D-01; drives REQUIREMENTS.md MANAGE-01/02/03 one-line updates at commit time.

### Q2: Is user-initiated Revoke a distinct action from Delete?

| Option | Description | Selected |
|--------|-------------|----------|
| No — drop user Revoke (Recommended) | `revoked` status stays exchange-initiated only. User actions: Sync now + Delete. Simpler. | |
| Yes — soft Revoke button | New RPC + UI for user-initiated revoke that preserves row. Reversible. | |
| Rename Delete → Disconnect with cascade checkbox | Single destructive action with "Also delete historical holdings" checkbox using existing RPC `p_cascade_holdings`. | ✓ |

**User's choice:** Rename Delete → Disconnect with cascade checkbox
**Notes:** D-02 locks this. Checkbox default UNCHECKED (preserve history). No new backend; reuses migration 069 RPC verbatim.

### Q3: What's the UI treatment for historical holdings when a key is in 'revoked' state?

| Option | Description | Selected |
|--------|-------------|----------|
| Greyed row + "Key revoked" chip (Recommended) | 60% opacity + amber chip. KPIs still include values. Staleness banner surfaces last-sync age. | |
| Exclude from KPIs, keep in audit log only | Revoked-key holdings don't contribute to KPIs/charts. Cleanest numbers, loses visibility. | |
| Strikethrough + opt-in toggle "Show revoked holdings" | Strikethrough render + toggle (default state TBD); KPIs excluded. | ✓ |

**User's choice:** Strikethrough + opt-in toggle (with user note on historic representation)
**User note verbatim:** *"The user should have the option to toggle it on and off, also important for historic representation of actual performance"*
**Interpretation captured in D-04/D-05:** Historical KPIs / equity curve / drawdown ALWAYS include revoked-key holdings (they're real history). Toggle is a current-view-only clutter control (default ON). Strikethrough + amber "Key revoked" chip on the holdings-table row. Toggle state persists to `localStorage`.

### Q4: Does Phase 08 add anything NEW to the exchange manager beyond re-anchoring?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: just revoke/stale UI + notes (Recommended) | Phase 08 = Disconnect rename + stale UI + full notes work. Don't re-open shipped list/resync/delete. | ✓ |
| Add connection-health card | "2 keys connected, 1 stale, 0 revoked" summary card above the list. Could live in Phase 11. | |
| Add per-key rename + label field | `api_keys.label TEXT` column + edit UI. New capability. | |

**User's choice:** Minimal (Recommended)
**Notes:** Locked in D-06. Connection-health card and per-key rename go to Deferred Ideas.

---

## Notes schema for 4 scopes

### Q5: How should user_notes represent 4 scopes?

| Option | Description | Selected |
|--------|-------------|----------|
| scope_kind + scope_ref TEXT columns (Recommended) | `scope_kind` CHECK in 4 values + `scope_ref TEXT`. One table, one RLS, one API. Scope_ref loses typed FK integrity. | ✓ |
| Typed FK columns + XOR CHECK | Separate FK columns (`portfolio_id`, `holding_symbol`, `bridge_outcome_id`, `strategy_id`) + XOR CHECK. Preserves typed FKs + cascades. | |
| Four separate tables | Per-scope tables, heaviest surface, 4× RLS + API. | |

**User's choice:** scope_kind + scope_ref TEXT columns (Recommended)
**Notes:** Drives migration 071 (D-07). scope_ref formats locked in D-08.

### Q6: What does the holding scope_ref look like?

| Option | Description | Selected |
|--------|-------------|----------|
| (venue, symbol, holding_type) composite (Recommended) | `binance:BTC:spot`. Matches allocator_holdings unique key. Persists across daily re-ingestion. | ✓ |
| (venue, symbol) composite | `binance:BTC`. Aggregates spot + derivative into one note. | |
| symbol only | `BTC`. Cross-venue. Simplest; loses venue-specific context. | |
| allocator_holdings.id per-row | Evaporates on daily re-ingest. Rejected. | |

**User's choice:** (venue, symbol, holding_type) composite (Recommended)
**Notes:** Captured in D-08. Uses CCXT-stripped symbol form from Phase 06 D-16.

### Q7: Should scope_ref integrity be enforced at write time?

| Option | Description | Selected |
|--------|-------------|----------|
| App-layer ownership check (Recommended) | `/api/notes` PATCH resolves scope_ref per kind and verifies ownership. 403 on mismatch. | ✓ |
| DB-layer via SECURITY DEFINER RPC | `upsert_user_note(...)` RPC with ownership check inside. Stronger gate. | |
| Best-effort (no ownership check) | Rely on owner-RLS alone. Allows phantom notes pointing at other allocators' IDs. | |

**User's choice:** App-layer ownership check (Recommended)
**Notes:** Locked in D-09 with per-scope verification rules.

### Q8: Unique index / one-note-per-scope policy?

| Option | Description | Selected |
|--------|-------------|----------|
| One note per (user_id, scope_kind, scope_ref) (Recommended) | UNIQUE index + upsert on conflict. Matches existing pattern. | ✓ |
| Multiple notes per scope (thread) | N notes per scope, chronological. Richer; adds list/delete UI. | |
| Single note + append-only history table | Live note unique + mirror every PATCH into history table for audit/undo. | |

**User's choice:** One note per (user_id, scope_kind, scope_ref) (Recommended)
**Notes:** Locked in D-10. No history table. Threads and history deferred.

---

## Notes content + identity

### Q9: Plain text or markdown for note content?

| Option | Description | Selected |
|--------|-------------|----------|
| Render-on-read markdown (Recommended) | Store plain text, render with react-markdown + rehype-sanitize. Plain textarea for editing. | ✓ |
| Stay plain text | Update MANAGE-04 wording to drop "markdown". Smallest surface. | |
| Full rich text (TipTap) | WYSIWYG editor, JSON/HTML storage. Heavy dep + new CSP posture. Rejected. | |

**User's choice:** Render-on-read markdown (Recommended)
**Notes:** Locked in D-11. New deps: react-markdown + rehype-sanitize + remark-gfm.

### Q10: Length cap + size policy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 100KB per note (Recommended) | Migration 037 CHECK persists. Unified across all 4 scopes. | ✓ |
| Per-scope caps | 100KB portfolio / 10KB holding / 10KB outcome / 20KB strategy. More complex validation. | |
| Lower unified cap (10KB) | Tightens across the board. Breaking change for any large existing portfolio notes. | |

**User's choice:** Keep 100KB per note (Recommended)
**Notes:** Locked in D-12.

### Q11: Markdown sanitization posture

| Option | Description | Selected |
|--------|-------------|----------|
| rehype-sanitize default schema (Recommended) | Strip script/event handlers/javascript URLs; allow headings/lists/bold/italic/links/code blocks. | ✓ |
| Allow images + embeds | `<img>` + iframe. Tracking + XSS-via-SVG surface. Rejected. | |
| Strict block-level only | Headings/lists/bold/italic only. No links/code. Tighter but less useful. | |

**User's choice:** rehype-sanitize default schema (Recommended)
**Notes:** Locked in D-13. Custom `<a>` rewrite adds `rel="noopener noreferrer" target="_blank"`.

### Q12: Note visibility — shared or private?

| Option | Description | Selected |
|--------|-------------|----------|
| Always private, owner-only (Recommended) | RLS `user_id = auth.uid()` only. Matches institutional privacy expectations. | ✓ |
| Private by default, future opt-in share | Add `is_shared` + `shared_with` columns unused in Phase 08. YAGNI. | |
| Admin-readable for support | Three-tier RLS. Some LPs may balk at admin readability. | |

**User's choice:** Always private, owner-only (Recommended)
**Notes:** Locked in D-14. DEVIATES from standard three-tier RLS by design.

---

## Notes surfaces + autosave

### Q13: Portfolio-scope note placement on /allocations?

| Option | Description | Selected |
|--------|-------------|----------|
| NotesWidget in react-grid on Performance (Recommended) | Reuse Phase 05 single-file widget pattern. Existing NotesWidget.tsx upgrades in place. | ✓ |
| Pinned card above the tab strip | Persistent across tabs. Breaks "everything is a widget" model. | |
| Sidebar on Performance only | Right-sidebar column. Biggest layout change. | |

**User's choice:** NotesWidget in react-grid on Performance (Recommended)
**Notes:** Locked in D-15. Existing NotesWidget upgrades in place for multi-scope + markdown + on-blur.

### Q14: Holding-scope note UI on the holdings table?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline expandable row with note icon (Recommended) | Note icon per row; click expands sub-row with markdown + edit. Matches Phase 01 pattern. | ✓ |
| Hover tooltip + modal edit | Breaks on touch; rejected for desktop allocator UX. | |
| Dedicated Notes column | Eats horizontal space on tight holdings table. | |

**User's choice:** Inline expandable row with note icon (Recommended)
**Notes:** Locked in D-16.

### Q15: Bridge-outcome + strategy note surfaces?

| Option | Description | Selected |
|--------|-------------|----------|
| Expandable inside existing rows (Recommended) | OutcomesWidget row expandable extension + /strategy/[id] factsheet card. /discovery shows icon only. | ✓ |
| Dedicated /notes index page | New route + page tests + nav entry. Beyond MANAGE-05 scope. | |
| Drawer panel from each surface | New global UI primitive. Rejected. | |

**User's choice:** Expandable inside existing rows (Recommended)
**Notes:** Locked in D-17 (bridge_outcome) + D-18 (strategy).

### Q16: Autosave pattern for all four note surfaces?

| Option | Description | Selected |
|--------|-------------|----------|
| On-blur (mirror MandateForm) (Recommended) | Phase 02 `useMandateAutoSave` clone. Inline aria-live status. No toast. Upgrades existing 1s-debounced NotesWidget. | ✓ |
| 1s debounced (Sprint 3 pattern) | Keeps migration 037's debounce. More audit events; loses consistency with mandate. | |
| Hybrid: debounced + on-blur | Belt-and-suspenders. More complex hook + more /api/notes calls. | |

**User's choice:** On-blur (mirror MandateForm) (Recommended)
**Notes:** Locked in D-19 (new `useNoteAutoSave` + `NoteSaveStatus` shared hook/component).

---

## Claude's Discretion

Captured in `08-CONTEXT.md <decisions>` — package version pins, icon glyphs, exact aria-live copy, default widget position/size, whether to bump LAYOUT_VERSION, whether production has any `portfolio_id IS NULL` "global" note rows, strategy identity table choice, Disconnect modal copy refinement.

## Deferred Ideas

Captured in `08-CONTEXT.md <deferred>` — user-initiated soft Revoke, per-key rename/label, connection-health card, /notes index page, multi-note threads, history table, admin-readable notes, per-scope size caps, full rich-text editor, image/iframe markdown.
