/**
 * `RouteResponseError` — the ONE marker that says "this message came out of one
 * of our own route responses, so it is reviewed copy and is safe to render".
 *
 * ## Why this exists (B-27, phase 140.3 plan 07)
 *
 * Three client components shared one shape:
 *
 * ```ts
 * setError(e instanceof Error ? e.message : "…fallback…");
 * ```
 *
 * `e` there is whatever the `try` block threw. On the happy-ish path that is an
 * `Error` the component itself constructed from the route's JSON `error` field —
 * reviewed, scrubbed, user-facing copy. But the same `catch` also receives:
 *
 *   - a `TypeError` from `fetch` ("Failed to fetch", "NetworkError when …"),
 *   - an undici transport string, which can embed an internal URL or header name,
 *   - a `SyntaxError` from `res.json()` on a proxy's HTML error page,
 *   - anything a future edit throws between the `fetch` and the `setError`.
 *
 * Rendering those to a user is internal noise at best and an upstream-detail
 * disclosure at worst (threat T-140.3-07-04).
 *
 * ## Why not "just replace the message with a stable sentence"
 *
 * Because that swallows copy the user MUST see. `/api/portfolio-optimizer`
 * answers a breaker trip with `{ error: CIRCUIT_OPEN_COPY }` (route.ts, the
 * `CircuitOpenError` arm), and `src/lib/seam-copy.ts` is the single production
 * source of that sentence precisely so it reaches users. A component that
 * replaced every caught message with its own fallback would delete the breaker
 * surface at a seam consumer — undoing plan 140.3-04 while appearing to fix
 * B-27. So the fix is not "render less", it is "render only what a route wrote".
 *
 * ## The contract
 *
 * Throw `RouteResponseError` when the message was built from a route response —
 * its JSON `error`/`code` fields, or its HTTP status/statusText, both of which
 * are ours and carry no upstream detail. Throw or propagate anything else and
 * the catch will render a stable component-owned sentence instead, while the
 * caught value still goes to `console.error` for operators.
 *
 * Grep `RouteResponseError` to enumerate every member of this class.
 */
export class RouteResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteResponseError";
  }
}
