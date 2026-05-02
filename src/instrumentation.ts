export async function register() {
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
