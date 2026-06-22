import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: the public scenario-share page 500'd on every VALID link.
 * Found by /qa on 2026-06-22. Report: .gstack/qa-reports/.
 *
 * WHY THIS TEST IS A SOURCE SCAN, NOT A RENDER TEST:
 *   The page (`page.tsx`) is a React Server Component. It originally imported
 *   `toWealth` from the EquityChart widget, which is a `"use client"` module,
 *   and CALLED it during server render. Next throws at runtime:
 *     "Attempted to call toWealth() from the server but toWealth() is on the
 *      client. It can only be used from a Client Component."
 *   → HTTP 500 on every share link that actually resolves a scenario. The
 *   bogus-token path notFound()s BEFORE the call, so the canary and
 *   `page.test.tsx` (which mocks the widget) both stayed green, and the build
 *   does not enforce the RSC boundary. vitest does NOT enforce it either (it
 *   would just call toWealth() normally) — so a render test cannot reproduce
 *   this. The durable guard is therefore static: a module reached on the
 *   server-render path must not CALL a binding imported from a "use client"
 *   module. Rendering a client component as JSX (`<EquityChart .../>`) or
 *   importing a `type` is fine; CALLING `clientFn()` on the server is the bug.
 *
 * CEILING (honest): this scans the page's DIRECT server entrypoints
 * (`page.tsx` + `share-resolve.ts`, where the page's server computation lives),
 * NOT the full transitive import closure. A future *value* import from a client
 * module added DEEPER than these entrypoints (e.g. into scenario-state.ts,
 * which currently imports cross-tab.ts as TYPE-only) would reintroduce the same
 * class and this guard would not catch it. Keeping the heaviest two entrypoints
 * covered catches the realistic regressions; a full-closure walker is the
 * stronger (unbuilt) version.
 */

const REPO = process.cwd();

// The page's server-render path: the page itself + the pure resolve layer it
// calls (which runs computeScenario etc. during render).
const SERVER_ENTRYPOINTS = [
  join(REPO, "src/app/scenario-share/[token]/page.tsx"),
  join(REPO, "src/app/scenario-share/[token]/share-resolve.ts"),
];

/** Resolve a `@/x` or relative import to a file under src/, trying extensions. */
function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(REPO, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(fromFile, "..", spec);
  else return null; // bare package (node_modules) — out of scope
  for (const cand of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** True if the FIRST non-comment, non-blank statement is a "use client"
 *  directive. Tolerates a leading license/JSDoc banner above the directive
 *  (Next allows the directive after leading comments). */
function isUseClient(file: string): boolean {
  const src = readFileSync(file, "utf8");
  const stripped = src
    // block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // line comments
    .replace(/^\s*\/\/.*$/gm, "")
    .trimStart();
  return /^["']use client["']/.test(stripped);
}

type Binding = { name: string; isType: boolean; namespace: boolean };

/** Parse named, default, and namespace imports (value bindings + a `type`
 *  flag). Covers every value-import shape that could carry a callable across
 *  the RSC boundary, not just `import { x }`. */
function parseImports(
  src: string,
): Array<{ bindings: Binding[]; spec: string }> {
  const out: Array<{ bindings: Binding[]; spec: string }> = [];
  // import [type] { a, type B } | * as NS | Default [, { ... }] from "spec"
  const re =
    /import\s+(type\s+)?([^;'"]+?)\s+from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const stmtType = Boolean(m[1]);
    const clause = m[2].trim();
    const spec = m[3];
    const bindings: Binding[] = [];

    // namespace: * as NS
    const ns = clause.match(/\*\s*as\s+(\w+)/);
    if (ns) bindings.push({ name: ns[1], isType: stmtType, namespace: true });

    // default: a leading bare identifier before any `{`
    const def = clause.match(/^(\w+)\s*(?:,|$)/);
    if (def && !ns) bindings.push({ name: def[1], isType: stmtType, namespace: false });

    // named: { a, type B, c as d }
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const raw of named[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const isType = stmtType || /^type\s/.test(raw);
        const name = raw
          .replace(/^type\s+/, "")
          .replace(/\s+as\s+\w+$/, "")
          .trim();
        if (name) bindings.push({ name, isType, namespace: false });
      }
    }
    out.push({ bindings, spec });
  }
  return out;
}

/** Is `name` CALLED in `src` (call position), as opposed to only rendered as
 *  JSX (`<name`)? For a namespace binding, any member call `ns.foo(` counts. */
function isCalledOnServer(name: string, namespace: boolean, src: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = namespace
    ? new RegExp(`\\b${esc}\\.\\w+\\s*\\(`)
    : new RegExp(`\\b${esc}\\s*\\(`);
  return re.test(src);
}

describe("scenario-share — RSC server/client import boundary", () => {
  const pageSrc = readFileSync(SERVER_ENTRYPOINTS[0], "utf8");
  const pageImports = parseImports(pageSrc);

  it("imports toWealth from the pure @/lib/scenario module, not the EquityChart client widget", () => {
    const fromScenario = pageImports.find(
      (i) =>
        i.spec === "@/lib/scenario" &&
        i.bindings.some((b) => b.name === "toWealth" && !b.isType),
    );
    expect(fromScenario, "toWealth must be imported from @/lib/scenario").toBeTruthy();

    const fromEquityChart = pageImports.find((i) => /EquityChart$/.test(i.spec));
    if (fromEquityChart) {
      expect(
        fromEquityChart.bindings.some((b) => b.name === "toWealth"),
        "toWealth must NOT be imported from the EquityChart (use client) widget",
      ).toBe(false);
    }
  });

  it("calls no binding imported from a 'use client' module on the server render path", () => {
    const violations: string[] = [];
    for (const entry of SERVER_ENTRYPOINTS) {
      if (!existsSync(entry)) continue;
      const src = readFileSync(entry, "utf8");
      for (const imp of parseImports(src)) {
        const file = resolveModule(imp.spec, entry);
        if (!file || !isUseClient(file)) continue;
        for (const b of imp.bindings) {
          if (b.isType) continue; // types are erased — safe across the boundary
          // A value binding from a client module is a violation only if the
          // server module CALLS it. JSX `<Component .../>` is allowed; calling
          // `fn()` is the RSC boundary error this guard exists to prevent.
          if (isCalledOnServer(b.name, b.namespace, src)) {
            violations.push(`${b.name}() from "${imp.spec}" (use client) in ${entry.split("/").pop()}`);
          }
        }
      }
    }
    expect(
      violations,
      `Server-render path must not CALL a binding from a "use client" module:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});
