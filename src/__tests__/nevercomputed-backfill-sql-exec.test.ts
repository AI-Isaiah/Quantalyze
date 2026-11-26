/**
 * Phase 238 NEVERCOMPUTED plan 05 (FACT-03): the `strategy_analytics.computed_at` nullable migration and its
 * manual rollback, EXECUTED on a throwaway local PostgreSQL cluster. The migration auto-applies to PROD on merge
 * with no human stop and is one-way for the 11 never-computed PROD rows, so this file is the only place the real
 * text runs against the real table and the real trigger bodies before PROD. A text check cannot prove either of
 * the two things that matter:
 *
 *   1. The backfill gets PAST the hold trigger. `strategy_analytics_hold_computed_at_until_success` restores
 *      OLD.computed_at on every UPDATE whose NEW status is failed or computing, so a plain UPDATE of the target
 *      rows reports success and changes nothing. Only an execution sees that (neuter I proves the guard fails loud).
 *   2. It nulls EXACTLY the never-computed rows (never completed, no headline, no stored series) and leaves every
 *      other row byte-identical: a failed row WITH figures keeps its honest last-good date.
 *
 * HOW. Same mechanism as `oneaccountonce-delete-sql-exec.test.ts`: `scripts/pg-lane/run.sh --print-pgbin` names the
 * server binaries and this file boots a socket-only cluster of its own (no TCP listener, trust auth, removed in
 * afterAll). No skip gate: with no binaries beforeAll THROWS. This file reads no database URL from the environment:
 * never TEST, never PROD.
 *
 * THE SCHEMA IS THE REAL ONE WHERE IT MATTERS. The `strategy_analytics` CREATE TABLE block and its three BEFORE
 * UPDATE trigger lines are cut verbatim from `supabase/schema/baseline.sql`; the three trigger function bodies are
 * the REAL ones from `supabase/schema/functions` (a miss throws naming what is missing). The baseline's CREATE TABLE
 * carries no primary key and no foreign key, so the primary key is added here and the strategy foreign key is left
 * out (irrelevant to these arms).
 *
 * ISOLATION. The fixture is seeded once into a template database; every test clones it and applies the migration in
 * its OWN psql session with `--single-transaction -v ON_ERROR_STOP=1`, which is how the file behaves under Supabase
 * (one implicit transaction).
 *
 * This file reads nothing under `.planning/`, which the ship filter strips from main.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const BASELINE = join(REPO, "supabase", "schema", "baseline.sql");
const FUNCS = join(REPO, "supabase", "schema", "functions");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const DOWN = join(MIGRATIONS, "down");

const SUFFIX = "_strategy_analytics_computed_at_nullable.sql";
const HOLD_TRIGGER = "strategy_analytics_hold_computed_at_until_success_trigger";
const TRIGGERS = [
  "strategy_analytics_drop_stale_error_provenance_trigger",
  HOLD_TRIGGER,
  "strategy_analytics_stamp_computing_started_trigger",
] as const;
const FUNCTION_FILES = [
  "strategy_analytics_drop_stale_error_provenance.sql",
  "strategy_analytics_hold_computed_at_until_success.sql",
  "strategy_analytics_stamp_computing_started.sql",
] as const;

const LOCAL_MARKER = "nevercomputed exec gate. Throwaway cluster, not TEST, not PROD.";

/** The migration located by its suffix, so a re-stamped version needs no edit here. */
function migrationFile(): { name: string; version: string; path: string } {
  const hits = readdirSync(MIGRATIONS).filter((f) => f.endsWith(SUFFIX));
  if (hits.length !== 1) throw new Error(`nevercomputed exec gate: expected exactly one migration ending ${SUFFIX}, found ${hits.length}`);
  const name = hits[0];
  return { name, version: name.slice(0, name.length - SUFFIX.length), path: join(MIGRATIONS, name) };
}

const MIGRATION = migrationFile();
const rollbackPath = () => join(DOWN, `${MIGRATION.version}-rollback.sql`);

/* ----------------------------------------------------------------------------------------------
 * The fixture. Every id and value is invented.
 * -------------------------------------------------------------------------------------------- */

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

type Seed = {
  n: number;
  status: "pending" | "computing" | "complete" | "complete_with_warnings" | "failed";
  figures: "none" | "headline+series" | "series-only" | "headline-only" | "daily-dict-only";
  /** true: the migration must set computed_at to NULL on this row. */
  never: boolean;
  label: string;
};

/** Each row carries an old, distinct computed_at. Rows 1-3 are the never-computed set; 4-9 are the decoys. */
const SEEDS: Seed[] = [
  { n: 1, status: "failed", figures: "none", never: true, label: "failed, no figures" },
  { n: 2, status: "computing", figures: "none", never: true, label: "computing, no figures" },
  { n: 3, status: "pending", figures: "none", never: true, label: "pending, empty-shaped series ([] and {})" },
  { n: 4, status: "failed", figures: "headline+series", never: false, label: "failed WITH headline and series (honest last-good date)" },
  { n: 5, status: "complete", figures: "none", never: false, label: "complete, no figures (a real compute date)" },
  { n: 6, status: "complete", figures: "headline+series", never: false, label: "complete with figures" },
  { n: 7, status: "failed", figures: "series-only", never: false, label: "failed with a series but no headline" },
  { n: 8, status: "failed", figures: "headline-only", never: false, label: "failed with a headline but no daily series" },
  { n: 9, status: "failed", figures: "daily-dict-only", never: false, label: "failed with a dict-shaped daily_returns, no headline, no series" },
];
const NEVER = SEEDS.filter((s) => s.never).map((s) => s.n);
const KEPT = SEEDS.filter((s) => !s.never).map((s) => s.n);

const oldDate = (n: number) => `2026-01-0${n} 10:00:00+00`;

function seedSql(): string {
  const col = (s: Seed) => {
    switch (s.figures) {
      case "none":
        // row 3 uses the empty shapes, so the predicate's '[]' / '{}' arms are exercised; rows 1 and 2 are SQL NULL.
        return s.n === 3
          ? { cr: "NULL", daily: `'{}'::jsonb`, series: `'[]'::jsonb` }
          : { cr: "NULL", daily: "NULL", series: "NULL" };
      case "headline+series":
        return { cr: "0.42", daily: "NULL", series: `'[{"date":"2026-01-01","value":0.01}]'::jsonb` };
      case "series-only":
        return { cr: "NULL", daily: "NULL", series: `'[{"date":"2026-01-01","value":0.01}]'::jsonb` };
      case "headline-only":
        return { cr: "0.17", daily: "NULL", series: "NULL" };
      case "daily-dict-only":
        return { cr: "NULL", daily: `'{"2026-01-01":0.01}'::jsonb`, series: "NULL" };
    }
  };
  return SEEDS.map((s) => {
    const c = col(s);
    return `INSERT INTO public.strategy_analytics (id, strategy_id, computed_at, computation_status, cumulative_return, daily_returns, returns_series, computing_started_at)
     VALUES (${q(uid(1000 + s.n))}, ${q(uid(2000 + s.n))}, ${q(oldDate(s.n))}, ${q(s.status)}, ${c.cr}, ${c.daily}, ${c.series},
             ${s.status === "computing" ? q("2026-01-09 09:00:00+00") : "NULL"});`;
  }).join("\n");
}

/** The real CREATE TABLE block for strategy_analytics. A miss throws naming it. */
function extractTable(): string {
  const baseline = readFileSync(BASELINE, "utf8");
  const m = /^CREATE TABLE IF NOT EXISTS "public"\."strategy_analytics" \(\n[\s\S]*?^\);\n/m.exec(baseline);
  if (!m) throw new Error('nevercomputed exec gate: CREATE TABLE block for public.strategy_analytics not found in supabase/schema/baseline.sql');
  return m[0];
}

/** The three real CREATE OR REPLACE TRIGGER lines on strategy_analytics. A miss throws naming the trigger. */
function extractTriggers(): string[] {
  const baseline = readFileSync(BASELINE, "utf8");
  return TRIGGERS.map((t) => {
    const m = new RegExp(`^CREATE OR REPLACE TRIGGER "${t}" BEFORE UPDATE ON "public"\\."strategy_analytics"[^\\n]*;$`, "m").exec(baseline);
    if (!m) throw new Error(`nevercomputed exec gate: CREATE TRIGGER ${t} not found in supabase/schema/baseline.sql`);
    return m[0];
  });
}

function schemaSql(): string {
  const funcs = FUNCTION_FILES.map((f) => {
    try {
      return readFileSync(join(FUNCS, f), "utf8");
    } catch {
      throw new Error(`nevercomputed exec gate: trigger function snapshot supabase/schema/functions/${f} not found`);
    }
  });
  return [
    extractTable(),
    "ALTER TABLE public.strategy_analytics ADD PRIMARY KEY (id);",
    // The fixture must start in the PRE-migration shape (NOT NULL DEFAULT now()) whatever vintage baseline.sql is: the post-apply re-dump drops both.
    "ALTER TABLE public.strategy_analytics ALTER COLUMN computed_at SET DEFAULT now(), ALTER COLUMN computed_at SET NOT NULL;",
    ...funcs,
    ...extractTriggers(),
  ].join("\n");
}

type Row = Record<string, unknown>;

describe("nevercomputed: strategy_analytics.computed_at nullable migration and rollback, EXECUTED on a throwaway cluster over the baseline DDL (Phase 238)", () => {
  let root = "";
  let pgbin = "";
  let started = false;
  let dbSeq = 0;

  const harnessEnv: Record<string, string | undefined> = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", PGTZ: "UTC" };
  const HARNESS_ENV = harnessEnv as NodeJS.ProcessEnv;

  function pg(tool: string, args: string[]) {
    const res = spawnSync(join(pgbin, tool), args, { encoding: "utf8", env: HARNESS_ENV });
    if (res.status !== 0) throw new Error(`${tool} ${args[0] ?? ""} exited ${res.status}: ${res.stderr || res.stdout}`);
    return res.stdout;
  }

  /** A fresh psql session per call. `single` runs the whole input as ONE transaction, as Supabase applies a migration. */
  function psqlRaw(db: string, sql: string, single = false) {
    return spawnSync(
      join(pgbin, "psql"),
      ["-h", root, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-At", "-q", "-X", ...(single ? ["--single-transaction"] : []), "-f", "-"],
      { encoding: "utf8", input: sql, env: HARNESS_ENV },
    );
  }

  function psql(db: string, sql: string): string {
    const res = psqlRaw(db, sql);
    if (res.status !== 0) throw new Error(`psql exited ${res.status}: ${res.stderr}`);
    return res.stdout;
  }

  function rows(db: string, statement: string): Row[] {
    const body = statement.trimEnd().replace(/;\s*$/, "");
    const out = psql(db, `BEGIN;\nSET TRANSACTION READ ONLY;\nSELECT coalesce(json_agg(q), '[]'::json) FROM (${body}) q;\nROLLBACK;`);
    return JSON.parse(out.trim()) as Row[];
  }

  function clone(): string {
    dbSeq += 1;
    const db = `t${dbSeq}`;
    psql("postgres", `CREATE DATABASE ${db} TEMPLATE tmpl;\nCOMMENT ON DATABASE ${db} IS ${q(LOCAL_MARKER)};`);
    return db;
  }

  const migrationSql = () => readFileSync(MIGRATION.path, "utf8");
  const applyMigration = (db: string, sql = migrationSql()) => psqlRaw(db, sql, true);

  /** id number -> md5 of the full row text, so "byte-identical" means the whole row, not just the date. */
  function rowDigests(db: string): Record<number, string> {
    const out: Record<number, string> = {};
    for (const line of psql(db, "SELECT right(id::text, 4) || '|' || md5(x::text) FROM public.strategy_analytics x ORDER BY id;").trim().split("\n")) {
      const [id, d] = line.split("|");
      out[Number(id) - 1000] = d;
    }
    return out;
  }

  /** id number -> computed_at text, 'NULL' for a null. */
  function dates(db: string): Record<number, string> {
    const out: Record<number, string> = {};
    for (const line of psql(db, "SELECT right(id::text, 4) || '|' || coalesce(computed_at::text, 'NULL') FROM public.strategy_analytics ORDER BY id;").trim().split("\n")) {
      const [id, d] = line.split("|");
      out[Number(id) - 1000] = d;
    }
    return out;
  }

  const tableDigest = (db: string) =>
    psql(db, "SELECT count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM public.strategy_analytics x;").trim();

  function columnShape(db: string): { notnull: boolean; hasdef: boolean } {
    const r = rows(
      db,
      "SELECT attnotnull AS notnull, atthasdef AS hasdef FROM pg_attribute WHERE attrelid = 'public.strategy_analytics'::regclass AND attname = 'computed_at' AND NOT attisdropped",
    )[0];
    return { notnull: r.notnull as boolean, hasdef: r.hasdef as boolean };
  }

  const triggerEnabled = (db: string, name = HOLD_TRIGGER) =>
    psql(db, `SELECT tgenabled FROM pg_trigger WHERE tgname = ${q(name)} AND tgrelid = 'public.strategy_analytics'::regclass;`).trim();

  beforeAll(() => {
    const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
    if (sel.status !== 0 || sel.stdout.trim() === "") {
      throw new Error("nevercomputed exec gate: no PostgreSQL server binaries. `bash scripts/pg-lane/run.sh --print-pgbin` said:\n" + sel.stderr);
    }
    pgbin = sel.stdout.trim();
    // /tmp, not os.tmpdir(): the socket path must stay under the ~104-byte sun_path limit.
    root = mkdtempSync("/tmp/nvcb-");
    const data = join(root, "pgd");
    pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
    writeFileSync(
      join(data, "postgresql.conf"),
      `${readFileSync(join(data, "postgresql.conf"), "utf8")}\nlisten_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`,
    );
    // Set BEFORE the start: a start that times out can still bring the postmaster up late.
    started = true;
    pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
    psql("postgres", "CREATE DATABASE tmpl;");
    psql("tmpl", schemaSql());
    psql("tmpl", seedSql());
  }, 120000);

  afterAll(() => {
    if (started) spawnSync(join(pgbin, "pg_ctl"), ["-D", join(root, "pgd"), "-m", "immediate", "-w", "stop"], { env: HARNESS_ENV });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  describe("static: what the committed migration may and may not contain", () => {
    it("STATIC: no explicit BEGIN or COMMIT, no psql meta-command, no committed uuid, and a SET LOCAL lock_timeout", () => {
      const sql = migrationSql();
      expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
      expect(sql).not.toMatch(/^\\/m);
      expect(sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)).toBeNull();
      expect(sql).toContain("SET LOCAL lock_timeout");
    });

    it("STATIC: one DISABLE and at least one ENABLE of the hold trigger outside comments, and the guard is the linter-accepted shape", () => {
      const code = migrationSql()
        .split("\n")
        .filter((l) => !/^\s*--/.test(l))
        .join("\n");
      expect((code.match(new RegExp(`DISABLE TRIGGER ${HOLD_TRIGGER}`, "g")) ?? []).length).toBe(1);
      expect((code.match(new RegExp(`ENABLE TRIGGER ${HOLD_TRIGGER}`, "g")) ?? []).length).toBeGreaterThanOrEqual(1);
      expect(code).toMatch(/PERFORM 1 FROM public\.strategy_analytics[\s\S]*?IF FOUND THEN\s+RAISE EXCEPTION 'NEVERCOMPUTED:/);
      // never an opt-out marker or a count-then-raise guard
      expect(code).not.toMatch(/IF\s+EXISTS\s*\(\s*SELECT/i);
      expect(code).not.toMatch(/count\(\*\)\s+INTO/i);
    });
  });

  describe("vacuity guards: the fixture really is the real table, triggers and a population that would bite", () => {
    it("VACUITY: the cluster is the throwaway one, not a real project (local marker on a clone)", () => {
      const db = clone();
      expect(psql(db, "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database();").trim()).toBe(LOCAL_MARKER);
    });

    it("VACUITY: the template carries NOT NULL DEFAULT, all three real triggers enabled, and the nine seeded rows with old dates", () => {
      expect(columnShape("tmpl")).toEqual({ notnull: true, hasdef: true });
      for (const t of TRIGGERS) expect(triggerEnabled("tmpl", t), t).toBe("O");
      const d = dates("tmpl");
      expect(Object.keys(d).map(Number)).toEqual(SEEDS.map((s) => s.n));
      for (const s of SEEDS) expect(d[s.n]).toBe(oldDate(s.n));
    });

    it("VACUITY: the real hold trigger really holds, so a plain UPDATE of a never-computed row changes nothing (the defeat the migration must bypass)", () => {
      const db = clone();
      psql(db, `UPDATE public.strategy_analytics SET computed_at = NULL WHERE id = ${q(uid(1001))};`);
      expect(dates(db)[1]).toBe(oldDate(1));
    });

    it("VACUITY: the population has both sides of the predicate (3 never-computed, 6 that must keep their date)", () => {
      expect(NEVER).toEqual([1, 2, 3]);
      expect(KEPT).toEqual([4, 5, 6, 7, 8, 9]);
    });
  });

  describe("forward migration", () => {
    it("BACKFILL nulls exactly the never-computed rows", () => {
      const db = clone();
      const res = applyMigration(db);
      expect(res.status, `stderr=${res.stderr}`).toBe(0);
      const d = dates(db);
      for (const n of NEVER) expect(d[n], `row ${n} (${SEEDS[n - 1].label})`).toBe("NULL");
    });

    it("KEEPS the figure-bearing rows byte-identical", () => {
      const db = clone();
      const before = rowDigests(db);
      const res = applyMigration(db);
      expect(res.status, `stderr=${res.stderr}`).toBe(0);
      const after = rowDigests(db);
      for (const n of KEPT) expect(after[n], `row ${n} (${SEEDS[n - 1].label}) must be byte-identical`).toBe(before[n]);
      // and the never-computed rows really did change (so the equality above is not a no-op run)
      for (const n of NEVER) expect(after[n], `row ${n} must have changed`).not.toBe(before[n]);
    });

    it("COLUMN SHAPE: computed_at is nullable with no default afterwards", () => {
      const db = clone();
      expect(columnShape(db)).toEqual({ notnull: true, hasdef: true });
      expect(applyMigration(db).status).toBe(0);
      expect(columnShape(db)).toEqual({ notnull: false, hasdef: false });
    });

    it("TRIGGER re-enabled: the hold trigger is 'O' after the migration, and so are the other two", () => {
      const db = clone();
      expect(applyMigration(db).status).toBe(0);
      for (const t of TRIGGERS) expect(triggerEnabled(db, t), t).toBe("O");
    });

    it("IDEMPOTENT: applying the migration a second time changes no row", () => {
      const db = clone();
      expect(applyMigration(db).status).toBe(0);
      const once = tableDigest(db);
      const second = applyMigration(db);
      expect(second.status, `stderr=${second.stderr}`).toBe(0);
      expect(tableDigest(db)).toBe(once);
    });

    it("FAILS LOUD without the bypass: with the DISABLE statement removed the apply aborts with NEVERCOMPUTED and rolls everything back", () => {
      const db = clone();
      const sql = migrationSql();
      const neutered = sql.replace(new RegExp(`^ALTER TABLE public\\.strategy_analytics\\n  DISABLE TRIGGER ${HOLD_TRIGGER};\\n`, "m"), "");
      expect(neutered, "the neutering must actually remove the DISABLE statement").not.toBe(sql);
      const before = rowDigests(db);
      const res = applyMigration(db, neutered);
      expect(res.status, `the neutered migration must exit non-zero; stdout=${res.stdout}`).not.toBe(0);
      expect(res.stderr).toContain("NEVERCOMPUTED:");
      // the whole apply rolled back: dates, column contract and trigger are exactly as before
      expect(rowDigests(db)).toEqual(before);
      expect(dates(db)[1]).toBe(oldDate(1));
      expect(columnShape(db)).toEqual({ notnull: true, hasdef: true });
      expect(triggerEnabled(db)).toBe("O");
    });

    it("FAILS LOUD on a left-disabled trigger: with the ENABLE statement removed the catalogue check raises and the trigger is not left off", () => {
      const db = clone();
      const sql = migrationSql();
      const neutered = sql.replace(new RegExp(`^ALTER TABLE public\\.strategy_analytics\\n  ENABLE TRIGGER ${HOLD_TRIGGER};\\n`, "m"), "");
      expect(neutered, "the neutering must actually remove the ENABLE statement").not.toBe(sql);
      const res = applyMigration(db, neutered);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("the hold trigger is not enabled");
      expect(triggerEnabled(db)).toBe("O"); // the abort rolled the DISABLE back
      expect(columnShape(db)).toEqual({ notnull: true, hasdef: true });
    });
  });

  describe("manual rollback", () => {
    const rollbackSql = () => readFileSync(rollbackPath(), "utf8");
    const applyRollback = (db: string, sql = rollbackSql()) => psqlRaw(db, sql, true);
    const defaultExpr = (db: string) =>
      psql(
        db,
        "SELECT coalesce(pg_get_expr(d.adbin, d.adrelid), 'NONE') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.strategy_analytics'::regclass AND a.attname = 'computed_at';",
      ).trim();

    it("STATIC ROLLBACK: names the epoch and the marker query, carries no explicit transaction, and sets a lock timeout", () => {
      const sql = rollbackSql();
      expect(sql).toContain("TIMESTAMPTZ 'epoch'");
      expect(sql).toContain("which_database");
      expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
      expect(sql).not.toMatch(/^\\/m);
      expect(sql).toContain("SET LOCAL lock_timeout");
      const code = sql
        .split("\n")
        .filter((l) => !/^\s*--/.test(l))
        .join("\n");
      // the fill is never now(): that would reintroduce the false "computed just now" date
      expect(code).not.toMatch(/SET\s+computed_at\s*=\s*now\(\)/i);
    });

    it("ROLLBACK fills the epoch and restores NOT NULL", () => {
      const db = clone();
      expect(applyMigration(db).status).toBe(0);
      // vacuity: the migrated clone really holds NULLs for the rollback to fill
      const migrated = dates(db);
      for (const n of NEVER) expect(migrated[n]).toBe("NULL");
      const before = rowDigests(db);

      const res = applyRollback(db);
      expect(res.status, `stderr=${res.stderr}`).toBe(0);
      const d = dates(db);
      for (const n of NEVER) expect(d[n], `row ${n} (${SEEDS[n - 1].label}) must read the epoch`).toBe("1970-01-01 00:00:00+00");
      expect(Object.values(d)).not.toContain("NULL");
      // every dated row is byte-identical
      const after = rowDigests(db);
      for (const n of KEPT) expect(after[n], `row ${n} must be byte-identical`).toBe(before[n]);
      expect(columnShape(db)).toEqual({ notnull: true, hasdef: true });
      expect(defaultExpr(db)).toBe("now()");
      for (const t of TRIGGERS) expect(triggerEnabled(db, t), t).toBe("O");
    });

    it("ROLLBACK without the bypass fails: with the DISABLE statement removed the NULLs survive and SET NOT NULL refuses", () => {
      const db = clone();
      expect(applyMigration(db).status).toBe(0);
      const sql = rollbackSql();
      const neutered = sql.replace(new RegExp(`^ALTER TABLE public\\.strategy_analytics\\n  DISABLE TRIGGER ${HOLD_TRIGGER};\\n`, "m"), "");
      expect(neutered, "the neutering must actually remove the DISABLE statement").not.toBe(sql);
      const before = rowDigests(db);
      const res = applyRollback(db, neutered);
      expect(res.status, `the neutered rollback must exit non-zero; stdout=${res.stdout}`).not.toBe(0);
      expect(res.stderr).toContain("contains null values");
      // nothing was committed: the column is still nullable and every row is as it was
      expect(rowDigests(db)).toEqual(before);
      expect(columnShape(db)).toEqual({ notnull: false, hasdef: false });
      expect(triggerEnabled(db)).toBe("O");
    });
  });

  describe("after the migration", () => {
    it("POST-MIGRATION writes: a first-ever INSERT with no date stores NULL, failed and computing keep a NULL date NULL, complete stamps it", () => {
      const db = clone();
      expect(applyMigration(db).status).toBe(0);

      // INSERT with no date -> NULL (no default any more)
      psql(db, `INSERT INTO public.strategy_analytics (strategy_id, computation_status) VALUES (${q(uid(2100))}, 'failed');`);
      expect(psql(db, `SELECT coalesce(computed_at::text, 'NULL') FROM public.strategy_analytics WHERE strategy_id = ${q(uid(2100))};`).trim()).toBe("NULL");

      // a NULL failed row (row 1) moves to computing and a writer supplies now(): the hold trigger copies OLD (NULL)
      psql(db, `UPDATE public.strategy_analytics SET computation_status = 'computing', computed_at = now() WHERE id = ${q(uid(1001))};`);
      expect(dates(db)[1]).toBe("NULL");

      // back to failed with a date supplied: still NULL
      psql(db, `UPDATE public.strategy_analytics SET computation_status = 'failed', computed_at = now() WHERE id = ${q(uid(1001))};`);
      expect(dates(db)[1]).toBe("NULL");

      // a success write stamps it
      psql(db, `UPDATE public.strategy_analytics SET computation_status = 'complete', computed_at = now() WHERE id = ${q(uid(1001))};`);
      expect(dates(db)[1]).not.toBe("NULL");
    });
  });
});
