/**
 * Phase 93 Plan 02 — HARD-02 Task 1: offline value-level pin of the panel→keys[]
 * mapping the wizard sends to /api/strategies/composite/set-members.
 *
 * This is a PURE test (no jsdom render, no fetch mock, no Supabase). It pins the
 * FIRST member's entered `windowStart` VALUE surviving `buildSetMembersKeys`
 * into `keys[0].window_start`, plus the `window_end` open/closed rules, the
 * `seq = i + 1` derivation, and order preservation. Together with the
 * strengthened `set-members/route.test.ts` value pins it makes a silent
 * field-drop / rename on EITHER write-path link go RED — the write path is
 * verified correct; these tests harden its contract.
 */
import { describe, it, expect } from "vitest";
import { buildSetMembersKeys } from "./MultiKeyConnectStep";

// Minimal structural panels — only the fields the mapping reads. `as const`
// keeps the literal windowStart value pinnable by identity.
function panel(over: {
  apiKeyId?: string | null;
  windowStart?: string;
  windowEnd?: string;
  stillLive?: boolean;
}) {
  const apiKeyId: string | null = "apiKeyId" in over ? over.apiKeyId ?? null : "k";
  return {
    apiKeyId,
    windowStart: over.windowStart ?? "2025-08-01",
    windowEnd: over.windowEnd ?? "",
    stillLive: over.stillLive ?? false,
  };
}

describe("buildSetMembersKeys — panel→keys[] mapping (HARD-02)", () => {
  it("preserves the FIRST member's entered window_start VALUE", () => {
    const keys = buildSetMembersKeys([
      panel({ apiKeyId: "k1", windowStart: "2025-08-01", windowEnd: "2025-09-30" }),
      panel({ apiKeyId: "k2", windowStart: "2025-09-30", windowEnd: "2025-11-01" }),
      panel({ apiKeyId: "k3", windowStart: "2025-11-01", stillLive: true }),
    ]);

    // The exact entered value round-trips — not merely "some window_start".
    expect(keys[0].window_start).toBe("2025-08-01");
    expect(keys[0].api_key_id).toBe("k1");
    expect(keys[1].window_start).toBe("2025-09-30");
    expect(keys[2].window_start).toBe("2025-11-01");
  });

  it("maps stillLive → window_end null (open-ended member)", () => {
    const keys = buildSetMembersKeys([
      panel({ windowStart: "2025-11-01", windowEnd: "2025-12-01", stillLive: true }),
    ]);
    expect(keys[0].window_end).toBeNull();
  });

  it("maps an empty windowEnd (not stillLive) → window_end null", () => {
    const keys = buildSetMembersKeys([
      panel({ windowStart: "2025-11-01", windowEnd: "", stillLive: false }),
    ]);
    expect(keys[0].window_end).toBeNull();
  });

  it("maps a bounded windowEnd (not stillLive) → the exact value", () => {
    const keys = buildSetMembersKeys([
      panel({ windowStart: "2025-08-01", windowEnd: "2025-09-30", stillLive: false }),
    ]);
    expect(keys[0].window_end).toBe("2025-09-30");
  });

  it("derives seq = i + 1 and preserves order (panel i → keys[i])", () => {
    const keys = buildSetMembersKeys([
      panel({ apiKeyId: "a", windowStart: "2025-01-01" }),
      panel({ apiKeyId: "b", windowStart: "2025-02-01" }),
      panel({ apiKeyId: "c", windowStart: "2025-03-01" }),
    ]);
    expect(keys.map((k) => k.seq)).toEqual([1, 2, 3]);
    expect(keys.map((k) => k.api_key_id)).toEqual(["a", "b", "c"]);
    expect(keys.map((k) => k.window_start)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
    ]);
  });

  it("passes a null api_key_id through unchanged (unminted panel)", () => {
    const keys = buildSetMembersKeys([panel({ apiKeyId: null })]);
    expect(keys[0].api_key_id).toBeNull();
  });
});
