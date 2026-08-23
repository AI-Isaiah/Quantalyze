import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 147 (SCEN-01) — series-resolution durability guard.
 *
 * WHY THIS EXISTS: `strategy_analytics` stores a strategy's track in TWO
 * columns and which one is populated depends on the ingest path. A CSV-ingested
 * strategy has `daily_returns` (already differenced returns). An
 * analytics-service / API-ingested strategy — and every stitched composite —
 * has `daily_returns = NULL` and its real track in `returns_series`, a cumprod
 * WEALTH index. A reader that selects only `daily_returns` therefore gets
 * `null` for a whole class of real strategies and renders `[]` — the SCEN-01
 * symptom (the founder's MT5 strategy contributing "0 overlapping days" to a
 * scenario). Phase 147 fixed FOUR such readers at once; this gate exists so a
 * FIFTH cannot be minted.
 *
 * ROADMAP SC2 has a structural clause: every surface resolves through the ONE
 * existing `resolveDailyReturnSeries`, with no third resolution mechanism
 * minted. That clause is what this file enforces — as a CI invariant, not as an
 * observation made once during the phase.
 *
 * TWO LAYERS:
 *
 *   LAYER A — REPO-WIDE bare-reader ban. Walk every production source under
 *     `src/` and inspect the argument of every `.select(...)` call. Any select
 *     payload that names the `daily_returns` column MUST also name
 *     `returns_series`. This is the "no third mechanism" clause: it catches a
 *     brand-new file the gate author never hand-picked, which an allowlist
 *     structurally cannot do. Deliberately narrow to select payloads (not a
 *     free-text scan) so a prose mention, a TypeScript field annotation like
 *     `daily_returns?: unknown`, or a log/hint string cannot redden it —
 *     `factsheet/[id]/v2/page.tsx` carries all three legitimately.
 *
 *     Tolerated by construction, not by exception:
 *       - the `strategy_analytics (*)` splat in `getMyStrategies` (queries.ts)
 *         — the splat selects BOTH columns, and never names `daily_returns`, so
 *         it is never a candidate in the first place. Phase 159 (159-03 /
 *         RANK-02) converted the OTHER splats to explicit projections, and the
 *         discovery-detail one now NAMES `daily_returns` — it satisfies this
 *         layer honestly by also naming `returns_series`, which is the rule
 *         rather than a tolerance. Note this layer scans `.select(...)`
 *         ARGUMENTS, so a payload built in a named constant and passed as a
 *         variable is not inspected here; the per-surface Layer B pins below
 *         are what cover those readers.
 *       - `csv_daily_returns`, `mtm_daily_returns`, `smoothed_mtm_daily_returns`
 *         — different columns. The word-boundary regex excludes them.
 *       - `PUBLIC_ANALYTICS_COLUMNS` — includes `returns_series`, not
 *         `daily_returns`.
 *
 *   LAYER B — per-surface allowlist pins, ONE `it()` per file so a failure names
 *     the offending surface directly. Each of the four readers Phase 147 fixed,
 *     plus the two REFERENCE implementations that were already correct, must
 *     both (a) obtain `returns_series` and (b) INVOKE `resolveDailyReturnSeries`.
 *     The assertion is on the CALL, never on an import specifier: 147-01
 *     extracted the resolver to a leaf module (`@/lib/factsheet/resolve-series`)
 *     while `factsheet/[id]/v2/page.tsx` and `queries.ts` still reach it through
 *     the `allocator-portfolio-payload` re-export, so specifiers legitimately
 *     differ across the allowlist. Layer A alone cannot see (b) — a file could
 *     select both columns and still throw `returns_series` away.
 *
 *   A missing allowlist file is a FAILURE, not a skip (Rule 12): a rename or a
 *   move must carry the guard with it, never silently stop enforcing it.
 *
 * Rule-9 NON-VACUITY — TWO experiments run during authoring (2026-08-05),
 * recorded here, in the commit message, and in 147-VALIDATION.md row SC-2:
 *
 *   1. BARE READER (the ledger's chosen mutation): `returns_series` was deleted
 *      from the `strategy_analytics (...)` embed in `getMyAllocationDashboard`
 *      — turning `src/lib/queries.ts`, the SECOND member of the reader class,
 *      back into a bare `daily_returns` reader. BOTH layers went red:
 *
 *        × LAYER A … no production select reads daily_returns without returns_series
 *          AssertionError: expected [ Array(1) ] to deeply equal []
 *          + "src/lib/queries.ts — .select(\"strategy_id, current_weight, … \
 *             strategy_analytics ( daily_returns, cagr, sharpe, volatility, \
 *             max_drawdown, data_quality_flags, computation_status ) )\")"
 *        × LAYER B … queries.ts getMyAllocationDashboard book path embeds
 *          returns_series AND resolves it
 *          AssertionError: expected 'strategy_analytics (…' to contain 'returns_series'
 *
 *        → 2 failed / 10 passed.
 *
 *   2. REFERENCE-PAGE REGRESSION: the resolver call in `factsheet/[id]/v2/page.tsx`
 *      was reverted to the pre-147 `normalizeDailyReturns(dailyRaw)`. The
 *      reference pin went red — proving the two "already correct" surfaces are
 *      genuinely held, not decoratively listed:
 *
 *        × REFERENCE factsheet v2 page still selects returns_series AND resolves it
 *          AssertionError: expected 'import { notFound } …' to contain
 *          'resolveDailyReturnSeries('
 *
 *        → 1 failed / 11 passed.
 *
 *   Both mutations were reverted by RE-EDITING the mutated line (never a
 *   file-level `git checkout --`), and `git diff` returned to 0 lines for both
 *   files. The gate is 12/12 green on the fixed tree.
 *
 * Comment hygiene: the scanners strip comment lines BEFORE matching, so the
 * prose above — which necessarily names both columns and quotes a bare select —
 * cannot self-invalidate the gate.
 */

const ROOT = join(__dirname, "..", "..");

/** Read an allowlisted source fail-loud (missing file → explicit failure). */
function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `SCEN-01 allowlist file is missing: ${relPath}. A rename or move must ` +
        `carry this guard with it — a missing pinned source is a FAILURE, not ` +
        `a skip (the two-column resolution invariant would otherwise silently ` +
        `stop being enforced on that surface).`,
    );
  }
  return readFileSync(abs, "utf8");
}

/**
 * Strip `//` line comments and block comments so documentation prose (including
 * this file's own header, and every `// … daily_returns …` explainer the fixed
 * readers carry) can neither redden nor green a scan. Line-oriented on purpose:
 * a `//` inside a string literal (a URL) survives, which is harmless here
 * because nothing downstream treats a URL as a select payload.
 */
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** The `daily_returns` COLUMN, never `csv_daily_returns` / `mtm_daily_returns`
 *  / `smoothed_mtm_daily_returns` (`\w` includes `_`, so the lookbehind
 *  excludes every prefixed sibling column). */
const DAILY_RETURNS_COLUMN = /(?<!\w)daily_returns(?!\w)/;

/**
 * Extract the string/template literal argument of every `.select(` call in a
 * source. Returns the literal bodies (without their delimiters). Comment lines
 * between `.select(` and its argument are already gone (stripComments), so the
 * whitespace hop is enough.
 */
function selectPayloads(src: string): string[] {
  const out: string[] = [];
  const opener = /\.select\(\s*(`|"|')/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(src)) !== null) {
    const quote = m[1];
    const start = m.index + m[0].length;
    let i = start;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) break;
      i += 1;
    }
    out.push(src.slice(start, i));
    opener.lastIndex = i + 1;
  }
  return out;
}

/** Walk src/ for production sources (no tests, no __tests__, no .d.ts). */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      productionSources(abs, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.d\.ts$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(abs);
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────
// LAYER A — repo-wide: no production select reads the bare column
// ─────────────────────────────────────────────────────────────────────────

describe("SCEN-01 LAYER A — repo-wide bare daily_returns select ban", () => {
  /** Every offending `file — select payload` pair, empty on a healthy tree. */
  function bareReaders(): string[] {
    const offenders: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const src = stripComments(readFileSync(abs, "utf8"));
      for (const payload of selectPayloads(src)) {
        if (!DAILY_RETURNS_COLUMN.test(payload)) continue;
        if (payload.includes("returns_series")) continue;
        offenders.push(
          `${relative(ROOT, abs)} — .select(${JSON.stringify(
            payload.replace(/\s+/g, " ").trim(),
          )})`,
        );
      }
    }
    return offenders;
  }

  it("no production select reads daily_returns without returns_series (a bare reader strands every API-ingested strategy at [])", () => {
    expect(bareReaders()).toEqual([]);
  });

  it("the scan is non-vacuous: it DOES see the phase's own two-column selects (so an empty offender list means clean, not blind)", () => {
    // If the payload extractor silently returned nothing, the ban above would
    // pass on any tree at all. Pin that it finds real select payloads naming
    // BOTH columns — the exact shape the four fixed readers now carry.
    const twoColumn: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const src = stripComments(readFileSync(abs, "utf8"));
      for (const payload of selectPayloads(src)) {
        if (!DAILY_RETURNS_COLUMN.test(payload)) continue;
        if (!payload.includes("returns_series")) continue;
        twoColumn.push(relative(ROOT, abs));
      }
    }
    // At minimum: the returns route, the OG route, and queries.ts (twice —
    // the dashboard embed and getPortfolioStrategies).
    expect(twoColumn.length).toBeGreaterThanOrEqual(4);
    expect(twoColumn).toContain("src/app/api/strategies/[id]/returns/route.ts");
    expect(twoColumn).toContain("src/lib/queries.ts");
  });

  it("the column regex does not confuse csv_/mtm_/smoothed_mtm_ daily_returns for the bare column", () => {
    expect(DAILY_RETURNS_COLUMN.test("csv_daily_returns")).toBe(false);
    expect(DAILY_RETURNS_COLUMN.test("mtm_daily_returns")).toBe(false);
    expect(DAILY_RETURNS_COLUMN.test("smoothed_mtm_daily_returns")).toBe(false);
    expect(DAILY_RETURNS_COLUMN.test("daily_returns, cagr")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LAYER B — per-surface allowlist pins (one it() per file)
// ─────────────────────────────────────────────────────────────────────────

/** The resolver CALL, not an import specifier — 147-01's leaf extraction means
 *  specifiers legitimately differ between `@/lib/factsheet/resolve-series` and
 *  the `allocator-portfolio-payload` re-export. */
const RESOLVER_CALL = "resolveDailyReturnSeries(";

/** The argument list of the FIRST `resolveDailyReturnSeries(...)` call in a
 *  source (paren-balanced). Used to pin what is threaded INTO the resolver,
 *  which a mere "the file mentions the identifier" assertion cannot see. */
function resolverCallArgs(src: string): string {
  const start = src.indexOf(RESOLVER_CALL);
  if (start === -1) return "";
  let i = start + RESOLVER_CALL.length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.slice(start + RESOLVER_CALL.length, i - 1);
}

describe("SCEN-01 LAYER B — every series reader resolves through the ONE resolver", () => {
  it("all allowlisted surfaces exist (a missing pinned source is a FAILURE, not a skip)", () => {
    const allowlist = [
      "src/app/api/strategies/[id]/returns/route.ts",
      "src/app/api/og/factsheet/[id]/route.tsx",
      "src/lib/queries.ts",
      "src/app/scenario-share/[token]/share-resolve.ts",
      "src/app/scenario-share/[token]/page.tsx",
      "src/app/factsheet/[id]/v2/page.tsx",
      "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx",
      "src/lib/factsheet/resolve-series.ts",
    ];
    for (const rel of allowlist) {
      expect(existsSync(join(ROOT, rel)), `missing: ${rel}`).toBe(true);
    }
  });

  // --- The four readers Phase 147 FIXED ----------------------------------

  it("returns route (the composer's lazy per-strategy fetch) selects returns_series AND resolves it", () => {
    const src = stripComments(
      readSource("src/app/api/strategies/[id]/returns/route.ts"),
    );
    expect(src).toContain("returns_series");
    expect(src).toContain(RESOLVER_CALL);
    // The analytics select itself carries both columns (not just some other
    // reference to returns_series elsewhere in the file).
    const payloads = selectPayloads(src).filter((p) =>
      DAILY_RETURNS_COLUMN.test(p),
    );
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(p).toContain("returns_series");
  });

  it("OG factsheet route (the unfurl card) selects returns_series AND resolves it", () => {
    const src = stripComments(
      readSource("src/app/api/og/factsheet/[id]/route.tsx"),
    );
    expect(src).toContain(RESOLVER_CALL);
    const payloads = selectPayloads(src).filter((p) =>
      DAILY_RETURNS_COLUMN.test(p),
    );
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(p).toContain("returns_series");
  });

  it("queries.ts getMyAllocationDashboard book path embeds returns_series AND resolves it", () => {
    const src = stripComments(readSource("src/lib/queries.ts"));
    expect(src).toContain(RESOLVER_CALL);
    // Block-slice to the dashboard's own strategy_analytics embed (phase-84's
    // marker-literal technique) so an unrelated two-column select elsewhere in
    // this 3.5k-line file cannot false-green this surface.
    const joinStart = src.indexOf("strategy:strategies!inner (");
    expect(joinStart).toBeGreaterThan(-1);
    const embedStart = src.indexOf("strategy_analytics (", joinStart);
    expect(embedStart).toBeGreaterThan(-1);
    const embed = src.slice(embedStart, src.indexOf(")", embedStart));
    expect(embed).toContain("daily_returns");
    expect(embed).toContain("returns_series");
  });

  it("scenario-share page reads the sibling returns_series column bounded to the RPC's own ids", () => {
    const src = stripComments(
      readSource("src/app/scenario-share/[token]/page.tsx"),
    );
    // The narrow sibling projection — strategy_id keys the map, returns_series
    // is the payload. Widening this read is a security decision, not a typo.
    expect(src).toContain('.select("strategy_id, returns_series")');
    // Bounded to the ids the SECDEF RPC itself returned (never an arbitrary id).
    expect(src).toContain('.in("strategy_id"');
  });

  it("share-resolve.ts (the pure share projection layer) threads the raw wealth index INTO the resolver, never forwards it", () => {
    const src = stripComments(
      readSource("src/app/scenario-share/[token]/share-resolve.ts"),
    );
    // This layer is PURE — it takes no select, so the pin is on the wiring: the
    // caller-supplied raw-index channel must reach the resolver's second
    // argument. Reverting the loop to the pre-147
    // `normalizeDailyReturns(s.daily_returns)` reddens both halves.
    expect(src).toContain("returnsSeriesById");
    expect(src).toContain(RESOLVER_CALL);
    expect(resolverCallArgs(src)).toContain("returnsSeriesById");
  });

  // --- The two REFERENCE implementations (pinned so they cannot regress) ---

  it("REFERENCE factsheet v2 page still selects returns_series AND resolves it (SC2's 'equals what the detail page renders' anchor)", () => {
    const src = stripComments(readSource("src/app/factsheet/[id]/v2/page.tsx"));
    expect(src).toContain(RESOLVER_CALL);
    const payloads = selectPayloads(src).filter((p) =>
      DAILY_RETURNS_COLUMN.test(p),
    );
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(p).toContain("returns_series");
  });

  it("REFERENCE discovery strategy page still resolves through the same resolver", () => {
    const src = stripComments(
      readSource("src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx"),
    );
    expect(src).toContain(RESOLVER_CALL);
    expect(src).toContain("returns_series");
  });

  // --- The resolver itself -----------------------------------------------

  it("the ONE resolver exists as a leaf module and differences the wealth index (no third mechanism)", () => {
    const src = stripComments(readSource("src/lib/factsheet/resolve-series.ts"));
    expect(src).toContain("export function resolveDailyReturnSeries");
    // The differencing step is what makes returns_series usable as RETURNS.
    // Its absence would mean the wealth index is forwarded raw (+100% day one).
    expect(src).toContain("equityCurveToDailyReturns");
  });
});
