// @vitest-environment node
/**
 * Phase 201 plan 06 (D-08, D-03, D-11, D-19, D-21): the copy census scanner, proven two ways.
 *
 * A scanner that matches nothing reads as "the tree is clean", which is exactly the answer a
 * census must not get for free. So every rule is planted both ways: a RED arm that must be
 * found and a GREEN look-alike that must stay quiet, once through `scanSource` and once
 * through `scanTree` over a temporary tree (the `withPlanted` shape of the figure-gate census).
 *
 * The live tree's counts are asserted by the census test (`src/__tests__/copy-census.test.ts`).
 * Nothing here asserts a live count.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { listScannedFiles, scanSource, scanTree, type ScanPolicy } from "./scan";
import {
  DATES,
  DATE_HELPER_FILES,
  DISCOVERY_ONLY_KEYS,
  EXCEPTIONS,
  EXCLUDED_FILES,
  POLICY,
  RETIRED_WORDS,
  isValidReason,
} from "./policy";

const FILE = "src/components/x/Planted.tsx";

/** Rule A hits for a planted source. */
function a(source: string, file = FILE) {
  return scanSource(file, source, POLICY).filter((h) => h.rule === "A");
}

function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "copy-census-selftest-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("rule A: a retired word in user-visible copy", () => {
  describe("RED arms: each is one hit", () => {
    it("flags JSX text", () => {
      const hits = a("export const C = () => <h2>Saved portfolios</h2>;\n");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ rule: "A", file: FILE, line: 1, kind: "jsx-text", text: "Saved portfolios" });
    });

    it("flags a prose-shaped string with an apostrophe", () => {
      expect(a('export const s = "Your book\'s history";\n')).toHaveLength(1);
    });

    it("is case-sensitive for the exact phrase My Allocation, and only for it", () => {
      expect(a('export const s = "My Allocation";\n')).toHaveLength(1);
      expect(a('export const s = "My allocation";\n')).toHaveLength(0);
    });

    it("flags my strategies in any case", () => {
      expect(a('export const s = "Add to my strategies";\n')).toHaveLength(1);
      expect(a('export const s = "Add to My Strategies";\n')).toHaveLength(1);
    });

    it("flags the exact phrase My Watchlist", () => {
      expect(a('export const s = "My Watchlist";\n')).toHaveLength(1);
      expect(a('export const s = "my watchlist";\n')).toHaveLength(0);
    });

    // F-04, U-30: "Bridge" is retired from user-visible copy. Case-sensitive, so the
    // `source: "bridge"` value, the `[bridge]` log tags and `BridgeDrawer` stay unread.
    it("flags the retired word Bridge in JSX text, an aria-label and a prose string", () => {
      expect(a("export const C = () => <p>Open Bridge</p>;\n")).toHaveLength(1);
      expect(a('export const C = () => <button aria-label="Bridge drawer">x</button>;\n')).toHaveLength(1);
      expect(a('export const s = "Bridge flags holdings";\n')).toHaveLength(1);
      expect(a("export const C = () => <p>Open Bridge</p>;\n")[0].id).toBe("bridge");
    });

    it("is case-sensitive for Bridge: a lowercase string value or log tag and a component name are not hits", () => {
      expect(a('export const x = { source: "bridge" };\n')).toHaveLength(0);
      expect(a('export const s = "[bridge] fetch";\n')).toHaveLength(0);
      expect(a("export const C = () => <BridgeDrawer open />;\n")).toHaveLength(0);
      // These two are the ones a case-insensitive matcher would read: lowercase prose, and a
      // lowercase single token in a copy attribute. Without them the arm cannot fail on that change.
      expect(a('export const s = "the bridge between two accounts";\n')).toHaveLength(0);
      expect(a('export const C = () => <input placeholder="bridge" />;\n')).toHaveLength(0);
    });

    it("flags favorites, starred and preferences", () => {
      expect(a('export const s = "Your favorites";\n')).toHaveLength(1);
      expect(a('export const s = "Starred items";\n')).toHaveLength(1);
      expect(a("export const C = () => <p>Notification preferences</p>;\n")).toHaveLength(1);
    });

    it("flags a whitelisted attribute even when the value is one lowercase token", () => {
      const hits = a('export const C = () => <input placeholder="portfolio" />;\n');
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe("jsx-attr");
    });

    it("flags a copy-named attribute wrapped in an expression container, lowercase single token included", () => {
      expect(a('export const C = () => <input placeholder={"portfolio"} />;\n')).toHaveLength(1);
      expect(a('export const C = (x: boolean) => <Row label={x ? "portfolio" : "other"} />;\n')).toHaveLength(1);
      expect(a('export const x = (c: boolean) => ({ title: c ? "portfolios" : "none" });\n')).toHaveLength(1);
    });

    it("flags copy in display attributes the scanner does not treat as non-copy (name, value, variant)", () => {
      expect(a("export const C = (n: number) => <Section name={`Saved ${n} portfolios`} />;\n")).toHaveLength(1);
      expect(a("export const C = (n: number) => <Opt value={`${n} portfolios`} />;\n")).toHaveLength(1);
      expect(a('export const C = () => <Badge variant={cn("Saved portfolios")} />;\n')).toHaveLength(1);
    });

    it("flags a copy-named property and a capitalised single-token string", () => {
      expect(a('export const x = { title: "portfolios" };\n')).toHaveLength(1);
      expect(a('export const x = { kind: "Portfolio" };\n')).toHaveLength(1);
    });

    it("flags a template part (head, middle and tail)", () => {
      expect(a("export const f = (n: number) => `Saved portfolios: ${n}`;\n")).toHaveLength(1);
      expect(a("export const f = (n: number) => `${n} portfolios saved`;\n")).toHaveLength(1);
      expect(a("export const f = (n: number) => `Saved ${n} portfolios`;\n")).toHaveLength(1);
    });

    it("flags a phrase wrapped across two JSX text lines as one hit", () => {
      const hits = a("export const C = () => (\n  <p>\n    Add to my\n    strategies\n  </p>\n);\n");
      expect(hits).toHaveLength(1);
      expect(hits[0].text).toBe("Add to my strategies");
    });

    it("reports one hit per node however many retired words it carries", () => {
      expect(a("export const C = () => <p>Your portfolio book favorites</p>;\n")).toHaveLength(1);
    });

    it("reports the line of the text, not of the element that opens above it", () => {
      const hits = a("export const C = () => (\n  <div>\n\n    Saved portfolios\n  </div>\n);\n");
      expect(hits).toHaveLength(1);
      expect(hits[0].line).toBe(4);
    });
  });

  describe("GREEN look-alikes: each is none", () => {
    it("ignores comments", () => {
      expect(a("// portfolio\n/* the book of preferences */\nexport const x = 1; // favorites\n")).toHaveLength(0);
      expect(a("export const C = () => <p>{/* portfolio */}ok</p>;\n")).toHaveLength(0);
    });

    it("ignores class names and test ids", () => {
      expect(a('export const C = () => <div className="portfolio-card" />;\n')).toHaveLength(0);
      expect(a('export const C = () => <div data-testid="portfolio-row" />;\n')).toHaveLength(0);
      expect(a('export const C = () => <div className={cn("flex portfolio card")} />;\n')).toHaveLength(0);
      expect(a("export const C = (x: boolean) => <div className={`portfolio-card ${x}`} />;\n")).toHaveLength(0);
    });

    it("ignores import and export specifiers and dynamic imports", () => {
      expect(a('import { x } from "./portfolio-insights";\nexport { y } from "./book-figures";\n')).toHaveLength(0);
      expect(a('export const m = () => import("./my portfolio");\n')).toHaveLength(0);
      expect(a('export const m = require("./my portfolio");\n')).toHaveLength(0);
    });

    it("ignores log calls and query-builder arguments", () => {
      expect(a('console.log("portfolio");\n')).toHaveLength(0);
      expect(a('logger.warn("Saved portfolios failed");\n')).toHaveLength(0);
      expect(a('Sentry.captureMessage("Saved portfolios failed");\n')).toHaveLength(0);
      expect(a('captureToSentry(err, "Saved portfolios failed");\n')).toHaveLength(0);
      expect(a('const q = supabase.from("portfolios").select("id, portfolio_id");\n')).toHaveLength(0);
      expect(a('const q = t.rpc("get_portfolio_book");\n')).toHaveLength(0);
      expect(a('const q = t.eq("kind", "Portfolio").order("book");\n')).toHaveLength(0);
    });

    it("ignores property names, element-access keys, case labels and literal types", () => {
      expect(a('export const x = { "my strategies": 1 };\n')).toHaveLength(0);
      expect(a('export const v = (o: Record<string, number>) => o["Saved portfolios"];\n')).toHaveLength(0);
      expect(a('export const f = (k: string) => { switch (k) { case "Portfolio": return 1; } return 0; };\n')).toHaveLength(0);
      expect(a('export type K = "Portfolio" | "Book of work";\n')).toHaveLength(0);
    });

    it("ignores snake_case and kebab-case identifiers in string form", () => {
      expect(a('export const x = "portfolio_id";\n')).toHaveLength(0);
      expect(a('export const x = "portfolio-card";\n')).toHaveLength(0);
      expect(a('export const x = { kind: "portfolio" };\n')).toHaveLength(0);
    });

    it("ignores a word that merely contains a retired word", () => {
      expect(a('export const x = "Bookmark this";\n')).toHaveLength(0);
      expect(a("export const C = () => <p>Textbooks are not preferential</p>;\n")).toHaveLength(0);
    });

    it("does not flag a copy-neutral JSX text", () => {
      expect(a("export const C = () => <h2>Saved strategies</h2>;\n")).toHaveLength(0);
    });
  });

  it("keeps rule A to src/ and leaves an EXCLUDED_FILES row alone", () => {
    const src = "export const C = () => <h2>Saved portfolios</h2>;\n";
    expect(scanSource("scripts/x.tsx", src, POLICY)).toHaveLength(0);
    expect(scanSource("src/lib/seam-retry-registry.ts", 'export const s = "Saved portfolios";\n', POLICY)).toHaveLength(0);
    expect(scanSource("src/lib/other.ts", 'export const s = "Saved portfolios";\n', POLICY)).toHaveLength(1);
  });

  it("takes its words from the policy it is given (mechanism holds no word list)", () => {
    const only: ScanPolicy = {
      applies: (rule) => rule === "A",
      retiredWords: [{ id: "planted", re: /\bzebra\b/ }],
      terms: [],
      dates: { deprecatedHelpers: [], monthNames: [], optionKeys: [], fieldNames: [] },
    };
    expect(scanSource(FILE, "export const C = () => <p>A zebra</p>;\n", only)).toHaveLength(1);
    expect(scanSource(FILE, "export const C = () => <p>Saved portfolios</p>;\n", only)).toHaveLength(0);
  });

  // F-11, D-11, plan 201-40: the field form holds no name list. It reads the policy's `fieldNames`
  // and nothing else, so a planted policy with one invented name hits on that name and not on `asof`.
  it("reads the date field names from the policy it is given (the field form holds no name list)", () => {
    const onlyFields: ScanPolicy = {
      applies: (rule) => rule === "C",
      retiredWords: [],
      terms: [],
      dates: { deprecatedHelpers: [], monthNames: [], optionKeys: [], fieldNames: ["zebraDay"] },
    };
    const hitsOf = (src: string) => scanSource(FILE, src, onlyFields).filter((h) => h.rule === "C");
    expect(hitsOf("export const C = (r: { zebraDay: string }) => <p>{r.zebraDay}</p>;\n")).toHaveLength(1);
    expect(hitsOf("export const C = (r: { asof: string }) => <p>{r.asof}</p>;\n")).toHaveLength(0);
    expect(hitsOf("export const s = (r: { asof: string }) => `as of ${r.asof}`;\n")).toHaveLength(0);
  });

  it("carries one matcher id per retired word the plan names", () => {
    expect(RETIRED_WORDS.map((w) => w.id)).toEqual([
      "portfolio",
      "book",
      "favorites",
      "starred",
      "preference",
      "my-strategies",
      "my-allocation",
      "my-watchlist",
      "bridge",
    ]);
  });
});

describe("scanTree: rule A through the walker, on a temporary tree", () => {
  it("returns the planted hit with repo-relative file, line and text, and skips test paths and .d.ts", () => {
    withPlanted(
      {
        "src/components/Planted.tsx": "export const C = () => (\n  <h2>\n    Saved portfolios\n  </h2>\n);\n",
        "src/components/Planted.test.tsx": "export const C = () => <h2>Saved portfolios</h2>;\n",
        "src/components/Planted.spec.ts": 'export const s = "Saved portfolios";\n',
        "src/components/__tests__/Helper.tsx": "export const C = () => <h2>Saved portfolios</h2>;\n",
        "src/components/__fixtures__/Fixture.tsx": "export const C = () => <h2>Saved portfolios</h2>;\n",
        "src/types/ambient.d.ts": 'export const s = "Saved portfolios";\n',
        "src/components/Clean.tsx": "export const C = () => <h2>Saved strategies</h2>;\n",
        "scripts/outside.tsx": "export const C = () => <h2>Saved portfolios</h2>;\n",
      },
      (dir) => {
        const hits = scanTree(dir, POLICY).filter((h) => h.rule === "A");
        expect(hits).toEqual([
          { rule: "A", id: "portfolio", file: "src/components/Planted.tsx", line: 3, kind: "jsx-text", text: "Saved portfolios" },
        ]);
      },
    );
  });

  it("walks .ts files as well as .tsx files, in a stable order", () => {
    withPlanted(
      {
        "src/lib/b.ts": 'export const s = "Saved portfolios";\n',
        "src/lib/a.ts": 'export const s = "Your book";\n',
      },
      (dir) => {
        expect(scanTree(dir, POLICY).map((h) => h.file)).toEqual(["src/lib/a.ts", "src/lib/b.ts"]);
      },
    );
  });

  it("lists exactly the files it reads: sources in path order, no tests, fixtures or declarations", () => {
    withPlanted(
      {
        "src/lib/b.ts": "export const b = 1;\n",
        "src/lib/a.tsx": "export const a = 1;\n",
        "src/lib/a.test.ts": "export const t = 1;\n",
        "src/lib/__fixtures__/f.ts": "export const f = 1;\n",
        "src/lib/types.d.ts": "export {};\n",
        "src/lib/note.md": "text\n",
      },
      (dir) => {
        expect(listScannedFiles(dir)).toEqual(["src/lib/a.tsx", "src/lib/b.ts"]);
      },
    );
  });
});

/** Rule B hits for a planted source. */
function b(source: string, file = FILE) {
  return scanSource(file, source, POLICY).filter((h) => h.rule === "B");
}

describe("rule B: a registered term in a label position without a Term wrapper or a term marker", () => {
  describe("RED arms", () => {
    it("flags a bare label in JSX text", () => {
      const hits = b("export const C = () => <th>Sharpe</th>;\n");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ rule: "B", id: "sharpe", kind: "jsx-text", text: "Sharpe", line: 1 });
    });

    it("flags a prefix match: the label followed by a space or a parenthesis", () => {
      const hits = b("export const C = () => <h3>Max DD (blend vs allocation)</h3>;\n");
      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe("max_drawdown");
      expect(b("export const C = () => <h3>Sharpe ratio</h3>;\n")).toHaveLength(1);
    });

    it("tries the longest label first, so Sharpe lift is its own key", () => {
      expect(b("export const C = () => <th>Sharpe lift</th>;\n")[0].id).toBe("sharpe_lift");
      expect(b("export const C = () => <th>Sharpe</th>;\n")[0].id).toBe("sharpe");
    });

    it("flags an alias, not just the label", () => {
      expect(b("export const C = () => <th>Ann. Vol</th>;\n")[0].id).toBe("volatility");
      expect(b("export const C = () => <th>Two-sample Kolmogorov-Smirnov</th>;\n")[0].id).toBe("kolmogorov_smirnov");
    });

    it("turns a {comparator} alias into a prefix, in JSX text and on a template head", () => {
      const jsx = b("export const C = ({ bn }: { bn: string }) => <th>α vs {bn}</th>;\n");
      expect(jsx).toHaveLength(1);
      expect(jsx[0].id).toBe("alpha");
      const tpl = b("export const f = (bn: string) => ({ label: `IR vs ${bn}` });\n");
      expect(tpl).toHaveLength(1);
      expect(tpl[0]).toMatchObject({ id: "information_ratio", kind: "property" });
    });

    it("flags label, title and heading attributes, bare or in an expression container", () => {
      expect(b('export const C = () => <Row label="Sharpe" />;\n')).toHaveLength(1);
      expect(b('export const C = () => <Panel title="Omega" />;\n')).toHaveLength(1);
      expect(b('export const C = () => <Panel heading={"Scenario"} />;\n')).toHaveLength(1);
      expect(b('export const C = (x: boolean) => <Row label={x ? "Sharpe" : "Sortino"} />;\n')).toHaveLength(2);
    });

    it("flags object properties named label, title and heading", () => {
      expect(b('export const x = { label: "Sharpe", key: "s" };\n')).toHaveLength(1);
      expect(b('export const x = { title: "Omega" };\n')).toHaveLength(1);
      expect(b('export const x = { heading: "Scenario" };\n')).toHaveLength(1);
    });

    it("flags a Term that sits above a different element, and a term attribute on a different element", () => {
      expect(b('export const C = () => <div term="sharpe"><p><span>Sharpe</span></p></div>;\n')).toHaveLength(1);
      expect(b('export const C = () => <Row label="Sharpe" other={<Row term="sortino" />} />;\n')).toHaveLength(1);
    });
  });

  describe("GREEN look-alikes", () => {
    it("is quiet when the text sits inside a Term element", () => {
      expect(b('export const C = () => <Term k="sharpe">Sharpe</Term>;\n')).toHaveLength(0);
      expect(b('export const C = () => <Term k="sharpe"><span>Sharpe</span></Term>;\n')).toHaveLength(0);
    });

    it("is quiet when the element carries a term attribute", () => {
      expect(b('export const C = () => <Row label="Sharpe" term="sharpe" />;\n')).toHaveLength(0);
      expect(b('export const C = () => <Cell term="sharpe">Sharpe</Cell>;\n')).toHaveLength(0);
    });

    it("is quiet when the object literal carries a term property", () => {
      expect(b('export const x = { label: "Sharpe", term: "sharpe" };\n')).toHaveLength(0);
    });

    it("is quiet on a sentence, a question or an exclamation (not label-shaped)", () => {
      expect(b("export const C = () => <p>Sharpe is annualized.</p>;\n")).toHaveLength(0);
      expect(b("export const C = () => <p>What is Sharpe?</p>;\n")).toHaveLength(0);
      expect(b("export const C = () => <p>Sharpe!</p>;\n")).toHaveLength(0);
    });

    it("is quiet on a string longer than 40 characters or more than 5 words", () => {
      expect(b("export const C = () => <p>Sharpe measured over the whole record to date</p>;\n")).toHaveLength(0);
      expect(b("export const C = () => <p>Sharpe a b c d e</p>;\n")).toHaveLength(0);
      expect(b("export const C = () => <p>Sharpe 123456789012345678901234567890123456</p>;\n")).toHaveLength(0);
    });

    it("is quiet when the label only starts with the term as part of a longer word", () => {
      expect(b("export const C = () => <th>Sharper</th>;\n")).toHaveLength(0);
      expect(b("export const C = () => <th>Betamax</th>;\n")).toHaveLength(0);
    });

    it("is quiet outside label positions: plain attributes and plain properties", () => {
      expect(b('export const C = () => <Row name="Sharpe" />;\n')).toHaveLength(0);
      expect(b('export const x = { key: "Sharpe" };\n')).toHaveLength(0);
      expect(b('export const C = () => <Row aria-label="Sharpe" />;\n')).toHaveLength(0);
    });

    it("is quiet inside a log call", () => {
      expect(b('console.warn({ label: "Sharpe" });\n')).toHaveLength(0);
    });

    it("does not mix rule B into rule A: a registered label is not a retired word", () => {
      expect(a("export const C = () => <th>Sharpe</th>;\n")).toHaveLength(0);
    });
  });

  describe("scopes", () => {
    const src = "export const C = () => <th>Sharpe</th>;\n";
    it("covers src/app and src/components", () => {
      expect(scanSource("src/app/x/page.tsx", src, POLICY).filter((h) => h.rule === "B")).toHaveLength(1);
      expect(scanSource("src/components/x/X.tsx", src, POLICY).filter((h) => h.rule === "B")).toHaveLength(1);
    });

    it.each([
      ["src/components/admin/X.tsx", "the component admin root (U-21)"],
      ["src/app/(dashboard)/admin/page.tsx", "the app admin root (U-21)"],
      ["src/app/api/og/route.tsx", "route copy and the OG image (D-20)"],
      ["src/app/factsheet/[id]/tearsheet/page.tsx", "the print lane (D-20)"],
      ["src/lib/x.tsx", "outside src/app and src/components"],
      ["scripts/x.tsx", "outside src/"],
    ])("leaves %s alone: %s", (file) => {
      expect(scanSource(file, src, POLICY).filter((h) => h.rule === "B")).toHaveLength(0);
    });

    it("matches the six discovery-only keys only in the four discovery files", () => {
      // A label property parses the same in discovery-columns.ts (.ts) and in the .tsx files.
      const planted = (label: string) => `export const x = { label: "${label}" };\n`;
      for (const [label, id] of [
        ["Track", "track"],
        ["AUM", "aum"],
        ["Underwater", "underwater"],
        ["Return curve", "return_curve"],
        ["Return (full record)", "return_full"],
        ["Return (last 6 months)", "return_6m"],
      ] as const) {
        expect(DISCOVERY_ONLY_KEYS).toContain(id);
        for (const f of [
          "src/components/strategy/discovery-columns.ts",
          "src/components/strategy/StrategyTable.tsx",
          "src/components/strategy/StrategyGrid.tsx",
          "src/components/strategy/CustomizeDrawer.tsx",
        ]) {
          const hits = scanSource(f, planted(label), POLICY).filter((h) => h.rule === "B");
          expect(hits.map((h) => h.id), `${label} in ${f}`).toEqual([id]);
        }
        expect(scanSource("src/components/strategy/Other.tsx", planted(label), POLICY).filter((h) => h.rule === "B")).toHaveLength(0);
        expect(scanSource("src/app/browse/page.tsx", planted(label), POLICY).filter((h) => h.rule === "B")).toHaveLength(0);
      }
    });
  });

  describe("matchers are built from GLOSSARY", () => {
    it("has a rule B hit for every registered label and alias, in a non-exempt non-discovery file", () => {
      const discovery = new Set<string>(DISCOVERY_ONLY_KEYS);
      const missed: string[] = [];
      for (const [key, entry] of Object.entries(GLOSSARY) as [TermKey, { label: string; aliases?: readonly string[] }][]) {
        if (discovery.has(key)) continue;
        for (const form of [entry.label, ...(entry.aliases ?? [])]) {
          const text = form.replace("{comparator}", "BTC");
          const tooLong = text.length > 40 || text.split(/\s+/).length > 5;
          if (tooLong) continue;
          const hits = scanSource("src/components/x/X.tsx", `export const C = () => <th>${text.replace(/[<>{}]/g, "")}</th>;\n`, POLICY).filter(
            (h) => h.rule === "B",
          );
          if (hits.length !== 1 || hits[0].id !== key) missed.push(`${key}: ${form}`);
        }
      }
      expect(missed).toEqual([]);
    });
  });
});

/** Rule C hits for a planted source. */
function c(source: string, file = "src/components/x/Dates.tsx") {
  return scanSource(file, source, POLICY).filter((h) => h.rule === "C");
}

describe("rule C: a date printed by anything but the one helper", () => {
  describe("RED arms: each is one hit", () => {
    it("flags toLocaleDateString, with or without arguments", () => {
      expect(c("export const f = (d: Date) => d.toLocaleDateString();\n")).toHaveLength(1);
      expect(c('export const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });\n')).toHaveLength(1);
    });

    it("flags Intl.DateTimeFormat, constructed or called", () => {
      expect(c('export const f = new Intl.DateTimeFormat("en-US");\n')).toHaveLength(1);
      expect(c('export const f = Intl.DateTimeFormat("en-US");\n')).toHaveLength(1);
    });

    it("flags toLocaleString with date options, whatever the receiver", () => {
      expect(c('export const f = (x: Date) => x.toLocaleString("en-US", { month: "short" });\n')).toHaveLength(1);
      expect(c('export const f = (x: Date) => x.toLocaleString("en-US", { weekday: "long", hour: "2-digit" });\n')).toHaveLength(1);
      expect(c('export const f = (x: Date) => x.toLocaleString(undefined, { year: "numeric" });\n')).toHaveLength(1);
      expect(c('export const f = (x: Date) => x.toLocaleString("en-US", { day: "numeric" });\n')).toHaveLength(1);
    });

    it("flags toLocaleString on a new Date receiver even with no options", () => {
      expect(c("export const f = (s: string) => new Date(s).toLocaleString();\n")).toHaveLength(1);
      expect(c("export const f = (s: string) => (new Date(s)).toLocaleString();\n")).toHaveLength(1);
    });

    it("flags a month-name array literal", () => {
      const hits = c('export const M = ["Jan", "Feb", "Mar"];\n');
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ rule: "C", kind: "month-array" });
      expect(c('export const M = ["January", "February", "March", "April"];\n')).toHaveLength(1);
    });

    it("flags a call to, or a reference to, a deprecated date helper", () => {
      const hits = c('import { formatIsoDay } from "@/lib/utils";\nexport const f = (x: string) => formatIsoDay(x);\n');
      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe("formatIsoDay");
      expect(c("export const f = (x: string) => formatAbsoluteDate(x);\n")).toHaveLength(1);
      expect(c("export const f = (xs: string[]) => xs.map(formatIsoDay);\n")).toHaveLength(1);
      expect(c("export const f = (x: string) => utils.formatAbsoluteDate(x);\n")).toHaveLength(1);
    });

    it("flags an ISO slice printed in JSX text, a labelFormatter, or a format-named helper (F-11)", () => {
      const jsx = c("export const X = ({ s }: { s: string }) => <td>{s.slice(0, 10)} to {`${s.slice(0, 7)}`}</td>;\n");
      expect(jsx).toHaveLength(2);
      expect(jsx[0]).toMatchObject({ rule: "C", id: "iso-slice", kind: "iso-slice" });
      expect(c("export const X = () => <Tooltip labelFormatter={(ms) => new Date(Number(ms)).toISOString().slice(0, 10)} />;\n")).toHaveLength(1);
      expect(c("function formatGrantDate(iso: string) {\n  return new Date(iso).toISOString().slice(0, 10);\n}\n")).toHaveLength(1);
      expect(c("const fmtDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);\n")).toHaveLength(1);
      expect(c("export const X = ({ s }: { s: string }) => <td>{s.substring(0, 10)}</td>;\n")).toHaveLength(1);
    });

    it("reports the line of the offending node", () => {
      expect(c("export const a = 1;\n\nexport const f = (d: Date) => d.toLocaleDateString();\n")[0].line).toBe(3);
    });

    // F-11, D-11, D-21, review R3-01 and plan 201-40: a raw date FIELD printed as a JSX child or in
    // a prose template. The call forms never saw it, and every R3-01 site printed one this way.
    it("flags a date field printed as a JSX child (date-field)", () => {
      const one = c("export const X = ({ row }: { row: { asof: string } }) => <p>as of {row.asof}</p>;\n");
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ rule: "C", id: "date-field", kind: "date-field" });
      expect(c("export const X = ({ points }: { points: { asof: string }[] }) => <p>{points.at(-1)!.asof}</p>;\n")).toHaveLength(1);
      expect(c("export const X = ({ asof }: { asof: string }) => <p>{asof}</p>;\n")).toHaveLength(1);
      expect(c("export const X = ({ r }: { r: { asof: string } }) => <p>{(r.asof as string)}</p>;\n")).toHaveLength(1);
      expect(c('export const X = ({ r }: { r: { until?: string } }) => <p>{r.until ?? "never"}</p>;\n')).toHaveLength(1);
      expect(c('export const X = ({ r }: { r: { until?: string } }) => <p>{r.until || "never"}</p>;\n')).toHaveLength(1);
    });

    it("flags each printed end of a range child, reading both branches of a conditional (date-field)", () => {
      const src =
        'export const X = ({ p }: { p: { windowStart: string; windowEnd?: string; stillLive: boolean } }) =>\n' +
        '  <td>{p.windowStart} \u2013 {p.stillLive || !p.windowEnd ? "live" : p.windowEnd}</td>;\n';
      expect(c(src)).toHaveLength(2);
    });

    it("flags a date field printed in a prose template, one hit per template (date-field)", () => {
      expect(c("export const s = (d: { until: string }) => `History included until ${d.until}.`;\n")).toHaveLength(1);
      expect(c("export const s = (firstDay: string, lastDay: string) => `, ${firstDay} \u2013 ${lastDay}`;\n")).toHaveLength(1);
      expect(c("export const s = (csv: { dateRange: string[] }) => `${csv.dateRange[0]} \u2192 ${csv.dateRange[1]}`;\n")).toHaveLength(1);
      expect(c('export const s = (m: { windowStart: string; windowEnd?: string }) => `${m.windowStart} \u2013 ${m.windowEnd ?? "live"}`;\n')).toHaveLength(1);
    });

    // GC-04 (review, gap closure round 1): three shapes the first cut of `date-field` missed.
    it("flags a date field behind && in a JSX child (date-field)", () => {
      expect(c("export const X = ({ r, show }: { r: { asof: string }; show: boolean }) => <p>{show && r.asof}</p>;\n")).toHaveLength(1);
      expect(c("export const X = ({ r, show }: { r: { asof: string }; show: boolean }) => <p>as of {show && r.asof}</p>;\n")).toHaveLength(1);
    });

    it("flags a bare date field in a copy attribute (date-field)", () => {
      expect(c("export const X = ({ r }: { r: { asof: string } }) => <div aria-label={r.asof} />;\n")).toHaveLength(1);
      expect(c("export const X = ({ r }: { r: { until: string } }) => <span title={r.until}>x</span>;\n")).toHaveLength(1);
      expect(c("export const X = ({ r }: { r: { asof: string } }) => <Row label=\"As of\" tooltip={r.asof} />;\n")).toHaveLength(1);
    });

    it("flags a range template with no whitespace around the dash or arrow (date-field)", () => {
      expect(c("export const s = (r: { effStart: string; effEnd: string }) => `${r.effStart}\u2013${r.effEnd}`;\n")).toHaveLength(1);
      expect(c("export const s = (r: { effStart: string; effEnd: string }) => `${r.effStart}\u2192${r.effEnd}`;\n")).toHaveLength(1);
    });

    // T-201-59: the gate must fire on every name the policy lists, so a typo in the list or a
    // missing branch in the visitor cannot read as "the tree is clean".
    it("flags every name in DATES.fieldNames, in a prose template and as a JSX child", () => {
      expect(DATES.fieldNames.length).toBeGreaterThan(0);
      for (const name of DATES.fieldNames) {
        expect(c(`export const s = (r: Record<string, string>, ${name}: string) => \`Covers ${"$"}{${name}}\`;\n`), `template ${name}`).toHaveLength(1);
        expect(c(`export const X = ({ r }: { r: { ${name}: string } }) => <p>{r.${name}}</p>;\n`), `child ${name}`).toHaveLength(1);
      }
    });

    it("carries the date field names typed again here, in both directions", () => {
      const TYPED_FIELD_NAMES = [
        "asof", "until", "computedAt", "recordStart", "startDate", "endDate", "start_date", "effStart", "effEnd",
        "effective_start", "effective_end", "windowStart", "windowEnd", "first_day", "last_day", "firstDay", "lastDay",
        "date_range", "dateRange", "allocated_at", "week_start",
      ];
      expect([...DATES.fieldNames].sort()).toEqual([...TYPED_FIELD_NAMES].sort());
      for (const typed of TYPED_FIELD_NAMES) expect(DATES.fieldNames).toContain(typed);
    });

    // F-11, D-11, review R3-01 and plan 201-40: an ISO day typed into JSX text is a date printed
    // without the helper. The field and slice forms never saw it, and the retired report, legal and
    // security pages printed one that way.
    it("flags an ISO day typed into JSX text, one hit per text node (iso-literal)", () => {
      const one = c("export const X = () => <p>Retired 2026-11-07</p>;\n");
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ rule: "C", id: "iso-literal", kind: "iso-literal", text: "Retired 2026-11-07" });
      expect(c('export const X = () => <p className="x">Last updated: 2026-04-07</p>;\n')).toHaveLength(1);
      expect(c("export const X = () => <p>From 2026-01-01 to 2026-04-07</p>;\n")).toHaveLength(1);
      expect(c("export const X = () => <p>\n  Retired 2026-11-07\n</p>;\n")[0].text).toBe("Retired 2026-11-07");
    });
  });

  describe("GREEN look-alikes: each is none", () => {
    it("is quiet on an array slice, a comparison, and machine values (inputs, keys, filenames, logic)", () => {
      expect(c("export const X = ({ rows }: { rows: string[] }) => <ul>{rows.slice(0, 10).map((r) => <li key={r}>{r}</li>)}</ul>;\n")).toHaveLength(0);
      expect(c("export const f = (a: string, b: string) => a.slice(0, 10) >= b.slice(0, 10);\n")).toHaveLength(0);
      expect(c("export const X = () => <input type=\"date\" value={new Date().toISOString().slice(0, 10)} />;\n")).toHaveLength(0);
      expect(c("export const X = ({ d }: { d: string }) => <li key={d.slice(0, 10)}>x</li>;\n")).toHaveLength(0);
      expect(c("export const name = () => `export-${new Date().toISOString().slice(0, 10)}.csv`;\n")).toHaveLength(0);
      expect(c("export const key = (iso: string) => iso.slice(0, 10);\n")).toHaveLength(0);
      expect(c("export const f = (xs: string[]) => xs.slice(0, 10);\n")).toHaveLength(0);
      expect(c("const fmt = (t: number) => formatCloseDay(new Date(t).toISOString().slice(0, 10));\n")).toHaveLength(0);
    });

    it("is quiet on a date field wrapped in a helper, including the call in a conditional's false branch (date-field look-alikes)", () => {
      const quiet = [
        'export const X = ({ r }: { r: { asof: string } }) => <p>as of {formatDay(r.asof)}</p>;\n',
        'export const X = ({ r }: { r: { asof: string } }) => <p>{formatMonth(r.asof)}</p>;\n',
        'export const X = ({ r }: { r: { computedAt: string } }) => <p>{formatDayTime(r.computedAt)}</p>;\n',
        'export const X = ({ p }: { p: { windowStart: string; windowEnd?: string; stillLive: boolean } }) => <td>{formatDay(p.windowStart)} \u2013 {p.stillLive || !p.windowEnd ? "live" : formatDay(p.windowEnd)}</td>;\n',
        'export const s = (d: { until: string }) => `History included until ${formatDay(d.until)}.`;\n',
        'export const s = (csv: { dateRange: string[] }) => `${formatDay(csv.dateRange[0])} \u2192 ${formatDay(csv.dateRange[1])}`;\n',
      ];
      for (const src of quiet) expect(c(src), src).toHaveLength(0);
    });

    it("is quiet on a date field in an attribute, a template with no prose, a log call, a neutral name or a computed index", () => {
      const quiet = [
        "export const X = ({ p }: { p: { windowStart: string } }) => <input value={p.windowStart} />;\n",
        "export const X = ({ w }: { w: { week_start: string } }) => <li key={w.week_start}>x</li>;\n",
        "export const X = ({ x }: { x: { asof: string } }) => <time dateTime={x.asof}>x</time>;\n",
        "export const s = (r: { id: string; asof: string }) => `${r.id}:${r.asof}`;\n",
        "export const f = (d: { until: string }) => { console.log(`History included until ${d.until}.`); };\n",
        "export const f = (d: { until: string }) => { logger.warn(`History included until ${d.until}.`); };\n",
        "export const X = ({ first }: { first: string }) => <p>covers {first}</p>;\n",
        "export const X = ({ row, d }: { row: { by_day: Record<string, string> }; d: string }) => <p>{row.by_day[d]}</p>;\n",
      ];
      for (const src of quiet) expect(c(src), src).toHaveLength(0);
    });

    it("is quiet on the GC-04 look-alikes: a helper behind &&, a helper in a copy attribute, a machine attribute, an unspaced key template", () => {
      const quiet = [
        "export const X = ({ r, show }: { r: { asof: string }; show: boolean }) => <p>{show && formatDay(r.asof)}</p>;\n",
        "export const X = ({ r }: { r: { asof?: string } }) => <p>{r.asof && formatDay(r.asof)}</p>;\n",
        "export const X = ({ r, show }: { r: { asof: string }; show: boolean }) => <p>{r.asof && show}</p>;\n",
        "export const X = ({ r }: { r: { asof: string } }) => <div aria-label={formatDay(r.asof)} />;\n",
        "export const X = ({ r }: { r: { asof: string } }) => <span title={`As of ${formatDay(r.asof)}`}>x</span>;\n",
        "export const X = ({ r }: { r: { asof: string } }) => <input type=\"date\" value={r.asof} />;\n",
        "export const X = ({ r }: { r: { asof: string } }) => <div data-asof={r.asof} id={r.asof} />;\n",
        "export const s = (r: { effStart: string; effEnd: string }) => `${formatDay(r.effStart)}\u2013${formatDay(r.effEnd)}`;\n",
        "export const s = (r: { id: string; asof: string }) => `${r.id}-${r.asof}`;\n",
        "export const s = (r: { id: string; asof: string }) => `${r.id}_${r.asof}`;\n",
      ];
      for (const src of quiet) expect(c(src), src).toHaveLength(0);
    });

    it("is quiet on a name that only ends like a date field", () => {
      expect(c("export const X = ({ row }: { row: { session_start: string } }) => <p>{row.session_start}</p>;\n")).toHaveLength(0);
      expect(c("export const X = ({ fieldError }: { fieldError: { start: string } }) => <p>{fieldError.start}</p>;\n")).toHaveLength(0);
    });

    it("is quiet on a date field inside src/lib/utils.ts, the helper home", () => {
      const src = "export const X = ({ r }: { r: { asof: string } }) => <p>{r.asof}</p>;\nexport const s = (d: { until: string }) => `until ${d.until}`;\n";
      expect(scanSource("src/lib/utils.ts", src, POLICY).filter((h) => h.rule === "C")).toHaveLength(0);
    });

    it("is quiet on an ISO day that is not JSX text (iso-literal look-alikes)", () => {
      expect(c('export const X = () => <p>Last updated: {formatDay("2026-04-07")}</p>;\n')).toHaveLength(0);
      expect(c('export const D = "2026-04-07";\n')).toHaveLength(0);
      expect(c('export const X = () => <input type="date" defaultValue="2026-04-07" />;\n')).toHaveLength(0);
      expect(c('export const X = () => <p data-asof="2026-04-07">x</p>;\n')).toHaveLength(0);
      expect(c("export const X = () => <p>Covers 2024\u20132026</p>;\n")).toHaveLength(0);
      expect(c("export const X = () => <p>Call 1234-56-7890</p>;\n")).toHaveLength(0);
      expect(c("export const X = () => <p>Ref 12026-04-07</p>;\n")).toHaveLength(0);
      expect(scanSource("src/lib/utils.ts", "export const X = () => <p>2026-04-07</p>;\n", POLICY).filter((h) => h.rule === "C")).toHaveLength(0);
    });

    it("is quiet on the helpers", () => {
      expect(c('import { formatDay, formatMonth, formatDayTime } from "@/lib/utils";\nexport const f = (x: string) => [formatDay(x), formatMonth(x), formatDayTime(x)];\n')).toHaveLength(0);
    });

    it("is quiet on a number's toLocaleString, with or without non-date options", () => {
      expect(c("export const f = (n: number) => n.toLocaleString();\n")).toHaveLength(0);
      expect(c('export const f = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });\n')).toHaveLength(0);
    });

    it("is quiet on a time of day alone and other Intl formatters", () => {
      expect(c('export const f = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit" });\n')).toHaveLength(0);
      expect(c('export const f = new Intl.NumberFormat("en-US");\n')).toHaveLength(0);
    });

    it("is quiet on an array that is not a month list", () => {
      expect(c('export const M = ["Jan", "Feb"];\n')).toHaveLength(0);
      expect(c('export const M = ["Mar", "May", "Mar"];\n')).toHaveLength(0);
      expect(c('export const M = ["one", "two", "three"];\n')).toHaveLength(0);
    });

    it("is quiet on a deprecated helper's name in an import specifier or a property name", () => {
      expect(c('import { formatIsoDay } from "@/lib/utils";\nexport { formatAbsoluteDate } from "@/lib/utils";\nexport const x = { formatIsoDay: 1 };\n')).toHaveLength(0);
    });

    it("is quiet on comments and strings that name a date API", () => {
      expect(c('// d.toLocaleDateString()\nexport const s = "toLocaleDateString";\n')).toHaveLength(0);
    });

    it("is quiet inside src/lib/utils.ts, the helper home, and nowhere else", () => {
      const src = 'export const f = (d: Date) => d.toLocaleDateString();\nexport const M = ["Jan", "Feb", "Mar"];\n';
      expect(DATE_HELPER_FILES).toEqual(["src/lib/utils.ts"]);
      expect(scanSource("src/lib/utils.ts", src, POLICY).filter((h) => h.rule === "C")).toHaveLength(0);
      expect(scanSource("src/lib/utils2.ts", src, POLICY).filter((h) => h.rule === "C")).toHaveLength(2);
    });

    it("covers all of src/ and nothing outside it", () => {
      const src = "export const f = (d: Date) => d.toLocaleDateString();\n";
      for (const f of ["src/app/api/x/route.ts", "src/components/admin/X.tsx", "src/app/factsheet/[id]/tearsheet/page.tsx", "src/lib/x.ts"]) {
        expect(scanSource(f, src, POLICY).filter((h) => h.rule === "C"), f).toHaveLength(1);
      }
      expect(scanSource("scripts/x.ts", src, POLICY).filter((h) => h.rule === "C")).toHaveLength(0);
    });
  });
});

describe("scanTree: rules B and C through the walker, on a temporary tree", () => {
  it("returns each planted hit with its repo-relative file, and none from exempt scopes or test paths", () => {
    withPlanted(
      {
        "src/components/Term1.tsx": "export const C = () => <th>Sharpe</th>;\n",
        "src/components/Wrapped.tsx": 'export const C = () => <Term k="sharpe">Sharpe</Term>;\n',
        "src/components/admin/Admin.tsx": "export const C = () => <th>Sharpe</th>;\n",
        "src/app/api/og/route.tsx": "export const C = () => <th>Sharpe</th>;\n",
        "src/app/factsheet/[id]/tearsheet/Print.tsx": "export const C = () => <th>Sharpe</th>;\n",
        "src/lib/Date1.ts": "export const f = (d: Date) => d.toLocaleDateString();\n",
        "src/lib/utils.ts": "export const f = (d: Date) => d.toLocaleDateString();\n",
        "src/lib/Date1.test.ts": "export const f = (d: Date) => d.toLocaleDateString();\n",
        "src/components/Term1.test.tsx": "export const C = () => <th>Sharpe</th>;\n",
      },
      (dir) => {
        const hits = scanTree(dir, POLICY).map((h) => `${h.rule}:${h.file}:${h.id}`);
        expect(hits).toEqual(["B:src/components/Term1.tsx:sharpe", "C:src/lib/Date1.ts:toLocaleDateString"]);
      },
    );
  });
});

describe("policy: closed reason set and seeded exceptions", () => {
  it("accepts a reason from the closed set that is long enough, and rejects the rest", () => {
    expect(isValidReason("not user-visible: an internal retry registry key")).toBe(true);
    expect(isValidReason("plain English, not the mandate concept: a select option meaning none")).toBe(true);
    expect(isValidReason("because I said so, and that is that")).toBe(false);
    expect(isValidReason("verb use: Book")).toBe(false); // from the set, but 20 characters or fewer
    expect(isValidReason("")).toBe(false);
  });

  it("accepts the founder-scoped former-name shape (F-04) and rejects the bare prefix", () => {
    expect(isValidReason("former name (F-04): the registered term names its former name once")).toBe(true);
    expect(isValidReason("former name (F-04): ")).toBe(false);
    expect(isValidReason("former name: no founder id")).toBe(false);
  });

  it("gives every seeded exception and excluded file a valid reason", () => {
    for (const row of [...EXCEPTIONS, ...EXCLUDED_FILES]) {
      expect(isValidReason(row.reason), `${row.file}: ${row.reason}`).toBe(true);
    }
  });

  it("seeds the two No preference options, the three internal files and the PORTFOLIO sentinel", () => {
    expect(EXCEPTIONS.filter((e) => e.literal === "— No preference —")).toHaveLength(2);
    expect(EXCEPTIONS.filter((e) => e.literal === "PORTFOLIO")).toHaveLength(1);
    expect(EXCLUDED_FILES.map((r) => r.file).sort()).toEqual([
      "src/lib/resilient-fetch.ts",
      "src/lib/routing/route-contract-manifest.ts",
      "src/lib/seam-retry-registry.ts",
    ]);
    expect(EXCLUDED_FILES.every((r) => r.rule === "A")).toBe(true);
  });
});
