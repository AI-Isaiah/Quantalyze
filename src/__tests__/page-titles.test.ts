/**
 * Phase 170.1.1 / D-06 — the repo-wide page-title census.
 *
 * THE CONTRACT. The root layout owns the brand suffix and the separator, once:
 * `title: { template: "%s — Quantalyze", default: "Quantalyze" }`. Every other
 * segment exports a BARE title, so the tab reads "Decks — Quantalyze" and never
 * "Decks | Quantalyze — Quantalyze". This census proves, on every run:
 *
 *   1. the root layout carries the literal template and default;
 *   2. no top-level `metadata` / `generateMetadata` title contains "Quantalyze"
 *      or "|" (openGraph and twitter titles are social cards, a different
 *      surface, and are excluded). A title written as a literal, as a shorthand
 *      `{ title }` or `title: someVar` resolving to a literal declared in the
 *      same file, and in a function, generic or arrow `generateMetadata`, is
 *      all scanned. No page or layout other than the root layout writes an
 *      object-form `title: { ... }` (any keys), which would replace the
 *      root template;
 *   3. every `page.tsx` under (dashboard) and (auth) is titled, by an export in
 *      its own file or in a `layout.tsx` in its own directory, except the two
 *      redirect-only pages that render no document of their own;
 *   4. /strategies and /my-strategies carry different PageHeader titles
 *      (D-06: the manager list is "Strategies", the owner list "My Strategies");
 *   5. the matchers can fail: synthetic offenders are flagged, so a scanner
 *      that stopped matching cannot leave this census green.
 *
 * NOT MODELLED (assertion 2 reads none of these): a title built by a helper call
 * (`title: mk(n)`), an imported constant, or a reassigned `let`. Assertion 2c
 * fails a titled file whose metadata the scanner could not read at all.
 *
 * THE POPULATION is derived from disk on every run: a page added tomorrow is
 * covered without editing this file. Comments are stripped first
 * (`stripCommentsPreserveLines`) so prose naming a brand-suffixed title does not
 * trip assertion 2, and reported line numbers stay real.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const APP = join(REPO_ROOT, "src", "app");
const ROOT_LAYOUT = "src/app/layout.tsx";

/**
 * The only (dashboard)/(auth) pages allowed to be untitled: both redirect on
 * every request and never render a document, so a tab title would be dead code.
 */
const REDIRECT_ONLY_PAGES = [
  "src/app/(dashboard)/strategies/new/page.tsx",
  "src/app/(dashboard)/preferences/page.tsx",
];

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const code = (source: string) => stripCommentsPreserveLines(source, "ts");

/** Index of the `}` / `)` closing the opener at `open`, quote-aware; -1 if none. */
function matchClose(src: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === "}" || ch === ")" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Replace `openGraph: { ... }` and `twitter: { ... }` bodies with spaces. */
function blankSocialBlocks(src: string): string {
  let out = src;
  const re = /\b(openGraph|twitter)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(out, open);
    if (close === -1) continue;
    out =
      out.slice(0, open) +
      out.slice(open, close + 1).replace(/[^\n]/g, " ") +
      out.slice(close + 1);
    re.lastIndex = close + 1;
  }
  return out;
}

/** Source slices of the top-level `metadata` object and `generateMetadata` body. */
function metadataBodies(src: string): string[] {
  const bodies: string[] = [];
  const meta = /export\s+const\s+metadata\b[^=]*=\s*(?=\{)/.exec(src);
  if (meta) {
    const open = meta.index + meta[0].length;
    const close = matchClose(src, open);
    if (close !== -1) bodies.push(src.slice(open, close + 1));
  }
  const gen = /export\s+(?:async\s+)?function\s+generateMetadata\s*(?:<[^()]*>)?\s*\(/.exec(src);
  if (gen) {
    const parenOpen = gen.index + gen[0].length - 1;
    const parenClose = matchClose(src, parenOpen);
    const bodyOpen = parenClose === -1 ? -1 : src.indexOf("{", parenClose);
    // A return-type annotation (`: Promise<Metadata>`) holds no braces here.
    const bodyClose = bodyOpen === -1 ? -1 : matchClose(src, bodyOpen);
    if (bodyClose !== -1) bodies.push(src.slice(bodyOpen, bodyClose + 1));
  }
  // `export const generateMetadata = async (...) => { ... }` or `=> ({ ... })`.
  const arrow = /export\s+const\s+generateMetadata\b[^=]*=\s*(?:async\s*)?(?:<[^()]*>\s*)?\(/.exec(src);
  if (arrow) {
    const parenOpen = arrow.index + arrow[0].length - 1;
    const parenClose = matchClose(src, parenOpen);
    const arrowAt = parenClose === -1 ? -1 : src.indexOf("=>", parenClose);
    const rest = arrowAt === -1 ? -1 : src.slice(arrowAt + 2).search(/\S/);
    const bodyOpen = rest === -1 ? -1 : arrowAt + 2 + rest;
    if (bodyOpen !== -1 && (src[bodyOpen] === "{" || src[bodyOpen] === "(")) {
      const bodyClose = matchClose(src, bodyOpen);
      if (bodyClose !== -1) bodies.push(src.slice(bodyOpen, bodyClose + 1));
    }
  }
  return bodies;
}

/** String-literal contents of the expression that follows `title:` at `from`. */
function titleLiterals(src: string, from: number): string[] {
  const lits: string[] = [];
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      let text = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") j++;
        else if (ch === "`" && src[j] === "$" && src[j + 1] === "{") {
          const close = matchClose(src, j + 1);
          j = close === -1 ? src.length : close;
          j++;
          continue;
        } else text += src[j];
        j++;
      }
      lits.push(text);
      i = j;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      if (depth === 0) break;
      depth--;
    } else if ((ch === "," || ch === ";") && depth === 0) break;
  }
  return lits;
}

/** String-literal contents of every `const|let|var name = ...` in `src`. */
function declaredLiterals(src: string, name: string): string[] {
  const escaped = name.replace(/\$/g, "\\$");
  const re = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b[^=;]*=\\s*`, "g");
  const lits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) lits.push(...titleLiterals(src, m.index + m[0].length));
  return lits;
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

/**
 * Every top-level title string literal in `source` that carries the brand or a
 * pipe. An object-form `title: { template, default }` is the root layout's
 * business (assertion 1) and is not a string title, so it is skipped here.
 */
function findBrandedTitles(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const stripped = code(source);
  for (const raw of metadataBodies(stripped)) {
    const body = blankSocialBlocks(raw);
    const flag = (lits: string[], at: number) => {
      const bad = lits.find((t) => /Quantalyze/.test(t) || t.includes("|"));
      if (bad === undefined) return;
      const upToHere = stripped.indexOf(raw) + at;
      hits.push({ file, line: stripped.slice(0, upToHere).split("\n").length, text: bad });
    };
    const re = /\btitle\s*:\s*(?![\s{])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const from = m.index + m[0].length;
      const lits = titleLiterals(body, from);
      // `title: someVar` resolves to the literal(s) `someVar` is declared with.
      const ident = /^([A-Za-z_$][\w$]*)\s*(?=[,}])/.exec(body.slice(from));
      if (ident) lits.push(...declaredLiterals(stripped, ident[1]));
      flag(lits, m.index);
    }
    // Shorthand `{ title }`, resolved the same way.
    const shorthand = /(?<![.\w$])title(?=\s*[,}])/g;
    while ((m = shorthand.exec(body))) {
      flag(declaredLiterals(stripped, "title"), m.index);
    }
  }
  return hits;
}

/**
 * Every object-form `title: { ... }` in a metadata export, whatever its keys or
 * their order. Only the root layout may write one (its `template` and `default`
 * own the brand); anywhere else it replaces the root template for its subtree.
 */
function findObjectFormTitles(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const stripped = code(source);
  for (const raw of metadataBodies(stripped)) {
    const body = blankSocialBlocks(raw);
    const re = /\btitle\s*:\s*\{\s*(\w+)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const upToHere = stripped.indexOf(raw) + m.index;
      hits.push({ file, line: stripped.slice(0, upToHere).split("\n").length, text: m[1] ?? "{" });
    }
  }
  return hits;
}

/** Does this file export `metadata` or `generateMetadata`? */
function exportsTitle(source: string): boolean {
  return /export\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b|const\s+generateMetadata\b)/.test(
    code(source),
  );
}

/** Titled per `exportsTitle`, yet no metadata object or body could be scanned. */
function titledButUnscanned(source: string): boolean {
  return exportsTitle(source) && metadataBodies(code(source)).length === 0;
}

/** A page is titled by itself or by a `layout.tsx` in its own directory. */
function isTitled(pageRel: string): boolean {
  if (exportsTitle(read(pageRel))) return true;
  const layout = join(dirname(pageRel), "layout.tsx");
  return existsSync(join(REPO_ROOT, layout)) && exportsTitle(read(layout));
}

function listFiles(dir: string, names: Set<string>, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      listFiles(abs, names, out);
    } else if (names.has(entry)) {
      out.push(relative(REPO_ROOT, abs).split("\\").join("/"));
    }
  }
  return out;
}

const allRouteFiles = listFiles(APP, new Set(["page.tsx", "layout.tsx"]));
const titledGroupPages = allRouteFiles.filter(
  (f) =>
    f.endsWith("/page.tsx") &&
    (f.startsWith("src/app/(dashboard)/") || f.startsWith("src/app/(auth)/")),
);

describe("page-title census — self-tests (the matchers can fail)", () => {
  it("flags a brand-suffixed and a piped static title", () => {
    expect(
      findBrandedTitles('export const metadata = { title: "X | Quantalyze" };\n', "a.tsx"),
    ).toHaveLength(1);
    expect(
      findBrandedTitles('export const metadata = { title: "Decks — Quantalyze" };\n', "a.tsx"),
    ).toHaveLength(1);
    expect(findBrandedTitles('export const metadata = { title: "A | B" };\n', "a.tsx")).toHaveLength(1);
  });

  it("flags a branded title inside generateMetadata, template literal or ternary", () => {
    const src = [
      "export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {",
      "  const { id } = await params;",
      "  return { title: id ? `${id} | Quantalyze` : \"Fallback\" };",
      "}",
    ].join("\n");
    const hits = findBrandedTitles(src, "b.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it("flags a branded title written as shorthand `{ title }` or `title: someVar`", () => {
    const shorthand = [
      "export async function generateMetadata() {",
      "  const title = `${name} — Quantalyze Factsheet`;",
      "  return { title, description: \"d\" };",
      "}",
    ].join("\n");
    const hits = findBrandedTitles(shorthand, "e.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
    const variable = [
      'const heading = "Decks | Quantalyze";',
      "export const metadata = { title: heading };",
    ].join("\n");
    expect(findBrandedTitles(variable, "e.tsx")).toHaveLength(1);
  });

  it("flags a branded title inside an arrow-form generateMetadata", () => {
    const block = [
      "export const generateMetadata = async ({ params }: P): Promise<Metadata> => {",
      '  return { title: "Decks | Quantalyze" };',
      "};",
    ].join("\n");
    expect(findBrandedTitles(block, "f.tsx")).toHaveLength(1);
    const expression = 'export const generateMetadata = async () => ({ title: "Decks — Quantalyze" });\n';
    expect(findBrandedTitles(expression, "f.tsx")).toHaveLength(1);
  });

  it("flags a branded title inside a generic generateMetadata", () => {
    const src = [
      "export async function generateMetadata<T extends string>(props: P<T>) {",
      '  return { title: "Decks | Quantalyze" };',
      "}",
    ].join("\n");
    expect(findBrandedTitles(src, "g.tsx")).toHaveLength(1);
  });

  it("flags an object-form title with `absolute` or `default`, in a non-root file", () => {
    expect(
      findObjectFormTitles('export const metadata = { title: { absolute: "X" } };\n', "h.tsx"),
    ).toHaveLength(1);
    expect(
      findObjectFormTitles('export const metadata = { title: { default: "X" } };\n', "h.tsx"),
    ).toHaveLength(1);
    expect(findObjectFormTitles('export const metadata = { title: "X" };\n', "h.tsx")).toEqual([]);
  });

  it("flags an object-form title whatever its keys or key order (a nested `template` too)", () => {
    expect(
      findObjectFormTitles('export const metadata = { title: { template: "%s | Admin" } };\n', "h.tsx"),
    ).toHaveLength(1);
    expect(
      findObjectFormTitles(
        'export const metadata = { title: { template: "%s | Admin", default: "Admin" } };\n',
        "h.tsx",
      ),
    ).toHaveLength(1);
    expect(
      findObjectFormTitles(
        'export const metadata = { title: { template: "%s", absolute: "X" } };\n',
        "h.tsx",
      ),
    ).toHaveLength(1);
  });

  it("keeps the social-card exemption for shorthand and variable titles", () => {
    const src = [
      'const social = "Decks | Quantalyze";',
      "export const metadata = {",
      '  title: "Decks",',
      "  openGraph: {",
      "    title: social,",
      "  },",
      "  twitter: { title },",
      "};",
    ].join("\n");
    expect(findBrandedTitles(src, "i.tsx")).toEqual([]);
    expect(
      findObjectFormTitles(
        'export const metadata = { openGraph: { title: { default: "X" } } };\n',
        "i.tsx",
      ),
    ).toEqual([]);
  });

  it("does NOT flag a bare title, an interpolation, a `||` operator, or social-card titles", () => {
    const src = [
      "export const metadata = {",
      '  title: "Decks",',
      "  openGraph: { title: \"Decks | Quantalyze\" },",
      "  twitter: { title: \"Decks — Quantalyze\" },",
      "};",
      "export async function generateMetadata() {",
      "  return { title: `${name || other} overview` };",
      "}",
    ].join("\n");
    expect(findBrandedTitles(src, "c.tsx")).toEqual([]);
  });

  it("does NOT flag a brand mention inside a comment, nor the root object-form title", () => {
    const src = [
      '// title: "Old | Quantalyze"',
      "export const metadata = {",
      '  title: { template: "%s — Quantalyze", default: "Quantalyze" },',
      "};",
    ].join("\n");
    expect(findBrandedTitles(src, "d.tsx")).toEqual([]);
  });

  it("flags a titled file whose metadata the scanner cannot read", () => {
    expect(
      titledButUnscanned(
        'export const generateMetadata = async function () { return { title: "A | Quantalyze" }; };\n',
      ),
    ).toBe(true);
    expect(
      titledButUnscanned('export const generateMetadata = async p => ({ title: "A | Quantalyze" });\n'),
    ).toBe(true);
    expect(titledButUnscanned('export const metadata = { title: "A" };\n')).toBe(false);
    expect(titledButUnscanned("export default function Page() { return null; }\n")).toBe(false);
  });

  it("treats an untitled page as untitled and a titled one as titled", () => {
    expect(exportsTitle("export default function Page() { return null; }\n")).toBe(false);
    expect(exportsTitle('export const metadata = { title: "X" };\n')).toBe(true);
    expect(exportsTitle("export async function generateMetadata() { return {}; }\n")).toBe(true);
    expect(exportsTitle('// export const metadata = { title: "X" };\n')).toBe(false);
  });
});

describe("page-title census — the title contract across src/app", () => {
  it("scans a real population (an empty scan would pass vacuously)", () => {
    expect(allRouteFiles.length).toBeGreaterThan(50);
    expect(titledGroupPages.length).toBeGreaterThan(35);
    expect(titledGroupPages).toContain("src/app/(dashboard)/decks/page.tsx");
    expect(titledGroupPages).toContain("src/app/(auth)/login/page.tsx");
    for (const carveOut of REDIRECT_ONLY_PAGES) {
      expect(titledGroupPages, `carve-out ${carveOut} is no longer a page`).toContain(carveOut);
    }
    const scanned = allRouteFiles.filter((f) => metadataBodies(code(read(f))).length > 0);
    expect(scanned.length).toBeGreaterThan(40);
  });

  it("1. the root layout carries the title template and default, written once", () => {
    const root = code(read(ROOT_LAYOUT));
    expect(root).toMatch(/template\s*:\s*"%s — Quantalyze"/);
    expect(root).toMatch(/default\s*:\s*"Quantalyze"/);
    expect(root).not.toMatch(/\babsolute\s*:/);
  });

  it("2. no top-level title contains the brand or a pipe (the template adds the suffix once)", () => {
    const hits = allRouteFiles.flatMap((f) => findBrandedTitles(read(f), f));
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${JSON.stringify(h.text)}`).join("\n");
    expect(
      hits,
      `A top-level metadata title writes the brand or a pipe itself, so the root template ` +
        `would double it ("X — Quantalyze — Quantalyze"):\n${report}\n` +
        `Export the bare title; openGraph and twitter titles are not covered by this rule.`,
    ).toEqual([]);
  });

  it("2b. no page or layout but the root layout writes an object-form title (any keys)", () => {
    const hits = allRouteFiles
      .filter((f) => f !== ROOT_LAYOUT)
      .flatMap((f) => findObjectFormTitles(read(f), f));
    const report = hits.map((h) => `  ${h.file}:${h.line}  title.${h.text}`).join("\n");
    expect(
      hits,
      `Only the root layout owns the title template and default; these bypass or restate ` +
        `it:\n${report}\nExport a bare string title instead.`,
    ).toEqual([]);
  });

  it("2c. every titled route file yields at least one scanned metadata object or body", () => {
    const unscanned = allRouteFiles.filter((f) => titledButUnscanned(read(f)));
    expect(
      unscanned,
      `These files export a title but the scanner read no metadata object or body from them, ` +
        `so assertion 2 checked nothing in them:\n  ${unscanned.join("\n  ")}`,
    ).toEqual([]);
  });

  it("3. every (dashboard) and (auth) page is titled (strategies/new and preferences only redirect)", () => {
    const untitled = titledGroupPages.filter(
      (f) => !REDIRECT_ONLY_PAGES.includes(f) && !isTitled(f),
    );
    expect(
      untitled,
      `These pages export no metadata/generateMetadata, in their own file or a layout.tsx in ` +
        `their directory, so their tab falls back to the bare brand:\n  ${untitled.join("\n  ")}`,
    ).toEqual([]);
  });

  it("3b. the two redirect-only carve-outs really only redirect", () => {
    for (const rel of REDIRECT_ONLY_PAGES) {
      expect(code(read(rel)), `${rel} no longer redirects; it needs a title`).toMatch(
        /\bredirect\s*\(/,
      );
    }
  });

  it("4. /strategies and /my-strategies carry different PageHeader titles", () => {
    const headerTitle = (rel: string) =>
      /<PageHeader\b[\s\S]*?\btitle="([^"]*)"/.exec(code(read(rel)))?.[1];
    const strategies = headerTitle("src/app/(dashboard)/strategies/page.tsx");
    const mine = headerTitle("src/app/(dashboard)/my-strategies/page.tsx");
    expect(strategies, "/strategies has no literal PageHeader title").toBeTruthy();
    expect(mine, "/my-strategies has no literal PageHeader title").toBeTruthy();
    expect(strategies).not.toBe(mine);
  });
});
