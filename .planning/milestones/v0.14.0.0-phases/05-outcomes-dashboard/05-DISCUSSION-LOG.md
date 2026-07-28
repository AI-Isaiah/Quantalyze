# Phase 5: Outcomes Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 05-outcomes-dashboard
**Areas discussed:** Timeline row model, Sparkline rendering, KPI semantics, Data loading + widget registration

---

## Gray area selection

| Area | Description | Selected |
|------|-------------|----------|
| Timeline row model | Sort, pagination, Status col, rejected-row Best Available Delta, click-through | ✓ |
| Sparkline rendering | Window count, library, rebasing, NULL-delta handling | ✓ |
| KPI semantics | Win-rate formula, avg realized delta, total count, pending surfacing | ✓ |
| Data loading + widget registration | Query surface, lazy vs eager, category, defaults | ✓ |

All four areas selected.

---

## Area 1: Timeline row model

### Q: Sort order + pagination

| Option | Description | Selected |
|--------|-------------|----------|
| Newest first, full list | ORDER BY created_at DESC, no pagination. Early-lifecycle allocators have <50 outcomes. | ✓ |
| Newest first, 20/page | 20 per page + Show more button. Future-proofs heavy allocators; adds state + UX debt. | |
| Newest first, virtualized | react-window. New dep if no existing widget virtualizes. | |
| Grouped: Allocated then Rejected | Two sections. Breaks chronology; hides learning story. | |

### Q: Status column semantics

| Option | Description | Selected |
|--------|-------------|----------|
| 4-state: Allocated-win / -loss / -pending / Rejected | Color-coded by most-mature-delta sign per Phase 1 D-13. | ✓ |
| 3-state: Allocated / Pending / Rejected | Simpler; defers tone to Best Available Delta cell. | |
| 2-state: Allocated / Rejected | Minimum; loses pending-vs-realized distinction. | |
| Status = rejection_reason label | Denser for rejected rows; longer cell. | |

### Q: Rejected row "Best Available Delta" cell

| Option | Description | Selected |
|--------|-------------|----------|
| Em-dash — | Cleanest; matches existing Quantalyze missing-cell convention. | ✓ |
| Rejection reason label | Denser; duplicates info with Status col. | |
| "N/A" text | Explicit but non-conventional. | |
| Counterfactual "had you allocated" | Complex; out of scope. | |

### Q: Row click behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Expand/collapse only | Row toggles expanded panel; strategy names plain text. | |
| Strategy names link to /strategies/[id] | Names become links; caret drives expand. | ✓ |
| Full-row click = open strategy detail side panel | Over-engineered; clashes with expand. | |
| Expand + in-widget edit affordance | Phase 1 D-17 allows editing; Holdings banner is the canonical edit surface. | |

**User note:** `/strategies/[id]` verified to exist at `src/app/(dashboard)/strategies/[id]`.

### Q: Continue or advance?

User selected "Next area" — defer Date Recorded source + Allocated-pill percent format to Claude's Discretion. Lean: `allocated_at` with `created_at` fallback; "Allocated 12%" inline.

---

## Area 2: Sparkline rendering

### Q: Sparkline count per expanded row

| Option | Description | Selected |
|--------|-------------|----------|
| 3 sparklines — one per window | 30d / 90d / 180d each get a mini chart; matches DASHBOARD-04 plural wording. | ✓ |
| 1 sparkline with 3 markers | Single longer chart; 30d divergence visually crushed. | |
| 3 sparklines + 1 summary chart | Over-engineered. | |
| 1 sparkline + 3 delta numbers (no per-window charts) | Contradicts DASHBOARD-04 plural. | |

### Q: Rendering library

| Option | Description | Selected |
|--------|-------------|----------|
| Recharts `<LineChart>` with hidden axes | Reuses recharts@3.8.1 already in stack; consistent with 39 existing widgets. | ✓ |
| Recharts `<Sparklines>` variant if available | Planner verifies during research. | |
| Pure inline SVG micro-component | No lib overhead; new pattern; diverges from established style. | |
| New sparkline library | Rejected; Phase 2 D-16 precedent (no new deps). | |

### Q: Data shape (rebasing)

| Option | Description | Selected |
|--------|-------------|----------|
| Rebased to 100 at allocated_at | Standard institutional convention; divergence visually obvious. | ✓ |
| Absolute cumulative returns from allocated_at | Same info, different axis label. | |
| Raw NAV values | Divergence hidden if NAV scales differ. | |
| Delta series only (replacement − original) | Single line; DASHBOARD-04 requires two curves. | |

### Q: NULL-delta window handling

| Option | Description | Selected |
|--------|-------------|----------|
| 'Pending' pill + grey placeholder | Matches Phase 1 D-14 (surface Pending, hide errors); symmetric columns. | ✓ |
| Hide the column entirely for that row | Asymmetric rows; breaks table alignment. | |
| 'Pending' number + partial sparkline up to most-recent day | More helpful but needs returns_series regardless. | |
| Em-dash + blank sparkline | Em-dash is for N/A; Pending carries 'coming soon' semantic. | |

### Q: Continue or advance?

User selected "Next area" — defer line colors to Claude's Discretion. Lean: replacement = accent `#1B6B5A`, original = muted `#94A3B8` (DESIGN.md chart convention); tone color (green/red) on delta NUMBER only.

---

## Area 3: KPI semantics

### Q: Win rate definition

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Phase 4 feedback engine | Numerator = allocated-with-delta > 0; denominator = allocated with ≥1 non-NULL delta AND percent_allocated ≥ 1%; same filters as `feedback_engine.py`. | ✓ |
| All-outcomes rule (rejected = loss) | Penalizes allocator discipline. | |
| Allocated-only simplest | Ignores Phase 4 noise filters. | |
| Percentage-weighted by allocation size | Complex; implicit second KPI. | |

### Q: Avg realized delta

| Option | Description | Selected |
|--------|-------------|----------|
| Avg of most-mature delta per row | Matches Best Available Delta timeline cell + Phase 4 attribution math. | ✓ |
| Avg of 180d delta only | Apples-to-apples but blank for young allocators. | |
| Separate 30/90/180 avgs side-by-side | Breaks one-number-per-KPI convention. | |
| Delta-dollar-weighted avg | More rigorous; defer. | |

### Q: Total outcomes recorded

| Option | Description | Selected |
|--------|-------------|----------|
| All bridge_outcomes rows | Matches timeline row count; reconciles 1:1. | ✓ |
| All rows minus noise | Creates KPI-vs-row-count dissonance. | |
| Allocated-only count | Narrows misleadingly. | |
| Allocated + Rejected split | Breaks one-number convention. | |

### Q: Pending outcome surfacing

| Option | Description | Selected |
|--------|-------------|----------|
| Sub-label under avg delta: 'N pending' | Institutional factsheet convention; doesn't inflate counts. | ✓ |
| Separate Pending counter | 4th KPI; violates DASHBOARD-02 literal (3 KPIs). | |
| Hide entirely | Silent exclusion; erodes trust. | |
| Surface only in empty/partial state | Asymmetric copy. | |

---

## Area 4: Data loading + widget registration

### Q: Query surface

| Option | Description | Selected |
|--------|-------------|----------|
| Extend getMyAllocationDashboard | Single round-trip; matches existing WidgetProps pattern. | ✓ |
| New /api/bridge/outcomes GET route | Separate endpoint; diverges from established widget data pattern. | |
| Hybrid: list via bulk query, sparkline lazy on expand | Sparkline-data lazy aligned with D-16; base list in bulk query already captured here. | |
| All via new router + replace bulk path | Over-churn. | |

### Q: Sparkline returns_series load strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy on expand | Client-side fetch on caret click; session-cached; lean payload. | ✓ |
| Eager in bulk query | Heavy page-load payload. | |
| Eager first 10 + lazy rest | Complexity without benefit. | |
| Server-side pre-computed curve points | Smallest payload; more server CPU; defer optimization. | |

### Q: Widget category

| Option | Description | Selected |
|--------|-------------|----------|
| New 'outcomes' category | 8th category; room for future outcome-adjacent widgets. | ✓ |
| Reuse 'attribution' | Portfolio-level vs recommendation-level mismatch. | |
| Reuse 'monitoring' | Operational vs historical mismatch. | |
| Reuse 'meta' | Dashboard-config vs content mismatch. | |

### Q: Widget registration defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Full-width, tall, default-visible | defaultW: 12, defaultH: 5; critical for demo. | ✓ |
| Full-width, tall, opt-in | Safe but misses demo. | |
| Half-width, default-visible | Timeline columns too cramped at 6 columns. | |
| Let planner pick dimensions | Default-visibility decision locked regardless. | |

---

## Claude's Discretion

- "Date Recorded" column source — `allocated_at` with `created_at` fallback for rejected rows
- "Allocated X%" inline in Status pill — lean YES (matches OutcomeRecordedRow Phase 1 D-11)
- Sparkline line colors — replacement = `#1B6B5A` accent, original = `#94A3B8` muted (DESIGN.md chart convention); tone color on delta NUMBER only
- Default layout entry file — `AllocationDashboard.tsx` vs `MyAllocationClient.tsx`
- Exact lazy-fetch endpoint path + response shape
- Caching mechanism (react-query / SWR / plain memo)
- Empty state CTA target (DASHBOARD-05)
- Loading skeleton row count + animation
- Error state retry affordance
- KPI strip layout (grid vs flex, dividers)
- Sparkline exact pixel dimensions (height, stroke width)
- Expand/collapse animation duration
- Row hover state styling
- Widget icon glyph
- Test file placement + component directory split

## Deferred Ideas

See CONTEXT.md `<deferred>` section — 16 items including admin cross-allocator view, weight-override visualization, counterfactual deltas, in-widget edit, pagination, mobile polish, PDF export, grouped sparkline, dollar-weighted win rate.
