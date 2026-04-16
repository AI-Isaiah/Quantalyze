# PostHog Usage Funnel Runbook

Operator guide for the allocator usage funnel instrumented in Sprint 5
Task 5.5. The instrumentation fires five events from across the app —
this doc explains where each fires, where to view them in PostHog, how
to invalidate the admin-page cache, and how to triage common failure
modes.

The admin-facing surface is `/admin/usage` (server component, admin
gate via `isAdminUser`). Source of truth for `session_count` is
`auth.users.raw_user_meta_data.session_count`, NOT PostHog —
PostHog is the event sink + dashboard query target only.

## Events being tracked

| Event | Fires from | distinctId | Properties |
|---|---|---|---|
| `session_start` | `POST /api/usage/session-start` (called from `AllocationDashboard.tsx` on mount) | auth user id | `session_count` |
| `widget_viewed` | `AllocationDashboard.tsx` IntersectionObserver, first 50% visibility per widget per session | client posthog distinct_id (identified after `identifyUsageUser`) | `widget_id` |
| `intro_submitted` | `POST /api/intro` after successful insert | auth user id | `source` (direct\|bridge), `strategy_id` |
| `bridge_click` | `BridgeTrigger.tsx` Find-Replacement click | client posthog distinct_id | `strategy_id` |
| `alert_acknowledged` | `POST /api/alerts/[id]/acknowledge` AND `POST /api/alerts/ack` (email) | auth user id (in-app), portfolio owner id (email path) | `alert_id`, `alert_type`, `source: "email"` on the email path |

All events carry `source_layer = "server" | "client"` so PostHog
filters can split the funnel by where it was emitted from.

## Server-side `session_count` debounce

Two-tabs / refresh churn is collapsed at the API layer. The
`/api/usage/session-start` route reads
`user_metadata.last_session_start_at`; if it's within the last 30
minutes, the route returns `{ debounced: true }` and DOES NOT
increment, DOES NOT fire the PostHog event. This keeps the funnel
denominator honest and the persisted counter clean.

If you ever need to reset a single allocator's counter (QA, support
escalation), you can do it via the Supabase SQL editor:

```sql
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data
  - 'session_count'
  - 'last_session_start_at'
WHERE id = '<allocator_uuid>';
```

The next call to `/api/usage/session-start` will start counting from 1
again and fire a fresh PostHog event.

## Where to view the events in PostHog

1. PostHog → Activity → Events. Filter `event` to one of the five
   names above. Verify the property shape matches the table.
2. PostHog → Insights → New insight → Trends. Add each event as a
   series, breakdown by `source_layer` if needed.
3. The /admin/usage page is the canonical operator view. It runs three
   HogQL queries via `src/lib/admin/usage-metrics.ts`:
   - `dailyFunnel(30)` — per-day count of each event.
   - `widgetViews(30)` — per-`widget_id` view + unique-allocator counts.
   - `sessionHeatmap(14)` — per-allocator daily session counts.

## Cache invalidation

`src/lib/admin/usage-metrics.ts` keeps an in-process last-known-good
cache with a 5-minute TTL per query key. The cache is ONLY consulted
when the live PostHog request fails (timeout, 5xx after retry, etc.) —
fresh requests always hit PostHog directly. So the cache cannot make
the admin page show stale data unless PostHog is currently down.

If you need to flush the cache (e.g., to confirm a hotfix landed),
the cleanest way is a fresh deploy — the in-process cache lives only
in the Vercel function instance. The `__resetUsageMetricsCacheForTest`
export is for unit tests, not for production use.

## Required env vars

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | client + server | Public capture key. Without it, all events are no-ops with one startup warning. |
| `NEXT_PUBLIC_POSTHOG_HOST` | client + server | Optional. Defaults to `https://us.i.posthog.com`. |
| `POSTHOG_API_KEY` | server only | Personal API key (read-only is fine). Required for `/admin/usage`. Without it, the admin page renders the "PostHog API key not configured" notice. |
| `POSTHOG_PROJECT_ID` | server only | Numeric project id. Required for `/admin/usage`. |
| `POSTHOG_HOST` | server only | Optional. Defaults to `https://us.posthog.com` (the API host, NOT the capture host — note the missing `i.`). |

## Troubleshooting

**Symptom:** /admin/usage shows "PostHog unavailable" for every section.

- Check that `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` are set in the
  Vercel env. The PostHog HTTP API returns 401 without the bearer
  token, which surfaces as the "PostHog unavailable" notice.
- Hit the PostHog URL directly with `curl` to confirm the key works:
  `curl -H "Authorization: Bearer $POSTHOG_API_KEY" "$POSTHOG_HOST/api/projects/$POSTHOG_PROJECT_ID/query/" -d '{"query":{"kind":"HogQLQuery","query":"SELECT 1"}}'`.

**Symptom:** Events show up in PostHog Activity but `/admin/usage`
tables are empty.

- HogQL `properties.widget_id` returns `NULL` if the property name on
  the event differs. Open one `widget_viewed` event in PostHog and
  confirm the property is literally `widget_id`.
- The 5-minute cache may be holding an empty result from an earlier
  failed query. Redeploy to flush.

**Symptom:** `session_count` in user_metadata doesn't increment.

- The 30-min debounce is the most common cause. Check
  `user_metadata.last_session_start_at` against `now()`.
- The route requires a valid Supabase session cookie AND
  `assertSameOrigin` — a curl call without the cookies / Origin will
  401 or 403, which the client fire-and-forget swallows silently.

**Symptom:** `widget_viewed` fires multiple times for the same widget.

- The IntersectionObserver dedupe key is per-page-load (a `Set` on a
  `useRef`). Navigating away and back is a new page load and is
  expected to re-fire. If the same widget is firing twice within one
  page load, check that the observer is being disconnected when the
  threshold is met.

**Symptom:** Email-ack `alert_acknowledged` event is missing the
allocator's id.

- The email ack path has no logged-in session. We resolve the
  allocator via `portfolios.user_id` from the alert's `portfolio_id`.
  If that lookup fails (deleted portfolio, etc.) we still fire the
  event with a synthetic `alert:<id>` distinctId so the funnel count
  stays accurate.

## Adding a new usage event

1. Add the event name to BOTH unions:
   - `src/lib/analytics/usage-events.ts` (server)
   - `src/lib/analytics/usage-events-client.ts` (client)
2. Wire the call site (server: `trackUsageEventServer`, client:
   `trackUsageEventClient`).
3. Update `src/lib/admin/usage-metrics.ts`:
   - Add the column to `DailyFunnelRow` and `emptyDailyRow`.
   - Add the event to the `IN (...)` list in `dailyFunnel`'s HogQL.
   - Add the column to `dailyFunnel`'s table render in
     `src/app/(dashboard)/admin/usage/page.tsx`.
4. Update this runbook's events table.
