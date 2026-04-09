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
 * embedded commas, and escaped quotes (`""` → `"`). Each cell is passed
 * through `sanitizeCsvValue` before being returned.
 *
 * Does not handle multi-line quoted fields — see KNOWN LIMITATIONS above.
 */
export function parseCsvLine(line: string): string[] {
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
      fields.push(sanitizeCsvValue(current.trim()));
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(sanitizeCsvValue(current.trim()));
  return fields;
}

/**
 * Parse raw CSV text into a 2D array of sanitized cells.
 *
 * - Handles CRLF and LF line endings.
 * - Strips a leading UTF-8 BOM if present.
 * - Skips blank lines.
 * - Returns every non-empty row including the header (row index 0) —
 *   callers that want a header/data split can take `result[0]` and
 *   `result.slice(1)`, or use {@link parseCsvWithSchema} instead.
 */
export function parseCsv(text: string): string[][] {
  // Strip BOM so spreadsheet-exported files (which often include `\uFEFF`)
  // don't end up with a hidden prefix on the first header cell.
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return stripped
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line));
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
 * @param raw      Raw CSV string (with or without trailing newlines).
 * @param columns  Required header column names, in any order. Matching is
 *                 case-insensitive.
 * @param mapRow   Converts a keyed row (header-name → cell value) to the
 *                 typed output, or returns `null` to skip the row
 *                 (e.g. validation failure). Keys match the original
 *                 (lowercased) column names in `columns`.
 */
export function parseCsvWithSchema<T>(
  raw: string,
  columns: readonly string[],
  mapRow: (row: Record<string, string>) => T | null,
): T[] {
  const rows = parseCsv(raw);
  if (rows.length === 0) return [];

  // Lowercase the header so matching is case-insensitive (preserves the
  // behavior of the old partner-import parser which did
  // `rows[0][0]?.toLowerCase() === "manager_email"`).
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const wantedColumns = columns.map((c) => c.toLowerCase());
  for (const col of wantedColumns) {
    if (!header.includes(col)) {
      throw new Error(`Missing CSV header column: ${col}`);
    }
  }

  const results: T[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length === 0) continue;
    const rowObj: Record<string, string> = {};
    header.forEach((h, idx) => {
      rowObj[h] = (cells[idx] ?? "").trim();
    });
    const mapped = mapRow(rowObj);
    if (mapped !== null) results.push(mapped);
  }
  return results;
}
