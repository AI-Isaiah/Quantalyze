import type { ZodType } from "zod";
import type { DecodeResult, StorageCodec } from "./cross-tab";

/**
 * B7 — reusable {@link StorageCodec} builders.
 *
 * The cross-tab primitive owns the localStorage mechanics; these codecs own
 * parse + validate + version + serialize for the two common shapes:
 *   - {@link versionedObjectCodec}: a zod-validated object with an inline
 *     version field and the higher/equal/lower version trichotomy.
 *   - {@link rawStringCodec}: a scalar value stored as a plain string (no JSON
 *     envelope) — e.g. a timeframe enum that owns its own coercion.
 */

/** Own keys JSON.parse can surface that poison prototype-walking consumers. */
const PROTO_POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Deep-clone `value`, omitting prototype-poison own keys at every level.
 * `JSON.parse('{"__proto__":{...}}')` yields `__proto__` as an own enumerable
 * key (ES2017); a downstream `Object.assign` / `lodash.merge` would then walk
 * it into the prototype. Stripping at the decode boundary is the moat.
 */
export function stripPoisonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPoisonKeys);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      if (PROTO_POISON_KEYS.has(key)) continue;
      out[key] = stripPoisonKeys(src[key]);
    }
    return out;
  }
  return value;
}

export interface VersionedObjectCodecOptions<T> {
  /** Name of the inline version field (e.g. "version", "layoutVersion"). */
  versionField: string;
  /** The version this build writes and adopts. */
  version: number;
  /** Validates the DATA shape (without the version field). */
  schema: ZodType<T>;
  /** Returned (with outcome "reset"/"readonly") when a blob is unusable. */
  defaults: T;
  /**
   * Read-old-write-new migration. Called with the poison-stripped parsed value
   * when the persisted version is missing / lower / non-numeric. Return the
   * data shape (without version) to adopt-and-rewrite, or `null` to reset.
   */
  migrateLegacy?: (parsed: unknown) => unknown | null;
}

function omitVersion(
  parsed: unknown,
  versionField: string,
): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (key === versionField) continue;
    rest[key] = (parsed as Record<string, unknown>)[key];
  }
  return rest;
}

export function versionedObjectCodec<T>(
  options: VersionedObjectCodecOptions<T>,
): StorageCodec<T> {
  const { versionField, version, schema, defaults, migrateLegacy } = options;

  return {
    decode(raw: string | null): DecodeResult<T> {
      if (raw == null) return { value: defaults, outcome: "ok", reason: null };

      let parsedUnknown: unknown;
      try {
        parsedUnknown = JSON.parse(raw);
      } catch {
        return { value: defaults, outcome: "reset", reason: "parse_failed" };
      }
      const parsed = stripPoisonKeys(parsedUnknown);

      const rawVersion =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)[versionField]
          : undefined;

      // Forward-compat: a newer build wrote a higher version. Show the user's
      // data read-only (never down-convert by writing this build's version).
      if (typeof rawVersion === "number" && rawVersion > version) {
        const safe = schema.safeParse(omitVersion(parsed, versionField));
        return {
          value: safe.success ? safe.data : defaults,
          outcome: "readonly",
          reason: "version_ahead",
        };
      }

      // Exact version — validate and adopt.
      if (rawVersion === version) {
        const safe = schema.safeParse(omitVersion(parsed, versionField));
        if (safe.success) return { value: safe.data, outcome: "ok", reason: null };
        return { value: defaults, outcome: "reset", reason: "schema_invalid" };
      }

      // Missing / lower / non-numeric version — try a read-old-write-new
      // migration before resetting.
      if (migrateLegacy) {
        const migrated = migrateLegacy(parsed);
        if (migrated != null) {
          const safe = schema.safeParse(migrated);
          if (safe.success) return { value: safe.data, outcome: "ok", reason: null };
        }
      }
      return { value: defaults, outcome: "reset", reason: "version_mismatch" };
    },

    encode(value: T): string {
      // Version field last so the serialization matches the pre-refactor
      // `{ ...value, version }` write order of existing consumers.
      return JSON.stringify({ ...(value as object), [versionField]: version });
    },
  };
}

export interface RawStringCodecOptions<T> {
  /** Coerce a raw localStorage string (or `null` when absent) into a value.
   *  Owns its own validation/fallback — must always return a usable value. */
  parse: (raw: string | null) => T;
  /** Serialize to the plain string stored in localStorage (no JSON envelope). */
  serialize: (value: T) => string;
  /** Cross-tab equality. Defaults to `serialize(a) === serialize(b)`. */
  equals?: (a: T, b: T) => boolean;
}

/**
 * Codec for a scalar value stored as a plain string (no JSON, no version
 * envelope) — e.g. a timeframe enum coerced via `coerceTimeframe`. Decode is
 * always "ok": the parse fn folds any invalid input to a valid fallback, so
 * there is nothing to "reset".
 */
export function rawStringCodec<T>(options: RawStringCodecOptions<T>): StorageCodec<T> {
  const { parse, serialize, equals } = options;
  return {
    decode: (raw: string | null): DecodeResult<T> => ({
      value: parse(raw),
      outcome: "ok",
      reason: null,
    }),
    encode: serialize,
    equals,
  };
}
