/**
 * Phase 178 OKXREWRITE (review WR-02, silent-failure hunt M3): the P7 dead-key census and the
 * `crosswalk` form EXECUTED, on a throwaway local PostgreSQL cluster, against hand-computed
 * oracles.
 *
 * WHY. `marksource-okx-census-sql.test.ts` checks text: one statement, no comment, no write word,
 * a byte-equal key-group block. None of that fails when the grouping, the deciding-venue rule, the
 * state order, the dead-key test, the carry pad or the window-back drifts from
 * `_select_account_crawl_keys` / `_account_rebuild_window`. P7's `p7_outcome` decides which accounts
 * an irreversible PROD write may touch, so a wrong predicate must turn a committed test RED. The
 * plan 02 and plan 05 executors ran this exact check in a scratch directory and deleted it; this
 * file is that check, kept.
 *
 * HOW. Same mechanism as `accounttruth-census.test.ts` block (6): ask `scripts/pg-lane/run.sh
 * --print-pgbin` for the server binaries, boot a socket-only cluster of this file's own (no TCP
 * listener, trust auth, removed in afterAll). No skip gate: with no binaries beforeAll THROWS.
 * ⛔ Never TEST, never PROD: the cluster is initdb'd here and its marker is a local string.
 *
 * THE CLOCK IS FROZEN. Both statements read `now()`. A `public.now()` earlier in the database's
 * search_path shadows `pg_catalog.now()`, so every date below is absolute and the oracles do not
 * rot with the calendar. A vacuity test proves the shadow is live: without it the fixture dates
 * are meaningless.
 *
 * ORACLES ARE HAND-COMPUTED from the fixture's dates (windows, spans and ages come from
 * `daysBetween` below, not from the statement), never copied from its output.
 *
 * Stand-in tables carry only the columns the statements name, with real types.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const P7_FILE = join(REPO, "docs", "runbooks", "marksource-okx-census", "okx-nonworking-keys.sql");
const RUNBOOK = join(REPO, "docs", "runbooks", "marksource-okx-history-correction.md");

const LOCAL_MARKER = "nonworking-keys exec gate. Throwaway cluster, not TEST, not PROD.";
const TODAY = "2026-10-29";

const STAND_IN_DDL = `
CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT TIMESTAMPTZ '${TODAY} 12:00:00+00' $$;
ALTER DATABASE postgres SET search_path = public, pg_catalog;
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  exchange text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sync_status text,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL,
  account_share_kind text,
  account_shared_with_api_key_id uuid
);
CREATE TABLE public.allocator_holdings (
  api_key_id uuid NOT NULL,
  asof date NOT NULL
);
CREATE TABLE public.allocator_equity_snapshots (
  allocator_id uuid NOT NULL,
  asof date NOT NULL,
  reconstructed_at timestamptz NOT NULL
);
CREATE TABLE public.audit_log (
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE public.compute_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  metadata jsonb,
  error_kind text,
  attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE public.enq_log (
  api_key_id uuid NOT NULL,
  kind text NOT NULL,
  metadata jsonb NOT NULL
);
CREATE FUNCTION public.enqueue_compute_job(p_strategy_id uuid, p_kind text, p_api_key_id uuid, p_metadata jsonb)
  RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.enq_log (api_key_id, kind, metadata) VALUES (p_api_key_id, p_kind, p_metadata) RETURNING gen_random_uuid()
$$;
COMMENT ON DATABASE postgres IS '${LOCAL_MARKER}';
`;

/** Whole days from `from` to `to` (both YYYY-MM-DD, UTC). Independent of the statement under test. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Every YYYY-MM-DD from `from` to `to` inclusive. */
function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = 0; n <= daysBetween(from, to); n += 1) {
    out.push(new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

const uid = (owner: number, n: number) => `00000000-0000-4000-8000-${String(owner * 100 + n).padStart(12, "0")}`;

type FixtureKey = {
  n: number;
  exchange: string;
  sync_status?: string | null;
  is_active?: boolean;
  disconnected?: boolean;
  marks?: { n: number; kind: "duplicate" | "composite_member" };
  holdings?: [string, string];
};

/** One audit_log row of the owner about the key `uid(owner, key)`; `key` >= 90 names a key with NO api_keys row (hard-deleted). */
type FixtureAudit = { key: number; on: string; action?: string; entityType?: string };

type FixtureOwner = {
  owner: number;
  keys: FixtureKey[];
  audit?: FixtureAudit[];
  /** Stored snapshot days, each with its own reconstructed_at (never written in bulk). */
  snapshots?: string[];
  /** Stored snapshot days sharing ONE reconstructed_at (a bulk write: more than 5 rows). */
  bulkSnapshots?: string[];
};

/**
 * Owners are created in this order, so census labels run a1.. over the owners holding an OKX key
 * (owner 0 holds Bybit only: it shifts every probe label by one and has no census label).
 */
const OWNERS: FixtureOwner[] = [
  { owner: 0, keys: [{ n: 1, exchange: "bybit" }] },
  // a1: dead Bybit key, holdings ended long before the window: nothing overlaps.
  {
    owner: 1,
    keys: [{ n: 1, exchange: "okx" }, { n: 2, exchange: "bybit", sync_status: "revoked", holdings: ["2026-05-01", "2026-07-15"] }],
    snapshots: dayRange("2026-08-01", "2026-08-10"),
    // WR-R2-02 controls: its own present key polled inside the pad, and a deleted key whose last poll is one day
    // BEFORE the pad's first day (2026-07-24 = today - 89 - 8): neither may count.
    audit: [
      { key: 1, on: "2026-10-01" },
      { key: 91, on: "2026-07-23" },
    ],
  },
  // a2: dead Bybit key whose holdings run inside the window: the carry span overlaps stored days.
  {
    owner: 2,
    keys: [{ n: 1, exchange: "okx" }, { n: 2, exchange: "bybit", sync_status: "revoked", holdings: ["2026-08-01", "2026-09-01"] }],
    snapshots: dayRange("2026-08-01", "2026-09-10"),
  },
  // a3: a two-hop marker chain of Bybit keys, the holder working: no dead key at all.
  {
    owner: 3,
    keys: [
      { n: 1, exchange: "okx" },
      { n: 2, exchange: "bybit" },
      { n: 3, exchange: "bybit", sync_status: "revoked", marks: { n: 2, kind: "duplicate" } },
      { n: 4, exchange: "bybit", sync_status: "revoked", marks: { n: 3, kind: "composite_member" } },
    ],
  },
  // a4: the only OKX key is dead, a Bybit key works: window 730, overlap measured over 729 days back.
  {
    owner: 4,
    keys: [{ n: 1, exchange: "okx", sync_status: "revoked", holdings: ["2025-01-05", "2025-01-10"] }, { n: 2, exchange: "bybit" }],
    snapshots: dayRange("2025-01-01", "2025-01-20"),
  },
  // a5: a Deribit account ($0) and one exchange account whose working keys sit on two venues (refused).
  {
    owner: 5,
    keys: [
      { n: 1, exchange: "okx" },
      { n: 2, exchange: "deribit" },
      { n: 3, exchange: "bybit", marks: { n: 4, kind: "duplicate" } },
      { n: 4, exchange: "binance" },
    ],
  },
  // a6: two dead accounts on other venues; only the MT5 one has holdings.
  {
    owner: 6,
    keys: [
      { n: 1, exchange: "okx" },
      { n: 2, exchange: "mt5", sync_status: "revoked", holdings: ["2026-09-01", "2026-09-10"] },
      { n: 3, exchange: "sfox", sync_status: "revoked" },
    ],
    snapshots: dayRange("2026-09-01", "2026-09-24"),
  },
  // a7: every stored in-window day was written in bulk, a dead key present: not decidable by holdings.
  {
    owner: 7,
    keys: [{ n: 1, exchange: "okx" }, { n: 2, exchange: "bybit", sync_status: "revoked", holdings: ["2026-04-01", "2026-06-30"] }],
    bulkSnapshots: dayRange("2026-08-01", "2026-08-10"),
  },
  // a8: the only OKX key is inactive and disconnected: it has a census label and no probe label.
  { owner: 8, keys: [{ n: 1, exchange: "okx", is_active: false, disconnected: true }] },
  // a9: a dead Bybit member marked as part of a WORKING OKX account. The account is crawled through
  // the OKX key, so it is no dead exchange account, but the member's own balance is unreadable: a
  // dead KEY (no working same-venue sibling), and its holdings span overlaps stored days.
  {
    owner: 9,
    keys: [
      { n: 1, exchange: "okx" },
      { n: 2, exchange: "bybit", sync_status: "revoked", marks: { n: 1, kind: "composite_member" }, holdings: ["2026-08-05", "2026-08-20"] },
    ],
    snapshots: dayRange("2026-08-01", "2026-08-31"),
  },
  // a10 (review CR-01): the dead key's holdings ended on 2026-07-10, so a 7-day carry cannot reach any
  // stored in-window day. But the refresh carried an eligible failing key with NO age cap from
  // v0.111.0.0 (2026-09-29) until v0.132.5.0 (2026-10-19, `CARRY_AGE_CAP_DAYS` = 7), so the rows
  // labelled 2026-09-29 .. 2026-10-19 may hold its July balance. Days either side of that era
  // (08-01, 09-28, 10-20, 10-25) must NOT count; the three inside it (09-29, 10-01, 10-19) must.
  {
    owner: 10,
    keys: [{ n: 1, exchange: "okx" }, { n: 2, exchange: "bybit", sync_status: "revoked", holdings: ["2026-05-01", "2026-07-10"] }],
    snapshots: ["2026-08-01", "2026-09-28", "2026-09-29", "2026-10-01", "2026-10-19", "2026-10-20", "2026-10-25"],
  },
  // a11 (review WR-R2-02): one working OKX key, no dead key, nothing stored: without the audit trace P7 reads
  // `rebuild`. Its allocator's polls wrote audit rows about keys that are no longer in api_keys (hard-deleted
  // with their holdings, which leaves no other trace):
  //   key 91: two rows (completed and failed) -> ONE distinct deleted key;
  //   key 92: a row on 2026-07-24, the pad's first day (today - 89 - 8) -> counts;
  //   key 93: an equity action, not a holdings poll -> not counted;
  //   key 94: entity_type 'strategy', not an api_key -> not counted.
  {
    owner: 11,
    keys: [{ n: 1, exchange: "okx" }],
    audit: [
      { key: 91, on: "2026-10-01" },
      { key: 91, on: "2026-10-02", action: "allocator.holdings.sync_failed" },
      { key: 92, on: "2026-07-24" },
      { key: 93, on: "2026-10-01", action: "allocator.equity.reconstruct_started" },
      { key: 94, on: "2026-10-01", entityType: "strategy" },
    ],
  },
];

function lit(v: string | boolean | null | undefined): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${v.replace(/'/g, "''")}'`;
}

/** The seed statements for the fixture: keys, holdings spans, stored snapshot days. */
function seedSql(owners: FixtureOwner[]): string {
  const out: string[] = [];
  for (const o of owners) {
    // Owners are created a day apart (owner 0 first); keys within an owner an hour apart.
    const base = Date.parse("2026-01-01T00:00:00Z") + o.owner * 86_400_000;
    for (const k of o.keys) {
      const createdAt = new Date(base + k.n * 3_600_000).toISOString();
      out.push(
        "INSERT INTO public.api_keys (id, user_id, exchange, is_active, sync_status, disconnected_at, created_at, account_share_kind, account_shared_with_api_key_id) VALUES " +
          `(${lit(uid(o.owner, k.n))}, ${lit(uid(o.owner, 0))}, ${lit(k.exchange)}, ${lit(k.is_active ?? true)}, ${lit(k.sync_status ?? null)}, ` +
          `${k.disconnected ? "TIMESTAMPTZ '2026-09-01 00:00:00+00'" : "NULL"}, ${lit(createdAt)}, ` +
          `${lit(k.marks?.kind ?? null)}, ${lit(k.marks ? uid(o.owner, k.marks.n) : null)});`,
      );
    }
    for (const k of o.keys) {
      if (k.holdings) {
        out.push(
          "INSERT INTO public.allocator_holdings (api_key_id, asof) " +
            `SELECT ${lit(uid(o.owner, k.n))}, d::date FROM generate_series(${lit(k.holdings[0])}::date, ${lit(k.holdings[1])}::date, '1 day') d;`,
        );
      }
    }
    for (const a of o.audit ?? []) {
      out.push(
        "INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, created_at) VALUES " +
          `(${lit(uid(o.owner, 0))}, ${lit(a.action ?? "allocator.holdings.sync_completed")}, ${lit(a.entityType ?? "api_key")}, ` +
          `${lit(uid(o.owner, a.key))}, ${lit(`${a.on} 04:30:00+00`)}::timestamptz);`,
      );
    }
    for (const asof of o.snapshots ?? []) {
      out.push(
        "INSERT INTO public.allocator_equity_snapshots (allocator_id, asof, reconstructed_at) VALUES " +
          `(${lit(uid(o.owner, 0))}, ${lit(asof)}, ${lit(asof)}::date + TIME '05:00');`,
      );
    }
    for (const asof of o.bulkSnapshots ?? []) {
      out.push(
        "INSERT INTO public.allocator_equity_snapshots (allocator_id, asof, reconstructed_at) VALUES " +
          `(${lit(uid(o.owner, 0))}, ${lit(asof)}, TIMESTAMPTZ '2026-08-20 00:00:00+00');`,
      );
    }
  }
  return out.join("\n");
}

type Row = Record<string, string | number | null>;

/** P7's columns for one a-label, in the statement's order. */
function p7Row(label: string, v: Omit<Row, "account_label">): Row {
  return { account_label: label, ...v };
}

const ZERO_P7 = {
  zero_contribution_accounts: 0,
  refused_exchange_accounts: 0,
  dead_okx_accounts: 0,
  dead_bybit_accounts: 0,
  dead_mt5_accounts: 0,
  dead_binance_accounts: 0,
  dead_other_accounts: 0,
  crawled_other_accounts: 0,
  in_window_days_written_in_bulk: 0,
  deleted_keys_seen_in_window: 0,
} as const;

/**
 * P7's expected rows. Window arithmetic (today 2026-10-29):
 *   predicted window 90 reads stored days from today - 89 = 2026-07-31; 730 reads from today - 729
 *   (a crawled Bybit account remains) or today - 730 (nothing crawled).
 *   A dead key's holdings span [first - 1, last + 7] days overlaps those stored in-window days.
 */
const P7_EXPECTED_NO_DIGEST: Row[] = [
  // a1: span [2026-04-30, 2026-07-22] ends before the window starts.
  p7Row("a1", {
    ...ZERO_P7, keys_total: 2, exchange_accounts: 2, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 1, dead_bybit_accounts: 1, dead_keys: 1, predicted_window_days: 90,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2026-07-15", TODAY),
    in_window_days_overlapping_dead_key_holdings: 0, p7_outcome: "rebuild",
  }),
  // a2: span [2026-07-31, 2026-09-08]; stored 2026-08-01..2026-09-10 -> 08-01..09-08 overlap.
  p7Row("a2", {
    ...ZERO_P7, keys_total: 2, exchange_accounts: 2, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 1, dead_bybit_accounts: 1, dead_keys: 1, predicted_window_days: 90,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2026-09-01", TODAY),
    in_window_days_overlapping_dead_key_holdings: dayRange("2026-08-01", "2026-09-08").length,
    p7_outcome: "not recomputed (D-06)",
  }),
  // a3: three Bybit keys chained by markers form ONE account with a working holder: no dead key.
  p7Row("a3", {
    ...ZERO_P7, keys_total: 4, exchange_accounts: 2, crawled_okx_accounts: 1, crawled_bybit_accounts: 1,
    dead_exchange_accounts: 0, dead_keys: 0, predicted_window_days: 90,
    dead_keys_with_holdings: 0, dead_key_last_holdings_age_days: null,
    in_window_days_overlapping_dead_key_holdings: 0, p7_outcome: "rebuild",
  }),
  // a4: window 730 (Bybit crawled, OKX dead); span [2025-01-04, 2025-01-17] is inside 2024-10-31..
  p7Row("a4", {
    ...ZERO_P7, keys_total: 2, exchange_accounts: 2, crawled_okx_accounts: 0, crawled_bybit_accounts: 1,
    dead_exchange_accounts: 1, dead_okx_accounts: 1, dead_keys: 1, predicted_window_days: 730,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2025-01-10", TODAY),
    in_window_days_overlapping_dead_key_holdings: dayRange("2025-01-04", "2025-01-17").length,
    p7_outcome: "not recomputed (D-06)",
  }),
  // a5: Deribit counts $0; the two-venue working group is refused; nothing is dead.
  p7Row("a5", {
    ...ZERO_P7, keys_total: 4, exchange_accounts: 3, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    zero_contribution_accounts: 1, refused_exchange_accounts: 1,
    dead_exchange_accounts: 0, dead_keys: 0, predicted_window_days: 90,
    dead_keys_with_holdings: 0, dead_key_last_holdings_age_days: null,
    in_window_days_overlapping_dead_key_holdings: 0, p7_outcome: "rebuild",
  }),
  // a6: MT5 span [2026-08-31, 2026-09-17] over stored 09-01..09-24 -> 09-01..09-17; sfox is dead too.
  p7Row("a6", {
    ...ZERO_P7, keys_total: 3, exchange_accounts: 3, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 2, dead_mt5_accounts: 1, dead_other_accounts: 1, dead_keys: 2, predicted_window_days: 90,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2026-09-10", TODAY),
    in_window_days_overlapping_dead_key_holdings: dayRange("2026-09-01", "2026-09-17").length,
    p7_outcome: "not recomputed (D-06)",
  }),
  // a7: no non-bulk overlap, but ten in-window days were written in bulk with a dead key present.
  p7Row("a7", {
    ...ZERO_P7, keys_total: 2, exchange_accounts: 2, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 1, dead_bybit_accounts: 1, dead_keys: 1, predicted_window_days: 90,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2026-06-30", TODAY),
    in_window_days_overlapping_dead_key_holdings: 0, in_window_days_written_in_bulk: 10,
    p7_outcome: "not recomputed (D-06)",
  }),
  // a8: one dead OKX account and nothing crawled: window 730, no holdings, nothing stored.
  p7Row("a8", {
    ...ZERO_P7, keys_total: 1, exchange_accounts: 1, crawled_okx_accounts: 0, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 1, dead_okx_accounts: 1, dead_keys: 1, predicted_window_days: 730,
    dead_keys_with_holdings: 0, dead_key_last_holdings_age_days: null,
    in_window_days_overlapping_dead_key_holdings: 0, p7_outcome: "rebuild",
  }),
  // a9: span [2026-08-04, 2026-08-27] over stored 08-01..08-31 -> 24 days; no dead exchange account.
  p7Row("a9", {
    ...ZERO_P7, keys_total: 2, exchange_accounts: 1, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 0, dead_keys: 1, predicted_window_days: 90,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2026-08-20", TODAY),
    in_window_days_overlapping_dead_key_holdings: dayRange("2026-08-04", "2026-08-27").length,
    p7_outcome: "not recomputed (D-06)",
  }),
  // a10 (CR-01): 3 stored days inside the uncapped-carry era 2026-09-29 .. 2026-10-19 overlap.
  p7Row("a10", {
    ...ZERO_P7, keys_total: 2, exchange_accounts: 2, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 1, dead_bybit_accounts: 1, dead_keys: 1, predicted_window_days: 90,
    dead_keys_with_holdings: 1, dead_key_last_holdings_age_days: daysBetween("2026-07-10", TODAY),
    in_window_days_overlapping_dead_key_holdings: 3, p7_outcome: "not recomputed (D-06)",
  }),
  // a11 (WR-R2-02): no dead key, nothing stored, but two distinct deleted keys left holdings-poll audit rows in the pad.
  p7Row("a11", {
    ...ZERO_P7, keys_total: 1, exchange_accounts: 1, crawled_okx_accounts: 1, crawled_bybit_accounts: 0,
    dead_exchange_accounts: 0, dead_keys: 0, predicted_window_days: 90,
    dead_keys_with_holdings: 0, dead_key_last_holdings_age_days: null,
    in_window_days_overlapping_dead_key_holdings: 0, deleted_keys_seen_in_window: 2,
    p7_outcome: "not recomputed (D-06)",
  }),
];

/**
 * The key-set digest the worker computes (`_account_keys_digest`) and P7 prints (review WR-R3-01),
 * from the FIXTURE and not from the statement: every key of the owner, sorted by the id's text in
 * byte order, each `<id>:<t or f>` (t = active, not disconnected, sync_status NULL or none of
 * revoked / sign_in_failed / error), joined by `|`, hashed with MD5.
 */
const isWorking = (k: FixtureKey) =>
  (k.is_active ?? true) && !k.disconnected && !["revoked", "sign_in_failed", "error"].includes(k.sync_status ?? "");
const fixtureDigest = (owner: number): string => {
  const o = OWNERS.find((x) => x.owner === owner)!;
  const canonical = o.keys
    .map((k) => `${uid(o.owner, k.n)}:${isWorking(k) ? "t" : "f"}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("|");
  return createHash("md5").update(canonical, "utf8").digest("hex");
};

const P7_EXPECTED: Row[] = P7_EXPECTED_NO_DIGEST.map((r) => ({ ...r, key_digest: fixtureDigest(Number(String(r.account_label).slice(1))) }));

/** Strip the trailing semicolon so a statement can sit inside a subquery. */
function asSubquery(sql: string): string {
  return sql.trimEnd().replace(/;\s*$/, "");
}

describe("okx-nonworking-keys.sql and the crosswalk form, EXECUTED on a throwaway cluster (Phase 178 WR-02)", () => {
  let root = "";
  let pgbin = "";
  let started = false;

  const harnessEnv: Record<string, string | undefined> = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };
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

  /** Runs one statement and returns its rows as objects, in the statement's own order. */
  function rows(statement: string): Row[] {
    const out = psql(`SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM (${asSubquery(statement)}) p;`);
    return JSON.parse(out.trim()) as Row[];
  }

  beforeAll(() => {
    const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
    if (sel.status !== 0 || sel.stdout.trim() === "") {
      throw new Error(
        "nonworking-keys exec gate: no PostgreSQL server binaries. `bash scripts/pg-lane/run.sh --print-pgbin` said:\n" + sel.stderr,
      );
    }
    pgbin = sel.stdout.trim();
    // /tmp, not os.tmpdir(): the socket path must stay under the ~104-byte sun_path limit.
    root = mkdtempSync("/tmp/nwk-");
    const data = join(root, "pgd");
    pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
    writeFileSync(
      join(data, "postgresql.conf"),
      `${readFileSync(join(data, "postgresql.conf"), "utf8")}\nlisten_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`,
    );
    // Set BEFORE the start: a start that times out can still bring the postmaster up late.
    started = true;
    pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
    psql(STAND_IN_DDL);
    psql(seedSql(OWNERS));
  }, 90000);

  afterAll(() => {
    if (started) spawnSync(join(pgbin, "pg_ctl"), ["-D", join(root, "pgd"), "-m", "immediate", "-w", "stop"], { env: HARNESS_ENV });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("the frozen clock is live: the statements read the fixture's today, not the calendar's (vacuity guard)", () => {
    expect(psql("SELECT (now() AT TIME ZONE 'UTC')::date;").trim()).toBe(TODAY);
  });

  it("the fixture seeded every owner (vacuity guard)", () => {
    expect(psql("SELECT count(DISTINCT user_id) FROM public.api_keys;").trim()).toBe(String(OWNERS.length));
  });

  describe("P7 (okx-nonworking-keys.sql)", () => {
    const got = () => rows(readFileSync(P7_FILE, "utf8"));

    it("prints exactly the fixture's a-labels, in order", () => {
      expect(got().map((r) => r.account_label)).toEqual(P7_EXPECTED.map((r) => r.account_label));
    });

    it.each(P7_EXPECTED.map((r) => [r.account_label as string, r] as const))(
      "%s: every column equals the hand-computed oracle",
      (label, expected) => {
        const row = got().find((r) => r.account_label === label);
        expect(row, `P7 printed no row for ${label}`).toBeDefined();
        expect(row).toEqual(expected);
      },
    );
  });

  describe("the key-set digest (review WR-R3-01)", () => {
    // The SAME literal the worker's pytest pins (`test_the_key_set_digest_has_the_canonical_form_the_sql_side_reproduces`):
    // the canonical string key-a:t|key-b:f|key-c:f|key-d:t|key-e:f. The rows are fed in a scrambled order so the
    // ORDER BY inside the aggregate is what produces the canonical order.
    const PINNED_CANONICAL = "key-a:t|key-b:f|key-c:f|key-d:t|key-e:f";
    const PINNED_DIGEST = "b686b2e1962180296772b08bb7e395c1";

    it("the pinned literal is the MD5 of the canonical string (the pin is not itself wrong)", () => {
      expect(createHash("md5").update(PINNED_CANONICAL, "utf8").digest("hex")).toBe(PINNED_DIGEST);
    });

    it("the digest expression in okx-nonworking-keys.sql, executed over the pinned key list, equals the worker's literal", () => {
      const sql = readFileSync(P7_FILE, "utf8");
      const m = sql.match(/\n(md5\(string_agg\([^\n]*\)\)) AS key_digest\n/) ?? sql.match(/ (md5\(string_agg\([^\n]*\)\)) AS key_digest\n/);
      expect(m, "okx-nonworking-keys.sql must carry the md5(string_agg(...)) AS key_digest expression").not.toBeNull();
      const out = psql(
        `SELECT ${m![1]} FROM (VALUES ('key-d', true), ('key-a', true), ('key-e', false), ('key-c', false), ('key-b', false)) AS u(id, working);`,
      ).trim();
      expect(out).toBe(PINNED_DIGEST);
    });
  });

  describe("enqueue form (the runbook's one write), against a recording stand-in for enqueue_compute_job", () => {
    const runbook = readFileSync(RUNBOOK, "utf8");
    const enqueueForm = (() => {
      const m = runbook.match(/<!-- form: enqueue -->\n```sql\n([\s\S]*?)\n```/);
      if (!m) throw new Error("the runbook carries no enqueue form");
      return m[1];
    })();
    const T0 = "2026-10-29T10:00:00Z";
    const allLabels = OWNERS.filter((o) => o.owner > 0).map((o) => o.owner);

    /** The form with the placeholders a hand-built `values` list stands in for (bypasses the renderer's guard on purpose). */
    const withValues = (labels: number[], values: Array<[number, number, number, string]>) =>
      enqueueForm
        .split("__MARKER__").join(`$m$${LOCAL_MARKER}$m$`)
        .split("__LABELS__").join(`ARRAY[${labels.join(",")}]::bigint[]`)
        .split("__T0__").join(`'${T0}'::timestamptz`)
        .split("__EXPECTED__").join(values.map((v) => `(${v[0]},${v[1]},${v[2]},'${v[3]}')`).join(","));

    type Logged = Array<{ user_id: string; metadata: Record<string, unknown> }>;
    const run = (sql: string): Logged => {
      psql("TRUNCATE public.enq_log;");
      psql(sql);
      return JSON.parse(
        psql(
          "SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', k.user_id, 'metadata', l.metadata)), '[]'::jsonb) " +
            "FROM public.enq_log l JOIN public.api_keys k ON k.id = l.api_key_id;",
        ).trim(),
      ) as Logged;
    };
    const ownerOf = (e: Logged[number]) => OWNERS.find((o) => uid(o.owner, 0) === e.user_id)!.owner;
    const p7ByLabel = () => new Map(rows(readFileSync(P7_FILE, "utf8")).map((r) => [r.account_label as string, r] as const));

    it("passes each label's rendered P7 dead_exchange_accounts and predicted_window_days as JSON numbers and its key_digest as a JSON string", () => {
      const p7 = p7ByLabel();
      const values = allLabels.map((n) => [n, p7.get(`a${n}`)!.dead_exchange_accounts, p7.get(`a${n}`)!.predicted_window_days, p7.get(`a${n}`)!.key_digest] as [number, number, number, string]);
      const logged = run(withValues(allLabels, values));
      // a8's only OKX key is inactive, so it has no job key and no job: every other label has one.
      expect(logged.length).toBe(allLabels.filter((n) => n !== 8).length);
      for (const entry of logged) {
        const row = p7.get(`a${ownerOf(entry)}`)!;
        expect(entry.metadata, `a${ownerOf(entry)}`).toEqual({
          force_rebuild: true,
          expected_non_working_accounts: row.dead_exchange_accounts,
          expected_window_days: row.predicted_window_days,
          expected_key_digest: row.key_digest,
        });
        expect(typeof entry.metadata.expected_non_working_accounts, `a${ownerOf(entry)}: a JSON number`).toBe("number");
        expect(typeof entry.metadata.expected_window_days, `a${ownerOf(entry)}: a JSON number`).toBe("number");
        expect(typeof entry.metadata.expected_key_digest, `a${ownerOf(entry)}: a JSON string`).toBe("string");
      }
    });

    it("does not target a label whose live count or window differs from the rendered P7 reading (review WR-R2-01, SFH R2-3)", () => {
      const p7 = p7ByLabel();
      const moved = new Map<number, [number, number]>([
        [6, [1, 90]], // live 2 dead accounts, rendered 1: a key went dead after the reading
        [3, [1, 90]], // live 0, rendered 1: a dead key revived
        [2, [1, 730]], // live window 90, rendered 730: an OKX sibling left the keys
        [9, [0, 730]], // both columns agree on dead (0), only the window moved
      ]);
      const values = allLabels.map((n) => {
        const [dead, win] = moved.get(n) ?? [p7.get(`a${n}`)!.dead_exchange_accounts as number, p7.get(`a${n}`)!.predicted_window_days as number];
        return [n, dead, win, p7.get(`a${n}`)!.key_digest as string] as [number, number, number, string];
      });
      const targeted = run(withValues(allLabels, values)).map(ownerOf).sort((x, y) => x - y);
      const expected = allLabels.filter((n) => n !== 8 && !moved.has(n));
      expect(targeted).toEqual(expected);
      for (const n of moved.keys()) expect(targeted, `a${n} moved off the rendered reading and must not be targeted`).not.toContain(n);
    });

    it("does not target a label whose key set moved while both counts stayed put: a key that went dead, and a hard-deleted working key (review WR-R3-01)", () => {
      const before = p7ByLabel();
      const values = allLabels.map((n) => [n, before.get(`a${n}`)!.dead_exchange_accounts, before.get(`a${n}`)!.predicted_window_days, before.get(`a${n}`)!.key_digest] as [number, number, number, string]);
      // a5 holds a Deribit key (a $0 account, never a dead exchange account) beside a refused two-venue group.
      // Changing or removing it moves neither the dead-account count nor the window, which is exactly what
      // two counts cannot see and the key digest can.
      const scenarios: Array<[string, string, string]> = [
        ["a working key goes error", `UPDATE public.api_keys SET sync_status = 'error' WHERE id = '${uid(5, 2)}';`, `UPDATE public.api_keys SET sync_status = NULL WHERE id = '${uid(5, 2)}';`],
        [
          "a working key is hard-deleted",
          `CREATE TABLE public.api_keys_bak AS SELECT * FROM public.api_keys WHERE id = '${uid(5, 2)}'; DELETE FROM public.api_keys WHERE id = '${uid(5, 2)}';`,
          "INSERT INTO public.api_keys SELECT * FROM public.api_keys_bak; DROP TABLE public.api_keys_bak;",
        ],
      ];
      for (const [name, apply, restore] of scenarios) {
        psql(apply);
        try {
          const after = p7ByLabel();
          expect(after.get("a5")!.dead_exchange_accounts, `${name}: vacuity, the dead-account count did not move`).toBe(before.get("a5")!.dead_exchange_accounts);
          expect(after.get("a5")!.predicted_window_days, `${name}: vacuity, the window did not move`).toBe(before.get("a5")!.predicted_window_days);
          expect(after.get("a5")!.key_digest, `${name}: vacuity, the digest must see the change the counts cannot`).not.toBe(before.get("a5")!.key_digest);
          const targeted = run(withValues(allLabels, values)).map(ownerOf);
          expect(targeted, `${name}: a5's key set moved after the reading, so it must not be targeted`).not.toContain(5);
          expect(targeted, `${name}: a label whose key set did not move is still targeted`).toContain(1);
          expect(targeted).toContain(3);
        } finally {
          psql(restore);
        }
        expect(p7ByLabel().get("a5")!.key_digest, `${name}: the fixture is restored`).toBe(before.get("a5")!.key_digest);
      }
    });

    it("end to end: the runbook's renderer fills __EXPECTED__ from the real P7 csv and the job carries the CSV's reading", () => {
      const heredoc = runbook.match(/cat > "\$MS_SP\/form\.mjs" <<'JS'\n([\s\S]*?)\nJS\n/);
      if (!heredoc) throw new Error("the runbook carries no form.mjs heredoc");
      const sp = join(root, "sp");
      mkdirSync(sp);
      writeFileSync(join(sp, "form.mjs"), heredoc[1] + "\n");
      const csv = spawnSync(
        join(pgbin, "psql"),
        ["-h", root, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-X", "--csv", "-f", P7_FILE],
        { encoding: "utf8", env: HARNESS_ENV },
      );
      expect(csv.status, csv.stderr).toBe(0);
      writeFileSync(join(sp, "p7-before-enqueue.csv"), csv.stdout);
      // The renderer refuses a re-run file older than MS_T0: stamp it as a B'3a re-run taken a minute after t0.
      const rerunAt = new Date(Date.parse(T0) + 60_000);
      utimesSync(join(sp, "p7-before-enqueue.csv"), rerunAt, rerunAt);
      // The labels a P7 re-run lets through: outcome rebuild at window 90.
      const chosen = [...p7ByLabel().values()]
        .filter((r) => r.p7_outcome === "rebuild" && r.predicted_window_days === 90)
        .map((r) => Number(String(r.account_label).slice(1)));
      expect(chosen, "vacuity: the fixture must offer more than one rebuildable label").toEqual([1, 3, 5]);
      const rendered = spawnSync(process.execPath, [join(sp, "form.mjs"), "enqueue"], {
        cwd: REPO,
        env: { ...process.env, MS_SP: sp, MS_LABELS: chosen.join(","), MS_T0: T0, MS_DEPLOYED_AT: "" },
        encoding: "utf8",
      });
      expect(rendered.status, rendered.stderr).toBe(0);
      const prodMarker = (JSON.parse(readFileSync(join(REPO, "scripts", "prod-prober", "cron-manifest.json"), "utf8")) as { database_marker: string }).database_marker;
      const sql = rendered.stdout.split(`$m$${prodMarker}$m$`).join(`$m$${LOCAL_MARKER}$m$`);
      expect(sql.includes(prodMarker), "the production marker must be swapped out before running on the throwaway cluster").toBe(false);
      const logged = run(sql);
      const p7 = p7ByLabel();
      expect(logged.map(ownerOf).sort((x, y) => x - y)).toEqual(chosen);
      for (const entry of logged) {
        const row = p7.get(`a${ownerOf(entry)}`)!;
        expect(entry.metadata).toEqual({
          force_rebuild: true,
          expected_non_working_accounts: row.dead_exchange_accounts,
          expected_window_days: 90,
          expected_key_digest: row.key_digest,
        });
      }
    });
  });

  describe("newjob form (B'3c), expectation_armed (review SFH R2-1)", () => {
    const form = (() => {
      const m = readFileSync(RUNBOOK, "utf8").match(/<!-- form: newjob -->\n```sql\n([\s\S]*?)\n```/);
      if (!m) throw new Error("the runbook carries no newjob form");
      return m[1]
        .split("__MARKER__").join(`$m$${LOCAL_MARKER}$m$`)
        .split("__LABELS__").join("ARRAY[1,2,3,5,6,7,9]::bigint[]")
        .split("__T0__").join("'2026-10-29T10:00:00Z'::timestamptz");
    })();
    // Job keys, as the form chooses them (earliest working Bybit, else earliest working OKX):
    // a1 okx n1, a2 okx n1, a3 bybit n2, a5 bybit n3, a6 okx n1, a7 okx n1, a9 okx n1.
    const forcedJob = (key: string, metadata: string) =>
      `INSERT INTO public.compute_jobs (api_key_id, kind, status, created_at, metadata) VALUES ('${key}', 'reconstruct_allocator_history', 'pending', TIMESTAMPTZ '2026-10-29 10:05:00+00', '${metadata}'::jsonb);`;

    beforeAll(() => {
      psql(
        [
          forcedJob(uid(1, 1), '{"force_rebuild": true, "expected_non_working_accounts": 1, "expected_window_days": 90, "expected_key_digest": "00000000000000000000000000000000"}'),
          forcedJob(uid(2, 1), '{"force_rebuild": true, "expected_non_working_accounts": 1, "expected_key_digest": "00000000000000000000000000000000"}'),
          forcedJob(uid(3, 2), '{"force_rebuild": true, "expected_non_working_accounts": 0, "expected_window_days": 90}'),
          forcedJob(uid(5, 3), '{"force_rebuild": true, "expected_non_working_accounts": "0", "expected_window_days": 90, "expected_key_digest": "00000000000000000000000000000000"}'),
          forcedJob(uid(6, 1), '{"force_rebuild": true, "expected_non_working_accounts": 2, "expected_window_days": 90, "expected_key_digest": "00000000000000000000000000000000"}'),
          forcedJob(uid(6, 1), '{"force_rebuild": true}'),
          forcedJob(uid(9, 1), '{"force_rebuild": true, "expected_non_working_accounts": 0, "expected_window_days": 90, "expected_key_digest": 5}'),
        ].join("\n"),
      );
    });

    afterAll(() => {
      psql("TRUNCATE public.compute_jobs;");
    });

    it("is true only where every forced job since t0 carries both counts as numbers and the key digest as a string", () => {
      const got = new Map(rows(form).map((r) => [r.account_label as string, r] as const));
      const armed = (label: string) => got.get(label)?.expectation_armed;
      expect(armed("a1"), "both counts numeric and the digest a string").toBe(true);
      expect(armed("a2"), "the window key is absent").toBe(false);
      expect(armed("a3"), "the key digest is absent").toBe(false);
      expect(armed("a9"), "the key digest is the number 5").toBe(false);
      expect(armed("a5"), "the dead count is the string 0").toBe(false);
      expect(armed("a6"), "two forced jobs, one unarmed").toBe(false);
      expect(armed("a7"), "no forced job at all").toBe(false);
      expect(got.get("a1")!.forced_jobs_since_t0).toBe(1);
      expect(got.get("a6")!.forced_jobs_since_t0).toBe(2);
    });
  });

  describe("crosswalk form (the runbook's)", () => {
    const form = (() => {
      const m = readFileSync(RUNBOOK, "utf8").match(/<!-- form: crosswalk -->\n```sql\n([\s\S]*?)\n```/);
      if (!m) throw new Error("the runbook carries no crosswalk form");
      return m[1].split("__MARKER__").join("$m$a marker no PROD database carries$m$");
    })();
    const got = () => rows(form);

    /** Probe order: owners with an ACTIVE okx or bybit key, earliest such key first; owner 0 is the first. */
    const PROBE_TOTAL = 11;
    const XW_EXPECTED: Row[] = [
      ["a1", "a2", 1, 1, 1, 0, 0, 0, 1, 90, 10],
      ["a2", "a3", 1, 1, 1, 0, 0, 0, 1, 90, dayRange("2026-08-01", "2026-09-10").length],
      ["a3", "a4", 1, 3, 1, 1, 0, 0, 0, 90, 0],
      ["a4", "a5", 1, 1, 0, 1, 0, 0, 1, 730, dayRange("2025-01-01", "2025-01-20").length],
      ["a5", "a6", 1, 1, 1, 0, 0, 1, 0, 90, 0],
      ["a6", "a7", 1, 0, 1, 0, 0, 0, 2, 90, dayRange("2026-09-01", "2026-09-24").length],
      ["a7", "a8", 1, 1, 1, 0, 0, 0, 1, 90, 10],
      ["a8", "none", 0, 0, 0, 0, 0, 0, 1, 730, 0],
      ["a9", "a9", 1, 1, 1, 0, 0, 0, 0, 90, dayRange("2026-08-01", "2026-08-31").length],
      ["a10", "a10", 1, 1, 1, 0, 0, 0, 1, 90, 7],
      ["a11", "a11", 1, 0, 1, 0, 0, 0, 0, 90, 0],
    ].map(([census, probe, aOkx, aBybit, pOkx, pBybit, pOther, pZero, pExcl, window, snaps], _i, all) => ({
      marker_is_prod: 0,
      census_label: census as string,
      probe_label: probe as string,
      probe_accounts_total: PROBE_TOTAL,
      active_okx_keys: aOkx as number,
      active_bybit_keys: aBybit as number,
      predicted_okx_members: pOkx as number,
      predicted_bybit_members: pBybit as number,
      predicted_other_members: pOther as number,
      predicted_zero_contribution_members: pZero as number,
      predicted_non_working_accounts_excluded: pExcl as number,
      predicted_window_days: window as number,
      // Hand-computed from the oracle's own six predicted columns (never from the statement): the OTHER rows sharing them.
      fingerprint_ties: all.filter((o) => o[0] !== census && o.slice(4, 10).join("|") === [pOkx, pBybit, pOther, pZero, pExcl, window].join("|")).length,
      snapshot_days: snaps as number,
    }));

    it("prints exactly the fixture's census labels, in order", () => {
      expect(got().map((r) => r.census_label)).toEqual(XW_EXPECTED.map((r) => r.census_label));
    });

    it.each(XW_EXPECTED.map((r) => [r.census_label as string, r] as const))(
      "%s: probe label and every fingerprint column equal the hand-computed oracle",
      (label, expected) => {
        const row = got().find((r) => r.census_label === label);
        expect(row, `crosswalk printed no row for ${label}`).toBeDefined();
        expect(row).toEqual(expected);
      },
    );

    it("the fixture really has fingerprint ties, so the runbook's 'crosswalk ambiguous' outcome is reachable (review WR-R2-03)", () => {
      const fp = (r: Row) =>
        [r.predicted_okx_members, r.predicted_bybit_members, r.predicted_other_members, r.predicted_zero_contribution_members, r.predicted_non_working_accounts_excluded, r.predicted_window_days].join("|");
      const groups = new Map<string, string[]>();
      for (const r of got()) groups.set(fp(r), [...(groups.get(fp(r)) ?? []), r.census_label as string]);
      const ties = [...groups.values()].filter((g) => g.length > 1);
      expect(ties.length, "vacuity: no two fixture accounts share a fingerprint").toBeGreaterThan(0);
      expect(ties.some((g) => g.includes("a1") && g.includes("a7")), "a1 and a7 print the same six counts").toBe(true);
    });

    it("agrees with P7 on every predicted count it shares (one grouping, two readings)", () => {
      const p7 = rows(readFileSync(P7_FILE, "utf8"));
      for (const x of got()) {
        const p = p7.find((r) => r.account_label === x.census_label)!;
        expect(x.predicted_okx_members, `${x.census_label} okx`).toBe(p.crawled_okx_accounts);
        expect(x.predicted_bybit_members, `${x.census_label} bybit`).toBe(p.crawled_bybit_accounts);
        expect(x.predicted_other_members, `${x.census_label} other`).toBe(p.crawled_other_accounts);
        expect(x.predicted_zero_contribution_members, `${x.census_label} zero`).toBe(p.zero_contribution_accounts);
        expect(x.predicted_non_working_accounts_excluded, `${x.census_label} dead`).toBe(p.dead_exchange_accounts);
        expect(x.predicted_window_days, `${x.census_label} window`).toBe(p.predicted_window_days);
      }
    });
  });
});
