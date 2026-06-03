import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvLine, parseCsvWithSchema, sanitizeCsvValue } from "./csv";

describe("sanitizeCsvValue", () => {
  it("strips leading formula characters when followed by a non-numeric", () => {
    expect(sanitizeCsvValue("=SUM(A1)")).toBe("SUM(A1)");
    expect(sanitizeCsvValue("+cmd")).toBe("cmd");
    expect(sanitizeCsvValue("-cmd|calc")).toBe("cmd|calc");
    expect(sanitizeCsvValue("@import")).toBe("import");
  });

  it("preserves signed numerics", () => {
    // Regression guard for codex-adversarial finding #1: the previous
    // sanitizer blindly stripped leading `-` and `+`, silently turning
    // `-430.25` into `430.25` and corrupting daily PnL on import.
    expect(sanitizeCsvValue("-430.25")).toBe("-430.25");
    expect(sanitizeCsvValue("+500")).toBe("+500");
    expect(sanitizeCsvValue("-.5")).toBe("-.5");
    expect(sanitizeCsvValue(".5")).toBe(".5");
    expect(sanitizeCsvValue("0")).toBe("0");
    expect(sanitizeCsvValue("-0")).toBe("-0");
  });

  it("strips tab/cr characters always", () => {
    expect(sanitizeCsvValue("\tfoo")).toBe("foo");
    expect(sanitizeCsvValue("\r=foo")).toBe("foo");
  });

  it("strips multiple leading formula chars (e.g. `=+cmd`)", () => {
    expect(sanitizeCsvValue("=+cmd")).toBe("cmd");
  });

  it("trims whitespace", () => {
    expect(sanitizeCsvValue("  foo  ")).toBe("foo");
  });

  it("leaves safe values untouched", () => {
    expect(sanitizeCsvValue("manager_email")).toBe("manager_email");
    expect(sanitizeCsvValue("alice@example.com")).toBe("alice@example.com");
  });

  it("handles lone `-` / `+` / `@` by stripping them", () => {
    expect(sanitizeCsvValue("-")).toBe("");
    expect(sanitizeCsvValue("+")).toBe("");
    expect(sanitizeCsvValue("@")).toBe("");
  });
});

describe("parseCsvLine", () => {
  it("parses basic comma-separated values", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvLine('"foo, bar",baz')).toEqual(["foo, bar", "baz"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsvLine('"foo""bar",baz')).toEqual(['foo"bar', "baz"]);
  });

  it("trims each field", () => {
    expect(parseCsvLine(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  it("H-0440: sanitize:false preserves leading formula chars verbatim (header row)", () => {
    // A header is column-identity metadata, not a re-emitted value — its
    // leading +/-/@/= must NOT be stripped.
    expect(parseCsvLine("=manager_email,-net_ticket,@type", false)).toEqual([
      "=manager_email",
      "-net_ticket",
      "@type",
    ]);
    // ...while the default still sanitizes (data-cell injection defense).
    expect(parseCsvLine("=manager_email,-net_ticket,@type")).toEqual([
      "manager_email",
      "net_ticket",
      "type",
    ]);
  });

  it("preserves signed numerics in parsed fields", () => {
    expect(parseCsvLine("2024-01-15,-430.25")).toEqual(["2024-01-15", "-430.25"]);
  });
});

describe("parseCsv", () => {
  it("parses basic 3x3 CSV", () => {
    const raw = "a,b,c\n1,2,3\n4,5,6";
    expect(parseCsv(raw)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with commas", () => {
    const raw = 'name,desc\n"Jane, Doe","hello, world"';
    expect(parseCsv(raw)).toEqual([
      ["name", "desc"],
      ["Jane, Doe", "hello, world"],
    ]);
  });

  it("handles escaped quotes", () => {
    const raw = 'label\n"foo""bar"';
    expect(parseCsv(raw)).toEqual([["label"], ['foo"bar']]);
  });

  it("handles CRLF line endings", () => {
    const raw = "a,b\r\n1,2\r\n3,4";
    expect(parseCsv(raw)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("ignores a trailing newline", () => {
    const raw = "a,b\n1,2\n";
    expect(parseCsv(raw)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips blank lines", () => {
    const raw = "a,b\n\n1,2\n\n3,4\n";
    expect(parseCsv(raw)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    // Spreadsheet exports (Excel, Google Sheets UTF-8) often include a BOM.
    // Without stripping, the first header cell would be `\uFEFFmanager_email`
    // and schema matching would fail.
    const raw = "\uFEFFa,b\n1,2";
    expect(parseCsv(raw)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });

  it("preserves signed PnL values end-to-end", () => {
    // Regression guard for the sanitizer fix: a daily-PnL CSV with
    // negative values must NOT be silently flipped to positive.
    const raw = "date,pnl\n2024-01-15,1250.50\n2024-01-16,-430.25";
    expect(parseCsv(raw)).toEqual([
      ["date", "pnl"],
      ["2024-01-15", "1250.50"],
      ["2024-01-16", "-430.25"],
    ]);
  });

  it("H-0440: sanitizeFirstRow:false preserves the header but still sanitizes data rows", () => {
    const raw = "=manager_email,-net_ticket\n=cmd|calc,-evil";
    expect(parseCsv(raw, { sanitizeFirstRow: false })).toEqual([
      ["=manager_email", "-net_ticket"], // header verbatim
      ["cmd|calc", "evil"], // data still sanitized
    ]);
  });

  it("H-0440: default (no opts) still sanitizes row 0 — back-compat unchanged", () => {
    const raw = "=manager_email,-net_ticket\nalice,bob";
    expect(parseCsv(raw)).toEqual([
      ["manager_email", "net_ticket"],
      ["alice", "bob"],
    ]);
  });
});

describe("parseCsvWithSchema", () => {
  interface ManagerRow {
    email: string;
    tier: string;
  }

  it("returns mapped rows for valid CSV", () => {
    const raw = "email,tier\nalice@x.com,institutional\nbob@x.com,exploratory";
    const rows = parseCsvWithSchema<ManagerRow>(
      raw,
      ["email", "tier"],
      (row) => ({ email: row.email, tier: row.tier }),
    );
    expect(rows).toEqual([
      { email: "alice@x.com", tier: "institutional" },
      { email: "bob@x.com", tier: "exploratory" },
    ]);
  });

  it("throws if a required header column is missing", () => {
    const raw = "email\nalice@x.com";
    expect(() =>
      parseCsvWithSchema(raw, ["email", "tier"], (row) => row),
    ).toThrowError(/Missing CSV header column: tier/);
  });

  it("tolerates extra columns beyond the schema", () => {
    const raw = "email,tier,extra\nalice@x.com,institutional,hi";
    const rows = parseCsvWithSchema<ManagerRow>(
      raw,
      ["email", "tier"],
      (row) => ({ email: row.email, tier: row.tier }),
    );
    expect(rows).toEqual([{ email: "alice@x.com", tier: "institutional" }]);
  });

  it("allows columns in any order", () => {
    const raw = "tier,email\ninstitutional,alice@x.com";
    const rows = parseCsvWithSchema<ManagerRow>(
      raw,
      ["email", "tier"],
      (row) => ({ email: row.email, tier: row.tier }),
    );
    expect(rows).toEqual([{ email: "alice@x.com", tier: "institutional" }]);
  });

  it("matches headers case-insensitively", () => {
    // Preserves the old partner-import parser behavior which did
    // `rows[0][0]?.toLowerCase() === "manager_email"`.
    const raw = "Email,Tier\nalice@x.com,institutional";
    const rows = parseCsvWithSchema<ManagerRow>(
      raw,
      ["email", "tier"],
      (row) => ({ email: row.email, tier: row.tier }),
    );
    expect(rows).toEqual([{ email: "alice@x.com", tier: "institutional" }]);
  });

  it("tolerates a BOM-prefixed first header", () => {
    const raw = "\uFEFFemail,tier\nalice@x.com,institutional";
    const rows = parseCsvWithSchema<ManagerRow>(
      raw,
      ["email", "tier"],
      (row) => ({ email: row.email, tier: row.tier }),
    );
    expect(rows).toEqual([{ email: "alice@x.com", tier: "institutional" }]);
  });

  it("skips rows when mapRow returns null", () => {
    const raw = "email,tier\nalice@x.com,institutional\nbob@x.com,invalid\ncarol@x.com,exploratory";
    const rows = parseCsvWithSchema<ManagerRow>(
      raw,
      ["email", "tier"],
      (row) =>
        row.tier === "institutional" || row.tier === "exploratory"
          ? { email: row.email, tier: row.tier }
          : null,
    );
    expect(rows).toEqual([
      { email: "alice@x.com", tier: "institutional" },
      { email: "carol@x.com", tier: "exploratory" },
    ]);
  });

  it("returns empty array for empty input without throwing", () => {
    const rows = parseCsvWithSchema("", ["email"], (row) => row);
    expect(rows).toEqual([]);
  });

  it("handles quoted fields with commas via the shared parser", () => {
    const raw = 'name,desc\n"Doe, Jane","hello, world"';
    const rows = parseCsvWithSchema<{ name: string; desc: string }>(
      raw,
      ["name", "desc"],
      (row) => ({ name: row.name, desc: row.desc }),
    );
    expect(rows).toEqual([{ name: "Doe, Jane", desc: "hello, world" }]);
  });

  it("preserves signed numeric values in mapped rows", () => {
    const raw = "allocator_email,mandate_archetype,ticket_size_usd\nlp1@x.com,Neutral,-5000000";
    const rows = parseCsvWithSchema<{ email: string; ticket: number }>(
      raw,
      ["allocator_email", "mandate_archetype", "ticket_size_usd"],
      (row) => ({
        email: row.allocator_email,
        ticket: Number.parseFloat(row.ticket_size_usd),
      }),
    );
    expect(rows).toEqual([{ email: "lp1@x.com", ticket: -5_000_000 }]);
  });

  it("H-0440: a formula-prefixed header is preserved verbatim, not silently stripped into a match", () => {
    // Pre-fix, `sanitizeCsvValue` stripped the leading `-` from the header
    // (`-email` -> `email`), so a malformed/formula-prefixed header SILENTLY
    // matched the `email` schema column. Headers are column-identity metadata
    // and are now preserved verbatim, so this fails loud instead.
    const raw = "-email,tier\nalice@x.com,institutional";
    expect(() =>
      parseCsvWithSchema(raw, ["email", "tier"], (row) => row),
    ).toThrowError(/Missing CSV header column: email/);
    // ...and the diagnostic is actionable: it names the offending header cell
    // and tells the operator to strip the leading formula char (H-0440).
    expect(() =>
      parseCsvWithSchema(raw, ["email", "tier"], (row) => row),
    ).toThrowError(/found a header cell "-email".*remove the leading "-"/);
  });

  it("H-0440: a multi-formula-char header advises removing the FULL leading run", () => {
    // `=+manager_email` needs BOTH chars stripped — advising only the first
    // would leave `+manager_email` and loop the operator on the same 400.
    expect(() =>
      parseCsvWithSchema("=+email\nx", ["email"], (row) => row),
    ).toThrowError(/remove the leading "=\+" so the header reads "email"/);
  });

  it("H-0440: the missing-column diagnostic strips control chars and bounds width", () => {
    // The echoed header is operator-controlled and reaches the 400 body — no
    // control-char passthrough, and a pathologically wide header is truncated.
    let msg = "";
    try {
      parseCsvWithSchema("=email\u0007,tier\na,b", ["manager_email"], (r) => r);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/Missing CSV header column: manager_email/);
    expect(msg).not.toMatch(/[\x00-\x1f]/); // no control chars leak

    const wide = Array.from({ length: 500 }, (_, i) => `c${i}`).join(",");
    let wideMsg = "";
    try {
      parseCsvWithSchema(`${wide}\n1`, ["manager_email"], (r) => r);
    } catch (e) {
      wideMsg = (e as Error).message;
    }
    expect(wideMsg).toMatch(/\(\+\d+ more\)/); // truncated, not 500 cols echoed
  });

  it("H-0440: consistent verbatim headers — the digit-lookahead asymmetry is gone", () => {
    // Pre-fix `-net_ticket` -> `net_ticket` (stripped, matched) but
    // `-2024_pnl` -> `-2024_pnl` (digit-lookahead, NOT stripped, didn't
    // match): same prefix, opposite outcome. Now BOTH are verbatim and
    // neither silently matches its un-prefixed schema column.
    expect(() =>
      parseCsvWithSchema("-net_ticket\n1", ["net_ticket"], (row) => row),
    ).toThrowError(/Missing CSV header column: net_ticket/);
    expect(() =>
      parseCsvWithSchema("-2024_pnl\n1", ["2024_pnl"], (row) => row),
    ).toThrowError(/Missing CSV header column: 2024_pnl/);
  });

  it("H-0440: DATA cells are still formula-sanitized (injection defense intact)", () => {
    // Only the header is exempt — a data cell that would inject a spreadsheet
    // formula must still be neutralised.
    const raw = "email,note\nalice@x.com,=cmd|calc";
    const rows = parseCsvWithSchema<{ email: string; note: string }>(
      raw,
      ["email", "note"],
      (row) => ({ email: row.email, note: row.note }),
    );
    expect(rows).toEqual([{ email: "alice@x.com", note: "cmd|calc" }]);
  });

  it("H-0440: hasHeader:false sanitizes row 0 (it is data, not a header)", () => {
    const raw = "=cmd|calc,-5000";
    const rows = parseCsvWithSchema<{ a: string; b: string }>(
      raw,
      ["a", "b"],
      (row) => ({ a: row.a, b: row.b }),
      false,
    );
    // row 0 is data: formula stripped from the first cell, signed numeric kept.
    expect(rows).toEqual([{ a: "cmd|calc", b: "-5000" }]);
  });
});
