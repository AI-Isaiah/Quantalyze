import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { displayStrategyName, publicNamePreview } from "./strategy-display";

// Phase 201 / D-09, D-17: the viewer argument is required and the label follows
// whether the viewer can see the strategy in discovery, never the disclosure tier.
describe("displayStrategyName", () => {
  const ID = "abcdef1234567890";

  it("a viewer who can see the strategy reads its name ahead of the codename", () => {
    expect(
      displayStrategyName(
        { id: ID, name: "Fibonacci Ghost", codename: "Ghost-7", disclosure_tier: "exploratory" },
        { visible: true },
      ),
    ).toBe("Fibonacci Ghost");
  });

  it("a visible strategy with a blank or missing name reads its codename, then the synthetic label", () => {
    for (const name of [null, undefined, "", "   "]) {
      expect(
        displayStrategyName({ id: ID, name, codename: "Ghost-7" }, { visible: true }),
      ).toBe("Ghost-7");
    }
    expect(
      displayStrategyName({ id: ID, name: "  ", codename: null }, { visible: true }),
    ).toBe("Strategy #abcdef12");
  });

  it("a viewer who cannot see the strategy never reads its name, institutional tier included", () => {
    for (const disclosure_tier of ["exploratory", "institutional", null] as const) {
      expect(
        displayStrategyName(
          { id: ID, name: "Fibonacci Ghost", codename: "Ghost-7", disclosure_tier },
          { visible: false },
        ),
      ).toBe("Ghost-7");
      expect(
        displayStrategyName(
          { id: ID, name: "Fibonacci Ghost", codename: null, disclosure_tier },
          { visible: false },
        ),
      ).toBe("Strategy #abcdef12");
    }
  });

  it("a blank codename reads the synthetic label for either viewer", () => {
    for (const visible of [true, false]) {
      expect(
        displayStrategyName({ id: ID, name: null, codename: "  " }, { visible }),
      ).toBe("Strategy #abcdef12");
    }
  });

  it("a lookup miss reads 'Unnamed strategy', never an id, for either viewer", () => {
    for (const visible of [true, false]) {
      expect(displayStrategyName(null, { visible })).toBe("Unnamed strategy");
      expect(displayStrategyName(undefined, { visible })).toBe("Unnamed strategy");
    }
  });

  it("the viewer argument is required: a call without it is a type error (D-09)", () => {
    // The directive below is the proof. If `viewer` ever becomes optional again the
    // call type-checks, the directive is unused, and `npm run typecheck` fails.
    // @ts-expect-error - the viewer argument is required
    const label = displayStrategyName({ id: ID, name: "Fibonacci Ghost", codename: "Ghost-7" });
    // At runtime the missing viewer is not visible, so it can only withhold the name.
    expect(label).toBe("Ghost-7");
  });
});

// Phase 200 / D-11, Phase 201 / D-09 - what the rename place tells a manager the public sees.
// The oracle is typed here as literals; the factsheet title and the preview share one
// helper. Both legs are what a viewer who can see the strategy reads, so they are EQUAL.
describe("publicNamePreview", () => {
  it("a name with a codename: both legs are the name", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: "Fibonacci Ghost",
        codename: "Ghost-7",
        disclosure_tier: "exploratory",
      }),
    ).toEqual({ factsheet: "Fibonacci Ghost", discovery: "Fibonacci Ghost" });
  });

  it("institutional row without a codename: both legs are the name", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: "Stellar Neutral Alpha",
        codename: null,
        disclosure_tier: "institutional",
      }),
    ).toEqual({
      factsheet: "Stellar Neutral Alpha",
      discovery: "Stellar Neutral Alpha",
    });
  });

  it("exploratory row with a name and no codename (PROD reality): both legs are the name, not Strategy #<id>", () => {
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: "Secret Alpha Fund",
        codename: null,
        disclosure_tier: "exploratory",
      }),
    ).toEqual({
      factsheet: "Secret Alpha Fund",
      discovery: "Secret Alpha Fund",
    });
  });

  it("a null or whitespace-only name: both legs are the codename, then the synthetic label", () => {
    for (const name of [null, "   "]) {
      expect(
        publicNamePreview({
          id: "abcdef1234567890",
          name,
          codename: "Ghost-7",
          disclosure_tier: "exploratory",
        }),
      ).toEqual({ factsheet: "Ghost-7", discovery: "Ghost-7" });
    }
    expect(
      publicNamePreview({
        id: "abcdef1234567890",
        name: null,
        codename: null,
        disclosure_tier: "exploratory",
      }),
    ).toEqual({ factsheet: "Strategy #abcdef12", discovery: "Strategy #abcdef12" });
  });

  it("the legs always agree, and equal what the resolver prints for a viewer who can see the strategy", () => {
    const rows = [
      { id: "abcdef1234567890", name: "Fibonacci Ghost", codename: "Ghost-7" },
      { id: "abcdef1234567890", name: null, codename: "Ghost-7" },
      { id: "abcdef1234567890", name: "  ", codename: null },
    ];
    for (const row of rows) {
      const preview = publicNamePreview(row);
      expect(preview.discovery).toBe(preview.factsheet);
      expect(preview.discovery).toBe(displayStrategyName(row, { visible: true }));
    }
  });
});

// Phase 201 review SFH-01: `{ visible: true }` is a literal claim the type system cannot
// check. A site that passes it over an unpublished or service-role read would print a
// hidden strategy's name and nothing would go red. This pins, per file, the count of literal
// `visible: true` arguments in direct `displayStrategyName(` calls, so a new one is a reviewed
// change to this table. Blind spots: it does not see a shared options object, an alias or a
// same-file substitution, and the comment stripper can eat `//` inside a string.
describe("displayStrategyName visible: true call sites", () => {
  const SRC = join(__dirname, "..");
  const EXPECTED: Record<string, number> = {
    "app/(dashboard)/allocations/lib/holdings-adapter.ts": 1,
    "app/(dashboard)/allocations/lib/strategies-row-adapter.ts": 2,
    "app/api/og/factsheet/[id]/route.tsx": 1,
    "app/factsheet/[id]/tearsheet/page.tsx": 2,
    "app/factsheet/[id]/v2/page.tsx": 1,
    "components/strategy/PendingIntros.tsx": 1,
    "lib/allocation-helpers.ts": 1,
    "lib/factsheet/fetch-and-build-payload.ts": 1,
    "lib/queries.ts": 1,
    "lib/strategy-display.ts": 2,
  };

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(p);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
  }

  // The argument text of each `displayStrategyName(...)` call, comments stripped.
  function callArgs(code: string): string[] {
    const out: string[] = [];
    for (const m of code.matchAll(/\bdisplayStrategyName\(/g)) {
      if (/function\s+$/.test(code.slice(0, m.index))) continue;
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      for (; i < code.length && depth > 0; i++) {
        if (code[i] === "(") depth++;
        else if (code[i] === ")") depth--;
      }
      out.push(code.slice(start, i));
    }
    return out;
  }

  it("only the reviewed production files pass the literal visible: true, with these counts", () => {
    const found: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      const n = callArgs(code).filter((a) => /\bvisible:\s*true\b/.test(a)).length;
      if (n > 0) found[relative(SRC, file)] = n;
    }
    expect(found).toEqual(EXPECTED);
  });
});

// Phase 201 review R2-03: the admin clients are untyped and their rows are cast, so the
// compiler cannot tell whether a `strategies!..._fkey(...)` embed selects `status`. Without it
// `displayStrategyName` silently prints a codename for a visible strategy. This scan is the
// guard: each admin embed must name `status`.
describe("admin strategy embeds select status", () => {
  const SRC = join(__dirname, "..");
  const EMBEDS: Record<string, number> = {
    "app/(dashboard)/admin/page.tsx": 1,
    "lib/admin/match.ts": 2,
  };

  it.each(Object.entries(EMBEDS))("every strategies embed in %s selects status", (file, count) => {
    const code = readFileSync(join(SRC, file), "utf8");
    const embeds = [...code.matchAll(/strategies!\w+_fkey\(([^)]*)\)/g)].map((m) => m[1]);
    expect(embeds).toHaveLength(count);
    for (const cols of embeds) expect(cols).toMatch(/\bstatus\b/);
  });
});
