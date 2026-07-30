import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
            (name) => errorish.test(name) && !SCRUBBERS.includes(name),
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
});
