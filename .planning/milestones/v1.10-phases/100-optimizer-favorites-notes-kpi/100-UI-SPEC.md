# Phase 100 — UI-SPEC: Optimizer + Favorites + Notes + KPI fold on /allocations

**Status:** draft
**Author:** Fable (design grey areas delegated by user, CONTEXT.md 2026-07-12)
**Surface (LOCKED):** `/allocations` — new sections mount in `HoldingsTabPanel.tsx` directly BELOW the Phase-99 exposure trio (`HoldingsTabPanel.tsx:150–160`).
**Invariants honored:** reuse-only backend (zero new endpoints; ONE additive migration for a `dashboard` scope_kind — see W1 rationale), SC-4 additive (existing /allocations DOM + polled payload + /portfolios/[id] values byte-identical), secretless, DESIGN.md conformance, honest-empty / no-invented-data everywhere.

---

## Page composition (placement + responsive)

Inside `HoldingsTabPanel`, after the existing exposure section:

```
[ …existing Holdings content… ]
[ Phase-99 Exposure section ]            ← UNTOUCHED (ExposureByClass / NetExposureChart / AllocationOverTime)
─ 32px section gap ─
[ Section: "Watchlist & Optimizer" ]     ← NEW (PI-05)
  ┌────────────────────┬────────────────────┐
  │ Watchlist panel    │ Optimizer panel    │   lg: 2-col grid (gap-6)
  └────────────────────┴────────────────────┘   <1024px container width: stacked
─ 32px section gap ─
[ Section: "Notes" ]                     ← NEW (PI-04), full-width
```

- **Responsive:** follow the Phase-52 allocations idiom — the two-panel grid reflows on its **own container width** via `@container` queries (host on a separate ancestor from the `@lg:grid-cols-2` variants, per the CompareTable idiom in DESIGN.md 2026-06-29 entry). Notes is always full-width.
- **Section headings:** `text-h3 font-semibold text-text-primary` (16px DM Sans semibold), matching the exposure section's panel-heading tier. Section gaps 32px (`space-y-8` at the section level; DESIGN.md "Section gaps: 24–32px").
- **Data flow (SC-4 safe):** new server reads are ADDED to the `page.tsx:56` `Promise.all` as new array items (the exact Phase-99 exposure precedent) and threaded as **new props** — `getMyAllocationDashboard`'s polled payload and the `exposure` prop are byte-untouched. New props: `favorites`, `optimizer` (see bindings below).
- **KPI fold (PI-06)** touches `/portfolios/[id]` only. **No new KPI strip on /allocations** — `KpiStripWidget` already serves that surface; adding a second strip would duplicate a landmark metric surface for no user gain.

---

## W1 — Notes widget (PI-04)

**Component:** NEW thin consumer `src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx`, cloned structurally from `src/components/notes/StrategyNoteCard.tsx` (textarea + autosave; that file is the closest existing consumer).

**Reuse (build nothing new in the notes stack):**
- Hook: `useNoteAutoSave(scope_kind, scope_ref, …)` — `src/components/notes/useNoteAutoSave.ts:41` (debounced PATCH `/api/notes`, save-state machine).
- Save indicator: `NoteSaveStatus.tsx`; rendered view: `NoteRender.tsx` + `sanitize-schema.ts` (existing sanitized-markdown pipeline).
- API: `GET/PATCH /api/notes` (`src/app/api/notes/route.ts:16`) — body `{scope_kind, scope_ref, content}`, 100KB cap, `notesUpsertLimiter`. NO new endpoint.

**Scope decision (the one migration): `scope_kind='dashboard'`, `scope_ref='allocations'`.**
*Rationale:* /allocations is the allocator's whole book — it is user-scoped, not portfolio-scoped. Reusing `portfolio` scope keyed to "some default portfolio" breaks for users with 0 portfolios and silently re-homes the note if the default changes; `checkScopeOwnership` (`src/lib/notes/ownership.ts:30`) has no valid predicate for it. CONTEXT allows a migration "if a new scope_kind is genuinely needed" — it is. One additive migration: extend the `scope_kind` CHECK to include `dashboard` (timestamp **> `20260714090000`**), plus a `dashboard` arm in `checkScopeOwnership` (valid iff `scope_ref === 'allocations'`; ownership is trivially the authed user — RLS `user_id = auth.uid()` carries the real gate). Existing rows untouched. Regenerate `database.types.ts`. CI-authoritative RLS proof: `supabase/tests/test_user_notes_dashboard_scope.sql` (vitest live-DB tests SKIP in CI).

**UX contract:**
- Card (white surface, 1px `#E2E8F0`, radius-lg 8px, padding 24px). Heading row: "Notes" (`text-h3 font-semibold`) + `NoteSaveStatus` right-aligned ("Saved Ns ago").
- **Edit affordance:** always-editable `<textarea>` (StrategyNoteCard pattern — no edit-mode toggle; autosave removes the need for a Save button). Min-height ~6 rows, `text-body` DM Sans, focus ring `border-focus` (#1B6B5A).
- **Markdown:** supported (write plain, render sanitized) — matches the shipped StrategyNoteCard contract ("markdown supported"). Preview is NOT a separate tab: below-fold rendered preview only when content is non-empty (keep the widget quiet).
- **Empty state (honest):** empty textarea with placeholder `"Add a private note about your allocation book — markdown supported. Visible only to you."` No sample text, no fabricated content.
- Sub-caption under heading: `text-caption text-text-muted` — "Private — visible only to you." (secretless reassurance; notes carry no secrets per invariant).

---

## W2 — Watchlist panel (PI-05, favorites half)

**Component:** NEW `src/app/(dashboard)/allocations/components/WatchlistPanel.tsx` (client). Favorites are currently rendered NOWHERE on /allocations — this fills the absence.

**Data binding:**
- **Read (server):** new RLS user-client read `getFavoritesWithStrategies(user.id)` in the page's `Promise.all` — `user_favorites` (mig `20260409202757`) joined to `strategies` for `{strategy_id, name, slug, trust_tier, created_at}`. All real columns; nothing synthesized.
- **Write (client):** existing `PUT /api/watchlist/[strategyId]` `{action: 'add'|'remove'}` (`src/app/api/watchlist/[strategyId]/route.ts`) — idempotent upsert, CSRF, rate-limited. Bulk = client-side loop over selected ids against this SAME endpoint (no new bulk route; idempotency makes partial failure safe — rollback only the failed rows).

**Layout — table, not cards** (DESIGN.md "data density > card density"): one panel Card containing a borderless table (header bottom-border, hairline row dividers, hover bg):

| Col | Content | Token |
|---|---|---|
| ☐ | row checkbox (bulk select; header = select-all) | 44px touch target |
| Strategy | name → link to strategy detail + `TrustTierLabel` pill | `text-small`, link accent |
| Added | favorited date | `text-caption text-text-muted`, Geist Mono |
| Suggested | "Suggested" chip iff the strategy_id appears in the CURRENT optimizer suggestions (cross-link, real data only) | badge ladder: 4px radius, micro uppercase, accent border/text |
| ★ | per-row unfavorite toggle | filled `#1B6B5A` star = favorited; `aria-pressed`; fill+shape carries state, never color alone |

**Sort / group / bulk (the PI-05 interaction model):**
- **Sort** (segmented control, `text-caption`): `Recently added` (default, `created_at` desc) · `Name A–Z`. No score-sort here (score lives in the optimizer panel; duplicating it would imply favorites are ranked — they aren't).
- **Group** (toggle): `None` (default) · `Verification tier` — groups by `trust_tier` (api_verified / csv_uploaded / self_reported) with micro uppercase group headers. This is the only grouping dimension backed by real per-strategy data on this read; do NOT invent asset-class/style groups.
- **Bulk toggle:** selecting ≥1 row reveals a `Button variant="secondary" size="sm"` — **"Remove N from watchlist"** — above the table, right-aligned. Optimistic removal with per-row rollback + `role="status"` polite announcement ("Removed N strategies from watchlist"). No destructive-red styling: unfavoriting is reversible (amber/negative misuse forbidden; plain secondary button).

**Empty state (honest):** panel keeps its heading; body = `text-small text-text-secondary` — `"No favorites yet. Star strategies in Discovery to build your watchlist."` + secondary-variant link-button "Browse strategies →" (`/discovery`). No skeleton rows, no ghost content.

---

## W3 — Optimizer suggestions panel (PI-05, optimizer half)

**Component:** REUSE `src/components/portfolio/PortfolioOptimizer.tsx` (mounted via `next/dynamic` exactly as `portfolios/[id]/page.tsx:68` does), wrapped in a NEW thin `src/app/(dashboard)/allocations/components/OptimizerPanel.tsx` that owns the portfolio selector + empty gate. PortfolioOptimizer already solves pending/computing/failed/stale(7d)/skeleton states and the refresh POST — rebuilding any of it is waste.

**Data binding:**
- **Server prefetch:** the user's portfolios (id, name, `updated_at`) + the persisted suggestions/`computed_at`/`computation_status` for the **default portfolio** (most recently updated) — the same read shape `portfolios/[id]/page.tsx` already performs; added to the page `Promise.all` as the `optimizer` prop.
- **Client:** refresh via existing `POST /api/portfolio-optimizer {portfolio_id}` (CSRF + ownership + 5/min limiter with refund) → `OptimizerSuggestion[]` (`PortfolioOptimizer.tsx:11`). NEVER `/api/optimize-weights` — see honesty contract below.

**Portfolio selector:** compact `<select>` (input tokens: 6px radius, 1px border, accent focus) in the panel heading row, visible only when the user has ≥2 portfolios. Switching resets to the component's own pending state and lets its existing fetch/refresh flow run — no new data machinery.

**Honesty contract (scores, not weights):** `/api/portfolio-optimizer` returns **scored strategy suggestions** — rankings, NOT an allocation. The panel MUST render a **ranked list/table sorted by `score` desc** (PortfolioOptimizer's existing row treatment: name + right-aligned `MetricCell`s for Score / Corr / Sharpe lift / DD improvement, Geist Mono tabular-nums, `liftClass` positive-green only for genuinely positive lifts). **Forbidden:** any pie/donut/weight-bar rendering, any "%" framing, any implied allocation. Mandatory footer caption (`text-caption text-text-muted`):
> "Ranked by modeled fit from historical daily returns — suggestions, not an allocation and not a forecast."

**KPI narrative tooltips** (on each metric label; accessible tooltip — trigger focusable, `aria-describedby`, content also acceptable as the cell's `title` fallback):
- **Score:** "Composite fit ranking — how much this strategy is modeled to improve your portfolio. Higher is better; useful for ordering, not sizing."
- **Corr w/ portfolio:** "Correlation of this strategy's daily returns with your current portfolio. Lower means more diversification benefit."
- **Sharpe lift:** "Modeled change in your portfolio's Sharpe ratio if this strategy were added. Positive means better risk-adjusted return in backtest."
- **DD improvement:** "Modeled reduction in maximum drawdown from adding this strategy, based on historical returns."

**Empty / degraded states (all honest, all already encoded in PortfolioOptimizer except the zero-portfolio gate, which OptimizerPanel adds):**
- **0 portfolios:** "Optimizer suggestions need a portfolio to optimize against. Create one to see which strategies would improve it." + secondary button "Create portfolio →" (`/portfolios`). No fake suggestions.
- **No suggestions / never computed:** PortfolioOptimizer's existing run affordance + empty copy.
- **Python service down (503/504):** PortfolioOptimizer's existing failed state — permanent-failure copy uses `text-negative` per envelope rules; transient retry-in-flight is NOT red.
- **Stale (>7d):** existing stale banner (warning amber `#B45309` — recoverable via the refresh action, per the 2026-07-02 widened amber semantic).

---

## W4 — KPI fold adapter (PI-06, `/portfolios/[id]` only)

**Decision — fold as an adapter, extract the shared panel primitive:**
1. Extract the presentational cell/panel renderer from `KpiStrip.tsx` into a shared **`KpiPanel`** primitive (one white panel, N columned cells separated by hairline dividers — the DESIGN.md-blessed shared-panel pattern), consumed by `KpiStrip` **byte-identically** (its warmup/stale/scenario logic and all existing tests stay green — the extraction is render-tree-neutral).
2. NEW `src/components/portfolio/PortfolioKpiPanel.tsx` adapter: maps `PortfolioAnalytics` → `KpiPanel` cells and replaces `<PortfolioKPIRow …/>` at its sole call site `portfolios/[id]/page.tsx:291`. Delete `PortfolioKPIRow.tsx` (the divergent 4-centered-Cards anti-pattern is the thing being removed).

**Explicit field mapping (the two shapes must NEVER be conflated — MTD ≠ YTD):**

| Cell | Source (`PortfolioAnalytics`) | Formatter (unchanged) | Color (unchanged) |
|---|---|---|---|
| AUM | `total_aum` | `formatCurrency` | `text-text-primary` |
| MTD TWR | `return_mtd` | `formatPercent` | `metricColor` |
| Avg Correlation | `avg_pairwise_correlation` | `formatNumber` | existing `correlationColor` semantics preserved verbatim (no-regress; its ≥0.7-red is pre-existing risk signaling, not new red/green misuse — flagged, not changed) |
| Portfolio Sharpe | `portfolio_sharpe` | `formatNumber` | `metricColor` |

- **AUM stays.** KpiStrip dropped AUM for the return-form allocations surface (Phase 64 PRESENT-01); the portfolio detail page's AUM is real, load-bearing data — dropping it would be a regression, and the adapter (not the allocations KpiStrip) owns its cell list.
- Cell typography adopts the KpiStrip cell contract (micro uppercase muted label + Geist Mono tabular-nums metric value), replacing PortfolioKPIRow's centered `text-2xl font-bold` cards. Values, formatters, null→`—` behavior: byte-identical.
- **No /allocations change** for PI-06.

---

## DESIGN.md token sheet (all widgets)

- Panels: white `#FFFFFF`, 1px `#E2E8F0`, radius-lg 8px, shadow `0 1px 3px rgba(0,0,0,0.04)`, padding 24px.
- Type: section/panel headings `--text-h3` semibold; table cells `--text-small`; captions/sub-copy `--text-caption`; labels `--text-micro` uppercase tracking-wider; ALL numbers Geist Mono `tabular-nums`. No raw `text-[Npx]` (repo-wide `error` lint).
- Color: accent `#1B6B5A` for stars/links/primary actions; `text-positive` ONLY for genuinely positive lifts/returns; `text-negative` ONLY for losses/permanent failures; warning amber `#B45309` for the recoverable stale state. Never color-as-sole-signal (star fill + `aria-pressed`; chips carry text).
- Motion: hover 150ms ease-out; panel/tooltip transitions ≤250ms (`duration-300` if Tailwind utility); nothing decorative.
- A11y: 4.5:1 text contrast; `role="status"` polite on bulk-remove/save-state changes; tooltips keyboard-reachable; axe (wcag2a+aa+best-practice) zero violations on /allocations.

## Verification intents

1. **SC-4 additive:** existing /allocations exposure-section DOM + `getMyAllocationDashboard` payload untouched (snapshot/diff test); `/portfolios/[id]` KPI **values** unchanged post-fold (field-mapping regression test asserting AUM/MTD/corr/Sharpe render identical outputs for a fixed `PortfolioAnalytics` fixture — the test must fail if MTD is mapped to a YTD label or AUM is dropped).
2. **Notes:** render + autosave test (debounce fires ONE PATCH with `{scope_kind:'dashboard', scope_ref:'allocations', content}`); SQL RLS gate `supabase/tests/test_user_notes_dashboard_scope.sql` (owner-only read/write on the new scope); migration timestamp > `20260714090000`; migration-reviewer + rls-auditor + test-project MCP catch-up before merge.
3. **Watchlist:** honest-empty render (copy above, zero ghost rows); sort/group interactions; bulk-remove issues one idempotent PUT per selected id with per-row rollback on failure (test proves the call-site wiring, not just the helper).
4. **Optimizer:** ranked-table render from `OptimizerSuggestion[]` fixture; 0-portfolio gate copy; NO weight/pie rendering (assert absence); footer disclaimer present; tooltip copy verbatim.
5. **Lint + coverage:** `npm run lint` (react-hooks) + coverage ratchet green; axe scan on /allocations.

## UI-SPEC COMPLETE
Key calls: Notes = one additive `dashboard` scope_kind migration + StrategyNoteCard-pattern autosave card; PI-05 = side-by-side Watchlist table (sort: recency/name, group: trust tier, bulk idempotent PUT loop) + reused PortfolioOptimizer as an honest score-ranked list (never weights/pie) behind a portfolio selector with a 0-portfolio gate; PI-06 = extract `KpiPanel` from KpiStrip and adapt `PortfolioAnalytics` onto it (AUM kept, MTD label preserved, values byte-identical), no /allocations KPI change.
