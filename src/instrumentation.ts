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

export async function register() {
  warnUnsetSoftSkipKeys();
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? "development",
    });
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
        correlation_id: request.headers["x-correlation-id"] ?? null,
      },
      extra: {
        path: request.path,
        method: request.method,
        digest: error.digest,
      },
    });
  }
}
