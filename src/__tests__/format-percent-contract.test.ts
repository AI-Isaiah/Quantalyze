import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Phase A1 contract test — single-source-of-truth for percentage rendering.
 *
 * The canonical helper lives at `src/lib/utils.ts#formatPercent`. Three
 * components used to ship local re-implementations (HoldingsTable,
 * HoldingDetail, OutcomesWidget) which made MTD render "12.34%" in some
 * places and "+12.34%" in others.
 *
 * This test fails if any TS/TSX file outside `src/lib/utils.ts` declares
 * a local `formatPercent` (function or const). New callers must import
 * from `@/lib/utils` and pass `{ signed: false }` for unsigned-domain
 * values like weights. The signed-vs-unsigned policy lives in one place.
 *
 * The test deliberately does NOT scan for inline `(x * 100).toFixed(N)%`
 * patterns — those appear in Recharts tickFormatters and tooltip
 * formatters where the API requires a function, not a string. A future
 * pass can migrate those once a `tickFormatPercent`-style helper exists.
 */

const SRC_ROOT = path.resolve(__dirname, "..");
const ALLOWED_DECLARATION_PATHS = new Set([
  path.join(SRC_ROOT, "lib", "utils.ts"),
]);

// Match `function formatPercent(`, `const formatPercent =`, and
// `const formatPercent:` declarations. Captures `formatPercentSigned` /
// `formatPercentile` etc. via the boundary check.
const DECLARATION_RE =
  /^\s*(?:export\s+)?(?:function\s+formatPercent\s*\(|const\s+formatPercent\s*[:=])/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield full;
    }
  }
}

describe("formatPercent single-source contract", () => {
  it("no source file outside src/lib/utils.ts declares a local formatPercent", () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of walk(SRC_ROOT)) {
      if (ALLOWED_DECLARATION_PATHS.has(file)) continue;

      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (DECLARATION_RE.test(line)) {
          violations.push({
            file: path.relative(SRC_ROOT, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `  src/${v.file}:${v.line}\n    ${v.text}\n    → import { formatPercent } from "@/lib/utils" instead`,
        )
        .join("\n\n");
      expect.fail(
        `Local formatPercent declaration(s) found. Use the canonical helper from @/lib/utils so MTD/weight/dd render the same way everywhere.\n\n${report}\n`,
      );
    }
  });
});
