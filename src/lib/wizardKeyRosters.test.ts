// @vitest-environment node

import { describe, it, expect } from "vitest";
import { recogniseSeamErrorCode, type WizardErrorCode } from "./wizardErrors";
import {
  CLASSIFIER_RETURNED_CODES,
  KNOWN_ADD_KEY_CODES,
  KNOWN_CREATE_WITH_KEY_CODES,
} from "./wizardKeyRosters";

/**
 * Phase 215 / SC-5 — the two key-step rosters are derived per route
 * (`wizardKeyRosters.ts`), and these pins are what proves the derivation changed
 * no behaviour.
 *
 * FROZEN, HAND-TYPED, SORTED, 2026-11-15. These are the members the two step
 * files carried at 08451cfcc, copied BEFORE the roster module existed. They are
 * the no-behaviour-change oracle for Phase 215: each derived set must equal its
 * array member for member. Change one only together with a deliberate roster
 * decision, never to make a failing derivation pass. The arrays are literals on
 * purpose: sizing or building them from the exports under test would make the
 * pin unable to fail.
 *
 * +1 each at 2026-11-19 (Phase 218 plan 03): `KEY_MT5_TERMINAL_NOT_READY` arrives with its
 * `VENUE_WIRE_CODE_TO_VERDICT` row (wire `MT5_TERMINAL_NOT_READY`, 424), a deliberate roster
 * decision (CONTEXT: a new wire code distinct from the busy one). Inserted in sorted
 * position in both arrays; the vacuity floors below did not move.
 *
 * +1 to the create-with-key array only at 2026-11-24 (Phase 225 plan 05, CONN-01):
 * `VENUE_DRAFT_IN_PROGRESS`, the by-name refusal of an own-draft match, a deliberate
 * roster decision (founder D-23). Composites are out (F-2 / Q4), so the add-key array is
 * unchanged.
 *
 * +1 each at 2026-11-25 (Phase 225 SIGNINREFUSED): `KEY_MT5_SIGN_IN_REFUSED` arrives with its
 * `VENUE_WIRE_CODE_TO_VERDICT` row (wire `MT5_SIGN_IN_REFUSED`, 424, `recoverable=False`),
 * a deliberate roster decision: a login-stage MT5 `last_error` -6 at validation is the
 * broker's own refusal, and without the row both forms would render UNKNOWN, whose copy
 * offers a Retry. Inserted in sorted position in both arrays; the vacuity floors below did
 * not move.
 */
const FROZEN_CREATE_WITH_KEY_215: readonly string[] = [
  "DRAFT_ALREADY_EXISTS",
  "DRAFT_SESSION_COLLISION",
  "KEY_AUTH_FAILED",
  "KEY_EXCHANGE_UNAVAILABLE",
  "KEY_HAS_TRADING_PERMS",
  "KEY_HAS_WITHDRAW_PERMS",
  "KEY_INPUT_TOO_LONG",
  "KEY_INVALID_FORMAT",
  "KEY_INVALID_SIGNATURE",
  "KEY_IP_ALLOWLIST",
  "KEY_MISSING_READ_SCOPE",
  "KEY_MISSING_REQUIRED_FIELD",
  "KEY_MT5_MASTER_PASSWORD",
  "KEY_MT5_SERVER_UNKNOWN",
  "KEY_MT5_SIGN_IN_REFUSED",
  "KEY_MT5_TERMINAL_BUSY",
  "KEY_MT5_TERMINAL_NOT_READY",
  "KEY_MT5_TERMINAL_UNRESPONSIVE",
  "KEY_MT5_VALIDATION_UNCONFIGURED",
  "KEY_MT5_WRONG_SERVER",
  "KEY_MUST_BE_RECONNECTED",
  "KEY_NETWORK_TIMEOUT",
  "KEY_NOT_READ_ONLY",
  "KEY_ORPHANED",
  "KEY_PERMISSION_DENIED",
  "KEY_PROBE_FAILED",
  "KEY_RATE_LIMIT",
  "KEY_REUSE_UNAVAILABLE",
  "KEY_SIGN_IN_FAILED",
  "KEY_UNSUPPORTED_VENUE",
  "KEY_VENUE_ALREADY_CONNECTED",
  "KEY_VENUE_NOT_ENABLED",
  "KEY_VENUE_TRANSIENT",
  "PRESELECT_REQUEST_INVALID",
  "RATE_LIMITED",
  "SEAM_INTERNAL_FAULT",
  "SERVICE_UNAVAILABLE_RETRY",
  "SERVICE_UNREACHABLE",
  "UNKNOWN",
  "VENUE_ALREADY_CONNECTED",
  "VENUE_DRAFT_IN_PROGRESS",
];

const FROZEN_ADD_KEY_215: readonly string[] = [
  "COMPOSITE_MT5_UNSUPPORTED",
  "DRAFT_ALREADY_EXISTS",
  "KEY_AUTH_FAILED",
  "KEY_EXCHANGE_UNAVAILABLE",
  "KEY_HAS_TRADING_PERMS",
  "KEY_HAS_WITHDRAW_PERMS",
  "KEY_INPUT_TOO_LONG",
  "KEY_INVALID_FORMAT",
  "KEY_INVALID_SIGNATURE",
  "KEY_IP_ALLOWLIST",
  "KEY_MISSING_READ_SCOPE",
  "KEY_MISSING_REQUIRED_FIELD",
  "KEY_MT5_MASTER_PASSWORD",
  "KEY_MT5_SERVER_UNKNOWN",
  "KEY_MT5_SIGN_IN_REFUSED",
  "KEY_MT5_TERMINAL_BUSY",
  "KEY_MT5_TERMINAL_NOT_READY",
  "KEY_MT5_TERMINAL_UNRESPONSIVE",
  "KEY_MT5_VALIDATION_UNCONFIGURED",
  "KEY_MT5_WRONG_SERVER",
  "KEY_MUST_BE_RECONNECTED",
  "KEY_NETWORK_TIMEOUT",
  "KEY_NOT_READ_ONLY",
  "KEY_PERMISSION_DENIED",
  "KEY_PROBE_FAILED",
  "KEY_RATE_LIMIT",
  "KEY_SIGN_IN_FAILED",
  "KEY_UNSUPPORTED_VENUE",
  "KEY_VENUE_NOT_ENABLED",
  "KEY_VENUE_TRANSIENT",
  "RATE_LIMITED",
  "SEAM_INTERNAL_FAULT",
  "SERVICE_UNAVAILABLE_RETRY",
  "SERVICE_UNREACHABLE",
  "UNKNOWN",
];

/** Both directions, naming the extra and the missing codes. */
function diff(actual: ReadonlySet<string>, frozen: readonly string[]) {
  const want = new Set(frozen);
  return {
    extra: [...actual].filter((c) => !want.has(c)).sort(),
    missing: frozen.filter((c) => !actual.has(c)).sort(),
  };
}

describe("[215-07 SC-5] the derived rosters equal the rosters the steps shipped at 08451cfcc", () => {
  it("the frozen literals are well-formed: sorted, duplicate-free", () => {
    // A frozen pin that carries a duplicate or an unsorted row has been edited
    // by hand without care, and its size would no longer mean what it says.
    for (const frozen of [FROZEN_CREATE_WITH_KEY_215, FROZEN_ADD_KEY_215]) {
      expect([...frozen]).toEqual([...frozen].sort());
      expect(new Set(frozen).size).toBe(frozen.length);
    }
  });

  it.each([
    ["KNOWN_CREATE_WITH_KEY_CODES", KNOWN_CREATE_WITH_KEY_CODES, FROZEN_CREATE_WITH_KEY_215],
    ["KNOWN_ADD_KEY_CODES", KNOWN_ADD_KEY_CODES, FROZEN_ADD_KEY_215],
  ] as const)("%s equals its frozen roster member for member", (name, derived, frozen) => {
    const { extra, missing } = diff(derived, frozen);
    expect(
      { extra, missing },
      `${name} no longer equals the roster the step carried at 08451cfcc. ` +
        `"extra" are codes the derivation now admits that the step did not; ` +
        `"missing" are codes it no longer admits, which render UNKNOWN with a ` +
        `Retry control. Change the frozen array only with a deliberate roster ` +
        `decision.`,
    ).toEqual({ extra: [], missing: [] });
  });

  it("vacuity floors: neither derived set can be a stub", () => {
    // Same floors `wizardErrors.roster-render.test.tsx` uses for the two
    // surfaces (28 and 23).
    expect(KNOWN_CREATE_WITH_KEY_CODES.size).toBeGreaterThanOrEqual(28);
    expect(KNOWN_ADD_KEY_CODES.size).toBeGreaterThanOrEqual(23);
  });
});

describe("[215-07 SC-5] the two rosters stay separate sets", () => {
  it("are different objects", () => {
    expect(KNOWN_CREATE_WITH_KEY_CODES).not.toBe(KNOWN_ADD_KEY_CODES);
  });

  it("are not equal as sets, in the direction each route's own codes make them differ", () => {
    // The merge the step docblocks forbid would admit each route's codes at the
    // other. KEY_ORPHANED is create-with-key only (the venue-identity constraint
    // is unreachable on add-key); COMPOSITE_MT5_UNSUPPORTED is add-key only.
    expect(KNOWN_CREATE_WITH_KEY_CODES.has("KEY_ORPHANED")).toBe(true);
    expect(KNOWN_ADD_KEY_CODES.has("KEY_ORPHANED")).toBe(false);
    expect(KNOWN_ADD_KEY_CODES.has("COMPOSITE_MT5_UNSUPPORTED")).toBe(true);
    expect(KNOWN_CREATE_WITH_KEY_CODES.has("COMPOSITE_MT5_UNSUPPORTED")).toBe(false);
    // 225-05 / CONN-01: the own-draft refusal is create-with-key only; composites
    // are out of scope (F-2 / Q4), so add-key must not admit it.
    expect(KNOWN_CREATE_WITH_KEY_CODES.has("VENUE_DRAFT_IN_PROGRESS")).toBe(true);
    expect(KNOWN_ADD_KEY_CODES.has("VENUE_DRAFT_IN_PROGRESS")).toBe(false);
    expect([...KNOWN_CREATE_WITH_KEY_CODES].sort()).not.toEqual(
      [...KNOWN_ADD_KEY_CODES].sort(),
    );
  });
});

describe("[215-07 SC-5] the translate-first subtraction cannot go vacuous", () => {
  it("no classifier-returned member is translated by recogniseSeamErrorCode", () => {
    expect(CLASSIFIER_RETURNED_CODES.length).toBeGreaterThanOrEqual(20);
    const translated = CLASSIFIER_RETURNED_CODES.filter(
      (c) => recogniseSeamErrorCode(c) !== "UNKNOWN",
    );
    expect(translated).toEqual([]);
  });

  it("recogniseSeamErrorCode really does translate each of the seven seam keys", () => {
    // Hand-typed: if the predicate stopped answering for the real keys, the
    // subtraction would remove nothing and the check above would pass for the
    // wrong reason.
    const SEAM_KEYS = [
      "VALIDATION_FAILED",
      "RATE_LIMITED",
      "CIRCUIT_OPEN",
      "UPSTREAM_TIMEOUT",
      "UPSTREAM_NETWORK_ERROR",
      "SEAM_MISCONFIGURED",
      "CSV_RATE_LIMIT",
    ];
    for (const key of SEAM_KEYS) {
      expect(recogniseSeamErrorCode(key), `${key} is no longer translated`).not.toBe(
        "UNKNOWN",
      );
    }
    // SEAM_MISCONFIGURED is the live case of a verdict-table VALUE that the
    // subtraction must drop: three verdict rows map onto it, and it is a seam key.
    const droppedType: WizardErrorCode = "SEAM_MISCONFIGURED";
    expect(CLASSIFIER_RETURNED_CODES.includes(droppedType)).toBe(false);
  });
});
