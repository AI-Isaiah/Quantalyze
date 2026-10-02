import { describe, it, expect } from "vitest";
import { apiKeyLabelById, dataSourceLabel } from "./api-key-label";

// ---------------------------------------------------------------------------
// Phase 169.4-01 (SC2) — the ONE key-label rule.
//
// Why this matters: the Scenario names each connected key
// `${Exchange} — ${nickname ?? ••••tail}`. The Risk tab's correlation matrix
// and decomposition now run over the same per-key set, so they must name each
// key the same way; two formatters would let the two tabs call one account by
// two names. A raw key id must never reach either surface (T-169-26).
// ---------------------------------------------------------------------------

const keys = [
  { id: "key-aaaa-1111", exchange: "binance", label: "Main" },
  { id: "key-bbbb-2222", exchange: "binance", label: "  " },
  { id: "key-cccc-3333", exchange: "someventure", label: "Desk" },
];

describe("apiKeyLabelById", () => {
  it("names each key exactly as the Scenario composer does", () => {
    const m = apiKeyLabelById(keys);
    for (const k of keys) {
      const { exchange, nickname, maskedTail } = dataSourceLabel(k);
      expect(m.get(k.id)).toBe(`${exchange} — ${nickname ?? maskedTail}`);
    }
    // The literal forms, so a change to the rule shows up here and not only in
    // the round trip above.
    expect(m.get("key-aaaa-1111")).toBe("Binance — Main");
    expect(m.get("key-bbbb-2222")).toBe("Binance — ••••2222");
    expect(m.get("key-cccc-3333")).toBe("someventure — Desk");
  });

  it("never uses a raw key id as a label", () => {
    const m = apiKeyLabelById(keys);
    expect(m.size).toBe(keys.length);
    for (const [id, label] of m) expect(label).not.toContain(id);
  });

  it("an absent key list yields an empty map", () => {
    expect(apiKeyLabelById([]).size).toBe(0);
  });
});
