/**
 * Phase 167.1.1 HOLDINGKEYSCOPE, SC 2 / D-01.2 — the census of every consumer of
 * the holding scope key shape, pinned so a NEW one cannot appear unclassified.
 *
 * THE PROPERTY. A holding on a money surface is named by `holding:venue:symbol:type`
 * (`holdingScopeKey`, src/lib/keys.ts), and that name does NOT carry the API key.
 * Two keys can hold one asset on one venue, so a consumer that stores, dedups or
 * looks up by that name alone silently merges them (the Phase 170.4 D-08 collapse).
 * 170.4 re-keyed the one place that collapsed (`derivePhase07Fields`); this census
 * proves the rest are either re-keyed, or merge ON PURPOSE (one toggle, one match
 * decision, one note, one Bridge pseudo-strategy per ref), or never keyed a money
 * figure at all. A consumer added later fails here until somebody reads it and
 * records a verdict with a reason.
 *
 * WHAT THIS GUARD CHECKS, on comment-stripped source (`stripCommentsPreserveLines`,
 * so prose that names an idiom cannot trip it and line numbers stay real):
 *
 *   M1  the identifier `holdingScopeKey`.
 *   M2  a `buildHoldingRef(` call (the persisted Bridge scope_ref builder; it
 *       delegates to M1, so every caller is a consumer of the key-free shape).
 *   M3  a TypeScript template literal that starts `holding:` and interpolates.
 *   M4  a Python f-string that starts `holding:` and interpolates.
 *   M5  a template that interpolates `.symbol` then `.venue`, or `.venue` then
 *       `.symbol`, joined by a colon: the same triple built without the prefix
 *       (`computeHoldingsFingerprint`, the notes scope ref, a React key).
 *   M6  a plain string literal exactly equal to `holding:` (prefix parsers and
 *       concatenation builders).
 *   M7  a regex literal anchored on `^holding:` (ref validators).
 *   M7 is an addition to the plan's fixed M1-M6: the commit route's
 *   `HOLDING_REF_RE` and the match-decisions route's body schema parse the shape
 *   with a regex literal, which none of M1-M6 can see.
 *
 * Round-1 review WR-01 added four matchers for the composite key built WITHOUT the
 * `holding:` prefix and WITHOUT a property access, the idioms M1-M7 were blind to:
 *
 *   M8  a Python tuple of a venue accessor then a symbol accessor, either order
 *       (`(row["venue"], row["symbol"], ...)`, `.get("venue")`, `r.venue`), or a
 *       tuple of venue/symbol-named variables on the right of `=`, `[` or `in`.
 *       This is the dict/set key shape of the 170.4 D-08 collapse.
 *   M9  a TypeScript list naming venue and symbol that is `.join(":")`-ed (or any
 *       one-character separator) or `JSON.stringify`-ed: a string key by another name.
 *   M10 a TypeScript template over BARE (destructured) identifiers,
 *       `${venue}:${symbol}`; M5 needs a property access and missed it.
 *   M11 a Python f-string interpolating venue then symbol (or the reverse) with a
 *       separator, or a separator `.join` over a venue/symbol list or tuple.
 *   M9-M11 have NO live hit today (measured 2026-10-15). They are PREVENTIVE: the red
 *   and green samples prove they can fire, and they are exempt from the "at least one
 *   live hit" rule below. A first live hit fails here until it is classified.
 *
 * Every (file, matcher) live count is pinned in `CLASSIFICATION` with a verdict, the
 * named symbols that hold the hits, and a reason written after reading the sites.
 * The pin is two-sided: a count that rises (a new instance) OR falls (an instance is
 * gone) without its entry moving fails.
 *
 * SQL is deliberately NOT scanned. `parse_holding_ref` in supabase/ is parse-only and
 * Phase 167.1.1 SC 4 holds supabase/ and analytics-service math unchanged. The Python
 * side IS scanned (match.py builds the same pseudo-ids).
 *
 * KNOWN LIMITS (said once, here): a builder that assembles the prefix from two string
 * pieces (`"holding" + ":"`), or a `new RegExp("^holding:...")` built from a string, is
 * invisible to M1-M11. So is a key assembled by `+` concatenation of the parts, a key
 * built in a helper that takes the parts as separate arguments, and a Python tuple of
 * bare names that is not on the right of `=`, `[` or `in` (a function argument, a
 * `.get((venue, symbol))` call). M8 also fires on a plain call that happens to pass
 * `row["venue"], row["symbol"]` side by side (a log line), which is classified, not
 * hidden. The population floor and the required-file list do not prove those cannot
 * exist; they prove the walk and the matchers are alive.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines, type SourceLang } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

export type MatcherId = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9" | "M10" | "M11";

interface Matcher {
  id: MatcherId;
  /** Which source languages the matcher runs on. */
  langs: readonly SourceLang[];
  re: RegExp;
}

// Round-1 WR-01 (167.1.1): the composite key built WITHOUT the `holding:` prefix
// and without a property access, which M1-M7 cannot see. Each is assembled from
// named pieces so the shape it reads stays legible.
//
// A venue-ish and a symbol-ish accessor in Python: row["venue"], row.get("venue"),
// r.venue. A tuple of the two (either order) is a dict/set key that merges accounts.
const PY_ACC = (name: string): string =>
  `[\\w.]+(?:\\[\\s*["']${name}["']\\s*\\]|\\.get\\(\\s*["']${name}["']\\s*\\)|\\.${name}\\b)`;
const PY_TUPLE_KEY_RE = new RegExp(
  // (a["venue"], a["symbol"] ...) and the symbol-first order
  `\\(\\s*${PY_ACC("venue")}\\s*,\\s*${PY_ACC("symbol")}|\\(\\s*${PY_ACC("symbol")}\\s*,\\s*${PY_ACC("venue")}` +
    // key = (venue, symbol, ...), d[(venue, symbol, ...)], x in (venue, symbol, ...)
    `|(?:=|\\[|\\bin)\\s*\\(\\s*\\w*venue\\w*\\s*,\\s*\\w*symbol\\w*\\b` +
    `|(?:=|\\[|\\bin)\\s*\\(\\s*\\w*symbol\\w*\\s*,\\s*\\w*venue\\w*\\b`,
  "g",
);
// A bracketed list naming venue and symbol (either order) that is then JOINED with a
// separator or serialised with JSON.stringify: a string key by another name.
const BR = "[^\\[\\]]*";
const TS_ARRAY_KEY_RE = new RegExp(
  `\\[${BR}venue${BR}symbol${BR}\\]\\s*\\.join\\(\\s*(["'\`])[:|#/\\-,]\\1\\s*\\)` +
    `|\\[${BR}symbol${BR}venue${BR}\\]\\s*\\.join\\(\\s*(["'\`])[:|#/\\-,]\\2\\s*\\)` +
    `|JSON\\.stringify\\(\\s*\\[${BR}venue${BR}symbol${BR}\\]` +
    `|JSON\\.stringify\\(\\s*\\[${BR}symbol${BR}venue${BR}\\]`,
  "g",
);
// A template over BARE (destructured) identifiers: `${venue}:${symbol}`. M5 needs a
// property access, so a destructured pair slipped past it. A `holding:` prefix is
// excluded on purpose: M3 already counts that template.
const TS_BARE_TEMPLATE_RE =
  /(?<!holding:)\$\{\s*\w*(?:venue|exchange)\w*\s*\}[:|#/\-,]\$\{\s*\w*symbol\w*\s*\}|(?<!holding:)\$\{\s*\w*symbol\w*\s*\}[:|#/\-,]\$\{\s*\w*(?:venue|exchange)\w*\s*\}/g;
// The Python twins: an f-string interpolating a venue-ish then a symbol-ish part
// (bare name, attribute or subscript) with a separator between, or a separator
// `.join` over a venue/symbol list or tuple. The `holding:` prefixed f-string is M4's.
const PY_KEY_STRING_RE =
  /(?<!holding:)\{[^{}]*venue[^{}]*\}[:|#/\-,]\{[^{}]*symbol[^{}]*\}|(?<!holding:)\{[^{}]*symbol[^{}]*\}[:|#/\-,]\{[^{}]*venue[^{}]*\}|["'][:|#/\-,]["']\.join\(\s*[\[(][^\n)]{0,80}?venue[^\n)]{0,80}?symbol|["'][:|#/\-,]["']\.join\(\s*[\[(][^\n)]{0,80}?symbol[^\n)]{0,80}?venue/g;

const MATCHERS: readonly Matcher[] = [
  { id: "M1", langs: ["ts"], re: /\bholdingScopeKey\b/g },
  { id: "M2", langs: ["ts"], re: /\bbuildHoldingRef\(/g },
  { id: "M3", langs: ["ts"], re: /`holding:[^`]*\$\{/g },
  { id: "M4", langs: ["py"], re: /\b(?:[rR][fF]|[fF][rR]?)(["'])holding:[^"'\n]*\{/g },
  {
    id: "M5",
    langs: ["ts"],
    re: /\$\{[^}]*\.symbol\}:\$\{[^}]*\.venue\}|\$\{[^}]*\.venue\}:\$\{[^}]*\.symbol\}/g,
  },
  { id: "M6", langs: ["ts", "py"], re: /(["'])holding:\1/g },
  { id: "M7", langs: ["ts"], re: /\/\^holding:/g },
  { id: "M8", langs: ["py"], re: PY_TUPLE_KEY_RE },
  { id: "M9", langs: ["ts"], re: TS_ARRAY_KEY_RE },
  { id: "M10", langs: ["ts"], re: TS_BARE_TEMPLATE_RE },
  { id: "M11", langs: ["py"], re: PY_KEY_STRING_RE },
];

const MATCHER_IDS: readonly MatcherId[] = MATCHERS.map((m) => m.id);

/** Matchers with no live hit at 2026-10-15; see the docblock (round-1 WR-01). */
const PREVENTIVE_MATCHERS: readonly MatcherId[] = ["M9", "M10", "M11"];

/** Comment-stripped source, memoised (the walk strips ~1000 files once). */
const STRIPPED = new Map<string, string>();
function strip(source: string, lang: SourceLang): string {
  const memoKey = `${lang}\u0000${source}`;
  let code = STRIPPED.get(memoKey);
  if (code === undefined) {
    code = stripCommentsPreserveLines(source, lang);
    STRIPPED.set(memoKey, code);
  }
  return code;
}

/** 1-based line of `index` in `code`. */
function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (code.charCodeAt(i) === 10) line++;
  return line;
}

/** Every hit's 1-based line for `matcher` in `source`, comments stripped first. */
export function hitLines(matcher: Matcher, source: string, lang: SourceLang): number[] {
  if (!matcher.langs.includes(lang)) return [];
  const code = strip(source, lang);
  const re = new RegExp(matcher.re.source, matcher.re.flags);
  const out: number[] = [];
  for (const m of code.matchAll(re)) out.push(lineOf(code, m.index ?? 0));
  return out;
}

const matcherOf = (id: MatcherId): Matcher => {
  const m = MATCHERS.find((x) => x.id === id);
  if (!m) throw new Error(`no matcher ${id}`);
  return m;
};

// ---------------------------------------------------------------------------
// Classification: file -> matcher -> pinned count + verdict + symbols + reason
// ---------------------------------------------------------------------------

export const VERDICTS = [
  "definition",
  "rekeyed",
  "merges-on-purpose",
  "key-free-by-design",
  "parse-only",
  "display-only",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface ClassEntry {
  /** The exact number of hits the matcher finds in the file. */
  count: number;
  verdict: Verdict;
  /** Named symbols that hold the hits; each must appear in the file's stripped source. */
  symbols: readonly string[];
  /** Why the verdict is right, written after reading the sites. */
  reason: string;
}
export type Classification = Readonly<
  Record<string, Readonly<Partial<Record<MatcherId, ClassEntry>>>>
>;

const ALLOC = "src/app/(dashboard)/allocations";

/**
 * Read 2026-10-15 at the Phase 167.1.1 worktree (plans 01, 02, 03, 05 landed).
 * Every `count` below is the live scan, never a figure carried over from a plan.
 */
export const CLASSIFICATION: Classification = {
  "src/lib/keys.ts": {
    M1: {
      count: 1,
      verdict: "definition",
      symbols: ["holdingScopeKey"],
      reason: "The one definition of the key-free scope key; every other hit is a consumer of it.",
    },
    M3: {
      count: 1,
      verdict: "definition",
      symbols: ["holdingScopeKey"],
      reason: "The template literal inside holdingScopeKey itself: the only place the `holding:` prefix is built in TypeScript.",
    },
    M5: {
      count: 1,
      verdict: "definition",
      symbols: ["holdingScopeKey"],
      reason: "The same template line as M3 (venue then symbol), so one definition line reads as two shapes.",
    },
  },
  "src/lib/queries.ts": {
    M1: {
      count: 2,
      verdict: "rekeyed",
      symbols: ["derivePhase07Fields"],
      reason: "The import and the one call in derivePhase07Fields. The call is the dedup key `${api_key_id}|${holdingScopeKey(r)}`: Phase 170.4 D-08 made each key's position its own row, and the one-key-per-account-day rule (D-10) then narrows it by account, never by scope key alone.",
    },
  },
  "src/app/api/allocator/scenario/commit/route.ts": {
    M1: {
      count: 2,
      verdict: "merges-on-purpose",
      symbols: ["holdingValueByRef"],
      reason: "The import and the audit recompute's `holdingValueByRef`: it sums value per scope ref over rows that are already one-key-per-account-day (oneKeyPerAccountDay), the same per-ref line the Scenario draft carries. Two keys on one ref are two summands, not one overwritten entry.",
    },
    M7: {
      count: 1,
      verdict: "parse-only",
      symbols: ["HOLDING_REF_RE"],
      reason: "HOLDING_REF_RE validates the shape of an incoming toggle ref; it builds nothing and keys no money figure.",
    },
  },
  [`${ALLOC}/lib/scenario-state.ts`]: {
    M1: {
      count: 2,
      verdict: "merges-on-purpose",
      symbols: ["holdingRefOf", "defaultDraftFromHoldings"],
      reason: "The import and holdingRefOf, which defaultDraftFromHoldings uses to give a ref ONE toggle whose weight is the SUMMED value of every key's row over the book total (D-08). One toggle per scope ref is the persisted keyspace.",
    },
    M5: {
      count: 1,
      verdict: "merges-on-purpose",
      symbols: ["computeHoldingsFingerprint"],
      reason: "The fingerprint is a SET of symbol:venue:type tokens that must equal the commit RPC's `DISTINCT ON (venue, symbol, holding_type)` token array, so two keys on one ref are one token by design (170.4 D-08, D-10).",
    },
  },
  [`${ALLOC}/lib/holding-outcome-adapter.ts`]: {
    M1: {
      count: 2,
      verdict: "key-free-by-design",
      symbols: ["buildHoldingRef"],
      reason: "The import and buildHoldingRef's delegation to the canonical builder. The persisted Bridge scope_ref (toggles, match decisions, outcomes) is venue:symbol:type; a decision is about a holding in the abstract, not about one key's copy.",
    },
    M2: {
      count: 3,
      verdict: "key-free-by-design",
      symbols: ["buildHoldingRef", "deriveEligibleForOutcome", "toVoluntaryRemoveDecision"],
      reason: "The definition and its two callers: both look up or write a Bridge decision/outcome by scope ref, which is key-free in the database as well.",
    },
  },
  [`${ALLOC}/HoldingsTabPanel.tsx`]: {
    M2: {
      count: 2,
      verdict: "rekeyed",
      symbols: ["spotHoldingRows", "openPositionRows"],
      reason: "The spot and derivative row builders call buildHoldingRef for the scope ref, then make the ROW id `${ref}#${api_key_id}`, so each key's position is its own row on Holdings and Open Positions (the SC 1 test renders two).",
    },
  },
  [`${ALLOC}/ScenarioFlaggedHoldingsList.tsx`]: {
    M2: {
      count: 2,
      verdict: "key-free-by-design",
      symbols: ["flaggedHoldings"],
      reason: "Flagged holdings come from the match batch, which is built per scope ref (match.py pseudo-strategies); the ref looks up that flag's decision and outcome. No dollar figure is keyed here.",
    },
  },
  [`${ALLOC}/components/BridgeDrawer.tsx`]: {
    M2: {
      count: 5,
      verdict: "key-free-by-design",
      symbols: ["candidates", "onAddToScenario"],
      reason: "The drawer picks a holding for a Bridge conversation and adds its scope ref to the Scenario: the ref is the persisted Bridge keyspace, and the Scenario holds one toggle per ref (merges on purpose downstream).",
    },
  },
  [`${ALLOC}/lib/live-holdings-summary.ts`]: {
    M2: {
      count: 1,
      verdict: "key-free-by-design",
      symbols: ["holdingsByRef"],
      reason: "holdingsByRef groups the toggle's scope ref to EVERY key's row and keeps them all; summarizeLiveHoldings then classifies each row by its OWN key. The grouping is key-free because the toggle is, the rows are not merged (SC 1 pins two rows per ref).",
    },
    M6: {
      count: 1,
      verdict: "parse-only",
      symbols: ["summarizeLiveHoldings"],
      reason: "A `startsWith(\"holding:\")` guard that skips Scenario toggles which are strategy ids; it reads the prefix and builds nothing.",
    },
  },
  [`${ALLOC}/lib/holdings-adapter.ts`]: {
    M2: {
      count: 2,
      verdict: "key-free-by-design",
      symbols: ["toDesignHoldings"],
      reason: "Joins a flag and a decision to a holding by scope ref, which is key-free in the database. LATENT, recorded not fixed: the row it returns carries `id: ref`, which would collide for two keys' rows, and `toDesignHoldings` has NO production caller (grep at 2026-10-15), the same unreachable K2 path plan 02 recorded. Whoever first wires it must key the row id by ref plus api_key_id.",
    },
  },
  [`${ALLOC}/components/BridgeWidget.tsx`]: {
    M5: {
      count: 1,
      verdict: "display-only",
      symbols: ["flaggedHoldings"],
      reason: "A React list key over the flagged holdings, which are one per scope ref (the match batch is per ref), so two API keys cannot produce a duplicate key. Keys no money figure.",
    },
  },
  "src/lib/notes/scope-ref.ts": {
    M5: {
      count: 1,
      verdict: "key-free-by-design",
      symbols: ["buildHoldingScopeRef"],
      reason: "The note scope ref (venue:symbol:type, no prefix): a note is about the holding in the abstract, so two keys on one ref share one note.",
    },
  },
  "src/app/api/match/decisions/holding/route.ts": {
    M6: {
      count: 2,
      verdict: "parse-only",
      symbols: ["parseHoldingRef"],
      reason: "parseHoldingRef strips the prefix and splits the three parts to look the holding up; the match decision it writes is per scope ref.",
    },
    M7: {
      count: 1,
      verdict: "parse-only",
      symbols: ["BodySchema"],
      reason: "The body schema's holding_ref validator: shape check only.",
    },
  },
  [`src/app/(dashboard)/compare/lib/holding-compare-adapter.ts`]: {
    M6: {
      count: 2,
      verdict: "parse-only",
      symbols: ["parseHoldingCompareId"],
      reason: "parseHoldingCompareId parses the /compare id into venue, symbol and type. The price series it then reads is per (venue, symbol, type) with one mark per day across keys (plan 03), so a ref names the asset there, not one key's copy.",
    },
  },
  "analytics-service/routers/match.py": {
    M4: {
      count: 4,
      verdict: "merges-on-purpose",
      symbols: [
        "_load_holding_portfolio_context",
        "_load_allocator_context",
        "compute_holding_flags",
        "_score_one_allocator",
      ],
      reason: "Every f-string builds the Bridge pseudo-strategy id from the COLLAPSED holdings: _load_holding_portfolio_context applies the account rule (one_key_per_account_day) and then SUMS the counted keys' values into one row per (venue, symbol, holding_type); the other three rebuild the same id from those rows. One pseudo-strategy per ref, carrying the total once, is the matcher's unit.",
    },
    M6: {
      count: 1,
      verdict: "parse-only",
      symbols: ["compute_holding_flags"],
      reason: "A `startswith(\"holding:\")` guard that keeps pseudo-ids out of the real-strategy candidate pick; it reads the prefix.",
    },
    M8: {
      count: 1,
      verdict: "merges-on-purpose",
      symbols: ["_load_holding_portfolio_context", "holdings_map", "one_key_per_account_day"],
      reason: "The tuple (venue, symbol, holding_type) is the SUMMING key of holdings_map, the unit the matcher scores. It is built only AFTER the per-key per-account rule: one_key_per_account_day picks one key per account, so two accounts' rows of one asset reach the map as two summands (170.4 D-08, D-10) and are added together on purpose, never overwritten. The same collapse the M4 pseudo-strategy ids rely on.",
    },
  },
};

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

/**
 * The files the walk must contain, whatever else it finds: the definition and every
 * consumer the plan named. A walk that lost one of these is not scanning the repo.
 */
const REQUIRED_FILES: readonly string[] = [
  "src/lib/keys.ts",
  "src/lib/queries.ts",
  "src/app/api/allocator/scenario/commit/route.ts",
  `${ALLOC}/lib/scenario-state.ts`,
  `${ALLOC}/lib/holding-outcome-adapter.ts`,
  "analytics-service/routers/match.py",
];

/**
 * Measured 2026-10-15: 907 files (src `.ts`/`.tsx` outside tests, plus analytics-service
 * `.py` outside tests and the venv). `HOLDING_CENSUS_PRINT=1` prints the live count.
 * The floor sits a little under it so ordinary churn does not trip it and an empty
 * or truncated walk does.
 */
const POPULATION_FLOOR = 850;

const SRC_EXTS = /\.tsx?$/;
const PY_EXT = /\.py$/;
const PY_SKIP_DIRS = new Set(["tests", ".venv", "__pycache__", "node_modules"]);
const TS_SKIP_DIRS = new Set(["__tests__", "fixtures"]);

export function isTestPath(rel: string): boolean {
  return (
    /\.test\.[^/]+$/.test(rel) ||
    rel.split("/").some((seg) => TS_SKIP_DIRS.has(seg) || seg === "tests")
  );
}

function walk(root: string, accept: RegExp, skipDirs: ReadonlySet<string>, out: string[]): void {
  if (!existsSync(join(REPO_ROOT, root))) return;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        visit(abs);
        continue;
      }
      if (!accept.test(entry)) continue;
      const rel = relative(REPO_ROOT, abs).split("\\").join("/");
      if (!isTestPath(rel)) out.push(rel);
    }
  };
  visit(join(REPO_ROOT, root));
}

function listPopulation(): string[] {
  const out: string[] = [];
  walk("src", SRC_EXTS, TS_SKIP_DIRS, out);
  walk("analytics-service", PY_EXT, PY_SKIP_DIRS, out);
  return [...new Set(out)].sort();
}

const langOf = (rel: string): SourceLang => (rel.endsWith(".py") ? "py" : "ts");
const readRel = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

interface LiveHit {
  file: string;
  line: number;
  matcher: MatcherId;
}

/** Scan the whole population once. */
function scanPopulation(files: readonly string[]): LiveHit[] {
  const hits: LiveHit[] = [];
  for (const file of files) {
    const source = readRel(file);
    // Cheap pre-filter: every matcher needs the literal `holding` in the file.
    if (!source.includes("holding") && !source.includes("Holding")) continue;
    const lang = langOf(file);
    for (const m of MATCHERS) {
      for (const line of hitLines(m, source, lang)) hits.push({ file, line, matcher: m.id });
    }
  }
  return hits;
}

function countsFor(hits: readonly LiveHit[], matcher: MatcherId): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of hits) if (h.matcher === matcher) out.set(h.file, (out.get(h.file) ?? 0) + 1);
  return out;
}

/** Two-sided pin check: a count that rises OR falls without its pin moving is a problem. */
export function pinProblems(
  matcher: MatcherId,
  actual: ReadonlyMap<string, number>,
  linesByFile: ReadonlyMap<string, number[]>,
  classification: Classification,
): string[] {
  const problems: string[] = [];
  const files = new Set<string>([...actual.keys()]);
  for (const [file, entries] of Object.entries(classification)) if (entries[matcher]) files.add(file);
  for (const file of [...files].sort()) {
    const found = actual.get(file) ?? 0;
    const pin = classification[file]?.[matcher]?.count;
    const where = (linesByFile.get(file) ?? []).map((l) => `${file}:${l}`).join(", ");
    if (pin === undefined) {
      if (found > 0) {
        problems.push(
          `${matcher} ${file}: ${found} unclassified hit(s) at ${where}. Read each site and add a CLASSIFICATION entry with a verdict and a reason (re-keyed per api_key_id, or shown to need no key).`,
        );
      }
    } else if (found !== pin) {
      problems.push(
        `${matcher} ${file}: ${found} found, pinned ${pin} (${found > pin ? "a new instance" : "an instance is gone"}${where ? ` at ${where}` : ""}): move the pin and re-read the sites.`,
      );
    }
  }
  return problems;
}

function linesByFileFor(hits: readonly LiveHit[], matcher: MatcherId): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const h of hits) {
    if (h.matcher !== matcher) continue;
    const arr = out.get(h.file) ?? [];
    arr.push(h.line);
    out.set(h.file, arr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests: every matcher can fail, and can pass
// ---------------------------------------------------------------------------

const BT = "`";

interface Sample {
  lang: SourceLang;
  /** Each red source yields EXACTLY one hit. */
  red: readonly string[];
  /** Each green source yields none, including the red text inside a comment. */
  green: readonly string[];
}

const SAMPLES: Record<MatcherId, Sample> = {
  M1: {
    lang: "ts",
    red: ["const k = holdingScopeKey(row);", 'import { holdingScopeKey } from "@/lib/keys";'],
    green: [
      "// const k = holdingScopeKey(row);",
      "/* const k = holdingScopeKey(row); */",
      "const k = holdingScopeKeys(row);",
      "const k = myholdingScopeKey2(row);",
    ],
  },
  M2: {
    lang: "ts",
    red: ["const ref = buildHoldingRef(h);", "export function buildHoldingRef(h: H): string {"],
    green: [
      "// const ref = buildHoldingRef(h);",
      "/* buildHoldingRef(h) */",
      'import { buildHoldingRef } from "./x";',
      "const ref = rebuildHoldingRefs(h);",
    ],
  },
  M3: {
    lang: "ts",
    red: [`return ${BT}holding:\${h.venue}:\${h.symbol}${BT};`],
    green: [
      `// return ${BT}holding:\${h.venue}${BT};`,
      `/* ${BT}holding:\${h.venue}${BT} */`,
      `return ${BT}venue:\${h.venue}${BT};`,
      `return ${BT}holding:fixed${BT};`,
    ],
  },
  M4: {
    lang: "py",
    red: [`pseudo_id = f"holding:{venue}:{symbol}"`, `pseudo_id = f'holding:{venue}'`, `pseudo_id = f"holding:{row['venue']}"`],
    green: [
      `# pseudo_id = f"holding:{venue}"`,
      `pseudo_id = "holding:{venue}"`,
      `pseudo_id = f"venue:{venue}"`,
      `pseudo_id = f"holding:fixed"`,
    ],
  },
  M5: {
    lang: "ts",
    red: [
      `const t = ${BT}\${h.symbol}:\${h.venue}:\${h.holding_type}${BT};`,
      `const t = ${BT}\${h.venue}:\${h.symbol}:\${h.holding_type}${BT};`,
    ],
    green: [
      `// const t = ${BT}\${h.symbol}:\${h.venue}${BT};`,
      `/* ${BT}\${h.venue}:\${h.symbol}${BT} */`,
      `const t = ${BT}\${h.venue}-\${h.symbol}${BT};`,
      `const t = ${BT}\${h.symbol}:\${h.side}${BT};`,
    ],
  },
  M6: {
    lang: "ts",
    red: ['if (!ref.startsWith("holding:")) return null;', "const rest = ref.slice('holding:'.length);"],
    green: [
      '// if (!ref.startsWith("holding:")) return null;',
      '/* "holding:" */',
      'const s = "holding:binance";',
      'const s = "my-holding:";',
    ],
  },
  M7: {
    lang: "ts",
    red: ["const RE = /^holding:[A-Za-z0-9_-]+$/;"],
    green: [
      "// const RE = /^holding:[A-Za-z0-9_-]+$/;",
      "/* /^holding:x/ */",
      "const RE = /^venue:[A-Za-z0-9_-]+$/;",
      'const RE = new RegExp("^venue:x");',
    ],
  },
  M8: {
    lang: "py",
    red: [
      `key = (counted["venue"], counted["symbol"], counted["holding_type"])`,
      `seen.add((r.get("symbol"), r.get("venue")))`,
      `key = (row.venue, row.symbol, row.holding_type)`,
      `key = (venue, symbol, holding_type)`,
      `by_ref[(symbol, venue)] = value`,
    ],
    green: [
      `# key = (counted["venue"], counted["symbol"], counted["holding_type"])`,
      `key = (counted["venue"], counted["holding_type"])`,
      `key = (venue, holding_type)`,
      `def load(venue, symbol):`,
      `kw = dict(venue=v, symbol=s)`,
      `row["venue"], row["symbol"] = a, b`,
    ],
  },
  M9: {
    lang: "ts",
    red: [
      `const k = [h.venue, h.symbol, h.holding_type].join(":");`,
      `const k = [row.symbol, row.venue].join("|");`,
      `byKey.set(JSON.stringify([r.venue, r.symbol, r.holding_type]), r);`,
    ],
    green: [
      `// const k = [h.venue, h.symbol].join(":");`,
      `const k = [h.venue, h.side].join(":");`,
      `const k = [h.venue, h.symbol].join("");`,
      `const pair = [h.venue, h.symbol];`,
      `const s = JSON.stringify([h.venue, h.side]);`,
    ],
  },
  M10: {
    lang: "ts",
    red: [
      `const k = ${BT}\${venue}:\${symbol}:\${holding_type}${BT};`,
      `const k = ${BT}\${symbol}|\${exchange}${BT};`,
    ],
    green: [
      `// const k = ${BT}\${venue}:\${symbol}${BT};`,
      `const k = ${BT}holding:\${venue}:\${symbol}${BT};`,
      `const k = ${BT}\${venue}-label:\${side}${BT};`,
      `const k = ${BT}\${h.venue}:\${h.symbol}${BT};`,
    ],
  },
  M11: {
    lang: "py",
    red: [
      `key = f"{venue}:{symbol}:{holding_type}"`,
      `key = f"{row['symbol']}|{row['venue']}"`,
      `key = ":".join([venue, symbol, holding_type])`,
      `key = "|".join((row["symbol"], row["venue"]))`,
    ],
    green: [
      `# key = f"{venue}:{symbol}"`,
      `pseudo_id = f"holding:{venue}:{symbol}:{holding_type}"`,
      `key = f"{venue}-{side}"`,
      `key = ":".join([venue, side])`,
    ],
  },
};

describe("[167.1.1 SC-2] matcher self-tests: each matcher fires on its red text and stays quiet on its green text", () => {
  for (const id of MATCHER_IDS) {
    const m = matcherOf(id);
    const s = SAMPLES[id];
    it(`${id}: exactly one hit per red source`, () => {
      for (const src of s.red) {
        expect(hitLines(m, src, s.lang), `${id} on ${JSON.stringify(src)}`).toHaveLength(1);
      }
    });
    it(`${id}: no hit on any green source, comments included`, () => {
      for (const src of s.green) {
        expect(hitLines(m, src, s.lang), `${id} on ${JSON.stringify(src)}`).toEqual([]);
      }
    });
  }

  it("M6 also reads Python, and a matcher never runs on the wrong language", () => {
    expect(hitLines(matcherOf("M6"), `if not str(c).startswith("holding:"):`, "py")).toHaveLength(1);
    expect(hitLines(matcherOf("M6"), `# startswith("holding:")`, "py")).toEqual([]);
    // M1 is TypeScript-only: the same text in a Python file is not a hit.
    expect(hitLines(matcherOf("M1"), "x = holdingScopeKey(r)", "py")).toEqual([]);
    // M4 is Python-only.
    expect(hitLines(matcherOf("M4"), `const a = f"holding:{v}"`, "ts")).toEqual([]);
  });

  it("the line number is the real source line, not a stripped-source line", () => {
    const src = ["// a", "/* b", "   c */", "const k = holdingScopeKey(r);"].join("\n");
    expect(hitLines(matcherOf("M1"), src, "ts")).toEqual([4]);
  });
});

describe("[167.1.1 SC-2] pinProblems: a pin can fail in both directions and pass on an exact match", () => {
  const entry = (count: number): ClassEntry => ({
    count,
    verdict: "parse-only",
    symbols: ["x"],
    reason: "a reason long enough to count as a reason",
  });
  const allow: Classification = { "a.ts": { M1: entry(2) } };
  const lines = new Map<string, number[]>([["a.ts", [3, 9]], ["b.ts", [7]]]);

  it("red: an unpinned file with hits names the file and the line", () => {
    const p = pinProblems("M1", new Map([["a.ts", 2], ["b.ts", 1]]), lines, allow);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("b.ts");
    expect(p[0]).toContain("b.ts:7");
    expect(p[0]).toContain("unclassified");
  });
  it("red: a pin above the live count is stale", () => {
    const p = pinProblems("M1", new Map([["a.ts", 1]]), new Map([["a.ts", [3]]]), allow);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("an instance is gone");
  });
  it("red: a live count above the pin is a new instance", () => {
    const p = pinProblems("M1", new Map([["a.ts", 3]]), new Map([["a.ts", [1, 2, 3]]]), allow);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("a new instance");
  });
  it("red: a pinned file with no live hit at all is stale", () => {
    const p = pinProblems("M1", new Map(), new Map(), allow);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("0 found, pinned 2");
  });
  it("green: exact counts and an empty scan with no pin raise nothing", () => {
    expect(pinProblems("M1", new Map([["a.ts", 2]]), lines, allow)).toEqual([]);
    expect(pinProblems("M2", new Map(), new Map(), allow)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The live census
// ---------------------------------------------------------------------------

const POPULATION = listPopulation();
const HITS = scanPopulation(POPULATION);

// `HOLDING_CENSUS_PRINT=1 npx vitest run src/__tests__/holding-scope-key-census.test.ts`
// prints the live scan (the evidence a SUMMARY pastes, and the figures a pin move
// is re-derived from). Silent otherwise.
if (process.env.HOLDING_CENSUS_PRINT === "1") {
  const rows = MATCHER_IDS.flatMap((id) =>
    [...countsFor(HITS, id)].map(([file, n]) => {
      const e = CLASSIFICATION[file]?.[id];
      return `${id}  ${String(n).padStart(2)}  ${(e?.verdict ?? "UNCLASSIFIED").padEnd(18)} ${file}  [${linesByFileFor(HITS, id).get(file)?.join(",")}]`;
    }),
  );
  process.stdout.write(`census population: ${POPULATION.length} files\n${rows.join("\n")}\n`);
}

describe("[167.1.1 SC-2] the walk is alive: it cannot pass by scanning nothing", () => {
  it("scans at least the floor of files, none of them a test path, and every required file", () => {
    expect(POPULATION.length, `scanned ${POPULATION.length} files`).toBeGreaterThanOrEqual(POPULATION_FLOOR);
    expect(POPULATION.some(isTestPath)).toBe(false);
    expect(POPULATION.some((f) => f.includes("/.venv/") || f.includes("node_modules"))).toBe(false);
    for (const required of REQUIRED_FILES) {
      expect(POPULATION, `required file ${required} missing from the walk`).toContain(required);
    }
  });

  it("covers both languages", () => {
    expect(POPULATION.some((f) => f.endsWith(".ts"))).toBe(true);
    expect(POPULATION.some((f) => f.endsWith(".tsx"))).toBe(true);
    expect(POPULATION.some((f) => f.endsWith(".py"))).toBe(true);
  });

  it("every matcher has at least one live hit, or is PREVENTIVE and proven by its red samples", () => {
    for (const id of MATCHER_IDS) {
      if (PREVENTIVE_MATCHERS.includes(id)) {
        expect(SAMPLES[id].red.length, `${id} is preventive but has no red sample`).toBeGreaterThan(0);
        continue;
      }
      expect(HITS.filter((h) => h.matcher === id).length, `${id} found nothing in the repo`).toBeGreaterThan(0);
    }
  });

  it("the preventive set is exactly the matchers that have no live hit today", () => {
    // Measured 2026-10-15. If M9-M11 ever gain a hit, classify it; this stays a
    // statement of why they are exempt, so shrink the set once one is pinned.
    for (const id of PREVENTIVE_MATCHERS) {
      expect(MATCHER_IDS, `unknown preventive matcher ${id}`).toContain(id);
    }
    expect(PREVENTIVE_MATCHERS).toEqual(["M9", "M10", "M11"]);
  });
});

describe("[167.1.1 SC-2] every consumer of the holding scope key shape is classified, and the pins are exact", () => {
  for (const id of MATCHER_IDS) {
    it(`${id}: live (file, count) equals the pinned classification`, () => {
      const problems = pinProblems(id, countsFor(HITS, id), linesByFileFor(HITS, id), CLASSIFICATION);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

describe("[167.1.1 SC-2] the classification is well formed", () => {
  const entries = Object.entries(CLASSIFICATION).flatMap(([file, byMatcher]) =>
    Object.entries(byMatcher).map(([matcher, entry]) => ({ file, matcher: matcher as MatcherId, entry: entry as ClassEntry })),
  );

  it("is not empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every entry names a scanned file, a real matcher, a count above zero and a closed-set verdict", () => {
    for (const { file, matcher, entry } of entries) {
      expect(POPULATION, `${file} is not in the scanned population`).toContain(file);
      expect(MATCHER_IDS, `${file}: unknown matcher ${matcher}`).toContain(matcher);
      expect(entry.count, `${file} ${matcher}`).toBeGreaterThan(0);
      expect(VERDICTS as readonly string[], `${file} ${matcher}: verdict ${entry.verdict}`).toContain(entry.verdict);
    }
  });

  it("every entry carries a reason of at least 20 characters", () => {
    for (const { file, matcher, entry } of entries) {
      expect(entry.reason.trim().length, `${file} ${matcher}: reason too short`).toBeGreaterThanOrEqual(20);
    }
  });

  it("every entry names at least one symbol, and each symbol appears in that file's stripped source", () => {
    for (const { file, matcher, entry } of entries) {
      expect(entry.symbols.length, `${file} ${matcher}: no symbol named`).toBeGreaterThan(0);
      const code = strip(readRel(file), langOf(file));
      for (const symbol of entry.symbols) {
        const found = new RegExp(`(?<![\\w$])${symbol.replace(/[$]/g, "\\$&")}(?![\\w$])`).test(code);
        expect(found, `${file} ${matcher}: symbol ${symbol} is not in the file (stripped)`).toBe(true);
      }
    }
  });

  it("a matcher only claims a file in a language it runs on", () => {
    for (const { file, matcher } of entries) {
      expect(matcherOf(matcher).langs, `${file} ${matcher}`).toContain(langOf(file));
    }
  });
});

describe("[167.1.1 SC-2] the 2026-10-15 reading is recorded, per consumer", () => {
  const verdictOf = (file: string, matcher: MatcherId) => CLASSIFICATION[file]?.[matcher]?.verdict;

  it("queries.ts derivePhase07Fields is re-keyed per key", () => {
    expect(verdictOf("src/lib/queries.ts", "M1")).toBe("rekeyed");
    expect(CLASSIFICATION["src/lib/queries.ts"]?.M1?.symbols).toContain("derivePhase07Fields");
  });

  it("the commit route, scenario-state and match.py merge across keys on purpose", () => {
    expect(verdictOf("src/app/api/allocator/scenario/commit/route.ts", "M1")).toBe("merges-on-purpose");
    expect(verdictOf(`${ALLOC}/lib/scenario-state.ts`, "M1")).toBe("merges-on-purpose");
    expect(verdictOf(`${ALLOC}/lib/scenario-state.ts`, "M5")).toBe("merges-on-purpose");
    expect(verdictOf("analytics-service/routers/match.py", "M4")).toBe("merges-on-purpose");
    // Round-1 WR-01: the tuple that actually does the summing, pinned in its own right.
    expect(verdictOf("analytics-service/routers/match.py", "M8")).toBe("merges-on-purpose");
    expect(CLASSIFICATION["analytics-service/routers/match.py"]?.M8?.symbols).toContain(
      "one_key_per_account_day",
    );
  });

  it("holding-outcome-adapter buildHoldingRef is the key-free persisted scope ref", () => {
    expect(verdictOf(`${ALLOC}/lib/holding-outcome-adapter.ts`, "M1")).toBe("key-free-by-design");
    expect(verdictOf(`${ALLOC}/lib/holding-outcome-adapter.ts`, "M2")).toBe("key-free-by-design");
  });

  it("the verdict set is closed and every verdict a plan reading needs is in use", () => {
    const used = new Set(
      Object.values(CLASSIFICATION).flatMap((byMatcher) => Object.values(byMatcher).map((e) => e?.verdict)),
    );
    for (const v of VERDICTS) expect(used.has(v), `verdict ${v} is never used`).toBe(true);
  });
});
