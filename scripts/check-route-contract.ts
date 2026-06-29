#!/usr/bin/env -S npx tsx
/**
 * CI hook — fail if the page-route tree under `src/app/**`, the
 * `PUBLIC_ROUTES` array in `src/proxy.ts`, the `redirects()` block in
 * `next.config.ts`, and the `ROUTE_CONTRACT_MANIFEST` constant in
 * `src/lib/routing/route-contract-manifest.ts` fall out of lockstep.
 *
 * Phase 51 NAV-03. The codebase has a flat hand-maintained `PUBLIC_ROUTES`
 * array and a growing page tree with no machine-checkable link between them; a
 * route that moves without being added to `PUBLIC_ROUTES` produces the #512
 * regression (anon recipient → silent 307→login). The manifest is the source
 * of truth; this script is the gate that prevents drift.
 *
 * Rules enforced (51-RESEARCH Pattern 4)
 * --------------------------------------
 *   1. Every `page.tsx` under `src/app` maps to a URL that MUST have a class
 *      entry in the manifest (public|private|admin|exception). An unclassified
 *      page route is a hard error — UNCLASSIFIED.
 *   2. Every manifest entry classified `public` MUST appear in `proxy.ts`
 *      PUBLIC_ROUTES (the #512 lockstep). A `public` route absent from
 *      PUBLIC_ROUTES is MISSING-FROM-PUBLIC.
 *   3. Every manifest entry that declares `redirectFrom` MUST have a matching
 *      `source` in `next.config.ts` `redirects()`. A missing one is
 *      MISSING-REDIRECT — the old link would 404.
 *   4. Every manifest entry MUST map to a real page file on disk. An entry
 *      with no backing page is STALE.
 *
 * Exit codes
 * ----------
 *   0  manifest matches reality.
 *   1  drift detected (one or more violations).
 *
 * Invocation
 * ----------
 * Plan 51-02 wires this into `npm run check:route-contract` and `npm run lint`
 * (the `frontend-lint` CI hook in `.github/workflows/ci.yml`). Plan 51-01 ships
 * the skeleton only — the script is NOT yet in `package.json` lint.
 *
 * RED CONTRACT (plan 51-01)
 * -------------------------
 * The four rules below are deliberately STUBBED — each is present and
 * reachable, but the lockstep logic is intentionally incomplete so the
 * regression suite at `src/__tests__/check-route-contract.test.ts` fails on
 * ASSERTIONS (not on a missing import or a process.exit). Plan 51-02 fills in
 * the rule bodies to turn that suite GREEN. The exported helpers
 * (`stripComments`, `findRouteFiles`, `runCheck`) and the import graph are
 * final; only the rule bodies inside `runCheck` are stubbed.
 *
 * The `stripComments` tokenizer is REUSED VERBATIM from
 * `scripts/check-admin-route-manifest.ts` — it is the hardened single-pass
 * char tokenizer that erases comment + string + template-literal contents so a
 * `"/legal"` literal that appears only inside a comment in `proxy.ts` cannot
 * satisfy the Rule-2 lockstep (the comment/string bypass the admin guard
 * already closed, audit-2026-05-07 S1 + red-team).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

import {
  ROUTE_CONTRACT_MANIFEST,
  type RouteEntry,
} from "../src/lib/routing/route-contract-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * Strip line + block comments AND string / template-literal contents before
 * any regex parse of source. Without this, a `"/legal"` literal that appears
 * only INSIDE a comment (or inside another string) in `proxy.ts` would be
 * matched as if it were a real PUBLIC_ROUTES member, letting a public route
 * that is NOT actually whitelisted silently satisfy the Rule-2 lockstep.
 *
 * REUSED VERBATIM from `scripts/check-admin-route-manifest.ts` (the hardened
 * tokenizer that closed the comment + string + template-literal bypass surface
 * — audit-2026-05-07 S1 + red-team). Do NOT re-hand-roll: a regex-pair variant
 * re-opens both the comment-mention bypass and the `//`-inside-a-string hazard.
 *
 * Single-pass character tokenizer tracking mutually exclusive states: code,
 * line-comment, block-comment, single/double-quoted string, and template
 * literal. While inside a string/comment state, characters are replaced with
 * whitespace (newlines preserved so line/column positions stay aligned for any
 * future diagnostic). Escapes (`\`) inside quote-delimited strings consume the
 * next character so an embedded `\"` does not terminate a `"..."`. A `${...}`
 * substitution inside a template literal is walked brace-balanced and treated
 * as string content (a `"/legal"` inside `${...}` is still inside a string at
 * the source level).
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
          // literal inside the template is still erased — substitutions are
          // part of the string at the source level. Nested braces are tracked.
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
 * Recursive walk for `page.tsx` files under a root. (The admin guard walks
 * `route.ts`; the route-contract guard walks the PAGE tree.) Avoids
 * node:fs.globSync which is not yet declared in the `@types/node` we ship with.
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
    } else if (st.isFile() && name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Derive the URL path a `page.tsx` file serves, from its path relative to the
 * repo root. The mapping (51-RESEARCH Pattern 4 step 2):
 *   - strip the leading `src/app` segment,
 *   - drop the trailing `/page.tsx`,
 *   - DROP `(group)` route-group segments (parens are folder-only, zero URL),
 *   - convert `[seg]` dynamic segments → `:seg`,
 *   - the index page (`src/app/page.tsx`) maps to `/`.
 *
 * e.g. `src/app/(marketing)/legal/page.tsx` → `/legal`,
 *      `src/app/admin/users/[id]/page.tsx`  → `/admin/users/:id`.
 */
export function pageFileToUrl(relPath: string): string {
  const normalized = relPath.split("\\").join("/");
  const withoutApp = normalized
    .replace(/^src\/app\/?/, "")
    .replace(/\/?page\.tsx$/, "");
  const segments = withoutApp
    .split("/")
    .filter((seg) => seg.length > 0)
    // Route groups `(group)` are folder-only — they contribute no URL segment.
    .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")))
    // Dynamic `[seg]` / catch-all `[...seg]` → `:seg`.
    .map((seg) =>
      seg.startsWith("[") && seg.endsWith("]")
        ? ":" + seg.slice(1, -1).replace(/^\.\.\./, "")
        : seg,
    );
  return "/" + segments.join("/");
}

/**
 * Parse the `PUBLIC_ROUTES` array literal out of `proxy.ts` source. Strips
 * comments + strings FIRST (via `stripComments`) so a `"/legal"` that appears
 * only inside a comment cannot read as a real PUBLIC_ROUTES member — the #512
 * lockstep must key on the live array, not on commented-out text.
 *
 * Returns the list of route prefixes, or `[]` if the array is not found.
 */
export function parsePublicRoutes(proxySource: string): string[] {
  // NOTE: stripComments erases string CONTENTS too, so we cannot read the route
  // strings out of the stripped source directly. Instead we use the stripped
  // source only to LOCATE the live (non-commented) `PUBLIC_ROUTES = [ ... ]`
  // span, then read the actual string literals from the ORIGINAL source within
  // that span — which is exactly what defeats the comment-bypass: a commented
  // PUBLIC_ROUTES line leaves no array literal in the stripped source.
  const stripped = stripComments(proxySource);
  const marker = stripped.match(/const\s+PUBLIC_ROUTES\s*=\s*\[/);
  if (!marker || marker.index === undefined) return [];
  const openIdx = proxySource.indexOf("[", marker.index);
  if (openIdx === -1) return [];
  const closeIdx = proxySource.indexOf("]", openIdx);
  if (closeIdx === -1) return [];
  const body = proxySource.slice(openIdx + 1, closeIdx);
  return [...body.matchAll(/"([^"]+)"/g)].map((mm) => mm[1]);
}

/**
 * Pure entry point for the gate. Takes a root directory (so tests can drive a
 * tmp fixture tree) and an explicit manifest (so tests can inject fixture
 * entries without monkey-patching the import). Returns the violation list —
 * empty list = pass. The CLI `main()` below exit-codes on whether the list is
 * empty.
 *
 * RED CONTRACT (plan 51-01): the four rule bodies below are STUBBED. They are
 * present and reachable (so the import graph and the test's calls resolve), but
 * the lockstep logic is intentionally incomplete — `runCheck` currently returns
 * NO violations for any input. This makes the Task-2 regression suite fail on
 * its assertions (it expects specific violations and gets `[]`), which is the
 * RED contract. Plan 51-02 implements the rule bodies marked `STUB` below.
 */
export function runCheck(
  rootDir: string,
  manifest: readonly RouteEntry[] = ROUTE_CONTRACT_MANIFEST,
): string[] {
  const violations: string[] = [];

  const manifestByRoute = new Map<string, RouteEntry>();
  for (const entry of manifest) manifestByRoute.set(entry.route, entry);

  // Discover the on-disk page routes (used by Rules 1 and 4). The walk + URL
  // derivation are FINAL; only the rule bodies that consume them are stubbed.
  const pageUrls = findRouteFiles(resolve(rootDir, "src/app")).map((abs) =>
    pageFileToUrl(relative(rootDir, abs)),
  );

  // Parse the live PUBLIC_ROUTES (used by Rule 2). FINAL.
  let publicRoutes: string[] = [];
  try {
    publicRoutes = parsePublicRoutes(
      readFileSync(resolve(rootDir, "src/proxy.ts"), "utf-8"),
    );
  } catch {
    publicRoutes = [];
  }

  // Rule 1 — every discovered page route is classified in the manifest.
  // STUB (51-02): emit `UNCLASSIFIED: ...` for each pageUrl with no manifest
  // entry. Currently a no-op so the Task-2 unclassified assertion is RED.
  void pageUrls;

  // Rule 2 — every manifest "public" route is in PUBLIC_ROUTES (the #512
  // lockstep). STUB (51-02): for each manifest entry whose class === "public"
  // and whose route is not matched by PUBLIC_ROUTES, emit
  // `MISSING-FROM-PUBLIC: ...`. Currently a no-op so the Task-2 Rule-2 and
  // comment-bypass assertions are RED.
  void publicRoutes;

  // Rule 3 — every manifest `redirectFrom` has a matching next.config.ts
  // redirects() source. STUB (51-02): parse next.config.ts redirects() and emit
  // `MISSING-REDIRECT: ...` for each redirectFrom with no matching source.
  // Currently a no-op so the Task-2 Rule-3 assertion is RED.

  // Rule 4 — every manifest entry maps to a real page file. STUB (51-02): for
  // each manifest entry whose route is not produced by the page walk above (and
  // is not an `exception`/API carve-out), emit `STALE: ...`. Currently a no-op
  // so the Task-2 Rule-4 assertion is RED.
  void manifestByRoute;

  return violations;
}

function main(): void {
  const violations = runCheck(REPO_ROOT);

  if (violations.length > 0) {
    console.error(
      `[check-route-contract] ${violations.length} violation(s):\n`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nManifest: src/lib/routing/route-contract-manifest.ts\nPhase: 51 NAV-03 (#512 lockstep)",
    );
    process.exit(1);
  }

  const pageRoutes = findRouteFiles(resolve(REPO_ROOT, "src/app"));
  console.log(
    `[check-route-contract] OK — ${pageRoutes.length} page routes, all declared in the manifest.`,
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
