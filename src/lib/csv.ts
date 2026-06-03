/**
 * Quote-aware CSV parsing utilities shared by CSV upload flows.
 *
 * Originally hand-rolled inside `CsvUpload.tsx`. Extracted to `@/lib/csv`
 * so the partner-import route and any future CSV-consuming routes can reuse
 * the same quoted-field/escaped-quote/CRLF handling instead of relying on
 * ad-hoc `line.split(",")` parsers.
 *
 * No React / browser APIs — safe to import from server components, route
 * handlers, and client components alike.
 *
 * KNOWN LIMITATIONS (inherited from the original `CsvUpload.tsx` parser —
 * not in scope for the consolidation PR, tracked for follow-up):
 *   - Quoted fields containing literal newlines are not supported.
 *     `parseCsv` splits on `\n` before parsing quotes, so `"Acme\nMacro"`
 *     becomes two physical rows. Avoid multi-line cells for now.
 *   - Malformed quotes (e.g. `Acme "Beta"` inside an unquoted field) are
 *     silently mutated rather than rejected.
 */

/**
 * Strip leading formula characters from a cell to prevent CSV injection
 * when the parsed data is later re-emitted into a spreadsheet. Also trims
 * surrounding whitespace.
 *
 * Only strips `+`, `-`, or `@` when followed by a non-numeric character —
 * otherwise `-430.25` would silently become `430.25` and corrupt signed
 * metrics (PnL, returns, net ticket sizes). `=`, TAB, and CR are always
 * stripped since they have no numeric-prefix collision.
 */
export function sanitizeCsvValue(val: string): string {
  // 1. Strip any leading run of `=`, TAB, or CR — these have no numeric
  //    collision, so we can always drop them.
  // 2. Then strip a leading `+`, `-`, or `@` only when the next character
  //    is NOT a digit or decimal point — preserves signed numerics like
  //    `-430.25` or `+500` while still neutralising `-cmd|calc` / `@cmd`.
  const stripped = val.trim().replace(/^[=\t\r]+/, "");
  return stripped.replace(/^[+\-@](?=[^\d.]|$)/, "").trim();
}

/**
 * Parse a single CSV line into its fields, honouring quoted fields,
 * embedded commas, and escaped quotes (`""` → `"`).
 *
 * By default each cell is passed through {@link sanitizeCsvValue} (strips
 * leading spreadsheet-formula characters). Pass `{ sanitize: false }` to get
 * the raw, whitespace-trimmed cells instead — used by
 * {@link parseCsvWithSchema} to match HEADER column names verbatim, because
 * sanitisation is a data-cell guard that must never silently rewrite the
 * column metadata it matches against the schema (audit H-0440).
 *
 * Does not handle multi-line quoted fields — see KNOWN LIMITATIONS above.
 */
export function parseCsvLine(
  line: string,
  opts?: { sanitize?: boolean },
): string[] {
  const sanitize = opts?.sanitize ?? true;
  // sanitizeCsvValue already trims; the raw path trims only.
  const finalize = (cell: string): string =>
    sanitize ? sanitizeCsvValue(cell) : cell.trim();
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(finalize(current));
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(finalize(current));
  return fields;
}

/**
 * Parse raw CSV text into a 2D array of cells.
 *
 * - Handles CRLF and LF line endings.
 * - Strips a leading UTF-8 BOM if present.
 * - Skips blank lines.
 * - By default every cell is sanitised ({@link sanitizeCsvValue}); pass
 *   `{ sanitize: false }` for raw, whitespace-trimmed cells (see
 *   {@link parseCsvLine}).
 * - Returns every non-empty row including the header (row index 0) —
 *   callers that want a header/data split can take `result[0]` and
 *   `result.slice(1)`, or use {@link parseCsvWithSchema} instead.
 */
export function parseCsv(
  text: string,
  opts?: { sanitize?: boolean },
): string[][] {
  // Strip BOM so spreadsheet-exported files (which often include `\uFEFF`)
  // don't end up with a hidden prefix on the first header cell.
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return stripped
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line, opts));
}

/**
 * Parse CSV text with a column schema. Returns an array of typed rows,
 * skipping any row that fails validation.
 *
 * Handles quoted fields, escaped quotes, CRLF line endings, and a leading
 * UTF-8 BOM. Header matching is case-insensitive: every name in `columns`
 * must appear in the header (order doesn't matter, extra columns are
 * tolerated). If any required column is missing, throws an Error.
 *
 * Audit-2026-05-07 C-0052 (partner-import contract): callers MUST pass an
 * explicit `hasHeader` flag rather than relying on the parser to sniff
 * the first row. Header sniffing is fragile (a data row that happens to
 * spell `manager_email` would be misclassified as a header). The flag
 * defaults to `true` purely to keep historical call-sites compiling; the
 * partner-import route now passes an explicit value derived from the
 * `with_header` query parameter.
 *
 * When `hasHeader === false`, the caller MUST pass `columns` in the
 * exact positional order of the CSV — there is no header to remap by.
 *
 * Audit-2026-05-07 H-0440 (header verbatim): the header row is matched
 * against `columns` WITHOUT `sanitizeCsvValue`. Sanitisation is a data-cell
 * guard; applied to a header it silently rewrote column names (e.g.
 * `+amount` → `amount`). Data cells ARE still sanitised before they reach
 * `mapRow`, so persisted/re-exported values stay formula-safe.
 *
 * @param raw       Raw CSV string (with or without trailing newlines).
 * @param columns   Required column names. When `hasHeader === true` these
 *                  are matched against the header case-insensitively in
 *                  any order; when `hasHeader === false` they're used as
 *                  positional keys for the row-object passed to `mapRow`.
 * @param mapRow    Converts a keyed row (header-name → cell value) to the
 *                  typed output, or returns `null` to skip the row
 *                  (e.g. validation failure). Keys match the original
 *                  (lowercased) column names in `columns`.
 * @param hasHeader Whether row 0 of `raw` is a header. Defaults to
 *                  `true`. Callers should pass this explicitly to avoid
 *                  the documented sniff-is-implicit ambiguity.
 */
export function parseCsvWithSchema<T>(
  raw: string,
  columns: readonly string[],
  mapRow: (row: Record<string, string>) => T | null,
  hasHeader: boolean = true,
): T[] {
  // H-0440: parse the structure RAW (no per-cell sanitisation) so the header
  // row is matched against the schema VERBATIM. sanitizeCsvValue is a
  // data-cell guard — it strips leading spreadsheet-formula chars (`=`/`+`/
  // `-`/`@`) so a persisted/re-exported VALUE can't smuggle a formula. Applied
  // to a header it silently rewrites the column NAMES it then matches
  // (`+amount` → `amount`, `-net_ticket` → `net_ticket`) and immediately
  // discards — the header is never re-emitted — so a malformed/prefixed header
  // should fail the explicit missing-column check below, not be coerced into a
  // silent match. Data cells are sanitised per-cell in the row loop instead.
  const rows = parseCsv(raw, { sanitize: false });
  if (rows.length === 0) return [];

  const wantedColumns = columns.map((c) => c.toLowerCase());
  let header: string[];
  let dataStartIdx: number;
  if (hasHeader) {
    // Lowercase the header so matching is case-insensitive (preserves the
    // behavior of the old partner-import parser which did
    // `rows[0][0]?.toLowerCase() === "manager_email"`). Verbatim — see the
    // H-0440 note above.
    header = rows[0].map((h) => h.trim().toLowerCase());
    for (const col of wantedColumns) {
      if (!header.includes(col)) {
        throw new Error(`Missing CSV header column: ${col}`);
      }
    }
    dataStartIdx = 1;
  } else {
    // No header row — treat the supplied `columns` as the positional
    // schema. The CSV's first row IS data; row-objects key off the
    // lowercased column names just like the header-present path.
    header = wantedColumns;
    dataStartIdx = 0;
  }

  const results: T[] = [];
  for (let i = dataStartIdx; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length === 0) continue;
    const rowObj: Record<string, string> = {};
    header.forEach((h, idx) => {
      // Sanitise the DATA cell here (the parse above was raw) so any value
      // later persisted or re-emitted into a spreadsheet stays formula-safe;
      // only the header keys are kept verbatim (H-0440). sanitizeCsvValue
      // already trims.
      rowObj[h] = sanitizeCsvValue(cells[idx] ?? "");
    });
    const mapped = mapRow(rowObj);
    if (mapped !== null) results.push(mapped);
  }
  return results;
}
