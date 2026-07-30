/**
 * Phase 140.3-05 / ledger row TS-35 — cross-LANGUAGE drift-guard for the venue
 * transient key-validation contract.
 *
 * ONE committed truth table, TWO implementations bound to it
 * (`analytics-service/tests/fixtures/validate_key_venue_transient_contract.json`,
 * whose `consumers[1]` reserved this exact file):
 *   - analytics-service/routers/exchange.py + routers/portfolio.py — proven
 *     equal to the fixture's bodies through the REAL `main.app` TestClient
 *     stack by `analytics-service/tests/test_validate_key_venue_transient.py`.
 *   - src/lib/wizardErrors.ts `classifyKeyValidationError` — driven over every
 *     case below.
 *
 * WHAT THIS EXISTS TO CATCH, stated concretely because the row that ordered it
 * under-counted the damage by one. Replaying the substring cascade's own
 * predicates over these bytes, THREE of the six real verdicts were wrong —
 * and only two were visible as UNKNOWN:
 *
 *   EXCHANGE_UNAVAILABLE -> UNKNOWN               a venue maintenance window
 *                                                 rendered as "our team has
 *                                                 been notified"
 *   NETWORK_UNAVAILABLE  -> UNKNOWN               a two-string near-miss
 *   DDOS_PROTECTION      -> KEY_IP_ALLOWLIST      a block at the VENUE's edge
 *                                                 rendered as a fault in the
 *                                                 USER's key
 *
 * The third is the reason every assertion below binds to the fixture's
 * OUTCOMES and never to UNKNOWN-ness. An audit asking "does this fall through
 * to UNKNOWN?" returns a clean bill of health on a verdict that is actively
 * lying to the user (correction C-6).
 *
 * ⚠️ ZERO MODULE MOCKS. Two mocks agreeing with each other is not a fix, it is
 * the defect recreated — which is exactly how the Python and TypeScript suites
 * were both green while disagreeing about `/process-key`'s reply shape. An
 * acceptance grep counts the vitest module-mocking call in this file and
 * requires 0. `classifyKeyValidationError` reaches nothing that needs mocking:
 * its only import is the dependency-free `@/lib/seam-errors` leaf.
 *
 * ⚠️ THE FIXTURE IS COMMITTED, NEVER GENERATED. The `python` and
 * `frontend-test` CI jobs are siblings with no `needs:` edge, so a file one
 * writes is invisible to the other. Do NOT move it, copy it, or regenerate it.
 * This file reads it and modifies nothing under `analytics-service/`.
 *
 * ⚠️ NO HTTP STATUS IS PINNED AS A LITERAL ANYWHERE IN THIS FILE. Plan
 * `140.3-06` lands TS-32 in the next wave and remaps every one of these cases
 * from the caller-fault status to the dependency-fault one. Binding to those
 * bytes would make this test invalid one wave after it was written — the exact
 * hazard that made TS-35 and TS-32 a single unit split across two plans. The
 * status is READ from each case and only its INTERNAL CONSISTENCY is asserted.
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
  "analytics-service/tests/fixtures/validate_key_venue_transient_contract.json",
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

/**
 * The roster, typed HERE as a literal. Derived from NOTHING — not from the
 * fixture it guards, and not from `classifyKeyValidationError`, whose verdict
 * it is supposed to be able to disagree with. If the Python side renames a
 * code, drops a case, or flips a `recoverable`, this map disagrees and the
 * suite reddens instead of silently agreeing with whatever arrived.
 *
 * THREE INDEPENDENT COLUMNS, because they answer three different questions:
 *
 *   wizardCode          what the wizard renders for this wire code.
 *   wireRecoverable     what the PYTHON contract says. Derived in the router
 *                       from membership in `PERMANENT_VALIDATION_ERROR_CODES`,
 *                       an ALLOW-LIST OF PERMANENT — so non-membership means
 *                       "not known to be permanent" and an unrecognised future
 *                       code answers true (fail-safe).
 *   envelopeRecoverable what the WIZARD renders — derived from `actions`
 *                       through `RECOVERABLE_ACTIONS` in `src/lib/envelope.ts`,
 *                       and the thing that decides whether a Retry control
 *                       appears at all.
 *
 * The last two are NOT the same predicate and must not be collapsed. See the
 * named-divergence case below.
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
  // Correct through the cascade before TS-35; pinned so they stay correct.
  RATE_LIMITED: {
    wizardCode: "KEY_RATE_LIMIT",
    wireRecoverable: true,
    envelopeRecoverable: true,
  },
  PROBE_FAILED: {
    wizardCode: "KEY_PROBE_FAILED",
    wireRecoverable: true,
    envelopeRecoverable: true,
  },
  AUTH_FAILED: {
    wizardCode: "KEY_AUTH_FAILED",
    wireRecoverable: false,
    envelopeRecoverable: true,
  },
  // The three the cascade got wrong.
  EXCHANGE_UNAVAILABLE: {
    wizardCode: "KEY_EXCHANGE_UNAVAILABLE",
    wireRecoverable: true,
    envelopeRecoverable: true,
  },
  NETWORK_UNAVAILABLE: {
    wizardCode: "KEY_NETWORK_TIMEOUT",
    wireRecoverable: true,
    envelopeRecoverable: true,
  },
  DDOS_PROTECTION: {
    wizardCode: "KEY_VENUE_TRANSIENT",
    wireRecoverable: true,
    envelopeRecoverable: true,
  },
  // Correct BY CONSTRUCTION: the contract's own control for a code the table
  // has never seen. It must reach UNKNOWN through the surviving cascade, not
  // through a short-circuit above it.
  ZZ_UNRECOGNISED_VENUE_CODE: {
    wizardCode: "UNKNOWN",
    wireRecoverable: true,
    envelopeRecoverable: true,
  },
};

/**
 * The single wire code whose two `recoverable` answers legitimately disagree,
 * named so that any OTHER divergence is a failure rather than a shrug.
 *
 * Python says false: retrying the SAME credentials against the venue cannot
 * succeed, so it is "permanent". The wizard says true: `clear_and_retry` means
 * clear the fields and enter DIFFERENT credentials, which is precisely the fix.
 * Both are right about their own question. Collapsing them would either strip
 * the only actionable control off a wrong-key error, or tell the caller that a
 * dead credential is worth retrying unchanged.
 */
const DIVERGENT_WIRE_CODE = "AUTH_FAILED";

/**
 * Hand-typed counts. Written as literals, never `Object.keys(EXPECTED).length`
 * or `spec.cases.length` — a corpus that quietly shrinks would otherwise take
 * its own guard down with it.
 *
 * ⚠️ `NON_RECOVERABLE_WIRE_CASES` is 2, not 1. The plan that ordered this test
 * said "exactly 1 non-recoverable (AUTH_FAILED)"; the fixture carries the
 * permanent control at BOTH collapse sites (C6 and C7) on purpose, so that the
 * derivation is proven to be the same rule at the site with traffic and at the
 * dead one. One CODE, two CASES. Both numbers are pinned so neither reading can
 * quietly drift.
 */
const TOTAL_CASES = 14;
const DISTINCT_WIRE_CODES = 7;
const NON_RECOVERABLE_WIRE_CASES = 2;
const NON_RECOVERABLE_WIRE_CODES = 1;

/**
 * Build the throwable the seam client puts in front of the classifier: a plain
 * Error carrying the machine code as an OWN data property.
 *
 * This mirrors `AnalyticsUpstreamError`, deliberately without importing it.
 * That class drags `@/lib/resilient-fetch` and a top-level Redis singleton into
 * this file, and the property is read with `typeof`, never `instanceof`, so the
 * class identity is not part of the contract under test. That the REAL client
 * really does attach this property to what it really throws is pinned
 * separately, over these same bytes, in `src/lib/analytics-client.test.ts`
 * ("a venue-transient body's flat `code` reaches the thrown error").
 */
function seamThrowable(detail: string, code: string): Error {
  return Object.assign(new Error(detail), { seamCode: code });
}

afterEach(() => {
  // This file stubs nothing, and the guard is here so it stays that way. A
  // leaked global stub is this repo's known CI-only failure mode (CI runs
  // Node 22, local runs Node 25) and it is cheap to fence permanently.
  vi.unstubAllGlobals();
});

describe("[140.3-05 / TS-35] the wizard classifier agrees with the committed venue-transient contract", () => {
  it("this file is the consumer the fixture reserved", () => {
    // Provenance, asserted rather than assumed: if the fixture stops naming a
    // TypeScript consumer, this binding has been quietly dissolved and the two
    // languages are free to drift again.
    expect(spec.consumers.join(" ")).toContain("TypeScript parity test");
    expect(spec.consumers.join(" ")).toContain("TS-35");
  });

  it("carries exactly the canonical case roster — no silent shrink", () => {
    expect(
      spec.cases.length,
      "The fixture lost or gained cases. A corpus that quietly shrinks lets " +
        "the classifier degrade while every remaining assertion stays green.",
    ).toBe(TOTAL_CASES);

    const wireCodes = spec.cases.map((c) => c.body.code);
    expect(new Set(wireCodes).size).toBe(DISTINCT_WIRE_CODES);

    // Every code the fixture ships has a hand-typed expectation, and every
    // hand-typed expectation is exercised. Either direction failing means the
    // roster and the corpus have drifted apart.
    for (const code of new Set(wireCodes)) {
      expect(Object.keys(EXPECTED)).toContain(code);
    }
    for (const code of Object.keys(EXPECTED)) {
      expect(wireCodes).toContain(code);
    }
  });

  it("keeps its negatives — `recoverable` is not a field that is always true", () => {
    // A flag with one value pins nothing. The contract ships the permanent
    // control precisely so this assertion has something to hold on to.
    const nonRecoverable = spec.cases.filter((c) => !c.body.recoverable);
    expect(nonRecoverable.length).toBe(NON_RECOVERABLE_WIRE_CASES);
    expect(new Set(nonRecoverable.map((c) => c.body.code)).size).toBe(
      NON_RECOVERABLE_WIRE_CODES,
    );
    expect(nonRecoverable.map((c) => c.body.code)).toEqual([
      DIVERGENT_WIRE_CODE,
      DIVERGENT_WIRE_CODE,
    ]);
    // Both collapse sites, not just the one with traffic.
    expect(new Set(nonRecoverable.map((c) => c.site_id)).size).toBe(2);
  });

  it("every case answers ONE status, and this test does not care which", () => {
    // Read, never pinned. `140.3-06` remaps all of these in the next wave; the
    // invariant that survives that remap is that the seven sites answer the
    // SAME status as each other, which is what stops a partial remap from
    // shipping. A literal here would redden on correct work.
    const statuses = new Set(spec.cases.map((c) => c.status));
    expect(
      statuses.size,
      "The sites disagree about their status — a partial remap, which is the " +
        "under-delivery shape this programme keeps hitting.",
    ).toBe(1);
    for (const c of spec.cases) {
      expect(Number.isInteger(c.status)).toBe(true);
    }
  });

  it.each(spec.cases)(
    "$site_id / $trigger — wire code $body.code renders the right verdict",
    (testCase) => {
      const expected = EXPECTED[testCase.body.code];
      const verdict = classifyKeyValidationError(
        seamThrowable(testCase.body.detail, testCase.body.code),
      );

      expect(
        verdict.code,
        `The wizard's verdict for wire code ${testCase.body.code} moved. ` +
          `This binds to the fixture's OUTCOME, never to UNKNOWN-ness — ` +
          `DDOS_PROTECTION never reached UNKNOWN and was still wrong.`,
      ).toBe(expected.wizardCode);

      // The status the classifier returns is deliberately NOT asserted here.
      // It is the wizard's own answer, unit-pinned in
      // `src/lib/wizardErrors.test.ts`; asserting it here would tie this
      // cross-language file to a second moving part for no extra coverage.
      expect(Number.isInteger(verdict.status)).toBe(true);
    },
  );

  it.each(spec.cases)(
    "$site_id / $trigger — the wire `recoverable` matches the independently typed roster",
    (testCase) => {
      // Pure cross-language pin: the committed Python bytes against a value
      // typed by hand in this file. Nothing TypeScript-side can satisfy this
      // one, which is the point — it is the half that catches the OTHER
      // language moving.
      expect(testCase.body.recoverable).toBe(
        EXPECTED[testCase.body.code].wireRecoverable,
      );
    },
  );

  it.each(spec.cases)(
    "$site_id / $trigger — the rendered envelope offers the affordance the roster expects",
    (testCase) => {
      const expected = EXPECTED[testCase.body.code];
      const verdict = classifyKeyValidationError(
        seamThrowable(testCase.body.detail, testCase.body.code),
      );
      const envelope = buildEnvelope(verdict.code, "cid-parity");

      expect(
        envelope.recoverable,
        `Whether a Retry control renders for ${testCase.body.code} changed. ` +
          `\`recoverable\` is derived from \`actions\`, so this reddens when ` +
          `a code's actions are edited — which is a behaviour change wearing ` +
          `a copy change's clothes.`,
      ).toBe(expected.envelopeRecoverable);

      // The reconciliation. Where the two languages disagree it must be the
      // ONE named code; a new divergence is a failure, not a shrug.
      if (expected.wireRecoverable !== expected.envelopeRecoverable) {
        expect(
          testCase.body.code,
          "A new wire/wizard `recoverable` divergence appeared. Either the " +
            "wizard stopped offering an affordance the contract says exists, " +
            "or it started offering one on a verdict the contract calls " +
            "permanent. Both are user-visible; neither is a rename.",
        ).toBe(DIVERGENT_WIRE_CODE);
      }
    },
  );

  it("the one permitted divergence is the one that is actually there", () => {
    const divergent = Object.entries(EXPECTED)
      .filter(([, v]) => v.wireRecoverable !== v.envelopeRecoverable)
      .map(([code]) => code);
    expect(divergent).toEqual([DIVERGENT_WIRE_CODE]);
  });

  it("the surviving substring cascade still classifies these same bytes when no code rides", () => {
    // TS-35 keeps the cascade until every emitter carries a code. This case is
    // what makes "the cascade survives" checkable instead of asserted, and it
    // doubles as the measurement of what the code branch bought: the same
    // bytes, minus the machine code, still land where they always did.
    const withoutCode = (detail: string) =>
      classifyKeyValidationError(new Error(detail)).code;

    const byWireCode = new Map(
      spec.cases.map((c) => [c.body.code, c.body.detail] as const),
    );

    // Unchanged by TS-35 — these were already right.
    expect(withoutCode(byWireCode.get("RATE_LIMITED")!)).toBe("KEY_RATE_LIMIT");
    expect(withoutCode(byWireCode.get("PROBE_FAILED")!)).toBe(
      "KEY_PROBE_FAILED",
    );
    expect(withoutCode(byWireCode.get("AUTH_FAILED")!)).toBe("KEY_AUTH_FAILED");

    // The three TS-35 moved. Without the machine code they are still broken —
    // which is why deleting the emitters' codes, not just the branch, would
    // re-open the class from the other side.
    expect(withoutCode(byWireCode.get("EXCHANGE_UNAVAILABLE")!)).toBe("UNKNOWN");
    expect(withoutCode(byWireCode.get("NETWORK_UNAVAILABLE")!)).toBe("UNKNOWN");
    expect(
      withoutCode(byWireCode.get("DDOS_PROTECTION")!),
      "The venue WAF block's detail ends 'Check region / IP allowlist.' and " +
        "the cascade tests for `ip` AND `allow`. This is the mis-map, still " +
        "present in the fallback and still invisible to an UNKNOWN-ness audit.",
    ).toBe("KEY_IP_ALLOWLIST");
  });
});
