/**
 * Phase 11 / D-05 — Audit-log CSV serializer.
 *
 * Why a new module:
 *   `src/lib/csv.ts` only exports parse-side helpers (sanitizeCsvValue,
 *   parseCsvLine, parseCsv, parseCsvWithSchema). Export-side serialization
 *   is greenfield. We could colocate this in `csv.ts`, but the audit-log
 *   shape is specific (caption + header + JSON-stringified metadata), and
 *   keeping it isolated makes the surface easier to reason about.
 *
 * RFC 4180 escape rules (per https://datatracker.ietf.org/doc/html/rfc4180):
 *   - If a field contains a comma, double-quote, CR, or LF, wrap the
 *     entire field in double-quotes and double-up any internal quotes.
 *   - Otherwise emit the field as-is.
 *
 * BLOCK-1 (review feedback, locked): the route handler caps the SELECT at
 *   10,000 rows so the in-memory `rows.map(...).join("\n")` build is bounded
 *   at roughly 2 MB (10,000 × ~200 bytes + caption + header). Streaming via
 *   ReadableStream is a future optimization (Phase 11+1+) once an active LP
 *   genuinely exceeds 10K log rows in a 90-day window.
 *
 * The caption line `# Quantalyze audit log export — most recent 10,000
 * entries within 90-day window` is prepended so a recipient who opens the
 * file in a spreadsheet sees the cap documented at the top.
 *
 * CSV-injection note (Phase 11 review fix WR-01): the export-side consumer
 * of this CSV is Excel / Google Sheets / Numbers — NOT the project's own
 * `csv.ts` parse path. A spreadsheet evaluates a cell as a formula when its
 * first character is `=`, `+`, `-`, `@`, TAB, or CR. The audit log can
 * contain attacker-controlled metadata (e.g., a note copied through another
 * flow), so we apply OWASP CSV-injection guidance and prefix any cell whose
 * first byte matches a formula-lead char with a single-quote (`'`). The
 * single-quote forces spreadsheet apps to render the cell as the literal
 * string. Recipients who legitimately wanted a formula get a one-character
 * fix on their end. The import-time guard in `csv.ts` (`sanitizeCsvValue`)
 * still applies to any future round-trip parse.
 */

/**
 * Caption line prepended to every export. Documents the BLOCK-1 row cap to
 * recipients so they know what they're looking at when the export is
 * smaller than they'd expect (or when the cap is hit).
 *
 * Verbatim, em-dash + ASCII text. Some downstream tools treat lines starting
 * with `#` as comments (gnuplot, awk, etc.) but RFC 4180 does NOT — so a
 * spreadsheet app sees this as a single-cell row containing the prose. We
 * deliberately keep this UNESCAPED so the prose remains human-readable in
 * a spreadsheet's first row.
 */
export const AUDIT_LOG_CSV_CAPTION =
  "# Quantalyze audit log export — most recent 10,000 entries within 90-day window";

/**
 * Shape of an `audit_log` row read by GET /api/me/audit-log/export. Mirrors
 * the SELECT column list in the route handler (created_at, action,
 * entity_type, entity_id, metadata).
 */
export interface AuditLogRow {
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * RFC 4180 escape: if the value contains a comma, double-quote, CR, or LF,
 * wrap the entire value in double-quotes and double-up any internal quotes.
 * Otherwise return the value unchanged.
 *
 * Note: this is the EXPORT-side RFC-4180 helper. Formula-injection
 * neutralization is handled separately by `neutralizeFormulaPrefix` (see
 * Phase 11 review fix WR-01) — call that first when serializing user-
 * supplied content into a CSV that will be opened in a spreadsheet app.
 */
export function escapeCsvValue(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Phase 11 review fix WR-01 — CSV formula-injection neutralization.
 *
 * Spreadsheet apps (Excel / Google Sheets / Numbers) evaluate a cell as a
 * formula when its first byte is `=`, `+`, `-`, `@`, TAB (`\t`), or CR
 * (`\r`). Prefixing a single-quote (`'`) forces the apps to render the
 * cell as the literal string. The guard MUST run before `escapeCsvValue`
 * so the leading `'` becomes part of the quoted payload (and thus part
 * of the rendered cell text), not a quoting artefact.
 *
 * Empty strings pass through unchanged (no first char to inspect).
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function neutralizeFormulaPrefix(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/**
 * Serialize audit_log rows into RFC 4180 CSV with the BLOCK-1 caption +
 * column header.
 *
 * Output structure (POSIX `\n` line endings — matches `csv.ts` parse
 * behavior, which accepts both `\n` and `\r\n`):
 *   line 1: AUDIT_LOG_CSV_CAPTION
 *   line 2: column header
 *   line 3+: data rows
 *
 * Trailing newline is included after each data row (so the final byte is
 * `\n` for non-empty inputs). For empty inputs only caption + header are
 * emitted (also each terminated by `\n`).
 *
 * `metadata` is JSON.stringify'd into a single `metadata_summary` cell.
 * `null` metadata produces an empty cell (NOT the literal string `"null"`,
 * which would be ambiguous with a legitimate stringified null). Same shape
 * for `entity_id: null`.
 */
export function serializeAuditLogCsv(rows: AuditLogRow[]): string {
  const caption = `${AUDIT_LOG_CSV_CAPTION}\n`;
  const header = "occurred_at,action,entity_type,entity_id,metadata_summary\n";
  if (rows.length === 0) {
    return `${caption}${header}`;
  }
  const body = rows
    .map((row) => {
      const summary = row.metadata ? JSON.stringify(row.metadata) : "";
      // Phase 11 review fix WR-01: neutralize formula-injection lead chars
      // (`=`, `+`, `-`, `@`, TAB, CR) on every user-influenced cell BEFORE
      // RFC-4180 quoting. `created_at` is an ISO timestamp emitted by
      // Postgres and never starts with a formula char, so it's exempt.
      // `entity_id` is a UUID-or-null and likewise exempt, but we run the
      // guard anyway as defense-in-depth in case a future schema change
      // widens the column.
      return [
        row.created_at,
        escapeCsvValue(neutralizeFormulaPrefix(row.action)),
        escapeCsvValue(neutralizeFormulaPrefix(row.entity_type)),
        row.entity_id ? neutralizeFormulaPrefix(row.entity_id) : "",
        escapeCsvValue(neutralizeFormulaPrefix(summary)),
      ].join(",");
    })
    .join("\n");
  return `${caption}${header}${body}\n`;
}
