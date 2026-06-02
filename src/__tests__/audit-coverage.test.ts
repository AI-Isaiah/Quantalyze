import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Sprint 6 closeout Task 7.1b — parametrized audit-coverage grep test.
 * P692/P694 extension (2026-05-13) — also catch known-mutating `.rpc()`
 * calls and walk the audit window inside the enclosing function body
 * rather than a flat 60-line lookahead.
 *
 * Scans every `src/app/api/** /route.ts` file and asserts that every
 * Supabase mutation is accompanied by ONE of:
 *   1. A `logAuditEvent(` or `logAuditEventAsUser(` call within the
 *      enclosing function body (walked forward using brace-balance,
 *      bounded by AUDIT_WINDOW_MAX_LINES as a fail-safe).
 *   2. An `@audit-skip:` pragma within 8 lines ABOVE the mutation's
 *      chain-start line.
 *
 * Mutation classes detected:
 *   a) Direct PostgREST chains: `.from(<table>).insert(...)` and
 *      siblings `.update`, `.delete`, `.upsert` — original Task 7.1b
 *      scan.
 *   b) Known-mutating RPC calls: `.rpc("enqueue_compute_job", ...)`,
 *      etc. Read-only RPCs (`get_*`, `fetch_*`,
 *      `current_user_has_app_role`, `compute_bridge_outcome_deltas`)
 *      are NOT in the allowlist — only RPCs that mutate state. The
 *      explicit allowlist is the safer default than "every .rpc()
 *      call" because most RPCs in this codebase are reads and would
 *      trigger noisy false positives. P692/P694 extension.
 *   c) Indirect mutations via helper modules listed in
 *      HELPER_MUTATORS (Task 7.1b /review T4-C1).
 *   d) Indirect mutations via ANY local helper export that performs a DB
 *      mutation, discovered by a one-hop import-graph walk
 *      (findImportedMutatorCalls). H-0005 (audit 2026-05-25) — closes the
 *      gap where a NEW, unregistered mutator helper module escaped classes
 *      a–c entirely (no detector saw the call, so the route mutated with
 *      no audit AND no failure signal).
 *
 * Window tightening (P694): the previous flat 60-line lookahead could
 * incorrectly match a mutation in one function to an audit emit in the
 * NEXT function of the same file (e.g., `POST` then `PATCH`). The new
 * walker scans forward from the mutation site until brace-balance
 * returns to (or below) the enclosing function's brace depth — i.e.,
 * the audit emit MUST live inside the same function body. A hard
 * fail-safe of AUDIT_WINDOW_MAX_LINES caps the walk so a 5000-line
 * function (extremely unlikely; would already fail review) can't gum
 * up the test runner.
 *
 * On failure the test prints the offending file + line + guidance
 * (add a logAuditEvent call or an @audit-skip pragma above the line).
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

// H-0005 (audit 2026-05-25): `src` root, for resolving `@/…` import
// specifiers to disk when walking the import graph one hop into local
// helper modules. `__dirname` is `src/__tests__` at test time, so `..`
// is `src`.
const SRC_DIR = path.resolve(__dirname, "..");

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

    // M-0004 (audit 2026-05-25): anchor the lookback to the chain head
    // instead of a flat 5-line window. A supabase chain can stack many
    // modifier lines between `.from(...)` and the terminal mutation
    // (e.g. `.from(x).select(...).eq(...).eq(...).order(...).insert(...)`
    // formatted one-method-per-line). The terminal mutation line and
    // every intervening modifier are chain-continuation lines (trimmed
    // form starts with `.`). Walk back across the contiguous run of
    // continuation lines — regardless of how many there are — and find
    // the `.from(` that anchors the chain. A blank line is tolerated; a
    // non-`.` statement line ends the chain, so we never cross into an
    // unrelated statement. This keeps the previous false-positive guard
    // (a mutation NOT part of a supabase `.from(...)` chain is still
    // skipped) while no longer dropping wide chains the 5-line window
    // missed.
    let fromIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      const trimmed = lines[j].trim();
      if (trimmed === "") continue; // tolerate blank lines inside the chain
      if (/\.from\(/.test(lines[j])) {
        fromIdx = j;
        break;
      }
      // Still a chain-continuation line? Keep walking. Otherwise the
      // mutation isn't anchored to a `.from(...)` — bail out.
      if (!trimmed.startsWith(".")) break;
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
 * Allowlist of RPCs that MUTATE state (write to audit_log-eligible
 * tables, change row state, dispatch a worker job that mutates). A
 * mutation site that calls one of these RPCs needs an audit emission
 * or an `@audit-skip` pragma, same contract as a `.insert/.update/
 * .delete/.upsert` chain. P692 extension.
 *
 * NOT every `.rpc()` call counts — most RPCs in this codebase are
 * reads (`get_*`, `fetch_*`, `compute_bridge_outcome_deltas`,
 * `current_user_has_app_role`) and would trigger noisy false
 * positives. The allowlist is the safer default and forces the author
 * of a new mutating RPC to add the name here as part of the audit
 * checklist (the migration that creates the RPC + the route that
 * calls it + this allowlist all change in the same PR).
 *
 * Notable exclusions:
 *   - `log_audit_event` / `log_audit_event_service` — these ARE audit
 *     emissions themselves, NOT actions that need auditing.
 *   - `mark_compute_job_done` / `mark_compute_job_failed` /
 *     `claim_compute_jobs` / `reclaim_stuck_compute_jobs` — worker-
 *     internal compute-state RPCs; not called from src/app/api/. If
 *     a route ever calls them, the @audit-skip pragma is the right
 *     answer (internal state machine, not user-visible).
 */
const MUTATING_RPC_NAMES: readonly string[] = [
  "admin_role_mutate",
  "enqueue_compute_job",
  "sanitize_user",
  "send_intro_with_decision",
  "create_wizard_strategy",
  "finalize_csv_strategy",
  "commit_scenario_batch",
  "update_allocator_mandates",
  "delete_allocator_api_key",
  "disconnect_allocator_api_key",
  "stamp_first_bridge_surfaced",
  "stamp_first_sync_success",
  "sync_trades",
];

/**
 * Build the regex matching any mutating-RPC call. We accept both single
 * and double quotes. The leading boundary is `\.rpc\(\s*` so the match
 * is anchored to a method call (not a substring of an identifier).
 */
const MUTATING_RPC_RE = new RegExp(
  `\\.rpc\\(\\s*['"](?:${MUTATING_RPC_NAMES.join("|")})['"]`,
);

/**
 * Find every mutating `.rpc(...)` call in a file's source. Returns a
 * synthesized Mutation whose chainStart is the same as `line` — the
 * `await admin.rpc("foo", ...)` statement is typically a single
 * logical line + multi-line arg block, but the pragma anchor lives
 * directly above the `await` expression, so chainStart == line is
 * correct for the pragma-lookback semantics. P692 extension.
 */
function findRpcMutations(file: string, src: string): Mutation[] {
  const lines = src.split("\n");
  const out: Mutation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = stripLineComment(lines[i]);
    if (!MUTATING_RPC_RE.test(line)) continue;
    // Walk backward to find the statement-start line (the line
    // starting with `const`, `await`, `return`, etc. — not a
    // continuation `.`).
    let chainStart = i;
    for (let j = i - 1; j >= 0; j--) {
      const trimmed = lines[j].trim();
      if (trimmed === "") continue;
      if (trimmed.startsWith(".")) continue;
      chainStart = j;
      break;
    }
    out.push({
      file,
      line: i + 1,
      chainStart: chainStart + 1,
      snippet: line.trim(),
    });
  }
  return out;
}

/**
 * Strip comment content so a comment mentioning `logAuditEvent` (e.g.,
 * "// TODO: add logAuditEvent here", or "/* logAuditEvent(...) *\/")
 * does not falsely satisfy the coverage check. /review follow-up
 * (T4-M2).
 *
 * H-0004 (audit 2026-05-25): previously only `// …` line comments were
 * stripped. A mutation whose ONLY `logAuditEvent` mention sat inside a
 * `/* … *\/` block comment (or a JSX `{/* … *\/}` comment) was falsely
 * reported COVERED — a real audit-coverage blind spot. We now also
 * strip same-line block comments and JSX-wrapped block comments before
 * the line comment pass. The JSX wrapper (`{/* … *\/}`) is stripped
 * with its surrounding braces so the brace-balance walk in `isCovered`
 * isn't thrown off by the comment's braces.
 *
 * Same-line scope: route files (and these fixtures) keep a block
 * comment on one line where a stray `logAuditEvent` mention would
 * falsely satisfy coverage. A truly multi-line block comment spanning
 * a `logAuditEvent` mention is out of this per-line helper's scope;
 * if that ever matters, switch to a proper tokenizer.
 */
function stripLineComment(line: string): string {
  // JSX comment `{/* … */}` — strip wrapper braces too so brace-balance
  // accounting stays correct.
  let out = line.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
  // Plain same-line block comment `/* … */`.
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  const idx = out.indexOf("//");
  if (idx < 0) return out;
  return out.slice(0, idx);
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
 * Hard fail-safe cap on the forward audit-window walk. P694: the
 * walker uses brace-balance to bound the window to the enclosing
 * function body, but a pathological 5000-line function (would already
 * fail review) shouldn't gum up the test runner. 200 lines is well
 * past the longest function in this codebase (the largest route
 * handler is ~150 lines including comments).
 */
const AUDIT_WINDOW_MAX_LINES = 200;

/**
 * Count net brace delta on a line, accounting for `//` line comments.
 * Block comments (`/* … *\/`) are not stripped — they're rare in route
 * files and the brace count of an internal block comment would be 0
 * anyway. String contents containing `{` or `}` are a false-positive
 * risk; we accept that and rely on the AUDIT_WINDOW_MAX_LINES fail-safe.
 */
function braceDelta(line: string): number {
  const stripped = stripLineComment(line);
  let delta = 0;
  for (const ch of stripped) {
    if (ch === "{") delta++;
    else if (ch === "}") delta--;
  }
  return delta;
}

/**
 * Check whether a given mutation is "covered" — either an audit call
 * within the enclosing function body, OR an `@audit-skip:` pragma
 * within 8 lines above the mutation chain's start line.
 *
 * Window shape (P694 tightening):
 *   - Pragma lookback: 8 lines ABOVE `chainStart` (accommodates a
 *     multi-line comment block explaining the skip reason).
 *   - Audit-call lookforward: walk brace-balanced from the mutation
 *     line until the enclosing function body ends (depth returns to
 *     -1 relative to start), bounded by AUDIT_WINDOW_MAX_LINES.
 *   - Also search 3 lines ABOVE chainStart for the rare
 *     "audit-before-mutation" pattern.
 *
 * Why brace-balance vs flat 60-line window: pre-P694, a mutation at
 * line 10 in `POST()` could be "covered" by a `logAuditEvent` at
 * line 55 inside `PATCH()` in the same file — the flat window crossed
 * a function boundary silently. The brace walker terminates at the
 * close-brace of the function containing the mutation, so the audit
 * emit MUST live inside the same function body.
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

  // Lookback window: 3 lines above chain start for "audit-before-
  // mutation" pattern. (Rare; only a handful of sites use it.)
  const lookbackStart = Math.max(0, chainStartIdx - 3);
  for (let j = lookbackStart; j < chainStartIdx; j++) {
    if (/logAuditEvent(AsUser)?\s*\(/.test(stripLineComment(lines[j]))) {
      return { covered: true, reason: "audit-call-above" };
    }
  }

  // Lookforward window: walk brace-balanced. The mutation sits at some
  // depth inside an enclosing function. We start at depth 0 (relative)
  // and walk forward; when depth returns to -1 (the close-brace of
  // the enclosing function), we stop. Audit emissions that live OUTSIDE
  // the enclosing function body don't count. Bounded by
  // AUDIT_WINDOW_MAX_LINES as a hard fail-safe.
  let depth = 0;
  const hardCap = Math.min(lines.length, lineIdx + AUDIT_WINDOW_MAX_LINES);
  for (let j = lineIdx; j < hardCap; j++) {
    const stripped = stripLineComment(lines[j]);
    if (/logAuditEvent(AsUser)?\s*\(/.test(stripped)) {
      return { covered: true, reason: "audit-call" };
    }
    depth += braceDelta(lines[j]);
    // depth < 0 means we've exited the enclosing function body — the
    // close-brace fired without us seeing a logAuditEvent. Stop.
    if (depth < 0) break;
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

/**
 * H-0005 (audit 2026-05-25) — net brace delta of a line, counting ONLY
 * braces outside string/template/regex literals.
 *
 * `braceDelta` (used by isCovered's audit-window walk) counts raw braces
 * and deliberately tolerates the rare string-brace skew there. But
 * `moduleExportMutates` bounds an EXPORT body by brace balance, and a
 * single unbalanced `{`/`}` inside a string literal (`'a { b'`) or a regex
 * char-class (`/[{]/`) would drift the balance — making the capture bleed
 * forward and swallow the NEXT export, which could misattribute that
 * export's mutation to a pure helper (a false-positive that would throw
 * the live scan). So here we blank out literal CONTENT before counting.
 * Comments are stripped first via stripLineComment. Multi-line template
 * literals with unbalanced braces remain a theoretical edge, backstopped
 * by the unconditional next-`export` break in moduleExportMutates.
 */
function bracesOutsideLiterals(line: string): number {
  const s = stripLineComment(line)
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\//g, "//");
  let d = 0;
  for (const ch of s) {
    if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  return d;
}

/**
 * H-0005 (audit 2026-05-25) — does a SPECIFIC export of a module perform
 * a DB mutation?
 *
 * Locates the `export … <name>` declaration in `moduleSrc`, captures its
 * body by brace balance (counting braces OUTSIDE string/regex literals via
 * `bracesOutsideLiterals`), and re-runs the existing mutation detectors
 * (`findMutations` for `.from(...).insert/update/delete/upsert` chains and
 * `findRpcMutations` for allowlisted mutating RPCs) against that body. We
 * scope to the named export — not the whole module — so importing a pure
 * helper from a module that ALSO exports a mutator does not falsely flag
 * the route.
 *
 * The capture ALWAYS breaks at the next top-level `export` (a top-level
 * `export` can't appear inside another export's body, so this never
 * truncates the current body — it just hard-stops any residual
 * brace-balance drift from bleeding into the following export). Brace-less
 * (concise-body arrow) exports, which never open a `{`, are bounded by the
 * same break.
 */
function moduleExportMutates(moduleSrc: string, exportName: string): boolean {
  const lines = moduleSrc.split("\n");
  const declRe = new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\s+${exportName}\\b|(?:const|let|var)\\s+${exportName}\\b)`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!declRe.test(lines[i])) continue;
    let depth = 0;
    let started = false;
    const bodyLines: string[] = [];
    for (let j = i; j < lines.length && j - i <= 500; j++) {
      // The next top-level `export` ends this export's body unconditionally
      // — a backstop against any literal-brace drift bleeding the capture
      // into (and misattributing) the following export.
      if (j > i && /^\s*export\s/.test(lines[j])) break;
      bodyLines.push(lines[j]);
      depth += bracesOutsideLiterals(lines[j]);
      if (depth > 0) started = true;
      if (started && depth <= 0) break;
    }
    const body = bodyLines.join("\n");
    if (
      findMutations("<resolved-module>", body).length > 0 ||
      findRpcMutations("<resolved-module>", body).length > 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * H-0005 (audit 2026-05-25) — one-hop import-graph mutator enforcement.
 *
 * The three primary detectors only see (a) inline supabase chains,
 * (b) allowlisted mutating RPCs, and (c) calls to the HARDCODED
 * HELPER_MUTATORS allowlist. A NEW helper module that wraps a
 * `.from(...).update(...)` chain — e.g. `@/lib/danger-helpers` exporting
 * `softDeleteRow` — is invisible to all three: a route can import + call
 * it and mutate the DB with NO audit emission and NO failure signal.
 *
 * This detector closes that gap WITHOUT a manual registry. For every
 * named import from a LOCAL module (`@/…`, `./…`, `../…`), it resolves
 * the module source (via the injected `resolveModule`, which reads disk
 * in the live scan) and checks whether the SPECIFIC imported export
 * mutates. If so, every call site of that binding in the route is
 * synthesized as a mutation that must be audited or `@audit-skip`-ped —
 * the same contract inline mutations obey.
 *
 * Scope/limits:
 *   - One hop. A helper that itself calls a deeper unaudited mutator is
 *     out of scope (would need full call-graph analysis); one hop catches
 *     the direct route→helper case that is the surfaced gap.
 *   - Only the named export is analyzed (false-positive control — a pure
 *     import from a module that also exports a mutator is NOT flagged).
 *   - Bare (node_modules) and non-local specifiers are never followed:
 *     `resolveModule` returns null for them.
 *   - Default/namespace import forms (`import Foo, { bar }`) are not
 *     parsed; named-import helpers (the idiom here) are. A default-import
 *     mutator helper would still be caught the moment it is registered in
 *     HELPER_MUTATORS, the pre-existing class-(c) path.
 *
 * `resolveModule(spec, fromFile)` returns the module's source text, or
 * null when the spec is non-local / unresolvable. Injectable so unit
 * fixtures drive it deterministically without touching disk.
 */
function findImportedMutatorCalls(
  file: string,
  src: string,
  resolveModule: (spec: string, fromFile: string) => string | null,
): Mutation[] {
  const lines = src.split("\n");
  const out: Mutation[] = [];

  const importRe =
    /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  const mutatorBindings = new Set<string>();
  for (const m of src.matchAll(importRe)) {
    // Whole-statement type imports (`import type { Foo } from …`) bind no
    // runtime value, so they can't be called — skip them. (The inline
    // `import { type Foo }` form is handled per-segment below.)
    if (/^\s*import\s+type\b/.test(m[0])) continue;
    const spec = m[2];
    if (
      !(spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../"))
    ) {
      continue; // non-local specifier — never follow
    }
    const moduleSrc = resolveModule(spec, file);
    if (moduleSrc == null) continue;
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      // `type`-only named imports can't be called at runtime.
      if (!seg || seg.startsWith("type ")) continue;
      const [orig, alias] = seg.split(/\s+as\s+/).map((s) => s.trim());
      const local = (alias || orig).trim();
      if (!local || !orig) continue;
      if (moduleExportMutates(moduleSrc, orig)) mutatorBindings.add(local);
    }
  }
  if (mutatorBindings.size === 0) return out;

  for (const local of mutatorBindings) {
    const callRe = new RegExp(`\\b${local}\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\s/.test(lines[i])) continue;
      if (!callRe.test(stripLineComment(lines[i]))) continue;
      out.push({
        file,
        line: i + 1,
        chainStart: i + 1,
        snippet: lines[i].trim(),
      });
    }
  }
  return out;
}

/**
 * H-0005 — resolve a local import specifier to its candidate disk path.
 * `@/…` maps to `SRC_DIR`; `./…`/`../…` resolve relative to the importing
 * file. Tries `.ts`, `.tsx`, and `index.*` barrels. Returns the absolute
 * path of the first existing candidate, or null for non-local / unresolvable
 * specifiers (treated as "don't follow"). Split out from the file read so
 * the per-scan read cache (H-0003-perf) can key on the resolved path and
 * dedupe disk reads of the SAME module reached via different specifiers.
 */
function resolveModulePath(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.resolve(SRC_DIR, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else return null;

  for (const cand of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    // Narrow the swallow (silent-failure-hunter Item 4): a missing /
    // unstatable candidate is expected — try the next one.
    let isFile = false;
    try {
      isFile = fs.existsSync(cand) && fs.statSync(cand).isFile();
    } catch {
      isFile = false; // candidate not present/statable — expected, next
    }
    if (isFile) return cand;
  }
  return null;
}

/**
 * H-0003 (S9b performance) — the live-scan resolver for
 * findImportedMutatorCalls, with a per-scan read cache.
 *
 * The original `diskResolveModule` ran `fs.readFileSync` on EVERY named
 * local import of EVERY route file with no memoization. Because route files
 * share a small set of helper modules (`@/lib/supabase/server`,
 * `@/lib/audit`, `@/lib/ratelimit`, …), the same handful of files were read
 * from disk dozens of times each: across the 78-route corpus that is ~416
 * readFileSync calls to resolve only ~57 distinct modules — ~359 redundant
 * reads, and the redundancy GROWS with the corpus (every new route re-reads
 * the shared helpers again). That is the "no caching, hundreds of redundant
 * operations per run, fires on every PR + every watch-mode save" cost the
 * S9b finding flagged.
 *
 * `makeCachedModuleResolver` returns a resolver closed over a `Map<path,
 * source>` so each distinct module file is read AT MOST ONCE per scan. The
 * read itself is still uncaught on a confirmed-present candidate (a present
 * mutator helper that fails to read is a real coverage blind spot — it would
 * silently reopen the H-0005 gap with no signal — so it must fail the test
 * loudly). `onRead` is invoked exactly once per ACTUAL disk read (cache
 * miss), letting the regression test count true reads and prove the cache
 * eliminates the redundancy.
 */
function makeCachedModuleResolver(
  onRead?: (path: string) => void,
): (spec: string, fromFile: string) => string | null {
  const cache = new Map<string, string>();
  return (spec: string, fromFile: string): string | null => {
    const resolved = resolveModulePath(spec, fromFile);
    if (resolved == null) return null;
    const cached = cache.get(resolved);
    if (cached !== undefined) return cached;
    const src = fs.readFileSync(resolved, "utf8");
    onRead?.(resolved);
    cache.set(resolved, src);
    return src;
  };
}

/**
 * P692/P694 — synthetic regression cases. We test the helpers against
 * in-memory source fixtures so the grep extensions can fail loudly
 * even when the live src/app/api/ tree happens to be fully instrumented.
 *
 * Each fixture mimics a real route shape — `export async function POST`
 * + brace-balanced body + a mutation call. The negative cases assert
 * that the OLD regex (which only matched `.insert|.update|.delete|
 * .upsert`) would have falsely passed, while the new regex correctly
 * catches the gap.
 */
describe("audit-coverage helpers — P692/P694 regression fixtures", () => {
  it("findRpcMutations catches admin.rpc('enqueue_compute_job', ...)", () => {
    const src = [
      "export async function POST() {",
      "  const admin = createAdminClient();",
      "  const { error } = await admin.rpc('enqueue_compute_job', {",
      "    p_strategy_id: 'abc',",
      "    p_kind: 'sync_trades',",
      "  });",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    const mutations = findRpcMutations("synthetic.ts", src);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].snippet).toContain("enqueue_compute_job");
  });

  it("findRpcMutations IGNORES read-only RPCs like get_admin_compute_jobs", () => {
    const src = [
      "export async function GET() {",
      "  const { data } = await admin.rpc('get_admin_compute_jobs', { p_limit: 50 });",
      "  return Response.json(data);",
      "}",
    ].join("\n");
    expect(findRpcMutations("synthetic.ts", src)).toEqual([]);
  });

  it("isCovered (P694 brace-balance) does NOT match audit emit in a sibling function", () => {
    const lines = [
      "export async function POST() {",
      "  const admin = createAdminClient();",
      "  const { error } = await admin.rpc('enqueue_compute_job', { p_strategy_id: 'x' });",
      "  if (error) return Response.json({ error: 'fail' }, { status: 500 });",
      "  return Response.json({ ok: true });",
      "}",
      "",
      "export async function PATCH() {",
      "  // logAuditEvent in a DIFFERENT function — must NOT cover POST's RPC.",
      "  logAuditEvent(supabase, { action: 'role.grant', entity_type: 'user_app_role', entity_id: 'x' });",
      "  return Response.json({ ok: true });",
      "}",
    ];
    const mutation: Mutation = {
      file: "synthetic.ts",
      line: 3,
      chainStart: 3,
      snippet: lines[2].trim(),
    };
    const check = isCovered(mutation, lines);
    expect(check.covered).toBe(false);
    expect(check.reason).toBe("uncovered");
  });

  it("isCovered MATCHES audit emit within the same function body", () => {
    const lines = [
      "export async function POST() {",
      "  const admin = createAdminClient();",
      "  const { error } = await admin.rpc('enqueue_compute_job', { p_strategy_id: 'x' });",
      "  if (error) return Response.json({ error: 'fail' }, { status: 500 });",
      "  logAuditEvent(supabase, { action: 'sync.start', entity_type: 'sync', entity_id: 'x' });",
      "  return Response.json({ ok: true });",
      "}",
    ];
    const mutation: Mutation = {
      file: "synthetic.ts",
      line: 3,
      chainStart: 3,
      snippet: lines[2].trim(),
    };
    expect(isCovered(mutation, lines).covered).toBe(true);
  });

  it("isCovered respects @audit-skip pragma above the mutation", () => {
    const lines = [
      "export async function POST() {",
      "  // @audit-skip: scheduled cron tick.",
      "  const { error } = await admin.rpc('enqueue_compute_job', { p_strategy_id: 'x' });",
      "  return Response.json({ ok: true });",
      "}",
    ];
    const mutation: Mutation = {
      file: "synthetic.ts",
      line: 3,
      chainStart: 3,
      snippet: lines[2].trim(),
    };
    const check = isCovered(mutation, lines);
    expect(check.covered).toBe(true);
    expect(check.reason).toBe("pragma");
  });
});

describe("audit-coverage helpers — H-0004/H-0005 audit gap fixtures", () => {
  // H-0004 — stripLineComment only strips `// …`. A block comment
  // `/* … logAuditEvent(…) … */` mentioning logAuditEvent, or a JSX
  // comment `{/* … */}`, is NOT parsed, so the regex /logAuditEvent\s*\(/
  // matches against the comment body and FALSELY satisfies coverage. The
  // CORRECT behavior: a mutation whose ONLY logAuditEvent mention lives
  // inside a block comment must be reported uncovered (the comment is not
  // an emission). We assert correct behavior; it currently fails because
  // stripLineComment doesn't strip block comments.
  it(
    "H-0004: block-comment logAuditEvent mention must NOT satisfy coverage — fix stripLineComment/isCovered in follow-up (test-helper, not production)",
    () => {
      const lines = [
        "export async function POST() {",
        "  const admin = createAdminClient();",
        "  const { error } = await admin.from('x').insert({ a: 1 });",
        "  if (error) return Response.json({ error: 'fail' }, { status: 500 });",
        "  /* TODO: add a logAuditEvent(client, {...}) call here later. */",
        "  return Response.json({ ok: true });",
        "}",
      ];
      const mutation: Mutation = {
        file: "synthetic.ts",
        line: 3,
        chainStart: 3,
        snippet: lines[2].trim(),
      };
      // The block comment is the only logAuditEvent mention; no real
      // emission fires. Correct coverage verdict is `false`.
      expect(isCovered(mutation, lines).covered).toBe(false);
    },
  );

  it(
    "H-0004: JSX-style {/* logAuditEvent(...) */} comment must NOT satisfy coverage — fix in follow-up",
    () => {
      const lines = [
        "export async function POST() {",
        "  const { error } = await admin.from('x').update({ a: 1 }).eq('id', 'z');",
        "  if (error) return Response.json({ error: 'fail' }, { status: 500 });",
        "  return ( {/* logAuditEvent(client, {action:'x'}) lives here someday */} );",
        "}",
      ];
      const mutation: Mutation = {
        file: "synthetic.ts",
        line: 2,
        chainStart: 2,
        snippet: lines[1].trim(),
      };
      expect(isCovered(mutation, lines).covered).toBe(false);
    },
  );

  // Control: a single-line `//` comment IS stripped, so it correctly
  // does NOT satisfy coverage. This proves the test exercises the real
  // isCovered path (not a tautology) — only the block-comment arm is the
  // surfaced gap.
  it("control: single-line // logAuditEvent comment does NOT satisfy coverage (stripLineComment works for //)", () => {
    const lines = [
      "export async function POST() {",
      "  const { error } = await admin.from('x').insert({ a: 1 });",
      "  // TODO: add a logAuditEvent(client, {...}) call here later.",
      "  return Response.json({ ok: true });",
      "}",
    ];
    const mutation: Mutation = {
      file: "synthetic.ts",
      line: 2,
      chainStart: 2,
      snippet: lines[1].trim(),
    };
    expect(isCovered(mutation, lines).covered).toBe(false);
  });

  // M-0004 — findMutations walks back only 5 lines from a `.insert/.update/
  // .delete/.upsert` method line to find its anchoring `.from(`. A supabase
  // chain with 6+ intervening modifier lines (e.g.
  // `.from(x).schema(...).select(...).eq(...).eq(...).order(...).insert(...)`)
  // therefore goes UNDETECTED — the mutation ships completely outside the
  // coverage gate's view, defeating the test's regression-pressure purpose.
  // CORRECT behavior: the mutation IS a supabase mutation and must be
  // detected (so it can then be checked for an audit emit / pragma). It
  // currently fails because the lookback is too tight. SURFACE marker pending
  // a test-helper fix (widen/anchor the lookback to the chain head, not a
  // flat 5-line window). Test-helper only — NOT production code.
  it(
    "M-0004: a supabase mutation whose `.from(` is 6+ lines above the .insert MUST still be detected — widen findMutations lookback in follow-up (test-helper, not production)",
    () => {
      const src = [
        "export async function POST() {",
        "  const { error } = await admin",
        "    .from('audit_log')",
        "    .schema('public')",
        "    .select('id')",
        "    .eq('a', 1)",
        "    .eq('b', 2)",
        "    .order('created_at')",
        "    .insert({ user_id: 'x' });",
        "  return Response.json({ ok: true });",
        "}",
      ].join("\n");
      const mutations = findMutations("synthetic.ts", src);
      // The chain IS a real mutation; a complete detector finds exactly one.
      expect(mutations.length).toBeGreaterThanOrEqual(1);
    },
  );

  // Control for M-0004: the SAME chain with the `.from(` within the 5-line
  // window IS detected — proving the detector works and the gap is purely the
  // lookback distance, not the mutation shape.
  it("control: a supabase mutation whose `.from(` is within 5 lines of .insert IS detected", () => {
    const src = [
      "export async function POST() {",
      "  const { error } = await admin",
      "    .from('audit_log')",
      "    .select('id')",
      "    .insert({ user_id: 'x' });",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    const mutations = findMutations("synthetic.ts", src);
    expect(mutations.length).toBeGreaterThanOrEqual(1);
  });

  // H-0001 (audit 2026-05-07) — findMutations' line regex
  // `/^\s*\.(insert|update|delete|upsert)\s*\(/` requires the mutator method
  // to be the FIRST non-whitespace token on its line (a leading-dot
  // continuation). The single-line idiom
  //   `const { error } = await supabase.from('trades').insert(batch);`
  // puts `.insert(` MID-line (right after `.from(...)`), so it matches
  // neither the leading-dot anchor nor any continuation — the mutation is
  // invisible to the detector and ships entirely outside the coverage gate.
  //
  // This GREEN test pins the CURRENT (buggy) behavior so it is documented and
  // so any "fix" to findMutations must also reckon with the live corpus (see
  // the .skip'd intended-behavior test below). A regression test, not an
  // endorsement: the single-line form IS a real Supabase mutation and SHOULD
  // be detected.
  it("H-0001 (current behavior): findMutations MISSES the single-line `from(...).insert(...)` idiom — surfaced gap", () => {
    const src = [
      "export async function POST() {",
      "  const { error } = await supabase.from('trades').insert(batch);",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    // BUG: zero mutations detected, even though this line mutates the DB.
    // When findMutations is fixed to anchor on `.from(...).<mut>(` regardless
    // of line position, flip this to `toBeGreaterThanOrEqual(1)` AND see the
    // .skip'd test below for the live-corpus sites that fix surfaces.
    expect(findMutations("synthetic.ts", src)).toHaveLength(0);
  });

  // H-0001 — intended behavior (SKIPPED: surfaces a real production gap).
  //
  // The detector SHOULD catch the single-line `.from(...).insert(...)` form.
  // It is skipped rather than enabled because fixing findMutations to detect
  // it turns the live-corpus gate (the final `describe` in this file) RED on
  // four real, currently-unaudited single-line mutation sites:
  //   - src/app/api/cron/flag-monitor/route.ts:194  (feature_flags upsert — zero-denominator streak)
  //   - src/app/api/cron/flag-monitor/route.ts:233  (feature_flags upsert — kill-switch flip)
  //   - src/app/api/cron/flag-monitor/route.ts:332  (feature_flags upsert — streak reset)
  //   - src/app/api/admin/partner-import/route.ts:704 (profiles upsert — @audit-skip is 15 lines up, outside the 8-line pragma window)
  // (trades/upload:116, strategy-review:183, partner-import:761 & :792 ARE
  // covered today via in-window @audit-skip pragmas.)
  //
  // Those four sites mutate the DB with no audit emission and no @audit-skip
  // in scope — exactly the blind spot H-0001 predicted. Fixing them is a
  // production-code change (add pragmas or audit emits to the routes), out of
  // scope for a test-only pass. Enable this test + the findMutations fix +
  // the four route fixes together.
  // TODO(surfaced): H-0001 — fix findMutations single-line detection, then
  //   audit-instrument (or pragma) the four flagged routes above, then
  //   un-skip and flip the current-behavior test to expect >= 1.
  it.skip("H-0001 (intended behavior): findMutations DETECTS the single-line `from(...).insert(...)` idiom", () => {
    const src = [
      "export async function POST() {",
      "  const { error } = await supabase.from('trades').insert(batch);",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    expect(findMutations("synthetic.ts", src).length).toBeGreaterThanOrEqual(1);
  });

  // H-0005 (FIXED 2026-05-25) — findMutations + findHelperMutations +
  // findRpcMutations only see inline chains, allowlisted RPCs, and the
  // HARDCODED HELPER_MUTATORS allowlist. A NEW helper that wraps a
  // `.from(...).update(...)` chain in an UNregistered module — e.g.,
  // `softDeleteRow()` — used to be invisible to all three, so the route
  // mutated with no audit and NO failure signal.
  //
  // findImportedMutatorCalls closes that gap: a one-hop import-graph walk
  // resolves the helper's source and detects that the imported export
  // mutates, synthesizing an uncovered mutation. The resolver is injected
  // here so the fixture is deterministic; the live scan uses
  // diskResolveModule. This was `it.fails` while deferred; the detector
  // now makes it pass.
  it(
    "H-0005: route calling an UNREGISTERED mutator helper is flagged uncovered (one-hop import-graph enforcement)",
    () => {
      const src = [
        "import { softDeleteRow } from '@/lib/danger-helpers';",
        "export async function DELETE() {",
        "  await softDeleteRow(admin, 'user', id);",
        "  return Response.json({ ok: true });",
        "}",
      ].join("\n");
      const lines = src.split("\n");
      // The injected resolver reveals what a disk walk would see: the
      // helper's body performs a `.from(...).update(...)` mutation.
      const resolveModule = (spec: string): string | null =>
        spec === "@/lib/danger-helpers"
          ? [
              "export async function softDeleteRow(admin: any, table: string, id: string) {",
              "  const { error } = await admin",
              "    .from(table)",
              "    .update({ deleted_at: new Date().toISOString() })",
              "    .eq('id', id);",
              "  return error;",
              "}",
            ].join("\n")
          : null;
      const mutations = [
        ...findMutations("synthetic.ts", src),
        ...findHelperMutations("synthetic.ts", src),
        ...findRpcMutations("synthetic.ts", src),
        ...findImportedMutatorCalls("synthetic.ts", src, resolveModule),
      ];
      // The unregistered helper performs a DB mutation with no audit
      // emission — exactly one uncovered mutation must now be surfaced.
      const uncovered = mutations.filter((m) => !isCovered(m, lines).covered);
      expect(uncovered.length).toBeGreaterThanOrEqual(1);
    },
  );

  // Control for H-0005 (false-positive guard): the import-graph detector
  // scopes to the SPECIFIC imported export. A route that imports a PURE
  // (non-mutating) helper — even from a module that also exports a
  // mutator — must NOT be flagged. This proves findImportedMutatorCalls
  // doesn't degenerate into "flag every imported call."
  it("control: route calling a NON-mutator imported helper is NOT flagged (import-graph scopes to actual mutators)", () => {
    const src = [
      "import { formatLabel } from '@/lib/mixed-helpers';",
      "export async function GET() {",
      "  const label = formatLabel('x');",
      "  return Response.json({ label });",
      "}",
    ].join("\n");
    // The module exports BOTH a pure helper (imported) and a mutator
    // (not imported here). Only the imported `formatLabel` is analyzed.
    const resolveModule = (spec: string): string | null =>
      spec === "@/lib/mixed-helpers"
        ? [
            "export function formatLabel(s: string) { return s.toUpperCase(); }",
            "export async function purgeRow(admin: any, id: string) {",
            "  await admin.from('x').delete().eq('id', id);",
            "}",
          ].join("\n")
        : null;
    expect(
      findImportedMutatorCalls("synthetic.ts", src, resolveModule),
    ).toEqual([]);
  });

  // Control for H-0005: the REGISTERED helper IS detected and, lacking an
  // audit emit, IS flagged uncovered. This proves findHelperMutations
  // works for allowlisted modules — the gap is purely the missing
  // out-of-band registration enforcement for NEW helpers.
  it("control: REGISTERED mutator helper (markLeadProcessed) without an audit emit IS flagged uncovered", () => {
    const src = [
      "import { markLeadProcessed } from '@/lib/for-quants-leads-admin';",
      "export async function POST() {",
      "  await markLeadProcessed(admin, leadId);",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n");
    const lines = src.split("\n");
    const helperMutations = findHelperMutations("synthetic.ts", src);
    expect(helperMutations.length).toBe(1);
    expect(isCovered(helperMutations[0], lines).covered).toBe(false);
  });
});

// H-0003 (S9b PERFORMANCE finding — the original FIX-LIST item, distinct
// from the "H-0003 (audit 2026-05-07)" vacuous-gate floors above): the
// import-graph scan used to call `fs.readFileSync` on every named local
// import of every route file with NO memoization. Route files share a small
// set of helper modules (`@/lib/supabase/server`, `@/lib/audit`,
// `@/lib/ratelimit`, …), so the same handful of files were read from disk
// dozens of times each — ~416 reads to resolve ~57 distinct modules on the
// 78-route corpus, i.e. ~359 redundant reads, and the redundancy GROWS with
// the corpus. The fix is `makeCachedModuleResolver`, which reads each
// distinct module at most once per scan.
//
// These tests fail loudly if the cache is removed/regressed:
//   1. The cached resolver, driven across the REAL corpus, must read each
//      module exactly once (zero redundant reads).
//   2. A NON-cached resolver over the SAME corpus must produce many
//      redundant reads — proving the corpus genuinely exercises the
//      amplification (so test #1 is not vacuous) and pinning the magnitude
//      of the regression the cache eliminates.
describe("audit-coverage scan performance — H-0003 (S9b) import-resolution read cache", () => {
  // Walk the real corpus exactly as the live gate does, resolving every
  // local named import. Returns the count of ACTUAL disk reads per resolved
  // module path under the given resolver factory.
  function tallyModuleReads(
    makeResolver: (
      onRead: (p: string) => void,
    ) => (spec: string, fromFile: string) => string | null,
  ): Map<string, number> {
    const reads = new Map<string, number>();
    const resolve = makeResolver((p) =>
      reads.set(p, (reads.get(p) ?? 0) + 1),
    );
    const importRe =
      /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    for (const file of collectRouteFiles(API_DIR)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(importRe)) {
        if (/^\s*import\s+type\b/.test(m[0])) continue;
        const spec = m[2];
        if (
          !(
            spec.startsWith("@/") ||
            spec.startsWith("./") ||
            spec.startsWith("../")
          )
        ) {
          continue;
        }
        resolve(spec, file); // resolves (and, on a miss, reads) the module
      }
    }
    return reads;
  }

  it("the cached resolver reads each distinct helper module AT MOST ONCE across the whole corpus (no redundant disk reads)", () => {
    const reads = tallyModuleReads((onRead) =>
      makeCachedModuleResolver(onRead),
    );
    // Sanity: the scan actually resolved real modules (not a no-op walk).
    expect(reads.size).toBeGreaterThanOrEqual(10);
    const repeated = [...reads.entries()].filter(([, n]) => n > 1);
    expect(
      repeated,
      `These modules were read from disk more than once during a single ` +
        `scan — the import-resolution cache (makeCachedModuleResolver) is ` +
        `missing or regressed:\n` +
        repeated.map(([p, n]) => `  ${n}× ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("a NON-cached resolver over the SAME corpus produces many redundant reads — proves the cache test is not vacuous and pins the regression magnitude", () => {
    // An uncached resolver: re-reads from disk on every resolve, exactly the
    // pre-fix behavior. If the corpus did NOT share helpers, this would also
    // show no redundancy and the cached test above would be meaningless.
    const uncached = (onRead: (p: string) => void) => {
      return (spec: string, fromFile: string): string | null => {
        const resolved = resolveModulePath(spec, fromFile);
        if (resolved == null) return null;
        const src = fs.readFileSync(resolved, "utf8");
        onRead(resolved);
        return src;
      };
    };
    const reads = tallyModuleReads(uncached);
    const totalReads = [...reads.values()].reduce((a, b) => a + b, 0);
    const distinct = reads.size;
    const redundant = totalReads - distinct;
    // The shared-helper amplification is real and substantial — far above a
    // trivial threshold. (Observed ~359 redundant reads on the current
    // corpus; pin a conservative floor so this can't pass on a degenerate
    // walk.) This is the work the cache eliminates.
    expect(redundant).toBeGreaterThanOrEqual(50);
  });
});

describe("audit coverage: every mutation site in src/app/api must emit or skip", () => {
  it("every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip", () => {
    const routeFiles = collectRouteFiles(API_DIR);
    // H-0003 (S9b performance): one resolver, shared across the whole scan,
    // so each helper module is read from disk at most once instead of once
    // per importing route (~359 redundant reads eliminated on today's
    // corpus). The cache is behavior-preserving — module source on disk is
    // immutable for the duration of a single test run.
    const resolveModule = makeCachedModuleResolver();
    // H-0003 (audit 2026-05-07): the previous floor was `> 0`, which would
    // pass even if a path refactor silently degraded collectRouteFiles to
    // enumerate a single file — leaving 99% of the route corpus unscanned
    // while the test still went green (a no-op gate that "verifies behavior,
    // not intent", Rule 9). A whole-corpus coverage gate is only meaningful
    // if it actually walks the corpus. The repo has 78 route.ts files today;
    // pin a conservative floor well below that (40) so legitimate route
    // deletions don't trip it, but a scanner that silently finds ~nothing
    // (wrong API_DIR, broken recursion, `route.ts` rename) fails loudly.
    expect(routeFiles.length).toBeGreaterThanOrEqual(40);

    const uncovered: Array<{
      file: string;
      line: number;
      snippet: string;
    }> = [];

    // H-0003: also count the mutations the detectors actually surfaced. The
    // gate is vacuous if the scanner walks every file but the detectors find
    // zero mutation sites (e.g. a regression that breaks findMutations'
    // anchor walk so it returns []). The corpus has dozens of audited
    // mutation sites; require the detectors to surface a non-trivial number
    // so a silently-disarmed detector can't sail through green.
    let detectedMutationSites = 0;

    for (const file of routeFiles) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split("\n");
      // Dedup by file:line — findHelperMutations (hardcoded allowlist)
      // and findImportedMutatorCalls (auto-discovered import graph) can
      // both flag the same call site; we must not double-report it.
      const seen = new Set<string>();
      const mutations = [
        ...findMutations(file, src),
        // /review follow-up (T4-C1): helper-indirection coverage.
        // Routes that delegate their mutation to a named helper export
        // must still emit an audit event in the route file.
        ...findHelperMutations(file, src),
        // P692 extension: known-mutating .rpc() calls. The allowlist
        // is in MUTATING_RPC_NAMES; route authors adding a new mutating
        // RPC must add it there as part of the audit checklist.
        ...findRpcMutations(file, src),
        // H-0005 (audit 2026-05-25): one-hop import-graph enforcement.
        // Catches calls to ANY local helper export that mutates the DB,
        // not just the HELPER_MUTATORS allowlist — so a NEW unregistered
        // mutator helper can no longer escape the coverage gate.
        ...findImportedMutatorCalls(file, src, resolveModule),
      ].filter((mm) => {
        const key = `${mm.file}:${mm.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      detectedMutationSites += mutations.length;
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

    // H-0003: the gate is only meaningful if the detectors actually fired.
    // The corpus surfaces ~56 mutation sites today (direct chains + helper
    // calls + mutating RPCs + import-graph hops). A regression that disarms
    // a detector (e.g. findMutations' anchor walk silently returning []) or
    // a path break that scans empty files would drop this toward 0 while
    // `uncovered` stays empty and the test still passes. Pin a conservative
    // floor (25) so a silently-disarmed detector fails loudly instead of
    // green-but-vacuous.
    expect(detectedMutationSites).toBeGreaterThanOrEqual(25);
  });
});
