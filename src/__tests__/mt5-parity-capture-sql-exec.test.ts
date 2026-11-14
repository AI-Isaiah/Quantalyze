/**
 * Phase 155 PARITYHARNESS plan 04 (PARITY-03, PARITY-04): the MT5 parity census, bind and capture SQL
 * EXECUTED on a throwaway local PostgreSQL cluster, against hand-computed oracles.
 *
 * WHY. `mt5-parity-capture-sql.test.ts` is a static gate: it proves the files cannot write. It cannot
 * tell a census that mis-groups keys, reads the wrong S source, divides the inception identity by the
 * wrong flow, or drops a capture column. Those would all pass every text check and then print a wrong
 * verdict from PROD. Only execution against the real schema turns them red in CI.
 *
 * HOW. Same mechanism as `marksource-okx-nonworking-keys-exec.test.ts`: ask `scripts/pg-lane/run.sh
 * --print-pgbin` for the server binaries and boot a socket-only cluster of this file's own (no TCP
 * listener, trust auth, removed in afterAll). No skip gate: with no binaries beforeAll THROWS.
 * Never TEST, never PROD: the cluster is initdb'd here, its marker is a local string, and this file
 * reads no database URL from the environment.
 *
 * THE SCHEMA IS THE REAL ONE. The ten tables the statements read are cut verbatim out of
 * `supabase/schema/baseline.sql` (CREATE TABLE blocks only, so a column rename or a new NOT NULL
 * column in the baseline breaks this file's seed loudly instead of drifting).
 *
 * THE CLOCK IS FROZEN. census-edges reads `now()`. A `public.now()` earlier in the database's
 * search_path shadows `pg_catalog.now()`, so every date below is absolute and the oracles do not rot
 * with the calendar. A vacuity test proves the shadow is live.
 *
 * ORACLES ARE HAND-COMPUTED from the fixture's values (day spans from `daysBetween`, ratios from plain
 * division of the seeded numbers, the inception identity from arithmetic written out below), never
 * copied from the statement's output. When a statement disagrees with an oracle the SQL file is the
 * thing to fix, never the oracle.
 *
 * ROUNDING. The raw SQL output is unrounded (the 3-significant-figure rendering belongs to the plan 08
 * renderer), so the ratios are compared at 1e-12 and a vacuity test shows they carry more than three
 * significant figures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const DIR = join(REPO, "docs", "runbooks", "mt5-parity");
const BASELINE = join(REPO, "supabase", "schema", "baseline.sql");

const LOCAL_MARKER = "mt5-parity exec gate. Throwaway cluster, not TEST, not PROD.";
const TODAY = "2026-11-16";
const SERVER_LITERAL = "unmeasured (155.1 reading owns it)";

/** The ten tables the statements read, cut from the baseline. */
const TABLES = [
  "strategies",
  "strategy_analytics",
  "strategy_analytics_series",
  "api_keys",
  "api_key_nav_marks",
  "allocator_equity_derived",
  "csv_daily_returns",
  "benchmark_prices",
  "allocator_holdings",
  "strategy_keys",
] as const;

/**
 * census-accounts output columns, in order. This is a pinned copy of the column list that plan 02
 * records under "Artifacts this phase produces": a test must not read `.planning/`, which the ship
 * filter strips from main.
 */
const CENSUS_ACCOUNT_COLUMNS = [
  "key_ordinal", "keys_examined", "account_currency", "native_unit_marked",
  "strategies_linked", "strategy_statuses", "asset_classes", "strategy_key_windows",
  "s_raw_marks", "s_key_inputs", "s_flags", "s_agree", "mark_count", "last_mark_day",
  "first_return_date", "last_return_date", "returns_series_len", "daily_returns_len", "record_observations", "record_span_days",
  "computed_at", "computation_status", "computation_warned", "series_completeness",
  "keys_sharing_login", "key_inputs_present", "first_flow_present",
  "identity_ratio", "identity_days", "identity_flow_days", "flag_keys", "server",
];
const CENSUS_EDGE_COLUMNS = ["key_ordinal", "friday", "mark_present", "open_pnl_ratio", "marked_at", "hours_after_utc_midnight", "rows_examined"];
const BIND_COLUMNS = [
  "key_ordinal", "api_key_id", "analytics_rows", "analytics_max_computed_at", "marks_count", "marks_max_created_at",
  "key_inputs_computed_at", "returns_count", "returns_max_updated_at", "equity_curve_computed_at", "holdings_max_updated_at",
];

type Row = Record<string, unknown>;

/** Whole days from `from` to `to` (both YYYY-MM-DD, UTC). Independent of the statements under test. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `from` to `to` inclusive. */
function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = 0; n <= daysBetween(from, to); n += 1) out.push(addDays(from, n));
  return out;
}

/** UTC Fridays in [from, to], from the calendar and not from the statement. */
function fridays(from: string, to: string): string[] {
  return dayRange(from, to).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const uid = (owner: number, n: number) => `00000000-0000-4000-8000-${String(owner * 100 + n).padStart(12, "0")}`;

/** Strip the trailing semicolon so a statement can sit inside a subquery. */
function asSubquery(sql: string): string {
  return sql.trimEnd().replace(/;\s*$/, "");
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const jb = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

/* ----------------------------------------------------------------------------------------------
 * The fixture. Four api_keys rows, created in this order: k1 (mt5), an okx key, k2 (mt5), k3 (mt5).
 * Every id and value is invented.
 * -------------------------------------------------------------------------------------------- */

const K1 = { key: uid(1, 1), owner: uid(1, 0), strategy: uid(1, 10), created: "2026-09-30T12:00:00Z" };
const OKX = { key: uid(5, 1), owner: uid(5, 0), strategy: uid(5, 10), created: "2026-10-01T12:00:00Z" };
const K2 = { key: uid(2, 1), owner: uid(2, 0), created: "2026-10-02T12:00:00Z" };
const K3 = { key: uid(3, 1), owner: uid(3, 0), created: "2026-10-03T12:00:00Z" };

type Mark = { key: string; owner: string; venue: string; day: string; nav: number; pnl: number };

/** plan 01's ledger marks for k1, plus a truncated, disagreeing pair for k2 and one okx mark. */
const MARKS: Mark[] = [
  { key: K1.key, owner: K1.owner, venue: "mt5", day: "2026-11-02", nav: 11719, pnl: 0 },
  { key: K1.key, owner: K1.owner, venue: "mt5", day: "2026-11-06", nav: 11900, pnl: 120 },
  { key: K1.key, owner: K1.owner, venue: "mt5", day: "2026-11-13", nav: 12150, pnl: 80 },
  { key: K2.key, owner: K2.owner, venue: "mt5", day: "2026-10-28", nav: 11581, pnl: 0 },
  { key: K2.key, owner: K2.owner, venue: "mt5", day: "2026-11-06", nav: 12000, pnl: 60 },
  { key: OKX.key, owner: OKX.owner, venue: "okx", day: "2026-11-06", nav: 777, pnl: 7 },
];

const K1_PNL = [
  { utc_day_iso: "2026-10-01", pnl_usd: 0 },
  { utc_day_iso: "2026-10-05", pnl_usd: -5 },
  { utc_day_iso: "2026-10-07", pnl_usd: 295 },
  { utc_day_iso: "2026-10-12", pnl_usd: 0 },
  { utc_day_iso: "2026-10-15", pnl_usd: 191 },
  { utc_day_iso: "2026-10-20", pnl_usd: 0 },
  { utc_day_iso: "2026-10-26", pnl_usd: 500 },
  { utc_day_iso: "2026-10-27", pnl_usd: -400 },
  { utc_day_iso: "2026-10-30", pnl_usd: 138 },
  { utc_day_iso: "2026-11-06", pnl_usd: 181 },
  { utc_day_iso: "2026-11-13", pnl_usd: 250 },
];
const K1_FLOWS = [
  { utc_day_iso: "2026-10-01", flow_usd: 10000 },
  { utc_day_iso: "2026-10-12", flow_usd: 2000 },
  { utc_day_iso: "2026-10-20", flow_usd: -1000 },
];
const K1_TERMINAL = 12150;
const K1_KEY_INPUTS = {
  realized_terminal_usd: K1_TERMINAL,
  realized_terminal_day: "2026-11-13",
  venue: "mt5",
  marks_since: "2026-11-02",
  composed_day_pnl: K1_PNL,
  composed_flows: K1_FLOWS,
};

const K2_PNL = [
  { utc_day_iso: "2026-10-05", pnl_usd: 500 },
  { utc_day_iso: "2026-10-30", pnl_usd: 570 },
];
const K2_FLOWS = [
  { utc_day_iso: "2026-10-12", flow_usd: 2000 },
  { utc_day_iso: "2026-10-20", flow_usd: -1000 },
];
const K2_TERMINAL = 12070;
const K2_KEY_INPUTS = {
  realized_terminal_usd: K2_TERMINAL,
  venue: "mt5",
  marks_since: "2026-11-02",
  composed_day_pnl: K2_PNL,
  composed_flows: K2_FLOWS,
};

const K1_RETURNS_SERIES = [
  { date: "2026-11-02", value: 1.0 },
  { date: "2026-11-06", value: 1.01 },
  { date: "2026-11-13", value: 1.02 },
];
const K1_FLAGS = { marks_since: "2026-11-02", cumulative_method: "geometric", twr_chain_broken: true };
const K1_ANALYTICS_COMPUTED = "2026-11-14T03:00:00Z";
const K1_EQUITY_COMPUTED = "2026-11-14T04:00:00Z";

/** csv_daily_returns rows: two by api_key_id for k1, one by strategy_id for k1's strategy, one for the okx key. */
const CSV_ROWS = [
  { id: 1, strategy: null as string | null, key: K1.key as string | null, owner: K1.owner as string | null, date: "2026-11-04", ret: 0.01, updated: "2026-11-14T02:00:00Z" },
  { id: 2, strategy: null, key: K1.key, owner: K1.owner, date: "2026-11-06", ret: 0.02, updated: "2026-11-14T02:30:00Z" },
  { id: 3, strategy: K1.strategy, key: null, owner: null, date: "2026-11-10", ret: 0.03, updated: "2026-11-14T02:45:00Z" },
  { id: 4, strategy: null, key: OKX.key, owner: OKX.owner, date: "2026-11-05", ret: 0.04, updated: "2026-11-14T02:50:00Z" },
];

const HOLDINGS = [
  { id: uid(1, 40), asof: "2026-11-06", symbol: "FIXUSD", qty: 2, value: 200 },
  { id: uid(1, 41), asof: "2026-11-13", symbol: "FIXUSD", qty: 3, value: 330 },
];
const HOLDINGS_UPDATED = "2026-11-14T05:00:00Z";
const HOLDING_SECRET = "raw-payload-marker-must-not-leave-the-database";

const BTC_DAYS = dayRange("2026-10-20", "2026-11-15");

function seedSql(): string {
  const out: string[] = [];
  const key = (k: { key: string; owner: string; created: string }, exchange: string, label: string, login: string | null) =>
    `INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, created_at, venue_account_id, account_currency)
     VALUES (${q(k.key)}, ${q(k.owner)}, ${q(exchange)}, ${q(label)}, 'fixture-not-a-credential', ${q(k.created)}, ${login === null ? "NULL" : q(login)}, 'USD');`;
  // Created in this order on purpose: the okx key sits BETWEEN k1 and k2 and must not shift ordinals.
  out.push(key(K1, "mt5", "FIX-1", "L1"));
  out.push(key(OKX, "okx", "FIX-OKX", null));
  out.push(key(K2, "mt5", "FIX-2", "L1"));
  out.push(key(K3, "mt5", "FIX-3", null));

  const strat = (id: string, owner: string, keyId: string, created: string) =>
    `INSERT INTO public.strategies (id, user_id, api_key_id, name, status, asset_class, created_at)
     VALUES (${q(id)}, ${q(owner)}, ${q(keyId)}, 'Fixture strategy', 'draft', 'crypto', ${q(created)});`;
  out.push(strat(K1.strategy, K1.owner, K1.key, "2026-09-30T12:05:00Z"));
  out.push(strat(OKX.strategy, OKX.owner, OKX.key, "2026-10-01T12:05:00Z"));

  out.push(`INSERT INTO public.strategy_keys (id, strategy_id, api_key_id, owner_id, window_start, seq)
            VALUES (${q(uid(1, 50))}, ${q(K1.strategy)}, ${q(K1.key)}, ${q(K1.owner)}, '2026-09-30', 0);`);

  out.push(`INSERT INTO public.strategy_analytics
              (id, strategy_id, computed_at, computation_status, returns_series, daily_returns, metrics_json,
               data_quality_flags, computation_warned, series_completeness)
            VALUES (${q(uid(1, 20))}, ${q(K1.strategy)}, ${q(K1_ANALYTICS_COMPUTED)}, 'complete_with_warnings',
                    ${jb(K1_RETURNS_SERIES)}, NULL, ${jb({ record_observations: 3 })}, ${jb(K1_FLAGS)}, true, 'partial');`);
  out.push(`INSERT INTO public.strategy_analytics_series (strategy_id, kind, payload, computed_at)
            VALUES (${q(K1.strategy)}, 'cumulative', ${jb({ points: 3 })}, ${q(K1_ANALYTICS_COMPUTED)});`);

  MARKS.forEach((m, i) => {
    const markedAt = `${addDays(m.day, 1)}T00:05:00Z`; // the label check: mark_day = marked_at UTC date - 1
    const createdAt = `${addDays(m.day, 1)}T00:10:00Z`;
    out.push(`INSERT INTO public.api_key_nav_marks
                (id, api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd, native_detail, created_at)
              VALUES (${i + 1}, ${q(m.key)}, ${q(m.owner)}, ${q(m.day)}, ${q(markedAt)}, ${q(m.venue)}, ${m.nav}, ${m.pnl},
                      ${jb({ basis: "usd" })}, ${q(createdAt)});`);
  });

  out.push(`INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload, computed_at) VALUES
            (${q(K1.owner)}, ${q(`key_inputs:${K1.key}`)}, ${jb(K1_KEY_INPUTS)}, ${q(K1_ANALYTICS_COMPUTED)}),
            (${q(K2.owner)}, ${q(`key_inputs:${K2.key}`)}, ${jb(K2_KEY_INPUTS)}, ${q("2026-11-14T03:30:00Z")}),
            (${q(K1.owner)}, 'equity_curve', ${jb({ points: 1 })}, ${q(K1_EQUITY_COMPUTED)}),
            (${q(OKX.owner)}, 'equity_curve', ${jb({ points: 9 })}, ${q(K1_EQUITY_COMPUTED)});`);

  for (const r of CSV_ROWS) {
    out.push(`INSERT INTO public.csv_daily_returns (id, strategy_id, api_key_id, allocator_id, date, daily_return, created_at, updated_at)
              VALUES (${r.id}, ${r.strategy ? q(r.strategy) : "NULL"}, ${r.key ? q(r.key) : "NULL"}, ${r.owner ? q(r.owner) : "NULL"},
                      ${q(r.date)}, ${r.ret}, ${q(r.updated)}, ${q(r.updated)});`);
  }

  for (const h of HOLDINGS) {
    out.push(`INSERT INTO public.allocator_holdings
                (id, allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price,
                 raw_payload, created_at, updated_at)
              VALUES (${q(h.id)}, ${q(K1.owner)}, ${q(K1.key)}, 'mt5', ${q(h.symbol)}, ${q(h.asof)}, 'derivative', 'long',
                      ${h.qty}, ${h.value}, 1.1, ${jb({ marker: HOLDING_SECRET })}, ${q(HOLDINGS_UPDATED)}, ${q(HOLDINGS_UPDATED)});`);
  }

  for (const d of BTC_DAYS) {
    out.push(`INSERT INTO public.benchmark_prices (date, symbol, close_price) VALUES (${q(d)}, 'BTC', ${60000 + daysBetween("2026-10-20", d)});`);
    out.push(`INSERT INTO public.benchmark_prices (date, symbol, close_price) VALUES (${q(d)}, 'ETH', 3000);`);
  }
  return out.join("\n");
}

/** The ten CREATE TABLE blocks, verbatim. A miss throws naming the table. */
function extractDdl(): Record<string, string> {
  const baseline = readFileSync(BASELINE, "utf8");
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    const m = new RegExp(`^CREATE TABLE IF NOT EXISTS "public"\\."${t}" \\(\\n[\\s\\S]*?^\\);\\n`, "m").exec(baseline);
    if (!m) throw new Error(`mt5-parity exec gate: CREATE TABLE block for public.${t} not found in supabase/schema/baseline.sql`);
    out[t] = m[0];
  }
  return out;
}

/** Column names of an extracted block: the `"name" type` lines before the first CONSTRAINT line. */
function ddlColumns(block: string): string[] {
  const cols: string[] = [];
  for (const line of block.split("\n").slice(1)) {
    if (/^ {4}CONSTRAINT /.test(line)) break;
    const m = /^ {4}"([a-z_]+)" /.exec(line);
    if (m) cols.push(m[1]);
  }
  return cols;
}

describe("mt5-parity census, bind and capture SQL, EXECUTED on a throwaway cluster over the baseline DDL (Phase 155)", () => {
  let root = "";
  let pgbin = "";
  let started = false;
  const ddl = extractDdl();

  const harnessEnv: Record<string, string | undefined> = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", PGTZ: "UTC" };
  const HARNESS_ENV = harnessEnv as NodeJS.ProcessEnv;

  function pg(tool: string, args: string[]) {
    const res = spawnSync(join(pgbin, tool), args, { encoding: "utf8", env: HARNESS_ENV });
    if (res.status !== 0) throw new Error(`${tool} ${args[0] ?? ""} exited ${res.status}: ${res.stderr || res.stdout}`);
    return res.stdout;
  }

  function psql(sql: string): string {
    const res = spawnSync(
      join(pgbin, "psql"),
      ["-h", root, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q", "-X", "-f", "-"],
      { encoding: "utf8", input: sql, env: HARNESS_ENV },
    );
    if (res.status !== 0) throw new Error(`psql exited ${res.status}: ${res.stderr}`);
    return res.stdout;
  }

  /**
   * Runs one committed statement and returns its rows as objects with the statement's own column
   * order. `prelude` runs first inside a transaction that is ALWAYS rolled back, so a what-if mutation
   * never reaches the shared fixture. The statement itself runs READ ONLY (switched on after the
   * prelude, which may write its what-if rows), so a function that writes from inside a SELECT fails
   * here at the database, not only at the static denylist. The json_agg wrapper lives only in this test.
   */
  function rows(statement: string, prelude = ""): Row[] {
    const wrapped = `SELECT coalesce(json_agg(q), '[]'::json) FROM (${asSubquery(statement)}) q;`;
    const out = psql(`BEGIN;\n${prelude}\nSET TRANSACTION READ ONLY;\n${wrapped}\nROLLBACK;`);
    return JSON.parse(out.trim()) as Row[];
  }

  const file = (name: string) => readFileSync(join(DIR, name), "utf8");
  const stripAll = (r: Row[]) => r.filter((x) => x.key_ordinal !== "all");
  const byOrdinal = (r: Row[]) => Object.fromEntries(r.map((x) => [String(x.key_ordinal), x]));

  beforeAll(() => {
    const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
    if (sel.status !== 0 || sel.stdout.trim() === "") {
      throw new Error(
        "mt5-parity exec gate: no PostgreSQL server binaries. `bash scripts/pg-lane/run.sh --print-pgbin` said:\n" + sel.stderr,
      );
    }
    pgbin = sel.stdout.trim();
    // /tmp, not os.tmpdir(): the socket path must stay under the ~104-byte sun_path limit.
    root = mkdtempSync("/tmp/mt5p-");
    const data = join(root, "pgd");
    pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
    writeFileSync(
      join(data, "postgresql.conf"),
      `${readFileSync(join(data, "postgresql.conf"), "utf8")}\nlisten_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`,
    );
    // Set BEFORE the start: a start that times out can still bring the postmaster up late.
    started = true;
    pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
    psql(
      [
        `CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT TIMESTAMPTZ '${TODAY} 12:00:00+00' $$;`,
        "ALTER DATABASE postgres SET search_path = public, pg_catalog;",
        ...TABLES.map((t) => ddl[t]),
        `COMMENT ON DATABASE postgres IS ${q(LOCAL_MARKER)};`,
      ].join("\n"),
    );
    psql(seedSql());
  }, 90000);

  afterAll(() => {
    if (started) spawnSync(join(pgbin, "pg_ctl"), ["-D", join(root, "pgd"), "-m", "immediate", "-w", "stop"], { env: HARNESS_ENV });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  describe("vacuity guards", () => {
    it("the cluster is the throwaway one, not a real project (local marker)", () => {
      const marker = psql("SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database();").trim();
      expect(marker).toBe(LOCAL_MARKER);
    });

    it("the frozen clock is live: the statements read the fixture's today, not the calendar's", () => {
      expect(psql("SELECT (now() AT TIME ZONE 'UTC')::date;").trim()).toBe(TODAY);
    });

    it("the fixture seeded four api_keys rows, three of them mt5, and the okx key sits between k1 and k2", () => {
      expect(psql("SELECT count(*) FROM public.api_keys;").trim()).toBe("4");
      expect(psql("SELECT count(*) FROM public.api_keys WHERE exchange = 'mt5';").trim()).toBe("3");
      expect(psql("SELECT string_agg(exchange, ',' ORDER BY created_at) FROM public.api_keys;").trim()).toBe("mt5,okx,mt5,mt5");
    });

    it("the DDL under test is the baseline's: every extracted block carries the columns the statements name", () => {
      expect(ddlColumns(ddl.api_keys)).toEqual(expect.arrayContaining(["venue_account_id", "account_currency", "exchange"]));
      expect(ddlColumns(ddl.api_key_nav_marks)).toEqual(expect.arrayContaining(["mark_day", "marked_at", "native_unit", "open_pnl_native"]));
      expect(ddlColumns(ddl.allocator_holdings)).toContain("raw_payload");
    });

    it("the okx key carries data of every kind a leak would show (so its absence below means something)", () => {
      expect(psql(`SELECT count(*) FROM public.api_key_nav_marks WHERE api_key_id = ${q(OKX.key)};`).trim()).toBe("1");
      expect(psql(`SELECT count(*) FROM public.strategies WHERE api_key_id = ${q(OKX.key)};`).trim()).toBe("1");
      expect(psql(`SELECT count(*) FROM public.csv_daily_returns WHERE api_key_id = ${q(OKX.key)};`).trim()).toBe("1");
    });
  });

  describe("census", () => {
    const accounts = () => rows(file("census-accounts.sql"));

    it("prints the plan 02 column list, in order, and nothing else", () => {
      const got = accounts();
      expect(Object.keys(got[0])).toEqual(CENSUS_ACCOUNT_COLUMNS);
      for (const r of got) expect(Object.keys(r)).toEqual(CENSUS_ACCOUNT_COLUMNS);
    });

    it("lists the three mt5 keys in creation order plus the summary row; the okx key appears nowhere", () => {
      const got = accounts();
      expect(got.map((r) => r.key_ordinal)).toEqual(["k1", "k2", "k3", "all"]);
      expect(JSON.stringify(got)).not.toContain("okx");
    });

    it("the summary row counts the mt5 keys and carries NULL in every other column", () => {
      const all = accounts().at(-1) as Row;
      expect(all.keys_examined).toBe(3);
      for (const c of CENSUS_ACCOUNT_COLUMNS) if (c !== "key_ordinal" && c !== "keys_examined") expect(all[c], c).toBeNull();
    });

    it("k1 (complete ledger): S from three sources agrees, the inception identity is 0, and every field matches the fixture", () => {
      const k1 = byOrdinal(accounts()).k1;
      expect(k1.keys_examined).toBeNull();
      expect(k1.account_currency).toBe("USD");
      expect(k1.native_unit_marked).toBe(false);
      expect(k1.strategies_linked).toBe(1);
      expect(k1.strategy_statuses).toEqual(["draft"]);
      expect(k1.asset_classes).toEqual(["crypto"]);
      expect(k1.strategy_key_windows).toBe(1);
      const s = MARKS.filter((m) => m.key === K1.key).map((m) => m.day).sort();
      expect(k1.s_raw_marks).toBe(s[0]);
      expect(k1.s_key_inputs).toBe(K1_KEY_INPUTS.marks_since);
      expect(k1.s_flags).toBe(K1_FLAGS.marks_since);
      expect(k1.s_agree).toBe(true);
      expect(k1.mark_count).toBe(3);
      expect(k1.last_mark_day).toBe(s[s.length - 1]);
      expect(k1.first_return_date).toBe(K1_RETURNS_SERIES[0].date);
      expect(k1.last_return_date).toBe(K1_RETURNS_SERIES.at(-1)?.date);
      expect(k1.returns_series_len).toBe(K1_RETURNS_SERIES.length);
      expect(k1.daily_returns_len).toBeNull();
      expect(k1.record_observations).toBe(3);
      // Whole UTC calendar days from date arithmetic, not from an interval or a timestamp subtraction.
      expect(k1.record_span_days).toBe(daysBetween(K1_RETURNS_SERIES[0].date, K1_RETURNS_SERIES.at(-1)?.date as string));
      expect(Date.parse(String(k1.computed_at))).toBe(Date.parse(K1_ANALYTICS_COMPUTED));
      expect(k1.computation_status).toBe("complete_with_warnings");
      expect(k1.computation_warned).toBe(true);
      expect(k1.series_completeness).toBe("partial");
      expect(k1.keys_sharing_login).toBe(1);
      expect(k1.key_inputs_present).toBe(true);
      expect(k1.first_flow_present).toBe(true);
      expect(k1.identity_days).toBe(K1_PNL.length);
      expect(k1.identity_flow_days).toBe(K1_FLOWS.length);
      // terminal - sum(day pnl) - sum(flows), over the earliest flow, written out from the fixture.
      const expected = (K1_TERMINAL - sum(K1_PNL.map((p) => p.pnl_usd)) - sum(K1_FLOWS.map((f) => f.flow_usd))) / Math.abs(K1_FLOWS[0].flow_usd);
      expect(expected).toBe(0);
      expect(Number(k1.identity_ratio)).toBeCloseTo(expected, 9);
      expect(k1.flag_keys).toEqual(["cumulative_method", "marks_since", "twr_chain_broken"]);
      expect(k1.server).toBe(SERVER_LITERAL);
    });

    it("k2 (ledger truncated, S disagrees): s_agree is false and the identity ratio is 5", () => {
      const k2 = byOrdinal(accounts()).k2;
      expect(k2.s_raw_marks).toBe("2026-10-28");
      expect(k2.s_key_inputs).toBe(K2_KEY_INPUTS.marks_since);
      expect(k2.s_raw_marks).not.toBe(k2.s_key_inputs);
      expect(k2.s_flags).toBeNull();
      expect(k2.s_agree).toBe(false);
      expect(k2.mark_count).toBe(2);
      expect(k2.strategies_linked).toBe(0);
      expect(k2.strategy_statuses).toEqual([]);
      expect(k2.flag_keys).toBeNull();
      expect(k2.keys_sharing_login).toBe(1);
      expect(k2.key_inputs_present).toBe(true);
      expect(k2.identity_days).toBe(2);
      expect(k2.identity_flow_days).toBe(2);
      // Hand arithmetic: terminal 12070, day pnl 500 + 570, flows 2000 - 1000, earliest flow 2000.
      expect(Number(k2.identity_ratio)).toBeCloseTo((12070 - (500 + 570) - (2000 - 1000)) / 2000, 9);
      expect(Number(k2.identity_ratio)).toBeCloseTo(5, 9);
      // The fixture's own arrays agree with the arithmetic above.
      expect(K2_TERMINAL - sum(K2_PNL.map((p) => p.pnl_usd)) - sum(K2_FLOWS.map((f) => f.flow_usd))).toBe(10000);
    });

    it("k3 (no marks, no key_inputs, no strategy): present with mark_count 0 and NULL S columns", () => {
      const k3 = byOrdinal(accounts()).k3;
      expect(k3.mark_count).toBe(0);
      expect(k3.key_inputs_present).toBe(false);
      expect(k3.first_flow_present).toBe(false);
      expect(k3.s_raw_marks).toBeNull();
      expect(k3.s_key_inputs).toBeNull();
      expect(k3.s_flags).toBeNull();
      expect(k3.s_agree).toBe(false);
      expect(k3.last_mark_day).toBeNull();
      expect(k3.identity_ratio).toBeNull();
      expect(k3.keys_sharing_login).toBe(0);
      expect(k3.strategies_linked).toBe(0);
    });

    it("every per-key row carries the server literal verbatim", () => {
      for (const r of stripAll(accounts())) expect(r.server).toBe(SERVER_LITERAL);
    });

    it("the identity ratio responds to its inputs: dropping k1's first deposit turns 0 into 5 (what-if, rolled back)", () => {
      const k1 = byOrdinal(rows(file("census-accounts.sql"), `
        UPDATE public.allocator_equity_derived
           SET payload = jsonb_set(payload, '{composed_flows}', ${jb(K1_FLOWS.slice(1))})
         WHERE kind = ${q(`key_inputs:${K1.key}`)};`)).k1;
      // Without the 10000 deposit: (12150 - 1150 - (2000 - 1000)) / |2000| = 5.
      expect(Number(k1.identity_ratio)).toBeCloseTo((K1_TERMINAL - sum(K1_PNL.map((p) => p.pnl_usd)) - (2000 - 1000)) / 2000, 9);
      expect(Number(k1.identity_ratio)).toBeCloseTo(5, 9);
    });

    it("raw ratios are unrounded: more than three significant figures survive in the census output", () => {
      const out = psql(`SELECT json_agg(q) FROM (${asSubquery(file("census-edges.sql"))}) q;`);
      expect(out).toMatch(/"open_pnl_ratio":0\.01008403\d{6,}/);
    });

    it("census-edges lists every Friday from each key's first mark through yesterday, with hand-computed ratios and hours", () => {
      const got = rows(file("census-edges.sql"));
      for (const r of got) expect(Object.keys(r)).toEqual(CENSUS_EDGE_COLUMNS);
      const per = got.filter((r) => r.key_ordinal !== "all");
      const yesterday = addDays(TODAY, -1);
      const k1Days = fridays("2026-11-02", yesterday);
      const k2Days = fridays("2026-10-28", yesterday);
      expect(per.filter((r) => r.key_ordinal === "k1").map((r) => r.friday)).toEqual(k1Days);
      expect(per.filter((r) => r.key_ordinal === "k2").map((r) => r.friday)).toEqual(k2Days);
      // Pin the calendar itself so a wrong dayRange cannot agree with a wrong statement.
      expect(k1Days).toEqual(["2026-11-06", "2026-11-13"]);
      expect(k2Days).toEqual(["2026-10-30", "2026-11-06", "2026-11-13"]);

      const cell = (k: string, d: string) => per.find((r) => r.key_ordinal === k && r.friday === d) as Row;
      expect(cell("k1", "2026-11-06").mark_present).toBe(true);
      expect(Number(cell("k1", "2026-11-06").open_pnl_ratio)).toBeCloseTo(120 / 11900, 12);
      expect(cell("k1", "2026-11-13").mark_present).toBe(true);
      expect(Number(cell("k1", "2026-11-13").open_pnl_ratio)).toBeCloseTo(80 / 12150, 12);
      // 00:05Z after UTC midnight.
      expect(Number(cell("k1", "2026-11-06").hours_after_utc_midnight)).toBeCloseTo(5 / 60, 12);
      expect(Date.parse(String(cell("k1", "2026-11-06").marked_at))).toBe(Date.parse("2026-11-07T00:05:00Z"));

      expect(cell("k2", "2026-10-30").mark_present).toBe(false);
      expect(cell("k2", "2026-10-30").open_pnl_ratio).toBeNull();
      expect(cell("k2", "2026-10-30").marked_at).toBeNull();
      expect(cell("k2", "2026-11-06").mark_present).toBe(true);
      expect(Number(cell("k2", "2026-11-06").open_pnl_ratio)).toBeCloseTo(60 / 12000, 12);
      expect(cell("k2", "2026-11-13").mark_present).toBe(false);

      // k3 has no marks: exactly one row, friday NULL, mark_present false.
      const k3 = per.filter((r) => r.key_ordinal === "k3");
      expect(k3).toHaveLength(1);
      expect(k3[0].friday).toBeNull();
      expect(k3[0].mark_present).toBe(false);

      const all = got.at(-1) as Row;
      expect(all.key_ordinal).toBe("all");
      expect(all.rows_examined).toBe(per.length);
      expect(per.length).toBe(k1Days.length + k2Days.length + 1);
      expect(JSON.stringify(got)).not.toContain("okx");
    });

    it("with every mt5 key removed the census still prints its summary row with keys_examined 0 (PARITY-04 empty case)", () => {
      const prelude = "DELETE FROM public.api_keys WHERE exchange = 'mt5';";
      const acc = rows(file("census-accounts.sql"), prelude);
      expect(acc).toHaveLength(1);
      expect(acc[0].key_ordinal).toBe("all");
      expect(acc[0].keys_examined).toBe(0);
      const edges = rows(file("census-edges.sql"), prelude);
      expect(edges).toHaveLength(1);
      expect(edges[0].key_ordinal).toBe("all");
      expect(edges[0].rows_examined).toBe(0);
      // The rollback left the fixture intact.
      expect(psql("SELECT count(*) FROM public.api_keys WHERE exchange = 'mt5';").trim()).toBe("3");
    });
  });

  describe("bind", () => {
    it("prints one row per ordinal with the freshness witnesses equal to the seeded counts and stamps", () => {
      const got = rows(file("bind.sql"));
      for (const r of got) expect(Object.keys(r)).toEqual(BIND_COLUMNS);
      expect(got.map((r) => r.key_ordinal)).toEqual(["k1", "k2", "k3"]);
      const b = byOrdinal(got);
      expect(b.k1.api_key_id).toBe(K1.key);
      expect(b.k1.analytics_rows).toBe(1);
      expect(b.k2.analytics_rows).toBe(0);
      expect(Date.parse(String(b.k1.analytics_max_computed_at))).toBe(Date.parse(K1_ANALYTICS_COMPUTED));
      expect(b.k2.analytics_max_computed_at).toBeNull();
      expect(b.k1.marks_count).toBe(MARKS.filter((m) => m.key === K1.key).length);
      expect(b.k2.marks_count).toBe(MARKS.filter((m) => m.key === K2.key).length);
      expect(b.k3.marks_count).toBe(0);
      expect(Date.parse(String(b.k1.marks_max_created_at))).toBe(Date.parse("2026-11-14T00:10:00Z"));
      expect(b.k3.marks_max_created_at).toBeNull();
      expect(Date.parse(String(b.k1.key_inputs_computed_at))).toBe(Date.parse(K1_ANALYTICS_COMPUTED));
      expect(Date.parse(String(b.k2.key_inputs_computed_at))).toBe(Date.parse("2026-11-14T03:30:00Z"));
      expect(b.k3.key_inputs_computed_at).toBeNull();
      // k1: two rows by api_key_id plus one through its strategy.
      expect(b.k1.returns_count).toBe(CSV_ROWS.filter((r) => r.key === K1.key || r.strategy === K1.strategy).length);
      expect(b.k2.returns_count).toBe(0);
      const k1Updated = CSV_ROWS.filter((r) => r.key === K1.key || r.strategy === K1.strategy).map((r) => r.updated).sort();
      expect(Date.parse(String(b.k1.returns_max_updated_at))).toBe(Date.parse(k1Updated.at(-1) as string));
      expect(Date.parse(String(b.k1.equity_curve_computed_at))).toBe(Date.parse(K1_EQUITY_COMPUTED));
      expect(b.k2.equity_curve_computed_at).toBeNull();
      expect(Date.parse(String(b.k1.holdings_max_updated_at))).toBe(Date.parse(HOLDINGS_UPDATED));
      expect(b.k3.holdings_max_updated_at).toBeNull();
      expect(JSON.stringify(got)).not.toContain(OKX.key);
    });
  });

  describe("capture files execute to the contract", () => {
    const contract = JSON.parse(readFileSync(join(DIR, "capture-contract.json"), "utf8")) as {
      witness_columns: string[];
      files: Record<string, { slice: string; table: string; day_column: string | null; row_shape: string; columns: string[]; extra_witness: string[] }>;
    };
    const entries = Object.entries(contract.files);

    it("the contract names the ten capture files (vacuity: the loop below is not empty)", () => {
      expect(entries).toHaveLength(10);
      expect(entries.map(([f]) => f).sort()).toEqual(
        [
          "capture-analytics.sql", "capture-btc.sql", "capture-equity-curve.sql", "capture-holdings.sql", "capture-key-inputs.sql",
          "capture-keymap.sql", "capture-marks.sql", "capture-returns.sql", "capture-series.sql", "capture-strategy.sql",
        ],
      );
    });

    describe.each(entries)("%s", (name, spec) => {
      const got = () => rows(file(name));

      it("returns one ordered row per mt5 ordinal whose keys are the contract witness columns, in contract order", () => {
        const g = got();
        expect(g.map((r) => r.key_ordinal)).toEqual(["k1", "k2", "k3"]);
        for (const r of g) expect(Object.keys(r)).toEqual([...contract.witness_columns, ...spec.extra_witness]);
      });

      it("row_count equals slice_rows.length and first/last day equal the min/max of the contract's day column", () => {
        for (const r of got()) {
          const slice = r.slice_rows as Row[];
          expect(Array.isArray(slice)).toBe(true);
          expect(r.row_count, `${name} ${String(r.key_ordinal)}`).toBe(slice.length);
          if (spec.day_column === null) {
            expect(r.first_day).toBeNull();
            expect(r.last_day).toBeNull();
          } else {
            const days = slice.map((s) => String(s[spec.day_column as string])).sort();
            expect(r.first_day).toBe(days[0] ?? null);
            expect(r.last_day).toBe(days.at(-1) ?? null);
          }
        }
      });

      it("every slice_rows element has exactly the contract's row shape", () => {
        const expectedKeys = spec.row_shape === "whole_row" ? ddlColumns(ddl[spec.table]) : spec.columns;
        expect(expectedKeys.length).toBeGreaterThan(0);
        let seen = 0;
        for (const r of got()) {
          for (const el of r.slice_rows as Row[]) {
            seen += 1;
            expect(Object.keys(el).sort()).toEqual([...expectedKeys].sort());
          }
        }
        // Vacuity: a file whose every slice is empty would pass the loop above for free.
        if (name !== "capture-btc.sql") expect(seen).toBeGreaterThan(0);
      });

      it("never selects the okx key's rows", () => {
        expect(JSON.stringify(got())).not.toContain(OKX.key);
        expect(JSON.stringify(got())).not.toContain(OKX.strategy);
      });
    });

    it("capture-analytics: k1 length witnesses are [3] and [null], aligned with slice_rows", () => {
      const k1 = byOrdinal(rows(file("capture-analytics.sql"))).k1;
      expect(k1.returns_series_len).toEqual([K1_RETURNS_SERIES.length]);
      expect(k1.daily_returns_len).toEqual([null]);
      expect((k1.slice_rows as Row[]).length).toBe(1);
      const k2 = byOrdinal(rows(file("capture-analytics.sql"))).k2;
      expect(k2.returns_series_len).toEqual([]);
      expect(k2.daily_returns_len).toEqual([]);
    });

    it("capture-key-inputs: k1 and k2 carry one row each, k3 none", () => {
      const b = byOrdinal(rows(file("capture-key-inputs.sql")));
      expect(b.k1.row_count).toBe(1);
      expect(b.k2.row_count).toBe(1);
      expect(b.k3.row_count).toBe(0);
      expect(b.k3.slice_rows).toEqual([]);
      const payload = ((b.k1.slice_rows as Row[])[0].payload as Row);
      expect(payload.realized_terminal_usd).toBe(K1_TERMINAL);
    });

    it("capture-btc: no native-unit mark means no closes, even with BTC rows present (the native filter bites)", () => {
      expect(Number(psql("SELECT count(*) FROM public.benchmark_prices WHERE symbol = 'BTC';").trim())).toBeGreaterThan(0);
      for (const r of rows(file("capture-btc.sql"))) {
        expect(r.row_count).toBe(0);
        expect(r.slice_rows).toEqual([]);
      }
    });

    it("capture-btc: the same statement returns the BTC window once k1 carries a native-unit mark (positive control, rolled back)", () => {
      const prelude = `UPDATE public.api_key_nav_marks SET nav_native = 1, open_pnl_native = 0, native_unit = 'BTC'
                        WHERE api_key_id = ${q(K1.key)} AND mark_day = '2026-11-13';`;
      const k1Returns = CSV_ROWS.filter((r) => r.key === K1.key || r.strategy === K1.strategy).map((r) => r.date).sort();
      // 7 days before the key's earliest return day through its latest, BTC only (ETH rows exist on the same days).
      const lo = addDays(k1Returns[0], -7);
      const hi = k1Returns.at(-1) as string;
      const want = BTC_DAYS.filter((d) => d >= lo && d <= hi);
      const b = byOrdinal(rows(file("capture-btc.sql"), prelude));
      expect(want.length).toBeGreaterThan(0);
      expect(b.k1.row_count).toBe(want.length);
      expect(b.k1.first_day).toBe(want[0]);
      expect(b.k1.last_day).toBe(want.at(-1));
      expect((b.k1.slice_rows as Row[]).every((s) => s.symbol === "BTC")).toBe(true);
      expect(b.k2.row_count).toBe(0);
    });

    it("capture-holdings: the raw payload is excluded, tested against a seeded non-null raw_payload", () => {
      expect(psql("SELECT count(*) FROM public.allocator_holdings WHERE raw_payload IS NOT NULL;").trim()).toBe(String(HOLDINGS.length));
      const got = rows(file("capture-holdings.sql"));
      const k1 = byOrdinal(got).k1;
      expect(k1.row_count).toBe(HOLDINGS.length);
      for (const el of k1.slice_rows as Row[]) expect(Object.keys(el)).not.toContain("raw_payload");
      expect(JSON.stringify(got)).not.toContain(HOLDING_SECRET);
      expect(k1.first_day).toBe(HOLDINGS[0].asof);
      expect(k1.last_day).toBe(HOLDINGS[1].asof);
    });

    it("capture-keymap: k3 has one entry with strategy_id null; no element carries a login or an encrypted column", () => {
      const got = rows(file("capture-keymap.sql"));
      const b = byOrdinal(got);
      expect(b.k1.row_count).toBe(1);
      const k3 = b.k3.slice_rows as Row[];
      expect(k3).toHaveLength(1);
      expect(k3[0].strategy_id).toBeNull();
      expect(k3[0].label).toBe("FIX-3");
      for (const r of got) {
        for (const el of r.slice_rows as Row[]) {
          for (const k of Object.keys(el)) {
            expect(k).not.toBe("venue_account_id");
            expect(k).not.toMatch(/_encrypted$/);
          }
        }
      }
      expect(JSON.stringify(got)).not.toContain("fixture-not-a-credential");
    });

    it("capture-returns: k1 reads its two per-key rows and its one strategy row", () => {
      const k1 = byOrdinal(rows(file("capture-returns.sql"))).k1;
      expect(k1.row_count).toBe(3);
      expect(k1.first_day).toBe("2026-11-04");
      expect(k1.last_day).toBe("2026-11-10");
    });

    it("the statement runs read-only: a function that writes from inside a SELECT is refused by the database (WR-07)", () => {
      // The sequence is created by the prelude (still read-write); nextval() is a write the static
      // denylist knows by name, but the database refuses it whatever it is called.
      expect(() => rows("SELECT nextval('public.wr07_probe_seq') AS key_ordinal;", "CREATE SEQUENCE public.wr07_probe_seq;")).toThrow(
        /read-only transaction/,
      );
    });

    it("with every mt5 key removed each capture file prints no row at all (the loader reads the empty result as zero ordinals)", () => {
      const prelude = "DELETE FROM public.api_keys WHERE exchange = 'mt5';";
      for (const [name] of entries) expect(rows(file(name), prelude), name).toEqual([]);
    });
  });
});
