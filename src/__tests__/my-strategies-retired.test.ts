import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import nextConfig from "../../next.config";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import { ROUTE_CONTRACT_MANIFEST } from "@/lib/routing/route-contract-manifest";

/**
 * Phase 199 MANAGERHOME (D-01, CD-06; LEAN-01, SC-2): `/my-strategies` is
 * retired. Every strategy owner, allocator or manager, reads ONE list at
 * `/strategies`, so the old URL is a config-level permanent redirect to it, the
 * query string kept, and nothing renders at the old path.
 *
 * WHY each assertion matters:
 *  - destination + permanent: an allocator's bookmark, a sidebar link cached in
 *    a browser tab or an emailed URL to /my-strategies must land on the one
 *    list, never on a 404 (LEAN-01). A 308 is method-preserving and cached by
 *    browsers: the founder accepted that in D-01, so the cached move is a known
 *    one-way door, not an accident this test should hide.
 *  - no `has`/`missing`: the rule must be unconditional. A cookie- or
 *    header-conditional rule would answer a signed-in and an anonymous visitor
 *    differently; the destination (`/strategies`) and the proxy decide who may
 *    read it, the redirect reads nothing (ROUTE-02).
 *  - manifest lockstep: the manifest row is class `exception` (no backing page,
 *    the same carve-out as `/scenarios`) with `redirectFrom` byte-equal to the
 *    config source, so `npm run check:route-contract` (#512, Rules 3 and 4)
 *    accepts the deleted page. The `/strategies` row is session-gated and says
 *    every strategy owner reads it.
 *  - no production link: a link to the old path would still work through the
 *    308 but would cost every click a redirect hop and say the retired route is
 *    alive. The population is derived from disk, with a floor, so a broken walk
 *    cannot pass vacuously.
 *
 * It proves the SHAPE of the config. It does NOT prove the live 308 status or
 * the query-string carry-over: that is the first-hop canary in
 * `e2e/route-redirects.spec.ts` (plan 199-17).
 */

type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: unknown[];
  missing?: unknown[];
};

const OLD_PATH = "/my-strategies";
const NEW_PATH = "/strategies";

/**
 * Does comment-stripped next.config.ts carry `source -> destination` with this
 * `permanent` flag, keys in that order? Same helper shape as
 * `trim-removed-surfaces.test.tsx` (`hasRedirectRule`).
 */
function hasRedirectRule(
  stripped: string,
  source: string,
  destination: string,
  permanent: boolean,
): boolean {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `source:\\s*"${esc(source)}",\\s*destination:\\s*"${esc(destination)}",\\s*permanent:\\s*${permanent}\\b`,
  ).test(stripped);
}

const strippedConfig = stripCommentsPreserveLines(
  readFileSync(join(process.cwd(), "next.config.ts"), "utf8"),
  "ts",
);

async function rules(): Promise<RedirectRule[]> {
  return (await nextConfig.redirects!()) as RedirectRule[];
}

describe("hasRedirectRule self-test (the matcher can fail)", () => {
  const rule = (permanent: boolean) =>
    `{ source: "/my-strategies", destination: "/strategies", permanent: ${permanent}, }`;

  it("accepts the exact rule and rejects a flipped flag, a wrong destination and a wrong source", () => {
    expect(hasRedirectRule(rule(true), OLD_PATH, NEW_PATH, true)).toBe(true);
    expect(hasRedirectRule(rule(false), OLD_PATH, NEW_PATH, false)).toBe(true);
    expect(hasRedirectRule(rule(false), OLD_PATH, NEW_PATH, true)).toBe(false);
    expect(hasRedirectRule(rule(true), OLD_PATH, "/elsewhere", true)).toBe(false);
    expect(hasRedirectRule(rule(true), "/other", NEW_PATH, true)).toBe(false);
  });
});

describe("/my-strategies is retired (Phase 199 D-01, CD-06)", () => {
  it("next.config.ts carries a permanent /my-strategies -> /strategies rule", () => {
    expect(
      hasRedirectRule(strippedConfig, OLD_PATH, NEW_PATH, true),
      `next.config.ts no longer 308s ${OLD_PATH} to ${NEW_PATH}. The old URL must keep leading to the one list (Phase 199 D-01, CD-06).`,
    ).toBe(true);
  });

  it("redirects() returns that rule once, unconditionally, and the destination carries no query of its own", async () => {
    const matches = (await rules()).filter((r) => r.source === OLD_PATH);
    expect(matches).toHaveLength(1);
    const [r] = matches;
    expect(r.destination).toBe(NEW_PATH);
    expect(r.permanent).toBe(true);
    // Unconditional: no has/missing. The original query string is carried by
    // the redirect itself, so a destination query would shadow it.
    expect(r.has).toBeUndefined();
    expect(r.missing).toBeUndefined();
    expect(r.destination).not.toContain("?");
  });

  it("the manifest row is class exception with redirectFrom byte-equal to the config source", async () => {
    const row = ROUTE_CONTRACT_MANIFEST.find((e) => e.route === OLD_PATH);
    expect(row, `${OLD_PATH} has no manifest row`).toBeDefined();
    expect(row!.class).toBe("exception");
    expect(row!.redirectFrom).toBe(OLD_PATH);
    expect((await rules()).map((r) => r.source)).toContain(row!.redirectFrom);
  });

  it("the /strategies manifest row says every strategy owner reads it and stays session-gated", () => {
    const row = ROUTE_CONTRACT_MANIFEST.find((e) => e.route === NEW_PATH);
    expect(row, `${NEW_PATH} has no manifest row`).toBeDefined();
    expect(row!.class).toBe("private");
    expect(row!.notes).toMatch(/every strategy owner/i);
  });
});

// ---------------------------------------------------------------------------
// No production link to the retired path
// ---------------------------------------------------------------------------

/**
 * The one production file allowed to name the old path: the manifest, whose
 * `redirectFrom` must stay byte-equal to the config source (Rule 3). Excluded
 * BY NAME so a second exemption needs a visible edit here.
 */
const LINK_EXEMPT = "src/lib/routing/route-contract-manifest.ts";

/**
 * The retired path as it would appear in code: any `/my-strategies` that is not
 * the prefix of a longer word. Run on comment-stripped source, so prose naming
 * the old route cannot trip it, and a quoted literal, a template literal and a
 * `?redirect=/my-strategies` value all do.
 */
const OLD_PATH_RE = /\/my-strategies(?![\w-])/;

function isTestPath(rel: string): boolean {
  return (
    /\.test\.[^/]+$/.test(rel) ||
    /\.d\.ts$/.test(rel) ||
    rel.split("/").includes("__tests__")
  );
}

function listProductionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      listProductionSources(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(process.cwd(), abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
  return out;
}

function linkOffenders(files: string[]): string[] {
  const hits: string[] = [];
  for (const rel of files) {
    if (rel === LINK_EXEMPT) continue;
    const stripped = stripCommentsPreserveLines(
      readFileSync(join(process.cwd(), rel), "utf8"),
      "ts",
    );
    stripped.split("\n").forEach((text, i) => {
      if (OLD_PATH_RE.test(text)) hits.push(`${rel}:${i + 1}  ${text.trim()}`);
    });
  }
  return hits;
}

describe("no production link to the retired /my-strategies (Phase 199 D-01)", () => {
  const files = listProductionSources(join(process.cwd(), "src"));

  it("the matcher can fail: it flags a link, a redirect param and a template literal, and ignores a longer word", () => {
    expect(OLD_PATH_RE.test('<a href="/my-strategies">')).toBe(true);
    expect(OLD_PATH_RE.test('redirect("/login?redirect=/my-strategies")')).toBe(true);
    expect(OLD_PATH_RE.test("`/my-strategies?x=${x}`")).toBe(true);
    expect(OLD_PATH_RE.test('"/my-strategies-archive"')).toBe(false);
    expect(OLD_PATH_RE.test("MyStrategiesSection")).toBe(false);
  });

  it("walks a real population of production files (an empty walk would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/components/layout/Sidebar.tsx");
    expect(files).toContain("src/app/(dashboard)/strategies/page.tsx");
    expect(files).toContain(LINK_EXEMPT);
    expect(files.some(isTestPath)).toBe(false);
  });

  it("no production file links /my-strategies", () => {
    const offenders = linkOffenders(files);
    expect(
      offenders,
      `The route /my-strategies was retired in Phase 199 (D-01): link to /strategies instead.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
