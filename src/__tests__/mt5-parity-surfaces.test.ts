/**
 * Phase 155 (PARITYHARNESS) plan 09 — the MT5-09 data layer: the surface matrix.
 *
 * For every account in a capture, run each live surface's OWN TypeScript computation, cited
 * by symbol, on that surface's own stored input column, and record one headline cell per
 * surface (cumulative return, last return date, CAGR, Sharpe, max drawdown, the figure-gate
 * state). The result is `surface-matrix.json`; classifying cross-surface differences is
 * Python's job (plan 08), so `MT5_PARITY_TOLERANCE` keeps one definition and nothing is
 * compared against a tolerance here.
 *
 * TWO INPUTS, ONE HARNESS.
 *  - synthetic (default, always): `analytics-service/tests/fixtures/mt5_parity/capture_synthetic.json`
 *    flattened into fake tables by `docs/runbooks/mt5-parity/capture-contract.json`. Every
 *    synthetic test builds from this bundle whatever the environment says.
 *  - real (only when MT5_PARITY_CAPTURE_DIR is set): the sealed capture directory. Every
 *    sha256 sidecar and the manifest are verified; a bad directory or a seal mismatch
 *    THROWS naming the slice. There is no skip path. CI collects this file with the
 *    variable unset, so only the synthetic tests run there: that is the absence of an
 *    input, not a skipped failure. The matrix is written to `<dir>/derived/surface-matrix.json`
 *    (the capture directory is gitignored).
 *
 * WHAT IS NEVER DONE: no strategy is published, no route or UI file changes, no file-private
 * helper is exported. A surface that renders only published strategies is recorded as
 * `not_rendered_while_unpublished` and the harness never publishes to get a reading.
 * `StrategyTable.tsx::gatedMetric` is file-private: its one-line composition
 * `gatedValue(analytics[key], gateAnnualized(rowRecord(row)))` is rebuilt from the exported
 * pieces. Error cells carry the error CLASS name, never its message (a message could carry a value).
 */
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

type Row = Record<string, unknown>;

/**
 * The fake PostgREST: one table set at a time (the account under measurement), served to BOTH
 * the admin client (the factsheet loader) and the session client (`getOwnCapitalStrategies`).
 * `seen` records every table and rpc the real loaders reached, so an unserved read is visible.
 */
const fake = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  seen: new Set<string>(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
}));

// ---------------------------------------------------------------------------------------
// The fake client (hoisted function declarations so the vi.mock factories above can use it).
// ---------------------------------------------------------------------------------------

function makeClient() {
  return {
    from: (table: string) => {
      fake.seen.add(table);
      return makeBuilder(table);
    },
    rpc: (name: string) => {
      fake.seen.add(`rpc:${name}`);
      return Promise.resolve({
        data: null,
        error: { message: "rpc is not served by the parity harness", code: "HARNESS" },
      });
    },
  };
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** `col`, `col->key`, `col->>key`, `col->0->>date`, `col->-1->>date`: the PostgREST JSON path. */
function jsonPath(row: Row, expr: string): unknown {
  const parts = expr.split(/(->>|->)/).filter((p) => p !== "");
  let value: unknown = row[parts[0].trim()];
  let asText = false;
  for (let i = 1; i < parts.length; i += 2) {
    asText = parts[i] === "->>";
    const step = parts[i + 1].trim();
    if (value === null || value === undefined || typeof value !== "object") return null;
    if (/^-?\d+$/.test(step)) {
      const arr = value as unknown[];
      const idx = Number(step);
      value = Array.isArray(arr) ? arr[idx < 0 ? arr.length + idx : idx] : null;
    } else {
      value = (value as Row)[step];
    }
  }
  if (value === undefined) return null;
  return asText && value !== null ? String(value) : value;
}

function project(row: Row, select: string | undefined): Row {
  if (select === undefined || select.trim() === "" || select.trim() === "*") return { ...row };
  const out: Row = {};
  for (const item of splitTop(select)) {
    if (item === "*") {
      Object.assign(out, row);
      continue;
    }
    const embed = /^(\w+)(?:![\w]+)?\s*\(([\s\S]*)\)$/.exec(item);
    if (embed) {
      out[embed[1]] = embedOf(embed[1], embed[2], row);
      continue;
    }
    const alias = /^(\w+):([\s\S]+)$/.exec(item);
    if (alias) {
      out[alias[1]] = jsonPath(row, alias[2]);
      continue;
    }
    out[item] = jsonPath(row, item);
  }
  return out;
}

/** To-one embeds of a `strategies` row: its analytics row. `api_keys` carries no captured exchange, so it is null. */
function embedOf(name: string, inner: string, strategy: Row): unknown {
  if (name === "strategy_analytics") {
    const found = (fake.tables.strategy_analytics ?? []).find((a) => a.strategy_id === strategy.id);
    return found ? project(found, inner) : null;
  }
  return null;
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

type Pred = (r: Row) => boolean;

function orPred(filter: string): Pred {
  const clauses = splitTop(filter).map((c) => {
    const m = /^(\w+)\.(eq|neq|gt|gte|lt|lte)\.(.*)$/.exec(c);
    if (!m) throw new Error(`parity harness: unsupported or() clause ${c.split(".")[0]}`);
    return { col: m[1], op: m[2], val: m[3] };
  });
  return (r) =>
    clauses.some(({ col, op, val }) => {
      const c = cmp(String(r[col]), val);
      return op === "eq" ? c === 0 : op === "neq" ? c !== 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
    });
}

function makeBuilder(table: string) {
  const preds: Pred[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let select: string | undefined;
  let limitN = Infinity;
  let rangeFrom = 0;

  const run = (): Row[] => {
    let rows = (fake.tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
    for (let i = orders.length - 1; i >= 0; i -= 1) {
      const { col, asc } = orders[i];
      rows = [...rows].sort((x, y) => (asc ? 1 : -1) * cmp(x[col], y[col]));
    }
    rows = rows.slice(rangeFrom, rangeFrom + limitN);
    return table === "strategies" || select !== undefined ? rows.map((r) => project(r, select)) : rows.map((r) => ({ ...r }));
  };

  const b: Record<string, unknown> = {};
  const chain = (f: (...a: never[]) => void) => (...a: unknown[]) => {
    (f as (...x: unknown[]) => void)(...a);
    return b;
  };
  b.select = chain((s?: string) => {
    select = s;
  });
  b.eq = chain((c: string, v: unknown) => preds.push((r) => String(r[c]) === String(v)));
  b.neq = chain((c: string, v: unknown) => preds.push((r) => String(r[c]) !== String(v)));
  b.in = chain((c: string, v: unknown[]) => preds.push((r) => v.map(String).includes(String(r[c]))));
  b.is = chain((c: string, v: unknown) => preds.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)));
  b.gt = chain((c: string, v: unknown) => preds.push((r) => cmp(r[c], v) > 0));
  b.gte = chain((c: string, v: unknown) => preds.push((r) => cmp(r[c], v) >= 0));
  b.lt = chain((c: string, v: unknown) => preds.push((r) => cmp(r[c], v) < 0));
  b.lte = chain((c: string, v: unknown) => preds.push((r) => cmp(r[c], v) <= 0));
  b.or = chain((f: string) => preds.push(orPred(f)));
  b.order = chain((c: string, o?: { ascending?: boolean }) => orders.push({ col: c, asc: o?.ascending !== false }));
  b.limit = chain((n: number) => {
    limitN = n;
  });
  b.range = chain((from: number, to: number) => {
    rangeFrom = from;
    limitN = to - from + 1;
  });
  b.abortSignal = chain(() => undefined);
  b.maybeSingle = async () => {
    const rows = run();
    if (rows.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    return { data: rows[0] ?? null, error: null };
  };
  b.single = async () => {
    const rows = run();
    if (rows.length !== 1) return { data: null, error: { message: "not one row", code: "PGRST116" } };
    return { data: rows[0], error: null };
  };
  b.then = (resolveFn: (v: unknown) => unknown) => resolveFn({ data: run(), error: null });
  // An unserved builder method is a loud failure, never a silent empty answer.
  return new Proxy(b, {
    get(target, prop) {
      if (typeof prop === "symbol" || prop in target) return target[prop as string];
      throw new Error(`parity harness: the fake PostgREST builder does not serve .${prop}()`);
    },
  });
}

// ---------------------------------------------------------------------------------------
// Imports of the real surface code (after the mocks above).
// ---------------------------------------------------------------------------------------

import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { StrategyVisibility } from "@/lib/factsheet/fetch-and-build-payload";
import { computeOgHeadline } from "@/lib/factsheet/og-metrics";
import { curveMethodFromFlags, resolveDailyReturnSeries } from "@/lib/factsheet/resolve-series";
import { convertNativeReturnsToUsd } from "@/lib/factsheet/native-to-usd";
import { parseReturnsUnit } from "@/lib/factsheet/returns-unit";
import { readBtcCloses } from "@/lib/factsheet/benchmark-source";
import { RECORD_SCALAR_ALIASES, recordFromScalars } from "@/lib/figure-record-scalars";
import {
  figureRecord,
  gateAnnualized,
  gatedValue,
  MIN_ANNUALIZATION_DAYS,
  MIN_ANNUALIZATION_OBS,
  type FigureState,
} from "@/lib/figure-gate";
import { rowRecord } from "@/components/strategy/annualized-cell";
import { getOwnCapitalStrategies, liveBaselineMetricsFromPerKeyDailies, shapeRowAnalytics } from "@/lib/queries";
import { toStrategyRows } from "@/app/(dashboard)/allocations/lib/strategies-row-adapter";
import { liveBookFigures } from "@/app/(dashboard)/allocations/lib/book-figures";
import { buildPerKeyStrategyForBuilderSet } from "@/app/(dashboard)/allocations/lib/scenario-adapter";
import { buildDateMapCache, computeScenario } from "@/lib/scenario";
import type { ComputedMetrics, DailyPoint, StrategyForBuilder } from "@/lib/scenario";
import { blendPeriodsPerYear, isComputedAnalytics, isRankableAnalyticsRow } from "@/lib/closed-sets";
import { holdingEquityContribution } from "@/lib/holding-equity";
import { withPublishedOrOwner } from "@/lib/visibility";
import type { StrategyAnalytics } from "@/lib/types";

// ---------------------------------------------------------------------------------------
// Matrix types (the surface-matrix.json schema, matrix_version 1)
// ---------------------------------------------------------------------------------------

type CellState = "value" | "withheld" | "not_applicable" | "same_as" | "error";
type Visibility = "owner_visible" | "not_rendered_while_unpublished";
type ShownState = "shown" | "short" | "withheld" | null;

interface Cell {
  surface: string;
  symbol: string;
  visibility: Visibility;
  state: CellState;
  same_as: string | null;
  reason: string;
  figures: {
    cumulative_return: number | null;
    last_return_date: string | null;
    cagr: number | null;
    sharpe: number | null;
    max_drawdown: number | null;
  };
  figure_states: { cagr: ShownState; sharpe: ShownState; max_drawdown: ShownState };
  unit_view: "native" | "usd";
}

interface CrossStore {
  days_compared: number;
  days_differing: number;
  first_differing_day: string | null;
}

interface AccountMatrix {
  key_ordinal: string;
  label: string;
  unit: string;
  strategy_status: string | null;
  computed_at: string | null;
  cells: Cell[];
  cross_store: CrossStore;
}

interface Matrix {
  matrix_version: 1;
  mode: "synthetic" | "real";
  /** Real mode: lowercase hex sha256 of the exact bytes of `sealed/manifest.json`. Synthetic mode omits it. */
  capture_manifest_sha256?: string;
  accounts: AccountMatrix[];
}

/** The nine surface ids, each with the symbols that compute what that surface renders. */
const SURFACES = [
  { id: "factsheet", symbol: "fetchAndBuildPayloadWithReason" },
  { id: "share_card", symbol: "computeOgHeadline" },
  { id: "factsheet_pdf", symbol: "same_as factsheet" },
  { id: "allocations_strategies_panel", symbol: "toStrategyRows" },
  { id: "allocations_live_baseline", symbol: "liveBaselineMetricsFromPerKeyDailies + liveBookFigures" },
  { id: "scenario_composer_book", symbol: "buildPerKeyStrategyForBuilderSet + computeScenario" },
  {
    id: "scenario_composer_route",
    symbol: "resolveDailyReturnSeries + curveMethodFromFlags + convertNativeReturnsToUsd + recordFromScalars + computeScenario",
  },
  { id: "owner_list_card", symbol: "shapeRowAnalytics + rowRecord + gateAnnualized + gatedValue" },
  { id: "discovery_card", symbol: "shapeRowAnalytics + rowRecord + gateAnnualized + gatedValue" },
] as const;

const symbolOf = (id: string): string => SURFACES.find((s) => s.id === id)!.symbol;

// ---------------------------------------------------------------------------------------
// Capture loading
// ---------------------------------------------------------------------------------------

interface CaptureData {
  mode: "synthetic" | "real";
  /** Real mode: sha256 hex of the sealed manifest's bytes, so the matrix names the capture it was built from. */
  manifestSha256?: string;
  labels: Record<string, string>;
  /** slice name -> flat rows, each carrying `key_ordinal`. */
  slices: Record<string, Row[]>;
}

const REPO_ROOT = resolve(__dirname, "..", "..");
const BUNDLE_PATH = join(REPO_ROOT, "analytics-service", "tests", "fixtures", "mt5_parity", "capture_synthetic.json");
const CONTRACT_PATH = join(REPO_ROOT, "docs", "runbooks", "mt5-parity", "capture-contract.json");
const EXCLUDED_LABEL = "excluded";

interface Contract {
  files: Record<string, { slice: string; table: string }>;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Synthetic mode: flatten a bundle's `raw["capture-*.json"]` slice_rows by the capture contract. */
function loadSyntheticFromBytes(bundleBytes: Buffer): CaptureData {
  const bundle = JSON.parse(bundleBytes.toString("utf8")) as {
    synthetic?: unknown;
    labels: Record<string, string>;
    raw: Record<string, { key_ordinal: string; slice_rows: Row[] }[]>;
  };
  if (bundle.synthetic !== true) throw new Error("surface matrix: the bundle is not synthetic");
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as Contract;
  const slices: Record<string, Row[]> = {};
  for (const [file, spec] of Object.entries(contract.files)) {
    const witnesses = bundle.raw[file.replace(/\.sql$/, ".json")] ?? [];
    slices[spec.slice] = witnesses.flatMap((w) => w.slice_rows.map((r) => ({ ...r, key_ordinal: w.key_ordinal })));
  }
  return { mode: "synthetic", labels: bundle.labels, slices };
}

/** Real mode: the sealed directory, every sha256 verified, a miss or mismatch throws naming the slice. */
function loadRealCapture(dir: string): CaptureData {
  if (!existsSync(dir)) throw new Error("MT5_PARITY_CAPTURE_DIR does not exist");
  const sealed = join(dir, "sealed");
  const verified = (name: string): Buffer => {
    const file = join(sealed, name);
    const sidecar = `${file}.sha256`;
    if (!existsSync(file) || !existsSync(sidecar)) {
      throw new Error(`sealed file ${name} or its sha256 sidecar is absent`);
    }
    const bytes = readFileSync(file);
    if (readFileSync(sidecar, "ascii").trim() !== sha256(bytes)) {
      throw new Error(`sealed file ${name} no longer matches its sha256 sidecar`);
    }
    return bytes;
  };
  const manifestBytes = verified("manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    manifest_version?: unknown;
    synthetic?: unknown;
    files: Record<string, string>;
    labels: Record<string, string>;
  };
  if (manifest.manifest_version !== 2) throw new Error("sealed manifest is not version 2: seal the run directory again");
  // A real-mode matrix must never be built from a synthetic seal (or one that does not say).
  if (manifest.synthetic !== false) throw new Error("sealed manifest is not a real capture (synthetic is not false)");
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as Contract;
  const slices: Record<string, Row[]> = {};
  for (const spec of Object.values(contract.files)) {
    const name = `${spec.slice}.json`;
    if (!(spec.slice in manifest.files)) throw new Error(`sealed manifest does not list slice ${spec.slice}`);
    const bytes = verified(name);
    if (sha256(bytes) !== manifest.files[spec.slice]) {
      throw new Error(`sealed slice ${spec.slice} disagrees with the manifest`);
    }
    slices[spec.slice] = (JSON.parse(bytes.toString("utf8")) as { rows: Row[] }).rows;
  }
  // Labels travel inside the SEALED manifest (a label cannot be edited after sealing).
  if (!manifest.labels || typeof manifest.labels !== "object") throw new Error("sealed manifest carries no labels");
  return { mode: "real", manifestSha256: sha256(manifestBytes), labels: manifest.labels, slices };
}

// ---------------------------------------------------------------------------------------
// Cell building
// ---------------------------------------------------------------------------------------

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const numOf = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : fin(Number(v)));
const dayOf = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function shown(s: FigureState): ShownState {
  return s === "full" ? "shown" : s === "null" ? null : s;
}

const ddState = (v: number | null): ShownState => (v === null ? null : "shown");

const NO_FIGURES: Cell["figures"] = {
  cumulative_return: null,
  last_return_date: null,
  cagr: null,
  sharpe: null,
  max_drawdown: null,
};

function cell(surface: string, visibility: Visibility, over: Partial<Cell>): Cell {
  return {
    surface,
    symbol: symbolOf(surface),
    visibility,
    state: "value",
    same_as: null,
    reason: "",
    figures: { ...NO_FIGURES },
    figure_states: { cagr: null, sharpe: null, max_drawdown: null },
    unit_view: "native",
    ...over,
  };
}

/** A computed figure set: `value` when anything finite came out, else `withheld`. */
function figured(figures: Cell["figures"], states: Cell["figure_states"], reason: string): Pick<Cell, "state" | "reason" | "figures" | "figure_states"> {
  const any = Object.values(figures).some((v) => v !== null);
  return { state: any ? "value" : "withheld", reason: any ? reason : `${reason}:no_figures`, figures, figure_states: states };
}

function fromMetrics(m: ComputedMetrics, state: FigureState): { figures: Cell["figures"]; states: Cell["figure_states"] } {
  const figures = {
    cumulative_return: fin(m.twr),
    last_return_date: dayOf(m.effective_end),
    cagr: fin(m.cagr),
    sharpe: fin(m.sharpe),
    max_drawdown: fin(m.max_drawdown),
  };
  return { figures, states: { cagr: shown(state), sharpe: shown(state), max_drawdown: ddState(figures.max_drawdown) } };
}

const byDate = (a: DailyPoint, b: DailyPoint) => a.date.localeCompare(b.date);

function errorCell(surface: string, visibility: Visibility, err: unknown, unit_view: Cell["unit_view"] = "native"): Cell {
  return cell(surface, visibility, {
    state: "error",
    reason: err instanceof Error ? err.constructor.name : "NonError",
    unit_view,
  });
}

async function guarded(surface: string, visibility: Visibility, unit_view: Cell["unit_view"], f: () => Promise<Partial<Cell>> | Partial<Cell>): Promise<Cell> {
  try {
    return cell(surface, visibility, { unit_view, ...(await f()) });
  } catch (err) {
    return errorCell(surface, visibility, err, unit_view);
  }
}

/** Run `f` with the fake tables set to ONE account's rows (the capture's other accounts are not served). */
async function withAccount<T>(capture: CaptureData, ordinal: string, f: () => Promise<T>): Promise<T> {
  const mine = (slice: string): Row[] =>
    (capture.slices[slice] ?? []).filter((r) => r.key_ordinal === ordinal).map(({ key_ordinal: _k, ...rest }) => rest);
  fake.tables = {
    strategies: mine("strategy"),
    strategy_analytics: mine("analytics"),
    strategy_analytics_series: mine("series"),
    api_key_nav_marks: mine("marks"),
    allocator_equity_derived: [...mine("key_inputs"), ...mine("equity_curve")],
    csv_daily_returns: mine("returns"),
    allocator_holdings: mine("holdings"),
    benchmark_prices: mine("btc"),
    api_keys: mine("keymap").map((k) => ({ ...k, id: k.api_key_id })),
  };
  fake.seen = new Set();
  try {
    return await f();
  } finally {
    fake.tables = {};
  }
}

function ordinalNumber(o: string): number {
  return Number(o.replace(/\D/g, ""));
}

async function buildAccount(capture: CaptureData, ordinal: string): Promise<AccountMatrix> {
  const label = capture.labels[ordinal];
  const rowsOf = (slice: string): Row[] => (capture.slices[slice] ?? []).filter((r) => r.key_ordinal === ordinal);
  const keymap = rowsOf("keymap")[0] ?? null;
  // The rule of analytics-service `_analytics_row`: the key's ONE non-archived strategy, then THAT strategy's
  // analytics row. The slices are ordered by different SQL keys and neither filters `archived`, so position
  // would load the factsheet for one strategy and the other surfaces from another's analytics.
  const live = new Set<string>();
  for (const r of rowsOf("strategy")) if (r.status !== "archived" && r.id != null) live.add(String(r.id));
  for (const r of rowsOf("keymap")) if (r.strategy_status !== "archived" && r.strategy_id != null) live.add(String(r.strategy_id));
  if (live.size !== 1) throw new Error(`surface matrix: ${ordinal} has ${live.size} non-archived strategies, expected exactly one`);
  const strategyId = [...live][0];
  const strategy = rowsOf("strategy").find((r) => String(r.id) === strategyId) ?? null;
  const analyticsRows = rowsOf("analytics").filter((r) => String(r.strategy_id) === strategyId);
  if (analyticsRows.length > 1) throw new Error(`surface matrix: ${ordinal} has ${analyticsRows.length} analytics rows for its live strategy`);
  const analytics = analyticsRows[0] ?? null;
  const ownerId = String(strategy?.user_id ?? "");
  const status = typeof strategy?.status === "string" ? strategy.status : typeof keymap?.strategy_status === "string" ? keymap.strategy_status : null;
  const assetClass = (typeof strategy?.asset_class === "string" ? strategy.asset_class : typeof keymap?.asset_class === "string" ? keymap.asset_class : null) as string | null;
  const dqf = (analytics?.data_quality_flags ?? null) as Record<string, unknown> | null;
  const nativeUnit = parseReturnsUnit(dqf?.native_unit);
  const published = status === "published";
  const publishedOnly: Visibility = published ? "owner_visible" : "not_rendered_while_unpublished";

  // Per-key csv_daily_returns, grouped by api_key_id (the unit the book and the composer blend).
  // Strategy-linked rows (null api_key_id, the live strategy's id) are a DIFFERENT store: they never join the
  // per-key groups the book and the composer blend (a "null" group would enter the builder as a weight-0 unit).
  const perKey: Record<string, DailyPoint[]> = {};
  const strategyLinked: DailyPoint[] = [];
  for (const r of rowsOf("returns")) {
    const v = numOf(r.daily_return);
    const d = dayOf(r.date);
    if (v === null || d === null) continue;
    if (r.api_key_id === null || r.api_key_id === undefined) {
      if (String(r.strategy_id) === strategyId) strategyLinked.push({ date: d, value: v });
      continue;
    }
    (perKey[String(r.api_key_id)] ??= []).push({ date: d, value: v });
  }
  for (const pts of Object.values(perKey)) pts.sort(byDate);

  const holdings = rowsOf("holdings").map((h) => ({
    symbol: String(h.symbol),
    quantity: Number(h.quantity),
    mark_price_usd: numOf(h.mark_price),
    value_usd: Number(h.value_usd),
    venue: String(h.venue),
    holding_type: h.holding_type as "spot" | "derivative",
    api_key_id: String(h.api_key_id),
    side: (h.side ?? null) as "long" | "short" | "flat" | null,
    entry_price: numOf(h.entry_price),
    unrealized_pnl_usd: numOf(h.unrealized_pnl_usd),
    quantity_unit: (h.quantity_unit ?? null) as string | null,
  }));
  const equityByKey: Record<string, number> = {};
  for (const h of holdings) equityByKey[h.api_key_id] = (equityByKey[h.api_key_id] ?? 0) + (holdingEquityContribution(h) ?? 0);
  const labelById = new Map(Object.keys(perKey).map((id) => [id, label] as const));

  const method = curveMethodFromFlags(dqf);
  const strategySeries = resolveDailyReturnSeries(analytics?.daily_returns, analytics?.returns_series, method);
  const scalars = analytics ? project(analytics, RECORD_SCALAR_ALIASES) : null;
  const record = recordFromScalars(scalars, assetClass);
  const recordState = gateAnnualized(record);

  const ownerVisibility: StrategyVisibility = <Q,>(q: Q): Q => withPublishedOrOwner(q, ownerId);

  const cells = await withAccount(capture, ordinal, async () => {
    const out: Cell[] = [];

    // factsheet: the owner lane (published OR own), the real loader end to end.
    out.push(
      await guarded("factsheet", "owner_visible", "native", async () => {
        const result = await fetchAndBuildPayloadWithReason(strategyId, ownerVisibility);
        if (result.payload === null) return { state: "error", reason: result.reason };
        const p = result.payload;
        const m = p.strategyMetrics;
        const state = p.figureRecord ? gateAnnualized(p.figureRecord) : ("null" as FigureState);
        const figures = {
          cumulative_return: fin(m.cum_ret),
          last_return_date: dayOf(m.end) ?? dayOf(p.dates[p.dates.length - 1]),
          cagr: fin(m.cagr),
          sharpe: fin(m.sharpe),
          max_drawdown: fin(m.max_dd),
        };
        return figured(figures, { cagr: shown(state), sharpe: shown(state), max_drawdown: ddState(figures.max_drawdown) }, "payload");
      }),
    );

    // share_card: the OG route's own call, behind the route's own computed-and-two-points guard.
    out.push(
      await guarded("share_card", publishedOnly, "native", () => {
        if (!isComputedAnalytics(typeof analytics?.computation_status === "string" ? analytics.computation_status : null) || strategySeries.length < 2) {
          return { state: "withheld", reason: "not_computed_or_short" };
        }
        const h = computeOgHeadline(strategySeries, assetClass, analytics);
        const figures = { ...NO_FIGURES, cagr: fin(h.cagr), sharpe: fin(h.sharpe), max_drawdown: fin(h.maxDd) };
        return figured(figures, { cagr: shown(recordState), sharpe: shown(recordState), max_drawdown: ddState(figures.max_drawdown) }, "og_headline");
      }),
    );

    // factsheet_pdf: the PDF routes screenshot the factsheet page; no separate computation exists.
    out.push(cell("factsheet_pdf", publishedOnly, { state: "same_as", same_as: "factsheet", reason: "same_payload" }));

    // allocations strategies panel: the session loader (own-capital filter) then the row adapter.
    out.push(
      await guarded("allocations_strategies_panel", "owner_visible", "native", async () => {
        const own = await getOwnCapitalStrategies(ownerId);
        if (own === null) return { state: "error", reason: "read_error" };
        if (!own.some((s) => s.id === strategyId)) return { state: "not_applicable", reason: "not_own_capital" };
        const row = toStrategyRows({ strategies: own, positions: [], now: new Date("2026-01-01T00:00:00Z") }).find((r) => r.id === strategyId);
        if (!row) return { state: "not_applicable", reason: "not_own_capital" };
        const figures = { ...NO_FIGURES, sharpe: fin(row.sharpe), max_drawdown: fin(row.maxDd) };
        return figured(figures, { cagr: null, sharpe: shown(row.sharpeState), max_drawdown: ddState(figures.max_drawdown) }, "strategy_row");
      }),
    );

    // allocations live baseline: per-key csv_daily_returns blended by holdings equity, then the book figures.
    out.push(
      await guarded("allocations_live_baseline", "owner_visible", "native", () => {
        if (holdings.length === 0) return { state: "not_applicable", reason: "key_not_in_book" };
        const baseline = liveBaselineMetricsFromPerKeyDailies(holdings, perKey);
        const book = liveBookFigures(baseline);
        const figures = { cumulative_return: fin(book.ytdTwr), last_return_date: book.seriesEndDay, cagr: null, sharpe: fin(book.sharpe), max_drawdown: fin(book.maxDd) };
        return figured(figures, { cagr: null, sharpe: shown(book.sharpeState), max_drawdown: ddState(figures.max_drawdown) }, "book_figures");
      }),
    );

    // scenario composer, the live-book column: the per-key unit set the composer builds, on the engine.
    out.push(
      await guarded("scenario_composer_book", "owner_visible", "native", () => {
        if (holdings.length === 0) return { state: "not_applicable", reason: "key_not_in_book" };
        const set = buildPerKeyStrategyForBuilderSet(perKey, equityByKey, labelById);
        if (set.strategies.length === 0) return { state: "withheld", reason: "no_per_key_series" };
        const basis = blendPeriodsPerYear(set.strategies);
        const m = computeScenario(set.strategies, set.state, buildDateMapCache(set.strategies), basis);
        const curve = m.equity_curve;
        const bookState = gateAnnualized(
          figureRecord({ seriesStart: curve[0]?.date ?? null, seriesEnd: curve[curve.length - 1]?.date ?? null, observations: Math.max(curve.length - 1, 0), periodsPerYear: basis }),
        );
        const r = fromMetrics(m, bookState);
        return figured(r.figures, r.states, "book_engine");
      }),
    );

    // scenario composer, the returns route: its core steps (not the request handler), then the engine.
    out.push(
      await guarded("scenario_composer_route", "owner_visible", nativeUnit !== null ? "usd" : "native", async () => {
        const rankable = isRankableAnalyticsRow({ computation_status: typeof analytics?.computation_status === "string" ? analytics.computation_status : null });
        let series: DailyPoint[] = rankable ? strategySeries : [];
        if (nativeUnit !== null && series.length > 0) {
          series = convertNativeReturnsToUsd(
            resolveDailyReturnSeries(analytics?.daily_returns, analytics?.returns_series, method, true),
            nativeUnit,
            await readBtcCloses(makeClient() as never),
          );
        }
        if (series.length === 0) return { state: "withheld", reason: "route_core_steps:empty_series" };
        const unit: StrategyForBuilder = {
          id: strategyId,
          name: label,
          codename: null,
          disclosure_tier: "exploratory",
          strategy_types: [],
          markets: [],
          start_date: series[0].date,
          daily_returns: series,
          cagr: null,
          sharpe: null,
          volatility: null,
          max_drawdown: null,
          asset_class: assetClass,
        };
        const m = computeScenario(
          [unit],
          { selected: { [strategyId]: true }, weights: { [strategyId]: 1 }, startDates: { [strategyId]: series[0].date } },
          buildDateMapCache([unit]),
          blendPeriodsPerYear([unit]),
        );
        const r = fromMetrics(m, recordState);
        return figured(r.figures, r.states, "route_core_steps");
      }),
    );

    // owner list card and Discovery card: the same row shaping; `gatedMetric` rebuilt from exported pieces.
    const listCard = (surface: "owner_list_card" | "discovery_card", visibility: Visibility) =>
      guarded(surface, visibility, "native", () => {
        const shaped = shapeRowAnalytics(analytics as unknown as StrategyAnalytics | null, strategyId);
        const gate = gateAnnualized(rowRecord({ asset_class: assetClass as never, analytics: shaped }));
        const figures = {
          cumulative_return: fin(shaped.cumulative_return),
          last_return_date: dayOf(shaped.series_end),
          cagr: fin(gatedValue(shaped.cagr, gate)),
          sharpe: fin(gatedValue(shaped.sharpe, gate)),
          max_drawdown: fin(shaped.max_drawdown),
        };
        return figured(figures, { cagr: shown(gate), sharpe: shown(gate), max_drawdown: ddState(figures.max_drawdown) }, "row_shaping");
      });
    out.push(await listCard("owner_list_card", "owner_visible"));
    out.push(await listCard("discovery_card", publishedOnly));
    return out;
  });

  // cross_store: the strategy_analytics series against the per-key csv_daily_returns and, when the key has any,
  // the strategy-linked csv_daily_returns, day for day, exact equality. A day missing from a store, or valued
  // differently in it, is a difference: the stores are never merged into one map.
  const csv = new Map<string, number>();
  for (const pts of Object.values(perKey)) for (const p of pts) csv.set(p.date, p.value);
  const linked = new Map(strategyLinked.map((p) => [p.date, p.value] as const));
  const stored = new Map(strategySeries.map((p) => [p.date, p.value] as const));
  const compared = linked.size > 0 ? [stored, csv, linked] : [stored, csv];
  const days = [...new Set(compared.flatMap((m) => [...m.keys()]))].sort();
  const differing = days.filter((d) => !compared.every((m) => m.has(d) && m.get(d) === stored.get(d)));

  return {
    key_ordinal: ordinal,
    label,
    unit: String(keymap?.account_currency ?? "unknown"),
    strategy_status: status,
    computed_at: dayOf(analytics?.computed_at),
    cells,
    cross_store: { days_compared: days.length, days_differing: differing.length, first_differing_day: differing[0] ?? null },
  };
}

async function buildMatrix(capture: CaptureData): Promise<Matrix> {
  const quiet = [vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
  quiet.forEach((s) => s.mockImplementation(() => undefined));
  try {
    const ordinals = Object.keys(capture.labels)
      .filter((o) => capture.labels[o] !== EXCLUDED_LABEL)
      .sort((a, b) => ordinalNumber(a) - ordinalNumber(b));
    const accounts: AccountMatrix[] = [];
    for (const o of ordinals) accounts.push(await buildAccount(capture, o));
    return {
      matrix_version: 1,
      mode: capture.mode,
      ...(capture.manifestSha256 !== undefined ? { capture_manifest_sha256: capture.manifestSha256 } : {}),
      accounts,
    };
  } finally {
    quiet.forEach((s) => s.mockRestore());
  }
}

function writeMatrix(matrix: Matrix, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "surface-matrix.json");
  writeFileSync(path, JSON.stringify(matrix, null, 2));
  return path;
}

// ---------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------

const BUNDLE_BYTES = readFileSync(BUNDLE_PATH);
const syntheticCapture = () => loadSyntheticFromBytes(Buffer.from(BUNDLE_BYTES));
const accountA = (m: Matrix): AccountMatrix => m.accounts.find((a) => a.label === "SYN-A")!;
const cellOf = (a: AccountMatrix, surface: string): Cell => a.cells.find((c) => c.surface === surface)!;

describe("MT5-09 surface matrix: synthetic capture", () => {
  it("CONTROL: the harness builds the real factsheet and yields 9 cells for SYN-A", async () => {
    const capture = syntheticCapture();
    const ordinal = Object.keys(capture.labels).find((o) => capture.labels[o] === "SYN-A")!;
    const strategy = capture.slices.strategy.find((r) => r.key_ordinal === ordinal)!;
    // The loader's own result, not the matrix's cell: a harness that builds nothing cannot pass this.
    const result = await withAccount(capture, ordinal, async () => {
      const spies = [vi.spyOn(console, "info"), vi.spyOn(console, "warn")];
      spies.forEach((s) => s.mockImplementation(() => undefined));
      try {
        return await fetchAndBuildPayloadWithReason(String(strategy.id), <Q,>(q: Q): Q => withPublishedOrOwner(q, String(strategy.user_id)));
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
    expect(result.payload, `the synthetic factsheet must build (reason ${result.reason})`).not.toBeNull();

    const matrix = await buildMatrix(capture);
    const a = accountA(matrix);
    expect(a.cells).toHaveLength(SURFACES.length);
    expect(a.cells.map((c) => c.surface)).toEqual(SURFACES.map((s) => s.id));
    expect(cellOf(a, "factsheet").state).toBe("value");
    // The matrix lands on disk in a temp dir (synthetic mode never writes into a capture dir).
    const written = writeMatrix(matrix, mkdtempSync(join(tmpdir(), "mt5p-matrix-")));
    expect((JSON.parse(readFileSync(written, "utf8")) as Matrix).matrix_version).toBe(1);
  });

  it("every cell has one of the five states and the visibility the captured status dictates; the excluded ordinal is absent", async () => {
    const capture = syntheticCapture();
    const matrix = await buildMatrix(capture);
    const excluded = Object.keys(capture.labels).filter((o) => capture.labels[o] === EXCLUDED_LABEL);
    expect(excluded.length).toBeGreaterThan(0);
    for (const o of excluded) expect(matrix.accounts.map((x) => x.key_ordinal)).not.toContain(o);

    const a = accountA(matrix);
    const statusInBundle = capture.slices.strategy.find((r) => r.key_ordinal === a.key_ordinal)!.status;
    expect(a.strategy_status).toBe(statusInBundle);
    const publishedOnly = new Set(["share_card", "factsheet_pdf", "discovery_card"]);
    for (const c of a.cells) {
      expect(["value", "withheld", "not_applicable", "same_as", "error"]).toContain(c.state);
      const expected = statusInBundle !== "published" && publishedOnly.has(c.surface) ? "not_rendered_while_unpublished" : "owner_visible";
      expect(c.visibility, c.surface).toBe(expected);
      expect(c.state, `${c.surface} (${c.reason})`).not.toBe("error");
    }
  });

  it("cross_store counts every day of the analytics series and finds the two stores equal", async () => {
    const capture = syntheticCapture();
    const a = accountA(await buildMatrix(capture));
    const analytics = capture.slices.analytics.find((r) => r.key_ordinal === a.key_ordinal)!;
    const stored = (analytics.daily_returns as unknown[]).length;
    expect(a.cross_store.days_compared).toBe(stored);
    expect(a.cross_store.days_differing).toBe(0);
    expect(a.cross_store.first_differing_day).toBeNull();
  });

  it("a record under the annualization gate withholds CAGR and Sharpe on every value cell", async () => {
    const capture = syntheticCapture();
    const a = accountA(await buildMatrix(capture));
    const analytics = capture.slices.analytics.find((r) => r.key_ordinal === a.key_ordinal)!;
    const series = analytics.returns_series as { date: string }[];
    const spanDays = Math.round((Date.parse(series[series.length - 1].date) - Date.parse(series[0].date)) / 86_400_000) + 1;
    // Derived from the gate's own constants: the synthetic record is under both thresholds.
    expect(spanDays).toBeLessThan(MIN_ANNUALIZATION_DAYS);
    expect(series.length - 1).toBeLessThan(MIN_ANNUALIZATION_OBS);
    const valueCells = a.cells.filter((c) => c.state === "value");
    expect(valueCells.length).toBeGreaterThan(0);
    for (const c of valueCells) {
      expect(["withheld", null], `${c.surface} cagr`).toContain(c.figure_states.cagr);
      expect(["withheld", null], `${c.surface} sharpe`).toContain(c.figure_states.sharpe);
    }
  });

  it("the allocations strategies panel reads a value through the real own-capital loader when the strategy is own capital", async () => {
    // The synthetic strategy is not own-capital (the cell above is not_applicable); flipping that one captured
    // column proves the toStrategyRows path executes and gates its Sharpe, rather than only ever being skipped.
    const parsed = JSON.parse(BUNDLE_BYTES.toString("utf8")) as { raw: Record<string, { slice_rows: Row[] }[]> };
    parsed.raw["capture-strategy.json"][0].slice_rows[0].capital_ownership = "own_capital";
    const a = accountA(await buildMatrix(loadSyntheticFromBytes(Buffer.from(JSON.stringify(parsed), "utf8"))));
    const panel = cellOf(a, "allocations_strategies_panel");
    expect(panel.state, panel.reason).toBe("value");
    expect(panel.figure_states.sharpe).toBe("withheld");
    expect(panel.figures.sharpe).toBeNull();
    expect(panel.figures.max_drawdown).toBe(cellOf(a, "factsheet").figures.max_drawdown);
  });

  it("WR-04: an archived strategy sorted ahead of the live one changes nothing: the live strategy and ITS analytics row are used", async () => {
    const baseline = accountA(await buildMatrix(syntheticCapture()));
    const parsed = JSON.parse(BUNDLE_BYTES.toString("utf8")) as {
      raw: Record<string, { key_ordinal: string; slice_rows: Row[] }[]>;
      labels: Record<string, string>;
    };
    const ordinal = Object.keys(parsed.labels).find((o) => parsed.labels[o] === "SYN-A")!;
    const strategyRows = parsed.raw["capture-strategy.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows;
    const analyticsRows = parsed.raw["capture-analytics.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows;
    const archivedId = "00000000-0000-4000-8000-0000000000c9";
    // Position 0 in both slices is the archived impostor, carrying a different status and a different computed_at.
    strategyRows.unshift({ ...strategyRows[0], id: archivedId, status: "archived" });
    analyticsRows.unshift({ ...analyticsRows[0], id: archivedId, strategy_id: archivedId, computed_at: "1999-01-01T00:00:00Z" });
    const a = accountA(await buildMatrix(loadSyntheticFromBytes(Buffer.from(JSON.stringify(parsed), "utf8"))));
    expect(a.strategy_status).toBe(baseline.strategy_status);
    expect(a.computed_at).toBe(baseline.computed_at);
    expect(a.cells).toEqual(baseline.cells);
  });

  it("WR-04: a key with two non-archived strategies, or none, is refused loudly, never read by position", async () => {
    const mutate = (f: (rows: Row[]) => void, archiveKeymap = false) => {
      const parsed = JSON.parse(BUNDLE_BYTES.toString("utf8")) as {
        raw: Record<string, { key_ordinal: string; slice_rows: Row[] }[]>;
        labels: Record<string, string>;
      };
      const ordinal = Object.keys(parsed.labels).find((o) => parsed.labels[o] === "SYN-A")!;
      f(parsed.raw["capture-strategy.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows);
      // The key map names the strategy too (the rule reads both); archive it there for the none-live case.
      if (archiveKeymap) {
        for (const k of parsed.raw["capture-keymap.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows) k.strategy_status = "archived";
      }
      return buildMatrix(loadSyntheticFromBytes(Buffer.from(JSON.stringify(parsed), "utf8")));
    };
    await expect(mutate((rows) => rows.push({ ...rows[0], id: "00000000-0000-4000-8000-0000000000c8" }))).rejects.toThrow(/2 non-archived strategies/);
    await expect(mutate((rows) => rows.forEach((r) => (r.status = "archived")), true)).rejects.toThrow(/0 non-archived strategies/);
  });

  it("WR-05: strategy-linked csv_daily_returns rows stay out of the per-key surfaces and cross_store compares them as their own store", async () => {
    const baseline = accountA(await buildMatrix(syntheticCapture()));
    // The strategy-linked store is a full copy of the per-key rows, so only the one planted difference can show.
    const withLinked = async (plant: (copy: Row[]) => string) => {
      const parsed = JSON.parse(BUNDLE_BYTES.toString("utf8")) as {
        raw: Record<string, { key_ordinal: string; slice_rows: Row[] }[]>;
        labels: Record<string, string>;
      };
      const ordinal = Object.keys(parsed.labels).find((o) => parsed.labels[o] === "SYN-A")!;
      const strategyId = parsed.raw["capture-strategy.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows[0].id;
      const rows = parsed.raw["capture-returns.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows;
      const copy = rows.map((r) => ({ ...r, api_key_id: null, strategy_id: strategyId }));
      const day = plant(copy);
      // BEFORE the per-key rows, so a last-write-wins merge would let a per-key row hide the planted difference.
      rows.unshift(...copy);
      return { day, a: accountA(await buildMatrix(loadSyntheticFromBytes(Buffer.from(JSON.stringify(parsed), "utf8")))) };
    };

    // Same day as a per-key row, a different value: a difference the per-key row must not overwrite.
    const sameDay = await withLinked((copy) => {
      copy[0].daily_return = 0.123;
      return String(copy[0].date);
    });
    expect(sameDay.a.cross_store.days_differing).toBe(1);
    expect(sameDay.a.cross_store.first_differing_day).toBe(sameDay.day);
    expect(sameDay.a.cross_store.days_compared).toBe(baseline.cross_store.days_compared);
    // The per-key surfaces are exactly what they were: the strategy-linked row is not a unit in the book.
    expect(cellOf(sameDay.a, "allocations_live_baseline")).toEqual(cellOf(baseline, "allocations_live_baseline"));
    expect(cellOf(sameDay.a, "scenario_composer_book")).toEqual(cellOf(baseline, "scenario_composer_book"));

    // A day only the strategy-linked store has is a difference too.
    const extraDay = await withLinked((copy) => {
      copy.push({ ...copy[0], date: "2030-01-01", daily_return: 0.01 });
      return "2030-01-01";
    });
    expect(extraDay.a.cross_store.days_differing).toBe(1);
    expect(extraDay.a.cross_store.first_differing_day).toBe(extraDay.day);
    expect(extraDay.a.cross_store.days_compared).toBe(baseline.cross_store.days_compared + 1);
  });

  it("is deterministic: the same bundle gives deep-equal matrices", async () => {
    const first = await buildMatrix(syntheticCapture());
    const second = await buildMatrix(syntheticCapture());
    expect(second).toEqual(first);
  });

  it("NEUTER: one per-key csv_daily_returns day moved changes exactly the per-key surfaces and cross_store; a byte restore matches the original", async () => {
    const backup = Buffer.from(BUNDLE_BYTES);
    const backupSha = sha256(backup);
    const original = await buildMatrix(loadSyntheticFromBytes(backup));

    // Neutered copy, built from the backup's bytes: one per-key daily_return moved by +0.5.
    const parsed = JSON.parse(backup.toString("utf8")) as {
      raw: Record<string, { key_ordinal: string; slice_rows: Row[] }[]>;
      labels: Record<string, string>;
    };
    const ordinal = Object.keys(parsed.labels).find((o) => parsed.labels[o] === "SYN-A")!;
    const returnsRows = parsed.raw["capture-returns.json"].find((w) => w.key_ordinal === ordinal)!.slice_rows;
    returnsRows[0].daily_return = (returnsRows[0].daily_return as number) + 0.5;
    const neutered = await buildMatrix(loadSyntheticFromBytes(Buffer.from(JSON.stringify(parsed), "utf8")));

    const before = accountA(original);
    const after = accountA(neutered);
    expect(after.cross_store.days_differing).toBe(1);
    expect(after.cross_store.first_differing_day).toBe(returnsRows[0].date);

    const changed = before.cells.filter((c) => JSON.stringify(c) !== JSON.stringify(cellOf(after, c.surface))).map((c) => c.surface);
    // The per-key surfaces move; every strategy-series surface is unchanged.
    expect(changed.sort()).toEqual(["allocations_live_baseline", "scenario_composer_book"]);
    for (const surface of ["factsheet", "share_card", "owner_list_card", "scenario_composer_route"]) {
      expect(cellOf(after, surface)).toEqual(cellOf(before, surface));
    }
    expect(cellOf(after, "allocations_live_baseline").figures.cumulative_return).not.toBe(cellOf(before, "allocations_live_baseline").figures.cumulative_return);
    expect(cellOf(after, "scenario_composer_book").figures.cumulative_return).not.toBe(cellOf(before, "scenario_composer_book").figures.cumulative_return);

    // Restore from the byte backup, never git: same bytes, same matrix.
    const restored = Buffer.from(backup);
    expect(sha256(restored)).toBe(backupSha);
    expect(await buildMatrix(loadSyntheticFromBytes(restored))).toEqual(original);
  });
});

describe("WR-06: a real-mode matrix names the sealed capture it was built from", () => {
  /**
   * A sealed dir holding a COMPLETE manifest (every contract slice present and empty) with the given
   * labels, each file with its sha256 sidecar. `omit` drops one slice from the manifest; `version` overrides it.
   */
  function sealedDir(
    labels: Record<string, string>,
    opts: { omit?: string; version?: number; synthetic?: unknown } = {},
  ): { dir: string; bytes: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), "mt5p-sealed-"));
    mkdirSync(join(dir, "sealed"));
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as Contract;
    const files: Record<string, string> = {};
    for (const spec of Object.values(contract.files)) {
      const body = Buffer.from(JSON.stringify({ slice: spec.slice, table: spec.table, rows: [], witness: [] }), "utf8");
      writeFileSync(join(dir, "sealed", `${spec.slice}.json`), body);
      writeFileSync(join(dir, "sealed", `${spec.slice}.json.sha256`), sha256(body));
      if (spec.slice !== opts.omit) files[spec.slice] = sha256(body);
    }
    const manifest = { manifest_version: opts.version ?? 2, synthetic: "synthetic" in opts ? opts.synthetic : false, files, labels };
    const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
    writeFileSync(join(dir, "sealed", "manifest.json"), bytes);
    writeFileSync(join(dir, "sealed", "manifest.json.sha256"), sha256(bytes));
    return { dir, bytes };
  }

  it("carries the sha256 of the exact manifest bytes, and a different manifest gives a different digest", async () => {
    const one = sealedDir({ k1: EXCLUDED_LABEL });
    const two = sealedDir({ k1: EXCLUDED_LABEL, k2: EXCLUDED_LABEL });
    const m1 = await buildMatrix(loadRealCapture(one.dir));
    const m2 = await buildMatrix(loadRealCapture(two.dir));
    expect(m1.mode).toBe("real");
    expect(m1.capture_manifest_sha256).toBe(sha256(one.bytes));
    expect(m1.capture_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The point of the field: a matrix left over from another capture is told apart by digest alone.
    expect(m2.capture_manifest_sha256).toBe(sha256(two.bytes));
    expect(m2.capture_manifest_sha256).not.toBe(m1.capture_manifest_sha256);
    // And it survives the write to derived/surface-matrix.json.
    const written = writeMatrix(m1, join(one.dir, "derived"));
    expect((JSON.parse(readFileSync(written, "utf8")) as Matrix).capture_manifest_sha256).toBe(sha256(one.bytes));
  });

  it("throws on a slice the manifest does not list, and on a pre-fix manifest version, instead of reading it as empty", () => {
    // Why: an unlisted slice read as [] turns a missing holdings file into `not_applicable` observations,
    // so a truncated capture would read as a clean surface matrix.
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as Contract;
    const slice = Object.values(contract.files)[0].slice;
    expect(() => loadRealCapture(sealedDir({ k1: EXCLUDED_LABEL }, { omit: slice }).dir)).toThrow(
      `sealed manifest does not list slice ${slice}`,
    );
    expect(() => loadRealCapture(sealedDir({ k1: EXCLUDED_LABEL }, { version: 1 }).dir)).toThrow(
      /not version 2/,
    );
    expect(() => loadRealCapture(sealedDir({ k1: EXCLUDED_LABEL }).dir)).not.toThrow();
  });

  it("throws on a sealed manifest whose synthetic marker is true or missing, so a synthetic seal never builds a real-mode matrix", () => {
    for (const synthetic of [true, undefined, "false"]) {
      expect(() => loadRealCapture(sealedDir({ k1: EXCLUDED_LABEL }, { synthetic }).dir)).toThrow(
        /not a real capture/,
      );
    }
    expect(() => loadRealCapture(sealedDir({ k1: EXCLUDED_LABEL }, { synthetic: false }).dir)).not.toThrow();
  });

  it("the synthetic matrix carries no digest", async () => {
    expect((await buildMatrix(syntheticCapture())).capture_manifest_sha256).toBeUndefined();
  });
});

// Real mode is registered only when the variable is set. A set variable with a bad directory FAILS (throws),
// it never skips; plan 11 runs this file with the variable set against the sealed capture.
const REAL_DIR = process.env.MT5_PARITY_CAPTURE_DIR;
if (REAL_DIR !== undefined) {
  describe("MT5-09 surface matrix: real capture", () => {
    it("real capture surface matrix", async () => {
      const capture = loadRealCapture(REAL_DIR);
      const matrix = await buildMatrix(capture);
      expect(matrix.accounts.length).toBeGreaterThan(0);
      const path = writeMatrix(matrix, join(REAL_DIR, "derived"));
      expect(existsSync(path)).toBe(true);
    });
  });
}
