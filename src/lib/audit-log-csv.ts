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
 * CSV-injection note: formula start chars (=, +, -, @, TAB, CR) ARE handled
 * at PARSE time by `sanitizeCsvValue` in `csv.ts`. Export side here only
 * conforms to RFC 4180 — the receiving spreadsheet is responsible for its
 * own formula-execution policy. Stripping `=` etc. on export would silently
 * mutate legitimate audit values that happen to start with those chars
 * (e.g., a metadata field whose value is `=2026-04-26` could legitimately
 * be a string the audit-emitter wrote). The right place to neutralize
 * formula injection is on the import path, which `csv.ts` already does.
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
 * Note: this is the EXPORT-side helper. The PARSE-side guard in `csv.ts`
 * (`sanitizeCsvValue`) is what neutralizes CSV-injection on import — it is
 * intentionally NOT applied here so legitimate audit values are not
 * mutated on the way out.
 */
export function escapeCsvValue(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
      return [
        row.created_at,
        escapeCsvValue(row.action),
        escapeCsvValue(row.entity_type),
        row.entity_id ?? "",
        escapeCsvValue(summary),
      ].join(",");
    })
    .join("\n");
  return `${caption}${header}${body}\n`;
}
