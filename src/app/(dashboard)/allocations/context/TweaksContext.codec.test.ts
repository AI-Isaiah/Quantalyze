import { describe, it, expect } from "vitest";
import {
  tweakStateCodec,
  TWEAK_DEFAULTS,
  type TweakState,
} from "./TweaksContext";

/**
 * B7 — tweakStateCodec unit coverage.
 *
 * The provider-level behaviors (per-field salvage, mount-restore, cross-tab
 * adoption, corrupt-JSON fail-loud) are pinned in `components/Tweaks.test.tsx`
 * through the rendered TweaksProvider. THIS file pins the two contracts that
 * the migration onto `useCrossTabStorage` puts most at risk and that no
 * existing test exercised directly:
 *
 *   1. UNVERSIONED byte-compat — the codec adds no version envelope, so a
 *      v0.15.x `JSON.stringify(state)` blob loads "ok" (never "reset") and a
 *      decode→encode round-trip is byte-identical. A regression that swapped in
 *      `versionedObjectCodec` would reset every existing user's saved tweaks
 *      exactly once (and change the on-disk shape) — this fails loudly here.
 *   2. Prototype-poison stripping at the decode boundary.
 */

const FULL_BLOB: TweakState = {
  density: "loose",
  accentIntensity: "full",
  displayFont: "sans",
  bridgeVariant: "subtle",
  chartStyle: "line",
  showBench: false,
  showOutcomes: false,
};

describe("tweakStateCodec — unversioned byte-compat", () => {
  it("decodes a v0.15.x unversioned blob as 'ok' (no version field required)", () => {
    const raw = JSON.stringify(FULL_BLOB);
    const result = tweakStateCodec.decode(raw);
    expect(result.outcome).toBe("ok");
    expect(result.reason).toBeNull();
    expect(result.value).toEqual(FULL_BLOB);
  });

  it("encode emits the bare state with NO version envelope", () => {
    const encoded = tweakStateCodec.encode(FULL_BLOB);
    const parsed = JSON.parse(encoded);
    expect(parsed).toEqual(FULL_BLOB);
    // The byte-compat invariant: exactly the 7 knobs, no `version`/`schema_version`.
    expect(Object.keys(parsed).sort()).toEqual(
      Object.keys(FULL_BLOB).sort(),
    );
    expect(parsed).not.toHaveProperty("version");
    expect(parsed).not.toHaveProperty("schema_version");
  });

  it("decode→encode round-trip is byte-identical for a valid blob", () => {
    const raw = tweakStateCodec.encode(FULL_BLOB);
    const decoded = tweakStateCodec.decode(raw);
    expect(tweakStateCodec.encode(decoded.value)).toBe(raw);
  });

  it("absent key (null) decodes to defaults as 'ok'", () => {
    const result = tweakStateCodec.decode(null);
    expect(result.outcome).toBe("ok");
    expect(result.value).toEqual(TWEAK_DEFAULTS);
  });
});

describe("tweakStateCodec — fail-loud reset outcomes", () => {
  it("non-JSON raw → reset (parse_failed)", () => {
    const result = tweakStateCodec.decode("not-json{");
    expect(result.outcome).toBe("reset");
    expect(result.reason).toBe("parse_failed");
    expect(result.value).toEqual(TWEAK_DEFAULTS);
  });

  it("JSON scalar (non-object) → reset (schema_invalid)", () => {
    expect(tweakStateCodec.decode("42").outcome).toBe("reset");
    expect(tweakStateCodec.decode('"a string"').reason).toBe("schema_invalid");
  });

  it("JSON array (non-object top level) → reset (schema_invalid)", () => {
    const result = tweakStateCodec.decode("[1,2,3]");
    expect(result.outcome).toBe("reset");
    expect(result.reason).toBe("schema_invalid");
    expect(result.value).toEqual(TWEAK_DEFAULTS);
  });
});

describe("tweakStateCodec — per-field salvage (codec level)", () => {
  it("one drifted field folds to its default while valid fields survive", () => {
    const raw = JSON.stringify({
      ...FULL_BLOB,
      density: "ultra-tight", // outside the union → default
    });
    const result = tweakStateCodec.decode(raw);
    expect(result.outcome).toBe("ok");
    expect(result.value.density).toBe(TWEAK_DEFAULTS.density); // "comfortable"
    expect(result.value.bridgeVariant).toBe("subtle"); // preserved
    expect(result.value.showBench).toBe(false); // preserved
  });
});

describe("tweakStateCodec — prototype-poison stripping", () => {
  it("a __proto__ payload cannot smuggle a value through the prototype chain", () => {
    // ES2017: JSON.parse surfaces `__proto__` as an own enumerable key. Without
    // stripping, reading r.density could walk the prototype and return "tight".
    const hostile = '{"__proto__":{"density":"tight"}}';
    const result = tweakStateCodec.decode(hostile);
    expect(result.outcome).toBe("ok");
    // density must fall back to the default, NOT the smuggled "tight".
    expect(result.value.density).toBe(TWEAK_DEFAULTS.density);
    // And the global Object prototype must remain unpolluted.
    expect(({} as Record<string, unknown>).density).toBeUndefined();
  });
});
