/**
 * Typed cast helpers for Supabase embedded-join rows.
 *
 * Supabase's generated types for `!inner` joins and nested selects
 * often return `unknown` or overly-broad union types. These helpers
 * provide a single, grep-able cast surface instead of scattering
 * `as unknown as T` across every call site.
 */

/**
 * Cast a single embedded row from a Supabase query result.
 * Throws if the value is null/undefined so the caller gets
 * a clear error instead of silent misuse.
 */
export function castRow<T>(raw: unknown, label?: string): T {
  if (raw == null) {
    throw new Error(`castRow: expected a row${label ? ` (${label})` : ""}, got ${String(raw)}`);
  }
  return raw as T;
}

/**
 * Cast an embedded row that may legitimately be null.
 */
export function castRowOrNull<T>(raw: unknown): T | null {
  if (raw == null) return null;
  return raw as T;
}

/**
 * Cast an array of embedded rows. Returns [] for null/undefined.
 */
export function castRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw as T[];
}
