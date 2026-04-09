/**
 * Analytics service warmup.
 *
 * The Python analytics service runs on Railway with cold-start behavior.
 * When the friend forwards a /demo URL and a colleague clicks it Monday
 * morning, we want the analytics service to be hot before the page tries to
 * render. This module fires a fire-and-forget HEAD request to the service's
 * /health endpoint so subsequent reads inside the same request hit a warm
 * worker.
 *
 * The function MUST NEVER throw or reject — Server Components abort render
 * on unhandled rejection in Next 16. Belt + suspenders:
 *   1. Check the env var first (silently no-op if missing).
 *   2. Wrap the fetch in try/catch.
 *   3. Attach a `.catch(() => {})` to the promise so any async rejection is
 *      swallowed instead of bubbling to the runtime.
 */

const WARMUP_TIMEOUT_MS = 2000;

/**
 * Fire-and-forget warmup. Returns immediately. Never throws.
 *
 * Logs at info-level when the warmup either succeeds or fails — both are
 * informational, neither blocks the page.
 */
export function warmupAnalytics(): void {
  const url = process.env.ANALYTICS_SERVICE_URL;
  if (!url) {
    // No analytics URL configured (local dev with no Python service running).
    // Silent no-op — the demo page renders fine from persisted data.
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
  try {
    void fetch(`${url.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })
      .catch(() => {
        // Service is cold or unreachable. Logged at info level (not error)
        // because the page can still render from persisted data.
        console.info("[warmup-analytics] /health probe failed");
      })
      .finally(() => clearTimeout(timeout));
  } catch {
    // Synchronous throw from fetch construction (e.g. malformed URL).
    // Clear the timer so it doesn't leak until the next tick.
    clearTimeout(timeout);
    console.info("[warmup-analytics] sync throw swallowed");
  }
}
