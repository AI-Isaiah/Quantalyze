/**
 * Phase 201 plan 06 (D-08, D-03, D-11, D-19, D-21): the copy census POLICY.
 *
 * `scan.ts` is the mechanism and holds no word list. Everything a rule reads is here: the retired
 * words, the exempt scopes, the excluded files, the permanent exceptions and the closed reason set.
 *
 * ORACLE INDEPENDENCE. Rule A's words are typed here and import nothing from the app, so a
 * rename in the code cannot make the census pass against itself (the `figure-gate-census`
 * header rule). Rule B is the one exception, and by design: its matchers are BUILT FROM
 * `GLOSSARY` labels and aliases, because the registry is the single source of what a registered
 * term is called and a hand-typed copy would be a second registry.
 *
 * A PERMANENT GATE, NO PENDING MECHANISM (plan 201-23, D-08). `src/__tests__/copy-census.test.ts`
 * fails on any rule A, B or C hit that is not a row of `EXCEPTIONS`. The per-plan ledgers that let
 * sixteen surface plans run in parallel are gone: their exceptions are folded into `EXCEPTIONS`
 * unchanged, and a hit is either fixed in the code or recorded here with a reason from `REASONS`.
 * A new row changes the pinned count in the census test, so it is a visible, reviewed decision.
 */
import { GLOSSARY, type GlossaryEntry, type TermKey } from "@/lib/glossary";
import type { CensusRule, DatePolicy, ScanPolicy, TermMatcher, WordMatcher } from "./scan";

// ---------------------------------------------------------------------------------------
// Rule A: retired words (D-08, U-10). Case-insensitive whole words, except three phrases that
// are case-sensitive so that "My allocation" in running prose is not the retired name, and so
// that "Bridge" (F-04, U-30) does not read `source: "bridge"`, `[bridge]` log tags or `BridgeDrawer`.
// ---------------------------------------------------------------------------------------

export const RETIRED_WORDS: readonly WordMatcher[] = [
  { id: "portfolio", re: /\bportfolios?\b/i },
  { id: "book", re: /\bbooks?\b/i },
  { id: "favorites", re: /\bfavorites?\b/i },
  { id: "starred", re: /\bstarred\b/i },
  { id: "preference", re: /\bpreferences?\b/i },
  { id: "my-strategies", re: /\bmy strategies\b/i },
  { id: "my-allocation", re: /\bMy Allocation\b/ },
  { id: "my-watchlist", re: /\bMy Watchlist\b/ },
  { id: "bridge", re: /\bBridge\b/ },
];

// ---------------------------------------------------------------------------------------
// Scopes. A covers all of src/. B covers src/app and src/components except four exempt roots.
// C covers all of src/ except the date helper's home.
// ---------------------------------------------------------------------------------------

const inSrc = (file: string): boolean => file.startsWith("src/");

/**
 * Rule B does not read these: both admin roots (U-21, a surface for staff), route copy and the
 * OG image under src/app/api (non-interactive, D-20), and the tearsheet print lane (D-20: a
 * `Term` renders plain text there, so there is nothing to wrap).
 */
export const RULE_B_EXEMPT_PREFIXES: readonly string[] = [
  "src/app/(dashboard)/admin/",
  "src/components/admin/",
  "src/app/api/",
  "src/app/factsheet/[id]/tearsheet/",
];

const inRuleBScope = (file: string): boolean =>
  (file.startsWith("src/app/") || file.startsWith("src/components/")) &&
  !RULE_B_EXEMPT_PREFIXES.some((p) => file.startsWith(p));

/** The one file allowed to print a date by hand: the helper's home (D-11, D-21). */
export const DATE_HELPER_FILES: readonly string[] = ["src/lib/utils.ts"];

// ---------------------------------------------------------------------------------------
// Rule B: matchers BUILT FROM `GLOSSARY` (by design; see the header). Every label and alias is
// a form. A `{comparator}` alias becomes a prefix ("α vs "), because the comparator is printed
// after it.
// ---------------------------------------------------------------------------------------

/**
 * "AUM" and "Track" are plain words outside the discovery table (UI-SPEC "Not registered"), so
 * these six keys match only in the files that print the discovery columns. Typed as `TermKey`,
 * so a rename in the registry is a type error here.
 */
export const DISCOVERY_ONLY_KEYS: readonly TermKey[] = [
  "track",
  "return_full",
  "return_6m",
  "aum",
  "return_curve",
  "underwater",
];

const DISCOVERY_FILES: readonly string[] = [
  "src/components/strategy/discovery-columns.ts",
  "src/components/strategy/StrategyTable.tsx",
  "src/components/strategy/StrategyGrid.tsx",
  "src/components/strategy/CustomizeDrawer.tsx",
];

const inDiscoveryFiles = (file: string): boolean => DISCOVERY_FILES.includes(file);

const COMPARATOR = "{comparator}";

function buildTermMatchers(): TermMatcher[] {
  const discoveryOnly = new Set<string>(DISCOVERY_ONLY_KEYS);
  const out: TermMatcher[] = [];
  for (const [key, entry] of Object.entries(GLOSSARY) as [TermKey, GlossaryEntry][]) {
    const appliesTo = discoveryOnly.has(key) ? inDiscoveryFiles : undefined;
    for (const printed of [entry.label, ...(entry.aliases ?? [])]) {
      const at = printed.indexOf(COMPARATOR);
      const matcher: TermMatcher =
        at >= 0
          ? { key, form: printed.slice(0, at), prefix: true }
          : { key, form: printed, prefix: false };
      out.push(appliesTo ? { ...matcher, appliesTo } : matcher);
    }
  }
  return out;
}

export const TERM_MATCHERS: readonly TermMatcher[] = buildTermMatchers();

// ---------------------------------------------------------------------------------------
// Rule C: dates (D-11, D-21, U-15).
// ---------------------------------------------------------------------------------------

export const DATES: DatePolicy = {
  deprecatedHelpers: ["formatAbsoluteDate", "formatIsoDay"],
  monthNames: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December",
  ],
  optionKeys: ["month", "day", "year", "weekday", "dateStyle"],
  // The fields the R3-01 sites and the planner sweep print raw (F-11, D-11). Adding a name is a
  // reviewed change, and a name listed here is never a reason to except a hit.
  fieldNames: [
    "asof", "until", "computedAt", "recordStart", "startDate", "endDate", "start_date", "effStart", "effEnd",
    "effective_start", "effective_end", "windowStart", "windowEnd", "first_day", "last_day", "firstDay", "lastDay",
    "date_range", "dateRange", "allocated_at", "week_start",
  ],
};

// ---------------------------------------------------------------------------------------
// Closed reason set (D-08). Each reason is one of these shapes and longer than 20 characters,
// so "not user-visible: x" cannot stand in for an explanation.
// ---------------------------------------------------------------------------------------

export const REASONS: readonly RegExp[] = [
  /^plain English, not the \S.* concept: \S.*$/,
  /^verb use: \S.*$/,
  /^not user-visible: \S.*$/,
  /^identifier in string form: \S.*$/,
  /^not a label position: \S.*$/,
  /^not the registered statistic: \S.*$/,
  /^non-interactive render \(D-20\): \S.*$/,
  /^chart axis tick \(D-21\): \S.*$/,
  /^time of day alone \(D-21\): \S.*$/,
  /^machine value \(D-11\): \S.*$/,
  // Founder-scoped (F-04): used by exactly one row, the `scenario` definition. A test pins that.
  /^former name \(F-04\): \S.*$/,
];

export function isValidReason(reason: string): boolean {
  return reason.length > 20 && REASONS.some((re) => re.test(reason));
}

// ---------------------------------------------------------------------------------------
// Excluded files and permanent exceptions (D-08; UI-SPEC "Census exceptions"; RESEARCH 2.2
// bucket e). The exceptions are count-pinned in the census test: one row per occurrence.
// ---------------------------------------------------------------------------------------

export interface ExceptionRow {
  rule: CensusRule;
  file: string;
  literal: string;
  reason: string;
}

export interface ExcludedFileRow {
  rule: CensusRule;
  file: string;
  reason: string;
}

/** A whole file the named rule does not read. */
export const EXCLUDED_FILES: readonly ExcludedFileRow[] = [
  {
    rule: "A",
    file: "src/lib/seam-retry-registry.ts",
    reason: "not user-visible: internal retry registry keys and docblock prose, never rendered",
  },
  {
    rule: "A",
    file: "src/lib/routing/route-contract-manifest.ts",
    reason: "not user-visible: route manifest strings read by the build and the contract check",
  },
  {
    rule: "A",
    file: "src/lib/resilient-fetch.ts",
    reason: "not user-visible: transport error strings and internal docs, never rendered",
  },
];

/** A single literal the named rule reports and a person ruled permanent. One row per occurrence. */
export const EXCEPTIONS: readonly ExceptionRow[] = [
  {
    rule: "A",
    file: "src/components/strategy/RequestIntroButton.tsx",
    literal: "— No preference —",
    reason: "plain English, not the mandate concept: a select option meaning the user chose nothing (D-18)",
  },
  {
    rule: "A",
    file: "src/components/strategy/RequestIntroButton.tsx",
    literal: "— No preference —",
    reason: "plain English, not the mandate concept: a select option meaning the user chose nothing (D-18)",
  },
  {
    rule: "A",
    file: "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
    literal: "PORTFOLIO",
    reason: "identifier in string form: the synthetic symbol the sync stores a whole-account aggregate under",
  },
  {
    rule: "A",
    file: "src/lib/glossary.ts",
    literal:
      "Scenario models changes to your allocation before you make them and shows ranked replacements for holdings outside your mandate. It was formerly called Bridge.",
    reason: "former name (F-04): the registered term names its former name once, so a returning user can match the two (F-04, F-08)",
  },
  // Folded from the plan 201-09 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/app/factsheet/[id]/v2/FactsheetView.tsx",
    literal: "Returns Signatures",
    reason: "not a label position: a section name in the Advanced contents line, which joins the names into one summary sentence; the section's own title carries the definition",
  },
  // Folded from the plan 201-13 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/components/portfolio/ReplacementCard.tsx",
    literal: "Sharpe",
    reason: "not a label position: the delta key prints as the unit suffix of one formatted value, \"+0.25 Sharpe\", never as a standalone label",
  },
  {
    rule: "B",
    file: "src/components/portfolio/ReplacementCard.tsx",
    literal: "MaxDD",
    reason: "not a label position: the delta key prints as the unit suffix of one formatted value, \"+4.0% MaxDD\", never as a standalone label",
  },
  // Folded from the plan 201-14 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx",
    literal: "Correlation matrix",
    reason: "not a label position: the accessible name of the table's scroll region, read by a screen reader and never drawn as a visible label",
  },
  // Folded from the plan 201-15 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/app/(dashboard)/allocations/lib/mandate-gates.ts",
    literal: "Max DD floor",
    reason: "not user-visible: the gate row's label has no render caller (deriveMandateGates is read only by its own tests and the figure census lists the file as no render); a future render must wrap Max DD in a Term",
  },
  // Folded from the plan 201-16 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/components/strategy/CustomizeDrawer.tsx",
    literal: "Sharpe",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/CustomizeDrawer.tsx",
    literal: "CAGR",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/CustomizeDrawer.tsx",
    literal: "Max Drawdown",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/CustomizeDrawer.tsx",
    literal: "Volatility",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/CustomizeDrawer.tsx",
    literal: "AUM",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyFilters.tsx",
    literal: "CAGR",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyFilters.tsx",
    literal: "Sharpe",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyFilters.tsx",
    literal: "Max DD",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyFilters.tsx",
    literal: "Volatility",
    reason: "not a label position: the text of an <option> in a native select, which cannot host a Term trigger; the select is itself the control",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyGrid.tsx",
    literal: "AUM",
    reason: "not a label position: the label sits inside the card's factsheet link, where a Term trigger would nest a focusable in a link; a Tooltip shows the registry definition on hover",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyTable.tsx",
    literal: "AUM",
    reason: "not a label position: the string is joined into the Not shown sentence, which is running prose (D-19), never rendered as a label",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyTable.tsx",
    literal: "CAGR",
    reason: "not a label position: the string is joined into the Not shown sentence, which is running prose (D-19), never rendered as a label",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyTable.tsx",
    literal: "Max DD",
    reason: "not a label position: the string is joined into the Not shown sentence, which is running prose (D-19), never rendered as a label",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyTable.tsx",
    literal: "Volatility",
    reason: "not a label position: the string is joined into the Not shown sentence, which is running prose (D-19), never rendered as a label",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyTable.tsx",
    literal: "Sharpe",
    reason: "not a label position: the string is joined into the Not shown sentence, which is running prose (D-19), never rendered as a label",
  },
  {
    rule: "B",
    file: "src/components/strategy/StrategyTable.tsx",
    literal: "Calmar",
    reason: "not a label position: the string is joined into the Not shown sentence, which is running prose (D-19), never rendered as a label",
  },
  // Folded from the plan 201-18 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/components/mandate/MandateSaveStatus.tsx",
    literal: "Mandate saved",
    reason: "not a label position: a 2-second status flash in an aria-live region, so a keyboard tab stop on it would vanish under focus; the Mandate tab and the form's field labels carry the definition (D-06)",
  },
  // Folded from the plan 201-19 ledger (plan 201-23, D-08).
  {
    rule: "A",
    file: "src/lib/wizardErrors.ts",
    literal: "TypeScript for a missing Supabase session (portfolio-optimizer,",
    reason: "not user-visible: the reason column of VENUE_WIRE_CODES_WITHOUT_VERDICT, read only by seam-venue-vocabulary.invariant.test.ts and never by a rendered surface",
  },
  {
    rule: "A",
    file: "src/lib/wizardErrors.ts",
    literal: "from `_compute_portfolio_analytics` in portfolio.py when the analytics",
    reason: "not user-visible: the reason column of VENUE_WIRE_CODES_WITHOUT_VERDICT, read only by seam-venue-vocabulary.invariant.test.ts and never by a rendered surface",
  },
  {
    rule: "A",
    file: "src/lib/wizardErrors.ts",
    literal: "Detail: 'Portfolio analytics computation failed', 500, the outer catch of",
    reason: "not user-visible: the reason column of VENUE_WIRE_CODES_WITHOUT_VERDICT, read only by seam-venue-vocabulary.invariant.test.ts and never by a rendered surface",
  },
  {
    rule: "A",
    file: "src/lib/wizardErrors.ts",
    literal: "Detail: 'Portfolio impact simulation failed', 500, from",
    reason: "not user-visible: the reason column of VENUE_WIRE_CODES_WITHOUT_VERDICT, read only by seam-venue-vocabulary.invariant.test.ts and never by a rendered surface",
  },
  {
    rule: "A",
    file: "src/lib/wizardErrors.ts",
    literal: "That surface is the portfolio impact panel, which has no key, no draft",
    reason: "not user-visible: the reason column of VENUE_WIRE_CODES_WITHOUT_VERDICT, read only by seam-venue-vocabulary.invariant.test.ts and never by a rendered surface",
  },
  // Folded from the plan 201-22 ledger (plan 201-23, D-08).
  {
    rule: "A",
    file: "src/lib/notes/ownership.ts",
    literal: "portfolio not owned",
    reason: "not user-visible: a diagnostic reason string on the ownership result, never surfaced to the HTTP caller",
  },
  {
    rule: "A",
    file: "src/lib/portfolio-exposure.ts",
    literal: "portfolio-exposure: api_keys identity read reached the row cap (",
    reason: "not user-visible: a thrown error message naming the module and the api_keys table, logged and never rendered",
  },
  {
    rule: "A",
    file: "src/lib/queries.ts",
    literal: "getAllocatorAggregates portfolios failed:",
    reason: "not user-visible: a thrown error message naming the function and the portfolios table, logged and never rendered",
  },
  // Folded from the plan 201-27 ledger (plan 201-23, D-08).
  {
    rule: "B",
    file: "src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx",
    literal: "Scenario comparison",
    reason: "not a label position: the comparison table's accessible name, which no visible text carries",
  },
  // Plan 201-40 (F-11, D-11, D-21): the raw date field review R3-01 excluded from the fix (an unmounted component).
  // The two MasterBrush window-readout rows were dropped by GC-03: that readout prints through formatDay.
  {
    rule: "C",
    file: "src/components/strategy/StrategyHeader.tsx",
    literal: "{strategy.start_date}",
    reason: "not user-visible: nothing imports StrategyHeader, so this component renders on no page (review R3-01 exclusion)",
  },
];

// ---------------------------------------------------------------------------------------
// The policy `scan.ts` is run with.
// ---------------------------------------------------------------------------------------

export const POLICY: ScanPolicy = {
  applies(rule, file) {
    if (EXCLUDED_FILES.some((r) => r.rule === rule && r.file === file)) return false;
    if (rule === "A") return inSrc(file);
    if (rule === "B") return inRuleBScope(file);
    return inSrc(file) && !DATE_HELPER_FILES.includes(file);
  },
  retiredWords: RETIRED_WORDS,
  terms: TERM_MATCHERS,
  dates: DATES,
};
