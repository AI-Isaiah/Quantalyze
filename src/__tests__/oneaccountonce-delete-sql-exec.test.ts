/**
 * Phase 225 ONEACCOUNTONCE plan 02 (ONCE-03): the one-time removal of same-owner duplicate keys,
 * EXECUTED on a throwaway local PostgreSQL cluster. `docs/runbooks/oneaccountonce/delete.sql` is a
 * PERMANENT DELETE of PROD rows run once by the orchestrator. This file is the only place it ever runs
 * before PROD, so it must prove two things, each of which a text check cannot:
 *
 *   1. On a miniature of the founder-confirmed manifest it deletes EXACTLY the manifest (the same-owner
 *      duplicate keys, the strategies on them and every dependent row) and leaves every decoy byte-identical:
 *      each holder key, a protected key, a cross-owner key sharing the same account, a duplicate-marked key
 *      whose holder belongs to ANOTHER owner, another owner's strategy.
 *   2. On every difference the founder named, and on the two cascade classes the research found, it aborts
 *      naming its check and writes NOTHING. "Nothing" is measured: a count and an md5 of every fixture table
 *      equal before and after, not just "psql exited non-zero".
 *
 * HOW. Same mechanism as `mt5-parity-capture-sql-exec.test.ts`: `scripts/pg-lane/run.sh --print-pgbin` names the
 * server binaries and this file boots a socket-only cluster of its own (no TCP listener, trust auth, removed in
 * afterAll). No skip gate: with no binaries beforeAll THROWS. The cluster is initdb'd here, its marker is a local
 * string, and this file reads no database URL from the environment: never TEST, never PROD.
 *
 * THE SCHEMA IS THE REAL ONE WHERE IT MATTERS. api_keys, strategies, strategy_keys, allocator_holdings and
 * allocator_equity_derived are cut verbatim from `supabase/schema/baseline.sql` (a column rename breaks the seed
 * loudly). The foreign keys are hand-written (the baseline's CREATE TABLE blocks carry none) and every one of
 * them that exists in the baseline is cross-checked against the baseline's own ADD CONSTRAINT line for name and
 * ON DELETE action. `delete_allocator_api_key`, `enforce_api_keys_published_composite_integrity` and
 * `enforce_mt5_server_clock_readings_write_once` are the REAL bodies from `supabase/schema/functions`, so the
 * owner-context idiom, the published-composite delete guard and the write-once cascade rule are exercised, not
 * imitated. The small remaining tables are hand-written stand-ins.
 *
 * ISOLATION. The fixture is seeded once into a template database; every test clones it, applies its own
 * deviation, and runs delete.sql in its OWN psql session (so no transaction statistics leak in from a seed).
 * The database marker is per database, so each clone sets it.
 *
 * This file reads nothing under `.planning/`, which the ship filter strips from main.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const DIR = join(REPO, "docs", "runbooks", "oneaccountonce");
const BASELINE = join(REPO, "supabase", "schema", "baseline.sql");
const FUNCS = join(REPO, "supabase", "schema", "functions");

const LOCAL_MARKER = "oneaccountonce exec gate. Throwaway cluster, not TEST, not PROD.";

/* ----------------------------------------------------------------------------------------------
 * The fixture. Every id and value is invented.
 * -------------------------------------------------------------------------------------------- */

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const OWNER_A = uid(1);
const OWNER_B = uid(2);
const OWNER_C = uid(3);

/** mt5 keys in creation order: M0 (k1), D2 (k2, the manifest mt5 duplicate), HB (k3). An okx key sits between M0 and D2. */
const M0 = uid(100); // owner C, mt5, live, PROTECTED (plays 155.2's k1)
const HA1 = uid(101); // owner A, okx, live holder of D1
const D2 = uid(102); // owner B, mt5, disconnected duplicate of HB   (MANIFEST)
const HB = uid(103); // owner B, mt5, live holder of D2, PROTECTED (plays 155.2's k3)
const HA2 = uid(104); // owner A, deribit, live holder of D3
const D1 = uid(105); // owner A, okx, disconnected duplicate of HA1  (MANIFEST)
const D3 = uid(106); // owner A, deribit, disconnected duplicate of HA2 (MANIFEST)
const X1 = uid(107); // owner C, okx, live, the SAME account as HA1 (the cross-owner share link)
const XD = uid(108); // owner C, okx, disconnected, marked duplicate of HA1 (a holder of ANOTHER owner)

const S1 = uid(200); // published okx strategy on D1 (MANIFEST)
const S2 = uid(201); // private mt5 strategy on D2 (MANIFEST)
const SH1 = uid(202); // published strategy on holder HA1 (decoy)
const SHB = uid(203); // strategy on holder HB (decoy)
const SX = uid(204); // another owner's strategy on M0 (decoy)

const KEYS = [D1, D2, D3];
const STRATS = [S1, S2];
const PROTECTED = [M0, HB];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The tables the script may touch (c_confirmed in delete.sql), plus the hand-written decoy tables. */
const TABLES = [
  "api_keys",
  "strategies",
  "strategy_keys",
  "allocator_holdings",
  "allocator_equity_derived",
  "csv_daily_returns",
  "trades",
  "api_key_nav_marks",
  "key_permission_audit",
  "mt5_server_clock_readings",
  "compute_jobs",
  "allocation_events",
  "zz_unlisted_strategy_child",
  "zz_unlisted_trade_child",
  "zz_nofk_refs",
] as const;
type Table = (typeof TABLES)[number];

/** The five tables cut verbatim from the baseline. */
const BASELINE_TABLES = ["api_keys", "strategies", "strategy_keys", "allocator_holdings", "allocator_equity_derived"] as const;

type Fk = { table: string; name: string; col: string; ref: "api_keys" | "strategies"; action: string; real: boolean };

/** Hand-written foreign keys. `real` ones are cross-checked against supabase/schema/baseline.sql. */
const FKS: Fk[] = [
  { table: "allocator_holdings", name: "allocator_holdings_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE RESTRICT", real: true },
  { table: "api_key_nav_marks", name: "api_key_nav_marks_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE CASCADE", real: true },
  { table: "api_keys", name: "api_keys_account_shared_with_api_key_id_fkey", col: "account_shared_with_api_key_id", ref: "api_keys", action: "ON DELETE SET NULL", real: true },
  { table: "compute_jobs", name: "compute_jobs_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE CASCADE", real: true },
  { table: "compute_jobs", name: "compute_jobs_strategy_id_fkey", col: "strategy_id", ref: "strategies", action: "ON DELETE CASCADE", real: true },
  { table: "csv_daily_returns", name: "csv_daily_returns_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE CASCADE", real: true },
  { table: "csv_daily_returns", name: "csv_daily_returns_strategy_id_fkey", col: "strategy_id", ref: "strategies", action: "ON DELETE CASCADE", real: true },
  { table: "key_permission_audit", name: "key_permission_audit_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE CASCADE", real: true },
  { table: "mt5_server_clock_readings", name: "mt5_server_clock_readings_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE CASCADE", real: true },
  { table: "strategies", name: "strategies_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE SET NULL", real: true },
  { table: "strategy_keys", name: "strategy_keys_api_key_id_fkey", col: "api_key_id", ref: "api_keys", action: "ON DELETE CASCADE", real: true },
  { table: "strategy_keys", name: "strategy_keys_strategy_id_fkey", col: "strategy_id", ref: "strategies", action: "ON DELETE CASCADE", real: true },
  { table: "trades", name: "trades_strategy_id_fkey", col: "strategy_id", ref: "strategies", action: "ON DELETE CASCADE", real: true },
  // allocation_events blocks the strategy delete in the baseline (no ON DELETE action).
  { table: "allocation_events", name: "allocation_events_strategy_id_fkey", col: "strategy_id", ref: "strategies", action: "", real: true },
  // Not in the baseline: a table the script never names, with a cascading foreign key (the pg_constraint arm).
  { table: "zz_unlisted_strategy_child", name: "zz_unlisted_strategy_child_strategy_id_fkey", col: "strategy_id", ref: "strategies", action: "ON DELETE CASCADE", real: false },
];

/** The dependents the fixture seeds for the manifest, hand-counted. */
const DEPENDENTS_OF_KEYS = { allocator_holdings: 4, csv_daily_returns: 2, compute_jobs: 1, api_key_nav_marks: 1, mt5_server_clock_readings: 2, key_permission_audit: 1 };
const DEPENDENTS_OF_STRATS = { trades: 3, csv_daily_returns: 1, compute_jobs: 1 };

function seedSql(): string {
  const out: string[] = [];
  const key = (
    id: string,
    owner: string,
    exchange: string,
    label: string,
    created: string,
    o: { login?: string; disconnected?: boolean; sharedWith?: string } = {},
  ) =>
    `INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, created_at, disconnected_at, venue_account_id, account_share_kind, account_shared_with_api_key_id)
     VALUES (${q(id)}, ${q(owner)}, ${q(exchange)}, ${q(label)}, 'fixture-not-a-credential', ${q(created)},
             ${o.disconnected ? `${q(created)}::timestamptz + interval '30 days'` : "NULL"},
             ${o.login ? q(o.login) : "NULL"}, ${o.sharedWith ? "'duplicate'" : "NULL"}, ${o.sharedWith ? q(o.sharedWith) : "NULL"});`;

  // Holders first: the marker column is a foreign key to api_keys.
  out.push(key(M0, OWNER_C, "mt5", "FIX-M0", "2026-01-01T00:00:00Z", { login: "L-M0" }));
  out.push(key(HA1, OWNER_A, "okx", "FIX-HA1", "2026-01-02T00:00:00Z", { login: "acct-1" }));
  out.push(key(HB, OWNER_B, "mt5", "FIX-HB", "2026-01-04T00:00:00Z", { login: "L-HB" }));
  out.push(key(HA2, OWNER_A, "deribit", "FIX-HA2", "2026-01-05T00:00:00Z", { login: "acct-2" }));
  out.push(key(X1, OWNER_C, "okx", "FIX-X1", "2026-01-08T00:00:00Z", { login: "acct-1" }));
  out.push(key(D2, OWNER_B, "mt5", "FIX-D2", "2026-01-03T00:00:00Z", { disconnected: true, sharedWith: HB }));
  out.push(key(D1, OWNER_A, "okx", "FIX-D1", "2026-01-06T00:00:00Z", { disconnected: true, sharedWith: HA1 }));
  out.push(key(D3, OWNER_A, "deribit", "FIX-D3", "2026-01-07T00:00:00Z", { disconnected: true, sharedWith: HA2 }));
  out.push(key(XD, OWNER_C, "okx", "FIX-XD", "2026-01-09T00:00:00Z", { disconnected: true, sharedWith: HA1 }));

  const strat = (id: string, owner: string, keyId: string, status: string, source: string, created: string) =>
    `INSERT INTO public.strategies (id, user_id, api_key_id, name, status, asset_class, source, created_at)
     VALUES (${q(id)}, ${q(owner)}, ${q(keyId)}, 'Fixture strategy', ${q(status)}, 'crypto', ${q(source)}, ${q(created)});`;
  out.push(strat(S1, OWNER_A, D1, "published", "okx", "2026-01-06T00:05:00Z"));
  out.push(strat(S2, OWNER_B, D2, "private", "mt5", "2026-01-03T00:05:00Z"));
  out.push(strat(SH1, OWNER_A, HA1, "published", "okx", "2026-01-02T00:05:00Z"));
  out.push(strat(SHB, OWNER_B, HB, "private", "mt5", "2026-01-04T00:05:00Z"));
  out.push(strat(SX, OWNER_C, M0, "private", "mt5", "2026-01-01T00:05:00Z"));

  const holding = (id: number, owner: string, keyId: string) =>
    `INSERT INTO public.allocator_holdings (id, allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
     VALUES (${q(uid(300 + id))}, ${q(owner)}, ${q(keyId)}, 'x', 'FIXUSD', '2026-01-10', 'spot', 'long', ${id}, ${id * 10}, 1);`;
  // 2 on D1, 1 on D2, 1 on D3 (manifest); 2 on the holders and 1 on the protected key (decoys).
  [[1, OWNER_A, D1], [2, OWNER_A, D1], [3, OWNER_B, D2], [4, OWNER_A, D3], [5, OWNER_A, HA1], [6, OWNER_B, HB], [7, OWNER_C, M0]].forEach(([n, o, k]) =>
    out.push(holding(n as number, o as string, k as string)),
  );

  out.push(`INSERT INTO public.csv_daily_returns (strategy_id, api_key_id, allocator_id, date, daily_return) VALUES
    (NULL, ${q(D1)}, ${q(OWNER_A)}, '2026-01-10', 0.01),
    (NULL, ${q(D1)}, ${q(OWNER_A)}, '2026-01-11', 0.02),
    (${q(S1)}, NULL, NULL, '2026-01-10', 0.03),
    (NULL, ${q(HA1)}, ${q(OWNER_A)}, '2026-01-10', 0.04),
    (${q(SH1)}, NULL, NULL, '2026-01-10', 0.05);`);
  out.push(`INSERT INTO public.trades (strategy_id, symbol) VALUES
    (${q(S1)}, 'A'), (${q(S1)}, 'B'), (${q(S2)}, 'C'), (${q(SH1)}, 'D'), (${q(SHB)}, 'E');`);
  out.push(`INSERT INTO public.api_key_nav_marks (api_key_id, allocator_id, mark_day) VALUES
    (${q(D1)}, ${q(OWNER_A)}, '2026-01-10'), (${q(HA1)}, ${q(OWNER_A)}, '2026-01-10');`);
  out.push(`INSERT INTO public.key_permission_audit (api_key_id, note) VALUES (${q(D1)}, 'x'), (${q(HA1)}, 'y');`);
  out.push(`INSERT INTO public.mt5_server_clock_readings (api_key_id) VALUES (${q(D2)}), (${q(D2)}), (${q(HB)});`);
  out.push(`INSERT INTO public.compute_jobs (strategy_id, api_key_id, allocator_id, kind) VALUES
    (NULL, ${q(D1)}, ${q(OWNER_A)}, 'holdings'),
    (${q(S1)}, NULL, NULL, 'analytics'),
    (${q(SH1)}, NULL, NULL, 'analytics'),
    (NULL, NULL, ${q(OWNER_A)}, 'derive_allocator_equity');`);
  // The derived rows no foreign key cascades (OQ-4): they must SURVIVE the script.
  out.push(`INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload) VALUES
    (${q(OWNER_A)}, ${q(`key_inputs:${D1}`)}, '{}'::jsonb),
    (${q(OWNER_A)}, ${q(`key_inputs:${HA1}`)}, '{}'::jsonb),
    (${q(OWNER_A)}, 'equity_curve', '{}'::jsonb),
    (${q(OWNER_B)}, ${q(`key_inputs:${D2}`)}, '{}'::jsonb),
    (${q(OWNER_B)}, 'equity_curve', '{}'::jsonb);`);
  // A table with both columns and no foreign key: report-only for the census, untouched by the script.
  out.push(`INSERT INTO public.zz_nofk_refs (api_key_id, strategy_id) VALUES (${q(D3)}, ${q(S1)});`);
  return out.join("\n");
}

/** The five CREATE TABLE blocks, verbatim. A miss throws naming the table. */
function extractDdl(): Record<string, string> {
  const baseline = readFileSync(BASELINE, "utf8");
  const out: Record<string, string> = {};
  for (const t of BASELINE_TABLES) {
    const m = new RegExp(`^CREATE TABLE IF NOT EXISTS "public"\\."${t}" \\(\\n[\\s\\S]*?^\\);\\n`, "m").exec(baseline);
    if (!m) throw new Error(`oneaccountonce exec gate: CREATE TABLE block for public.${t} not found in supabase/schema/baseline.sql`);
    out[t] = m[0];
  }
  return out;
}

const fn = (name: string) => readFileSync(join(FUNCS, name), "utf8");

function schemaSql(ddl: Record<string, string>): string {
  const standIns = `
CREATE TABLE public.csv_daily_returns (id serial PRIMARY KEY, strategy_id uuid, api_key_id uuid, allocator_id uuid, date date, daily_return numeric);
CREATE TABLE public.trades (id serial PRIMARY KEY, strategy_id uuid NOT NULL, symbol text);
CREATE TABLE public.api_key_nav_marks (id serial PRIMARY KEY, api_key_id uuid NOT NULL, allocator_id uuid, mark_day date);
CREATE TABLE public.key_permission_audit (id serial PRIMARY KEY, api_key_id uuid NOT NULL, note text);
CREATE TABLE public.mt5_server_clock_readings (id bigserial PRIMARY KEY, api_key_id uuid NOT NULL);
CREATE TABLE public.compute_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), strategy_id uuid, api_key_id uuid, allocator_id uuid, kind text NOT NULL);
CREATE TABLE public.allocation_events (id serial PRIMARY KEY, strategy_id uuid NOT NULL);
CREATE TABLE public.zz_unlisted_strategy_child (id serial PRIMARY KEY, strategy_id uuid NOT NULL);
CREATE TABLE public.zz_unlisted_trade_child (id serial PRIMARY KEY, trade_id integer NOT NULL REFERENCES public.trades (id) ON DELETE CASCADE);
CREATE TABLE public.zz_nofk_refs (id serial PRIMARY KEY, api_key_id uuid, strategy_id uuid);
`;
  const fks = FKS.map(
    (f) =>
      `ALTER TABLE ONLY public.${f.table} ADD CONSTRAINT ${f.name} FOREIGN KEY (${f.col}) REFERENCES public.${f.ref} (id) ${f.action};`,
  ).join("\n");

  return [
    "CREATE SCHEMA auth;",
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;",
    "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;",
    // Supabase-shaped auth.uid() and auth.role(): NULLIF before the cast, as the pg-lane fixture does.
    `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
       SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;`,
    `CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
       SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') $$;`,
    "GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;",
    ...BASELINE_TABLES.map((t) => ddl[t]),
    "ALTER TABLE public.api_keys ADD PRIMARY KEY (id);",
    "ALTER TABLE public.strategies ADD PRIMARY KEY (id);",
    "ALTER TABLE public.strategy_keys ADD PRIMARY KEY (id);",
    "ALTER TABLE public.allocator_holdings ADD PRIMARY KEY (id);",
    "ALTER TABLE public.allocator_equity_derived ADD PRIMARY KEY (allocator_id, kind);",
    standIns,
    fks,
    // The owner's row policies, as in the baseline: a DELETE with a WHERE also needs the SELECT policy.
    "ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;",
    `CREATE POLICY strategies_delete ON public.strategies FOR DELETE USING (user_id = auth.uid());`,
    `CREATE POLICY strategies_read ON public.strategies FOR SELECT USING (status = 'published' OR user_id = auth.uid());`,
    "GRANT SELECT, DELETE ON public.strategies TO authenticated;",
    // The REAL bodies.
    fn("delete_allocator_api_key.sql"),
    fn("enforce_api_keys_published_composite_integrity.sql"),
    "CREATE TRIGGER api_keys_published_composite_delete_guard BEFORE DELETE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.enforce_api_keys_published_composite_integrity();",
    fn("enforce_mt5_server_clock_readings_write_once.sql"),
    "CREATE TRIGGER mt5_server_clock_readings_write_once BEFORE DELETE OR UPDATE ON public.mt5_server_clock_readings FOR EACH ROW EXECUTE FUNCTION public.enforce_mt5_server_clock_readings_write_once();",
    // A stand-in with the real allocator-branch gate: without the owner's claims it refuses, as PROD does.
    `CREATE FUNCTION public.enqueue_compute_job(p_strategy_id uuid, p_kind text, p_allocator_id uuid DEFAULT NULL)
       RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
     DECLARE v_id uuid;
     BEGIN
       IF auth.role() IS DISTINCT FROM 'service_role' THEN
         IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_allocator_id THEN
           RAISE EXCEPTION 'enqueue_compute_job: allocator-scoped enqueue requires p_allocator_id = auth.uid()' USING ERRCODE = 'insufficient_privilege';
         END IF;
       END IF;
       INSERT INTO public.compute_jobs (allocator_id, kind) VALUES (p_allocator_id, p_kind) RETURNING id INTO v_id;
       RETURN v_id;
     END $$;`,
    "GRANT EXECUTE ON FUNCTION public.enqueue_compute_job(uuid, text, uuid) TO authenticated, service_role;",
  ].join("\n");
}

type Row = Record<string, unknown>;

describe("oneaccountonce delete.sql and census, EXECUTED on a throwaway cluster over the baseline DDL (Phase 225)", () => {
  let root = "";
  let pgbin = "";
  let started = false;
  let dbSeq = 0;
  const ddl = extractDdl();

  const harnessEnv: Record<string, string | undefined> = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", PGTZ: "UTC" };
  const HARNESS_ENV = harnessEnv as NodeJS.ProcessEnv;

  function pg(tool: string, args: string[]) {
    const res = spawnSync(join(pgbin, tool), args, { encoding: "utf8", env: HARNESS_ENV });
    if (res.status !== 0) throw new Error(`${tool} ${args[0] ?? ""} exited ${res.status}: ${res.stderr || res.stdout}`);
    return res.stdout;
  }

  /** A fresh psql session per call: no transaction statistics survive from one call to the next. */
  function psqlRaw(db: string, sql: string) {
    return spawnSync(
      join(pgbin, "psql"),
      ["-h", root, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-At", "-q", "-X", "-f", "-"],
      { encoding: "utf8", input: sql, env: HARNESS_ENV },
    );
  }

  function psql(db: string, sql: string): string {
    const res = psqlRaw(db, sql);
    if (res.status !== 0) throw new Error(`psql exited ${res.status}: ${res.stderr}`);
    return res.stdout;
  }

  /** One committed read-only statement as rows; `SET TRANSACTION READ ONLY` makes a writing statement fail at the database. */
  function rows(db: string, statement: string): Row[] {
    const body = statement.trimEnd().replace(/;\s*$/, "");
    const out = psql(db, `BEGIN;\nSET TRANSACTION READ ONLY;\nSELECT coalesce(json_agg(q), '[]'::json) FROM (${body}) q;\nROLLBACK;`);
    return JSON.parse(out.trim()) as Row[];
  }

  const file = (name: string) => readFileSync(join(DIR, name), "utf8");

  /** Clone the seeded template and give the clone its own marker. */
  function clone(): string {
    dbSeq += 1;
    const db = `t${dbSeq}`;
    psql("postgres", `CREATE DATABASE ${db} TEMPLATE tmpl;\nCOMMENT ON DATABASE ${db} IS ${q(LOCAL_MARKER)};`);
    return db;
  }

  /** count and md5 of every fixture table: equal before and after means nothing was written. */
  function state(db: string): Record<string, string> {
    const sql = TABLES.map(
      (t) => `SELECT '${t}', count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM public.${t} x`,
    ).join("\nUNION ALL\n");
    const out: Record<string, string> = {};
    for (const line of psql(db, `${sql};`).trim().split("\n")) {
      const [t, v] = line.split("|");
      out[t] = v;
    }
    return out;
  }

  function tableRows(db: string, table: Table, where = "true"): string[] {
    const out = psql(db, `SELECT x::text FROM public.${table} x WHERE ${where} ORDER BY x::text;`).trim();
    return out === "" ? [] : out.split("\n");
  }

  const idList = (ids: string[]) => ids.map(q).join(", ");

  /** The survivors: every row that does NOT belong to the manifest, per table. compute_jobs gets its two new rows separately. */
  const SURVIVOR_WHERE: Record<Table, string> = {
    api_keys: `id NOT IN (${idList(KEYS)})`,
    strategies: `id NOT IN (${idList(STRATS)})`,
    strategy_keys: `api_key_id NOT IN (${idList(KEYS)}) AND strategy_id NOT IN (${idList(STRATS)})`,
    allocator_holdings: `api_key_id NOT IN (${idList(KEYS)})`,
    allocator_equity_derived: "true",
    csv_daily_returns: `(api_key_id IS NULL OR api_key_id NOT IN (${idList(KEYS)})) AND (strategy_id IS NULL OR strategy_id NOT IN (${idList(STRATS)}))`,
    trades: `strategy_id NOT IN (${idList(STRATS)})`,
    api_key_nav_marks: `api_key_id NOT IN (${idList(KEYS)})`,
    key_permission_audit: `api_key_id NOT IN (${idList(KEYS)})`,
    mt5_server_clock_readings: `api_key_id NOT IN (${idList(KEYS)})`,
    compute_jobs: `(api_key_id IS NULL OR api_key_id NOT IN (${idList(KEYS)})) AND (strategy_id IS NULL OR strategy_id NOT IN (${idList(STRATS)}))`,
    allocation_events: "true",
    zz_unlisted_strategy_child: "true",
    zz_unlisted_trade_child: "true",
    zz_nofk_refs: "true",
  };

  type Tokens = { keys?: string | null; strats?: string | null; prot?: string | null; marker?: string | null };

  /** `null` leaves the token unfilled, exactly as an orchestrator who forgot one would. */
  function fill(sql: string, t: Tokens = {}): string {
    let out = sql;
    const sub = (token: string, v: string | null | undefined, dflt: string) => {
      if (v === null) return;
      out = out.split(token).join(v ?? dflt);
    };
    sub("{{MANIFEST_KEY_IDS}}", t.keys, KEYS.join(","));
    sub("{{MANIFEST_STRATEGY_IDS}}", t.strats, STRATS.join(","));
    sub("{{PROTECTED_KEY_IDS}}", t.prot, PROTECTED.join(","));
    sub("{{EXPECTED_MARKER}}", t.marker, LOCAL_MARKER);
    return out;
  }

  const deleteSql = () => file("delete.sql");

  function runDelete(db: string, tokens: Tokens = {}) {
    return psqlRaw(db, fill(deleteSql(), tokens));
  }

  /** An abort arm: psql exits non-zero, the stderr names the check, and nothing was written. */
  function expectAbort(db: string, before: Record<string, string>, res: ReturnType<typeof runDelete>, label: string, phrase: string) {
    expect(res.status, `delete.sql must exit non-zero; stdout=${res.stdout} stderr=${res.stderr}`).not.toBe(0);
    expect(res.stderr).toContain(label);
    expect(res.stderr).toContain(phrase);
    expect(res.stderr).toContain("nothing written");
    expect(state(db)).toEqual(before);
  }

  beforeAll(() => {
    const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
    if (sel.status !== 0 || sel.stdout.trim() === "") {
      throw new Error(
        "oneaccountonce exec gate: no PostgreSQL server binaries. `bash scripts/pg-lane/run.sh --print-pgbin` said:\n" + sel.stderr,
      );
    }
    pgbin = sel.stdout.trim();
    // /tmp, not os.tmpdir(): the socket path must stay under the ~104-byte sun_path limit.
    root = mkdtempSync("/tmp/oaoc-");
    const data = join(root, "pgd");
    pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
    writeFileSync(
      join(data, "postgresql.conf"),
      `${readFileSync(join(data, "postgresql.conf"), "utf8")}\nlisten_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`,
    );
    // Set BEFORE the start: a start that times out can still bring the postmaster up late.
    started = true;
    pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
    // The roles scripts/pg-lane/run.sh creates (anon, authenticated, service_role BYPASSRLS).
    psql("postgres", "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;");
    psql("postgres", "CREATE DATABASE tmpl;");
    psql("tmpl", schemaSql(ddl));
    psql("tmpl", seedSql());
  }, 120000);

  afterAll(() => {
    if (started) spawnSync(join(pgbin, "pg_ctl"), ["-D", join(root, "pgd"), "-m", "immediate", "-w", "stop"], { env: HARNESS_ENV });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  describe("static: what the committed files may and may not contain", () => {
    it("delete.sql carries no committed uuid, never names the GDPR sanitize bypass, and holds the four placeholder tokens", () => {
      const sql = deleteSql();
      expect(sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)).toBeNull();
      expect(sql).not.toContain("sanitize_in_progress");
      for (const t of ["{{MANIFEST_KEY_IDS}}", "{{MANIFEST_STRATEGY_IDS}}", "{{PROTECTED_KEY_IDS}}", "{{EXPECTED_MARKER}}"]) {
        expect(sql).toContain(t);
      }
      expect(sql).toContain("delete_allocator_api_key");
      expect(sql).toContain("pg_constraint");
      expect(sql).toContain("pg_stat_xact_user_tables");
    });

    it("delete.sql runs inside ONE explicit transaction and carries no psql meta-command (it is pasted into an MCP call)", () => {
      const sql = deleteSql();
      expect(sql.startsWith("BEGIN;")).toBe(true);
      expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
      expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
      expect(sql).not.toMatch(/^\\/m);
    });

    it("every census file and marker.sql is ONE read-only statement with no leading comment line", () => {
      for (const f of ["marker.sql", "census-keys.sql", "census-strategies.sql", "census-dependents.sql", "census-triggers.sql"]) {
        const sql = file(f);
        expect(sql.trimStart().startsWith("--"), `${f} starts with a comment line`).toBe(false);
        expect(sql, `${f} writes`).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMENT)\b\s/i);
        expect(sql.trim().split(";").filter((s) => s.trim() !== "").length, `${f} holds more than one statement`).toBe(1);
      }
    });

    it("every hand-written foreign key that exists in the baseline matches the baseline's constraint line (name and ON DELETE action)", () => {
      const baseline = readFileSync(BASELINE, "utf8");
      for (const f of FKS.filter((x) => x.real)) {
        const expected =
          `ADD CONSTRAINT "${f.name}" FOREIGN KEY ("${f.col}") REFERENCES "public"."${f.ref}"("id")` + (f.action === "" ? ";" : ` ${f.action};`);
        expect(baseline, `${f.name} drifted from the baseline`).toContain(expected);
      }
    });
  });

  describe("vacuity guards", () => {
    it("the cluster is the throwaway one, not a real project (local marker on a clone)", () => {
      const db = clone();
      expect(psql(db, "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database();").trim()).toBe(LOCAL_MARKER);
    });

    it("the fixture seeded the manifest, every decoy and the dependents the arms rely on", () => {
      const n = (sql: string) => Number(psql("tmpl", sql).trim());
      expect(n("SELECT count(*) FROM public.api_keys")).toBe(9);
      expect(n(`SELECT count(*) FROM public.api_keys WHERE id IN (${idList(KEYS)}) AND disconnected_at IS NOT NULL AND account_share_kind = 'duplicate'`)).toBe(3);
      // the decoys that make each rule bite
      expect(n(`SELECT count(*) FROM public.api_keys k JOIN public.api_keys h ON h.id = k.account_shared_with_api_key_id WHERE k.id = ${q(XD)} AND h.user_id <> k.user_id`)).toBe(1);
      expect(n(`SELECT count(*) FROM public.api_keys WHERE venue_account_id = 'acct-1'`)).toBe(2); // HA1 + the other owner's X1
      expect(n(`SELECT count(*) FROM public.strategies WHERE status = 'published'`)).toBe(2);
      // the okx key sits between the two mt5 keys that surround the manifest mt5 duplicate
      expect(psql("tmpl", "SELECT string_agg(exchange, ',' ORDER BY created_at) FROM public.api_keys").trim()).toBe("mt5,okx,mt5,mt5,deribit,okx,deribit,okx,okx");
      for (const [t, c] of Object.entries(DEPENDENTS_OF_KEYS)) {
        expect(n(`SELECT count(*) FROM public.${t} WHERE api_key_id IN (${idList(KEYS)})`), `${t} by key`).toBe(c);
      }
      expect(n(`SELECT count(*) FROM public.trades WHERE strategy_id IN (${idList(STRATS)})`)).toBe(DEPENDENTS_OF_STRATS.trades);
      expect(n(`SELECT count(*) FROM public.csv_daily_returns WHERE strategy_id IN (${idList(STRATS)})`)).toBe(DEPENDENTS_OF_STRATS.csv_daily_returns);
    });

    it("the template is untouched by the other tests (every test works on a clone)", () => {
      expect(psql("tmpl", "SELECT count(*) FROM public.api_keys;").trim()).toBe("9");
    });
  });

  describe("census, executed READ ONLY on the fixture", () => {
    it("census-keys.sql returns exactly the three same-owner duplicates, ordered exchange, user_id, created_at, id, with the keymap ordinal", () => {
      const got = rows("tmpl", file("census-keys.sql"));
      expect(got.map((r) => r.id)).toEqual([D3, D2, D1]); // deribit, mt5, okx
      expect(got.map((r) => r.exchange)).toEqual(["deribit", "mt5", "okx"]);
      for (const r of got) {
        expect(r.is_disconnected).toBe(true);
        expect(r.is_holder).toBe(false);
        expect(r.in_strategy_keys).toBe(false);
        expect(r.in_published_composite).toBe(false);
      }
      // the okx key between the mt5 keys must not shift the ordinal: D2 is the second mt5 key by created_at
      expect(got.map((r) => r.key_ordinal)).toEqual([null, "k2", null]);
      // owner A keeps HA1 and HA2 outside the set, owner B keeps HB
      expect(got.map((r) => r.other_key_count)).toEqual([2, 1, 2]);
      // no identity value is selected
      expect(Object.keys(got[0])).toEqual(["id", "user_id", "exchange", "is_disconnected", "is_holder", "in_strategy_keys", "in_published_composite", "other_key_count", "key_ordinal"]);
    });

    it("census-keys.sql never includes the cross-owner marked key, the holders, the protected keys or the share-link key", () => {
      const ids = rows("tmpl", file("census-keys.sql")).map((r) => r.id);
      for (const decoy of [XD, X1, HA1, HA2, HB, M0]) expect(ids).not.toContain(decoy);
    });

    it("census-keys.sql flags a manifest key that became a holder, live, or a strategy_keys member", () => {
      const db = clone();
      psql(
        db,
        `UPDATE public.api_keys SET disconnected_at = NULL WHERE id = ${q(D1)};
         INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, account_share_kind, account_shared_with_api_key_id)
           VALUES (${q(uid(900))}, ${q(OWNER_A)}, 'deribit', 'FIX-HOLDS', 'x', 'composite_member', ${q(D3)});
         INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq) VALUES (${q(S2)}, ${q(D2)}, ${q(OWNER_B)}, '2026-01-01', 0);`,
      );
      const got = Object.fromEntries(rows(db, file("census-keys.sql")).map((r) => [r.id, r]));
      expect(got[D1].is_disconnected).toBe(false);
      expect(got[D3].is_holder).toBe(true);
      expect(got[D2].in_strategy_keys).toBe(true);
      expect(got[D2].in_published_composite).toBe(false); // S2 is private
    });

    it("census-strategies.sql returns the two strategies on the manifest keys and no strategy_keys link", () => {
      const got = rows("tmpl", file("census-strategies.sql"));
      expect(got.map((r) => r.row_kind)).toEqual(["strategy", "strategy"]);
      expect(got.map((r) => r.id)).toEqual([S1, S2]); // ordered by user_id: owner A then owner B
      expect(got.map((r) => r.status)).toEqual(["published", "private"]);
      expect(got.map((r) => r.api_key_id)).toEqual([D1, D2]);
    });

    it("census-dependents.sql counts every foreign-key referencer, flags the unlisted ones, and reports the non-FK derived rows", () => {
      const got = rows("tmpl", file("census-dependents.sql"));
      const find = (kind: string, table: string, col: string, ref?: string) =>
        got.find((r) => r.row_kind === kind && r.referencing_table === table && r.column_name === col && (ref === undefined || r.references_table === ref));
      expect(find("fk", "allocator_holdings", "api_key_id")).toMatchObject({ on_delete: "RESTRICT", in_confirmed_list: true, rows_referencing: 4 });
      expect(find("fk", "csv_daily_returns", "api_key_id")).toMatchObject({ on_delete: "CASCADE", in_confirmed_list: true, rows_referencing: 2 });
      expect(find("fk", "csv_daily_returns", "strategy_id")).toMatchObject({ in_confirmed_list: true, rows_referencing: 1 });
      expect(find("fk", "trades", "strategy_id")).toMatchObject({ rows_referencing: 3 });
      expect(find("fk", "mt5_server_clock_readings", "api_key_id")).toMatchObject({ rows_referencing: 2 });
      expect(find("fk", "allocation_events", "strategy_id")).toMatchObject({ on_delete: "NO ACTION", in_confirmed_list: false, rows_referencing: 0 });
      expect(find("fk", "zz_unlisted_strategy_child", "strategy_id")).toMatchObject({ in_confirmed_list: false, rows_referencing: 0 });
      // the strategy-side SET NULL key is counted as the strategies sitting on the manifest keys
      expect(find("fk", "strategies", "api_key_id")).toMatchObject({ on_delete: "SET NULL", rows_referencing: 2 });
      // report-only rows: no foreign key cascades these
      expect(find("non_fk_derived", "allocator_equity_derived", "kind = key_inputs:<key id>")).toMatchObject({ rows_referencing: 2 });
      expect(find("non_fk_column", "zz_nofk_refs", "api_key_id")).toMatchObject({ rows_referencing: 1 });
      expect(find("non_fk_column", "zz_nofk_refs", "strategy_id")).toMatchObject({ rows_referencing: 1 });
      // a column that carries a foreign key is NOT reported as a non-FK column
      expect(find("non_fk_column", "trades", "strategy_id")).toBeUndefined();
    });

    it("census-triggers.sql shows the published-composite delete guard and the write-once trigger the cascade passes through", () => {
      const got = rows("tmpl", file("census-triggers.sql"));
      expect(got).toContainEqual(
        expect.objectContaining({ table_name: "api_keys", trigger_name: "api_keys_published_composite_delete_guard", timing: "BEFORE", events: "DELETE", granularity: "ROW" }),
      );
      expect(got).toContainEqual(
        expect.objectContaining({ table_name: "mt5_server_clock_readings", trigger_name: "mt5_server_clock_readings_write_once", events: "DELETE OR UPDATE" }),
      );
    });
  });

  describe("delete.sql: the exact manifest, nothing else", () => {
    it("deletes the manifest keys, their strategies and every dependent row, leaves every decoy byte-identical, and enqueues one recompose per owner", () => {
      const db = clone();
      const survivors = Object.fromEntries(TABLES.map((t) => [t, tableRows(db, t, SURVIVOR_WHERE[t])])) as Record<Table, string[]>;
      const beforeCounts = Object.fromEntries(TABLES.map((t) => [t, tableRows(db, t).length]));

      const res = runDelete(db);
      expect(res.status, `stderr=${res.stderr}`).toBe(0);
      // the post-COMMIT readout: no manifest key and no manifest strategy remains
      expect(res.stdout.trim()).toBe("0|0");
      expect(res.stderr).toContain("oneaccountonce delete: 3 keys, 2 strategies");

      for (const t of TABLES) {
        if (t === "compute_jobs") continue;
        expect(tableRows(db, t), `${t}: the survivors must be byte-identical and nothing else may remain`).toEqual(survivors[t]);
      }
      // dependents really were removed (and not merely absent from the fixture)
      expect(beforeCounts.api_keys - 3).toBe(tableRows(db, "api_keys").length);
      expect(beforeCounts.strategies - 2).toBe(tableRows(db, "strategies").length);
      expect(beforeCounts.allocator_holdings - DEPENDENTS_OF_KEYS.allocator_holdings).toBe(tableRows(db, "allocator_holdings").length);
      expect(beforeCounts.trades - DEPENDENTS_OF_STRATS.trades).toBe(tableRows(db, "trades").length);
      expect(beforeCounts.mt5_server_clock_readings - DEPENDENTS_OF_KEYS.mt5_server_clock_readings).toBe(tableRows(db, "mt5_server_clock_readings").length);

      // compute_jobs: the manifest's jobs went, the survivors stayed, and one new recompose per owner (A and B) arrived
      const after = tableRows(db, "compute_jobs");
      for (const s of survivors.compute_jobs) expect(after).toContain(s);
      const enqueued = psql(db, "SELECT allocator_id || ':' || kind FROM public.compute_jobs WHERE api_key_id IS NULL AND strategy_id IS NULL AND allocator_id IS NOT NULL ORDER BY 1;").trim().split("\n");
      expect(enqueued.filter((l) => l.endsWith(":derive_allocator_equity")).length).toBe(survivors.compute_jobs.filter((r) => r.includes("derive_allocator_equity")).length + 2);
      expect(enqueued).toContain(`${OWNER_A}:derive_allocator_equity`);
      expect(enqueued).toContain(`${OWNER_B}:derive_allocator_equity`);
      expect(enqueued.join("\n")).not.toContain(OWNER_C); // the cross-owner decoys' owner is never enqueued

      // the allocator_equity_derived rows no foreign key cascades are left alone (OQ-4: an owned follow-up, not a silent delete)
      expect(tableRows(db, "allocator_equity_derived").length).toBe(5);
      // the share link survives: the other owner's key on the same account is still there
      expect(psql(db, `SELECT count(*) FROM public.api_keys WHERE venue_account_id = 'acct-1';`).trim()).toBe("2");
    });

    it("a second run on the cleaned database aborts at discovery: the script is not repeatable by accident", () => {
      const db = clone();
      expect(runDelete(db).status).toBe(0);
      const before = state(db);
      const again = runDelete(db);
      expectAbort(db, before, again, "[B-discovery]", "pasted 3 key ids, discovery found 0");
    });
  });

  describe("delete.sql: every abort arm names its check and writes nothing", () => {
    it("extra key: a fourth same-owner duplicate exists that the pasted manifest omits [B-discovery]", () => {
      const db = clone();
      psql(
        db,
        `INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, disconnected_at, account_share_kind, account_shared_with_api_key_id)
           VALUES (${q(uid(901))}, ${q(OWNER_A)}, 'okx', 'FIX-D4', 'x', now(), 'duplicate', ${q(HA1)});`,
      );
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[B-discovery]", "pasted 3 key ids, discovery found 4");
    });

    it("missing id: the manifest pastes an id that does not exist [B-discovery]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { keys: [...KEYS, uid(999)].join(",") }), "[B-discovery]", "pasted 4 key ids, discovery found 3");
    });

    it("live key: one manifest key has disconnected_at NULL [C-key-state]", () => {
      const db = clone();
      psql(db, `UPDATE public.api_keys SET disconnected_at = NULL WHERE id = ${q(D1)};`);
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[C-key-state]", "is live");
    });

    it("holder key: another key names a manifest key as its holder [C-key-state]", () => {
      const db = clone();
      psql(
        db,
        `INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, account_share_kind, account_shared_with_api_key_id)
           VALUES (${q(uid(902))}, ${q(OWNER_A)}, 'deribit', 'FIX-HOLDS', 'x', 'composite_member', ${q(D3)});`,
      );
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[C-key-state]", "is a holder");
    });

    it("in strategy_keys: a manifest key is linked to a strategy [C-key-state]", () => {
      const db = clone();
      psql(db, `INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq) VALUES (${q(S2)}, ${q(D2)}, ${q(OWNER_B)}, '2026-01-01', 0);`);
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[C-key-state]", "strategy_keys");
    });

    it("protected key: a protected id is also in the manifest [C-key-state]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { prot: [D1, HB].join(",") }), "[C-key-state]", "is in the manifest");
    });

    it("protected key that does not exist: the fingerprint would be vacuous [D-protected]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { prot: [M0, uid(998)].join(",") }), "[D-protected]", "1 of 2 protected key ids exist");
    });

    it("strategy set differs: a third strategy sits on a manifest key [E-strategies]", () => {
      const db = clone();
      psql(
        db,
        `INSERT INTO public.strategies (id, user_id, api_key_id, name, status, asset_class, source)
           VALUES (${q(uid(210))}, ${q(OWNER_A)}, ${q(D3)}, 'Fixture strategy', 'draft', 'crypto', 'deribit');`,
      );
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[E-strategies]", "the sets differ");
    });

    it("a manifest strategy of another owner than its key [E-strategies]", () => {
      const db = clone();
      psql(db, `UPDATE public.strategies SET user_id = ${q(OWNER_C)} WHERE id = ${q(S1)};`);
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[E-strategies]", "different owner");
    });

    it("off-manifest blocking row: an allocation_events-like row with a NO ACTION foreign key to a manifest strategy [F-off-manifest]", () => {
      const db = clone();
      psql(db, `INSERT INTO public.allocation_events (strategy_id) VALUES (${q(S1)});`);
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[F-off-manifest]", "allocation_events");
    });

    it("off-manifest table the script never names: a CASCADE foreign key to strategies found only through pg_constraint [F-off-manifest]", () => {
      const db = clone();
      expect(deleteSql()).not.toContain("zz_unlisted_strategy_child");
      psql(db, `INSERT INTO public.zz_unlisted_strategy_child (strategy_id) VALUES (${q(S1)});`);
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[F-off-manifest]", "zz_unlisted_strategy_child");
    });

    it("deep cascade into an unlisted table: a CASCADE foreign key to the trades stand-in is caught before COMMIT by the transaction statistics [H-post-write]", () => {
      const db = clone();
      psql(db, `INSERT INTO public.zz_unlisted_trade_child (trade_id) SELECT id FROM public.trades WHERE strategy_id = ${q(S1)} ORDER BY id LIMIT 1;`);
      // vacuity: the deep row really hangs off a manifest strategy's trade, and the pg_constraint scan cannot see it
      expect(psql(db, `SELECT count(*) FROM public.zz_unlisted_trade_child c JOIN public.trades t ON t.id = c.trade_id WHERE t.strategy_id = ${q(S1)};`).trim()).toBe("1");
      expect(deleteSql()).not.toContain("zz_unlisted_trade_child");
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[H-post-write]", "zz_unlisted_trade_child");
    });

    it("track_counts off: check H would read all zeros, so the script refuses before any write [H-pre-write]", () => {
      const db = clone();
      const before = state(db);
      // A session-level SET (this harness connects as a superuser) puts the counters out, exactly as a project with track_counts off would.
      const res = psqlRaw(db, `SET track_counts = off;\n${fill(deleteSql())}`);
      expectAbort(db, before, res, "[H-pre-write]", "track_counts is off (not on)");
    });

    it("api_keys delete counter disagrees with the manifest: a trigger deletes one extra key, so the counter moves by 4, not 3 [H-post-write]", () => {
      const db = clone();
      // XD is a decoy (another owner's duplicate-marked key, no dependents). An AFTER DELETE trigger removes it when the first manifest key goes.
      // api_keys is in the confirmed list, so only the counter assertion can see it.
      psql(
        db,
        `CREATE FUNCTION public.zz_extra_key_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
           BEGIN DELETE FROM public.api_keys WHERE id = ${q(XD)}; RETURN NULL; END $$;
         CREATE TRIGGER zz_extra_key_delete AFTER DELETE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.zz_extra_key_delete();`,
      );
      expect(psql(db, `SELECT count(*) FROM public.api_keys WHERE id = ${q(XD)};`).trim()).toBe("1");
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[H-post-write]", "api_keys delete counter moved by 4 but the manifest holds 3 keys");
    });

    it("marker mismatch: EXPECTED_MARKER differs from the database's comment [A-marker]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { marker: "the production marker, which this cluster does not carry" }), "[A-marker]", "not the pasted expected marker");
    });

    it("marker lost: the database carries no comment at all [A-marker]", () => {
      const db = clone();
      psql(db, `COMMENT ON DATABASE ${db} IS NULL;`);
      const before = state(db);
      expectAbort(db, before, runDelete(db), "[A-marker]", "NULL or is not");
    });

    it("empty manifest: an empty key list aborts before any write [A-inputs]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { keys: "" }), "[A-inputs]", "MANIFEST_KEY_IDS is empty");
    });

    it("unfilled token: a literal placeholder aborts before any write [A-inputs]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { strats: null }), "[A-inputs]", "MANIFEST_STRATEGY_IDS still holds an unfilled placeholder token");
    });

    it("unfilled marker token aborts before any write [A-inputs]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { marker: null }), "[A-inputs]", "EXPECTED_MARKER is empty or an unfilled placeholder token");
    });

    it("a repeated id aborts before any write [A-inputs]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { keys: [D1, D2, D3, D1].join(",") }), "[A-inputs]", "repeats an id");
    });

    it("a NULL or malformed id aborts before any write [A-inputs]", () => {
      const db = clone();
      const before = state(db);
      expectAbort(db, before, runDelete(db, { keys: `${D1},NULL,${D3}` }), "[A-inputs]", "not a comma-separated list of uuids");
      expectAbort(db, before, runDelete(db, { keys: `${D1},,${D3}` }), "[A-inputs]", "not a comma-separated list of uuids");
    });
  });

  describe("delete.sql: the published-composite delete guard stays armed", () => {
    it("the guard really refuses a key delete when the bypass is off, so a run that keeps it off is protected", () => {
      const db = clone();
      // a published strategy linked to a key through strategy_keys: the real guard must refuse its direct delete
      psql(db, `INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq) VALUES (${q(S1)}, ${q(HA2)}, ${q(OWNER_A)}, '2026-01-01', 0);`);
      const res = psqlRaw(db, `DELETE FROM public.api_keys WHERE id = ${q(HA2)};`);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("cannot delete a key that is a member of a published composite");
    });

    it("delete.sql never sets any session setting of its own that could unlock a guard", () => {
      const sql = deleteSql();
      // the only settings the script writes are the transaction-local claims, nothing named quantalyze.*
      expect(sql).not.toContain("quantalyze.");
      const settings = [...sql.matchAll(/set_config\('([^']+)'/g)].map((m) => m[1]);
      expect(settings.length).toBeGreaterThan(0);
      expect(settings.every((s) => s === "request.jwt.claims")).toBe(true);
    });
  });
});
