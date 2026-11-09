/**
 * Phase 196 plan 01 (SC-5): the factsheet census counting rules, as code.
 *
 * `countFactsheetCensus(root)` counts what a reader sees inside `article#factsheet-main`:
 * sections, charts, repeated metric labels, small-sample warnings, visible chart
 * hints and "— on request" rows (196-UI-SPEC.md, "Census (SC-5)"). The same function
 * runs in three places: a jsdom render of the real `FactsheetBody` (count.test.tsx),
 * a Playwright page over the production site (run.ts), and plan 11's fixture census.
 *
 * SELF-CONTAINED ON PURPOSE. `run.ts` hands this function to Playwright's
 * `page.evaluate`, which ships only the function's SOURCE TEXT into the browser. A
 * module-level constant, import or helper referenced from the body would be
 * undefined there. So every helper, selector list and the alias table are declared
 * INSIDE the body. `CENSUS_ALIASES` / `CENSUS_ALIAS_PREFIXES` below are the same
 * tables exported as plain data for the record in 196-CENSUS.md; count.test.tsx
 * drives every entry through the function, so the two copies cannot drift apart.
 *
 * Counting is by what is VISIBLE. An element is not counted when it, or an ancestor
 * inside the article, is `.sr-only`, `hidden`, `display: none`, marked
 * `data-census-skip`, or sits under a closed `<details>` (other than its summary).
 * That is what makes "charts visible on open" mean the same thing for a closed and
 * an open Advanced disclosure, and what lets the print pass count only what prints.
 */

export type CensusCounts = {
  /** Top-level headed blocks: collapsible sections, editorial sections, the KPI strip, `data-census-section` hooks. */
  sections: number;
  /** Data figures (`figure` / `role="img"`); the MasterBrush control is counted apart. */
  charts: number;
  /** MasterBrush controls (a range control, not a chart). */
  masterBrush: number;
  /** Every metric label, normalised (case-folded, unit suffix and qualifiers stripped, aliased). */
  metricLabels: string[];
  /** Normalised labels occurring more than once, sorted. */
  repeatedMetrics: string[];
  /** Instances of the small-sample / short-record note family. */
  smallSampleWarnings: number;
  /** The same instances by kind, e.g. `rolling-subtitle x4`, sorted; empty when there are none. */
  warningKinds: string[];
  /** Visible chart interaction hints. */
  visibleChartHints: number;
  /** "— on request" value cells. */
  onRequestRows: number;
};

/** Exact-label aliases, applied after normalisation. Mirrored inside `countFactsheetCensus`. */
export const CENSUS_ALIASES: Readonly<Record<string, string>> = {
  "since inception": "cumulative return",
  "cum. return": "cumulative return",
  "max dd": "max drawdown",
  "ann. vol": "annualized volatility",
  "ann. volatility": "annualized volatility",
  alpha: "alpha",
  "information ratio": "information ratio",
  "observation start": "start date",
  "observation end": "end date",
};

/** Prefix aliases (the comparator's name follows the prefix). Mirrored inside `countFactsheetCensus`. */
export const CENSUS_ALIAS_PREFIXES: Readonly<Record<string, string>> = {
  "α vs ": "alpha",
  "ir vs ": "information ratio",
};

export function countFactsheetCensus(root: ParentNode = document): CensusCounts {
  const empty: CensusCounts = {
    sections: 0,
    charts: 0,
    masterBrush: 0,
    metricLabels: [],
    repeatedMetrics: [],
    smallSampleWarnings: 0,
    warningKinds: [],
    visibleChartHints: 0,
    onRequestRows: 0,
  };
  const article = root.querySelector("article#factsheet-main");
  if (!article) return empty;

  // --- the tables the rules read ------------------------------------------------

  // Exact label aliases (UI-SPEC "Census": since inception and cum. return are one metric, ...).
  const ALIASES: Record<string, string> = {
    "since inception": "cumulative return",
    "cum. return": "cumulative return",
    "max dd": "max drawdown",
    "ann. vol": "annualized volatility",
    "ann. volatility": "annualized volatility",
    alpha: "alpha",
    "information ratio": "information ratio",
    "observation start": "start date",
    "observation end": "end date",
  };
  // Prefix aliases: "α vs BTC" and "IR vs BTC" name the comparator, which is not part of the metric.
  const ALIAS_PREFIXES: Array<[string, string]> = [
    ["α vs ", "alpha"],
    ["ir vs ", "information ratio"],
  ];
  // Anything under one of these is outside the document body and is never counted.
  const SKIP_SELECTORS = "[data-census-skip]";
  // Elements the page marks as census sections (plan 10 puts the hook on the equity
  // figure, the Main metrics panel and the Advanced row).
  const SECTION_HOOK = "[data-census-section]";
  // Chart-hint phrases (UI-SPEC "The one chart hint"; the histogram's per-chart line today).
  const HINT_PHRASES = ["wheel to zoom", "Ctrl/Cmd + wheel"];
  const HINT_ID = "factsheet-chart-hint";

  // --- visibility ----------------------------------------------------------------

  const win = article.ownerDocument.defaultView;
  const visCache = new Map<Element, boolean>();
  const isVisible = (el: Element): boolean => {
    const cached = visCache.get(el);
    if (cached !== undefined) return cached;
    let v = true;
    if (el.classList.contains("sr-only") || el.hasAttribute("hidden") || el.matches(SKIP_SELECTORS)) {
      v = false;
    } else {
      const parent = el.parentElement;
      if (parent && parent.tagName === "DETAILS" && !parent.hasAttribute("open") && el.tagName !== "SUMMARY") {
        v = false;
      } else if (win && win.getComputedStyle(el).display === "none") {
        v = false;
      }
      if (v && el !== article && parent) v = isVisible(parent);
    }
    visCache.set(el, v);
    return v;
  };
  const visible = (selector: string): Element[] => Array.from(article.querySelectorAll(selector)).filter(isVisible);

  // The text of an element as a reader sees it: sr-only and aria-hidden descendants dropped.
  const readText = (el: Node): string => {
    if (el.nodeType === 3) return el.textContent ?? "";
    if (el.nodeType !== 1) return "";
    const e = el as Element;
    if (e.classList.contains("sr-only") || e.getAttribute("aria-hidden") === "true") return "";
    let out = "";
    e.childNodes.forEach((c) => {
      out += readText(c);
    });
    return out;
  };

  // The deepest elements (no child element also matching) whose visible text matches.
  const deepest = (selector: string, test: (text: string) => boolean): Element[] => {
    const hits = visible(selector).filter((e) => test(readText(e)));
    return hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)));
  };

  // --- sections ------------------------------------------------------------------

  const sectionEls = new Set<Element>();
  // CollapsibleSection renders a <details id="factsheet-...">; the Advanced row is one too.
  visible('details[id^="factsheet-"]').forEach((e) => sectionEls.add(e));
  // EditorialSection: a <section> whose own header holds an <h2>.
  visible("section").forEach((s) => {
    if (Array.from(s.children).some((c) => c.tagName === "HEADER" && c.querySelector("h2"))) sectionEls.add(s);
  });
  // The KPI strip: the <section> holding the strip's labels.
  visible('[data-testid="factsheet-kpi-label"]').forEach((l) => {
    const strip = l.closest("section");
    if (strip) sectionEls.add(strip);
  });
  visible(SECTION_HOOK).forEach((e) => sectionEls.add(e));

  // --- charts and the brush ------------------------------------------------------

  const BRUSH_ROOT = '[aria-label="Master timeline brush"]';
  const brushRoots = new Set<Element>();
  visible(BRUSH_ROOT).forEach((e) => brushRoots.add(e));
  visible('[role="img"][aria-label^="Master brush"]').forEach((e) => brushRoots.add(e.closest(BRUSH_ROOT) ?? e));
  const inBrush = (e: Element): boolean => e.closest(BRUSH_ROOT) !== null || (e.getAttribute("aria-label") ?? "").startsWith("Master brush");

  const figures = visible("figure").filter((f) => !inBrush(f));
  const images = visible('[role="img"]').filter((i) => !inBrush(i) && !figures.some((f) => f.contains(i)));
  const chartCount = figures.length + images.length;

  // --- metric labels -------------------------------------------------------------

  const normalise = (raw: string): string => {
    let s = raw.replace(/\s+/g, " ").trim().toLowerCase();
    // Trailing parenthetical qualifiers and unit suffixes: "(days)", "(excess)", "(ann)", "(daily)", "(6mo)", "(BTC)".
    let prev = "";
    while (s !== prev) {
      prev = s;
      s = s.replace(/\s*\([^()]*\)\s*$/, "");
    }
    s = s.replace(/[:*]+$/, "").trim();
    for (const [prefix, canon] of ALIAS_PREFIXES) {
      if (s.startsWith(prefix)) return canon;
    }
    return ALIASES[s] ?? s;
  };

  const labelCells: Element[] = [
    // KPI strip cell labels.
    ...visible('[data-testid="factsheet-kpi-label"]'),
    // Row / RollingRow label cells: the first cell of a metric table row (the Kpm table).
    ...visible("table.text-fixed-12 > tbody > tr > td:first-child"),
    // Term rows (definition lists): the label of a label-value pair.
    ...visible("dl > dt"),
  ];
  const labels = labelCells.map((c) => normalise(readText(c))).filter((s) => s !== "");
  const tally = new Map<string, number>();
  labels.forEach((l) => tally.set(l, (tally.get(l) ?? 0) + 1));
  const repeated = Array.from(tally.entries())
    .filter(([, n]) => n > 1)
    .map(([l]) => l)
    .sort();

  // --- small-sample warnings -----------------------------------------------------

  // One entry per family member, one comment per entry. An element is counted once even
  // if two entries would match it.
  const warningEls = new Set<Element>();
  const kindCounts = new Map<string, number>();
  const addWarnings = (kind: string, els: Element[]): void => {
    for (const e of els) {
      if (warningEls.has(e)) continue;
      warningEls.add(e);
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    }
  };
  // The strip's figure-gate note (the one warning the layout keeps).
  addWarnings("strip-figure-gate-note", visible('[data-testid="strip-figure-gate-note"]'));
  // The rail's Main Metrics figure-gate note (bench-figure-gate-note is comparator-specific and is not in the family).
  addWarnings("figure-gate-note", visible('[data-testid="figure-gate-note"]'));
  // The Bootstrap panel's "resamples are drawn from N observations" line.
  addWarnings(
    "bootstrap-line",
    deepest("p, span, div", (t) => t.includes("Bootstrap resamples are drawn from")),
  );
  // The rolling charts' short-track subtitle suffix (widenedShortNote("rolling", n)).
  addWarnings(
    "rolling-subtitle",
    deepest("p, span, div, figcaption", (t) => /Rolling figures are annualized from a [\d,]+-day window, under one year/.test(t)),
  );
  // NotEnoughDataPanel cards: a <section> whose h3 reads "... — Not enough data" / "... — Not available".
  addWarnings(
    "not-enough-data-card",
    visible("section > h3")
      .filter((h) => /—\s*Not (enough data|available)\s*$/.test(readText(h).trim()) && h.parentElement !== null)
      .map((h) => h.parentElement as Element),
  );
  const warningKinds = Array.from(kindCounts.entries())
    .map(([k, n]) => `${k} x${n}`)
    .sort();

  // --- chart hints ---------------------------------------------------------------

  const hintEls = new Set<Element>();
  const hintById = article.ownerDocument.getElementById(HINT_ID);
  if (hintById && article.contains(hintById) && isVisible(hintById)) hintEls.add(hintById);
  deepest("p, span, div, figcaption", (t) => HINT_PHRASES.some((p) => t.includes(p))).forEach((e) => {
    if (hintById && (hintById.contains(e) || e.contains(hintById))) return;
    hintEls.add(e);
  });

  // --- "— on request" rows -------------------------------------------------------

  const onRequest = visible("dd, td").filter((e) => readText(e).trim() === "— on request");

  return {
    sections: sectionEls.size,
    charts: chartCount,
    masterBrush: brushRoots.size,
    metricLabels: labels,
    repeatedMetrics: repeated,
    smallSampleWarnings: warningEls.size,
    warningKinds,
    visibleChartHints: hintEls.size,
    onRequestRows: onRequest.length,
  };
}
