import { scrubSharePath } from "@/lib/scrub-share-path";

// [#15] Env keys whose absence SILENTLY disables a production feature (no other
// loud signal exists). Surfaced once at startup so a missing key is visible in
// the deploy log instead of only when a customer-facing function quietly
// doesn't run — the exact failure mode behind the RESEND_API_KEY founder-LP
// incident. Warn-only: never crash a deploy over a soft-skip key. Keys that
// already fail loudly on their own (e.g. the Upstash limiter, which fail-CLOSEs
// + warns in prod) are intentionally omitted to avoid double-noise.
export const SOFT_SKIP_PROD_KEYS = [
  "RESEND_API_KEY", // email (founder-LP report, alert digests) silently skipped
  "SENTRY_DSN", // error tracking silently off
  "POSTHOG_API_KEY", // admin usage-metrics panel renders empty
  "NEXT_PUBLIC_POSTHOG_KEY", // /for-quants funnel events no-op
] as const;

export function warnUnsetSoftSkipKeys() {
  if (process.env.VERCEL_ENV !== "production") return;
  const unset = SOFT_SKIP_PROD_KEYS.filter((k) => !process.env[k]);
  if (unset.length > 0) {
    console.warn(
      `[startup] soft-skip features DISABLED in production — unset env keys: ${unset.join(", ")}. ` +
        `Set them in Vercel → Settings → Environment Variables if these features should run.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 164 / SHARE-01 — keep the recipient capability token out of Sentry.
// ---------------------------------------------------------------------------

/**
 * The URL-shaped fields of a Sentry event, described structurally rather than
 * imported from `@sentry/nextjs`.
 *
 * WHY STRUCTURAL: `@sentry/nextjs` is a DYNAMIC import in this file (it loads
 * only when `SENTRY_DSN` is set), so pulling its `ErrorEvent` /
 * `TransactionEvent` types into module scope would add a static type-only
 * dependency for no benefit. Every field below is read defensively at runtime,
 * so an event shape change in a future SDK version degrades to "that field was
 * not scrubbed" — never to a throw inside `beforeSend`, which would drop the
 * whole event.
 */
type ScrubbableEvent = {
  request?: { url?: unknown } | null;
  transaction?: unknown;
  breadcrumbs?: Array<{ message?: unknown; data?: unknown } | null> | null;
  spans?: Array<{ description?: unknown; data?: unknown } | null> | null;
  contexts?: { trace?: { description?: unknown; data?: unknown } | null } | null;
  extra?: Record<string, unknown> | null;
  tags?: Record<string, unknown> | null;
};

/**
 * Scrub every string ANYWHERE inside a loose value, in place — nested objects
 * and arrays included. Non-strings untouched.
 *
 * ⛔ THE SHALLOW VERSION LEAKED A LIVE TOKEN, MEASURED. This walked only the
 * top level and scrubbed `typeof value === "string"`, so any string one level
 * down survived. Captured off the wire from a real production build
 * (/qa 2026-08-28), driving a genuine 500 on `/factsheet-share/<token>` into a
 * local Sentry ingest and reading the transmitted bytes:
 *
 *     contexts.trace.data.http.target  /factsheet-share/QAuatNINEzzzz…  <- RAW
 *     contexts.trace.data.http.route   /factsheet-share/[token]         <- ok
 *
 * `http.target` is the OpenTelemetry semantic convention for the raw request
 * target, and Next's instrumentation sets it. `contexts.trace.data` is an
 * object, so the shallow walk skipped the whole subtree while `request.url`,
 * `transaction`, `extra.path` and `spans[].description` were all correctly
 * scrubbed one field away.
 *
 * ⚠️ Enumerating fields is what failed here, twice — `tags` was the first miss,
 * also found in production. So this recurses instead of naming more paths: a
 * future SDK version that adds another nested URL field is covered without an
 * edit. Depth is capped because `beforeSend` must never throw (a throw there
 * drops the event); 8 is far past any real Sentry event shape.
 */
function scrubRecordStrings(record: unknown, depth = 0): void {
  if (record == null || typeof record !== "object" || depth > 8) return;
  if (Array.isArray(record)) {
    for (let i = 0; i < record.length; i++) {
      const value: unknown = record[i];
      if (typeof value === "string") record[i] = scrubSharePath(value);
      else scrubRecordStrings(value, depth + 1);
    }
    return;
  }
  const obj = record as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string") obj[key] = scrubSharePath(value);
    else scrubRecordStrings(value, depth + 1);
  }
}

/**
 * Route every URL-shaped field of a Sentry event through the share-path
 * scrubber, in place, and return the event.
 *
 * ⛔ THIS IS THE ONLY REDACTION POINT FOR THE SHARE TOKEN ON THE SENTRY
 * CHANNEL, and it is net-new: there was no `beforeSend`, `beforeBreadcrumb` or
 * any other scrub anywhere in `src/` before phase 164. Under ruling D-01 the
 * token is a PATH SEGMENT, so it rides `request.url`, the transaction name,
 * breadcrumb messages and span descriptions — all of which Sentry sends to a
 * third-party event store.
 *
 * ⛔ SENTRY IS SERVER-ONLY IN THIS REPO. There is no client `Sentry.init` (no
 * `sentry.client.config.*`, no browser bundle initialisation) — verified at
 * phase 164. **Introducing one RE-OPENS the browser channel**: client-side
 * breadcrumbs record `location.href` on every navigation, and Session Replay
 * records the URL bar outright. A client init MUST adopt this same
 * `beforeSend` (and Replay's own URL masking) or the token leaks by a route
 * this function never sees. Do not add one without doing that.
 *
 * The mutation is deliberate — Sentry's `beforeSend` contract is "return the
 * event (possibly modified) or null to drop it", and cloning a large event on
 * every error would be waste for no gain.
 */
export function scrubSentryEvent<T>(event: T): T {
  const e = event as ScrubbableEvent | null;
  if (e == null || typeof e !== "object") return event;

  if (e.request && typeof e.request.url === "string") {
    e.request.url = scrubSharePath(e.request.url);
  }
  if (typeof e.transaction === "string") {
    e.transaction = scrubSharePath(e.transaction);
  }
  for (const crumb of e.breadcrumbs ?? []) {
    if (!crumb) continue;
    if (typeof crumb.message === "string") {
      crumb.message = scrubSharePath(crumb.message);
    }
    // Every string in `data`, not just `data.url`: the HTTP breadcrumb puts the
    // URL in `data.url`, but the fetch/xhr integrations have historically also
    // carried it under other keys, and scrubbing a non-URL string is a no-op.
    scrubRecordStrings(crumb.data);
  }
  for (const span of e.spans ?? []) {
    if (!span) continue;
    if (typeof span.description === "string") {
      span.description = scrubSharePath(span.description);
    }
    // Same shape as the trace context above: spans carry an attribute bag that
    // can hold `http.target`.
    scrubRecordStrings(span.data);
  }
  const trace = e.contexts?.trace;
  if (trace) {
    if (typeof trace.description === "string") {
      trace.description = scrubSharePath(trace.description);
    }
    // `trace.data` is where `http.target` lives — the raw request target. This
    // is the field that was measured leaking a live token off the wire.
    scrubRecordStrings(trace.data);
  }
  // `extra` is scrubbed as a backstop even though `onRequestError` below
  // already scrubs the one field it sets. Defence in depth costs nothing here
  // and covers any future `captureException` call that forwards a raw path.
  scrubRecordStrings(e.extra);
  // ⛔ TAGS — FOUND ON PRODUCTION, NOT BY REVIEW (/qa 2026-08-28). The SDK's own
  // http/Next integration sets a `url` TAG from the raw request URL, entirely
  // independently of `request.url`. Measured on live event QUANTALYZE-16:
  // `transaction` was parameterised to `GET /factsheet/[id]` while the `url`
  // tag carried `https://quantalyze.xyz/factsheet/Next.Metadata` verbatim. On
  // the share lane that tag would have carried a LIVE CAPABILITY, and a tag is
  // worse than a body field: tags are indexed and queryable in the Sentry UI.
  // The scrubber covered every channel it had thought of, and this was not one
  // of them — which is why the fixture below now carries a tag too.
  scrubRecordStrings(e.tags);

  return event;
}

/**
 * ⚠️ DUPLICATED, ON PURPOSE, AND THE DUPLICATION IS THE LESSER EVIL.
 *
 * The canonical floor is `MIN_SECRET_LENGTH` in `src/lib/strategy-share-token.ts`,
 * which is module-private. It cannot be imported here: that module validates the
 * secret at MODULE SCOPE and THROWS when it is missing, so importing it from the
 * instrumentation boot path would turn this soft, informative check into a crash
 * of the entire `register()` hook — the opposite of what a boot-time diagnostic is
 * for, and it would take the Sentry init down with it in exactly the environment
 * that most needs error reporting.
 *
 * If you change the floor, change BOTH. There is no test that couples them,
 * because writing one requires importing the throwing module.
 */
const SHARE_TOKEN_SECRET_MIN_LENGTH = 32;

/**
 * Phase 164 / D-02, second half — boot-time VISIBILITY for the share secret.
 *
 * The first half is the module-load throw in `src/lib/strategy-share-token.ts`:
 * any route importing the token module fails hard without a valid secret. That
 * is the hard stop, but it only fires when someone REQUESTS a share route. This
 * check fires at process start, so the misconfiguration is in the deploy log
 * before anyone clicks Copy Link — which is the failure class this milestone
 * exists to remove.
 *
 * ⛔ `SHARE_TOKEN_SECRET` is deliberately NOT in `SOFT_SKIP_PROD_KEYS`. That
 * list is documented as warn-only and never-crash-a-deploy; this secret's
 * ruling is the exact opposite (fail LOUD, hard stop at module load). Putting
 * it on the soft list would demote the ruling.
 *
 * Returns the operator message, or `null` when there is nothing to report.
 * Production-only: a local dev box without the var is normal, and the module
 * throw already covers anyone who actually exercises the lane.
 *
 * ⚠️ The message names the variable and its LENGTH — never its value.
 */
export function shareTokenSecretBootError(): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  const secret = process.env.SHARE_TOKEN_SECRET;
  if (secret && secret.length >= SHARE_TOKEN_SECRET_MIN_LENGTH) return null;
  const state = secret
    ? `set but only ${secret.length} characters long`
    : "UNSET";
  return (
    `[startup] SHARE_TOKEN_SECRET is ${state} in production — every strategy ` +
    `share link (mint, revoke and the recipient route) will fail until it is ` +
    `fixed. Remedy: generate a value of at least ${SHARE_TOKEN_SECRET_MIN_LENGTH} ` +
    `characters (\`openssl rand -base64 48\`) and set it in Vercel → Settings → ` +
    `Environment Variables scoped to Production ONLY. Each environment gets a ` +
    `DISTINCT secret. ⚠️ Setting or rotating it invalidates every outstanding ` +
    `share link in that environment.`
  );
}

export async function register() {
  warnUnsetSoftSkipKeys();
  let Sentry: typeof import("@sentry/nextjs") | null = null;
  if (process.env.SENTRY_DSN) {
    Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? "development",
      // Phase 164 / SHARE-01 — both hooks, because a share token reaches
      // Sentry by two independent routes: an ERROR event (request.url,
      // breadcrumbs) and a TRANSACTION event (the transaction name and its
      // span descriptions). Wiring only `beforeSend` would leave the tracing
      // channel — sampled at 10% above — leaking on its own schedule.
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
    });
  }

  const shareSecretError = shareTokenSecretBootError();
  if (shareSecretError) {
    // console.error first and unconditionally: it is the channel that works
    // even when Sentry itself is unconfigured, which is a plausible state for
    // a deploy that is already missing an env var.
    console.error(shareSecretError);
    Sentry?.captureMessage(shareSecretError, "error");
  }
}

export async function onRequestError(
  error: { digest?: string },
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource: string },
) {
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, {
      tags: {
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        // Phase 16 / OBSERV-04 — surface the request-scope correlation_id as
        // a Sentry TAG (queryable in the UI; `extra` is metadata-only).
        //
        // Phase 164: `routePath` needs no scrub and must not get one — Next
        // hands it to us already PARAMETERIZED (`/factsheet-share/[token]`),
        // which is the placeholder shape the scrubber produces anyway. It is
        // `request.path` below that is raw.
        correlation_id: request.headers["x-correlation-id"] ?? null,
      },
      extra: {
        // Phase 164 / SHARE-01 — `request.path` is the RAW request path, so on
        // this route it IS the capability token. Scrubbed at the point of
        // capture rather than relying on `beforeSend` alone: `beforeSend`
        // covers it too (it scrubs `extra`), but a redaction that depends on
        // an SDK hook staying wired is one config edit away from silently
        // ending. Two independent points, deliberately.
        path: scrubSharePath(request.path),
        method: request.method,
        digest: error.digest,
      },
    });
  }
}
