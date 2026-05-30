import { describe, it, expect } from "vitest";
import { factsheetViewStateCodec } from "./factsheet-context";

/**
 * B7c — factsheetViewStateCodec unit coverage.
 *
 * The factsheet view-state (xRange / comparator / colorblind / regimes / dark)
 * persists to `factsheet-v2:${strategyId}` as an UNVERSIONED
 * `JSON.stringify(state)` blob. The B7 migration onto `useCrossTabStorage`
 * puts two contracts most at risk, neither of which any prior test exercised:
 *
 *   1. UNVERSIONED byte-compat — the codec adds no version envelope, so a
 *      pre-B7 blob loads "ok" (never "reset") and a decode→encode round-trip is
 *      byte-identical. A regression that swapped in `versionedObjectCodec`
 *      would reset every existing user's saved factsheet view exactly once (and
 *      change the on-disk shape) — this fails loudly here.
 *   2. Per-field salvage + prototype-poison stripping at the decode boundary.
 */

// A canonical pre-B7 blob: the exact shape the hand-rolled persist effect
// wrote. `cb`/`reg`/`dark` are the literal string "1"; off fields were
// `undefined` and therefore OMITTED by JSON.stringify (so a full blob carries
// only the keys that are on).
const CANONICAL_BLOB = '{"range":"3-42","cmp":"btc","cb":"1","reg":"1","dark":"1"}';

describe("factsheetViewStateCodec — unversioned byte-compat", () => {
  it("decodes a pre-B7 unversioned blob as 'ok' (no version field required)", () => {
    const result = factsheetViewStateCodec.decode(CANONICAL_BLOB);
    expect(result.outcome).toBe("ok");
    expect(result.reason).toBeNull();
    expect(result.value).toEqual({
      range: "3-42",
      cmp: "btc",
      cb: "1",
      reg: "1",
      dark: "1",
    });
  });

  it("encode(decode(blob).value) reproduces the canonical blob byte-for-byte (NO version field)", () => {
    const decoded = factsheetViewStateCodec.decode(CANONICAL_BLOB);
    const reEncoded = factsheetViewStateCodec.encode(decoded.value);
    expect(reEncoded).toBe(CANONICAL_BLOB);
    const parsed = JSON.parse(reEncoded);
    expect(parsed).not.toHaveProperty("version");
    expect(parsed).not.toHaveProperty("schema_version");
  });

  it("encode omits off (undefined) toggle keys — byte-compat with JSON.stringify(state)", () => {
    // The write effect builds `{ range, cmp, cb: undefined, ... }` when a
    // toggle is off; JSON.stringify drops undefined keys. The codec must too.
    const encoded = factsheetViewStateCodec.encode({
      range: "0-9",
      cmp: "none",
      cb: undefined,
      reg: undefined,
      dark: undefined,
    });
    expect(encoded).toBe('{"range":"0-9","cmp":"none"}');
  });

  it("absent key (null) decodes to the empty default as 'ok'", () => {
    const result = factsheetViewStateCodec.decode(null);
    expect(result.outcome).toBe("ok");
    expect(result.value).toEqual({});
  });
});

describe("factsheetViewStateCodec — fail-loud reset outcomes", () => {
  it("non-JSON raw → reset (parse_failed)", () => {
    const result = factsheetViewStateCodec.decode("not-json{");
    expect(result.outcome).toBe("reset");
    expect(result.reason).toBe("parse_failed");
    expect(result.value).toEqual({});
  });

  it("JSON scalar (non-object) → reset (not_object)", () => {
    expect(factsheetViewStateCodec.decode("42").outcome).toBe("reset");
    expect(factsheetViewStateCodec.decode('"a string"').reason).toBe("not_object");
  });

  it("JSON array (non-object top level) → reset (not_object)", () => {
    const result = factsheetViewStateCodec.decode("[1,2,3]");
    expect(result.outcome).toBe("reset");
    expect(result.reason).toBe("not_object");
    expect(result.value).toEqual({});
  });
});

describe("factsheetViewStateCodec — per-field salvage (codec level)", () => {
  it("one drifted field folds away while valid fields survive", () => {
    // `cmp:"doge"` is outside the comparator union → dropped; range survives.
    const raw = JSON.stringify({ range: "5-50", cmp: "doge", dark: "1" });
    const result = factsheetViewStateCodec.decode(raw);
    expect(result.outcome).toBe("ok");
    expect(result.value.range).toBe("5-50"); // preserved
    expect(result.value.cmp).toBeUndefined(); // drifted comparator dropped
    expect(result.value.dark).toBe("1"); // preserved
  });

  it("a non-'1' / non-true toggle value folds to off (undefined)", () => {
    const raw = JSON.stringify({ cb: "yes", reg: 1, dark: "1" });
    const result = factsheetViewStateCodec.decode(raw);
    expect(result.value.cb).toBeUndefined(); // "yes" is not "1"/true
    expect(result.value.reg).toBeUndefined(); // numeric 1 is not "1"/true
    expect(result.value.dark).toBe("1"); // valid → kept
  });

  it("a non-string range folds away (not a usable window)", () => {
    const result = factsheetViewStateCodec.decode(JSON.stringify({ range: 42 }));
    expect(result.outcome).toBe("ok");
    expect(result.value.range).toBeUndefined();
  });
});

describe("factsheetViewStateCodec — prototype-poison stripping", () => {
  it("a __proto__ payload cannot smuggle a value through the prototype chain", () => {
    // ES2017: JSON.parse surfaces `__proto__` as an own enumerable key. Without
    // stripping, reading r.cmp could walk the prototype.
    const hostile = '{"__proto__":{"cmp":"btc"}}';
    const result = factsheetViewStateCodec.decode(hostile);
    expect(result.outcome).toBe("ok");
    // cmp must NOT be the smuggled "btc".
    expect(result.value.cmp).toBeUndefined();
    // And the global Object prototype must remain unpolluted.
    expect(({} as Record<string, unknown>).cmp).toBeUndefined();
  });
});
