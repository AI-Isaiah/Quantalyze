import { describe, it, expect } from "vitest";
import { z } from "zod";
import { versionedObjectCodec, rawStringCodec, stripPoisonKeys } from "./codecs";

/**
 * B7 codec spec. The codecs carry the domain-agnostic version trichotomy,
 * zod validation, prototype-poison stripping, and read-old-write-new
 * migration that the cross-tab primitive's mechanics build on.
 */

const schema = z.object({ ids: z.array(z.string().min(1)).catch([]) });
type Shape = z.infer<typeof schema>;
const defaults: Shape = { ids: [] };

function makeCodec(migrateLegacy?: (p: unknown) => unknown | null) {
  return versionedObjectCodec<Shape>({
    versionField: "version",
    version: 1,
    schema,
    defaults,
    migrateLegacy,
  });
}

describe("versionedObjectCodec — version trichotomy", () => {
  it("decodes a null blob as ok defaults (absence is not corruption)", () => {
    const r = makeCodec().decode(null);
    expect(r).toEqual({ value: defaults, outcome: "ok", reason: null });
  });

  it("decodes an exact-version blob as ok and strips the version field", () => {
    const codec = makeCodec();
    const r = codec.decode(JSON.stringify({ version: 1, ids: ["a", "b"] }));
    expect(r.outcome).toBe("ok");
    expect(r.value).toEqual({ ids: ["a", "b"] });
  });

  it("decodes a higher version as readonly (forward-compat, never down-convert)", () => {
    const r = makeCodec().decode(JSON.stringify({ version: 2, ids: ["x"] }));
    expect(r.outcome).toBe("readonly");
    expect(r.reason).toBe("version_ahead");
    // The user's data is shown (validated best-effort), not defaults.
    expect(r.value).toEqual({ ids: ["x"] });
  });

  it("resets a lower/missing version with no migrator", () => {
    const lower = makeCodec().decode(JSON.stringify({ version: 0, ids: ["x"] }));
    expect(lower).toEqual({ value: defaults, outcome: "reset", reason: "version_mismatch" });
    const missing = makeCodec().decode(JSON.stringify({ ids: ["x"] }));
    expect(missing.outcome).toBe("reset");
    expect(missing.reason).toBe("version_mismatch");
  });

  it("resets malformed JSON as parse_failed", () => {
    const r = makeCodec().decode("not-json{");
    expect(r).toEqual({ value: defaults, outcome: "reset", reason: "parse_failed" });
  });

  it("a same-version blob whose bad field is rescued by .catch still parses ok", () => {
    // `.catch([])` turns a bad `ids` into [] → success (documents the rescue).
    const r = makeCodec().decode(JSON.stringify({ version: 1, ids: "nope" }));
    expect(r.outcome).toBe("ok");
    expect(r.value).toEqual({ ids: [] });
  });

  it("resets with schema_invalid when a same-version blob fails a STRICT schema (no .catch)", () => {
    // Real coverage of the schema_invalid reset branch: a schema with no
    // per-field .catch cannot rescue a type-wrong field.
    const strict = versionedObjectCodec<{ n: number }>({
      versionField: "version",
      version: 1,
      schema: z.object({ n: z.number() }),
      defaults: { n: 0 },
    });
    const r = strict.decode(JSON.stringify({ version: 1, n: "not-a-number" }));
    expect(r).toEqual({ value: { n: 0 }, outcome: "reset", reason: "schema_invalid" });
  });
});

describe("versionedObjectCodec — read-old-write-new migration", () => {
  const migrateLegacy = (parsed: unknown) =>
    Array.isArray(parsed)
      ? { ids: parsed.filter((s): s is string => typeof s === "string" && s.length > 0) }
      : null;

  it("migrates a legacy bare-array blob to the current shape and adopts it", () => {
    const r = makeCodec(migrateLegacy).decode(JSON.stringify(["a", "", "b", 42]));
    expect(r.outcome).toBe("ok");
    expect(r.value).toEqual({ ids: ["a", "b"] });
  });

  it("resets when the migrator returns null", () => {
    const r = makeCodec(migrateLegacy).decode(JSON.stringify({ foo: "bar" }));
    expect(r.outcome).toBe("reset");
    expect(r.reason).toBe("version_mismatch");
  });
});

describe("versionedObjectCodec — prototype poison", () => {
  it("strips __proto__ / constructor / prototype keys at the parse boundary", () => {
    const codec = makeCodec();
    const raw = '{"version":1,"ids":["a"],"__proto__":{"polluted":true}}';
    const r = codec.decode(raw);
    expect(r.outcome).toBe("ok");
    expect(r.value).toEqual({ ids: ["a"] });
    // The global Object prototype must NOT have been polluted.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("strips nested poison keys", () => {
    const cleaned = stripPoisonKeys(
      JSON.parse('{"a":{"__proto__":{"x":1},"b":2},"c":[{"constructor":3,"d":4}]}'),
    ) as Record<string, unknown>;
    expect(cleaned).toEqual({ a: { b: 2 }, c: [{ d: 4 }] });
  });
});

describe("versionedObjectCodec — encode", () => {
  it("writes the version field last (byte-compatible with `{...value, version}`)", () => {
    const codec = makeCodec();
    expect(codec.encode({ ids: ["a"] })).toBe('{"ids":["a"],"version":1}');
  });

  it("round-trips through decode", () => {
    const codec = makeCodec();
    const encoded = codec.encode({ ids: ["a", "b"] });
    expect(codec.decode(encoded)).toEqual({
      value: { ids: ["a", "b"] },
      outcome: "ok",
      reason: null,
    });
  });
});

describe("rawStringCodec", () => {
  const codec = rawStringCodec<string>({
    parse: (raw) => (raw === "1MTD" || raw === "1YTD" ? raw : "1YTD"),
    serialize: (v) => v,
  });

  it("decodes a valid raw string as ok", () => {
    expect(codec.decode("1MTD")).toEqual({ value: "1MTD", outcome: "ok", reason: null });
  });

  it("folds an invalid/absent value to the fallback (still ok — scalars self-coerce)", () => {
    expect(codec.decode("garbage").value).toBe("1YTD");
    expect(codec.decode(null).value).toBe("1YTD");
  });

  it("encodes as a plain string (no JSON envelope)", () => {
    expect(codec.encode("1MTD")).toBe("1MTD");
  });
});
