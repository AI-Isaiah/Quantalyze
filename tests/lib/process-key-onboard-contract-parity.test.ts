/**
 * Phase 140.1.1 / PYAPIFIX-01 — cross-PROCESS drift-guard for the ONE
 * `/process-key` onboard reply contract.
 *
 * The finding this test exists to close: the Python suite and the TypeScript
 * suite were **both green because each mocked the other**, so neither could
 * see that `analytics-service/routers/process_key.py:_wizard_duplicate_reply`
 * emits a shape `src/lib/process-key-onboard-contract.ts` rejected — a 502 +
 * Sentry "process-key onboard contract violation" on a successful resume.
 *
 * There are TWO implementations of that contract bound to ONE committed truth
 * table (`analytics-service/tests/fixtures/process_key_onboard_contract.json`,
 * whose `consumers[]` names this file):
 *   - analytics-service/routers/process_key.py  (`_wizard_duplicate_reply`)
 *     — proven equal to the fixture's positive bodies through the REAL
 *     `main.app` TestClient stack by
 *     `analytics-service/tests/test_process_key_onboard_contract.py`.
 *   - src/lib/process-key-onboard-contract.ts   (`isProcessKeyOnboardResponse`)
 *     — driven over every case, below.
 *
 * ⚠️ **This file must contain ZERO module mocks** — the acceptance grep for
 * PYAPIFIX-01 counts occurrences of the vitest module-mocking call in this
 * file and requires 0. A second pair of mocks agreeing with each other is not
 * a fix — it is the defect, recreated. The
 * predicate lives in a dependency-free leaf precisely so the REAL production
 * predicate is reachable here with no mocking at all, and the fixture is the
 * ONLY shared artifact: neither side reads its expectations out of the other's
 * implementation.
 *
 * ⚠️ The fixture is **COMMITTED, never generated.** The `python`
 * (`.github/workflows/ci.yml:933`) and `frontend-test` (`:206`) jobs are
 * siblings with no `needs:` edge, so a file written by one is never visible to
 * the other. Do NOT move it and do NOT copy it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isProcessKeyOnboardResponse } from "@/lib/process-key-onboard-contract";

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/process_key_onboard_contract.json",
);

interface ContractCase {
  name: string;
  note: string;
  body: Record<string, unknown>;
  expect_valid: boolean;
}

interface ContractSpec {
  consumers: string[];
  cases: ContractCase[];
}

const spec = JSON.parse(readFileSync(FIXTURE, "utf8")) as ContractSpec;

/**
 * The case roster, typed HERE as a literal — never derived from the fixture it
 * guards, and never derived from the module under test. If a case is renamed,
 * dropped, or has its verdict flipped on the Python side, this map disagrees
 * and the suite reddens instead of silently shrinking.
 */
const EXPECTED_VERDICTS: Readonly<Record<string, boolean>> = {
  queued_true_resumed_wedge: true,
  queued_false_finished_duplicate: true,
  queued_absent: false,
  empty_code: false,
  idempotent_without_duplicate_code: false,
};

describe("isProcessKeyOnboardResponse mirrors the committed process_key_onboard_contract.json", () => {
  // Silent-shrink guard (E-P1 window_overlap_convention idiom): the fixture
  // ships exactly 5 cases — 2 accepted, 3 rejected. A corpus that quietly
  // loses its negatives would let the predicate degrade to `() => true` and
  // stay green, which is the exact failure PYAPIFIX-01 is closing.
  it("carries exactly the 5 canonical cases — 2 accepted, 3 rejected", () => {
    expect(
      spec.cases.length,
      "process_key_onboard_contract.json must carry exactly 5 cases; a shrunk corpus silently weakens the cross-process drift-guard",
    ).toBe(5);
    expect(spec.cases.filter((c) => c.expect_valid === true).length).toBe(2);
    expect(spec.cases.filter((c) => c.expect_valid === false).length).toBe(3);
    expect(new Set(spec.cases.map((c) => c.name)).size).toBe(5);
  });

  it("agrees with the independently-typed case roster", () => {
    const fromFixture: Record<string, boolean> = {};
    for (const c of spec.cases) fromFixture[c.name] = c.expect_valid;
    expect(fromFixture).toEqual(EXPECTED_VERDICTS);
  });

  it.each(spec.cases)(
    "case '$name' → isProcessKeyOnboardResponse === $expect_valid",
    (c) => {
      expect(
        isProcessKeyOnboardResponse(c.body),
        `${c.name}: ${c.note}`,
      ).toBe(c.expect_valid);
    },
  );

  // The defect itself, asserted semantically rather than only through
  // `expect_valid`: the resumed-wedge reply carries BOTH the job fact
  // (`queued:true`) and the submission fact (`code`/`idempotent`). Those are
  // orthogonal — `_resume_duplicate_job` exists to produce the state where
  // both are true — and the predicate must admit that combination.
  it("accepts the mixed envelope the backbone actually emits (queued:true WITH code+idempotent)", () => {
    const mixed = spec.cases.find(
      (c) =>
        c.body.queued === true &&
        c.body.code === "WIZARD_DUPLICATE" &&
        c.body.idempotent === true,
    );
    expect(
      mixed,
      "the fixture must still carry a queued:true + WIZARD_DUPLICATE + idempotent case — it is the shape PYAPI-09 introduced and the whole subject of PYAPIFIX-01",
    ).toBeDefined();
    expect(mixed!.expect_valid).toBe(true);
    expect(isProcessKeyOnboardResponse(mixed!.body)).toBe(true);
  });

  // Anti-degradation: the widening is scoped to the WIZARD_DUPLICATE contract,
  // never a blanket allowance. A predicate that stopped inspecting `code`
  // would pass every case above and fail here.
  it("still rejects a queued:true mixed envelope whose code is NOT the duplicate signal", () => {
    expect(
      isProcessKeyOnboardResponse({
        ok: true,
        code: "OTHER",
        idempotent: true,
        verification_id: "55555555-5555-4555-8555-000000000005",
        queued: true,
        job_state: "enqueued",
      }),
    ).toBe(false);
  });
});
