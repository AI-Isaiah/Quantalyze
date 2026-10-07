/**
 * Phase 164.6.6.2 plan 05 (D-08, D-09) — the ONE place a factsheet surface learns
 * which unit a strategy's returns are in, and the ONE composer of every label
 * that names it.
 *
 * Isomorphic and React-free: the factsheet, the tear sheet, the v2 panel, the
 * share card and the scenario composer all import from here, so no two of them
 * can disagree about what counts as a unit or how a label reads.
 *
 * The gate is a single value. `null` is the USD family (and a strategy with no
 * unit recorded): every helper returns its input unchanged, so a USD surface
 * takes the same early return rather than a different path that happens to
 * produce the same text. A unit is a parameter, never a literal, so the next
 * unit adds no copy.
 */

/**
 * The shape of a unit code. The same pattern the database CHECK on
 * `api_keys.account_currency` uses, so a value the DB would refuse is refused
 * here too.
 */
export const RETURNS_UNIT_RE = /^[A-Z]{2,10}$/;

/**
 * Parse an untrusted unit (a jsonb value off `data_quality_flags`) at the
 * boundary. Anything that is not a well-formed code reads as absent, so a
 * malformed value renders as a USD factsheet rather than as label text.
 */
export function parseReturnsUnit(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return RETURNS_UNIT_RE.test(raw) ? raw : null;
}

/**
 * `"CAGR"` becomes `"CAGR in BTC"` for a unit and stays the SAME string
 * reference for none. Every return label on every surface goes through it.
 */
export function withUnit(label: string, unit: string | null | undefined): string {
  return unit == null ? label : `${label} in ${unit}`;
}

/** The one reason string every "not measurable" line composes from. */
export function nativeUnitReason(unit: string): string {
  return `returns are in ${unit}`;
}
