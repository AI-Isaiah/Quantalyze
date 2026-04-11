import { describe, it, expect } from "vitest";
import {
  EnqueueComputeJobResponseSchema,
  TickJobsResponseSchema,
} from "./analytics-schemas";

/**
 * Unit tests for the Sprint 2 Task 2.9 strict-versioned contracts.
 *
 * These tests exist specifically to pin down the "fail loud on contract
 * drift" guarantee of the strict-versioned style. The legacy loose
 * .passthrough() schemas in analytics-schemas.ts are not covered here
 * because their contract is "warn on drift, accept extras" — nothing to
 * pin. The strict schemas are the first ones where a future accidental
 * loosening (.optional, wider type) would silently pass review, so we
 * lock in the exact behavior with negative-path tests.
 */

describe("EnqueueComputeJobResponseSchema", () => {
  it("accepts a valid UUID", () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    expect(EnqueueComputeJobResponseSchema.parse(uuid)).toBe(uuid);
  });

  it.each([
    ["not-a-uuid"],
    [""],
    ["11111111-2222-4333-8444"],
    ["11111111222243338444555555555555"],
  ])("rejects malformed string %p", (value) => {
    const result = EnqueueComputeJobResponseSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [[]]])(
    "rejects non-string %p",
    (value) => {
      const result = EnqueueComputeJobResponseSchema.safeParse(value);
      expect(result.success).toBe(false);
    },
  );
});

describe("TickJobsResponseSchema", () => {
  const valid = {
    contract_version: 1 as const,
    claimed: 3,
    done: 2,
    failed_retry: 1,
    failed_final: 0,
    reclaimed: 0,
    duration_ms: 1234,
    worker_id: "railway-abc",
  };

  it("parses a valid tick summary", () => {
    expect(TickJobsResponseSchema.parse(valid)).toMatchObject(valid);
  });

  it("rejects contract_version=2 (future drift must fail loudly)", () => {
    const result = TickJobsResponseSchema.safeParse({
      ...valid,
      contract_version: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["contract_version"]);
    }
  });

  it("rejects missing contract_version", () => {
    const rest = { ...valid } as Partial<typeof valid>;
    delete rest.contract_version;
    expect(TickJobsResponseSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ["claimed", -1],
    ["done", -1],
    ["failed_retry", -1],
    ["failed_final", -1],
    ["reclaimed", -1],
    ["duration_ms", -1],
  ])("rejects negative %s", (key, value) => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, [key]: value }).success,
    ).toBe(false);
  });

  it.each([
    ["claimed", 1.5],
    ["done", 2.7],
    ["duration_ms", 1234.5],
  ])("rejects non-integer %s", (key, value) => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, [key]: value }).success,
    ).toBe(false);
  });

  it("rejects empty worker_id", () => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, worker_id: "" }).success,
    ).toBe(false);
  });

  it("rejects string where number expected", () => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, duration_ms: "1234" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown extra fields (strict contract)", () => {
    // This test locks in the .strict() behavior — without it, Zod would
    // silently strip `secrets_leaked` and a contract drift would pass
    // review. See analytics-schemas.ts comment on TickJobsResponseSchema.
    const result = TickJobsResponseSchema.safeParse({
      ...valid,
      secrets_leaked: "very bad",
    });
    expect(result.success).toBe(false);
  });

  it("rejects contract_version=0 (literal binding)", () => {
    // Pins down that the literal is specifically 1, not just "any number".
    // If someone refactors to z.number() by mistake, this catches it.
    const result = TickJobsResponseSchema.safeParse({
      ...valid,
      contract_version: 0,
    });
    expect(result.success).toBe(false);
  });
});
