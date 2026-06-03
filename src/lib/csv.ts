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
 * Strip leading formula characters from a DATA cell to prevent CSV injection
 * when the parsed value is later re-emitted into a spreadsheet. Also trims
 * surrounding whitespace. NOT for header cells — those are column-identity
 * metadata, not re-emitted values; see {@link parseCsvWithSchema} (H-0440).
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
 * When `sanitize` is true (default) each cell is passed through
 * {@link sanitizeCsvValue} — the formula-injection defense for DATA values
 * that may later be re-emitted into a spreadsheet. Pass `sanitize: false` for
 * a HEADER row, whose cells are column-identity metadata (not re-emitted
 * values) and must be preserved verbatim so a leading `+`/`-`/`@`/`=` isn't
 * silently stripped into a different column name (H-0440). Non-sanitized
 * cells are still trimmed.
 *
 * Does not handle multi-line quoted fields — see KNOWN LIMITATIONS above.
 */
export function parseCsvLine(line: string, sanitize: boolean = true): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  // sanitizeCsvValue trims internally; the non-sanitize path trims explicitly.
  const finish = (raw: string) => (sanitize ? sanitizeCsvValue(raw) : raw.trim());

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
      fields.push(finish(current));
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(finish(current));
  return fields;
}

/**
 * Parse raw CSV text into a 2D array of cells.
 *
 * - Handles CRLF and LF line endings.
 * - Strips a leading UTF-8 BOM if present.
 * - Skips blank lines.
 * - Returns every non-empty row including the header (row index 0) —
 *   callers that want a header/data split can take `result[0]` and
 *   `result.slice(1)`, or use {@link parseCsvWithSchema} instead.
 *
 * Every cell is formula-sanitized by default. Pass `{ sanitizeFirstRow:
 * false }` when row 0 is a HEADER — its cells are column-identity metadata
 * and must NOT be formula-stripped (H-0440); data rows are always sanitized.
 */
export function parseCsv(
  text: string,
  opts: { sanitizeFirstRow?: boolean } = {},
): string[][] {
  const { sanitizeFirstRow = true } = opts;
  // Strip BOM so spreadsheet-exported files (which often include `\uFEFF`)
  // don't end up with a hidden prefix on the first header cell.
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return stripped
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, idx) => parseCsvLine(line, idx === 0 ? sanitizeFirstRow : true));
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
  // H-0440: when row 0 is a header, do NOT formula-sanitize it — a header is
  // column-identity metadata, and stripping a leading `+`/`-`/`@`/`=` would
  // rewrite (or partially rewrite, via the digit-lookahead asymmetry in
  // sanitizeCsvValue) the column name, silently matching the wrong column or
  // raising a misleading "Missing CSV header column". Data rows stay
  // sanitized. When `hasHeader` is false, row 0 IS data → sanitize it.
  const rows = parseCsv(raw, { sanitizeFirstRow: !hasHeader });
  if (rows.length === 0) return [];

  const wantedColumns = columns.map((c) => c.toLowerCase());
  let header: string[];
  let dataStartIdx: number;
  if (hasHeader) {
    // Lowercase the header so matching is case-insensitive (preserves the
    // behavior of the old partner-import parser which did
    // `rows[0][0]?.toLowerCase() === "manager_email"`).
    header = rows[0].map((h) => h.trim().toLowerCase());
    for (const col of wantedColumns) {
      if (!header.includes(col)) {
        // H-0440: headers are preserved verbatim, so a column that fails to
        // match ONLY because of a leading formula char (a spreadsheet export
        // artifact, e.g. `=manager_email`) would otherwise produce a confusing
        // "Missing column: manager_email" when the operator can plainly see a
        // manager_email column. Name the near-match cell + the fix.
        //
        // The echoed header is operator-controlled and reaches the 400 body,
        // so cap each echoed cell and strip control characters (no response
        // bloat / no control-char passthrough), mirroring the route's
        // capAuditMetadata discipline for the other attacker-influenced surface.
        const STRIP_RE = /^[=+\-@\t\r]+/;
        const safe = (s: string) =>
          s.replace(/[\x00-\x1f]/g, "").slice(0, 80);
        const nearMatch = header.find((h) => h.replace(STRIP_RE, "") === col);
        if (nearMatch) {
          // Advise removing the FULL leading formula run, not just its first
          // char — `=+manager_email` needs both stripped to read `manager_email`.
          const prefix = nearMatch.slice(
            0,
            nearMatch.length - nearMatch.replace(STRIP_RE, "").length,
          );
          throw new Error(
            `Missing CSV header column: ${col} (found a header cell ` +
              `"${safe(nearMatch)}" — remove the leading "${safe(prefix)}" so ` +
              `the header reads "${col}"; CSV headers must not begin with =, +, -, or @)`,
          );
        }
        const seen = header.slice(0, 20).map(safe).join(", ");
        const more =
          header.length > 20 ? ` …(+${header.length - 20} more)` : "";
        throw new Error(
          `Missing CSV header column: ${col} (headers seen: ${seen}${more})`,
        );
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
      rowObj[h] = (cells[idx] ?? "").trim();
    });
    const mapped = mapRow(rowObj);
    if (mapped !== null) results.push(mapped);
  }
  return results;
}
