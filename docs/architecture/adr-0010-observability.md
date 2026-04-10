# ADR-0010: Observability -- no Sentry, console-only logging, Plausible for client analytics

## Status
Proposed (decision needed before shipping to real pilot allocators)

## Context
The application has a stated intent to use Sentry (declared in
`.env.example` and referenced aspirationally in docs) but has not wired
it. All server-side errors fall to `console.error` (56 occurrences across
30 files), which on Vercel goes to runtime logs with no alerting, no
aggregation, and no PII scrubbing.

Critical gaps:
- **No error boundaries**: Zero `error.tsx` or `global-error.tsx` files
  exist. A Server Component throw cascades to Next's default error surface
  (see ADR-0018).
- **No centralized error tracking**: No Sentry, no BetterStack, no Axiom.
- **No PII scrubbing policy**: The product handles exchange API keys,
  user emails, and IP addresses. Many `console.error` calls include
  user-identifying information.
- **Client analytics only**: Plausible is embedded via `next/script` for
  page-view analytics (privacy-friendly, no cookies).
- **Python service has conditional Sentry**: `analytics-service/main.py`
  (lines 14-26) initializes Sentry only if `SENTRY_DSN` is set.

## Decision
**Open question -- one of the following options must be chosen:**

### Option A: Adopt `@sentry/nextjs`
- Install `@sentry/nextjs` with source maps upload.
- Configure PII scrubbing (strip emails, IPs, exchange key IDs).
- Add `sentry.client.config.ts` and `sentry.server.config.ts`.
- Wire error boundaries (see ADR-0018) to report to Sentry.
- Unify with the Python service's existing conditional Sentry.

### Option B: Vercel Log Drains to external provider
- Use Vercel Log Drains to pipe runtime logs to BetterStack or Axiom.
- Add structured logging (replace `console.*` with a logger abstraction).
- No client-side error capture unless paired with a lightweight reporter.

### Option C: Console + Vercel logs only for v1
- Accept the current state explicitly.
- Add a `logger` abstraction that wraps `console.*` with PII scrubbing.
- Set a tripwire: "revisit at 10 pilot allocators or first production
  incident."
- Add route-level `error.tsx` boundaries (ADR-0018) to prevent white
  screens.

### Sub-decisions (required regardless of option)
1. **Route-level `error.tsx` boundaries**: See ADR-0018. At minimum,
   `(dashboard)/error.tsx` and `(auth)/error.tsx` should exist.
2. **Logger abstraction**: Replace raw `console.*` calls with a single
   `logger` module that applies PII scrubbing rules.
3. **PII scrubbing policy**: Define what must never appear in logs
   (exchange API keys, user emails, IP addresses, JWTs).

### Recommendation
Option A (`@sentry/nextjs`) for the frontend, unified with the Python
service's existing Sentry support. This provides error aggregation,
alerting, and source-map-powered stack traces with minimal operational
overhead. Paired with a PII scrubbing policy and the `error.tsx`
boundaries from ADR-0018.

## Consequences

### Positive
- Any chosen option is better than the current state of unstructured
  console logging.
- PII scrubbing policy protects against accidental credential exposure
  in logs.

### Negative
- Every option requires an explicit PII scrubbing policy -- the app
  currently logs emails, user IDs, and IP addresses in many places.
- Sentry adds a client-side bundle cost (~20KB gzipped).
- Ongoing cost for Sentry or log drain provider.

## Evidence
- No Sentry in `package.json` dependencies.
- `.env.example` (line 14): declares `NEXT_PUBLIC_SENTRY_DSN` but no
  code reads it.
- Python Sentry: `analytics-service/main.py` (lines 14-26).
- Plausible: `src/app/layout.tsx` (lines 27-48).
- Console error count: 56 `console.error` / `console.warn` occurrences
  across 30 files.
- Zero `error.tsx` files: no matches in `src/app/`.
- Zero `global-error.tsx` files: no matches in `src/app/`.
- Aspirational Sentry references: `docs/pitch/`,
  `docs/demos/pre-flight-checklist.md`.
