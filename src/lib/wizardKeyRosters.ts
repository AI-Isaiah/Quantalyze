/**
 * The two key-entry wizard steps' code rosters, derived per route
 * (Phase 215 / SC-5, 2026-11-15).
 *
 * `KNOWN_CREATE_WITH_KEY_CODES` is the allowlist `ConnectKeyStep` checks a
 * `POST /api/strategies/create-with-key` failure body's `code` against, and
 * `KNOWN_ADD_KEY_CODES` is the one `MultiKeyConnectStep` checks a
 * `POST /api/strategies/composite/add-key` body against. Before this module both
 * were hand-typed `new Set([...])` literals inside the step files, with about 20
 * rows each typed twice: the codes the shared `classifyKeyValidationError` can
 * return. Deleting one such row was measured (153.7) to leave 312 tests green
 * while re-creating the 2026-08-05 incident.
 *
 * WHY A MEMBERSHIP CHECK EXISTS AT ALL. `data.code` is whatever an upstream, a
 * proxy or an edge layer put in a JSON body. A cast to `WizardErrorCode` is a
 * compile-time assertion only: an unlisted string would be handed to
 * `buildEnvelope` and render `WIZARD_ERROR_COPY[code]`, which is `undefined`.
 * The step therefore admits only codes its own route can send, and everything
 * else renders `UNKNOWN`. `UNKNOWN`'s copy is RECOVERABLE ("Try the last action
 * again.", with a Retry control), so a code wrongly left off a roster turns a
 * non-retryable fault into a Retry button.
 *
 * WHY THERE ARE TWO SETS AND THEY ARE NEVER MERGED. A step should admit the
 * codes ITS route emits, not every code in the vocabulary: a `CSV_NAV_ZERO`
 * arriving at the exchange form is drift, not a key failure. The two routes'
 * direct emissions differ (`KEY_ORPHANED` and the venue-identity 409s are
 * create-with-key only; `COMPOSITE_MT5_UNSUPPORTED` is add-key only), so one
 * shared set would silently admit each route's codes at the other. They share
 * only the classifier-returned half, which is identical by construction because
 * both routes call the one classifier. `wizardKeyRosters.test.ts` pins that the
 * two exports are different objects with different members.
 *
 * WHY TRANSLATE-FIRST CODES ARE NOT MEMBERS. Both steps run the wire code
 * through `recogniseSeamErrorCode` BEFORE the membership check. A code that
 * table answers (`SEAM_CODE_TO_WIZARD_CODE` keys: `VALIDATION_FAILED`,
 * `RATE_LIMITED`, `CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK_ERROR`,
 * `SEAM_MISCONFIGURED`, `CSV_RATE_LIMIT`) never reaches the roster, so a
 * classifier verdict that is also a key of that table (`SEAM_MISCONFIGURED`,
 * which three verdict-table rows map onto) needs no row. `RATE_LIMITED` is the
 * one deliberate exception, listed in each route's own tuple: it is the code
 * each route MINTS at its per-user limiter, written down here rather than
 * borrowed from the shared wire table, so a future edit to that table is a
 * caught change instead of a rendered one.
 *
 * WHAT IS DERIVED AND WHAT IS TYPED ONCE.
 *   - Derived live: the verdict-table codes, from `VENUE_WIRE_CODE_TO_VERDICT`,
 *     so a new verdict row joins both rosters with no edit here. This is the
 *     half that used to need a hand-typed row at both steps in the same commit.
 *   - Typed once: `KEY_CLASSIFIER_CASCADE_CODES`. The cascade's literal returns
 *     inside `classifyKeyValidationError` stay literal (the invariant scanner
 *     `deriveClassifierCascadeCodes` reads exactly those `return { code: "X"`
 *     literals), so the tuple is pinned EQUAL to the scanned cascade, both
 *     directions, in `wizardErrors.invariant.test.ts`. It is not computed.
 *   - Typed once per route: `CREATE_WITH_KEY_OWN_CODES` and `ADD_KEY_OWN_CODES`,
 *     each pinned both directions to its route's literal 400 emitter scan plus
 *     its 409 emitter scan, its RATE_LIMITED twin, and its three permission
 *     codes, in the same invariant file.
 */
import type { WizardErrorCode } from "./wizardErrors";
import {
  VENUE_WIRE_CODE_TO_VERDICT,
  recogniseSeamErrorCode,
} from "./wizardErrors";

/**
 * Every code `classifyKeyValidationError`'s cascade returns as a literal, typed
 * ONCE. Pinned equal (both directions) to the scanned cascade in
 * `wizardErrors.invariant.test.ts`; that pin is what keeps a new cascade arm
 * from joining the classifier without joining this tuple.
 */
export const KEY_CLASSIFIER_CASCADE_CODES = [
  "SERVICE_UNAVAILABLE_RETRY",
  "KEY_INVALID_SIGNATURE",
  "KEY_AUTH_FAILED",
  "KEY_MT5_MASTER_PASSWORD",
  "KEY_MT5_WRONG_SERVER",
  "KEY_IP_ALLOWLIST",
  "KEY_RATE_LIMIT",
  "KEY_NETWORK_TIMEOUT",
  "KEY_PROBE_FAILED",
  "KEY_HAS_TRADING_PERMS",
  "UNKNOWN",
] as const satisfies readonly WizardErrorCode[];

/**
 * The codes the shared classifier can hand a key step: the live verdict table's
 * codes plus the cascade tuple, minus every code the translate-first hop
 * answers.
 */
export const CLASSIFIER_RETURNED_CODES: readonly WizardErrorCode[] = [
  ...new Set<WizardErrorCode>([
    ...[...VENUE_WIRE_CODE_TO_VERDICT.values()].map((v) => v.code),
    ...KEY_CLASSIFIER_CASCADE_CODES,
  ]),
]
  // "Is a key of SEAM_CODE_TO_WIZARD_CODE" is exactly `!== "UNKNOWN"`: no entry
  // of that map has the value "UNKNOWN" (measured at 08451cfcc: seven entries, five
  // distinct values), so the exported lookup is a faithful membership test.
  .filter((code) => recogniseSeamErrorCode(code) === "UNKNOWN");

/**
 * What `POST /api/strategies/create-with-key` puts on the wire by itself
 * (`src/app/api/strategies/create-with-key/route.ts`): its literal 400 guards,
 * its 409 refusals (the wizard-session fence and the venue fence), its
 * `RATE_LIMITED` limiter arms, and the three permission refusals its
 * read-only check picks between with a ternary.
 */
export const CREATE_WITH_KEY_OWN_CODES = [
  "KEY_INVALID_FORMAT",
  "KEY_MISSING_REQUIRED_FIELD",
  "KEY_UNSUPPORTED_VENUE",
  "KEY_VENUE_NOT_ENABLED",
  "KEY_INPUT_TOO_LONG",
  "PRESELECT_REQUEST_INVALID",
  "DRAFT_ALREADY_EXISTS",
  "DRAFT_SESSION_COLLISION",
  "VENUE_ALREADY_CONNECTED",
  "VENUE_DRAFT_IN_PROGRESS",
  "KEY_ORPHANED",
  "KEY_VENUE_ALREADY_CONNECTED",
  "KEY_REUSE_UNAVAILABLE",
  "RATE_LIMITED",
  "KEY_NOT_READ_ONLY",
  "KEY_HAS_TRADING_PERMS",
  "KEY_HAS_WITHDRAW_PERMS",
  "KEY_MT5_WRONG_SERVER",
] as const satisfies readonly WizardErrorCode[];

/**
 * What `POST /api/strategies/composite/add-key` puts on the wire by itself
 * (`src/app/api/strategies/composite/add-key/route.ts`): its literal 400 guards
 * (including the mt5 refusal), its one 409, its `RATE_LIMITED` limiter arm, and
 * the same three permission refusals. It has no venue-identity 409s: that
 * constraint is unreachable there.
 */
export const ADD_KEY_OWN_CODES = [
  "KEY_INVALID_FORMAT",
  "KEY_MISSING_REQUIRED_FIELD",
  "KEY_UNSUPPORTED_VENUE",
  "KEY_VENUE_NOT_ENABLED",
  "KEY_INPUT_TOO_LONG",
  "COMPOSITE_MT5_UNSUPPORTED",
  "DRAFT_ALREADY_EXISTS",
  "RATE_LIMITED",
  "KEY_NOT_READ_ONLY",
  "KEY_HAS_TRADING_PERMS",
  "KEY_HAS_WITHDRAW_PERMS",
] as const satisfies readonly WizardErrorCode[];

/** The roster `ConnectKeyStep` checks a create-with-key failure code against. */
export const KNOWN_CREATE_WITH_KEY_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    ...CLASSIFIER_RETURNED_CODES,
    ...CREATE_WITH_KEY_OWN_CODES,
  ]);

/**
 * The roster `MultiKeyConnectStep` checks a composite/add-key failure code
 * against. A SEPARATE Set from the create-with-key one, on purpose: see the
 * module docblock.
 */
export const KNOWN_ADD_KEY_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([...CLASSIFIER_RETURNED_CODES, ...ADD_KEY_OWN_CODES]);
