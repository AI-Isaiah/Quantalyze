import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { DEGRADE_SURFACES, DEGRADE_WARNINGS, SURFACE_ID_PREFIX } from "@/lib/degrade-warnings";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

// ---------------------------------------------------------------------------
// Phase 199 plan 03 (D-04, CD-05, T-199-05). The unregistered-warning gate.
//
// HONEST SCOPE. This is a PER-FILE LEDGER, not JSX containment. For every scanned
// file it pins (a) the comment-stripped count of warning-styling hits (the trip
// pattern from 199-RESEARCH.md Pattern 8) and (b) the set of registry ids the
// file names as string literals. It fails on:
//   - a ledgered file that is missing or whose hit count changed (a warning-styled
//     element was added or removed without the ledger moving);
//   - an id a file names that the registry does not hold, or a pinned id the file
//     no longer names;
//   - a registry entry on a scanned surface that no ledgered file names (orphan copy);
//   - a file under a walked root that names a registry id or carries
//     `data-degrade-id` but has no ledger row.
// What it can NOT see: a new warning whose element carries NONE of the trip tokens
// and names no registry id. The trip pattern is a count, so adding one warning
// styled element AND removing another in the same file nets to zero; the id set
// is what pins which warning is which.
//
// 199-03 scanned AllocationDashboardV2.tsx and the render component. 199-05 widens
// the ledger to EVERY file under src/app/(dashboard)/allocations: each file with a
// comment-stripped hit is ledgered with its count, its registry ids (none for a
// ledgered non-warning) and a reason, and an unledgered file with a hit fails naming
// the file and both counts. 199-05 skipped the three files Phase 196 plan 20 owned
// (ScenarioComposer, HoldingsTable, WatchlistPanel) through a named deferral set;
// 199-15 ledgered all three and deleted the set, so nothing under the tree is skipped,
// and a test below pins that no deferral comes back. 199-16 walks the strategies list
// surface (below); 199-18 adds the factsheet.
// Comments are stripped first (`stripCommentsPreserveLines`, the ONE comment
// handler), and the ledger carries a vacuity floor, because a tokenizer bug in
// that module fails silent.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

/** The trip pattern: the styling tokens a degrade note carries on this app's surfaces. */
const TRIP_SOURCE = String.raw`role="status"|WarningBanner|ScopedBanner|InfoBanner|text-warning|border-warning-border|warning-bg`;
const prefixes = Object.values(SURFACE_ID_PREFIX).join("|");
// 199-05: an id may carry more than one dotted segment (`allocation.key-gap.not-syncing`).
// A tail that stopped at the first segment would never match such an id, so every one of
// them would read as an orphan; a test below pins that the pattern sees every registry id.
const ID_SOURCE = String.raw`["']((?:${prefixes})(?:\.[a-z][a-z0-9-]*)+)["']`;

interface FileScan {
  tripHits: number;
  ids: string[];
}

/**
 * 199-18: a Sentry `area` tag is dotted and surface-prefixed too (`sentryArea: "factsheet.view"`,
 * `"factsheet.advanced"` under the factsheet tree), and is never a warning id. The value of a
 * `sentryArea:` property is blanked before ids are read, so the factsheet prefix can be walked
 * without those two files needing a ledger row for a string that is not a warning. Nothing else
 * is exempt: a registry-shaped string anywhere else still has to be a registry id.
 */
const SENTRY_AREA_SOURCE = String.raw`sentryArea:\s*["'][^"']*["']`;

function scanSource(source: string): FileScan {
  const code = stripCommentsPreserveLines(source, "ts").replace(new RegExp(SENTRY_AREA_SOURCE, "g"), "sentryArea: null");
  const tripHits = (code.match(new RegExp(TRIP_SOURCE, "g")) ?? []).length;
  const ids = new Set<string>();
  for (const m of code.matchAll(new RegExp(ID_SOURCE, "g"))) ids.add(m[1]);
  return { tripHits, ids: [...ids].sort() };
}

interface LedgerRow {
  tripHits: number;
  ids: readonly string[];
  reason: string;
}

const DASHBOARD = "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx";
const DEGRADE_LINE = "src/components/degrade/DegradeLine.tsx";
const MISSING_DATA = "src/app/(dashboard)/allocations/components/MissingDataMessage.tsx";
const A = "src/app/(dashboard)/allocations";
const LIST_PAGE = "src/app/(dashboard)/strategies/page.tsx";
const LIST_ROOT = "src/app/(dashboard)/strategies";
const LIST_EMPTY_STATE = `${LIST_ROOT}/StrategiesEmptyState.tsx`;
const STRATEGY_TABLE = "src/components/strategy/StrategyTable.tsx";
const FS_ROOT = "src/app/factsheet/[id]";
const FS = `${FS_ROOT}/v2`;
const FS_SHARE = "src/app/factsheet-share/[token]";

/** One row per scanned file. A count moves only with its reason. */
const SCAN_LEDGER: Record<string, LedgerRow> = {
  [DASHBOARD]: {
    tripHits: 7,
    ids: [
      "allocation.departed-history",
      "allocation.failing-key-read-incomplete",
      "allocation.failing-key-sync-failing",
      "allocation.failing-key-undated",
      "allocation.staleness",
      "allocation.staleness-never",
      "allocation.unpriced-dated",
      "allocation.unpriced-history",
      "allocation.unpriced-whole",
    ],
    reason:
      "My allocation notes: the four key/day notes render registry text through DegradeLine; the hit count also covers the Risk loading line and the factsheet warm-up note, which are in_progress and empty states, not degrade warnings",
  },
  [DEGRADE_LINE]: {
    tripHits: 0,
    ids: [],
    reason: "the render component: it carries data-degrade-id as an expression, names no id and has no warning styling of its own",
  },
  [MISSING_DATA]: {
    tripHits: 0,
    ids: [
      "allocation.book.awaiting-derivation",
      "allocation.book.derivation-rejected",
      "allocation.book.duplicate-account",
      "allocation.book.history-read-failed",
      "allocation.book.identity-pending",
      "allocation.book.key-not-syncing",
      "allocation.book.keys-not-syncing",
      "allocation.book.shared-account-history-truncated",
      "allocation.book.shared-account-no-working-key",
      "allocation.book.unknown-reason",
      "allocation.key-gap.duplicate-account",
      "allocation.key-gap.identity-pending",
      "allocation.key-gap.not-syncing",
      "allocation.key-gap.not-syncing-one-key",
      "allocation.key-gap.read-incomplete",
      "allocation.key-gap.shared-account-failing",
      "allocation.key-gap.sync-failing",
    ],
    reason:
      "the Phase 198 missing-data message: every line it prints renders registry text through DegradeLine inside its own <p>, so the file has no warning styling of its own",
  },
  // 199-05 Task 3: the six files whose warning is registered, marker only (the shared
  // banners do not forward data-* props, so the marker sits on an element the file owns).
  [`${A}/EmptyState.tsx`]: {
    tripHits: 4,
    ids: ["allocation.first-sync"],
    reason: "in_progress: the 'Syncing your first positions' InfoBanner; the import and the JSX tags count",
  },
  [`${A}/components/OnboardingBanner.tsx`]: {
    tripHits: 4,
    ids: ["allocation.onboarding"],
    reason: "empty: the 'Connect your exchange' WarningBanner; the import and the JSX tags count",
  },
  [`${A}/components/AlertBanner.tsx`]: {
    tripHits: 1,
    ids: ["allocation.alerts-unverified"],
    reason: "read_failure: the alerts-check failure is a role=status paragraph whose text renders from the registry through DegradeLine",
  },
  [`${A}/components/ProvenanceNote.tsx`]: {
    tripHits: 1,
    ids: ["scenario.provenance"],
    reason: "provenance: the saved-scenario note; the marker is on only for the default message, not the membership variant a caller passes in",
  },
  [`${A}/components/DefaultChangeNote.tsx`]: {
    tripHits: 1,
    ids: ["scenario.default-change"],
    reason: "composition: the common-period note",
  },
  [`${A}/components/BlendHeader.tsx`]: {
    tripHits: 1,
    ids: ["scenario.blend-header"],
    reason: "composition: the blend header status line, including its no-strategies and zero-weight states",
  },
  // 199-15 Task 1: ScenarioComposer. Its own-book sentence renders the registry line the
  // Overview's MissingDataMessage renders for the same reason; its per-source fallback is a
  // registered degrade line; its four other warnings are marker-only composition/in_progress.
  [`${A}/components/ScenarioComposer.tsx`]: {
    tripHits: 21,
    ids: [
      // The own-book sentence: one id per rebuild reason (and the unknown-reason fallback),
      // each the SAME entry MissingDataMessage renders for that reason.
      "allocation.book.awaiting-derivation",
      "allocation.book.derivation-rejected",
      "allocation.book.duplicate-account",
      "allocation.book.history-read-failed",
      "allocation.book.identity-pending",
      "allocation.book.key-not-syncing",
      "allocation.book.shared-account-history-truncated",
      "allocation.book.shared-account-no-working-key",
      "allocation.book.unknown-reason",
      "scenario.auto-excluded",
      "scenario.empty-intersection",
      "scenario.loading-returns",
      "scenario.per-source-fallback",
      "scenario.series-syncing",
    ],
    reason:
      "the Scenario: the own-book sentence and the per-source fallback render registry text through DegradeLine; the empty-intersection banner, the auto-excluded group (with its rows and reason text), the loading-returns line and the series-syncing note keep their JSX and carry the marker (composition, in_progress); the InfoBanner shell around the fallback and the 'too similar' pair chip (amber chip, a diagnostic count, not a degrade warning) account for the rest of the count",
  },
  // 199-15 Task 2: the other two files Phase 196 plan 20 owned.
  [`${A}/components/HoldingsTable.tsx`]: {
    tripHits: 2,
    ids: ["allocation.holdings-strategies-read-failed"],
    reason:
      "read_failure: the strategies read failure renders registry text through DegradeLine inside its role=status box (one hit); the other hit is AMBER_CHIP_STYLE, a chip, not a warning",
  },
  [`${A}/components/WatchlistPanel.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the sr-only live-region announcement of the watchlist's state",
  },
  // 199-16: the strategies list surface (Task 3 walks it whole; see `NOT_D04_SUBTREES`).
  [LIST_PAGE]: {
    tripHits: 3,
    ids: [
      "strategies.analytics-failed",
      "strategies.analytics-failed-undated",
      "strategies.compute-status-unreadable",
      "strategies.empty",
      "strategies.key-problem",
      "strategies.key-status-unreadable",
      "strategies.list-unreadable",
      "strategies.placeholder-keys-unreadable",
      "strategies.share-note",
      "strategies.stale",
      "strategies.stale-no-data",
    ],
    reason:
      "the strategies list page: the row note's Health detail (Analytics failed, Stale, Stale with no data yet, and the unreadable-day sentence), the list-unreadable card and the placeholder-key line render registry text through DegradeLine; the key-status line, the untrusted-key line, the share note and the manager empty card keep their shipped JSX and carry their markers. The three trip hits are NOT warnings: the row note's review-feedback paragraph and the wizard-draft banner's Review feedback line (a reviewer's own words, a review state; the UI-SPEC keeps shipped amber surfaces as they are) and the just-submitted line (the announcement of the viewer's own submit)",
  },
  [LIST_EMPTY_STATE]: {
    tripHits: 0,
    ids: ["strategies.empty-allocator"],
    reason: "empty: the allocator-only empty state, marker only on the shipped panel",
  },
  [STRATEGY_TABLE]: {
    tripHits: 2,
    ids: [],
    reason:
      "two role=status paragraphs, neither registered: the figures-not-shown count line (FLAGGED: it does say figures are not shown, and it is the Phase 194 figure-gate line carried forward unchanged, CONTEXT 'Carried forward': the figure gate applies to the list columns unchanged; it names no key or day and is not registered by this plan) and the sr-only selection announcement (not a warning)",
  },
  // 199-18: the factsheet surface, re-measured on the tree rebased after Phase 196
  // (`src/app/factsheet/**` and `src/app/factsheet-share/**`, walked whole; every other file
  // under them has no hit and names no id).
  [`${FS}/FactsheetView.tsx`]: {
    tripHits: 7,
    ids: [
      "factsheet.analytics-updating",
      "factsheet.degraded-members",
      "factsheet.degraded-members-recipient",
      "factsheet.usd-view-no-priced-day",
      "factsheet.usd-view-read-failed",
    ],
    reason:
      "the factsheet view: the degraded-members line renders registry text through DegradeLine in two branches (owner view, recipient and public view: two hits), the USD-view note and the updating line keep their JSX and carry markers (one hit for the note). The other four hits are NOT warnings: the basis caption (role=status, an information line that names which series the charts show), the what-if leverage caption (muted, role=status: steady-state information, not a recoverable warning), the sr-only unit-switch announcement, and the transient leverage clamp message (feedback on the viewer's own input, not a data condition)",
  },
  [`${FS}/HeatmapPanels.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the heatmap's hover-reveal tooltip (a role=status readout of one cell)",
  },
  [`${FS}/loading.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the sr-only loading announcement",
  },
  [`${FS}/page.tsx`]: {
    tripHits: 1,
    ids: [
      "factsheet.owner-state-dated",
      "factsheet.owner-state-undated",
      "factsheet.owner-state-working",
      "factsheet.public-pending",
    ],
    reason:
      "the factsheet page: the owner pending page's state section carries the id of the entry that matches its line (working, dated, undated: a literal table keyed by `ownerStateKind`), the public pending sentence renders registry text through DegradeLine. The one trip hit is the amber tone class of the state line (STATE_LINE_TONE_CLASS), a colour map, not a second warning",
  },
  [`${FS_ROOT}/tearsheet/page.tsx`]: {
    tripHits: 0,
    ids: ["factsheet.public-pending"],
    reason: "the tearsheet's pending page: the public pending sentence renders registry text through DegradeLine; the page has no other warning styling",
  },
  [`${FS_SHARE}/page.tsx`]: {
    tripHits: 0,
    ids: ["factsheet.share-card-in-progress", "factsheet.share-card-not-available"],
    reason: "the share route: the pending card keeps its shipped EmptyStateCard and a wrapper carries the registered id of its arm (a literal table keyed by the arm); no other warning styling",
  },
  // Ledgered non-warnings: a trip token on an element that is not a degrade warning.
  [`${A}/AllocationsTabs.tsx`]: {
    tripHits: 2,
    ids: [],
    reason: "not a warning: TabBodyFallback loading skeleton and the page's sr-only live-region announcement",
  },
  [`${A}/loading.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the sr-only loading announcement",
  },
  [`${A}/components/SavedScenariosList.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the 'Copied' share confirmation (form status)",
  },
  [`${A}/components/AddAllocationFlow.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the strategies loading skeleton",
  },
  [`${A}/components/ScenarioCommitDrawer.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the commit success message (form status)",
  },
  [`${A}/components/OutcomeForm.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the 'Outcome recorded' confirmation (form status)",
  },
  [`${A}/components/StrategyBrowseDrawer.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: a tone-map entry that colours a chip",
  },
  [`${A}/components/CoverageTimeline.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the out-of-blend bar fill, which carries its own aria-label (a chart mark)",
  },
  [`${A}/components/CoverageStateChip.tsx`]: {
    tripHits: 6,
    ids: [],
    reason: "not a warning: chip classes (two chip tones, three tokens each)",
  },
  [`${A}/components/OpenPositionsTable.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: AMBER_CHIP_STYLE, a chip",
  },
  [`${A}/components/WidgetState.tsx`]: {
    tripHits: 1,
    ids: [],
    reason: "not a warning: the partial pill (aria-hidden, with an sr-only state)",
  },
};

/** Surfaces whose registry entries must each have a render site in a ledgered file. */
const SCANNED_SURFACES: ReadonlySet<string> = new Set(DEGRADE_SURFACES);

/**
 * 199-18 (D-04): the factsheet surface, after Phase 196 merged. `src/app/factsheet/**` holds the
 * factsheet page, its view and panels and the tearsheet; `src/app/factsheet-share/**` is the share
 * route. Both are walked whole, so a warning added anywhere under them needs a ledger row.
 */
const FACTSHEET_ROOTS = ["src/app/factsheet", "src/app/factsheet-share"] as const;

/** Roots walked for files that name a registry id without a ledger row. */
const WALK_ROOTS = [
  "src/app/(dashboard)/allocations",
  "src/components/degrade",
  ...FACTSHEET_ROOTS,
] as const;

/**
 * 199-16 (D-04): the strategies list surface is `strategies/**` minus two subtrees, plus
 * `StrategyTable.tsx` by name (it lives under components/strategy, shared with Discovery,
 * so a whole-directory walk would claim files that are not the list).
 *
 * The two excluded subtrees are the wizard and the edit form. 199-RESEARCH.md "Scanned
 * surfaces" rules them out: "Do NOT scan `strategies/new/**` (the wizard) or
 * `strategies/[id]/**`: they are not D-04 surfaces and carry form warnings
 * (`WithdrawalWarningStrip`, `WizardIpAllowlistHint`)". The set is pinned below, so a
 * subtree added to it, to hide a list warning, fails a test.
 */
const NOT_D04_SUBTREES = [
  {
    name: "new",
    reason: "the strategy wizard: form and step warnings (WithdrawalWarningStrip, WizardIpAllowlistHint, step validation), not a D-04 surface",
  },
  {
    name: "[id]",
    reason: "the strategy edit form: form warnings, not a D-04 surface",
  },
] as const;
const LIST_NAMED_FILES = [STRATEGY_TABLE] as const;

/** Every problem the ledger finds. Empty means the scanned surface is accounted for. */
function judgeLedger(input: {
  ledger: Record<string, LedgerRow>;
  /** relative path -> source, for every ledgered file AND every walked file. */
  sources: Record<string, string>;
  registry: ReadonlyArray<{ id: string; surface: string }>;
}): string[] {
  const { ledger, sources, registry } = input;
  const problems: string[] = [];
  const registryIds = new Set(registry.map((e) => e.id));
  const named = new Set<string>();

  for (const [file, row] of Object.entries(ledger)) {
    if (!row.reason.trim()) problems.push(`${file}: ledger row has no reason`);
    const source = sources[file];
    if (source === undefined) {
      problems.push(`${file}: ledgered file is missing`);
      continue;
    }
    const scan = scanSource(source);
    if (scan.tripHits !== row.tripHits) {
      problems.push(`${file}: ${scan.tripHits} warning-styling hits, ledger pins ${row.tripHits}`);
    }
    const pinned = [...row.ids].sort();
    for (const id of scan.ids) {
      if (!registryIds.has(id)) problems.push(`${file}: names unknown registry id ${id}`);
      if (!pinned.includes(id)) problems.push(`${file}: names ${id}, which the ledger does not pin`);
      named.add(id);
    }
    for (const id of pinned) {
      if (!scan.ids.includes(id)) problems.push(`${file}: ledger pins ${id}, which the file no longer names`);
    }
  }

  for (const [file, source] of Object.entries(sources)) {
    if (file in ledger) continue;
    const scan = scanSource(source);
    if (scan.ids.length > 0 || source.includes("data-degrade-id")) {
      problems.push(`${file}: unledgered file renders a registered warning (${scan.ids.join(", ") || "data-degrade-id"})`);
    }
    // 199-05: a trip hit in an unledgered file is a warning nobody classified.
    if (scan.tripHits > 0) {
      problems.push(`${file}: unledgered file has ${scan.tripHits} warning-styling hits, ledger pins 0`);
    }
  }

  for (const entry of registry) {
    if (SCANNED_SURFACES.has(entry.surface) && !named.has(entry.id)) {
      problems.push(`${entry.id}: orphan registry entry, no ledgered file renders it`);
    }
  }
  return problems;
}

function walk(dir: string, out: string[] = [], skipDir: (abs: string) => boolean = () => false): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (!skipDir(abs)) walk(abs, out, skipDir);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(abs);
  }
  return out;
}

/**
 * What the scan WALKS: the roots, the strategies list surface minus its two excluded subtrees,
 * and the files named outright. Independent of the ledger, so "which surfaces does the scan reach"
 * cannot be answered by the ledger's own rows (199-18: the four-surface assertion reads this).
 */
function walkedSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const root of WALK_ROOTS) {
    for (const abs of walk(join(ROOT, root))) {
      sources[relative(ROOT, abs)] = readFileSync(abs, "utf8");
    }
  }
  // 199-16: the strategies list surface, minus the two excluded subtrees (top level only).
  const excluded = new Set(NOT_D04_SUBTREES.map((e) => join(ROOT, LIST_ROOT, e.name)));
  for (const abs of walk(join(ROOT, LIST_ROOT), [], (dir) => excluded.has(dir))) {
    sources[relative(ROOT, abs)] = readFileSync(abs, "utf8");
  }
  for (const file of LIST_NAMED_FILES) sources[file] = readFileSync(join(ROOT, file), "utf8");
  return sources;
}

function realSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const file of Object.keys(SCAN_LEDGER)) {
    try {
      sources[file] = readFileSync(join(ROOT, file), "utf8");
    } catch {
      // judgeLedger reports a missing ledgered file by name.
    }
  }
  return { ...sources, ...walkedSources() };
}

/**
 * 199-18 (SC-4 final): the D-04 surfaces that no scanned file renders an entry of. A surface is
 * scanned when at least one walked file names one of its registry ids; an empty result means all
 * four (my-allocation, scenario, strategies-list, factsheet) are under the scan.
 */
function surfacesWithoutScannedFile(
  walked: Record<string, string>,
  registry: ReadonlyArray<{ id: string; surface: string }>,
  surfaces: readonly string[] = DEGRADE_SURFACES,
): string[] {
  const namedIds = new Set<string>();
  for (const source of Object.values(walked)) for (const id of scanSource(source).ids) namedIds.add(id);
  return surfaces.filter((surface) => !registry.some((e) => e.surface === surface && namedIds.has(e.id)));
}

describe("degrade warning scan: the real scanned surfaces", () => {
  it("every ledgered file matches its pinned count and id set, and every scanned-surface entry has a render site", () => {
    expect(
      judgeLedger({
        ledger: SCAN_LEDGER,
        sources: realSources(),
        registry: DEGRADE_WARNINGS,
      }),
    ).toEqual([]);
  });

  it("the whole allocations tree is walked and nothing is skipped: the three files Phase 196 plan 20 owned are ledgered, and no deferral set remains (199-15)", () => {
    for (const file of [
      `${A}/components/ScenarioComposer.tsx`,
      `${A}/components/HoldingsTable.tsx`,
      `${A}/components/WatchlistPanel.tsx`,
    ]) {
      expect(file in SCAN_LEDGER, `${file} is ledgered`).toBe(true);
      expect(SCAN_LEDGER[file].tripHits, `${file} still has warning-styling hits`).toBeGreaterThan(0);
    }
    const sources = realSources();
    // Vacuity fence: the walk reached the tree's nested files, not only the ledgered ones.
    expect(Object.keys(sources).filter((f) => f.startsWith(`${A}/`)).length).toBeGreaterThan(Object.keys(SCAN_LEDGER).length - 1);
    // The pin proper: this file declares no skip list. A `const DEFERRED_…` array, or a
    // `deferred` option on the judge, would let a file with a hit escape the ledger.
    // The patterns are regex literals, so they do not match their own text.
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const code = stripCommentsPreserveLines(self, "ts");
    expect(code).not.toMatch(/const\s+DEFERRED_\w*\s*=/);
    expect(code).not.toMatch(/\bdeferred\s*\??\s*:/);
  });

  it("the strategies list surface is walked whole and nothing under it is skipped but the two named subtrees (199-16, D-04, CD-05)", () => {
    const sources = realSources();
    const listFiles = Object.keys(sources).filter((f) => f.startsWith(`${LIST_ROOT}/`));
    // Vacuity fence: the walk reached the section host, the legend, the page and the empty state.
    for (const file of [LIST_PAGE, LIST_EMPTY_STATE, `${LIST_ROOT}/StrategiesSection.tsx`, `${LIST_ROOT}/StrategiesLegend.tsx`]) {
      expect(listFiles, `${file} is walked`).toContain(file);
    }
    expect(sources[STRATEGY_TABLE], "StrategyTable.tsx is scanned by name").toBeDefined();
    // The exclusion is exactly the two subtrees, and no walked file lives in one.
    for (const { name } of NOT_D04_SUBTREES) {
      expect(listFiles.filter((f) => f.startsWith(`${LIST_ROOT}/${name}/`)), `${name} is not walked`).toEqual([]);
    }
    // And the exclusion is not vacuous: each excluded subtree exists and has files the walk would otherwise read.
    for (const { name } of NOT_D04_SUBTREES) {
      expect(walk(join(ROOT, LIST_ROOT, name)).length, `${name} has source files`).toBeGreaterThan(0);
    }
  });

  it("NOT_D04_SUBTREES is pinned to exactly the wizard and the edit form, each with its reason: a third entry fails this test", () => {
    expect(NOT_D04_SUBTREES.map((e) => e.name)).toEqual(["new", "[id]"]);
    for (const e of NOT_D04_SUBTREES) expect(e.reason.trim().length, e.name).toBeGreaterThan(0);
  });

  it("a list file with a warning-styling hit and no ledger row fails, naming the file and both counts (199-16)", () => {
    const sources = { ...realSources(), [`${LIST_ROOT}/Unledgered.tsx`]: `<p className="text-warning">x</p>` };
    expect(judgeLedger({ ledger: SCAN_LEDGER, sources, registry: DEGRADE_WARNINGS }).join("|")).toContain(
      `${LIST_ROOT}/Unledgered.tsx: unledgered file has 1 warning-styling hits, ledger pins 0`,
    );
  });

  it("SC-4 final: all four D-04 surfaces (my-allocation, scenario, strategies-list, factsheet) have a scanned file (199-18)", () => {
    expect([...DEGRADE_SURFACES].sort()).toEqual(["factsheet", "my-allocation", "scenario", "strategies-list"]);
    expect(surfacesWithoutScannedFile(walkedSources(), DEGRADE_WARNINGS)).toEqual([]);
    // Every surface has entries to be scanned for: the assertion cannot pass over an empty surface.
    for (const surface of DEGRADE_SURFACES) {
      expect(DEGRADE_WARNINGS.some((e) => e.surface === surface), `${surface} has entries`).toBe(true);
    }
  });

  it("the factsheet roots are walked whole: the page, the view, the tearsheet and the share route are all reached (199-18, D-04)", () => {
    const walked = Object.keys(walkedSources());
    for (const file of [
      "src/app/factsheet/[id]/v2/page.tsx",
      "src/app/factsheet/[id]/v2/FactsheetView.tsx",
      "src/app/factsheet/[id]/tearsheet/page.tsx",
      "src/app/factsheet-share/[token]/page.tsx",
    ]) {
      expect(walked, `${file} is walked`).toContain(file);
    }
  });

  it("the four-surface assertion fails when a surface has no scanned file (meta-arm, 199-18)", () => {
    const registry = [
      { id: "allocation.alpha", surface: "my-allocation" },
      { id: "factsheet.beta", surface: "factsheet" },
    ];
    const walked = { "a.tsx": `<p>{"allocation.alpha"}</p>` };
    expect(surfacesWithoutScannedFile(walked, registry, ["my-allocation", "factsheet"])).toEqual(["factsheet"]);
    expect(
      surfacesWithoutScannedFile({ ...walked, "b.tsx": `<p>{"factsheet.beta"}</p>` }, registry, ["my-allocation", "factsheet"]),
    ).toEqual([]);
    // A file that merely sits in the surface's root and names none of its ids does not count.
    expect(surfacesWithoutScannedFile({ ...walked, "c.tsx": `<p>plain</p>` }, registry, ["factsheet"])).toEqual(["factsheet"]);
  });

  it("vacuity fence: the scan found the dashboard, its notes and the render marker", () => {
    const sources = realSources();
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(2);
    const dashboard = scanSource(sources[DASHBOARD] ?? "");
    expect(dashboard.tripHits).toBeGreaterThanOrEqual(4);
    expect(dashboard.ids.length).toBeGreaterThanOrEqual(1);
    expect(sources[DEGRADE_LINE]).toContain("data-degrade-id");
  });

  it("every registry id uses its surface's prefix, so the scan's id pattern can see it", () => {
    for (const e of DEGRADE_WARNINGS) {
      expect(e.id.startsWith(`${SURFACE_ID_PREFIX[e.surface]}.`)).toBe(true);
    }
  });

  it("the scan's id pattern matches the WHOLE of every registry id, multi-segment ones included", () => {
    for (const e of DEGRADE_WARNINGS) {
      expect(scanSource(`<DegradeLine id="${e.id}" />`).ids, e.id).toEqual([e.id]);
    }
  });
});

describe("degrade warning scan: the ledger judge fails when it should (meta-arms)", () => {
  const registry = [{ id: "allocation.alpha", surface: "my-allocation" }];
  const row = (tripHits: number, ids: string[]): LedgerRow => ({ tripHits, ids, reason: "fixture" });
  const clean = `<p role="status" data-degrade-id="x">{"allocation.alpha"}</p>`;
  const ledger = { "a.tsx": row(1, ["allocation.alpha"]) };

  it("a clean fixture has no problem", () => {
    expect(judgeLedger({ ledger, sources: { "a.tsx": clean }, registry })).toEqual([]);
  });

  it("a new warning-styled element changes the count and fails", () => {
    const more = `${clean}<div className="text-warning" />`;
    expect(judgeLedger({ ledger, sources: { "a.tsx": more }, registry }).join("|")).toContain("2 warning-styling hits, ledger pins 1");
  });

  it("a hit inside a comment is not counted", () => {
    const commented = `// <div role="status" />\n${clean}`;
    expect(judgeLedger({ ledger, sources: { "a.tsx": commented }, registry })).toEqual([]);
  });

  it("an unknown id fails", () => {
    const unknown = `${clean}{"allocation.ghost"}`;
    const problems = judgeLedger({ ledger, sources: { "a.tsx": unknown }, registry }).join("|");
    expect(problems).toContain("unknown registry id allocation.ghost");
  });

  it("a pinned id the file stopped naming fails (and its entry is then an orphan)", () => {
    const problems = judgeLedger({ ledger, sources: { "a.tsx": `<p role="status" />` }, registry }).join("|");
    expect(problems).toContain("no longer names");
    expect(problems).toContain("orphan registry entry");
  });

  it("an orphan registry entry on a scanned surface fails", () => {
    const withOrphan = [...registry, { id: "allocation.beta", surface: "my-allocation" }];
    expect(judgeLedger({ ledger, sources: { "a.tsx": clean }, registry: withOrphan }).join("|")).toContain(
      "allocation.beta: orphan registry entry",
    );
  });

  it("a scenario entry no ledgered file renders is an orphan too (199-05 scans the Scenario sub-components)", () => {
    const withScenario = [...registry, { id: "scenario.beta", surface: "scenario" }];
    expect(judgeLedger({ ledger, sources: { "a.tsx": clean }, registry: withScenario }).join("|")).toContain(
      "scenario.beta: orphan registry entry",
    );
  });

  it("every D-04 surface is scanned, so a factsheet entry no ledgered file renders is an orphan too (199-18)", () => {
    const other = [...registry, { id: "factsheet.beta", surface: "factsheet" }];
    expect(judgeLedger({ ledger, sources: { "a.tsx": clean }, registry: other }).join("|")).toContain(
      "factsheet.beta: orphan registry entry",
    );
  });

  it("an unledgered file that names a registered id fails", () => {
    const sources = { "a.tsx": clean, "b.tsx": `{"allocation.alpha"}` };
    expect(judgeLedger({ ledger, sources, registry }).join("|")).toContain("b.tsx: unledgered file renders a registered warning");
  });

  it("an unledgered file with a warning-styling hit fails, naming the file and both counts", () => {
    const sources = { "a.tsx": clean, "b.tsx": `<p role="status">x</p><div className="text-warning" />` };
    expect(judgeLedger({ ledger, sources, registry }).join("|")).toContain(
      "b.tsx: unledgered file has 2 warning-styling hits, ledger pins 0",
    );
  });

  it("a Sentry area tag that looks like a registry id is not read as one, but the same string elsewhere is (199-18)", () => {
    expect(scanSource(`reportError(e, { sentryArea: "factsheet.view" })`).ids).toEqual([]);
    expect(scanSource(`{ sentryArea:\n "factsheet.advanced" }`).ids).toEqual([]);
    expect(scanSource(`const tag = "factsheet.view";`).ids).toEqual(["factsheet.view"]);
  });

  it("a missing ledgered file fails", () => {
    expect(judgeLedger({ ledger, sources: {}, registry }).join("|")).toContain("a.tsx: ledgered file is missing");
  });
});
