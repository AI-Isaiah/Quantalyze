/**
 * Phase 164.6.6.3.1 / D-07 (170.6-DISCLAIMER-ONCE) — every dashboard route
 * renders exactly ONE footer disclaimer, and it is the one `DashboardChrome`
 * owns.
 *
 * THE DEFECT. `/recommendations` and `/portfolios/[id]` each rendered their
 * own footer `Disclaimer` inside the page, and `DashboardChrome` renders one
 * around every page, so the legal footer printed twice on those two routes.
 * Both pages dropped theirs.
 *
 * WHY A CENSUS, AND WHY IT HAS A POSITIVE CONTROL. The risk in removing a
 * duplicate is removing the wrong one: a disclaimer dropped from a route that
 * the chrome does NOT cover is a legal footer silently gone (threat
 * T-164.6.6.3.1-05). So the negative below (no page-level `<Disclaimer`) is
 * paired with a positive control: the chrome source, comment-stripped, carries
 * the footer mount exactly twice (once per layout arm). Without it, a chrome
 * that lost its footer would leave this guard green while every route lost its
 * disclaimer.
 *
 * THE POPULATION is derived from disk on every run: a page added tomorrow is
 * covered without editing this file. It covers every non-test `.ts`/`.tsx`
 * under `src/app/(dashboard)`, not only `page.tsx`, so a disclaimer smuggled
 * into a route-local component is seen too. Comments are stripped first
 * (`stripCommentsPreserveLines`), so prose naming the tag does not trip it and
 * reported line numbers stay real.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const DASHBOARD = join(REPO_ROOT, "src", "app", "(dashboard)");
const CHROME = "src/components/layout/DashboardChrome.tsx";

/** A `<Disclaimer` JSX opening tag (not `<DisclaimerBanner`). */
const DISCLAIMER_TAG_RE = /<Disclaimer\b/;
/** The footer mount the chrome owns. */
const CHROME_FOOTER_RE = /<Disclaimer variant="footer"/g;

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Every line of COMMENT-STRIPPED `source` that opens a `<Disclaimer` tag. */
function findDisclaimerTags(source: string, file: string): Hit[] {
  const code = stripCommentsPreserveLines(source, "ts");
  const hits: Hit[] = [];
  code.split("\n").forEach((text, i) => {
    if (DISCLAIMER_TAG_RE.test(text)) {
      hits.push({ file, line: i + 1, text: text.trim() });
    }
  });
  return hits;
}

function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}

function listScannedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      listScannedFiles(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("dashboard disclaimer census — self-tests (the matcher can fail)", () => {
  it("reports a Disclaimer tag in code", () => {
    const hits = findDisclaimerTags("const a = 1;\n<Disclaimer />\n", "sample.tsx");
    expect(hits.map((h) => h.line)).toEqual([2]);
  });

  it("reports a Disclaimer tag with props", () => {
    expect(
      findDisclaimerTags('<Disclaimer variant="footer" />\n', "sample.tsx"),
    ).toHaveLength(1);
  });

  it("does NOT report the tag inside a line comment, a block comment or a JSX comment", () => {
    const src = [
      "// <Disclaimer />",
      "/* <Disclaimer variant=\"footer\" /> */",
      "const x = (",
      "  <div>{/* <Disclaimer /> */}</div>",
      ");",
    ].join("\n");
    expect(findDisclaimerTags(src, "sample.tsx")).toEqual([]);
  });

  it("does NOT report a longer component name or a bare import", () => {
    const src = [
      'import { Disclaimer } from "@/components/ui/Disclaimer";',
      "<DisclaimerBanner />",
    ].join("\n");
    expect(findDisclaimerTags(src, "sample.tsx")).toEqual([]);
  });
});

describe("dashboard disclaimer census — one footer disclaimer per dashboard route", () => {
  const files = listScannedFiles(DASHBOARD);

  it("scans a real population (an empty scan would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/app/(dashboard)/recommendations/page.tsx");
    expect(files).toContain("src/app/(dashboard)/portfolios/[id]/page.tsx");
    expect(files.some(isTestPath)).toBe(false);
  });

  it("positive control: DashboardChrome renders the footer disclaimer exactly twice (once per layout arm)", () => {
    const code = stripCommentsPreserveLines(read(CHROME), "ts");
    const mounts = code.match(CHROME_FOOTER_RE) ?? [];
    expect(
      mounts,
      `${CHROME} no longer mounts the footer Disclaimer once in each layout arm. ` +
        `Every dashboard route relies on it for its legal footer.`,
    ).toHaveLength(2);
  });

  it("no dashboard page or route-local component renders its own Disclaimer", () => {
    const hits = files.flatMap((f) => findDisclaimerTags(read(f), f));
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(
      hits,
      `A dashboard source file renders its own Disclaimer, so that route prints the ` +
        `legal footer twice (DashboardChrome already renders one):\n${report}\n` +
        `Delete it; do not add a second one.`,
    ).toEqual([]);
  });
});
