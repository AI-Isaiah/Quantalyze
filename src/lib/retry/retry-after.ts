/**
 * Shared `Retry-After` header parser (B20).
 *
 * RFC 9110 §10.2.3 permits TWO forms for `Retry-After`:
 *   - delta-seconds: a non-negative integer seconds count   — `"120"`
 *   - HTTP-date:     an absolute time                        — `"Wed, 21 Oct 2026 07:28:00 GMT"`
 *
 * Our own routes emit delta-seconds, but the client must never assume that: a
 * 429 can originate UPSTREAM of route.ts (Vercel edge / WAF / Upstash), and any
 * intervening proxy or CDN may inject or rewrite the header — legitimately as an
 * HTTP-date, or as an empty / garbage value. `Number("Wed, 21 Oct…")` is `NaN`
 * and `Number("")` is `0`; feeding either into a `setTimeout` backoff collapses
 * it to a ~0 ms hot-retry that re-trips the very limiter the 429 is signalling —
 * the NEW-C05-01 thundering-herd root cause.
 *
 * This is the single by-construction guard for that whole class. It returns a
 * STRICTLY POSITIVE seconds count, or `null` when the header is absent /
 * unparseable / non-positive. It NEVER returns `NaN`, `0`, or a negative — so a
 * caller's `?? fallback` and clamp cannot be defeated by a hostile header.
 *
 * The HTTP-date form is resolved against the response's OWN `Date` header
 * (server clock), not the client clock — a client whose clock is skewed must not
 * over- or under-wait. When no `Date` header is present the delta is not reliably
 * knowable, so the header is treated as unparseable (→ `null`) and the caller
 * falls back to its default. Callers apply their own clamp: a backoff sleep
 * bounds the value (e.g. `[1, 30]s`); an advisory countdown uses it raw.
 */

/** Minimal structural shape of a `Headers`-like object (real `Headers`, a
 *  `Response.headers`, or a test double). `get` may be absent on a loose mock,
 *  so call sites and this parser access it defensively. */
export interface RetryAfterHeaders {
  get(name: string): string | null;
}

export function parseRetryAfterSeconds(
  headers: RetryAfterHeaders | null | undefined,
): number | null {
  const raw = headers?.get?.("Retry-After");
  if (raw == null || raw === "") return null;

  // delta-seconds form — the common case our own routes emit. `Number("")` is 0
  // and `Number("3abc")` is NaN; both are rejected below, never returned.
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds)) {
    return asSeconds > 0 ? asSeconds : null;
  }

  // HTTP-date form — resolve the delta against the response's own `Date` header
  // so a skewed client clock cannot distort the wait. No `Date` header → the
  // delta is not reliably knowable → unparseable (caller defaults).
  const retryAtMs = Date.parse(raw);
  const dateRaw = headers?.get?.("Date");
  const baseMs = dateRaw ? Date.parse(dateRaw) : NaN;
  if (Number.isFinite(retryAtMs) && Number.isFinite(baseMs)) {
    const seconds = Math.ceil((retryAtMs - baseMs) / 1000);
    return seconds > 0 ? seconds : null;
  }
  return null;
}
