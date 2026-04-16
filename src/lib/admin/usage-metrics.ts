import "server-only";

/**
 * PostHog HTTP query helpers for the /admin/usage funnel page.
 *
 * Why this lives in `src/lib/admin/`: the page is admin-only and the
 * helpers all hit the PostHog server-side personal API key
 * (`POSTHOG_API_KEY`), which is separate from the public capture key
 * (`NEXT_PUBLIC_POSTHOG_KEY`). Mixing them in `src/lib/analytics/`
 * would invite a wrong-key import; admin-side reads stay segregated.
 *
 * Resilience contract:
 *   - 10s timeout per request via `AbortSignal.timeout`.
 *   - One retry on transient 5xx (exponential 500ms → 1.5s).
 *   - Last-known-good in-memory cache with a 5min TTL — if PostHog
 *     hard-fails AND we have a cached payload, we return the cached
 *     payload. This keeps the admin page rendering during PostHog
 *     incidents.
 *   - On total failure with no cache, returns the empty-shape result
 *     with `error: "PostHog unavailable"` so the page can show a
 *     small notice instead of crashing.
 *
 * Fairness note: PostHog's HTTP API supports HogQL queries via
 * `POST /api/projects/<id>/query/`. We use HogQL exclusively here
 * because it's the only PostHog endpoint that lets us aggregate by
 * day with arbitrary breakdowns in a single round-trip — the legacy
 * `/insights/trend/` endpoint is supported for compat only.
 */

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.posthog.com";
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? "";
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? "";

import { USAGE_EVENTS, type UsageEvent } from "@/lib/analytics/usage-events-types";

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

type UsageEventName = UsageEvent;

// ---------------------------------------------------------------------------
// Public response shapes
// ---------------------------------------------------------------------------

export interface DailyFunnelRow {
  day: string; // YYYY-MM-DD
  session_start: number;
  widget_viewed: number;
  intro_submitted: number;
  bridge_click: number;
  alert_acknowledged: number;
}

export interface DailyFunnelResult {
  rows: DailyFunnelRow[];
  error?: string;
}

export interface WidgetViewRow {
  widget_id: string;
  views: number;
  unique_allocators: number;
}

export interface WidgetViewsResult {
  rows: WidgetViewRow[];
  error?: string;
}

export interface SessionHeatmapRow {
  email: string;
  /** Per-day session counts keyed by YYYY-MM-DD. Missing day = 0. */
  by_day: Record<string, number>;
  total: number;
}

export interface SessionHeatmapResult {
  rows: SessionHeatmapRow[];
  days: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// In-memory last-known-good cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function readCache<T>(key: string): { value: T; storedAt: number } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) return null;
  return { value: entry.value, storedAt: entry.storedAt };
}

function writeCache<T>(key: string, value: T): void {
  // Sweep expired entries on write — bounds the working set during
  // sustained PostHog incidents and keeps the LRU eviction below from
  // dropping rows that would naturally have aged out.
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now - entry.storedAt > CACHE_TTL_MS) cache.delete(k);
  }
  cache.set(key, { value, storedAt: now });
  // Cap the map (Maps preserve insertion order → oldest is first).
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function staleBannerMessage(storedAt: number): string {
  const iso = new Date(storedAt).toISOString();
  return `PostHog unavailable — showing cached data from ${iso}`;
}

/** Reset for tests. Do NOT call from production code. */
export function __resetUsageMetricsCacheForTest(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// HogQL HTTP helper with timeout + retry
// ---------------------------------------------------------------------------

interface HogQLResult {
  results: unknown[][];
  columns?: string[];
}

async function runHogQL(query: string): Promise<HogQLResult> {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    throw new Error("PostHog API key or project id missing");
  }

  const url = `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`;
  const body = JSON.stringify({
    query: { kind: "HogQLQuery", query },
  });

  const attempt = async (): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${POSTHOG_API_KEY}`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  };

  let res: Response;
  try {
    res = await attempt();
  } catch (err) {
    // Network/timeout — retry once after 500ms.
    await new Promise((r) => setTimeout(r, 500));
    res = await attempt().catch(() => {
      throw err;
    });
  }

  // Retry once on 5xx with exponential backoff (500ms → 1.5s).
  if (res.status >= 500 && res.status < 600) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await attempt();
  }

  if (!res.ok) {
    throw new Error(`PostHog HogQL ${res.status}`);
  }

  const json = (await res.json()) as HogQLResult;
  if (!Array.isArray(json.results)) {
    throw new Error("PostHog HogQL returned malformed result");
  }
  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDay(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function emptyDailyRow(day: string): DailyFunnelRow {
  return {
    day,
    session_start: 0,
    widget_viewed: 0,
    intro_submitted: 0,
    bridge_click: 0,
    alert_acknowledged: 0,
  };
}

function isUsageEvent(name: string): name is UsageEventName {
  return (USAGE_EVENTS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Daily funnel: rows = day, columns = each event count.
 * Returns the last `days` days inclusive.
 */
export async function dailyFunnel(days: number = 30): Promise<DailyFunnelResult> {
  if (!POSTHOG_API_KEY) {
    console.warn("[usage-metrics] POSTHOG_API_KEY not set — dailyFunnel returns empty");
    return { rows: [], error: "PostHog API key not configured" };
  }

  const cacheKey = `dailyFunnel:${days}`;
  try {
    const query = `
      SELECT toDate(timestamp) AS day, event, count(*) AS c
      FROM events
      WHERE event IN ('session_start','widget_viewed','intro_submitted','bridge_click','alert_acknowledged')
        AND timestamp >= now() - INTERVAL ${days} DAY
      GROUP BY day, event
      ORDER BY day ASC
    `;
    const json = await runHogQL(query);

    const byDay = new Map<string, DailyFunnelRow>();
    for (const row of json.results) {
      const [day, event, c] = row as [unknown, unknown, unknown];
      const dayKey = isoDay(day);
      const eventName = String(event);
      if (!isUsageEvent(eventName)) continue;
      const existing = byDay.get(dayKey) ?? emptyDailyRow(dayKey);
      existing[eventName] = Number(c) || 0;
      byDay.set(dayKey, existing);
    }

    const rows = Array.from(byDay.values()).sort((a, b) =>
      a.day < b.day ? 1 : -1,
    );
    const result: DailyFunnelResult = { rows };
    writeCache(cacheKey, result);
    return result;
  } catch (err) {
    const cached = readCache<DailyFunnelResult>(cacheKey);
    if (cached) {
      // Surface the staleness so the page renders a banner instead of
      // pretending the data is fresh.
      return { ...cached.value, error: staleBannerMessage(cached.storedAt) };
    }
    console.warn(
      "[usage-metrics] dailyFunnel failed, no cache:",
      err instanceof Error ? err.message : String(err),
    );
    return { rows: [], error: "PostHog unavailable" };
  }
}

/**
 * Widget views: rows = widget id, columns = total views + unique allocators.
 */
export async function widgetViews(days: number = 30): Promise<WidgetViewsResult> {
  if (!POSTHOG_API_KEY) {
    console.warn("[usage-metrics] POSTHOG_API_KEY not set — widgetViews returns empty");
    return { rows: [], error: "PostHog API key not configured" };
  }

  const cacheKey = `widgetViews:${days}`;
  try {
    const query = `
      SELECT properties.widget_id AS widget_id,
             count(*) AS views,
             count(DISTINCT distinct_id) AS unique_allocators
      FROM events
      WHERE event = 'widget_viewed'
        AND timestamp >= now() - INTERVAL ${days} DAY
        AND properties.widget_id IS NOT NULL
      GROUP BY widget_id
      ORDER BY views DESC
    `;
    const json = await runHogQL(query);

    const rows: WidgetViewRow[] = json.results
      .map((r) => {
        const [widget_id, views, unique_allocators] = r as [
          unknown,
          unknown,
          unknown,
        ];
        return {
          widget_id: String(widget_id ?? ""),
          views: Number(views) || 0,
          unique_allocators: Number(unique_allocators) || 0,
        };
      })
      .filter((r) => r.widget_id.length > 0);

    const result: WidgetViewsResult = { rows };
    writeCache(cacheKey, result);
    return result;
  } catch (err) {
    const cached = readCache<WidgetViewsResult>(cacheKey);
    if (cached) {
      return { ...cached.value, error: staleBannerMessage(cached.storedAt) };
    }
    console.warn(
      "[usage-metrics] widgetViews failed, no cache:",
      err instanceof Error ? err.message : String(err),
    );
    return { rows: [], error: "PostHog unavailable" };
  }
}

/**
 * Session heatmap: per-allocator session counts over the last `days` days.
 *
 * Joins distinct_id (which equals the auth user id for identified
 * users) → email via the caller. PostHog HogQL doesn't have access to
 * Supabase tables, so we return distinct_id keyed by `email` filled
 * in by the caller via a Supabase profile lookup. We DO key by
 * distinct_id internally and rename to `email` after the join.
 */
export async function sessionHeatmap(
  days: number = 14,
): Promise<SessionHeatmapResult> {
  if (!POSTHOG_API_KEY) {
    console.warn(
      "[usage-metrics] POSTHOG_API_KEY not set — sessionHeatmap returns empty",
    );
    return { rows: [], days: [], error: "PostHog API key not configured" };
  }

  const cacheKey = `sessionHeatmap:${days}`;
  try {
    const query = `
      SELECT distinct_id, toDate(timestamp) AS day, count(*) AS c
      FROM events
      WHERE event = 'session_start'
        AND timestamp >= now() - INTERVAL ${days} DAY
      GROUP BY distinct_id, day
      ORDER BY distinct_id, day
    `;
    const json = await runHogQL(query);

    const byUser = new Map<string, Record<string, number>>();
    const dayKeys = new Set<string>();
    for (const row of json.results) {
      const [distinctId, day, c] = row as [unknown, unknown, unknown];
      const userKey = String(distinctId ?? "");
      const dayKey = isoDay(day);
      if (!userKey) continue;
      dayKeys.add(dayKey);
      const existing = byUser.get(userKey) ?? {};
      existing[dayKey] = Number(c) || 0;
      byUser.set(userKey, existing);
    }

    const rows: SessionHeatmapRow[] = Array.from(byUser.entries()).map(
      ([userKey, by_day]) => ({
        email: userKey, // page-level join replaces this with the real email
        by_day,
        total: Object.values(by_day).reduce((sum, n) => sum + n, 0),
      }),
    );

    rows.sort((a, b) => b.total - a.total);

    const sortedDays = Array.from(dayKeys).sort();
    const result: SessionHeatmapResult = { rows, days: sortedDays };
    writeCache(cacheKey, result);
    return result;
  } catch (err) {
    const cached = readCache<SessionHeatmapResult>(cacheKey);
    if (cached) {
      return { ...cached.value, error: staleBannerMessage(cached.storedAt) };
    }
    console.warn(
      "[usage-metrics] sessionHeatmap failed, no cache:",
      err instanceof Error ? err.message : String(err),
    );
    return { rows: [], days: [], error: "PostHog unavailable" };
  }
}
