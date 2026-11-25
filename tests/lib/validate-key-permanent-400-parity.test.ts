/**
 * Phase 240 CONNECTTRUTH plan 03 (CONN-05) - rendered-verdict parity for the
 * permanent validate-key 400 arms.
 *
 * ONE committed truth table, TWO implementations bound to it
 * (`analytics-service/tests/fixtures/validate_key_permanent_400_contract.json`):
 *   - analytics-service/routers/exchange.py - proven equal to the fixture's bodies
 *     through the REAL `main.app` TestClient stack by
 *     `analytics-service/tests/test_validate_key_permanent_400.py`.
 *   - src/lib/wizardErrors.ts `classifyKeyValidationError` - driven over every case
 *     below, once with the new flat body (detail + machine code) and once with the
 *     HEAD-shape body (the same detail, no code).
 *
 * WHAT THIS EXISTS TO CATCH: adding a machine code to a 400 arm must move NO
 * rendered copy and NO Retry control (UI-SPEC section 2, G3). The assertion is that
 * the verdict for the coded body equals the verdict for the HEAD-shape body, and
 * that both equal a roster typed here.
 *
 * ZERO MODULE MOCKS. `classifyKeyValidationError` reaches nothing that needs
 * mocking. The fixture is COMMITTED, never generated, and this file modifies
 * nothing under `analytics-service/`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyKeyValidationError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/validate_key_permanent_400_contract.json",
);

interface ContractCase {
  site_id: string;
  trigger: string;
  note: string;
  status: number;
  body: { detail: string; code: string; recoverable: boolean };
}

interface ContractSpec {
  consumers: string[];
  cases: ContractCase[];
}

const spec = JSON.parse(readFileSync(FIXTURE, "utf8")) as ContractSpec;

/** The UNKNOWN entry's Retry affordance (the wizard offers Retry), typed here from a replay of `buildEnvelope("UNKNOWN", ...)`. */
const ENVELOPE_RECOVERABLE_UNKNOWN = true;

/**
 * The roster, typed HERE as a literal. Derived from NOTHING: not from the fixture it
 * guards and not from `classifyKeyValidationError`, whose verdict it must be able to
 * disagree with. Each row was filled from a replay of the real classifier.
 *
 * `wireRecoverable` is what the Python contract says (false: permanent).
 * `envelopeRecoverable` is what the wizard renders, derived from `actions` through
 * `RECOVERABLE_ACTIONS` in `src/lib/envelope.ts`. They are different questions and
 * are pinned in separate columns.
 */
const EXPECTED: Readonly<
  Record<
    string,
    {
      wizardCode: WizardErrorCode;
      wireRecoverable: boolean;
      envelopeRecoverable: boolean;
    }
  >
> = {
  AUTH_FAILED: {
    wizardCode: "KEY_AUTH_FAILED",
    wireRecoverable: false,
    envelopeRecoverable: true,
  },
  MT5_WRONG_SERVER: {
    wizardCode: "KEY_MT5_WRONG_SERVER",
    wireRecoverable: false,
    envelopeRecoverable: true,
  },
  MT5_MASTER_PASSWORD: {
    wizardCode: "KEY_MT5_MASTER_PASSWORD",
    wireRecoverable: false,
    envelopeRecoverable: true,
  },
  // Plan 05 (UI-SPEC rulings R1 and R2): the two codes with NO verdict row. Both render
  // the honest UNKNOWN because no existing entry is wholly true on those arms; the row
  // was filled from a replay of the real classifier on 2026-11-24 (coded body and
  // HEAD-shape body both UNKNOWN/500). The pin is that adding the code moved nothing.
  VENUE_DISABLED: {
    wizardCode: "UNKNOWN",
    wireRecoverable: false,
    envelopeRecoverable: ENVELOPE_RECOVERABLE_UNKNOWN,
  },
  INVALID_REQUEST: {
    wizardCode: "UNKNOWN",
    wireRecoverable: false,
    envelopeRecoverable: ENVELOPE_RECOVERABLE_UNKNOWN,
  },
};

/** Hand-typed, never `spec.cases.length`: a corpus that shrinks must not take its guard down. */
const TOTAL_CASES = 12;
const DISTINCT_WIRE_CODES = 5;

/** The throwable the seam client puts in front of the classifier: the machine code as an own data property. */
function seamThrowable(detail: string, code: string): Error {
  return Object.assign(new Error(detail), { seamCode: code });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("[CONN-05] the wizard verdict is unchanged by the code on the permanent 400 arms", () => {
  it("this file is the consumer the fixture names", () => {
    expect(spec.consumers.join(" ")).toContain(
      "tests/lib/validate-key-permanent-400-parity.test.ts",
    );
  });

  it("carries exactly the canonical case roster, no silent shrink", () => {
    expect(spec.cases.length).toBe(TOTAL_CASES);
    const wireCodes = new Set(spec.cases.map((c) => c.body.code));
    expect(wireCodes.size).toBe(DISTINCT_WIRE_CODES);
    for (const code of wireCodes) {
      expect(Object.keys(EXPECTED)).toContain(code);
    }
    for (const code of Object.keys(EXPECTED)) {
      expect(wireCodes.has(code)).toBe(true);
    }
  });

  it("every case is a 400 and permanent (recoverable false)", () => {
    for (const c of spec.cases) {
      expect(c.status).toBe(400);
      expect(c.body.recoverable).toBe(false);
    }
  });

  it.each(spec.cases)(
    "$site_id / $trigger: the coded body renders the roster verdict",
    (testCase) => {
      const expected = EXPECTED[testCase.body.code];
      const verdict = classifyKeyValidationError(
        seamThrowable(testCase.body.detail, testCase.body.code),
      );
      expect(verdict.code).toBe(expected.wizardCode);
    },
  );

  it.each(spec.cases)(
    "$site_id / $trigger: the HEAD-shape body (same detail, no code) renders the SAME verdict",
    (testCase) => {
      const expected = EXPECTED[testCase.body.code];
      const coded = classifyKeyValidationError(
        seamThrowable(testCase.body.detail, testCase.body.code),
      );
      const headShape = classifyKeyValidationError(new Error(testCase.body.detail));
      expect(
        headShape.code,
        "Adding the machine code moved the rendered verdict: the bare-detail " +
          "body and the coded body must classify identically.",
      ).toBe(coded.code);
      expect(headShape.code).toBe(expected.wizardCode);
    },
  );

  it.each(spec.cases)(
    "$site_id / $trigger: the Retry affordance comes from the copy entry's actions, as today",
    (testCase) => {
      const expected = EXPECTED[testCase.body.code];
      const coded = buildEnvelope(
        classifyKeyValidationError(
          seamThrowable(testCase.body.detail, testCase.body.code),
        ).code,
        "cid-parity",
      );
      const headShape = buildEnvelope(
        classifyKeyValidationError(new Error(testCase.body.detail)).code,
        "cid-parity",
      );
      expect(coded.recoverable).toBe(expected.envelopeRecoverable);
      expect(coded.recoverable).toBe(headShape.recoverable);
      // The whole envelope (copy, cause, fix list, recoverable) is the same for
      // the coded body and the HEAD-shape body, with only the correlation id equal.
      expect(coded).toEqual(headShape);
      expect(testCase.body.recoverable).toBe(expected.wireRecoverable);
    },
  );
});
