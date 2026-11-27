import { scrubSharePath } from "@/lib/scrub-share-path";
import { scrubSentryEvent } from "@/lib/sentry-scrub";
import { scrubSeamErrorForCapture } from "@/lib/seam-redaction";

// Phase 221: the scrub moved to src/lib/sentry-scrub.ts so a browser init can
// import the same function. Re-exported so existing importers keep working.
export { scrubSentryEvent } from "@/lib/sentry-scrub";

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

/**
 * Phase 221 round 2 / WR-03 (2026-11-27). Next writes `http.target: req.url`
 * (path PLUS query) on its own request span, and the SDK filters only the URL
 * attributes its own integrations create, so `dataCollection.urlQueryParams:
 * false` never reaches it: a sampled transaction carried
 * `/auth/callback?token_hash=...`. This is the `beforeSendSpan` for the static
 * lifecycle. The SDK calls it on the root span and on every child, and ships
 * the span UNMODIFIED if it throws, so it must not throw: on any failure the
 * span goes out with no attributes at all rather than with the query.
 */
function stripSpanUrlQuery<S extends { data?: Record<string, unknown> }>(span: S): S {
  try {
    const data = span.data;
    if (data) {
      for (const key of ["http.target", "http.url", "url.full"]) {
        const value = data[key];
        if (typeof value === "string") data[key] = value.split("?")[0];
      }
      // Holds the query alone, so there is no path to keep.
      delete data["url.query"];
    }
    return span;
  } catch {
    return { ...span, data: {} };
  }
}

export async function register() {
  warnUnsetSoftSkipKeys();
  // Phase 221 round 1 / SFH-M1. `next.config` inlines the browser DSN at build;
  // a build without it leaves the browser channel off while this server init
  // keeps reporting, and nothing else says so. Names the cause and the remedy,
  // never the DSN.
  if (
    process.env.VERCEL_ENV === "production" &&
    process.env.SENTRY_DSN &&
    !process.env.NEXT_PUBLIC_SENTRY_DSN
  ) {
    console.warn(
      "[startup] SENTRY_DSN is set but this build carries no browser DSN: " +
        "browser errors are NOT reported. Redeploy so next.config inlines it.",
    );
  }
  let Sentry: typeof import("@sentry/nextjs") | null = null;
  if (process.env.SENTRY_DSN) {
    Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? "development",
      // Phase 209 / CR-01 (D-17). Sentry 11 defaults to span STREAMING, which
      // never calls `beforeSendTransaction`: streamed spans shipped the raw
      // share token (`http.target`, span names). The scrub below is wired to
      // that hook, so the lifecycle is pinned to the static one. Without this
      // line the next SDK default change silently re-opens the channel.
      traceLifecycle: "static",
      // Phase 209 / CR-02 (D-18). The default Console integration copies every
      // `console.*` call into a breadcrumb on the next captured event, and the
      // seam LOG renderer keeps `details`/`hint` on purpose (D-03). So console
      // crumbs are dropped. The console trail still lives in the Vercel logs.
      // A message-pattern filter was rejected: the raw arguments ride under
      // `data` too.
      beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
      // Phase 164 / SHARE-01 — both hooks, because a share token reaches
      // Sentry by two independent routes: an ERROR event (request.url,
      // breadcrumbs) and a TRANSACTION event (the transaction name and its
      // span descriptions). Wiring only `beforeSend` would leave the tracing
      // channel — sampled at 10% above — leaking on its own schedule.
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
      // Phase 221 round 2 / WR-03: the query leaves TRANSACTION span
      // attributes here, see `stripSpanUrlQuery`. Wrapped for the static
      // lifecycle or the SDK ignores it.
      beforeSendSpan: Sentry.withStaticSpan(stripSpanUrlQuery),
      // Phase 221 round 1 / WR-01 (2026-11-27). The server SDK's request-data
      // integration attaches `request.url` and `query_string` with the query
      // kept by default, so `/auth/callback?token_hash=...` reached Sentry
      // through them. Mirrors the browser init, which drops every query too.
      // ⛔ CORRECTED 2026-11-27 (round 2 / WR-03): "drops every query too" and
      // the claim that server events no longer carry the query held for ERROR
      // events only. This option filters just the URL attributes the SDK's own
      // integrations create; Next's own `http.target` span attribute carries
      // the raw query and is stripped by `beforeSendSpan` above.
      dataCollection: { urlQueryParams: false },
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

/**
 * 164.6.5 review round 1 / WR-07 — the wizard's per-page-load id, read off
 * `X-Wizard-Page-Load-Id` (`src/lib/wizard/wizard-correlation.ts`).
 *
 * Plan 07 made the wizard's `X-Correlation-Id` per-REQUEST and moved the
 * stable page-load id onto this header, so this is the one server reader
 * that still lets two failures from one open tab be grouped in Sentry.
 *
 * The value is CLIENT-SUPPLIED, so it is shape-checked before it becomes a
 * tag: the same allowlist `CORRELATION_ID_SHAPE` applies in
 * `src/lib/correlation-id.ts` (no CR, LF, NUL or whitespace). That module is
 * `server-only` and reads `next/headers`, which this hook does not need, so
 * the pattern is restated here rather than imported. Anything else is null,
 * never echoed.
 *
 * ⛔ CORRECTED 2026-09-25 (164.6.5 review round 2 / R2-SFH-11): "anything
 * else is null" is kept above as lineage. An ABSENT header is still `null`
 * (an old bundle that never sends it). A PRESENT header that fails the shape
 * check — empty, whitespace, CR/LF, too long, or an array — is now the fixed
 * sentinel `WIZARD_PAGE_LOAD_ID_MALFORMED`, so Sentry can tell "no header"
 * from "a bad header" (a client bug). The sentinel's angle brackets are
 * outside the shape allowlist, so no client value can ever read as it, and
 * the client's own value is still never echoed.
 */
const WIZARD_PAGE_LOAD_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;
const WIZARD_PAGE_LOAD_ID_MALFORMED = "<malformed>";

/**
 * Next's DOCUMENTED type for an `onRequestError` header value is
 * `string | string[]` (`node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/instrumentation.md`; `NodeJS.Dict<string | string[]>` in
 * `next/dist/server/instrumentation/types.d.ts`). 164.6.5 review round 2 /
 * IN-03: this used to take `string | undefined` and call `.trim()`, so an array
 * would have thrown INSIDE the error hook and lost the capture. Node joins
 * duplicate custom headers into one string, so it did not fire; the narrowed
 * signature is what hid it. An array is not one page-load id, so it is
 * malformed.
 */
function wizardPageLoadIdTag(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return WIZARD_PAGE_LOAD_ID_MALFORMED;
  const trimmed = raw.trim();
  return WIZARD_PAGE_LOAD_ID_SHAPE.test(trimmed)
    ? trimmed
    : WIZARD_PAGE_LOAD_ID_MALFORMED;
}

/**
 * Phase 209 / WR-01. A server reader that does `throw error` on a PostgREST
 * `{ code, message, details, hint }` result throws a PLAIN OBJECT. Next's
 * `getProperError` cannot treat that as an Error (no `name`), so it wraps it as
 * `new Error(JSON.stringify(obj))` and that wrapper reaches `onRequestError`.
 * Its MESSAGE is then the whole row dump, `details` and `hint` included, and
 * `beforeSend` never sees it as a field. So a wrapped plain object is rebuilt
 * here from the capture renderer (no `details`/`hint`), keeping the stack and
 * the digest. Anything that is not such a wrapper is returned untouched.
 */
function scrubWrappedPlainObjectError<E extends { digest?: string }>(error: E): E {
  // Only the exact shape Next produces: a PLAIN `Error` (no subclass, no
  // `cause`) whose message is JSON. A subclass, or an error with a cause, is a
  // real error that happens to start with "{", and rebuilding it would drop its
  // name and cause.
  if (
    !(error instanceof Error) ||
    error.constructor !== Error ||
    error.name !== "Error" ||
    "cause" in error ||
    !error.message.startsWith("{")
  ) {
    return error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    // Not JSON: an ordinary error whose message happens to start with "{".
    return error;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return error;
  }
  // A PostgREST-shaped row has a string `code` or `message`. An arbitrary JSON
  // body (an upstream response, say) does not, and must keep its message.
  const { code, message } = parsed as { code?: unknown; message?: unknown };
  if (typeof code !== "string" && typeof message !== "string") return error;
  // Outside the `try` on purpose: the renderer cannot throw, and a throw here
  // must not fall back to the ORIGINAL error with `details`/`hint` in it.
  const rebuilt = new Error(scrubSeamErrorForCapture(parsed)) as Error & {
    digest?: string;
  };
  rebuilt.stack = error.stack;
  rebuilt.digest = error.digest;
  return rebuilt as unknown as E;
}

export async function onRequestError(
  error: { digest?: string },
  // IN-03 — Next's documented header type, not the narrower
  // `Record<string, string>` this hook used to declare.
  request: { path: string; method: string; headers: NodeJS.Dict<string | string[]> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource: string },
) {
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    const scrubbed = scrubWrappedPlainObjectError(error);
    Sentry.captureException(scrubbed, {
      tags: {
        // WR-12 — say so when the message was rebuilt, so a reader of the issue
        // knows it is not the thrown text.
        ...(scrubbed !== error ? { message_rebuilt: "true" } : {}),
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
        // IN-03 — a tag value must be a primitive, and an array is not one
        // correlation id; only a string header becomes the tag.
        correlation_id:
          typeof request.headers["x-correlation-id"] === "string"
            ? request.headers["x-correlation-id"]
            : null,
        // 164.6.5 / WR-07 — the page-load grain, beside the per-request one.
        wizard_page_load_id: wizardPageLoadIdTag(
          request.headers["x-wizard-page-load-id"],
        ),
      },
      extra: {
        // Phase 164 / SHARE-01 — `request.path` is the RAW request path, so on
        // this route it IS the capability token. Scrubbed at the point of
        // capture rather than relying on `beforeSend` alone: `beforeSend`
        // covers it too (it scrubs `extra`), but a redaction that depends on
        // an SDK hook staying wired is one config edit away from silently
        // ending. Two independent points, deliberately.
        // Phase 221 round 1 / WR-01: Next documents `request.path` as the path
        // PLUS the query (`/blog?name=foo`), so the query is cut before the
        // share-path scrub; `/auth/callback?token_hash=...` must not ship.
        path: scrubSharePath(request.path.split("?")[0]),
        method: request.method,
        digest: error.digest,
      },
    });
  }
}
