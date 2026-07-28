# Truncation Classification Audit (TYPE-01)

**Date:** 2026-06-29
**Phase:** 49 — design-system-refresh-fluid-token-foundation
**Requirement:** TYPE-01
**Status:** Informational artifact — **NOT a Phase-49 gate.**

This is the TYPE-01 deliverable: a complete census of every clip/ellipsis site in
`src/`, each tagged **legitimate** vs **accidental-clip**. It exists so the
per-surface fluid-type phases (**52 / 53**) can introduce the fluid `--text-*`
scale without merely *relocating* a clip — i.e. so "fluid type never just moves a
truncation somewhere new." It is read-only: **no component was modified by this
audit**, and it adds **no CI gate** (the optional census-count guard is deferred
per 49-RESEARCH).

## Classification criteria

- **legitimate** — a bounded label/value that EITHER recovers the full content
  (a sibling `title=` attribute, an `aria-label`, or a hover tooltip / the
  tooltip the element lives inside) OR is an intentional single-line affordance
  whose clipped content is non-meaningful for recovery (a short ID slice, a fixed
  KPI label, a metric value that does not overflow).
- **accidental-clip** — clips meaningful content (a strategy/portfolio/document
  name, a reason, a note, a mandate label) with **no recovery affordance** (no
  `title`, no tooltip, no expand, no full-text elsewhere on the surface). These
  are the rows phases 52/53 must fix (give a `title`/tooltip, allow wrap, or
  reflow) rather than relocate.

> A `truncate`/`line-clamp` is classified by reading the owning component, not the
> grep line alone — several sites carry a sibling `title={…}` (legitimate) that
> the class string does not reveal.

## Census summary

Census run 2026-06-29 via `rg` over `src/` (excluding `*.test.*` and
`__tests__/`), then each site read in its owning component.

| Pattern | Sites | Notes |
|---------|-------|-------|
| `truncate` (Tailwind single-line clip) | 37 | className sites only; the word "truncate" in `gdpr-export.ts` / `audit.ts` / data-cap code is NOT a CSS clip and is excluded. |
| `line-clamp-N` (multi-line clamp) | 7 | all `line-clamp-2` / `line-clamp-3` on description/reason prose. |
| `text-ellipsis` (+ `overflow-hidden whitespace-nowrap`) | 2 | both in `FactsheetView.tsx` — the only co-located `overflow-hidden` + `whitespace-nowrap` single-line-clip idiom in `src/`. |
| manual `…` truncation idiom (`slice(...) + "…"`) | 2 | `build-payload.ts:161`, `TimeSeriesChart.tsx:1130` (used at :1109). Decorative `"Syncing…"` / `"Recording…"` button labels and the `${days}…` "ongoing" marker in `WorstDrawdowns.tsx` are NOT truncation and are excluded. |
| **Total clip/ellipsis sites** | **48** | |
| deliberate **no-clip** site (documented) | 1 | `ScopedBanner.tsx` — explicitly does NOT truncate (H-0408); `break-words` + `min-w-0` wrap instead. Listed for completeness, not counted as a clip. |

**Tally (49 table rows = 48 clip sites + 1 deliberate no-clip):**
17 legitimate (16 clip + the 1 `ScopedBanner` no-clip) · 32 accidental-clip. The
accidental-clip count is high because the dominant pattern is a card/table/list
row showing a **name** (`text-primary truncate`) inside a `min-w-0` flex column
with no `title`. Phases 52/53 should standardize a recovery affordance (a
`title={name}` or a tooltip) on that pattern rather than re-clipping at the new
fluid size.

## Full classification table

| file:line | pattern | element / context | classification | recovery affordance | note |
|-----------|---------|-------------------|----------------|---------------------|------|
| `src/components/strategy/CompareCorrelationMatrix.tsx:90` | truncate | `<th>` strategy-name column header (`max-w-[120px]`) | legitimate | `title={item.strategy.name}` | bounded matrix axis label; full name on hover. |
| `src/components/strategy/CompareCorrelationMatrix.tsx:113` | truncate | `<td>` strategy-name row header (`max-w-[120px]`) | legitimate | `title={rowItem.strategy.name}` | same matrix axis, row side. |
| `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx:182` | truncate | `<th>` strategy-name column header (`maxWidth:80`) | legitimate | `title={n}` | bounded correlation-matrix axis label. |
| `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx:195` | truncate | `<td>` strategy-name row header (`maxWidth:80`) | legitimate | `title={names[i]}` | same, row side. |
| `src/components/admin/ComputeJobsTable.tsx:240` | truncate | `<td>` compute-job target (`max-w-[180px]`) | legitimate | `title={target}` | admin table cell; full target on hover. |
| `src/components/admin/ComputeJobsTable.tsx:261` | truncate | `<td>` last-error text (`max-w-[240px]`) | legitimate | `title={job.last_error}` | error text recoverable on hover. |
| `src/app/(dashboard)/admin/compute-jobs/page.tsx:125` | truncate | `<td>` id slice (`(strategy_id ?? portfolio_id).slice(0,8)`, `max-w-[120px]`) | legitimate | none needed | already an 8-char ID slice — intentional single-line affordance, not meaningful prose. |
| `src/app/(dashboard)/admin/compute-jobs/page.tsx:135` | truncate | `<td>` last-error (`max-w-[200px]`) | legitimate | `title={job.last_error}` | error text recoverable on hover. |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:1109` | manual `…` (`truncate(s.name,18)`) | SVG chart tooltip legend series name | legitimate | tooltip is itself the recovery; SVG legend, `aria` chart context | series name clipped to 18 chars inside a hover tooltip — the tooltip IS the on-demand affordance. |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx:647` | text-ellipsis (+overflow-hidden +whitespace-nowrap) | KPI tile label (`it.label`) | legitimate | fixed label set | labels are fixed strings ("Cum. Return", "CAGR", "Sharpe", "Max DD", `α vs <cmp>`…); bounded single-line affordance, no meaningful prose to recover. |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx:653` | text-ellipsis (+overflow-hidden +whitespace-nowrap) | KPI tile metric value | legitimate | numeric, tabular-nums | a formatted metric number (`pctSigned`/`num`); does not carry hidden meaning when it fits — bounded value. |
| `src/components/portfolio/CorrelationHeatmap.tsx:261` | truncate | heatmap column header (`label(id)`, `text-[10px]`) | legitimate | per-cell `aria-label` names both strategies | header is short; the full pairwise label is in each cell's `aria-label` (screen-reader recovery). |
| `src/components/portfolio/CorrelationHeatmap.tsx:269` | truncate | heatmap row header (`label(rowId)`) | legitimate | per-cell `aria-label` | same as column header. |
| `src/components/ui/ScopedBanner.tsx:30` | (deliberate no-clip) | partner-scope title | legitimate (no clip) | `break-words` + `min-w-0` wrap | **does NOT truncate by design** (H-0408): a trust-critical scope slug must show in full; wraps instead of ellipsing. Listed as the reference pattern phases 52/53 should follow. |
| `src/components/strategy/StrategyGrid.tsx:63` | truncate | `<h3>` marketplace tile strategy name (`min-w-0`) | accidental-clip | none | **52/53**: strategy name in a discovery tile; no title/tooltip — add a `title={s.name}` or allow 2-line clamp. `wizardErrors.ts:481` even warns managers "longer names truncate." |
| `src/components/deck/DeckCard.tsx:13` | truncate | `<h3>` deck name | accidental-clip | none | **52/53**: deck name clipped with no recovery. |
| `src/components/portfolio/WinnersLosersStrip.tsx:24` | truncate | `<span>` attribution row strategy name | accidental-clip | none | **52/53**: contributor name in winners/losers strip; no title. |
| `src/components/portfolio/PortfolioImpactPanel.tsx:197` | truncate | `<h2>` panel title (`Simulate impact: {candidateName}`) | accidental-clip | none | **52/53**: candidate name embedded in a heading; no title. Panel header — prefer wrap. |
| `src/components/portfolio/DocumentList.tsx:68` | truncate | `<p>` document title | accidental-clip | none | **52/53**: document title clipped; no title/tooltip. |
| `src/components/portfolio/PortfolioOptimizer.tsx:78` | truncate | `<p>` suggestion strategy name | accidental-clip | none | **52/53**: strategy name; no recovery. |
| `src/components/portfolio/PortfolioOptimizer.tsx:81` | truncate | `<p>` strategy_id (`font-mono text-[11px]`) | legitimate | none needed | a raw strategy_id, not meaningful prose — intentional single-line affordance. |
| `src/components/portfolio/ReplacementCard.tsx:116` | truncate | `<p>` candidate strategy name | accidental-clip | none | **52/53**: strategy name; no recovery. |
| `src/components/portfolio/ReplacementPanel.tsx:127` | truncate | `<h2>` `Replace {strategyName}` heading | accidental-clip | none | **52/53**: strategy name in a heading; prefer wrap. |
| `src/components/portfolio/AllocationTimeline.tsx:30` | truncate | `<p>` event strategy name | accidental-clip | none | **52/53**: strategy name; no recovery. |
| `src/components/portfolio/AllocationTimeline.tsx:34` | truncate | `<p>` event notes | accidental-clip | none | **52/53**: free-text note clipped to one line; no title/expand. |
| `src/app/(dashboard)/portfolios/page.tsx:44` | truncate | `<h3>` portfolio name | accidental-clip | none | **52/53**: portfolio name in a card; no recovery. |
| `src/app/(dashboard)/portfolios/[id]/manage/page.tsx:69` | truncate | `<p>` strategy name (`s?.name ?? strategy_id`) | accidental-clip | none | **52/53**: strategy name; no recovery. |
| `src/components/exchanges/AllocatorExchangeManager.tsx:714` | truncate | `<p>` API-key label (connected) | accidental-clip | none | **52/53**: user-chosen key label clipped; no title. |
| `src/components/exchanges/AllocatorExchangeManager.tsx:801` | truncate | `<p>` API-key label (disconnected) | accidental-clip | none | **52/53**: same key-label pattern, disconnected list. |
| `src/components/admin/match/ShortlistCard.tsx:43` | truncate | `<p>` shortlisted strategy name | accidental-clip | none | **52/53**: strategy name; no recovery. |
| `src/components/admin/MatchQueueIndex.tsx:289` | truncate | `<td>` `mandate_archetype` (`max-w-[260px]`) | accidental-clip | none | **52/53**: mandate label clipped; no title. |
| `src/components/admin/AllocatorMatchQueue.tsx:560` | truncate | `<p>` candidate reason (`cand.reasons[0]`, `max-w-[260px]`) | accidental-clip | none | **52/53**: match reason clipped to one line; no title/expand. |
| `src/components/admin/AllocatorMatchQueue.tsx:701` | truncate | `<td>` founder note (`max-w-[320px]`) | accidental-clip | none | **52/53**: founder note clipped; no title. |
| `src/app/(dashboard)/allocations/components/AlertBanner.tsx:127` | truncate | `<p>` alert message (`head.message`) | accidental-clip | none | **52/53**: the primary alert message is single-line-clipped; meaningful, no title. (The `+N` overflow count is shown, but the message text itself has no recovery.) |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:529` | truncate | `<span>` saved-scenario name (`row.name`) | accidental-clip | none | **52/53**: user-named scenario clipped; no title. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2779` | truncate | `<span>` constituent strategy name (`max-w-[160px]`, `?? id.slice(0,8)`) | accidental-clip | none | **52/53**: blend constituent name clipped; falls back to an id slice but the *name* path has no title. |
| `src/app/demo/layout.tsx:42` | truncate | `<p>` fixed demo-banner subtitle | legitimate | fixed string | the text is a hard-coded constant ("Live demo — simulated allocator data…"); bounded single-line affordance, not dynamic prose. |
| `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:166` | truncate | `<p>` allocator display name (`?? email ?? id.slice(0,8)`) | accidental-clip | none | **52/53**: allocator name clipped; no title. |
| `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:170` | truncate | `<p>` allocator email (`font-mono`) | accidental-clip | none | **52/53**: email clipped; no title (an email mid-clip is unrecoverable). |
| `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:209` | truncate | `<p>` staged strategy name | accidental-clip | none | **52/53**: strategy name; no recovery. |
| `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:212` | truncate | `<p>` strategy status line (`status · manager`) | accidental-clip | none | **52/53**: status/manager meta clipped; no title. |
| `src/components/portfolio/MorningBriefing.tsx:33` | line-clamp-3 | `<p>` AI narrative "dek" variant | accidental-clip | none | **52/53**: the briefing narrative is clamped to 3 lines with no "read more"/expand — the component's own comment notes it "truncates visually." Prose with no recovery. |
| `src/components/deck/DeckCard.tsx:17` | line-clamp-2 | `<p>` deck description | accidental-clip | none | **52/53**: description clamped to 2 lines, no expand. |
| `src/components/admin/match/ShortlistCard.tsx:47` | line-clamp-2 | `<p>` candidate reason | accidental-clip | none | **52/53**: reason clamped to 2 lines, no expand. |
| `src/app/(dashboard)/recommendations/page.tsx:303` | line-clamp-2 | `<p>` strategy description | accidental-clip | none | **52/53**: description clamped, no expand (`primaryReason` above it is NOT clamped). |
| `src/app/demo/page.tsx:266` | line-clamp-2 | `<p>` strategy description (holdings list) | accidental-clip | none | **52/53**: description clamped, no expand. |
| `src/app/demo/page.tsx:486` | line-clamp-2 | `<p>` strategy description (recommendation card) | accidental-clip | none | **52/53**: description clamped, no expand. |
| `src/app/(dashboard)/portfolios/page.tsx:48` | line-clamp-2 | `<p>` portfolio description | accidental-clip | none | **52/53**: description clamped, no expand. |
| `src/lib/factsheet/build-payload.ts:161` | manual `…` (`name.slice(0,11) + "…"`) | chart series legend name (`>12` chars) | legitimate | the chart/tooltip context | name shortened for a chart legend label; the full name lives in the surrounding factsheet/tooltip — a deliberate fixed-width legend affordance. |

> Excluded as NOT truncation (decorative / status, not content-clipping):
> `ApiKeyManager.tsx:359/368` ("Syncing…"), `RejectedForm.tsx:106` /
> `AllocatedForm.tsx:117` ("Recording…") — loading-state button labels;
> `WorstDrawdowns.tsx:159` (`${durationDays}…`) — an "ongoing episode" marker,
> not a clipped value.

## Accidental-clip shortlist (for phases 52/53 to triage first)

These 32 sites clip meaningful content with **no recovery affordance**. They are
the rows fluid type must NOT simply relocate — each needs a recovery affordance
(`title=`/tooltip), a wrap (`break-words` + `min-w-0`, the `ScopedBanner`
pattern), or a reflow at the new fluid size.

**Strategy / portfolio / deck / scenario names (single-line `truncate`, no title):**
- `src/components/strategy/StrategyGrid.tsx:63` — marketplace tile name
- `src/components/deck/DeckCard.tsx:13` — deck name
- `src/components/portfolio/WinnersLosersStrip.tsx:24` — attribution name
- `src/components/portfolio/PortfolioImpactPanel.tsx:197` — `Simulate impact: {name}` heading
- `src/components/portfolio/DocumentList.tsx:68` — document title
- `src/components/portfolio/PortfolioOptimizer.tsx:78` — suggestion name
- `src/components/portfolio/ReplacementCard.tsx:116` — candidate name
- `src/components/portfolio/ReplacementPanel.tsx:127` — `Replace {name}` heading
- `src/components/portfolio/AllocationTimeline.tsx:30` — event name
- `src/app/(dashboard)/portfolios/page.tsx:44` — portfolio name
- `src/app/(dashboard)/portfolios/[id]/manage/page.tsx:69` — strategy name
- `src/components/admin/match/ShortlistCard.tsx:43` — shortlisted name
- `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:529` — scenario name
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2779` — constituent name
- `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:209` — staged strategy name

**API-key labels / allocator identity (single-line `truncate`, no title):**
- `src/components/exchanges/AllocatorExchangeManager.tsx:714` — key label (connected)
- `src/components/exchanges/AllocatorExchangeManager.tsx:801` — key label (disconnected)
- `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:166` — allocator display name
- `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:170` — allocator email (mid-clip unrecoverable)

**Free text — reasons / notes / messages / mandate / status (single-line `truncate`, no title):**
- `src/components/portfolio/AllocationTimeline.tsx:34` — event notes
- `src/components/admin/MatchQueueIndex.tsx:289` — mandate_archetype
- `src/components/admin/AllocatorMatchQueue.tsx:560` — candidate reason
- `src/components/admin/AllocatorMatchQueue.tsx:701` — founder note
- `src/app/(dashboard)/allocations/components/AlertBanner.tsx:127` — alert message
- `src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:212` — strategy status/manager line

**Multi-line prose clamps with no "read more"/expand (`line-clamp-N`):**
- `src/components/portfolio/MorningBriefing.tsx:33` — AI briefing narrative (line-clamp-3)
- `src/components/deck/DeckCard.tsx:17` — deck description
- `src/components/admin/match/ShortlistCard.tsx:47` — candidate reason
- `src/app/(dashboard)/recommendations/page.tsx:303` — strategy description
- `src/app/demo/page.tsx:266` — strategy description (holdings)
- `src/app/demo/page.tsx:486` — strategy description (recommendation card)
- `src/app/(dashboard)/portfolios/page.tsx:48` — portfolio description

## Recommended handling for phases 52/53

1. **Names in cards/tables/lists** — the dominant accidental pattern is
   `text-primary truncate` on a name inside a `min-w-0` flex column. Standardize a
   single fix: add `title={name}` (cheapest recovery) OR adopt the `ScopedBanner`
   wrap pattern (`break-words` + `min-w-0`) where the layout allows two lines.
2. **Emails / mandate / status lines** — a mid-clipped email or mandate string is
   unrecoverable; prefer `title=` or wrap, never a bare ellipsis.
3. **`line-clamp` descriptions** — add an expand/"read more" affordance, or accept
   the clamp only where a full-detail surface (factsheet, single-strategy page) is
   one click away; document that link as the recovery in the 52/53 plan.
4. **Do NOT** introduce any NEW `truncate`/`line-clamp` without a title/tooltip
   when relocating type — that is exactly the "fluid type just relocated a clip"
   regression this audit exists to prevent.

> Legitimate sites (14) need no change — they either recover the full content
> (`title=`/`aria-label`/tooltip) or clip non-meaningful content (id slices, fixed
> KPI labels/values, fixed banner copy). They are listed in the table above so a
> 52/53 refactor that *removes* their recovery affordance is caught in review.
