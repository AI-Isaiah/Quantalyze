import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Phase 167.1.2.2.2 (TRADESYNC, plan 11 Task 3) - ONE CLASSIFIER FOR "IS THIS
 * KEY'S TRADE FETCH STALE?" The compensating control for PATTERNS correction 1.
 *
 * WHY THIS FILE EXISTS. `resolveTradeFetch` in `src/lib/freshness.ts` owns the
 * verdict (current / stale / never / future / not_applicable) and the 2-day
 * threshold (D-05). The repo already has a lint rule for the sibling hazard,
 * `no-raw-staleness-derivation`, but it matches only the text `last_sync_at` /
 * `lastSyncAt` (`SYNC_TS_REF`), so it cannot see a comparison written against
 * `trades_fetched_at`, `tradesFetchedAt` or `fetchedAt`: the new field is a
 * blind spot by construction. Without a guard, a future surface can re-derive
 * staleness inline with its own cutoff, and the list badge and the factsheet
 * line then answer one key two ways. That is the defect `freshness.two-surfaces`
 * was written against, now for the trade fetch.
 *
 * WHAT IT SCANS. Every non-test `src/**\/*.ts(x)` file except `freshness.ts`
 * itself. After comments and the contents of quoted strings are blanked, no line
 * may combine a trade-fetch identifier (`tradesFetchedAt`, `trades_fetched_at`,
 * `fetchedAt`) with any of:
 *   - `Date.now()`
 *   - `.getTime()` arithmetic
 *   - an ordering comparison (`<`, `>`, `<=`, `>=`) against a day or hour
 *     constant (86_400_000, 3_600_000, DAY_MS, HOUR_MS, TRADE_FETCH_STALE_DAYS, ...).
 *
 * CEILING (stated, like its lint sibling): a per-line text-shape backstop, not a
 * proof. A comparison laundered through an intermediate variable
 * (`const t = tradesFetchedAt; ... t < cutoff`), split across lines, or written
 * against a renamed field is not caught. It trips the obvious copy-paste of an
 * inline staleness fold, which is the realistic regression, and the two-surfaces
 * boundary test covers the verdict itself.
 *
 * THE ONE SANCTIONED SITE. `TradeFetchLineView` prints a whole-day age ("9 days
 * ago") with `Math.floor((nowMs - fetchedAt.getTime()) / 86_400_000)`. That is a
 * DISPLAY count; the verdict beside it comes from `resolveTradeFetch` alone (and
 * `FactsheetView.trade-fetch-line.test.tsx` pins that a 48 h + 1 min fetch reads
 * `Stale` while the count still says 2). It is allowlisted by file with a PINNED
 * COUNT and a reason, and the allowlist entry must still be hit, so a stale entry
 * cannot become a permanent exemption for a file.
 */

const SRC = join(process.cwd(), "src");
const FRESHNESS = join(SRC, "lib", "freshness.ts");

const TRADE_ID = /\b(?:tradesFetchedAt|trades_fetched_at|fetchedAt)\b/;
const NOW_CALL = /\bDate\.now\s*\(\s*\)/;
const GET_TIME = /\.getTime\s*\(\s*\)/;
// `<` / `>` / `<=` / `>=` that is not `=>`, `->`, `<<`, `>>` or a bare `<`/`>` of
// a type argument or JSX tag (those never sit beside a duration constant).
const ORDER_CMP = /(?<![=<>\-])[<>]=?(?![=>])/;
const DURATION_CONST =
  /\b(?:86_?400_?000|3_?600_?000|DAY_MS|HOUR_MS|MS_PER_DAY|MS_PER_HOUR|TRADE_FETCH_STALE_DAYS|STALE_DAYS|STALE_HOURS)\b|\*\s*(?:24|48)\b|\b(?:24|48)\s*\*/;

/**
 * Display-only whole-day count. Keyed by repo-relative path (POSIX separators),
 * with the exact number of flagged lines the file is allowed.
 */
const ALLOWED_DISPLAY_SITES: Record<string, { count: number; reason: string }> = {
  "src/app/factsheet/[id]/trade-fetch-lines.tsx": {
    count: 1,
    reason:
      "TradeFetchLineView whole-day age for display; the verdict is resolveTradeFetch's (pinned by the 48 h + 1 min case in FactsheetView.trade-fetch-line.test.tsx)",
  },
};

/** Blank `/* *\/` blocks, `//` comments and the contents of '...' / "..." literals, keeping line count. */
function blankNonCode(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return withoutBlocks
    .split("\n")
    .map((line) =>
      line
        .replace(/(["'])(?:\\.|(?!\1).)*\1/g, (m) => m[0] + " ".repeat(m.length - 2) + m[0])
        .replace(/(^|[^:])\/\/.*$/, "$1"),
    )
    .join("\n");
}

/** The flagged line numbers (1-based) of one file's source. */
function findAdHocTradeFetchComparisons(source: string): number[] {
  const flagged: number[] = [];
  blankNonCode(source)
    .split("\n")
    .forEach((line, i) => {
      if (!TRADE_ID.test(line)) return;
      const arithmeticOnNow = NOW_CALL.test(line) || GET_TIME.test(line);
      const comparesToDuration = ORDER_CMP.test(line) && DURATION_CONST.test(line);
      if (arithmeticOnNow || comparesToDuration) flagged.push(i + 1);
    });
  return flagged;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

function scan(): { files: string[]; flaggedByFile: Map<string, number[]> } {
  const all: string[] = [];
  walk(SRC, all);
  const files = all.filter((f) => f !== FRESHNESS);
  const flaggedByFile = new Map<string, number[]>();
  for (const file of files) {
    const hits = findAdHocTradeFetchComparisons(readFileSync(file, "utf8"));
    if (hits.length > 0) flaggedByFile.set(relative(process.cwd(), file).split(sep).join("/"), hits);
  }
  return { files, flaggedByFile };
}

describe("one classifier: no ad hoc trade-fetch staleness comparison outside freshness.ts", () => {
  it("guard-the-guard: the detector flags the inline shapes it exists to catch (red fixtures)", () => {
    const red = [
      "const stale = Date.now() - new Date(tradesFetchedAt).getTime() > 2 * 86_400_000;",
      "const ms = new Date(trades_fetched_at).getTime();",
      "if (fetchedAt < cutoff - DAY_MS) return true;",
      "const old = Date.now() - fetchedAt > 48 * HOUR_MS;",
    ];
    for (const line of red) {
      expect(findAdHocTradeFetchComparisons(line), line).toEqual([1]);
    }
  });

  it("guard-the-guard: it stays quiet on the legitimate shapes (green fixtures)", () => {
    const green = [
      "const verdict = resolveTradeFetch(tradesFetchedAt, tradeFetchVenue, new Date(nowMs));",
      "const tradesFetchedAt = analytics?.trades_fetched_at ?? null;",
      "tradesFetchedAt: string | null;",
      '"computed_at, trades_fetched_at, series_end:returns_series->-1->>date"',
      "// Date.now() - tradesFetchedAt.getTime() > 2 * 86_400_000 is exactly what NOT to write",
      "/* fetchedAt.getTime() */",
      "const a = serverNow.getTime() - computedAt.getTime();",
      "if (days > 2) return null; // no trade-fetch identifier on this line",
      "<p className={cls}>Last trades fetched {age} ago</p>",
    ];
    for (const line of green) {
      expect(findAdHocTradeFetchComparisons(line), line).toEqual([]);
    }
  });

  it("guard-the-guard: the scan read a non-zero file count, the surfaces it protects, and not freshness.ts", () => {
    const { files } = scan();
    const rel = files.map((f) => relative(process.cwd(), f).split(sep).join("/"));
    expect(files.length).toBeGreaterThan(100);
    for (const must of [
      "src/components/strategy/SyncBadge.tsx",
      "src/app/factsheet/[id]/v2/FactsheetView.tsx",
      "src/app/factsheet/[id]/tearsheet/page.tsx",
      "src/app/factsheet/[id]/trade-fetch-lines.tsx",
    ]) {
      expect(rel, `${must} was not scanned`).toContain(must);
    }
    expect(rel).not.toContain("src/lib/freshness.ts");
    expect(rel.some((f) => /\.test\.tsx?$/.test(f))).toBe(false);
  });

  it("no non-test src file other than freshness.ts compares a trades-fetched timestamp numerically", () => {
    const { flaggedByFile } = scan();
    const unexpected: string[] = [];
    for (const [file, lines] of flaggedByFile) {
      const allowed = ALLOWED_DISPLAY_SITES[file];
      if (!allowed || lines.length !== allowed.count) {
        unexpected.push(
          `${file}: line(s) ${lines.join(", ")}${allowed ? ` (allowlist pins ${allowed.count})` : ""}`,
        );
      }
    }
    expect(
      unexpected,
      "derive trade-fetch staleness through resolveTradeFetch() in src/lib/freshness.ts, never inline",
    ).toEqual([]);
  });

  it("every allowlisted display site is still hit (a stale entry must not exempt its file forever)", () => {
    const { flaggedByFile } = scan();
    for (const [file, { count }] of Object.entries(ALLOWED_DISPLAY_SITES)) {
      expect(flaggedByFile.get(file)?.length ?? 0, `${file} no longer has its display site`).toBe(count);
    }
  });
});
