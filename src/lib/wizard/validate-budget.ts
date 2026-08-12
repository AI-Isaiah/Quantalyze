// Phase 153.4 / D-05 / D-26 — the CLIENT-SAFE copy of the `validate-key` budgets, and
// the escalation ladder the long-wait card spends them on.
//
// WHY THIS DUPLICATION EXISTS.
//   The budgets live in `SEAM_BUDGETS` (`src/lib/resilient-fetch.ts`). That module is
//   server-side BY CONSTRUCTION: its first three imports are `next/server`,
//   `@upstash/ratelimit` and `@upstash/redis`, and it owns the breaker keyspace, the
//   lock encoding and the Sentry capture path. Importing it from a `"use client"`
//   component would drag the whole seam core — and a Redis client — into the browser
//   bundle, and would publish the seam's internal vocabulary to anyone who opens
//   devtools. `seam-ssr-exposure.pin.test.ts` fences the other direction of the same
//   property. `src/lib/wizard/wizard-correlation.ts` exists for exactly this reason on
//   exactly this boundary (its server twin `correlation-id.ts` reads request headers).
//
//   So the browser gets a hand-typed copy. That is not a shortcut; it is this repo's
//   own documented convention for a value that must exist on both sides of a boundary
//   it cannot cross — see the "Hand-typed HERE, deliberately duplicating the frozen set
//   inside …" docblock above `SeamServiceDependency` in `resilient-fetch.ts`, whose
//   closing sentence states the principle: "Two independently typed vocabularies
//   asserted equal … is what makes the duplication safe: either side may change, but
//   not both silently."
//
// WHY THE DUPLICATION IS SAFE.
//   `src/lib/seam-constants.pin.test.ts` carries the agreement pin — search that file
//   for "the CLIENT-SAFE budget module agrees with the seam table". It asserts, in one
//   `it`, that `SEAM_BUDGETS["validate-key"].timeoutMs === VALIDATE_KEY_BUDGET_MS` and
//   `SEAM_BUDGETS["validate-key-serialized"].timeoutMs ===
//   VALIDATE_KEY_SERIALIZED_BUDGET_MS`, AND — separately, hand-typed on both sides —
//   that the two client figures are 30 000 and 120 000. The second half is what stops
//   the pin being satisfied by both sides moving together to a wrong value.
//   ⛔ If that pin reds, the fix is to move BOTH constants, never to delete the pin: a
//   divergence means the wizard promises the user a wait the seam does not grant, or
//   the seam grants one the wizard never promises.
//
// ⚠️ 120 000 ms IS PROVISIONAL (D-27) — the same caveat the `SEAM_BUDGETS` row carries,
//   restated here so neither copy can be read without it. It is the founder's stated
//   staleness tolerance ("if it is 2 minutes old, that is fine"), NOT a measurement: no
//   uncensored successful MT5 validation exists anywhere, so no p50/p95 does either.
//   Phase 153.3's per-stage `stage` / `duration_ms` instrumentation is what produces
//   one, and Phase 155 (MT5-VERIFY) owns tightening this number from that data.
//
// ⛔ THIS MODULE MAY NEVER IMPORT `resilient-fetch`, `analytics-client`, `next/server`
//   or any `@upstash` package. `validate-budget.test.ts` reads this file off disk and
//   reds on any of those specifiers — that assertion is the bundle-safety guard, and it
//   is the only thing that can catch a future "simplify this to import the table" edit.

import { venueIsSerialized } from "@/lib/closed-sets";

/**
 * The default `validate-key` budget, in milliseconds — every ccxt venue, sFOX, and any
 * venue string this client does not recognise.
 *
 * Hand-typed twin of `SEAM_BUDGETS["validate-key"].timeoutMs`.
 */
export const VALIDATE_KEY_BUDGET_MS = 30_000;

/**
 * The SERIALIZED-venue `validate-key` budget, in milliseconds — venues whose
 * `VENUE_CAPABILITIES.serialized` is true (today: MT5 only).
 *
 * Hand-typed twin of `SEAM_BUDGETS["validate-key-serialized"].timeoutMs`.
 *
 * ⚠️ PROVISIONAL (D-27) — see the file docblock. Phase 155 owns tightening it.
 */
export const VALIDATE_KEY_SERIALIZED_BUDGET_MS = 120_000;

/**
 * The budget the seam will spend on a `validate-key` call for this venue, in ms.
 *
 * Selects on the CAPABILITY (`venueIsSerialized`), never on a venue name — a second
 * serialized venue is covered by editing `VENUE_CAPABILITIES`, never this function.
 * That is the same class-not-instance rule `budgetKeyFor` in `analytics-client.ts`
 * follows, and this function is deliberately its mirror: same predicate, same fallback
 * direction, so the figure the browser shows and the row the server spends cannot
 * disagree about which arm a venue is on.
 *
 * ⚠️ Never throws. `exchange` is a wizard form value, so `null`, `undefined`, `""` and
 * an unrecognised string are all NORMAL input; each falls back to the default budget,
 * exactly as `budgetKeyFor` falls back to the default row. Under-promising a wait is
 * safe; over-promising one is a lie the seam will not honour.
 */
export function validateBudgetMsFor(exchange: string | null | undefined): number {
  return venueIsSerialized(exchange)
    ? VALIDATE_KEY_SERIALIZED_BUDGET_MS
    : VALIDATE_KEY_BUDGET_MS;
}

/**
 * The same budget in WHOLE SECONDS — the only figure that may appear in copy.
 *
 * ⛔ The copy layer must never do its own `/ 1000`. One function owns the seconds
 * figure so two sentences in the same card cannot disagree about the number, and so
 * UI-SPEC forbidden item #8 ("a duration in copy that is not read from the configured
 * budget") has exactly one place it can be violated.
 */
export function validateBudgetSecondsFor(
  exchange: string | null | undefined,
): number {
  return Math.round(validateBudgetMsFor(exchange) / 1000);
}

/**
 * How long a validate must be in flight before the long-wait card mounts, in ms.
 *
 * UI-SPEC Surface 1, Render gate: "Mounts 300ms after submit (a sub-300ms answer must
 * never flash a card)."
 */
export const WAIT_CARD_MOUNT_DELAY_MS = 300;

/**
 * The escalation ladder, as FRACTIONS of the configured budget.
 *
 * ⛔ Never absolute millisecond thresholds. `SyncPreviewStep.tsx`'s ladder is built from
 * module millisecond constants, and that is precisely the analog UI-SPEC Surface 1
 * mandates against: "Thresholds are fractions of the configured venue budget, so a
 * budget change moves them automatically." A literal here would mean a budget change
 * silently re-times the ladder — on the serialized arm, 40% of 120 000 ms and 40% of a
 * future 90 000 ms are 34 s apart.
 *
 * `WAIT_QUEUE_FRACTION` (40%) gates the queue disclosure AND the `Stop waiting`
 * control; `WAIT_SLOW_FRACTION` (75%) gates the warning-toned slow disclosure.
 */
export const WAIT_QUEUE_FRACTION = 0.4;
export const WAIT_SLOW_FRACTION = 0.75;

/**
 * How much longer the BROWSER waits than the budget it advertises, in ms, before it
 * gives up on its own.
 *
 * The seam deadline fires INSIDE our own route, and the browser→route hop is not free:
 * aborting the fetch at exactly `validateBudgetMsFor(exchange)` could cut off a verdict
 * that is already on the wire — which would turn an honest `SEAM_DEADLINE_EXCEEDED`
 * into the silent UNKNOWN this whole phase exists to end. The grace is the client's
 * margin over the promise it made, not an extension of the promise.
 *
 * Consumed by plans 153.4-04 and 153.4-05, which own the abort controllers.
 */
export const WAIT_ABORT_GRACE_MS = 15_000;

/**
 * The ENCRYPT leg the connect routes spend AFTER validate, in milliseconds.
 *
 * Hand-typed twin of `SEAM_BUDGETS["encrypt-key"].timeoutMs`, for the same reason
 * and under the same rules as the two validate figures above — ⛔ this module may
 * never import the seam table.
 *
 * ⚠️ It is deliberately NOT a copy figure. Nothing the wizard says to the user
 * names this number; it exists only so the browser's deadline can cover the whole
 * route rather than one leg of it (see `connectAbortDeadlineMsFor`).
 */
export const ENCRYPT_KEY_BUDGET_MS = 30_000;

/**
 * The BREAKER'S OWN STORE, in the FAILING state, for one whole connect route —
 * in milliseconds.
 *
 * Hand-typed twin of the store term `seam-budgets.invariant.test.ts` charges in
 * SC-4b, for the same reason and under the same rules as the three budget
 * figures above — ⛔ this module may never import the seam table, and this one
 * could not be imported even if it were allowed to: it is not a single exported
 * constant anywhere, it is an arithmetic over three of them.
 *
 * ITS DERIVATION, WRITTEN OUT so a reader never has to re-derive it:
 *
 *   2 seam legs on a connect route (`validate-key*` then `encrypt-key`)
 *     x STORE_COMMANDS_PER_SEAM_CALL.failing = 3 commands per seam call
 *       (the pre-fetch `mget`, plus the trip path's `get` and `set`)
 *     x STORE_COMMAND_WORST_CASE_MS = 4 250 ms per command
 *       ( = (1 + BREAKER_STORE_RETRIES) x BREAKER_STORE_TIMEOUT_MS
 *           + BREAKER_STORE_RETRIES x BREAKER_STORE_BACKOFF_MS
 *         = 2 x 2 000 + 1 x 250 )
 *   = 25 500 ms
 *
 * ⚠️ THE FAILING STATE, DELIBERATELY, AND THAT IS THE WHOLE POINT (PARITY-03).
 * The closed state charges one command per seam call (8 500 ms for the route);
 * the failing state charges three. A client deadline is only ever REACHED when
 * the seam is stalling, and a stalling seam is what puts the breaker in the
 * failing state — so the closed figure describes a route the browser never
 * waits on. Sizing the deadline on it is the 153.6 defect this constant exists
 * to close.
 *
 * ⚠️ It is deliberately NOT a copy figure, exactly like `ENCRYPT_KEY_BUDGET_MS`.
 * Nothing the wizard says to the user names this number; it exists only so the
 * browser's deadline can cover the whole route rather than the legs of it that
 * happen to have their own budget rows.
 *
 * ⛔ IT IS NOT PER-VENUE. The store cost does not depend on the validate budget,
 * which is why both venue arms were short by the identical 10 500 ms
 * (`25 500 − WAIT_ABORT_GRACE_MS`) and why one edit inside
 * `connectAbortDeadlineMsFor`'s arm-agnostic body fixes both.
 */
export const BREAKER_STORE_WORST_CASE_FAILING_MS = 25_500;

/**
 * When the BROWSER gives up on a CONNECT ROUTE, in milliseconds.
 *
 * ⛔ NOT `validateBudgetMsFor(exchange) + WAIT_ABORT_GRACE_MS`, and the difference
 * is a user-facing lie rather than a rounding question (153.4 review CR-01).
 *
 * THE BROWSER ABORTS A ROUTE, NOT A SEAM CALL. `POST /api/strategies/create-with-key`
 * and `POST /api/strategies/composite/add-key` each spend `validateKey` THEN
 * `encryptKey` THEN a Supabase RPC, and neither route reads `request.signal` — a
 * client abort has no server-side effect at all. Sizing the deadline against the
 * validate leg alone put it at 135 000 ms on the serialized arm while the route's
 * own budget runs far past it, which made the deadline reachable ALMOST
 * EXCLUSIVELY in the window where validate had already SUCCEEDED and the route was
 * encrypting and storing the key. The browser then rendered
 * `SEAM_DEADLINE_EXCEEDED`, whose copy says *"Nothing was saved — your key was not
 * stored"*, over a request that was at that moment storing it.
 *
 * ⛔ THE GOVERNING FIGURE IS THE FAILING COLUMN, NOT THE CLOSED ONE (PARITY-03).
 * The first fix for CR-01 covered validate + encrypt + grace and compared the
 * result against the CLOSED-breaker worst case of these routes. That column
 * describes a healthy seam — and a healthy seam does not keep a browser waiting
 * long enough to reach a client deadline. The state a route is in WHEN THIS
 * DEADLINE FIRES is the failing one, whose figures are (from
 * `seam-budgets.invariant.test.ts`'s branch table):
 *
 *   | connect route, per branch | closed  | failing |
 *   |---------------------------|---------|---------|
 *   | serialized-venue          | 158 500 | 175 500 |
 *   | default-venue             |  68 500 |  85 500 |
 *
 * so the deadline must cover 175 500 / 85 500, not 158 500 / 68 500. Covering
 * validate + encrypt + the failing-state store worst case + grace puts the abort
 * AFTER every deadline the route enforces on itself — 190 500 ms on the
 * serialized arm and 100 500 ms on the default one, each exceeding its route's
 * failing worst case by exactly the grace — so the verdict is only ever reached
 * when the server has genuinely stopped answering, which is the condition that
 * copy describes. Both remain far under the routes' 300 000 ms `maxDuration`.
 *
 * ⭐ THE STORE TERM IS ARM-AGNOSTIC, so this body is too. The shortfall was
 * `25 500 − 15 000 = 10 500 ms` on BOTH arms, identical because the breaker's
 * store cost does not depend on the validate budget. A fix that corrected only
 * the serialized arm would have been this repo's own headline mistake — an
 * instance fix wearing a class fix's clothes.
 *
 * ⚠️ The figure the COPY advertises stays `validateBudgetSecondsFor` — what we
 * grant the broker. The advertised promise and the abort deadline are deliberately
 * different numbers, and this widens only the second one.
 *
 * ⚠️ Never throws, for the same reason `validateBudgetMsFor` never does: `exchange`
 * is a wizard form value, so `null`, `undefined`, `""` and an unrecognised string
 * are all NORMAL input and all land on the default arm.
 */
export function connectAbortDeadlineMsFor(
  exchange: string | null | undefined,
): number {
  return (
    validateBudgetMsFor(exchange) +
    ENCRYPT_KEY_BUDGET_MS +
    BREAKER_STORE_WORST_CASE_FAILING_MS +
    WAIT_ABORT_GRACE_MS
  );
}
