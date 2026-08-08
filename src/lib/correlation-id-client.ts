// Client-safe PER-FAILURE correlation id.
//
// WHY A THIRD CORRELATION MODULE, AND WHAT EACH ONE IS FOR:
//
//   `src/lib/correlation-id.ts`        — `import "server-only"`; reads the
//                                        inbound header inside a Route Handler.
//                                        Cannot be imported by a client component.
//   `src/lib/wizard/wizard-correlation.ts`
//                                      — ONE id memoized for the life of a
//                                        wizard SESSION, stamped by `wizardFetch`
//                                        on every wizard request. Deliberately
//                                        stable across attempts.
//   this module                        — a FRESH id per failed attempt, for the
//                                        one-shot dialogs that show the user an
//                                        error envelope and nothing else. Those
//                                        surfaces have no session to key on, and
//                                        a stable id would name attempt 1's log
//                                        line under attempt 2's failure.
//
// The id is only worth printing if it was also SENT. An id minted client-side
// and never put on the wire joins to no server log line — a decorative uuid the
// user can read out to support who then cannot find it. Every caller of
// `newCorrelationId()` must stamp the value as `X-Correlation-Id` on the request
// it is about to describe; the server's `getCorrelationId()` prefers a valid
// inbound header over minting its own, which is what closes the chain.

/**
 * A fresh correlation id for the failure the user is about to be shown.
 *
 * GUARDED, not a bare `crypto.randomUUID()`. Two reasons, both measured rather
 * than theoretical:
 *
 *   1. `crypto.randomUUID` is undefined on a non-secure origin (plain-HTTP LAN
 *      testing) and in older embedded webviews. Every call site is inside a
 *      `catch` or on an error path, so a throw there becomes an UNHANDLED
 *      REJECTION that replaces the error envelope the user was supposed to
 *      read with nothing at all.
 *   2. `globalThis.crypto` is read through optional chaining so the module is
 *      safe to evaluate anywhere, including a server render pass that only
 *      imports it.
 *
 * The fallback is time-based and NOT a uuid — it is deliberately distinguishable
 * in logs from the real thing, and it is still unique enough to join one
 * attempt to one log line.
 *
 * @param prefix names the surface in the fallback form (`<prefix>-1a2b3c`), so
 *   a support ticket carrying a fallback id still says where it came from.
 */
export function newCorrelationId(prefix: string): string {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `${prefix}-${Date.now().toString(16)}`;
}
