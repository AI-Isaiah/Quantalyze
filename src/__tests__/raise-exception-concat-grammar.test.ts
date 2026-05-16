import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression guard for the apply-blocker on 2026-05-16 (PR #182 → #196 → #197):
//
// `20260516160300_match_decisions_kind_enum_idempotency.sql` shipped a
// `RAISE EXCEPTION` whose format slot was a `||`-concatenated chain of
// string literals:
//
//   RAISE EXCEPTION
//     'first part: %. Present: %. ' ||
//     'remediation: ... ' ||
//     'note: ...',
//     arg1, arg2;
//
// PL/pgSQL's RAISE grammar requires the format slot to be a SINGLE string
// literal. The lexer rejects `||` here even though it works in every other
// SQL context. The migration failed at apply with SQLSTATE 42601 (workflow
// run #25971769997, 2026-05-16), blocking the 12 pending migrations behind
// it for hours.
//
// This test walks every migration file and asserts that no `RAISE` statement
// (EXCEPTION | NOTICE | WARNING | INFO | LOG | DEBUG) uses `||` to
// concatenate string literals inside its format slot. Three legal forms are
// allowed:
//   (a) single literal — `RAISE EXCEPTION 'foo: %', arg;`
//   (b) dollar-quoted literal — `RAISE EXCEPTION $msg$foo: %$msg$, arg;`
//   (c) literal + variable concat with parens / DECLARE pattern
//
// Pure text-based regression — no live DB required.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

function stripLineComments(sql: string): string {
  // Drop -- ... comments without touching string contents.
  // PostgreSQL strings can span lines but line comments cannot, so we
  // strip line-by-line.
  return sql
    .split("\n")
    .map((line) => {
      // Find first '--' that is not inside a single-quoted literal.
      // A naive scan suffices for our SQL files (no embedded quotes
      // in the comment patterns we care about).
      let inStr = false;
      for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i];
        if (ch === "'") inStr = !inStr;
        if (!inStr && ch === "-" && line[i + 1] === "-") {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

function findRaiseConcatBugs(
  filename: string,
  sql: string,
): Array<{ line: number; snippet: string }> {
  const stripped = stripLineComments(sql);
  const lines = stripped.split("\n");
  const bugs: Array<{ line: number; snippet: string }> = [];

  // Walk line-by-line; when we see a RAISE statement, accumulate until
  // the terminating ';'. Inside that statement body, flag any `'<text>'
  // ||` or `|| '<text>'` pattern — that is the bug signature.
  let inRaise = false;
  let startLine = 0;
  let statementBody = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inRaise) {
      if (
        /RAISE\s+(EXCEPTION|NOTICE|WARNING|INFO|LOG|DEBUG)\b/i.test(line)
      ) {
        inRaise = true;
        startLine = i + 1;
        statementBody = line;
        if (/;\s*$/.test(line.trim())) {
          // single-line RAISE — check it
          if (hasBugPattern(statementBody)) {
            bugs.push({ line: startLine, snippet: statementBody.trim() });
          }
          inRaise = false;
          statementBody = "";
        }
      }
    } else {
      statementBody += "\n" + line;
      if (/;\s*$/.test(line.trim())) {
        if (hasBugPattern(statementBody)) {
          bugs.push({
            line: startLine,
            snippet: statementBody.trim().slice(0, 240),
          });
        }
        inRaise = false;
        statementBody = "";
      }
      // Safety cap: a real RAISE rarely spans more than 30 lines.
      if (i - startLine > 30) {
        inRaise = false;
        statementBody = "";
      }
    }
  }

  return bugs;
}

function extractFormatSlot(body: string): string {
  // The format slot is the text between `RAISE <LEVEL>` and the FIRST
  // top-level comma. Commas inside string literals or dollar-quoted
  // blocks must not count. PL/pgSQL `||` inside the format slot is the
  // bug; `||` inside the argument list (after the first top-level
  // comma) is legal.
  const start = body.search(
    /RAISE\s+(EXCEPTION|NOTICE|WARNING|INFO|LOG|DEBUG)\b/i,
  );
  if (start < 0) return "";
  // Skip past the RAISE <LEVEL> keyword.
  const afterKeyword =
    body.slice(start).replace(
      /^RAISE\s+(EXCEPTION|NOTICE|WARNING|INFO|LOG|DEBUG)\s+/i,
      "",
    );
  // Walk char-by-char; track single-quote string state and `$tag$`
  // dollar-quote state. Stop at the first top-level comma OR the
  // terminating `;`.
  let inSingle = false;
  let dollarTag: string | null = null;
  let i = 0;
  while (i < afterKeyword.length) {
    const ch = afterKeyword[i];
    // Dollar-quote tag detection: `$tag$` where tag is [A-Za-z0-9_]*
    if (!inSingle && ch === "$") {
      const m = afterKeyword.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (m) {
        const tag = m[1];
        if (dollarTag === null) {
          dollarTag = tag;
          i += m[0].length;
          continue;
        } else if (dollarTag === tag) {
          dollarTag = null;
          i += m[0].length;
          continue;
        }
      }
    }
    if (dollarTag !== null) {
      i++;
      continue;
    }
    if (ch === "'") {
      // SQL escape: '' inside string is a literal quote.
      if (inSingle && afterKeyword[i + 1] === "'") {
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (!inSingle) {
      if (ch === ",") {
        return afterKeyword.slice(0, i);
      }
      if (ch === ";") {
        return afterKeyword.slice(0, i);
      }
    }
    i++;
  }
  return afterKeyword;
}

function hasBugPattern(body: string): boolean {
  // The bug pattern: `||` inside the FORMAT SLOT of a RAISE statement.
  // PL/pgSQL allows `||` freely in the argument list (after the first
  // top-level comma) but rejects it in the format slot with SQLSTATE
  // 42601 at parse time. We must scope our check to the format slot.
  const formatSlot = extractFormatSlot(body);
  if (!formatSlot) return false;
  // Inside the format slot, any `||` is a bug. Be strict — even
  // `'foo' || v_name` is illegal here, and the same fix applies.
  return /\|\|/.test(formatSlot);
}

describe("PL/pgSQL RAISE format slot must be a single literal (apply-blocker regression 2026-05-16)", () => {
  it("no migration uses || concat in a RAISE format slot", () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) =>
      f.endsWith(".sql"),
    );

    expect(
      sqlFiles.length,
      "expected at least one migration file under supabase/migrations/",
    ).toBeGreaterThan(0);

    const allBugs: Array<{ file: string; line: number; snippet: string }> =
      [];

    for (const file of sqlFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const bugs = findRaiseConcatBugs(file, sql);
      for (const b of bugs) {
        allBugs.push({ file, line: b.line, snippet: b.snippet });
      }
    }

    if (allBugs.length > 0) {
      const detail = allBugs
        .map(
          (b) =>
            `  - ${b.file}:${b.line}\n      ${b.snippet.replace(/\n/g, "\n      ")}`,
        )
        .join("\n");
      throw new Error(
        `Found ${allBugs.length} RAISE statement(s) with '||' concatenation in the format slot.\n` +
          `PL/pgSQL requires the format string to be a SINGLE literal — '||' triggers SQLSTATE 42601 at apply.\n` +
          `Fix: collapse to one literal, use $tag$...$tag$ dollar-quoting, or DECLARE a variable.\n\n` +
          detail,
      );
    }

    expect(allBugs.length).toBe(0);
  });

  it("the 160300 idempotency migration uses dollar-quoting for its multi-line RAISE", () => {
    // Self-pinning check: the file fixed by PR #197 must keep its
    // dollar-quoted form. If a future refactor reverts to '||' concat,
    // the previous test catches it generically — this one names the
    // exact incident file so the regression is unmissable.
    const path = join(
      MIGRATIONS_DIR,
      "20260516160300_match_decisions_kind_enum_idempotency.sql",
    );
    const sql = readFileSync(path, "utf8");
    expect(
      /\$msg\$/.test(sql),
      "migration 20260516160300 lost its $msg$ dollar-quoted RAISE — the apply-blocker regression is back",
    ).toBe(true);
    expect(
      findRaiseConcatBugs("20260516160300", sql).length,
      "migration 20260516160300 regressed to '||' concat in RAISE format",
    ).toBe(0);
  });
});
