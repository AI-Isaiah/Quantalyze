/**
 * 161-06 / WIZERR-05 — the ONE place a key-route response decides whether it is
 * allowed to advertise a wait, and whose wait it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SHARED FUNCTION AND NOT A COMMENT IN TWO ROUTES
 *
 * `strategies/create-with-key` and `strategies/composite/add-key` are a
 * byte-identical pair by design — the single-key wizard path and the "+ Add
 * another key" path — and fixing one of them and not the other is this
 * milestone's single most repeated mistake. Their terminal catches already
 * carried a hand-duplicated `Retry-After` ternary, kept in step by comments in
 * both files saying the other one mirrors it. `strategyGate.ts` records what
 * happens to that arrangement: a predicate that "must never diverge", kept by
 * comment, "diverged anyway — a comment is not an enforcement mechanism; a
 * shared function is."
 *
 * WIZERR-05 adds a SECOND source of a wait to that expression, which is exactly
 * the moment the duplication stops being cheap. So the whole decision moves
 * here, both halves of it, and each route's catch becomes one call.
 *
 * ⚠️ The four per-route test cases in each route's `route.test.ts` are NOT made
 * redundant by this move and must not be collapsed into a test of this function.
 * They assert that each ROUTE still calls it; a law about the helper alone
 * cannot see a route that stopped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRECEDENCE, AND WHY EXACTLY ONE BRANCH CAN STAMP
 *
 * Two different failures can advertise a duration and they are NOT
 * interchangeable:
 *
 *   1. `CircuitOpenError.retryAfterS` — OUR breaker cooldown. The request never
 *      left this process.
 *   2. `AnalyticsUpstreamError.retryAfterSeconds` — the UPSTREAM's own advice,
 *      born in the Python service's `RETRY_AFTER_SECONDS` table, carried on the
 *      response's `Retry-After` header and across the seam by 161-06. The
 *      request WAS sent and the service answered with a wait.
 *
 * THE BREAKER WINS. While it is open nothing leaves this process at all, so its
 * cooldown is the only value that describes what will actually happen next; the
 * upstream wait attached to the error that tripped it would under-advertise by
 * construction.
 *
 * The selection is ONE conditional expression choosing ONE headers object —
 * deliberately not two successive spreads. Two spreads let the later silently
 * overwrite the earlier, which is precisely how a response ends up advertising
 * a wait belonging to the other failure mode. Written this way, "at most one
 * `Retry-After`, and we know whose" is a property of the SHAPE rather than of a
 * reviewer's attention.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ TRAP-3 — ABSENCE STAYS ABSENCE, AND BOTH BRANCHES ENFORCE IT
 *
 * When neither source advertised a usable wait, NO header is attached. Never
 * `"0"`, never `""`, never a default. Zero is not "no wait": it is an
 * instruction to retry immediately — a duration nobody sent, and the ~0 ms
 * hot-retry that B20's parser exists to make unreachable. The exemplar this
 * copies is the `keys/[id]/permissions` throttle arm's undefined-check ternary.
 *
 * ⚠️ 161-REVIEW / WR-01 — THIS SECTION USED TO DESCRIBE A PROPERTY THE CODE DID
 * NOT ENFORCE, in two different ways, and both are now closed at the guard
 * rather than in prose:
 *
 *   1. The SEAM branch checked `Number.isFinite`, which admits a FRACTION.
 *      `parseRetryAfterSeconds` (`src/lib/retry/retry-after.ts`) returns
 *      `Number(raw)` for the delta-seconds form, so an intervening proxy or CDN
 *      answering `Retry-After: 0.5` crossed the seam as `0.5` and was relayed
 *      onto OUR OWN response verbatim — not a valid RFC-9110 `delta-seconds`,
 *      and rendered to the user as "Try again in 0.5s". `Number.isInteger` is
 *      the correct predicate and subsumes `Number.isFinite` (it rejects `NaN`,
 *      `±Infinity` and every fractional value), so it REPLACES it rather than
 *      joining it.
 *   2. The BREAKER branch stamped `String(err.retryAfterS)` unconditionally,
 *      INHERITING the rule from `CircuitOpenError`'s constructor instead of
 *      applying it. That constructor accepts a non-negative integer — so `0` is
 *      legal there and would have arrived here as `Retry-After: 0`, the exact
 *      value this section forbids.
 *
 * `CircuitOpenError` (`src/lib/seam-errors.ts`) carries the `Number.isInteger`
 * guard at its own constructor for precisely this reason, quoted there: the
 * value "is forwarded as a `Retry-After` HEADER by both seam clients". 161-06
 * created a SECOND value forwarded onto the same wire and did not inherit the
 * guard; it does now, on both branches.
 *
 * ⭐ WHY CHECK AT ALL when both producers are believed well-behaved: this
 * function cannot verify anything about a value it was merely handed — and the
 * seam value's provenance is an *upstream response header*, which is to say a
 * value any hop on the path can write. A guard here is the last one before our
 * own bytes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ `typeof`, NOT `instanceof AnalyticsUpstreamError`
 *
 * Every route test that mocks the seam client wholesale does
 * `vi.mock("@/lib/analytics-client", …)` with a bare factory, so the class is
 * `undefined` inside those suites and `x instanceof undefined` throws a
 * `TypeError` from inside a catch block — turning a clean 503 into a crash.
 * `retryAfterSeconds` is an own data property assigned in that class's
 * constructor, so a `typeof` read survives every mock shape and simply answers
 * `undefined` when the thrower was not the seam client. This is the same idiom,
 * for the same reason, that `wizardErrors.ts` records at length for `seamCode`.
 *
 * `CircuitOpenError` IS read with `instanceof`, and that is not an
 * inconsistency: it is imported from `@/lib/seam-errors`, the dependency-free
 * leaf that those wholesale mocks do not replace — which is why the leaf exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATELESS BY CONSTRUCTION. Every fact is read off the caught value on this
 * call. Nothing is memoized, closed over or held at module level, so a wait can
 * never outlive the response that carried it — a stale duration from a previous
 * attempt is a false sentence about how long to wait, and worse than none.
 */
import { CircuitOpenError } from "@/lib/seam-errors";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * The response headers for a key-route failure: `NO_STORE_HEADERS`, plus a
 * `Retry-After` iff exactly one of the two sources above advertised a wait that
 * is a POSITIVE INTEGER number of seconds — RFC-9110 `delta-seconds`, the only
 * shape this header may carry.
 *
 * `typeof advertisedWait === "number"` is retained ahead of `Number.isInteger`
 * for the type narrowing, not for the check: `Number.isInteger` is not a TS type
 * guard, so without it `String(advertisedWait)` is an `unknown` read.
 */
export function keyRouteFailureHeaders(err: unknown): Record<string, string> {
  const advertisedWait = (
    err as { retryAfterSeconds?: unknown } | null | undefined
  )?.retryAfterSeconds;

  return err instanceof CircuitOpenError
    ? Number.isInteger(err.retryAfterS) && err.retryAfterS > 0
      ? { ...NO_STORE_HEADERS, "Retry-After": String(err.retryAfterS) }
      : NO_STORE_HEADERS
    : typeof advertisedWait === "number" &&
        Number.isInteger(advertisedWait) &&
        advertisedWait > 0
      ? { ...NO_STORE_HEADERS, "Retry-After": String(advertisedWait) }
      : NO_STORE_HEADERS;
}
