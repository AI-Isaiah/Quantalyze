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

/**
 * Phase 164.6.6.2.1 plan 05 (D-07) — a native-unit amount as a count of the
 * unit: `1,234.57 BTC`, `0.05231 BTC`, `0.00 BTC`, `—` when it is not a number.
 *
 * The unit is a parameter, never a literal, and the output never carries a
 * `$`. This is NOT a money formatter: `formatUsd` never takes a native amount
 * and this never takes a dollar one. `|v| >= 1` reads to two decimals; a
 * fraction reads to four significant digits so a small balance keeps its
 * meaning (`0.05231`, not `0.05`).
 */
const NATIVE_WHOLE_FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NATIVE_FRACTION_FMT = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 4,
});

export function nativeAmount(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs === 0) return `${NATIVE_WHOLE_FMT.format(0)} ${unit}`;
  if (abs >= 1) return `${NATIVE_WHOLE_FMT.format(v)} ${unit}`;
  const fraction = NATIVE_FRACTION_FMT.format(v);
  // 0.99996 rounds to "1" at 4 s.f.; keep the whole-number shape rather than
  // print a bare `1 BTC` beside `1.00 BTC`.
  const body = Math.abs(Number(fraction.replace(/,/g, ""))) >= 1 ? NATIVE_WHOLE_FMT.format(v) : fraction;
  return `${body} ${unit}`;
}

/** The one `in BTC` tag; no call site inlines that text. */
export function unitTag(unit: string): string {
  return `in ${unit}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a strict `YYYY-MM-DD` to UTC epoch ms, or null when it is not a real calendar day. */
function parseIsoDay(iso: string): number | null {
  const m = ISO_DAY_RE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

/** `Oct 8, 2026` (or `Oct 8` with `{ year: false }`), UTC. A malformed day is `—`. */
export function formatCloseDay(iso: string, opts?: { year?: boolean }): string {
  const t = parseIsoDay(iso);
  if (t == null) return "—";
  const d = new Date(t);
  const md = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return opts?.year === false ? md : `${md}, ${d.getUTCFullYear()}`;
}

/**
 * Sorted ISO days collapsed into runs joined by `; `. One day reads
 * `Oct 3, 2026`; a run reads `Oct 3, 2026 – Oct 5, 2026` (spaced en dash).
 * Every run is listed, none truncated, and all dates are UTC. A malformed
 * entry is dropped rather than printed as a guess.
 */
export function formatUnpricedDays(days: readonly string[]): string {
  const stamps = days
    .map(parseIsoDay)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const t of stamps) {
    const last = runs[runs.length - 1];
    if (last && t === last[1]) continue;
    if (last && t - last[1] === DAY_MS) last[1] = t;
    else runs.push([t, t]);
  }
  const fmt = (t: number) => formatCloseDay(new Date(t).toISOString().slice(0, 10));
  return runs.map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`)).join("; ");
}

/**
 * The per-view reason a benchmark-vs-unit line is withheld (D-15). The native
 * view says `returns are in BTC`; the USD view, whose returns were converted,
 * says `returns are converted from BTC`. No quote pair is ever named (D-21).
 */
export function benchmarkWithheldReason(unit: string, convertedFrom?: string | null): string {
  return convertedFrom != null ? `returns are converted from ${convertedFrom}` : nativeUnitReason(unit);
}
