/**
 * Lazy Sentry capture helper.
 *
 * The dynamic `import("@sentry/nextjs")` keeps Sentry out of bundles
 * (notably middleware) that don't otherwise need it. The dual try/catch
 * skeleton prevents a Sentry-transport failure from masking the caller's
 * own logging — both `console.error` (caller's responsibility) and this
 * Sentry path are best-effort observability; either failing in isolation
 * must not break the caller's response.
 *
 * Consolidates the lazy-Sentry pattern previously copied across:
 *   - src/lib/admin.ts (reportNonRlsError)
 *   - src/lib/audit.ts (reportToSentry — module-private)
 *   - src/lib/api/withAllocatorAuth.ts (reportProfileGateError)
 *   - src/app/api/allocator/scenario/commit/route.ts (reportEnvelopeError + stamp-failure)
 *
 * Each call site now passes its own `tags` / `extra` / `level` and a single
 * helper handles the import lifecycle.
 */
export function captureToSentry(
  err: unknown,
  options: {
    tags: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: "fatal" | "error" | "warning" | "info";
  },
): void {
  try {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        try {
          Sentry.captureException(err, {
            tags: options.tags,
            extra: options.extra,
            level: options.level ?? "error",
          });
        } catch {
          // Swallow — caller already logged via console.error / warn.
        }
      })
      .catch(() => {
        // Sentry import failed — swallow.
      });
  } catch {
    // import() construction failed (extremely unlikely) — swallow.
  }
}
