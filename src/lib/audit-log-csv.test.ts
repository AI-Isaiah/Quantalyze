import { describe, it, expect } from "vitest";
import {
  AUDIT_LOG_CSV_CAPTION,
  escapeCsvValue,
  serializeAuditLogCsv,
  type AuditLogRow,
} from "./audit-log-csv";

/**
 * Phase 11 Plan 02 / D-05 — Audit-log CSV serializer tests.
 *
 * Coverage:
 *   - Empty rows produce caption + header only.
 *   - Single row produces caption + header + one data line.
 *   - RFC 4180 escape edge cases (comma, double-quote, newline, carriage-return).
 *   - Plain values pass through unquoted.
 *   - JSON.stringify is the contract for `metadata_summary` (object → JSON string).
 *   - `metadata: null` produces an empty cell, not the literal `"null"`.
 *   - CSV-injection lead chars (e.g. `=`) are NOT stripped here — that's
 *     parse-side guard's job (sanitizeCsvValue in csv.ts).
 *   - BLOCK-1: AUDIT_LOG_CSV_CAPTION is the exact recipient-readable line
 *     that documents the 10K row cap.
 */
describe("AUDIT_LOG_CSV_CAPTION", () => {
  it("is the verbatim recipient-readable provenance line documenting the 10K cap", () => {
    expect(AUDIT_LOG_CSV_CAPTION).toBe(
      "# Quantalyze audit log export — most recent 10,000 entries within 90-day window",
    );
  });
});

describe("escapeCsvValue", () => {
  it("returns plain values unquoted when no special chars present", () => {
    expect(escapeCsvValue("plain")).toBe("plain");
  });

  it("RFC 4180 quotes a value containing a comma", () => {
    expect(escapeCsvValue("has,comma")).toBe('"has,comma"');
  });

  it("RFC 4180 quotes a value containing a double-quote and doubles it internally", () => {
    expect(escapeCsvValue('has"quote')).toBe('"has""quote"');
  });

  it("RFC 4180 quotes a value containing a newline", () => {
    expect(escapeCsvValue("has\nnewline")).toBe('"has\nnewline"');
  });

  it("RFC 4180 quotes a value containing a carriage return", () => {
    expect(escapeCsvValue("has\rcarriage")).toBe('"has\rcarriage"');
  });

  it("does NOT strip CSV-injection lead chars — parse-side guard's job", () => {
    // Plain `=cmd|calc` has no comma/quote/CR/LF, so it passes through
    // unquoted. The parse-side `sanitizeCsvValue` in csv.ts handles the
    // import-time injection guard; export-side just conforms to RFC 4180.
    expect(escapeCsvValue("=cmd|calc")).toBe("=cmd|calc");
  });
});

describe("serializeAuditLogCsv", () => {
  it("returns caption + ONLY header for empty rows", () => {
    expect(serializeAuditLogCsv([])).toBe(
      "# Quantalyze audit log export — most recent 10,000 entries within 90-day window\n" +
        "occurred_at,action,entity_type,entity_id,metadata_summary\n",
    );
  });

  it("returns caption + header + one data line for a single row", () => {
    const row: AuditLogRow = {
      created_at: "2026-04-26T12:00:00Z",
      action: "intro.send",
      entity_type: "contact_request",
      entity_id: "11111111-1111-1111-1111-111111111111",
      metadata: null,
    };
    expect(serializeAuditLogCsv([row])).toBe(
      "# Quantalyze audit log export — most recent 10,000 entries within 90-day window\n" +
        "occurred_at,action,entity_type,entity_id,metadata_summary\n" +
        "2026-04-26T12:00:00Z,intro.send,contact_request,11111111-1111-1111-1111-111111111111,\n",
    );
  });

  it("serializes metadata as JSON.stringify and quotes it (commas in JSON trigger RFC 4180)", () => {
    const row: AuditLogRow = {
      created_at: "2026-04-26T12:00:00Z",
      action: "mandate_preference.update",
      entity_type: "allocator_preference_mandate",
      entity_id: "22222222-2222-2222-2222-222222222222",
      metadata: { foo: "bar", baz: 42 },
    };
    const output = serializeAuditLogCsv([row]);
    // The metadata cell is `{"foo":"bar","baz":42}` — contains commas and
    // double-quotes, so RFC 4180 wraps in quotes and doubles up internal quotes.
    expect(output).toContain(
      '"{""foo"":""bar"",""baz"":42}"',
    );
  });

  it("renders an empty cell for metadata: null (no `null` literal)", () => {
    const row: AuditLogRow = {
      created_at: "2026-04-26T12:00:00Z",
      action: "account.export",
      entity_type: "user",
      entity_id: "33333333-3333-3333-3333-333333333333",
      metadata: null,
    };
    const output = serializeAuditLogCsv([row]);
    // Last cell of the data line is empty — the data line ends with `,\n`
    expect(output).toMatch(
      /3333-3333-3333-3333-333333333333,\n$/,
    );
    expect(output).not.toContain("null\n");
  });

  it("escapes action / entity_type / metadata cells per RFC 4180", () => {
    const row: AuditLogRow = {
      created_at: "2026-04-26T12:00:00Z",
      action: 'has,comma', // forces RFC 4180 quoting in the action cell
      entity_type: 'has"quote', // forces RFC 4180 quoting + internal-quote doubling
      entity_id: null,
      // The JS source `"line1\nline2"` is a real LF byte. JSON.stringify
      // serializes that byte to the two-char escape sequence backslash-n,
      // so the resulting JSON `{"msg":"line1\nline2"}` contains a comma
      // and double-quotes (which trigger RFC 4180 wrapping) but NOT a
      // raw newline. The cell is still quoted, just because of the
      // commas and quotes.
      metadata: { msg: "line1\nline2" },
    };
    const output = serializeAuditLogCsv([row]);
    // action cell is "has,comma" (quoted)
    expect(output).toContain(',"has,comma",');
    // entity_type cell is "has""quote" (quoted with internal doubled quote)
    expect(output).toContain('"has""quote"');
    // metadata cell quotes the JSON because it contains commas + double-quotes.
    // Use String.raw so the assertion's `\n` is the literal two-char sequence
    // backslash-n that JSON.stringify produced (NOT a real LF).
    expect(output).toContain(String.raw`"{""msg"":""line1\nline2""}"`);
  });

  it("emits an empty string (not 'null') for entity_id: null", () => {
    const row: AuditLogRow = {
      created_at: "2026-04-26T12:00:00Z",
      action: "deletion.request.create",
      entity_type: "user",
      entity_id: null,
      metadata: null,
    };
    const output = serializeAuditLogCsv([row]);
    // The data line: `<created_at>,<action>,<entity_type>,,\n` (two consecutive commas around empty entity_id)
    expect(output).toMatch(/deletion\.request\.create,user,,\n$/);
  });
});
