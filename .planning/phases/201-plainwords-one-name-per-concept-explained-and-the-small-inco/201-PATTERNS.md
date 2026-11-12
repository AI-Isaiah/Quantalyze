# Phase 201: PLAINWORDS - Pattern Map

**Mapped:** 2026-11-11
**Files analyzed:** 38 classification rows (the wide copy-rename and date-swap families are one row each and name their own sub-sites)
**Analogs found:** 38 / 38 rows have an analog; 1 is only a partial match (the TSX-aware scanner: no existing parser handles JSX, the RESEARCH prototype fills the gap). Match-quality tally from the table: 30 exact (28 exact, 1 exact in shape, 1 exact no-op), 7 role-match, 1 partial, 0 none.
**Citation rule:** every reference below is by symbol name, never `file:line` (the `plan-anchor-verify` CI job re-resolves `file:line` anchors in PLAN.md). Every analog path was checked with `git ls-files` and is tracked source (no `.gsd/capabilities` mirror paths).
**Worktree note:** `node_modules` is present in this worktree (RESEARCH said it was absent; re-check before relying on either), but nothing in this map was executed: it is read-only extraction.

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/glossary.ts` (new) | utility (pure data registry) | transform | `src/components/strategy/discovery-columns.ts` (`DISCOVERY_COLUMNS`, `FULL_RECORD_BASIS`) + `src/lib/degrade-warnings.ts` (`as const` registry, closed id union, `WHOLE_HISTORY_IDS`) | exact (shape) |
| `src/lib/glossary.test.ts` (new) | test (registry invariants) | transform | `src/lib/degrade-warnings.test.tsx` ("no entry has a problem", count-pinned `WHOLE_HISTORY_IDS`, meta-arms) | role-match |
| `src/components/ui/Term.tsx` (new) | component (client wrapper) | request-response (hover/focus state) | `src/components/ui/Tooltip.tsx` (wrapped primitive) + dotted `dt` in `OptimizerPanel.tsx` (affordance precedent) | role-match |
| `src/components/ui/Term.test.tsx` (new) | test | event-driven | `src/components/ui/Tooltip.test.tsx` (fake-timer idiom) + `StrategyTable.headers.test.tsx` ("keyboard focus shows its definition tooltip") | exact |
| `src/components/ui/Tooltip.tsx` (modify: opt-in `aria-describedby` prop) | component | event-driven | itself (`Tooltip` wrapper spans) | exact |
| `scripts/copy-census/scan.ts` (new) | utility (AST scanner, no app imports) | batch / file-I/O | `scripts/factsheet-census/count.ts` (location, no-app-import shape) + `parseStripped` / `catchClauses` walker in `src/lib/seam-log-coverage.test.ts` | partial (no TSX parser exists; use RESEARCH "Scanner core") |
| `scripts/copy-census/scan.test.ts` (new) | test (planted red/green fixtures) | batch | `scripts/factsheet-census/count.test.tsx` ("synthetic rules" red and green) + the "self-test" `describe` in `figure-gate-census.test.ts` (`withPlanted`) | exact |
| `src/__tests__/copy-census.test.ts` (new) | test (census with PENDING + EXCEPTIONS) | batch / file-I/O | `src/__tests__/figure-gate-census.test.ts` (`EXCLUDED`, `walk`, `analyze`, `judge`, anti-vacuity, `withPlanted`) | exact |
| `src/lib/utils.ts` (+`formatDay`, `formatMonth`) and `src/lib/utils.test.ts` | utility | transform | `formatIsoDay` (null/NaN guard, UTC fields) and `formatCloseDay` in `src/lib/factsheet/returns-unit.ts` (`MONTHS`, `parseIsoDay`) | exact |
| Date call-site swaps (`MetricsColumn.tsx` `isoToMonthDay`, `trade-fetch-lines.tsx` `formatIsoDate`, `CompareEquityOverlay.tsx` `formatSpanDate`, `BatchDPanels.tsx` `monthYear`, `ScenarioComposer.tsx` `formatIsoMonth`, `OutcomesWidget.tsx` `formatDate`, `add-allocation.ts` `formatCalendarDate`, `returns-unit.ts` `formatCloseDay`) | utility | transform | the new `formatDay` / `formatMonth` | exact |
| `src/lib/strategy-display.ts` (+`strategy-display.test.ts`) | utility (resolver) | transform | itself (`displayStrategyName`, `publicNamePreview`) | exact |
| `src/lib/queries.ts` (`redactedName` in the My allocation builder; type doc above it) | service (query layer) | CRUD (read) | the adjacent `redactedOrgName` (stays) and `redactedName` itself | exact |
| `src/app/api/strategies/browse/route.ts` (+`route.test.ts`) | controller (route handler) | request-response | itself (`safeLabel` branch, `isOwnRow`) | exact |
| `src/app/(dashboard)/compare/CompareAddStrategy.tsx` (+test: "real name finds the row") | component | request-response (client search) | `CompareAddStrategy.test.tsx` (`row()`, `ROWS`, `setup()`) | exact |
| `src/app/factsheet/[id]/tearsheet/page.tsx` (name, `<title>`, custody clause) | route (RSC page) | request-response | `src/components/ui/Disclaimer.tsx` `strategy-page` tier rule (custody clause) | exact |
| `src/components/strategy/ManagerIdentityPanel.tsx` (+test) | component | request-response | itself (exploratory-lane `Card`) | exact |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (numerals, `Term` on rows) | component | transform | itself (`EditorialSection`, `benchmarkSection`) | exact |
| `src/app/factsheet/[id]/v2/MetricsColumn.numerals.test.tsx` (new) | test | transform | `MetricsColumn.window.test.tsx` (the one test that reads `§I`) + `FactsheetBody.census.test.tsx` mount idiom | role-match |
| `src/app/factsheet/[id]/v2/MetricsColumn.terms.test.tsx` and other `[data-term]` render smokes (new) | test | event-driven | `FactsheetBody.census.test.tsx` (`mountView`, `openAdvanced`, positive controls beside zero-arms) | role-match |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (KPI strip labels) | component | transform | itself (`factsheet-kpi-label` `<p>`) | exact |
| `src/app/factsheet/[id]/v2/BatchDPanels.tsx` (K-S inline `Term`) | component | transform | itself | exact |
| `src/app/factsheet/[id]/v2/MandatePanels.tsx` (`ConstituentMandatePanel` heading) | component | transform | itself | exact |
| `src/components/strategy/StrategyFilters.tsx` (Escape) | component | event-driven | `src/components/strategy/CustomizeDrawer.tsx` (Escape effect, focus capture/restore) | exact |
| `src/components/strategy/StrategyFilters.test.tsx` (new) | test | event-driven | `src/components/strategy/CustomizeDrawer.test.tsx` (ESC arm, pre-handled ESC arm) | exact |
| `src/components/strategy/discovery-columns.ts` (tooltips move to registry) | utility | transform | itself | exact |
| `src/components/strategy/StrategyTable.tsx` (plain headers to Form A) | component | transform | itself (`renderSortHeader` = Form B; `PLAIN_COLUMNS.map` = Form A target) | exact |
| `src/components/strategy/CompareTable.tsx` (unsigned volatility) + `figure-parity-pages.test.tsx` CompareTable arm | component + test | transform | `StrategyTable` Volatility arm in `figure-parity-pages.test.tsx` (`tableCell("Volatility")`) | exact |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.tsx`, `src/components/portfolio/PortfolioOptimizer.tsx` (`METRIC_TOOLTIPS` into registry) | component | transform | itself (glossary `dt` block) | exact |
| `src/components/layout/Sidebar.tsx` `buildPrimaryMobileNav` (+`MobileNav.test.tsx`) | component | transform | itself | exact |
| `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx` (+test) | component | request-response | `src/components/contact/ContactPointerText.tsx` + `contactHref` (`src/lib/contact.ts`), used in `src/app/(marketing)/security/page.tsx` | exact |
| `src/lib/wizardErrors.ts` (`KEY_PERMISSION_DENIED`, `KEY_IP_ALLOWLIST` fix bullets) | utility (copy module) | transform | `src/components/error/ErrorEnvelope.tsx` (renders each `fix` step through `ContactPointerText`) | exact |
| `src/app/(marketing)/legal/disclaimer/page.tsx` (+`page.test.tsx` new) | route (static RSC) | request-response | `src/__tests__/public-truth-census.test.tsx` rendered half (renders marketing pages, reads text) | role-match |
| `src/components/ui/Disclaimer.tsx` | component | request-response | itself (no change; `custody` variant has no caller) | exact (no-op) |
| `e2e/composer-axe.spec.ts` ("Start a portfolio" pin) | test (e2e) | request-response | itself | exact |
| `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx`, `AddAllocationFlow.tsx` (D-09 consumers: row name, codename line only when it differs, search matches name or codename) | component | request-response (client search) | `CompareAddStrategy.tsx` + its test (`row()`, `setup()`); both match on `name` OR `codename` client-side | role-match |
| Date call sites that print `YYYY-MM-DD` or no-option `toLocaleDateString()` (`StrategyTable.tsx` Created cell and track tooltip, `StaleSeriesChip.tsx`, `MetricsColumn.tsx` `ymd`, `StressWindowsPanel.tsx`, `WatchlistPanel.tsx`, `strategies/page.tsx`, `OrganizationTab.tsx`, `PreferencesPanel.tsx`, `AdminTabs.tsx`, `DeckCard.tsx`, `AllocatorMatchQueue.tsx`, `MatchEvalDashboard.tsx`, `FactsheetPreview.tsx`, `PendingIntros.tsx`, `ApiKeyManager.tsx`, `SyncProgress.tsx`, plus every `formatAbsoluteDate` / `formatIsoDay` caller) | component | transform | `formatIsoDay` call in `StrategyTable.tsx` Created cell (already on a UTC helper) | exact |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx`, `GlancePanel.tsx`, `src/components/kpi/KpiPanel.tsx` (`Term` on TWR, Avg \|rho\|, Max DD 12m, Sharpe; "Book" to "Allocation") | component | transform | `FactsheetView.tsx` KPI strip label `<p>` (keeps testid and class; wrap the text) | role-match |
| Wide rename families (see section below) | component / copy | transform | the canonical-word tables in UI-SPEC Interaction contract 3 | exact |

## Pattern Assignments

### `src/__tests__/copy-census.test.ts` (test, batch) - the central deliverable

**Analog:** `src/__tests__/figure-gate-census.test.ts`

**Correction to RESEARCH Pattern 2.** RESEARCH calls this file the `PENDING` map idiom. At HEAD it is not: the file's own header says `NO PENDING MAP (194.1 close, plan 13)`, and the pending-plan map plus its branches were deleted by commit `4b5ccacfb` (the D04SWEEP ship, #1222). What exists at HEAD is `EXCLUDED` + a closed reason set + the stale-key rule + anti-vacuity + a planted self-test. The counted `PENDING` map (file -> pinned hit count, cleared by the surface plan that owns the file) is **new design** for this phase; its count-pin analog is the `WHOLE_HISTORY_IDS` arm in `src/lib/degrade-warnings.test.tsx` (excerpted below). Copy the architecture, rename `EXCLUDED` to `EXCEPTIONS`, add `PENDING`, and swap the line-oriented regex for the AST scanner in `scripts/copy-census/scan.ts`. The `git log -S` history holds only the deletion, so there is no earlier excerpt of the removed map to copy.

**Header contract to copy** (docblock sections `THE PROPERTY`, `ORACLE INDEPENDENCE`, `HOW A FILE IS READ`, `THE MAP`, `ANTI-VACUITY`): the retired-word list, the exception reasons and the maps are typed in the test file. Nothing is imported from a page or from `glossary.ts` for rule A, so a drift in a constant fails here instead of passing against itself. (Rule B may import `GLOSSARY` by design; say so in the header.)

**Imports pattern** (`figure-gate-census.test.ts`):
```typescript
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const ROOTS = ["src/app", "src/components"] as const;   // copy census: ["src"]
```

**Walk and test-path exclusion** (copy `isTestPath`, `walk` verbatim; the copy census also excludes `*.test.*`, `__tests__`, `__fixtures__`):
```typescript
function isTestPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    /\.test\.[^/]+$/.test(rel) || /\.spec\.[^/]+$/.test(rel) ||
    parts.includes("__tests__") || parts.includes("__fixtures__")
  );
}
```

**Closed reason set** (copy `PLAIN_REASONS`): exceptions carry a reason from a closed set, each checked by regex; a free-text reason fails with `reason: <key> has "...", which is outside the closed reason set`. For this phase the set is e.g. `plain English, not <concept>`, `verb use`, `not user-visible: <why>`, `identifier in string form`.

**Stale-entry rule (the thing that forces each surface plan to delete its own PENDING rows)** (`judge`):
```typescript
for (const key of Object.keys(excluded)) {
  if (!walked.has(key)) problems.push(`stale: EXCLUDED key ${key} names a file the walk does not find`);
  else if (!matched.has(key)) problems.push(`stale: EXCLUDED key ${key} names a file the pattern does not match`);
}
```
For `PENDING` use the count form: a `PENDING` entry whose file now has zero hits fails with `stale`; a file whose hit count differs from the pinned number fails (so a plan cannot add a new retired word under cover of an existing entry). `EXCEPTIONS` is `(file, literal, reason)` rows shaped like `SOURCE_ALLOWLIST` in `no-email-in-copy.test.ts`, which has a reason-length arm (`expect(entry.reason.length).toBeGreaterThan(20)`) and a "still needed" arm (the file must still contain the literal), but **no count pin**. Add the pin from the `WHOLE_HISTORY_IDS` analog:
```typescript
// src/lib/degrade-warnings.ts
export const WHOLE_HISTORY_IDS = [
  "allocation.departed-history",
  "allocation.book.awaiting-derivation",
  // ... 10 ids ...
] as const;

// src/lib/degrade-warnings.test.tsx: "WHOLE_HISTORY_IDS is count-pinned at 10 ..."
// Raising it again needs its own reason (recorded in the comment above the arm).
expect([...WHOLE_HISTORY_IDS].sort()).toEqual([ /* the same ten, typed in the test */ ].sort());
expect(WHOLE_HISTORY_IDS).toHaveLength(10);
for (const id of wholeScoped) expect(WHOLE_HISTORY_IDS as readonly string[]).toContain(id);
// And the converse: every allowlisted id exists as an entry with that scope.
expect(wholeScoped.sort()).toEqual([...WHOLE_HISTORY_IDS].sort());
```
Apply it to `EXCEPTIONS`: the list is typed in the test, `toHaveLength(N)`, the sorted `toEqual`, and the converse arm (every row is still needed). The comment above the arm records WHY each raise happened.

**Anti-vacuity** (copy `ANCHORS` and both anti-vacuity `it`s): list named anchor files that must be walked AND matched (e.g. `src/components/layout/Sidebar.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/GlancePanel.tsx`), plus a positive-control floor that the scan found more than N hits at Wave 1 (a scan that finds nothing reads as "no retired words").

**Planted self-test** (copy `withPlanted` and the four planted arms): a planted `.tsx` with `<h2>Saved portfolios</h2>` is flagged; a comment-only mention is not; a `className="portfolio-card"`, an import specifier and a `console.log("portfolio")` are not; an exception row with an exact literal is honoured and the same literal in another file is not.
```typescript
function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "figure-census-selftest-"));
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
```

**How a `src/__tests__` test reaches `scripts/`** (the one precedent, `FactsheetBody.census.test.tsx`):
```typescript
import { countFactsheetCensus } from "../../../../../scripts/factsheet-census/count";
```
A relative path (there is no `@/` alias for `scripts/`). From `src/__tests__/copy-census.test.ts` the path to `scripts/copy-census/scan` is `../../scripts/copy-census/scan`. `scripts/factsheet-census/count.test.tsx` imports its sibling with `./count`.

**Printed measured counts, never restated in code** (copy the `console.info("figure-gate-census: walked=... matched=...")` line) so SUMMARY reads the real split.

**Three rule sets in one file** (RESEARCH Pattern 2 / section 4.2): A retired words, B raw registered term in a covered file not rendered through `Term`, C non-helper date format. Each has its own `PENDING` and its own planted red/green. Wave 3 asserts every `PENDING` is `{}`.

**Do not copy:** `figure-gate-census` reads whole-file text with a regex. The copy census must classify by AST node kind (JSX text vs attribute vs log argument), which regex cannot do (RESEARCH "Alternatives Considered").

**Neighbour to read before editing it:** `src/__tests__/public-truth-census.test.tsx` has a rendered half plus a source half with `BANNED` phrases and `findHits` that matches on the whole whitespace-collapsed text. It is the precedent for "a phrase wrapped across JSX lines is still caught", which matters for "your\n portfolio" in JSX text. Its `RAW_ID_HELPER_PATTERN = /\bdisplayStrategyName\b/` bans the helper in marketing roots; D-09 does not touch that, leave it.

---

### `scripts/copy-census/scan.ts` (utility, batch)

**Analog (location and isolation):** `scripts/factsheet-census/count.ts` (lives under `scripts/`, no app imports, run by `run.ts`, tested by a sibling `count.test.tsx`). vitest collects `scripts/**/*.test.{ts,tsx}` (INCLUDE in `vitest.config.ts`), so the scanner is never bundled.

**Analog (TypeScript compiler API in this repo):** `src/lib/seam-log-coverage.test.ts` and `src/__tests__/self-referential-oracle.test.ts` both `import ts from "typescript"`.
```typescript
import ts from "typescript";

/** Parse comment-stripped source. Total: a parse never throws, it recovers. */
function parseStripped(file: string, code: string): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const walk = (node: ts.Node): void => {
  if (ts.isCatchClause(node)) found.push(node);
  ts.forEachChild(node, walk);
};
ts.forEachChild(source, walk);
```
**Gap to flag to the planner:** both existing parsers use `ScriptKind.TS`. They never parse JSX. The scanner must choose `ScriptKind.TSX` for `*.tsx` files (RESEARCH "Scanner core": `file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS`). Core visitor: `JsxText`, whitelisted JSX attributes, string / no-substitution-template / template-part nodes, skipping import/export specifiers, literal types, property names, element-access keys, `case` labels, and anything inside a `console.*` / `logger.*` / `Sentry.*` / Supabase query-builder call. Copy the prototype under "Code Examples > Scanner core" in `201-RESEARCH.md` as the starting point.

**Pitfall carried from RESEARCH:** `JsxText.getText(sf)` drops leading whitespace as trivia. Any whitespace-sensitive check (the D-14 `</strong>`-newline scan) must read `node.text`, not `node.getText(sf)`.

**Comment handling:** the AST route needs no comment stripper (comments are trivia, not nodes). If a regex pre-pass is used for rule C's month-array detection, use `stripCommentsPreserveLines` from `@/lib/source-scan`, which blanks comments with spaces one for one and keeps string contents (its contract is documented at the top of that module).

---

### `scripts/copy-census/scan.test.ts` (test, batch)

**Analog:** `scripts/factsheet-census/count.test.tsx`.
Shape to copy: file docblock stating the two proofs ("Synthetic DOM, red and green: each rule fires on a hand-built article and stays quiet on its look-alike" plus a positive control on the real tree "so a selector that matches nothing reports RED here instead of a flattering zero"). Planted source strings replace the hand-built DOM.
```typescript
function mount(inner: string, outside = ""): HTMLElement { /* hand-built host */ }
```
For the scanner, each rule gets one red string and one green look-alike (`<h2>Saved portfolios</h2>` vs `<div className="portfolio-card" data-testid="portfolio-row">`).

---

### `src/lib/glossary.ts` (utility, transform)

**Analogs:** `src/components/strategy/discovery-columns.ts` (plain data, no React, the interpolation constants) and `src/lib/degrade-warnings.ts` (closed `as const` registry with a derived id union).

**Closed key union via `as const` + derived type** (`degrade-warnings.ts`: `export const DEGRADE_CLASSES = [...] as const; export type DegradeClass = (typeof DEGRADE_CLASSES)[number];`, and `export type DegradeId = Entry["id"]`). For the glossary: `export const GLOSSARY = {...} as const satisfies Record<string, GlossaryEntry>; export type TermKey = keyof typeof GLOSSARY;` so an unregistered key is a type error (UI-SPEC "empty / registry miss").

**Byte-identical move of the discovery tooltips, interpolations kept** (`discovery-columns.ts`):
```typescript
import { SIX_MONTH_WINDOW_DAYS } from "@/lib/factsheet/compute";

/** The UI-SPEC clause every full-record figure's tooltip ends on. */
const FULL_RECORD_BASIS = "From the first return day, or from the last break in the record.";
...
tooltip: `Total return over the whole record. ${FULL_RECORD_BASIS}`,
tooltip: `Return over the ${SIX_MONTH_WINDOW_DAYS} calendar days that end on the record's last day.`,
```
`FULL_RECORD_BASIS` and `SIX_MONTH_WINDOW_DAYS` stay interpolations in the registry's `discovery` context. `StrategyTable.headers.test.tsx` asserts `tip.textContent` equals the column tooltip exactly, so a changed byte fails there. `DISCOVERY_COLUMNS[n].tooltip` becomes a lookup into the registry (or is generated from it); the labels, `accessibleName`, `period` and `annualized` stay in `discovery-columns.ts`.

**Placement warning (figure-gate-census):** keep `glossary.ts` under `src/lib`. That census walks only `src/app` and `src/components` and matches `cagr|sharpe|sortino|calmar|volatility|annuali[sz]ed|treynor|information.ratio|tracking.error`. A glossary under `src/components` would itself match and need an `EXCLUDED` row. Also: `discovery-columns.ts`, `OptimizerPanel.tsx`, `CustomizeDrawer.tsx`, `StrategyFilters.tsx`, `PreferencesPanel.tsx`, `SimulateImpactButton.tsx` and `VerificationResults.tsx` sit in `EXCLUDED`. If a plan moves a file's last figure word out of it, the census fails `stale: EXCLUDED key ... names a file the pattern does not match`. Check this per plan.

**Registry invariants to enforce in `glossary.test.ts`** (copy the style of `degrade-warnings.test.tsx` "no entry has a problem" plus a meta-arm per invariant): every definition at most 200 characters (U-05); one or two sentences; no duplicate label or alias; a context override is never longer than 200 characters after interpolation; generic Sharpe/CAGR/Max DD/Volatility agree with their discovery context (UI-SPEC rule 5); Omega and Profit Factor do not contradict (rule 4).

---

### `src/components/ui/Term.tsx` (component, event-driven)

**Analog:** `src/components/ui/Tooltip.tsx` (wrapped) and the glossary `dt` in `OptimizerPanel.tsx` (affordance).

**What `Tooltip` gives and does not give.** It is portaled, `role="tooltip"`, 150 ms enter delay, and reacts to `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` on its OUTER wrapper span. A non-focusable child never receives focus, so `Term` must own a `tabIndex={0}` element.
```tsx
return (
  <span ref={setTriggerEl} className={className ?? "relative inline-flex"}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
    <span aria-describedby={open ? id : undefined}>{children}</span>
    {open && typeof document !== "undefined" && createPortal(<span role="tooltip" .../>, document.body)}
  </span>
);
```
`aria-describedby` sits on the inner non-focusable `<span>` and only while open. UI-SPEC requires it on the focusable element. Planner options (UI-SPEC "Accessibility"): an opt-in, default-off prop on `Tooltip`, or a `Term`-owned trigger. Constraint: `Tooltip.test.tsx` finds the wrapper with `screen.getByText("info").parentElement!.parentElement!`, so the DOM depth must not change when the prop is off.

**Affordance precedent to fold in (UI-SPEC U-02):** `OptimizerPanel`'s `dt`:
```tsx
<dt tabIndex={0} title={copy} aria-label={`${label}: ${copy}`}
    className="cursor-help border-b border-dotted border-text-muted text-micro font-medium uppercase tracking-wider text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
  {label}
</dt>
```
Do not copy `title={copy}` (it would give a native tooltip beside the bubble) or `aria-label` (it would change the accessible name). Do not copy `border-b` or the font/size/colour classes: UI-SPEC Form A is `cursor-help underline decoration-dotted decoration-1 decoration-text-muted underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 print:no-underline`, with no font, size, weight, colour, transform or tracking class.

**Two forms.** Form A (static label): `<span tabIndex={0} data-term="<key>">`. Form B (label inside a control): wrap the control in `Tooltip` directly. The existing Form B is `renderSortHeader` in `StrategyTable.tsx`: `return col.tooltip ? <Tooltip content={col.tooltip}>{button}</Tooltip> : button;`. Never nest Form A inside a `<button>`, `<a>`, `<summary>`.

**Print view:** under `printView` render the plain label with no span, no `tabIndex`, no underline, no `data-term` (D-20, U-03). The tearsheet mounts `FactsheetView ... printView`; find how `printView` reaches `MetricsColumn` rows before wiring.

**`Term` adds no visible text node.** `readText` in `scripts/factsheet-census/count.ts` drops only `sr-only` and `aria-hidden` descendants, so a visible glyph would change the 196 label tally.

---

### `src/components/ui/Term.test.tsx` (test, event-driven)

**Analog:** `src/components/ui/Tooltip.test.tsx` (fake timers) and `StrategyTable.headers.test.tsx`.
```tsx
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

render(<Tooltip content="Sharpe ratio explained"><button>info</button></Tooltip>);
fireEvent.mouseEnter(screen.getByText("info").parentElement!.parentElement!);
expect(screen.queryByRole("tooltip")).toBeNull();
act(() => { vi.advanceTimersByTime(150); });
expect(screen.getByRole("tooltip").textContent).toBe("Sharpe ratio explained");
```
and, from `StrategyTable.headers.test.tsx`:
```tsx
fireEvent.focus(headerButton(name));
const tip = await within(document.body).findByRole("tooltip");
expect(tip.textContent).toBe(tooltip);
```
Arms: focus opens `role="tooltip"` with the registry text; hover opens it; `[data-term]` and `tabIndex=0` present; `printView` renders none of them; the trigger's `textContent` equals the label (adds no visible text); `aria-describedby` on the focusable element once open.

Also needed at the surface level (render smoke, section 1.4 layer 2 of RESEARCH): `[data-term="<key>"]` exists on factsheet `ExtendedMetricsPanel` rows, `KpiStrip`, `GlancePanel`, one `CompareTable` row; focusing it opens the registry definition. Mount idiom: `FactsheetBody.census.test.tsx` (`mountView(censusPayloadA())`, `openAdvanced`).

---

### `src/lib/utils.ts` + `src/lib/utils.test.ts` (utility, transform) - `formatDay`, `formatMonth`

**Analog:** `formatIsoDay` in `src/lib/utils.ts` (null guard, NaN guard, UTC fields, `—`) and `formatCloseDay` / `parseIsoDay` in `src/lib/factsheet/returns-unit.ts` (the `MONTHS` array and the strict bare-day parse).

**Contract to copy** (`formatIsoDay`):
```typescript
export function formatIsoDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  ...
}
```
Doc comment reason to repeat: UTC fields only, never locale or zone, so server render and browser agree (not `toLocaleDateString`, not `iso.slice(0, 10)`: it would read the offset the string happens to carry). No `Date.now()` and no locale argument inside the helper (hydration).

**Output format to copy** (already pinned in `isoToMonthDay` in `MetricsColumn.tsx`): `` `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` ``. One shared `MONTHS` array replaces the six copies (`trade-fetch-lines.tsx`, `BatchDPanels.tsx`, `MetricsColumn.tsx`, `CompareEquityOverlay.tsx`, `returns-unit.ts`, plus `ScenarioComposer.tsx`'s `MONTH_ABBR`).

**Test pattern** (`utils.test.ts`, `describe("formatIsoDay")`): a full timestamp prints its UTC day; `2026-10-09T23:30:00-05:00` converts to UTC and prints the 10th (not the 9th); a bare date stays that date; null, undefined, empty and unparseable print `—`. Add the month form and the year boundary. Existing pins that change: `formatAbsoluteDate` (`"Apr 11"`, `"Jan 1"`) and `formatIsoDay` (`"2026-10-09"`). The helper order in RESEARCH is: helper + test first (Wave 1), call-site swaps per surface plan, then delete or alias `formatAbsoluteDate` / `formatIsoDay` in the last wave (knip is in devDependencies and flags an unused export).

**`formatRelativeTime`:** its `days < 30` branch ("3d ago") stays; its fallback `return formatAbsoluteDate(iso)` becomes `formatDay(iso)` (U-14).

---

### `src/lib/strategy-display.ts` + test (utility, transform) - D-09 / D-17

**Analog:** itself.
Current resolver (the part that changes):
```typescript
export function displayStrategyName(strategy: DisplayableStrategy | null | undefined): string {
  if (!strategy) return "Unnamed strategy";
  if (strategy.codename) return strategy.codename;
  if (strategy.disclosure_tier === "institutional" && strategy.name) return strategy.name;
  return `Strategy #${strategy.id.slice(0, 8)}`;
}
export function publicNamePreview(strategy: DisplayableStrategy): { factsheet: string; discovery: string } {
  return { factsheet: strategy.name ?? strategy.codename ?? displayStrategyName(strategy),
           discovery: displayStrategyName(strategy) };
}
```
Target order for a strategy visible in discovery: `name` (trimmed, non-empty), then `codename`, then `Strategy #<first 8 of id>`. For a strategy NOT visible to the viewer the existing redaction stays (D-17), so the resolver needs the visibility predicate as input (or a second function) rather than being flipped globally; keep `"Unnamed strategy"` for null input.

**Test pattern to update** (`strategy-display.test.ts`, 8 cases): "returns codename when set (regardless of tier)", "returns synthetic placeholder for exploratory tier without codename", "prefers codename over name even when tier is institutional". These pin the pseudonym and flip. Keep the `publicNamePreview` block and assert both legs equal.

**Three inlined copies of the D-09 chain** that collapse onto the resolver (RESEARCH 3.1): `generateMetadata` in `src/app/factsheet/[id]/v2/page.tsx` (calls `publicNamePreview(...).factsheet`), `pendingName` (`signature.name ?? signature.codename ?? displayStrategyName(...)`), and `factsheetName` in `src/lib/factsheet/fetch-and-build-payload.ts`; the OG route does `data?.name ?? data?.codename ?? "Strategy"`. Dedupe only if the plan chooses to.

**Required new RED test (D-17):** a strategy not visible in discovery to that viewer never gets its real name through any changed path.

---

### `src/lib/queries.ts` `redactedName` (service, CRUD read) - D-17

**Analog:** the adjacent `redactedOrgName`, which must NOT change.
```typescript
// audit-2026-05-07 G8.A.2 (P35): redact `name` to `null` for non-institutional rows ...
const redactedName =
  strategy.disclosure_tier === "institutional" ? strategy.name : null;
...
const redactedOrgName =
  strategy.disclosure_tier === "institutional" ? orgName : null;
```
`redactedName` is narrowed to the discovery visibility predicate (published, same predicate discovery's query uses), not removed. Update the type doc on the `name` field of the per-holding `strategy: {...}` object inside `MyAllocationDashboardPayload` ("redacted to `null` server-side when `disclosure_tier !== 'institutional'`"). Test arm to add or flip: `src/lib/queries.my-allocation.test.ts` (assert on the RSC payload, not only the rendered label; RED proof: restore the tier rule and see it fail).

**Surfaces that rely on `disclosure_tier` to hide the strategy NAME (the list D-09 asked for):** this `redactedName`; the browse route `safeLabel`; `displayStrategyName` callers (`allocation-helpers.ts` `displayName`, `holdings-adapter.ts`, `strategies-row-adapter.ts`, admin match surfaces, `queries.ts` outcome embeds and flagged-candidate names, `StrategyHeader.tsx`, tearsheet page); `ManagerIdentityPanel`; the comment in `src/app/api/strategies/[id]/name/route.ts` ("public surfaces render the codename ... regardless of what `name` holds") becomes false and is in Wave 3's stale-comment list.

---

### `src/app/api/strategies/browse/route.ts` (+ `route.test.ts`) (controller, request-response)

**Analog:** itself.
```typescript
const isOwnRow = r.user_id !== null && r.user_id === user.id;
const safeLabel = isOwnRow
  ? r.name
  : displayStrategyName({ id: r.id, name: r.name, codename: r.codename, disclosure_tier: tier });
return { id: r.id, name: safeLabel, codename: r.codename ?? null, ... isOwn: isOwnRow, ... };
```
Change `safeLabel` to the D-09 resolver; keep `codename` on the wire (D-17: no API change, search matches the displayed name and keeps matching `codename`). Update the C-0112 docblock above `codename`.
Tests that pin the pseudonym today and flip: T12a ("codename present, response name === codename"), T12b (`Strategy #44444444`), T12c; the ordering tests that avoid `Strategy #` labels need a re-check.

**New test (TODOS close condition):** `CompareAddStrategy.test.tsx` already builds rows with the `row()` helper and drives the combobox:
```tsx
const row = (over: Partial<StrategyBrowseRow> & { id: string; name: string }): StrategyBrowseRow => ({
  codename: null, markets: [], strategy_types: ["Momentum", "Trend"], is_example: false, isOwn: false, ...over });
const setup = (currentIds: string[] = [], rows = ROWS) => {
  const fetchStrategies = vi.fn().mockResolvedValue(cat(rows));
  const user = userEvent.setup();
  render(<CompareAddStrategy currentIds={currentIds} fetchStrategies={fetchStrategies} />);
  return { fetchStrategies, user, input: screen.getByRole("combobox", { name: "Add strategy" }) };
};
...
await user.type(input, "alp");
expect(await screen.findByRole("option", { name: /Alpine Trend/ })).toBeInTheDocument();
```
Per RESEARCH 3.4 the close-condition test feeds the route's real handler output (mocked supabase as in `route.test.ts`) for an exploratory-tier, non-own row with a codename into the `CompareAddStrategy` filter, and types the real name. RED proof: neuter `name` back to the old `displayStrategyName` call.

---

### `src/components/strategy/StrategyFilters.tsx` (component, event-driven) - Escape, D-12

**Analog:** `src/components/strategy/CustomizeDrawer.tsx`.

**Escape idiom to copy** (`CustomizeDrawer` effect with the F9 M-0061 comment):
```typescript
useEffect(() => {
  if (!open) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [open, onClose]);
```
For `StrategyFilters` the state is local: `filtersOpen`; use `[filtersOpen]` deps and `setFiltersOpen(false)`. Escape behaves like Close (the draft is discarded; `openFilters` already re-seeds `draft` from `advancedFilters`).

**Focus capture and restore to copy** (`CustomizeDrawer`):
```typescript
const previouslyFocusedRef = useRef<HTMLElement | null>(null);
useEffect(() => {
  if (!open) return;
  previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
  headingRef.current?.focus();
  return () => {
    const prev = previouslyFocusedRef.current;
    if (prev?.isConnected) prev.focus?.();
  };
}, [open]);
```
Required because the "All Filters" control is the shared `Button` (no `forwardRef`), so a ref to it is not available. Do NOT add `role="dialog"`, a focus trap, scroll lock or an initial focus move (UI-SPEC A-9: observed, not asked). Keep the "All Filters" title case (A-10). The Escape effect should only capture-and-restore; it need not move focus into the panel.

**Existing state in the file** (`StrategyFilters`): `const [filtersOpen, setFiltersOpen] = useState(false); const [draft, setDraft] = useState<AdvancedFilters>(advancedFilters);` with `openFilters`, `applyFilters`, `clearAll` as `useCallback`s; the panel is `{filtersOpen && (<div className="fixed inset-0 z-50 flex justify-end">...` closed by the backdrop `onClick` and the Close button (`aria-label="Close"`) only.

---

### `src/components/strategy/StrategyFilters.test.tsx` (test, event-driven) - new

**Analog:** `src/components/strategy/CustomizeDrawer.test.tsx`.
```tsx
it("ESC key calls onClose", () => {
  const onClose = vi.fn();
  renderDrawer({ onClose });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("F9 M-0061: a pre-handled ESC (defaultPrevented) does not double-close", () => {
  const evt = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  evt.preventDefault();
  document.dispatchEvent(evt);
  expect(onClose).not.toHaveBeenCalled();
});
```
No `StrategyFilters` test file exists at HEAD (the only test naming "All Filters" is `StrategyTable.test.tsx`). Arms: Escape closes the panel; a pre-handled Escape leaves it open; focus returns to the "All Filters" button; Escape discards an unapplied draft (applied filters unchanged). Select the backdrop by `data-testid`, as `CustomizeDrawer.test.tsx` does after audit C-0133 (it explains why a first-`aria-hidden` selector is brittle); the panel has none today, so add a testid only if needed.

---

### `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (component, transform) - derived numerals, D-10

**Analog:** itself. `EditorialSection` prints the numeral; today every call site hard-codes it.
```tsx
function EditorialSection({ label, name, children, scopeNote }: { label: string; name: string; children: ReactNode; scopeNote?: string }) {
  return (
    <section className="flex flex-col gap-6">
      <header className="border-b-[2px] border-text pb-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-fixed-10 uppercase tracking-[0.28em] text-text-muted">§{label}</span>
          <h2 className="font-serif italic text-fixed-22 leading-tight text-text-primary">{name}</h2>
```
Hard-coded labels: `detailed` arm I Performance, II Risk, III Style (conditional), V Terms, then `benchmarkSection("document")` (IV, conditional); `all` arm the same; `benchmarkSection` returns an `EditorialSection label="IV"` in three branches. Use the RESEARCH "Derived numerals" sketch: build `[{ name, node }]`, drop null nodes, assign `["I","II","III","IV","V","VI"]` by index, once, shared by both arms. `benchmarkSection` must return the name + children pair, with the name still `Benchmark — vs {bn}`. Names are unchanged byte for byte. Ownership: P05.

**Test analog for the new numerals test:** `MetricsColumn.window.test.tsx` is the only test that reads a numeral (a `span` with text `"§I"`); no test reads `§IV` or `§V`, so derived numerals break none. The other section tests read the `h2` text: `usd-view-withholdings.test.tsx`, `FactsheetView.returns-unit-comparisons.test.tsx` (`sectionIV` finds the `h2` starting with "Benchmark"), `FactsheetBody.joint-floor.test.tsx`, `FactsheetBody.flat-leg.test.tsx`. New `MetricsColumn.numerals.test.tsx`: render `detailed` and `all`, with and without Style, with and without a comparator, and assert the numeral spans read I..N in DOM order. RED proof: hard-code the old list. Mount fixtures: `censusPayloadA/B/C` in `v2/test-fixtures/census-payloads`.

---

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` KPI strip (component, transform) - `Term` on labels

**Analog:** itself. The label is a `<p data-testid="factsheet-kpi-label" className="... first-letter:normal-case">` and a comment above it records that a re-parented label "breaks six `getByText("α vs ...")` locators (FactsheetBody.joint-floor / .basis)".
Rule for this file: keep `data-testid="factsheet-kpi-label"` and the `first-letter:normal-case` class on the original `<p>`; wrap the text inside it in `Term` (Form A); for a glyph-prefixed label (`α vs BTC`, `IR vs BTC`) wrap the whole label. Run `FactsheetBody.census.test.tsx`, `FactsheetBody.joint-floor` and `.basis` after each edit.
Other row components take `label: string` (`Row`, `RollingRow`, `BwRow` in `MetricsColumn.tsx`; `KpiPanel`; `GlancePanel`'s local `Cell`): add an optional `term?: TermKey` prop rather than changing every label type (RESEARCH 1.3).

---

### `src/components/strategy/StrategyTable.tsx` plain headers (component, transform)

**Analog:** itself. Form B (sortable) is already correct; the plain headers are hover-only today:
```tsx
{PLAIN_COLUMNS.map((col) => (
  <th key={col.key} aria-label={col.accessibleName} className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted`}>
    {col.tooltip ? <Tooltip content={col.tooltip}>{col.label}</Tooltip> : col.label}
    {renderQualifier(col)}
  </th>
))}
```
Replace the `Tooltip`-around-text with `Term` Form A (U-06): the two plain headers ("Return curve", "Underwater") gain the dotted underline and a keyboard path. Pinned by `StrategyTable.headers.test.tsx` and `StrategyGrid.test.tsx` (tooltip text byte-for-byte). Date cells here (`formatIsoDay` in the Created cell and the track tooltip) switch to `formatDay` and need `whitespace-nowrap`.

---

### `src/components/strategy/CompareTable.tsx` (component, transform) - D-15 / D-25

**Analog:** the `StrategyTable` Volatility parity arm in `src/__tests__/figure-parity-pages.test.tsx`.

**The defect:**
```typescript
{ label: "Volatility", key: "volatility", format: "percent", higherIsBetter: false, qualKey: "volatility" },
...
function formatValue(value: number | null, format: MetricRow["format"]): string {
  if (value == null) return "—";
  if (format === "percent") return formatPercent(value);   // signed default => "+23.46%"
```
**The fix idiom** (already on discovery): `formatPercent(value, 2, { signed: false })`. Add a `percentUnsigned` format or a per-row flag; other rows keep the sign rule.

**Parity arm to add** (copy the existing StrategyTable arm in the same file):
```typescript
// Phase 197 D-05: volatility can never be negative, so the table prints it unsigned.
expect(tableCell("Volatility"), "Volatility").toBe(formatPercent(stored.volatility, 2, { signed: false }));
```
Render `CompareTable` with the fixture's stored row (`describe.each(FIXTURES)`, `analytics()` = `markedAnalytics(stored)`), then assert the Volatility cell equals that exact text. `CompareTable.test.tsx` already mentions Volatility in its figure-gate arms; update any `+` text there. RED proof: reintroduce the `+`. Close `[197-VOL-SIGN-TEARSHEET-COMPARE]` in `TODOS.md` (its tearsheet half was closed by Phase 196: the print view's `pct()` is unsigned).

---

### `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx` (component, request-response) - D-13

**Analog:** `ContactPointerText` + `contactHref`, used with `newTab` in `ErrorEnvelope.tsx`; the security page builds the href as a module-private constant.

**Shell to keep** (`WizardIpAllowlistHint`): `WarningBanner` with `className="mt-2 rounded-md border border-warning/30 bg-warning/5"`, `<p role="note" aria-label="Exchange IP allowlist hint" className="text-body text-text-secondary">`. Replace the `<a href="/security#egress-ips">` with:
```tsx
import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { contactHref } from "@/lib/contact";
// security/page.tsx builds it the same way, module-private:
//   const SECURITY_CONTACT_HREF = contactHref({ topic: "security" });
const SECURITY_CONTACT_HREF = contactHref({ topic: "security" });
...
<ContactPointerText text="Locking your exchange key to an IP allowlist? Ask for our current egress IPs through the contact form." href={SECURITY_CONTACT_HREF} newTab />
```
`SECURITY_CONTACT_HREF` is NOT exported (private to a page file); build it locally from `contactHref`, never export from a page. `ContactPointerText` links the first occurrence of the exact phrase `contact form` (`CONTACT_FORM_LINK_TEXT`), renders `target="_blank" rel="noopener noreferrer"` plus a visually hidden ` (opens in a new tab)` when `newTab`. Accessible name: `contact form (opens in a new tab)`.

**Test rewrite** (`WizardIpAllowlistHint.test.tsx`): the current arms pin the verbatim D-07 sentence and `getByRole("link", { name: "/security#egress-ips" })` with `href="/security#egress-ips"`. Replace with: no `a[href*="egress-ips"]`; one link with accessible name `contact form (opens in a new tab)` whose `href` equals `contactHref({ topic: "security" })`; keep the `role="note"`, `aria-label`, `WarningBanner` className and no-dismiss arms. RED proof: revert the link. `security/page.test.tsx` pins the `/security#egress-ips` section text and does not change.

---

### `src/lib/wizardErrors.ts` (utility, transform) - D-23 / U-16

**Analog:** `ErrorEnvelope.tsx`, which renders each `fix` step and `cause` through `ContactPointerText` (topic `support`, new tab), so no new component code is needed.
```typescript
KEY_PERMISSION_DENIED: {
  ...
  fix: [
    "First, check the key's scopes: ...",
    "Then, if the key is pinned to specific IPs, either remove the restriction or add our egress IPs — see the docs link below.",   // rewrite
    "Save, then paste the key here again.",
  ],
  docsHref: "/security#egress-ips",   // stays (U-16)
```
Rewrite per UI-SPEC Interaction contract 8 for `KEY_PERMISSION_DENIED` and `KEY_IP_ALLOWLIST` bullet 2; the bullet count is unchanged (`fixRequires.length === fix.length`); `wizardErrors.test.ts` asserts every `docsHref` matches `/^\/security(#|$)/`, which still holds. `no-email-in-copy.test.ts` walks the exported values of this module: the new copy must stay email-free. This file also carries "My Strategies" copy (retired word, same plan P08).

---

### `src/app/(marketing)/legal/disclaimer/page.tsx` (route, request-response) + `page.test.tsx` (new) - D-14

**Analog (page):** itself. The bug:
```tsx
{PLATFORM_NAME} does <strong>not</strong>
operate a fund, act as a broker-dealer, or execute trades on your
behalf.
```
JSX drops the whitespace between `</strong>` and a text line that starts after a newline, so it renders "notoperate". Fix with `{" "}` after the closing tag. `src/components/ui/Disclaimer.tsx` builds template strings inside one `<p>{text}</p>`, so it cannot have this bug (no change). RESEARCH section 8 lists the only other flagged joins to inspect (`BridgeWidget.tsx`, `ScenarioComposer.tsx`, `OutcomesWidget.tsx`, `FactsheetView.tsx`, `MatchQueueIndex.tsx`, `MandateSaveStatus.tsx`, `NoteSaveStatus.tsx`, `PortfolioImpactPanel.tsx`, `RequestIntroButton.tsx`).

**Analog (test):** the rendered half of `src/__tests__/public-truth-census.test.tsx` renders marketing pages and reads their text; copy its `vi.mock("next/link", ...)` anchor mock if the page needs one. No test exists for this page (the directory holds only `page.tsx`). Assert `container.textContent` contains `does not operate a fund` and not `notoperate`.

---

### `src/app/factsheet/[id]/tearsheet/page.tsx` + `ManagerIdentityPanel.tsx` (route + component) - D-09 card, D-24 custody

**Analog (custody tier rule):** `Disclaimer.tsx` `strategy-page` variant.
```typescript
// is only true of api_verified data, so every other tier (csv_uploaded, ...
text = `${trustTier === "api_verified" ? CUSTODY_TEXT : CUSTODY_CORE} ${provenanceFor(trustTier)} ${FOOTER_TEXT}`;
```
The tearsheet already computes `trustTier` (`const trustTier: TrustTierKind | null = ...` then `withTrustTier(builtPayload, trustTier)`). The Risk Disclosure clause becomes: `api_verified` keeps "Strategies are monitored via read-only exchange APIs; managers retain asset custody."; every other tier (and missing) says "Managers retain asset custody." The `custody` variant itself changes nothing (no `src` caller; five `src` call sites use `footer` x4 and `strategy` x1).

**Analog (manager card):** `ManagerIdentityPanel` exploratory lane today prints `{strategyCodename}` under the "Manager" eyebrow beside "Pseudonymous strategy." and the disclosed lane falls back `manager.display_name ?? manager.company ?? strategyCodename`. With a real strategy name both would present it as the manager's name. UI-SPEC U-11: eyebrow `Manager`, h3 `Pseudonymous manager`, body `Manages {displayed strategy name}. The manager's identity is disclosed once an allocator requests an introduction and the manager accepts.`, badge `Exploratory`; disclosed lane last fallback `Name not provided`. Rename the prop (`strategyCodename` to a name that says what it is). The identity gate (`isAttested`, `effectiveManager`, C-0189) is untouched. Tearsheet `displayName` feeds the H1, the pending H1, `<title>` and "Interested in {displayName}?".

---

### `src/components/layout/Sidebar.tsx` `buildPrimaryMobileNav` (component, transform) - D-07

**Analog:** itself.
```typescript
primary.push(
  { label: "My allocation", href: "/allocations", icon: PortfolioIcon, badge: p.flaggedCount },
  { label: "Risk", href: "/allocations?tab=risk", icon: ShieldIcon },
  { label: "Bridge", href: "/allocations?tab=scenario", icon: BridgeIcon },   // label -> "Scenario"
);
```
Rename only the third label (D-07). Pins: `MobileNav.test.tsx` (the `labels` array, the exact-list assertion, `getByText("Bridge")`, header comment) and `Sidebar.test.tsx` (references "My allocation" only). The desktop sidebar and `FACTSHEET_ORIGINS` in `src/lib/factsheet/origin.ts` already match D-07 (the one back-link map, pinned by `HoldingsTable.strategy-rows.test.tsx`); do not widen it (open-redirect closed set, T-196-06). Ownership: P06.

---

### `OptimizerPanel.tsx` / `PortfolioOptimizer.tsx` (component, transform) - `METRIC_TOOLTIPS`

**Analog:** itself. `OptimizerPanel` carries `const METRIC_TOOLTIPS: { label: string; copy: string }[]` and a duplicate sits in `PortfolioOptimizer.tsx` (OptimizerPanel imports it for types only). Both move into the registry (`sharpe_lift`, `corr_with_allocation`, `dd_improve`); the glossary `dl` block moves onto `Term`; "Corr w/ portfolio" becomes "Corr w/ allocation" in BOTH places in the same commit (U-17). `OptimizerPanel.tsx` is a `label only` row in `figure-gate-census` `EXCLUDED`: re-check the stale rule after the edit.

---

### Wide rename families (component / copy, transform)

**Analog:** the "Renamed string families" tables in `201-UI-SPEC.md` Interaction contract 3. They are the exact "After" copy; a hit not listed follows the canonical-word table (U-25).
Pattern per site: replace the retired noun, fix the article ("a portfolio" to "an allocation"), keep meaning, and in the SAME commit grep `src`, `e2e` and `tests` for the old literal and update every pinning test (RESEARCH 2.4: 60 to 90 test files; named pins include `MobileNav.test.tsx`, `HoldingsTable.strategy-rows.test.tsx`, `AddAllocationFlow.test.tsx`, `AllocateDialog.test.tsx`, `SubmitStep.test.tsx`, `MandatePanels.scenario.test.tsx`, `src/app/portfolio-pdf/[id]/page.test.tsx`, `e2e/composer-axe.spec.ts` "Start a portfolio").
Special cases with no safe blanket rename: `degrade-warnings.ts` entries carry "book" copy and are registered copy (`degrade-warnings.test.tsx` pins sentences word for word, e.g. the "Phase 198 per-key lines read word for word what shipped" arms): change the word and the test's expected sentence together. `Disclaimer.tsx`, `src/lib/email.ts` (scanned, 2 hits) and `src/app/api/**` error envelopes follow the same rule (rename text, not the route or field names). "No preference" in `RequestIntroButton` is the one named `EXCEPTIONS` row.

---

## Shared Patterns

### One tooltip primitive, two forms
**Source:** `src/components/ui/Tooltip.tsx`, `StrategyTable.tsx` `renderSortHeader`
**Apply to:** every registered term.
Form B (label inside a control) wraps the control in `Tooltip` with the registry text. Form A (static label) is `Term`. See `Term.tsx` above.

### Census with an exclusion map, a stale-entry rule and (new) a counted pending map
**Source:** `src/__tests__/figure-gate-census.test.ts` (`EXCLUDED`, stale-key rule, closed reasons, anti-vacuity, `withPlanted`) and `src/lib/degrade-warnings.test.tsx` (`WHOLE_HISTORY_IDS` count pin). The `PENDING` map itself is new design; see the correction under `copy-census.test.ts`.
**Apply to:** `copy-census.test.ts` (rules A, B, C), and the per-surface plans that must delete their own `PENDING` rows.
A `PENDING` row for a file with zero hits fails; a row whose count differs fails; `EXCEPTIONS` is `(file, literal, reason)` with a closed reason set and a pinned count; a planted self-test proves each rule can fire. RED proofs are mandatory per D-08 and the project testing rule: neuter, see RED, restore from a byte backup (never `git checkout`/`stash` on uncommitted work).

### Oracle independence
**Source:** headers of `figure-gate-census.test.ts` and `public-truth-census.test.tsx`
**Apply to:** `copy-census.test.ts` rule A.
The banned words, exception rows and pinned counts are typed in the test; nothing is imported from a page or from the registry, so a constant that drifts fails the test instead of passing against itself.

### Comment handling
**Source:** `@/lib/source-scan` `stripCommentsPreserveLines`
**Apply to:** any regex pre-pass. Line-preserving (comments become spaces, columns keep), string contents survive, trailing comments are blanked. A docblock that quotes a retired word (to say it is gone) must not red a clean tree. AST scanning needs no strip.

### UTC-only date helpers
**Source:** `formatIsoDay` in `src/lib/utils.ts`, `formatCloseDay` in `src/lib/factsheet/returns-unit.ts`
**Apply to:** every date call site. UTC fields only, no locale, no `Date.now()`, `—` for empty or unparseable. Exempt by category: chart axis ticks, a time of day printed alone, relative ages under 30 days, machine values (CSV and export contents, file names, `<input type="date">`, URLs, a `<time>` element's `dateTime`).

### Contact pointer sentences
**Source:** `src/components/contact/ContactPointerText.tsx`, `src/lib/contact.ts` `contactHref`, `ErrorEnvelope.tsx`
**Apply to:** `WizardIpAllowlistHint.tsx`, `wizardErrors.ts` fix bullets. The phrase `contact form` is the exact link text; `newTab` where the surface sits over unsaved state. Never put a mailbox in copy (`no-email-in-copy.test.ts` walks the exported values of `wizardErrors`, `status-surface-copy`, `key-card-copy`, `contact` and source-scans named user-facing files).

### Display-sign rule
**Source:** `formatPercent(value, decimals, { signed })` in `src/lib/utils.ts` (delegates to `formatFixedSigned` in `src/lib/factsheet/display-sign.ts`)
**Apply to:** `CompareTable` volatility (`{ signed: false }`). A value that rounds to zero at the printed precision prints unsigned.

### Test-file conventions for this phase
**Source:** `FactsheetBody.census.test.tsx`
**Apply to:** factsheet render tests. `vi.mock("@/lib/sentry-capture", ...)`, `vi.mock("next/navigation", ...)`, a `localStorage` stub in `beforeEach`, `vi.setConfig({ testTimeout: 60_000 })` for whole-page renders, and a positive control beside every "zero" arm so a selector that matches nothing cannot pass vacuously.

## Cross-cutting hazards for the planner

- **`figure-gate-census` interplay.** Moving figure words out of a file listed in `EXCLUDED` (for example `discovery-columns.ts`, `OptimizerPanel.tsx`) or deleting one makes `stale: EXCLUDED key ...` fail. Keep `glossary.ts` in `src/lib` (outside its walk roots).
- **`public-truth-census` `RAW_ID_PATTERN` / `RAW_ID_TEMPLATE_PATTERN` / `RAW_ID_HELPER_PATTERN`.** They stay meaningful after D-09; they scan marketing roots and ban `displayStrategyName` there. Do not import the helper into `src/app/(marketing)`.
- **196 factsheet census.** `Term` adds no visible text; `data-testid="factsheet-kpi-label"` and `first-letter:normal-case` stay on the original `<p>`.
- **`Tooltip.test.tsx` DOM depth.** `.parentElement.parentElement` from the child must still land on the wrapper when any new prop is off.
- **`BatchDPanels.tsx` trips an open TODO.** `196-STYLE-DRIFT-CENSUS-BLIND-01` names "the next edit to ... `BatchDPanels.tsx`" as its trigger; the plan that adds the Kolmogorov-Smirnov `Term` closes or restates it.
- **Frozen files.** `src/__tests__/phase-52-frozen-spine-guards.test.ts` lists four (`useBreakpoint.ts`, `montecarlo.worker.ts`, `TouchTooltip.tsx`, `useTapPin.ts`); none formats a date or is a base for `Term`. Run it per wave.
- **Conflict between RESEARCH and UI-SPEC on chart hover tooltips and heatmap cell titles.** RESEARCH 4.1 lists chart tooltips as exempt from the date rule; UI-SPEC U-15 puts them INSIDE it (D-21 exempts axis ticks only, and CONTEXT never ratified the wider exemption). UI-SPEC is the approved, later contract and wins: chart hover tooltips and heatmap cell titles (`2026-10` becomes `Oct 2026`) use `formatDay` / `formatMonth`; only axis tick labels, a time of day printed alone, relative ages and machine values stay exempt. Plans and the rule C exemption list must follow U-15. Chart files carry their own pin tests (`TimeSeriesChart.markers.test.tsx`, `TimeSeriesChart.ticks.test.tsx`, `edge-tick-labels.test.tsx`, `heatmap-month-labels.test.tsx`) that must be re-run after any chart edit.
- **No skip-CI tokens** and no AI attribution trailers in any commit message or PR body; CHANGELOG entry and byte-equal `VERSION` / `package.json` in the ship commit (project `CLAUDE.md`).
- **Parallel plans** must own disjoint files (RESEARCH "Plan Split"); `Sidebar.test.tsx` and `MobileNav.test.tsx` belong to the plan that owns `Sidebar.tsx`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| TSX-aware scan in `scripts/copy-census/scan.ts` | utility | batch | Both in-repo `typescript` importers (`seam-log-coverage.test.ts`, `self-referential-oracle.test.ts`) parse with `ScriptKind.TS`, none parses JSX. Use the prototype under "Code Examples > Scanner core" in `201-RESEARCH.md`; the analogs above cover walker shape, planted self-tests and anti-vacuity only. |

Everything else has an in-repo analog; there is no existing `Term`-like wrapper and no existing glossary (`src/lib/glossary*` and `src/components/ui/Term*` do not exist; `scripts/copy-census/` does not exist).

## Metadata

**Analog search scope:** `src/lib`, `src/components/ui`, `src/components/strategy`, `src/components/contact`, `src/components/error`, `src/components/layout`, `src/app/factsheet`, `src/app/api/strategies/browse`, `src/app/(dashboard)/{allocations,compare,strategies/new/wizard}`, `src/app/(marketing)`, `src/__tests__`, `scripts/factsheet-census`.
**Files read:** about 30 (analog sources and tests, plus the three phase documents).
**Project skills:** `ls .claude/skills .agents/skills` in this worktree returns neither directory, so no project skill applied. Project instructions came from the root `CLAUDE.md` / `AGENTS.md` / `DESIGN.md` references in the brief.
**Symbol verification (grep at this worktree's HEAD):** `ExtendedMetricsPanel`, `RollingRow`, `BwRow`, `Row`, `ymd`, `EditorialSection`, `benchmarkSection`, `isoToMonthDay` (all in `MetricsColumn.tsx`); `KpiPanel` (`src/components/kpi/KpiPanel.tsx`); `KEY_IP_ALLOWLIST`, `KEY_PERMISSION_DENIED`, `fixRequires` (`wizardErrors.ts`); `formatIsoMonth`, `MONTH_ABBR` (`ScenarioComposer.tsx`); `monthYear` (`BatchDPanels.tsx`); `formatSpanDate` (`CompareEquityOverlay.tsx`); `formatCalendarDate` (`add-allocation.ts`); `formatIsoDate` (`trade-fetch-lines.tsx`); `formatDate` (`OutcomesWidget.tsx`); `pendingName` (`v2/page.tsx`); `factsheetName` (`fetch-and-build-payload.ts`); `isAttested`, `effectiveManager` (`tearsheet/page.tsx`) all resolve. `MyAllocationStrategy` (named in RESEARCH) does NOT exist; the redacted field lives in `MyAllocationDashboardPayload`.
**Tracked-source gate (#3645):** `git ls-files` run over the analog paths in the first pass (all printed); no analog is a gitignored mirror.
**Pattern extraction date:** 2026-11-11
