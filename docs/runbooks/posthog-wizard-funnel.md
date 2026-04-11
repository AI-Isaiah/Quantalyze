# PostHog Wizard Funnel Dashboard

Setup recipe for the "Connect Your Strategy" wizard funnel in PostHog.
Task 1.2 wired 16 events into the client + server but did NOT build
the PostHog UI dashboard — the ship metric (5 wizard-onboarded
strategies reach `pending_review` within 24h of wizard start) is
unobservable until these insights exist.

This is a one-time, ~15 minute manual setup in the PostHog web UI.
Nothing here is code. Once the insights are saved, the ship-metric
check is a single dashboard URL.

## Prerequisites

- PostHog project access (same project as the `/for-quants` landing
  events — we reuse the existing app, no new project needed).
- At least one real wizard run has fired in staging or prod so that
  the event schema shows up in PostHog's autocomplete.

## Events being tracked (from `src/lib/analytics.ts` — source of truth)

All wizard events carry the `wizard_session_id` property. That is the
correlation key for every insight below.

| Event | Fires from | Properties of interest |
|---|---|---|
| `wizard_start` | WizardClient mount | `wizard_session_id`, `resume` (bool) |
| `wizard_step_view_1..4` | Each step render | `wizard_session_id`, `step` |
| `wizard_step_complete_1..4` | User clicks next | `wizard_session_id`, `step`, `strategy_id` (step 2+), `exchange`, `trade_count` (step 2+) |
| `wizard_submit_success` | Finalize OK | `wizard_session_id`, `strategy_id` |
| `wizard_error` | Any step hits a `wizardErrors` code | `wizard_session_id`, `code`, `step` |
| `wizard_abandon` | User navigates away w/o completing | `wizard_session_id`, `step` |
| `wizard_resume` | localStorage pointer restored on mount | `wizard_session_id` |
| `wizard_delete_draft` | User hits "Delete draft" | `wizard_session_id` |
| `wizard_try_different_key` | Gate failure → restart ConnectKeyStep | `wizard_session_id`, `code` |
| `wizard_request_call_click` | Fallback CTA inside wizard | `wizard_session_id`, `step` |

## Insight 1 — Wizard completion funnel

**Why it exists:** this is the ship metric. Shows what fraction of
wizard starts finish the submit step, with conversion rates at each
stage so the worst drop-off is obvious.

1. PostHog → Insights → New insight → **Funnels**.
2. Name: `Wizard completion funnel`.
3. Steps (in order):
   1. `wizard_start`
   2. `wizard_step_complete_1`
   3. `wizard_step_complete_2`
   4. `wizard_step_complete_3`
   5. `wizard_submit_success`
4. **Aggregation:** Unique users (default). We want
    user-level, not event-level.
5. **Attribution window:** 24 hours — matches the ship metric.
6. **Filter:** no global filter (keep it wide). If landing-page CTA
    traffic pollutes the count, add `where $current_url contains
    /strategies/new/wizard` on step 1 — but usually unnecessary
    because `wizard_start` only fires on the wizard route.
7. Save to a new dashboard named `Wizard — Sprint 1`.

## Insight 2 — Step-level drop-off breakdown

**Why it exists:** completion funnel tells you IF people drop, not
WHY. This splits the abandonment / error signal by step.

1. New insight → **Trends**.
2. Name: `Wizard step drop-off by reason`.
3. Series:
    - A: `wizard_abandon`, breakdown by `step`
    - B: `wizard_error`, breakdown by `code`
    - C: `wizard_delete_draft`
4. Display: stacked bar, 7-day window.
5. Add to dashboard `Wizard — Sprint 1`.

## Insight 3 — Top error codes

**Why it exists:** `wizardErrors.ts` has 16 codes. Sprint 2 prioritizes
whichever codes are firing in real runs. Without this insight the
error matrix is blind.

1. New insight → **Trends**.
2. Name: `Top wizard error codes`.
3. Series: `wizard_error`, math = Total count, **breakdown by `code`**.
4. Chart type: bar chart (not line — we want rank, not time).
5. Display: top 10.
6. Time range: last 30 days.
7. Add to dashboard.

## Insight 4 — Time-to-submit histogram

**Why it exists:** the 4-7 minute target from the DX review is a
design assumption. This measures it.

1. New insight → **Trends**.
2. Name: `Median time from wizard_start to wizard_submit_success`.
3. Use **Paths** OR **Formulas** to compute the delta between
    first `wizard_start` and first `wizard_submit_success` for each
    `wizard_session_id`. PostHog calls this a "Lifecycle" or
    "Session recording" depending on version — the simplest path is
    to export the wizard_session_id + timestamp via the Data
    Warehouse and compute P50 / P90 externally.
4. If PostHog export is too heavy, a good-enough substitute is a
    funnel insight with the "Time to convert" histogram enabled on
    insight 1 — PostHog shows it automatically under the funnel.

## Insight 5 — Conversion by exchange

**Why it exists:** Binance vs OKX vs Bybit. If one exchange has
2x the drop-off, that's a product bug (e.g., OKX passphrase UX
is broken), not a funnel problem.

1. Clone insight 1 (`Wizard completion funnel`).
2. Name: `Wizard completion by exchange`.
3. Add global breakdown: `exchange` property (comes from
    `wizard_step_complete_1`).
4. PostHog will render one funnel per exchange. Save to dashboard.

## Dashboard layout

Arrange on dashboard `Wizard — Sprint 1`:

- Row 1: Insight 1 (completion funnel) — full-width hero.
- Row 2: Insight 3 (top error codes) + Insight 4 (time-to-submit)
    side by side.
- Row 3: Insight 2 (drop-off breakdown) + Insight 5 (exchange split)
    side by side.

Pin the dashboard to the PostHog sidebar so the founder can hit it
with one click during the Week 1 retro.

## Ship-metric check query (one-liner)

The formal ship metric is _"5 wizard-onboarded strategies reach
`pending_review` within 24h of wizard start with zero support
tickets"_. The first half lives in PostHog (Insight 1). The second
half — DB truth — is a single SQL query runnable against Supabase:

```sql
SELECT COUNT(*) AS wizard_pending
FROM strategies
WHERE source = 'wizard'
  AND status = 'pending_review'
  AND created_at >= now() - interval '24 hours';
```

When this returns 5 and Insight 1's PostHog funnel agrees, the ship
metric is satisfied. If PostHog says 5 and the SQL says 3, investigate
`finalize_wizard_strategy` RPC failures — the front end thought it
submitted but the DB didn't accept.

## When to extend this dashboard

- Sprint 2: add an insight for `wizard_request_call_click` by step —
  shows where users bail to the human path. Drives copy polish.
- Sprint 3 (allocator intent): add a cohort of quant teams who
  finished the wizard + received an allocator intro, to measure
  the full supply→match funnel.
- If the `wizard_error` top code becomes dominant (>40% of errors),
  escalate to P0 and fix before optimizing anything else in this
  dashboard.
