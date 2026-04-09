/**
 * Pure predicate for filtering browser console errors captured inside
 * Playwright `page.on("console")` handlers.
 *
 * Why this helper exists (regression context)
 * --------------------------------------------
 * The first version of `e2e/demo-founder-view.spec.ts` captured only
 * `msg.text()` and filtered by substring on that text. It tried to
 * exclude the expected 500 from `/api/demo/match` under placeholder
 * Supabase env with a clause like `!text.includes("/api/demo/match")`.
 *
 * That clause was a silent no-op: for browser-level resource errors
 * (e.g. a 500 response on a fetch), Chrome emits a console error whose
 * `text` is the generic string
 *   "Failed to load resource: the server responded with a status of 500 (...)"
 * and the offending URL is on `msg.location().url`, NOT in the text.
 * Substring-matching the URL against the text never hit, so the filter
 * let the expected 500 through and the test failed in CI.
 *
 * Fix: capture `{ text, url }` and check both fields.
 *
 * Keeping the predicate as a pure function lets us unit-test it against
 * the exact hostile input shape that broke the original implementation,
 * so the bug can't silently regress on a future refactor of the spec.
 */

export interface CapturedConsoleError {
  /** The console message text. For resource errors, this is a generic "Failed to load resource: ..." string. */
  text: string;
  /** The source URL of the console message (`msg.location().url`). For resource errors, this is the offending resource URL. */
  url: string;
}

export interface ConsoleErrorFilterOptions {
  /**
   * Substrings that, if present in `text`, mean this error is expected
   * noise (e.g. "Hydration", "NEXT_REDIRECT", "Failed to fetch").
   */
  ignoreTextIncludes?: readonly string[];
  /**
   * Substrings that, if present in EITHER `text` or `url`, mean this
   * error is expected noise (e.g. `/api/demo/match` under placeholder
   * Supabase env). Both sides are checked because browser-level
   * resource errors hide the URL on `location().url`, not in the text.
   */
  ignoreTextOrUrlIncludes?: readonly string[];
}

/**
 * Return true if the captured error is UNEXPECTED and should fail the
 * test. Return false if the error matches one of the ignore rules and
 * should be filtered out.
 */
export function isUnexpectedConsoleError(
  error: CapturedConsoleError,
  options: ConsoleErrorFilterOptions = {},
): boolean {
  const { ignoreTextIncludes = [], ignoreTextOrUrlIncludes = [] } = options;

  for (const needle of ignoreTextIncludes) {
    if (error.text.includes(needle)) return false;
  }
  for (const needle of ignoreTextOrUrlIncludes) {
    if (error.text.includes(needle) || error.url.includes(needle)) return false;
  }
  return true;
}

/**
 * Filter a captured error list down to only the unexpected entries.
 * Convenience wrapper over `isUnexpectedConsoleError`.
 */
export function filterUnexpectedConsoleErrors(
  errors: readonly CapturedConsoleError[],
  options: ConsoleErrorFilterOptions = {},
): CapturedConsoleError[] {
  return errors.filter((e) => isUnexpectedConsoleError(e, options));
}
