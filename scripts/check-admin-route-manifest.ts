#!/usr/bin/env -S npx tsx
/**
 * CI hook — fail if `src/app/api/admin/**\/route.ts` and the
 * `ADMIN_ROUTE_MANIFEST` constant in `src/lib/auth/rbac-manifest.ts`
 * diverge.
 *
 * audit-2026-05-07 C-0153 (api-contract). The codebase has three
 * parallel admin-gate mechanisms (`withRole`, `withAdminAuth`,
 * `isAdminUser`-inline) and no single source of truth tracked which
 * route uses which. The manifest is that source of truth; this script
 * is the gate that prevents drift.
 *
 * Rules enforced
 * --------------
 *   1. Every `route.ts` under `src/app/api/admin` MUST have an
 *      entry in the manifest.
 *   2. Every manifest entry MUST point at a file that exists.
 *   3. Each entry's `current` field must match what the route actually
 *      imports: a file declaring `withRole` is "withRole", a file
 *      declaring `withAdminAuth` is "withAdminAuth", and a file that
 *      uses `isAdminUser` inline (but neither wrapper) is
 *      "isAdminUser-inline". A route that has NONE of the three is a
 *      hard error — it's an admin route with no gate.
 *
 * Exit codes
 * ----------
 *   0  manifest matches reality.
 *   1  drift detected (one or more violations).
 *
 * Invocation
 * ----------
 * Wired into `npm run check:admin-route-manifest` (package.json) and
 * `npm run lint`, which is the CI hook in `.github/workflows/ci.yml`
 * (frontend-lint job). To run by itself: `npm run check:admin-route-manifest`.
 *
 * audit-2026-05-07 testing T1 (HIGH conf 8) + security S1 (MED conf 8) +
 * maintainability M2 (MED conf 8): split into pure helpers + a
 * `runCheck(rootDir)` entry point so the regression suite at
 * `src/__tests__/check-admin-route-manifest.test.ts` can drive it
 * against a tmp fixture tree. The `detectMechanism` helper now strips
 * comments before regex matching (S1) and the mechanism alternation is
 * derived from the imported `AdminGateMechanism` union (M2 — no more
 * three-copy DRY violation).
 *
 * audit-2026-05-07 red-team (HIGH conf 8 + MED conf 8): hardened
 * further — `stripComments` is now a character-by-character tokenizer
 * that also erases STRING and TEMPLATE-LITERAL contents (closes the
 * `JSON.stringify({hint:"withRole('admin')..."})` bypass), and
 * `stripUnreachableIfFalseBlocks` erases statically-dead
 * `if (false) { ... }` branches so a half-removed wrapper guarded
 * inside an unreachable block is not detected as the route's real gate.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

import {
  ADMIN_ROUTE_MANIFEST,
  type AdminGateMechanism,
  type AdminRouteEntry,
} from "../src/lib/auth/rbac-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * Strip line + block comments AND string / template-literal contents
 * before mechanism detection. Without this, a comment containing
 * `// withRole("admin")` would classify the file as `withRole` even if
 * the runtime body uses `isAdminUser` inline — and a STRING containing
 * `withRole("admin")` (e.g. an error message, a JSON.stringify arg, a
 * doc URL) would have the same false-positive shape.
 *
 * Security S1 (audit-2026-05-07, MED conf 8) closed the comment bypass.
 * red-team finding (audit-2026-05-07 red-team, HIGH conf 8) extends the
 * closure to STRING and TEMPLATE-LITERAL bypasses — the simple regex
 * variant could not distinguish `withRole("admin")` in a code call from
 * the same characters inside a string literal. The regex-pair also had a
 * second hazard: the line-comment regex `/\/\/[^\n]*` (with g flag) would destroy
 * any text following `//` inside a string (e.g. `"https://docs/..."`),
 * which could MASK a real `isAdminUser(` call on the same line.
 *
 * The implementation here is a single-pass character tokenizer that
 * tracks four mutually exclusive states: code, line-comment,
 * block-comment, single-quoted string, double-quoted string, and
 * template literal (backtick). Each state knows how to terminate
 * itself; while inside a string/comment state, characters are SKIPPED
 * (replaced with whitespace so line numbers / column positions are
 * preserved for any future diagnostic use). Escapes (`\`) inside
 * quote-delimited strings consume the next character so an embedded
 * `\"` does not terminate a `"..."`. Template literals do NOT need
 * full expression-tracking — a `${...}` inside a backtick string can
 * itself contain code with calls, but for detection purposes the whole
 * template body is treated as a string (a `withRole(` inside a
 * `${...}` substitution is still inside a string literal at the source
 * level, and detecting it as a real call would be the same bypass we
 * are closing).
 *
 * Deliberately a hand-rolled tokenizer rather than ts-morph or the
 * TypeScript compiler API: zero new deps, ~50 LOC, no AST overhead in
 * the lint hot path, and the surface we care about (line + block
 * comments, three string variants) is small and stable. If the script
 * later needs to inspect export statements / call expressions
 * specifically, that is the right time to take the AST upgrade.
 */
export function stripComments(contents: string): string {
  const out: string[] = [];
  let i = 0;
  const n = contents.length;
  while (i < n) {
    const c = contents[i];
    const next = i + 1 < n ? contents[i + 1] : "";

    // Block comment.
    if (c === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < n) {
        if (contents[i] === "*" && i + 1 < n && contents[i + 1] === "/") {
          out.push("  ");
          i += 2;
          break;
        }
        // Preserve newlines so line numbers stay aligned.
        out.push(contents[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }

    // Line comment.
    if (c === "/" && next === "/") {
      while (i < n && contents[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // String literal: single / double quote. Honour `\` escapes so
    // `"a \" b"` is one token, not three.
    if (c === "'" || c === '"') {
      const quote = c;
      out.push(" ");
      i += 1;
      while (i < n) {
        const ch = contents[i];
        if (ch === "\\" && i + 1 < n) {
          // Skip escape + escaped char.
          out.push(contents[i + 1] === "\n" ? "\n" : " ");
          out.push(contents[i + 1] === "\n" ? "" : " ");
          i += 2;
          continue;
        }
        if (ch === quote) {
          out.push(" ");
          i += 1;
          break;
        }
        if (ch === "\n") {
          // Unterminated string — bail to code state at the newline so
          // a syntactically broken file does not eat the rest of the
          // tokenizer's input.
          out.push("\n");
          i += 1;
          break;
        }
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // Template literal. Treat the whole body (including ${...}) as
    // string content for detection purposes.
    if (c === "`") {
      out.push(" ");
      i += 1;
      while (i < n) {
        const ch = contents[i];
        if (ch === "\\" && i + 1 < n) {
          out.push(" ");
          out.push(contents[i + 1] === "\n" ? "\n" : " ");
          i += 2;
          continue;
        }
        if (ch === "`") {
          out.push(" ");
          i += 1;
          break;
        }
        if (ch === "$" && i + 1 < n && contents[i + 1] === "{") {
          // Walk the `${...}` substitution as a brace-balanced run so a
          // call like `${withRole("admin")}` inside the template is still
          // erased — substitutions are part of the string at the source
          // level. Nested braces are tracked.
          out.push("  ");
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const sc = contents[i];
            if (sc === "{") depth += 1;
            else if (sc === "}") depth -= 1;
            out.push(sc === "\n" ? "\n" : " ");
            i += 1;
          }
          continue;
        }
        out.push(ch === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }

    out.push(c);
    i += 1;
  }
  return out.join("");
}

/**
 * Strip statically-unreachable `if (false) { ... }` blocks. Closes the
 * red-team gap (audit-2026-05-07 red-team, MED conf 8): a route that
 * keeps a dead `if (false) { withRole('admin')(...) }` branch — for
 * example a half-completed refactor where the wrapper was REMOVED but
 * the import and a guarded call stayed — would otherwise classify as
 * `withRole` and pass the manifest gate while the actual export is
 * UNGATED at runtime.
 *
 * Brace-balanced walk anchored on the literal sequence `if (false) {`
 * (with arbitrary internal whitespace). We do not attempt to evaluate
 * arbitrary constant expressions — only the canonical `false` literal
 * shape, which is enough to defuse the documented bypass without
 * pulling in a JS evaluator. A future migration to ts-morph could
 * widen this to constant-folded `process.env.X === undefined && false`
 * style branches; that is out of scope for the surgical fix.
 */
export function stripUnreachableIfFalseBlocks(contents: string): string {
  const out: string[] = [];
  let i = 0;
  const n = contents.length;
  while (i < n) {
    // Match `if` `(` `false` `)` `{` with arbitrary whitespace between.
    if (
      contents[i] === "i" &&
      contents[i + 1] === "f" &&
      // Avoid matching identifier prefixes like `iff` / `if_`. The char
      // before must not be alphanumeric or `_` (identifier-continue).
      !/[A-Za-z0-9_$]/.test(contents[i - 1] ?? " ") &&
      !/[A-Za-z0-9_$]/.test(contents[i + 2] ?? " ")
    ) {
      // Tentatively skip "if" and capture position so we can rewind on
      // a non-match.
      let j = i + 2;
      // Skip whitespace.
      while (j < n && /\s/.test(contents[j])) j += 1;
      if (contents[j] === "(") {
        j += 1;
        while (j < n && /\s/.test(contents[j])) j += 1;
        if (contents.slice(j, j + 5) === "false") {
          const afterFalse = j + 5;
          // No identifier-continue char immediately after `false`.
          if (!/[A-Za-z0-9_$]/.test(contents[afterFalse] ?? " ")) {
            let k = afterFalse;
            while (k < n && /\s/.test(contents[k])) k += 1;
            if (contents[k] === ")") {
              k += 1;
              while (k < n && /\s/.test(contents[k])) k += 1;
              if (contents[k] === "{") {
                // Walk the brace-balanced block. Replace contents with
                // whitespace so line numbers stay aligned.
                let depth = 1;
                let m = k + 1;
                while (m < n && depth > 0) {
                  if (contents[m] === "{") depth += 1;
                  else if (contents[m] === "}") depth -= 1;
                  m += 1;
                }
                // Emit whitespace for [i, m).
                for (let p = i; p < m; p += 1) {
                  out.push(contents[p] === "\n" ? "\n" : " ");
                }
                i = m;
                continue;
              }
            }
          }
        }
      }
    }
    out.push(contents[i]);
    i += 1;
  }
  return out.join("");
}

export function detectMechanism(
  contents: string,
): AdminGateMechanism | "UNGATED" {
  // Two-pass cleanup: (1) strip comments + string/template literals
  // (closes the COMMENT + STRING + TEMPLATE-LITERAL bypass surface),
  // then (2) erase dead `if (false) { ... }` blocks so a half-removed
  // wrapper guarded inside an unreachable branch is not detected as the
  // route's real gate. Both passes preserve newlines so any future
  // line-aware diagnostic stays aligned with the original source.
  const stripped = stripUnreachableIfFalseBlocks(stripComments(contents));
  if (/\bwithRole\s*[<(]/.test(stripped)) return "withRole";
  if (/\bwithAdminAuth\s*\(/.test(stripped)) return "withAdminAuth";
  // Only count a real CALL to isAdminUser, not just a comment mention.
  if (/\bisAdminUser\s*\(/.test(stripped)) return "isAdminUser-inline";
  // No admin gate detected, but the route still gates on auth via
  // supabase.auth.getUser() + an early `!user` 401. The manifest entry
  // must declare this carve-out explicitly via current === "authenticated-non-admin".
  if (
    /supabase\.auth\.getUser\s*\(/.test(stripped) &&
    /!\s*user\b/.test(stripped)
  ) {
    return "authenticated-non-admin";
  }
  return "UNGATED";
}

/**
 * Recursive walk for `route.ts` files under a root. Avoids node:fs.globSync
 * which is not yet declared in the `@types/node` we ship with.
 */
export function findRouteFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...findRouteFiles(full));
    } else if (st.isFile() && name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pure entry point for the gate. Takes a root directory (so tests can
 * drive a tmp fixture tree) and an explicit manifest (so tests can
 * inject fixture entries without monkey-patching the import). Returns
 * the violation list — empty list = pass. The CLI `main()` below
 * exit-codes based on whether the list is empty.
 *
 * audit-2026-05-07 testing T1 (HIGH conf 8): this shape is exactly
 * what the regression suite needs.
 */
export function runCheck(
  rootDir: string,
  manifest: readonly AdminRouteEntry[] = ADMIN_ROUTE_MANIFEST,
): string[] {
  const manifestByRoute = new Map<string, AdminRouteEntry>();
  for (const entry of manifest) manifestByRoute.set(entry.route, entry);

  const adminRoutes = findRouteFiles(
    resolve(rootDir, "src/app/api/admin"),
  ).map((abs) => relative(rootDir, abs));

  const violations: string[] = [];

  // Rule 1: every route is in the manifest.
  for (const route of adminRoutes) {
    const entry = manifestByRoute.get(route);
    if (!entry) {
      violations.push(
        `MISSING: admin route ${route} has no entry in ADMIN_ROUTE_MANIFEST (src/lib/auth/rbac-manifest.ts). Add an entry declaring its current gate mechanism.`,
      );
      continue;
    }
    // Rule 3: declared mechanism matches reality.
    const fileSrc = readFileSync(resolve(rootDir, route), "utf-8");
    const actual = detectMechanism(fileSrc);
    if (actual === "UNGATED") {
      violations.push(
        `UNGATED: admin route ${route} has no recognizable admin gate (withRole, withAdminAuth, or isAdminUser). This is a security risk — admin routes MUST declare an RBAC gate.`,
      );
      continue;
    }
    if (actual !== entry.current) {
      violations.push(
        `DRIFT: admin route ${route} uses ${actual} but the manifest declares ${entry.current}. Update the manifest's "current" field (and "notes" if the change is intentional).`,
      );
    }
  }

  // Rule 2: every manifest entry points at a real file.
  const adminRouteSet = new Set(adminRoutes);
  for (const entry of manifest) {
    if (!adminRouteSet.has(entry.route)) {
      violations.push(
        `STALE: manifest entry ${entry.route} does not exist on disk. Remove the entry or restore the file.`,
      );
    }
  }

  return violations;
}

function main(): void {
  const violations = runCheck(REPO_ROOT);

  if (violations.length > 0) {
    console.error(
      `[check-admin-route-manifest] ${violations.length} violation(s):\n`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nManifest: src/lib/auth/rbac-manifest.ts\nFinding: audit-2026-05-07 C-0153",
    );
    process.exit(1);
  }

  const adminRoutes = findRouteFiles(
    resolve(REPO_ROOT, "src/app/api/admin"),
  );
  console.log(
    `[check-admin-route-manifest] OK — ${adminRoutes.length} admin routes, all declared in manifest.`,
  );
}

// Only run the CLI when invoked directly (not when imported by tests).
// Vitest/Node import this file via the .ts extension and never matches
// process.argv[1] — main() stays dormant under tests.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "")
) {
  main();
}
