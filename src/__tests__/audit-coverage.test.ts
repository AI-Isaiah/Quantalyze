import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Sprint 6 closeout Task 7.1b — parametrized audit-coverage grep test.
 *
 * Scans every `src/app/api/** /route.ts` file and asserts that every
 * Supabase mutation (`.insert(`, `.update(`, `.delete(`, `.upsert(`)
 * is accompanied by ONE of:
 *   1. A `logAuditEvent(` or `logAuditEventAsUser(` call within a
 *      conservative window (default: 60 lines AFTER the mutation's
 *      first line). The window is large enough to accommodate the
 *      `if (error) { ... }` error-check block AND intervening
 *      non-blocking-emit statements (e.g., usage-funnel PostHog calls)
 *      that typically sit between a mutation and its audit emission in
 *      this codebase.
 *   2. An `@audit-skip:` pragma within 3 lines ABOVE the mutation.
 *
 * On failure the test prints the offending file + line + guidance
 * (add a logAuditEvent call or an @audit-skip pragma above the line).
 *
 * This test is the regression-pressure gate: a new mutation that ships
 * without instrumentation (e.g., a future webhook subscribe route)
 * fails the test and the author is forced to choose between "emit an
 * audit event" or "pragma-skip with a reason" — the third option
 * (silent drift) is what this test exists to block.
 *
 * Window choice (60 lines): empirical from the existing instrumented
 * sites. The intro.send pilot sits 48 lines after its insert (the gap
 * includes a null-id guard + a usage-event emit + a comment block).
 * The deletion.request.create pilot sits 30 lines after its insert
 * with a similar null-guard pattern. A 60-line window accommodates
 * both comfortably without allowing a "mutation at line 10, audit in
 * a completely different function at line 500" scenario. If a future
 * route grows past 60 lines of intervening logic, the author can
 * either restructure (extract the guards into a helper) or add an
 * `@audit-skip` pragma documenting why the audit lives elsewhere.
 *
 * The test does NOT cross file boundaries — a mutation with a
 * logAuditEvent that lives in a different file (e.g., a helper) will
 * fail this test. Author must either inline the emission at the
 * mutation site or pragma-skip the mutation with a reason explaining
 * where the audit lands.
 */

// __dirname is src/__tests__ at test time, so the API dir is one
// directory up + into app/api. The previous literal referenced
// ../../src/app/api, which only worked by accident because path.resolve
// collapsed the redundant src prefix against the test runner's cwd.
const API_DIR = path.resolve(__dirname, "../app/api");

interface Mutation {
  file: string;
  /** 1-indexed line of the mutation method call (`.insert(...)` etc.). */
  line: number;
  /** 1-indexed line of the mutation chain's start — the line where the
   * enclosing supabase chain begins (usually the `const { error } =
   * await supabase` or `await admin` line, upstream of the `.from(...)`
   * call). Pragmas must live within 3 lines above this chain-start
   * line; the chain-start anchor is more intuitive than the mutation
   * method line because the pragma naturally lives above the statement,
   * not in the middle of it. */
  chainStart: number;
  snippet: string;
}

/** Recursively collect every route.ts under API_DIR. Excludes *.test.ts. */
function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry.isFile() && entry.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Find every supabase-client-style mutation call in a file's source.
 *
 * Pattern: a line whose leading-whitespace prefix is followed by one
 * of the four method names + optional space + open paren. We require
 * the mutation to be part of a supabase chain by checking that a
 * `.from(` call appears within the 5 prior lines — this avoids false
 * positives on e.g. `Array.update(...)` or `weights.update(...)`.
 * Every DB mutation in this codebase follows the
 * `.from("table").insert(...)` idiom.
 *
 * `chainStart` is resolved by walking backward from the `.from(` line
 * to the first line whose non-whitespace prefix does NOT start with
 * `.` or end with a continuation (`=>`, `(`, `,`, `{`, `&&`, `||`). In
 * practice this lands on the `const { data, error } = await supabase`
 * line, which is where a pragma naturally sits.
 */
function findMutations(file: string, src: string): Mutation[] {
  const lines = src.split("\n");
  const mutations: Mutation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mutationMatch = /^\s*\.(insert|update|delete|upsert)\s*\(/.exec(line);
    if (!mutationMatch) continue;

    // Walk back up to 5 lines to find the `.from(` that anchors this chain.
    let fromIdx = -1;
    for (let j = Math.max(0, i - 5); j < i; j++) {
      if (/\.from\(/.test(lines[j])) {
        fromIdx = j;
        break;
      }
    }
    if (fromIdx < 0) continue;

    // Walk back from the .from line to find the first non-chain line.
    // A "chain line" is one whose first non-whitespace char is a `.` —
    // those are method-chain continuations. The statement start is the
    // first line that ISN'T a chain continuation.
    let chainStart = fromIdx;
    for (let j = fromIdx - 1; j >= 0; j--) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith(".") || trimmed === "") {
        // continuation or blank line — keep walking
        continue;
      }
      // This is the actual statement-start line (e.g. `const { data } = await supabase`).
      chainStart = j;
      break;
    }

    mutations.push({
      file,
      line: i + 1,
      chainStart: chainStart + 1,
      snippet: line.trim(),
    });
  }
  return mutations;
}

/**
 * Strip `//`-prefixed comment content so a comment mentioning
 * `logAuditEvent` (e.g., "// TODO: add logAuditEvent here") does not
 * falsely satisfy the coverage check. /review follow-up (T4-M2).
 *
 * Conservative: only strips `// …` to end of line. Doesn't attempt to
 * parse `/* … *\/` block comments or JSX comments — in practice the
 * route files don't use block comments around logAuditEvent mentions,
 * and single-line comments are where the false-positive risk lives.
 * If this ever matters more, switch to a proper tokenizer.
 */
function stripLineComment(line: string): string {
  const idx = line.indexOf("//");
  if (idx < 0) return line;
  return line.slice(0, idx);
}

/**
 * Known helper modules whose exports mutate DB tables but whose callers
 * typically inline the mutation in a route file via a helper call
 * rather than a `.from(...).update(...)` chain. The grep-based mutation
 * scan can't see those helper calls because the mutation is one hop
 * away in a different file. /review follow-up (T4-C1).
 *
 * For each entry, if a route file `import`s the module and calls one of
 * the listed helper names, we synthesize a virtual "mutation" on the
 * import line so the audit-coverage check can still pass/fail the
 * route. The author can either emit `logAuditEvent` in the route or
 * add an `@audit-skip` pragma above the import — the same contract as
 * for inline mutations.
 */
const HELPER_MUTATORS: Array<{ module: string; names: string[] }> = [
  {
    module: "@/lib/for-quants-leads-admin",
    names: ["markLeadProcessed", "unmarkLeadProcessed"],
  },
];

/**
 * Check whether a given mutation is "covered" — either an audit call
 * within a forward window, OR an `@audit-skip:` pragma within 8 lines
 * above the mutation chain's start line.
 *
 * Window shape:
 *   - Pragma lookback: 8 lines ABOVE `chainStart` (accommodates a
 *     multi-line comment block explaining the skip reason).
 *   - Audit-call lookforward: 60 lines AFTER the mutation method line
 *     (`.insert(…)` / `.update(…)` / …) plus 3 lines above chainStart
 *     for the rare "audit-before-mutation" pattern.
 *
 * Empirical basis: the intro.send pilot sits 48 lines after its insert;
 * deletion.request.create pilot sits ~30 lines after. A 60-line window
 * covers both with margin, without allowing a mutation at line 10 to
 * be "covered" by an audit call in a different function at line 500.
 *
 * The window is asymmetric (mostly forward) because audit emissions
 * conventionally follow the mutation they audit (so caller-error
 * branches can return before the emission fires).
 *
 * /review follow-up (T4-M2): strips `//` comments before scanning so a
 * comment mentioning `logAuditEvent` doesn't falsely satisfy coverage.
 */
function isCovered(
  mutation: Mutation,
  lines: string[],
): { covered: boolean; reason: string } {
  const lineIdx = mutation.line - 1;
  const chainStartIdx = mutation.chainStart - 1;

  // Pragma check: @audit-skip must live within 8 lines ABOVE the
  // mutation chain's start line. 8 lines allows for a multi-line
  // comment block explaining the skip reason (the partner-import skip
  // has 3-4 lines of prose; the finalize-wizard denormalization skip
  // has 6 lines above the ternary branch hosting the mutation). If
  // the pragma is farther than 8 lines from the mutation it's probably
  // orphaned on a different statement — the test correctly flags it.
  for (let j = Math.max(0, chainStartIdx - 8); j < chainStartIdx; j++) {
    if (/@audit-skip\s*:/.test(lines[j])) {
      return { covered: true, reason: "pragma" };
    }
  }

  // Audit call check: logAuditEvent / logAuditEventAsUser within a
  // 60-line forward window from the mutation method line. We also
  // search 3 lines above the chain start for the rare
  // "audit-before-mutation" pattern. Comment content is stripped so a
  // `// TODO: logAuditEvent(…)` mention doesn't satisfy coverage.
  const windowStart = Math.max(0, chainStartIdx - 3);
  const windowEnd = Math.min(lines.length, lineIdx + 60);
  for (let j = windowStart; j < windowEnd; j++) {
    if (/logAuditEvent(AsUser)?\s*\(/.test(stripLineComment(lines[j]))) {
      return { covered: true, reason: "audit-call" };
    }
  }

  return { covered: false, reason: "uncovered" };
}

/**
 * Find DB-mutating helper calls — see HELPER_MUTATORS above. Returns a
 * synthesized Mutation for each call so the same coverage check can
 * run. The mutation `line` is the helper-call line; `chainStart` is the
 * same (helper calls are not method chains, so pragma-above works from
 * the same anchor). /review follow-up (T4-C1).
 */
function findHelperMutations(file: string, src: string): Mutation[] {
  const lines = src.split("\n");
  const out: Mutation[] = [];

  for (const helper of HELPER_MUTATORS) {
    // Must import from the helper module for its calls to count.
    const importRe = new RegExp(
      `from\\s+["']${helper.module.replace(/[./]/g, "\\$&")}["']`,
    );
    const imports = lines.some((l) => importRe.test(l));
    if (!imports) continue;

    for (const name of helper.names) {
      const callRe = new RegExp(`\\b${name}\\s*\\(`);
      for (let i = 0; i < lines.length; i++) {
        const line = stripLineComment(lines[i]);
        if (!callRe.test(line)) continue;
        // Skip the import declaration itself — the `import { foo } from ...`
        // line doesn't count as a call site.
        if (/^\s*import\s/.test(lines[i])) continue;
        out.push({
          file,
          line: i + 1,
          chainStart: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return out;
}

describe("audit coverage: every mutation site in src/app/api must emit or skip", () => {
  it("every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip", () => {
    const routeFiles = collectRouteFiles(API_DIR);
    expect(routeFiles.length).toBeGreaterThan(0);

    const uncovered: Array<{
      file: string;
      line: number;
      snippet: string;
    }> = [];

    for (const file of routeFiles) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split("\n");
      const mutations = [
        ...findMutations(file, src),
        // /review follow-up (T4-C1): helper-indirection coverage.
        // Routes that delegate their mutation to a named helper export
        // must still emit an audit event in the route file.
        ...findHelperMutations(file, src),
      ];
      for (const m of mutations) {
        const check = isCovered(m, lines);
        if (!check.covered) {
          uncovered.push({
            file: path.relative(path.resolve(__dirname, "../.."), m.file),
            line: m.line,
            snippet: m.snippet,
          });
        }
      }
    }

    if (uncovered.length > 0) {
      const formatted = uncovered
        .map((u) => `  ${u.file}:${u.line}\n    > ${u.snippet}`)
        .join("\n");
      const guidance =
        "Each mutation must be accompanied by one of:\n" +
        "  1. A logAuditEvent(...) or logAuditEventAsUser(...) call within 60 lines after the mutation, OR\n" +
        "  2. A `// @audit-skip: <reason>` pragma within 8 lines above the mutation chain's start line (explain why this mutation does not need an audit event — e.g., internal state tracking, denormalization cache, cron GC).\n" +
        "\n" +
        "See src/lib/audit.ts + docs/architecture/adr-0023-audit-event-taxonomy.md for the taxonomy.";
      throw new Error(
        `Found ${uncovered.length} uninstrumented mutation(s):\n${formatted}\n\n${guidance}`,
      );
    }

    expect(uncovered).toEqual([]);
  });
});
