import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// 140.4-09 / SEAMRIM-06 — the AST for the one-hop alias rule below. `typescript`
// is an existing dev dependency; nothing was installed for this.
import ts from "typescript";

/**
 * Phase 140.2 / SEAMCORE-06 + SEAMCORE-08 — no seam log site may pass a raw
 * error to the console.
 *
 * WHY A SOURCE SCAN AND NOT A BEHAVIOURAL TEST. The class is "every console
 * site on the seam path", and the failure mode is a NEW member appearing —
 * a site nobody wrote a test for, because nobody knew it existed. A behavioural
 * test can only cover sites it names; only a scan can fail on one it has never
 * seen. This is the `[SD-CRITICAL-01]` shape and the same reasoning that makes
 * `resilient-fetch.wiring.test.ts`'s binding roster load-bearing.
 *
 * WHAT IT IS DEFENDING. undici embeds the OUTGOING HEADERS in `err.message`
 * and, in one shape, in `err.name`. On this seam those headers are
 * `Authorization: Bearer <INTERNAL_API_TOKEN>`, `X-Service-Key`, and — on the
 * CSV finalize flow — `X-User-Access-Token`, a LIVE end-user Supabase JWT. So
 * `console.error("…", err)` on any of these six files is a credential in the
 * Vercel log, with nothing in the code that looks wrong.
 *
 * ⚠️ GREP-GATE HYGIENE, AND THIS PHASE PAID FOR IT FIVE TIMES. The source is
 * comment-stripped BEFORE matching. Without the strip, this very file's subject
 * matter — and the seam files' own docblocks, which necessarily discuss the
 * shape being banned — satisfy the pattern and the guard reports a violation
 * that is prose. A bare `grep -c` is self-invalidating for exactly this reason.
 *
 * ⚠️ THIS GUARD IS NOT A LINT RULE ON PURPOSE. The predicate needs the set of
 * identifiers bound by a `catch` in the same file, which is per-file state a
 * regex-based ESLint rule would have to rebuild anyway; and the file list is
 * the seam's, not a directory's. If the seam ever grows a seventh file, adding
 * it here is the deliberate act — `SEAM_FILES` is hand-typed for that reason.
 */

/**
 * The eight seam files. Hand-typed, and deliberately NOT derived from
 * `SEAM_ROUTE_BUDGETS`: that table lists fifteen ROUTES, of which only five
 * carry credential-bearing error logs, and a derived list would silently widen
 * or narrow this guard whenever the budget table moved.
 *
 * The two `/health` warmers are excluded for the reason
 * `SEAM_EXCLUSIONS` gives: they do not route through the core, they must not
 * consume breaker budget, and their two `console.info` calls carry no error at
 * all.
 *
 * ⚠️ EIGHT SINCE HI-02, AND THE LAST TWO WERE THE HOLE. `create-with-key` and
 * `composite/add-key` both spend the `validate-key` + `encrypt-key` budgets,
 * both were edited by this phase, and both logged a raw `err.message` — and
 * neither was here NOR in `SEAM_EXCLUSIONS`, so this guard could not see them
 * while the REGISTRY entry claimed class closure. A hand-typed roster cannot
 * close a class by itself; the completeness assertion below is what makes the
 * omission of a NEW credential-bearing route redden on the day it is written.
 */
const SEAM_FILES: readonly string[] = [
  "src/lib/resilient-fetch.ts",
  "src/lib/analytics-client.ts",
  "src/lib/process-key-client.ts",
  "src/app/api/keys/[id]/permissions/route.ts",
  "src/app/api/keys/validate-and-encrypt/route.ts",
  "src/app/api/strategies/finalize-wizard/route.ts",
  "src/app/api/strategies/create-with-key/route.ts",
  "src/app/api/strategies/composite/add-key/route.ts",
];

/** The scrub functions a caught value may legally be passed through. */
const SCRUBBERS = ["scrubSeamError", "scrubSeamString"];

/**
 * Properties of a caught value that may reach a log unscrubbed, each with its
 * reason. Both are non-string facts from types WE define, so neither can carry
 * an undici header:
 *   · `retryAfterS` — a number on `CircuitOpenError`, derived from the lock.
 *   · `deadlineExceeded` — a boolean on `SeamBodyReadError`.
 *   · `code` — a five-character SQLSTATE from a closed set; the branches that
 *     follow such a log key off it, so hiding it from the operator would leave
 *     them unable to reproduce the decision the code took.
 */
const SAFE_PROPERTIES = ["retryAfterS", "deadlineExceeded", "code"];

/**
 * 140.4-09 — the GLOBAL `Error` CONSTRUCTOR, excluded from the errorish half.
 *
 * `/^(error|[\w$]*(Err|Error))$/` accepts the identifier `Error` itself, so
 * `console.error("…", err instanceof Error ? scrubSeamError(err) : "x")` reports
 * a bare `Error` — the global constructor, which carries no data at all, let
 * alone an undici header. Measured under the widened roster of `140.4-10`: the
 * false positive surfaces at exactly three sites (`keys/sync`,
 * `portfolio-optimizer`, `csv-finalize`), all of them the `instanceof` shape.
 *
 * THE EXCLUSION IS NARROW, and deliberately an EXACT-NAME match rather than a
 * pattern: a binding named `readError` or `rpcErr` is still flagged. Shadowing
 * the global with a local binding named `Error` is not a shape that exists in
 * this codebase — nothing here declares one — so the exclusion cannot hide a
 * real caught value behind a rename.
 */
const GLOBAL_ERROR_CONSTRUCTOR = "Error";

/**
 * Strip comments, preserving line numbers so a violation can be located.
 *
 * Block comments are blanked character-for-character rather than removed; a
 * whole-line `//` comment becomes an empty line. Trailing `//` comments are
 * LEFT IN, which can only produce a false POSITIVE — the safe direction for a
 * guard whose job is to fail loud.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

/** Identifiers bound by a `catch (x)` anywhere in the file. */
function caughtIdentifiers(code: string): Set<string> {
  const found = new Set<string>();
  const pattern = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) found.add(match[1]);
  return found;
}

/**
 * Extract each `console.error(...)` / `console.warn(...)` argument list.
 *
 * A balanced-paren scan that TRACKS QUOTE STATE. Naive paren counting breaks on
 * a `)` inside a string — and one of the real sites logs `(CT-7)` inside a
 * template literal, so this is not a hypothetical.
 */
function consoleCalls(
  code: string,
): Array<{ line: number; args: string }> {
  const calls: Array<{ line: number; args: string }> = [];
  const opener = /console\.(error|warn)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(code)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    let quote: string | null = null;
    let escaped = false;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    calls.push({
      line: code.slice(0, match.index).split("\n").length,
      args: code.slice(start, i - 1),
    });
  }
  return calls;
}

/**
 * Blank out string and template TEXT inside an argument list, preserving the
 * code inside `${…}` interpolations.
 *
 * Without this the guard reports prose: `console.error("RPC error:", …)`
 * contains the word `error` inside a message, and one of the real sites logs
 * "…probe failed:" — neither is a reference to anything. Blanking a whole
 * template literal would be the opposite error, hiding a genuine `${err}`, so
 * interpolation depth is tracked rather than the literal skipped.
 *
 * Length is preserved so reported offsets stay meaningful.
 */
function maskStrings(args: string): string {
  const out = args.split("");
  let i = 0;
  let quote: string | null = null;
  let escaped = false;
  // Depth of `${…}` nesting inside the current template literal.
  let interpolation = 0;
  while (i < out.length) {
    const ch = args[i];
    if (escaped) {
      escaped = false;
      if (quote && interpolation === 0) out[i] = " ";
      i++;
      continue;
    }
    if (ch === "\\" && quote) {
      escaped = true;
      if (interpolation === 0) out[i] = " ";
      i++;
      continue;
    }
    if (quote === "`" && interpolation > 0) {
      // Inside `${…}` — real code. Only track the braces.
      if (ch === "{") interpolation++;
      else if (ch === "}") interpolation--;
      i++;
      continue;
    }
    if (quote) {
      if (quote === "`" && ch === "$" && args[i + 1] === "{") {
        interpolation = 1;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      else out[i] = " ";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    i++;
  }
  return out.join("");
}

/**
 * Every reference to `identifier` inside `args` that is neither wrapped in a
 * scrubber nor an allowlisted safe property read.
 */
function bareReferences(rawArgs: string, identifier: string): string[] {
  const args = maskStrings(rawArgs);
  const violations: string[] = [];
  const pattern = new RegExp(`\\b${identifier}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(args)) !== null) {
    const before = args.slice(Math.max(0, match.index - 40), match.index);
    const after = args.slice(match.index + identifier.length);
    // Skip a property NAME that merely happens to match (`{ err: … }` reads as
    // a key, and `.err` is a member of something else).
    if (/[.]\s*$/.test(before)) continue;
    const wrapped = SCRUBBERS.some((fn) =>
      new RegExp(`\\b${fn}\\s*\\(\\s*$`).test(before),
    );
    if (wrapped) continue;
    const safeProperty = SAFE_PROPERTIES.some((prop) =>
      new RegExp(`^\\s*\\.\\s*${prop}\\b`).test(after),
    );
    if (safeProperty) continue;
    violations.push(identifier);
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// 140.4-09 / SEAMRIM-06 — THE ONE-HOP ALIAS RULE.
//
// THE HOLE IT CLOSES. Everything above matches a BARE REFERENCE to a caught
// identifier. `csv-validate`'s terminal catch read
//
//     const message = err instanceof Error ? err.message : "CSV validation failed";
//     console.error("[strategies/csv-validate] unified path threw:", message);
//
// and scored CLEAN under BOTH halves: `message` is not a caught identifier and
// it is not errorish by name. One hop of indirection and the guard was blind.
//
// THE RULE IS A PROPERTY, NOT A ROSTER — which is what makes it coverage-law
// ROW 1 rather than another hand-typed list that closes 8 of 15:
//
//     Taint propagates to an alias ONLY through an expression that can carry
//     the caught value's own TEXT.
//
// Text is the whole of what is being defended: undici embeds the OUTGOING
// HEADERS into `err.message`. A classifier call that returns a BOOLEAN, or a
// constructor that returns one of OUR OWN typed objects, cannot carry a header
// no matter what it was derived from.
//
// ⚠️ A NAIVE ALIAS RULE IS WORSE THAN NO ALIAS RULE. Three implementations were
// measured against this roster before this one was written:
//
//   · a scope-blind regex alias rule            → 51 hits, ~47 FALSE POSITIVES
//     (name collisions across unrelated scopes)
//   · a scope-aware AST rule tainting on ANY reference
//                                               → 3 offences, ALL THREE FALSE:
//       `resilient-fetch.ts` ×2 — `const deadlineExceeded = isDeadlineError(err)`,
//         a BOOLEAN from our own predicate;
//       `keys/[id]/permissions` — `const seamFailure = readSeamFailureCause(err)`
//         then `seamFailure.retryAfterSeconds`, a NUMBER on our own type.
//   · THIS rule (text-carrying channel only)    → 0 offences on this roster
//
// This file's own warning, and the reason the third was chosen:
// "a guard that cries wolf gets widened until it catches nothing."
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Properties whose READ yields the caught value's own text.
 *
 * `message` and `name` are the two undici writes the outgoing headers into.
 * `stack` embeds the message. `cause` is the wrapped original — `SeamBodyReadError`
 * attaches the real rejection there, so a renderer that walks it reproduces the
 * message one level down.
 *
 * Deliberately NOT here: `code`, `retryAfterS`, `deadlineExceeded`,
 * `retryAfterSeconds`, `status`. Every one is a non-string fact from a type WE
 * define, which is exactly the `SAFE_PROPERTIES` reasoning applied one hop out.
 */
const TEXT_CARRYING_PROPERTIES = ["message", "name", "stack", "cause"];

/**
 * Binary operators that FORWARD an operand's text rather than testing it.
 *
 * `+` concatenates; `??`, `||` and `&&` evaluate TO one of their operands. Every
 * other operator — `===`, `!==`, `instanceof`, `in`, `<`, arithmetic — yields a
 * boolean or a number that cannot carry a header, and treating those as
 * text-carrying is precisely the over-taint that produced the 47 false
 * positives: `err.message === "x"` is a BOOLEAN.
 */
const TEXT_FORWARDING_BINARY_OPERATORS: readonly ts.SyntaxKind[] = [
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
];

/**
 * Can this expression carry the TEXT of something in `tainted`?
 *
 * The `false` at the bottom of the `CallExpression` arm is the entire
 * discrimination this rule exists for, and it is what the two real shapes above
 * depend on: an arbitrary call's return type is the CALLEE's, not its argument's.
 */
function carriesText(node: ts.Expression, tainted: ReadonlySet<string>): boolean {
  if (ts.isParenthesizedExpression(node)) {
    return carriesText(node.expression, tainted);
  }
  // A type-only wrapper changes nothing about the value that flows through.
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return carriesText(node.expression, tainted);
  }
  if (ts.isIdentifier(node)) return tainted.has(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return (
      TEXT_CARRYING_PROPERTIES.includes(node.name.text) &&
      carriesText(node.expression, tainted)
    );
  }
  if (ts.isElementAccessExpression(node)) {
    // `err["message"]` is `err.message` written the other way.
    const arg = node.argumentExpression;
    return (
      ts.isStringLiteralLike(arg) &&
      TEXT_CARRYING_PROPERTIES.includes(arg.text) &&
      carriesText(node.expression, tainted)
    );
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.some((span) => carriesText(span.expression, tainted));
  }
  if (ts.isConditionalExpression(node)) {
    // `err instanceof Error ? err.message : "fallback"` — the csv-validate shape.
    // The CONDITION is not consulted; only the two values the expression can
    // evaluate to.
    return (
      carriesText(node.whenTrue, tainted) || carriesText(node.whenFalse, tainted)
    );
  }
  if (ts.isBinaryExpression(node)) {
    return (
      TEXT_FORWARDING_BINARY_OPERATORS.includes(node.operatorToken.kind) &&
      (carriesText(node.left, tainted) || carriesText(node.right, tainted))
    );
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "toString") {
        return carriesText(callee.expression, tainted);
      }
      if (
        callee.name.text === "stringify" &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "JSON"
      ) {
        return node.arguments.some((arg) => carriesText(arg, tainted));
      }
    }
    if (ts.isIdentifier(callee) && callee.text === "String") {
      return node.arguments.some((arg) => carriesText(arg, tainted));
    }
    // ⚠️ EVERY OTHER CALL IS OPAQUE, AND THAT IS THE POINT. `isDeadlineError(err)`
    // returns a boolean and `readSeamFailureCause(err)` returns one of our own
    // typed objects. Tainting either is how a rule reaches 47 false positives
    // and then gets widened until it catches nothing.
    return false;
  }
  return false;
}

/** Is this expression the tainted value ITSELF (modulo type-only wrappers)? */
function isTaintedValue(
  node: ts.Expression,
  tainted: ReadonlySet<string>,
): boolean {
  if (ts.isParenthesizedExpression(node)) {
    return isTaintedValue(node.expression, tainted);
  }
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return isTaintedValue(node.expression, tainted);
  }
  return ts.isIdentifier(node) && tainted.has(node.text);
}

/**
 * The identifiers a `catch` block binds that carry the caught value's text.
 *
 * Seeded with the caught identifier, then iterated over the block's variable
 * declarations TO A FIXPOINT so a two-step chain (`const a = err.message;
 * const b = a;`) and an out-of-order declaration both close.
 *
 * SCOPE-AWARE BY CONSTRUCTION: only declarations lexically inside THIS catch
 * block are considered, and only its own text is scanned for sinks. A
 * same-named binding in an unrelated function is invisible here — which is the
 * property the scope-blind regex version lacked.
 *
 * Returns the ALIASES only, never the seed: the caught identifier itself is
 * already the subject of the first assertion in this file, and reporting it
 * twice would make one defect read as two.
 */
function taintedAliases(clause: ts.CatchClause): Set<string> {
  const bound = clause.variableDeclaration?.name;
  if (bound === undefined || !ts.isIdentifier(bound)) return new Set();

  const tainted = new Set<string>([bound.text]);
  const aliases = new Set<string>();

  const declarations: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(clause.block);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const initializer = declaration.initializer;
      if (initializer === undefined) continue;

      if (ts.isIdentifier(declaration.name)) {
        if (tainted.has(declaration.name.text)) continue;
        if (!carriesText(initializer, tainted)) continue;
        tainted.add(declaration.name.text);
        aliases.add(declaration.name.text);
        changed = true;
        continue;
      }

      // `const { message } = err` is the same hop written as a destructure. Only
      // the text-carrying property NAMES propagate — `const { code } = err`
      // does not, for the same reason `code` is a SAFE_PROPERTY above.
      if (ts.isObjectBindingPattern(declaration.name)) {
        // Only a DIRECTLY tainted source is destructured. Destructuring the
        // result of a text-carrying expression (`const { x } = err.message`)
        // reads fields off a string and carries nothing.
        if (!isTaintedValue(initializer, tainted)) continue;
        for (const element of declaration.name.elements) {
          const property = element.propertyName ?? element.name;
          const propertyName = ts.isIdentifier(property)
            ? property.text
            : ts.isStringLiteralLike(property)
              ? property.text
              : undefined;
          if (
            propertyName === undefined ||
            !TEXT_CARRYING_PROPERTIES.includes(propertyName)
          ) {
            continue;
          }
          if (!ts.isIdentifier(element.name)) continue;
          if (tainted.has(element.name.text)) continue;
          tainted.add(element.name.text);
          aliases.add(element.name.text);
          changed = true;
        }
      }
    }
  }

  return aliases;
}

/** Parse comment-stripped source. Total: a parse never throws, it recovers. */
function parseStripped(file: string, code: string): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Every `catch` clause in a parsed file, in source order. */
function catchClauses(source: ts.SourceFile): ts.CatchClause[] {
  const found: ts.CatchClause[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) found.push(node);
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(source, walk);
  return found;
}

/**
 * Console sites in `code` that pass a one-hop ALIAS of a caught value.
 *
 * The sink check is the EXISTING `bareReferences` logic, unchanged and applied
 * to each tainted alias — so a scrubbed alias (`scrubSeamError(m)`) and a safe
 * property read off one are accepted here for exactly the reasons they are
 * accepted for the caught identifier itself.
 */
function aliasOffences(file: string, code: string): string[] {
  const source = parseStripped(file, code);
  const offences: string[] = [];
  for (const clause of catchClauses(source)) {
    const aliases = taintedAliases(clause);
    if (aliases.size === 0) continue;
    const blockStart = clause.block.getStart(source);
    const firstLine = code.slice(0, blockStart).split("\n").length;
    const blockText = code.slice(blockStart, clause.block.end);
    for (const call of consoleCalls(blockText)) {
      for (const alias of aliases) {
        for (const _ of bareReferences(call.args, alias)) {
          offences.push(
            `${file}:${firstLine + call.line - 1} passes \`${alias}\`, a ONE-HOP ALIAS of the caught value`,
          );
        }
      }
    }
  }
  return offences;
}

const FAILURE_REASON =
  "undici embeds the OUTGOING HEADERS in err.message and, in one shape, in " +
  "err.name. On this seam those headers are Authorization: Bearer " +
  "<INTERNAL_API_TOKEN>, X-Service-Key, and — on the CSV finalize flow — " +
  "X-User-Access-Token, which is a LIVE end-user Supabase JWT. Passing a caught " +
  "value to console.* therefore puts a credential in the Vercel log with " +
  "nothing in the code that looks wrong. Wrap it: scrubSeamError(err) from " +
  "@/lib/seam-redaction, plus any PER-REQUEST secret this call site holds as " +
  "the second argument. Do NOT answer this by dropping err instead — that is " +
  "the A-10 defect (the syscall token is the most valuable thing in the line).";

describe("[SEAMCORE-06 / SC6] no seam log site passes a raw caught error", () => {
  it.each(SEAM_FILES)("%s scrubs every caught value it logs", (file) => {
    const code = stripComments(readFileSync(join(process.cwd(), file), "utf8"));
    const caught = caughtIdentifiers(code);
    const offences: string[] = [];

    for (const call of consoleCalls(code)) {
      for (const identifier of caught) {
        for (const _ of bareReferences(call.args, identifier)) {
          offences.push(`${file}:${call.line} passes bare \`${identifier}\``);
        }
      }
    }

    expect(offences, `${offences.join("; ")}. ${FAILURE_REASON}`).toEqual([]);
  });

  it.each(SEAM_FILES)(
    "%s scrubs every error-shaped binding it logs (the Supabase half)",
    (file) => {
      // The Supabase / PostgREST error objects are NOT catch-bound — they arrive
      // destructured off a query result (`const { error: keyVenueErr } = await
      // …`). Five of those were scrubbed on finalize-wizard and three were not,
      // which is the instance-not-class shape this programme exists to close, so
      // the guard covers them by NAMING CONVENTION: an identifier called `error`
      // or ending in `Err`/`Error`.
      const code = stripComments(
        readFileSync(join(process.cwd(), file), "utf8"),
      );
      const offences: string[] = [];
      const errorish = /^(error|[\w$]*(Err|Error))$/;

      for (const call of consoleCalls(code)) {
        const identifiers = new Set(
          (maskStrings(call.args).match(/\b[A-Za-z_$][\w$]*\b/g) ?? []).filter(
            // The scrub functions are themselves named `…Error`. Excluding them
            // by name is narrower than excluding "anything wrapped": a call site
            // that passed a scrubber as a VALUE would still be a bare reference.
            (name) =>
              errorish.test(name) &&
              !SCRUBBERS.includes(name) &&
              name !== GLOBAL_ERROR_CONSTRUCTOR,
          ),
        );
        for (const identifier of identifiers) {
          for (const _ of bareReferences(call.args, identifier)) {
            offences.push(`${file}:${call.line} passes bare \`${identifier}\``);
          }
        }
      }

      expect(offences, `${offences.join("; ")}. ${FAILURE_REASON}`).toEqual([]);
    },
  );

  it.each(SEAM_FILES)(
    "%s scrubs every ONE-HOP ALIAS of a caught value it logs",
    (file) => {
      const code = stripComments(
        readFileSync(join(process.cwd(), file), "utf8"),
      );
      expect(
        aliasOffences(file, code),
        `${aliasOffences(file, code).join("; ")}. A caught value reached a ` +
          `console sink through ONE HOP of indirection — a binding whose ` +
          `initialiser can carry the error's own TEXT. The two halves above ` +
          `match only a BARE reference, so this shape was invisible to them: ` +
          `\`const message = err instanceof Error ? err.message : "…"\` is not ` +
          `a caught identifier and is not errorish by name. ${FAILURE_REASON}`,
      ).toEqual([]);
    },
  );

  it("HI-02: every route that spends a CREDENTIAL-BEARING budget is on the roster", () => {
    // ⚠️ THE ROSTER IS THE CLASS, AND A HAND-TYPED LIST CANNOT CLOSE A CLASS ON
    // ITS OWN. `SEAM_FILES` is hand-typed for a good reason (a derived list
    // would silently widen or narrow whenever SEAM_ROUTE_BUDGETS moved), but
    // that leaves exactly one failure mode: a route that BELONGS on it and was
    // never added. `create-with-key` and `composite/add-key` sat in that gap —
    // both spend the validate-key + encrypt-key budgets, both were edited by
    // this very phase, and both logged a raw `err.message`. Neither was on this
    // roster, so the guard could not see them, while the REGISTRY entry claimed
    // class closure.
    //
    // This assertion is the completeness half: the MEMBERSHIP TEST is scanned
    // from disk (does this route call the two credential-bearing clients?),
    // while WHAT IS ASSERTED about a member stays hand-typed. So a NEW route
    // that starts carrying raw exchange credentials reddens here on the day it
    // is written, rather than on the day someone notices.
    const routeFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(process.cwd(), dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name === "route.ts") routeFiles.push(rel);
      }
    };
    walk("src/app/api");

    // The two clients whose REQUEST BODIES carry the raw exchange `api_key`,
    // `api_secret` and `passphrase`, and whose outgoing headers carry
    // `X-Service-Key` and the minted `X-Tenant-Claim`. Hand-typed.
    const CREDENTIAL_BEARING_CALLS = ["validateKey(", "encryptKey("];

    const uncovered = routeFiles.filter((file) => {
      const code = stripComments(readFileSync(join(process.cwd(), file), "utf8"));
      const carriesCredentials = CREDENTIAL_BEARING_CALLS.some((call) =>
        code.includes(call),
      );
      return carriesCredentials && !SEAM_FILES.includes(file);
    });

    expect(
      uncovered,
      `These routes call validateKey/encryptKey — so their catch blocks stand ` +
        `over the raw exchange credentials — but are absent from SEAM_FILES, ` +
        `which means this guard never inspects them. ${FAILURE_REASON}`,
    ).toEqual([]);
  });

  it("the scan actually finds console calls and catch bindings (fail-loud on a broken scanner)", () => {
    // A scanner that matched NOTHING would report every file clean forever —
    // the failure mode that makes a source guard worse than no guard, because it
    // reads as protection. Both numbers are hand-typed lower bounds derived from
    // the comment-stripped scan recorded in 140.2-08-SUMMARY.md.
    let consoleSites = 0;
    let catchBindings = 0;
    for (const file of SEAM_FILES) {
      const code = stripComments(
        readFileSync(join(process.cwd(), file), "utf8"),
      );
      consoleSites += consoleCalls(code).length;
      catchBindings += caughtIdentifiers(code).size;
    }
    expect(consoleSites).toBeGreaterThanOrEqual(30);
    expect(catchBindings).toBeGreaterThanOrEqual(6);
  });

  it("140.4-09: the AST alias pass parses and TAINTS (fail-loud on a dead alias rule)", () => {
    // ⚠️ THE ALIAS RULE ASSERTS AN ABSENCE, SO IT NEEDS ITS OWN VACUITY FENCE,
    // AND IT HAS A FAILURE MODE THE REGEX HALVES DO NOT. `stripComments` runs
    // BEFORE the parse, and `ts.createSourceFile` RECOVERS from a malformed
    // input rather than throwing — so a strip that corrupted the source would
    // yield a tree with no catch clauses, `aliasOffences` would return `[]` for
    // every file forever, and the guard would read as protection while
    // inspecting nothing.
    //
    // Both floors are hand-typed literals, not `xs.length`.
    let clauses = 0;
    let aliases = 0;
    for (const file of SEAM_FILES) {
      const code = stripComments(
        readFileSync(join(process.cwd(), file), "utf8"),
      );
      for (const clause of catchClauses(parseStripped(file, code))) {
        clauses++;
        aliases += taintedAliases(clause).size;
      }
    }
    expect(clauses, "the AST pass found no catch clauses — the parse is dead")
      .toBeGreaterThanOrEqual(6);
    // The POSITIVE counterpart, and the more important of the two: the taint
    // engine must be PROPAGATING on real source, not merely parsing it. A rule
    // that tainted nothing would also report every file clean.
    //
    // The floor is 2, and the two are named so it is not a magic number:
    // `process-key-client.ts`'s `message` and `keys/[id]/permissions`'s
    // `rawMessage`. NEITHER reaches a console sink — which is WHY this roster
    // scores zero offences. The engine is following real aliases on real source
    // and finding them clean; it is not finding nothing.
    expect(
      aliases,
      "the taint engine propagated to zero aliases across the whole roster — " +
        "it is parsing but not following, which reports clean forever",
    ).toBeGreaterThanOrEqual(2);
  });

  it("ignores a banned word that is PROSE inside a message string", () => {
    // `console.error("RPC error:", scrubSeamError(e.message), e.code)` contains
    // the word `error` inside a literal. Reporting that is the
    // prose-defeats-the-guard failure in its other direction — a guard that
    // cries wolf gets widened until it catches nothing.
    const sample =
      'console.error("RPC error:", scrubSeamError(rpcErr.message), rpcErr.code);';
    const code = stripComments(sample);
    const offences: string[] = [];
    for (const call of consoleCalls(code)) {
      offences.push(...bareReferences(call.args, "rpcErr"));
      offences.push(...bareReferences(call.args, "error"));
    }
    expect(offences).toEqual([]);
  });

  it("still sees a bare identifier inside a template INTERPOLATION", () => {
    // Blanking whole template literals would be the opposite mistake: the most
    // natural way to write the banned shape is `${err}` inside a message.
    const sample =
      "try { x(); } catch (err) { console.error(`probe failed: ${err}`); }";
    const code = stripComments(sample);
    const offences: string[] = [];
    for (const call of consoleCalls(code)) {
      for (const identifier of caughtIdentifiers(code)) {
        offences.push(...bareReferences(call.args, identifier));
      }
    }
    expect(offences).toEqual(["err"]);
  });

  it("the scanner survives a `)` inside a string literal", () => {
    // One real site logs `(CT-7)` inside a template literal. Naive paren
    // counting truncates the argument list there and the guard silently stops
    // inspecting the rest of it.
    const sample = 'console.error(`[tag] timed out after ${ms}ms (CT-7)`, err);';
    const calls = consoleCalls(sample);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain("err");
  });

  it("recognises a bare caught identifier when one is present (positive control)", () => {
    // The guard asserts an ABSENCE, so without this the whole file would pass on
    // a scanner that had quietly stopped working. Ledger row M42 is the same
    // shape applied to real source.
    const sample = "try { x(); } catch (err) { console.error('boom:', err); }";
    const code = stripComments(sample);
    const offences: string[] = [];
    for (const call of consoleCalls(code)) {
      for (const identifier of caughtIdentifiers(code)) {
        offences.push(...bareReferences(call.args, identifier));
      }
    }
    expect(offences).toEqual(["err"]);
  });

  it("accepts a scrubbed caught identifier (negative control)", () => {
    const sample =
      "try { x(); } catch (err) { console.error('boom:', scrubSeamError(err, [jwt])); }";
    const code = stripComments(sample);
    const offences: string[] = [];
    for (const call of consoleCalls(code)) {
      for (const identifier of caughtIdentifiers(code)) {
        offences.push(...bareReferences(call.args, identifier));
      }
    }
    expect(offences).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 140.4-09 — THE ALIAS RULE'S NEEDLE SELF-TESTS, IN BOTH POLARITIES.
  //
  // ⚠️ BOTH POLARITIES ARE MANDATORY, and the negative half is the load-bearing
  // one. A positive-only needle measures that the rule fires; it says nothing
  // about whether it fires on everything, and a rule that flags the two REAL
  // shapes below would be "fixed" by weakening it until it caught nothing —
  // which is this file's own stated failure mode. `seam-ssr-exposure.pin.test.ts`
  // states the same discipline at its own needle.
  //
  // Every sample is source TEXT, so each case is the rule applied end-to-end
  // (strip → parse → taint → sink scan) rather than to an internal helper.
  // ───────────────────────────────────────────────────────────────────────────

  /** Run the whole alias pipeline over an in-test source sample. */
  const aliasScan = (sample: string): string[] =>
    aliasOffences("sample.ts", stripComments(sample));

  it("ALIAS +1: `const m = err instanceof Error ? err.message : \"x\"` is flagged", () => {
    // THE `csv-validate` SHAPE, VERBATIM — the one both halves above scored
    // clean, which is the hole this rule exists to close. The `.message` arm of
    // a conditional carries the text; the literal arm is irrelevant.
    expect(
      aliasScan(
        'try { x(); } catch (err) { const m = err instanceof Error ? err.message : "x"; console.error("t:", m); }',
      ),
    ).toHaveLength(1);
  });

  it("ALIAS +2: `const s = String(err)` is flagged", () => {
    expect(
      aliasScan(
        'try { x(); } catch (err) { const s = String(err); console.error("t:", s); }',
      ),
    ).toHaveLength(1);
  });

  it("ALIAS +3: a template interpolation `const s = `boom ${err}`` is flagged", () => {
    expect(
      aliasScan(
        "try { x(); } catch (err) { const s = `boom ${err}`; console.error('t:', s); }",
      ),
    ).toHaveLength(1);
  });

  it("ALIAS +4: a TWO-step chain closes to a fixpoint", () => {
    // `const a = err.message; const b = a;` — one pass would taint `a` and stop,
    // leaving the sink on `b` invisible. The iteration is what closes it.
    expect(
      aliasScan(
        'try { x(); } catch (err) { const a = err.message; const b = a; console.error("t:", b); }',
      ),
    ).toHaveLength(1);
  });

  it("ALIAS +5: `const { message } = err` — the destructured hop — is flagged", () => {
    expect(
      aliasScan(
        'try { x(); } catch (err) { const { message } = err as Error; console.error("t:", message); }',
      ),
    ).toHaveLength(1);
  });

  it("ALIAS −1: `const b = isDeadlineError(err)` is NOT flagged (a BOOLEAN from our own predicate)", () => {
    // ⚠️ A REAL SHAPE: `resilient-fetch.ts` writes this today, twice. A rule
    // that taints on ANY reference reports it, and that is 2 of the 3 false
    // positives the taint-on-any-reference variant produced on this roster.
    expect(
      aliasScan(
        'try { x(); } catch (err) { const b = isDeadlineError(err); console.error("t:", b); }',
      ),
    ).toEqual([]);
  });

  it("ALIAS −2: `readSeamFailureCause(err).retryAfterSeconds` is NOT flagged (a NUMBER on our own type)", () => {
    // ⚠️ THE OTHER REAL SHAPE: `keys/[id]/permissions` writes this today. Note
    // `retryAfterSeconds` is NOT in SAFE_PROPERTIES, so if `f` were tainted this
    // WOULD be reported — the case is decided entirely by the channel property,
    // which is what makes it a meaningful negative rather than a tautology.
    expect(
      aliasScan(
        'try { x(); } catch (err) { const f = readSeamFailureCause(err); console.error("t:", f.retryAfterSeconds); }',
      ),
    ).toEqual([]);
  });

  it("ALIAS −3: a SCRUBBED alias is NOT flagged", () => {
    expect(
      aliasScan(
        'try { x(); } catch (err) { const m = (err as Error).message; console.error("t:", scrubSeamError(m)); }',
      ),
    ).toEqual([]);
  });

  it("ALIAS −4: a comparison is NOT flagged (`===` yields a boolean, not text)", () => {
    expect(
      aliasScan(
        'try { x(); } catch (err) { const isCfg = (err as Error).message === "nope"; console.error("t:", isCfg); }',
      ),
    ).toEqual([]);
  });

  it("ALIAS −5: a same-named binding in an UNRELATED scope is not flagged (scope-awareness)", () => {
    // The scope-blind regex variant produced ~47 false positives, essentially
    // all of them this: a common name like `message` bound somewhere else in
    // the same file. Taint is per-catch-block and so is the sink scan.
    expect(
      aliasScan(
        'function other() { const m = fetchLabel(); console.error("t:", m); }\n' +
          'try { x(); } catch (err) { const q = String(err); console.error("t:", scrubSeamError(q)); }',
      ),
    ).toEqual([]);
  });

  it("ERROR-EXCLUSION +: the errorish half no longer reports the GLOBAL `Error`", () => {
    // `err instanceof Error ? … : …` inside a console call made the errorish
    // regex report a bare `Error` — the global constructor, which carries
    // nothing. Three sites under the widened roster.
    const sample =
      'try { x(); } catch (err) { console.error("t:", err instanceof Error ? scrubSeamError(err) : "x"); }';
    const code = stripComments(sample);
    const errorish = /^(error|[\w$]*(Err|Error))$/;
    const offences: string[] = [];
    for (const call of consoleCalls(code)) {
      for (const name of new Set(
        (maskStrings(call.args).match(/\b[A-Za-z_$][\w$]*\b/g) ?? []).filter(
          (n) =>
            errorish.test(n) &&
            !SCRUBBERS.includes(n) &&
            n !== GLOBAL_ERROR_CONSTRUCTOR,
        ),
      )) {
        offences.push(...bareReferences(call.args, name));
      }
    }
    expect(offences).toEqual([]);
  });

  it("ERROR-EXCLUSION −: a binding named `readError` is STILL flagged (the exclusion is narrow)", () => {
    // Without this, the exclusion could be widened to a pattern — `/Error$/` —
    // and would silently swallow every Supabase binding the errorish half was
    // built for. The exclusion is an EXACT-NAME match, and this is what pins it.
    const sample =
      'const { error: readError } = await q(); console.error("t:", readError);';
    const code = stripComments(sample);
    const errorish = /^(error|[\w$]*(Err|Error))$/;
    const offences: string[] = [];
    for (const call of consoleCalls(code)) {
      for (const name of new Set(
        (maskStrings(call.args).match(/\b[A-Za-z_$][\w$]*\b/g) ?? []).filter(
          (n) =>
            errorish.test(n) &&
            !SCRUBBERS.includes(n) &&
            n !== GLOBAL_ERROR_CONSTRUCTOR,
        ),
      )) {
        offences.push(...bareReferences(call.args, name));
      }
    }
    expect(offences).toEqual(["readError"]);
  });
});
