import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 176 LEGACYRETIRE plan 01: the operator runbook
 * `docs/runbooks/legacyretire-go-live.md`.
 *
 * Plans 07, 12 and 16 of the phase are orchestrator plans: the orchestrator
 * renders a named SQL form from the runbook and runs it on PROD under the
 * founder's standing authorization (reads, plus one guarded cron removal).
 * Nothing is written by hand at run time. This is a static guard (no database)
 * that keeps every form safe to run there, shaped on the marksource
 * legacy-chain-move guard in `marksource-okx-census-sql.test.ts`.
 *
 * Why each rule exists:
 *  - The set of forms is pinned. An operator renders a form by name, so a form
 *    added, dropped or renamed without this list moving is a form nobody reviewed.
 *  - A read form is ONE statement starting WITH or SELECT: the CLI returns only
 *    the last statement's rows, and anything else is not a read.
 *  - No `--` in a read form: a comment line breaks the CLI's inline form.
 *  - No write keyword as a whole word in a read form: the forms run under a
 *    standing authorization that covers reads. A write slipping into one would
 *    ride that authorization.
 *  - No uuid-shaped literal anywhere: the runbook is public.
 *  - `marker_is_prod` (TEST forms: `marker_is_test`) is the first output column
 *    of the final SELECT: it is what proves which database answered.
 *
 * The keyword list is built from an array so this file's own source does not
 * read as SQL.
 */

const RUNBOOK_REL = join("docs", "runbooks", "legacyretire-go-live.md");
const MANIFEST_REL = join("scripts", "prod-prober", "cron-manifest.json");
const RUNBOOK = join(process.cwd(), RUNBOOK_REL);
const MANIFEST = join(process.cwd(), MANIFEST_REL);

const PLANNING_DIR = [".plan", "ning/"].join("");

const WRITE_WORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "COPY",
  "CALL",
] as const;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const FORM_RE = /<!-- form: ([a-z0-9-]+) -->\n```sql\n([\s\S]*?)\n```/g;

/** `text.indexOf(anchor)`, but a miss THROWS by name instead of returning -1. */
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) throw new Error(`ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject text.`);
  return at;
}

/** The DO guard block of a write form, or "" when the form has none (so a missing form fails its own test, not collection). */
function guardOf(sql: string): string {
  const at = sql.indexOf("$guard$;", 10);
  return at < 0 ? "" : sql.slice(0, at);
}

/**
 * The record of what plan 12 unschedules, typed ONCE here. The forms carry the same two
 * literals as text; this test pins the forms to these, and the committed manifest's row to
 * these only while the row exists (plan 12 removes it and re-runs this test).
 */
const REFRESH_JOB = "refresh-allocator-equity";
const REFRESH_SCHEDULE = "30 1 * * *";
const REFRESH_COMMAND = "SELECT enqueue_refresh_allocator_equity_for_all();";

/** The PROD read forms: one statement, `marker_is_prod` first. */
const PROD_READ_FORMS: readonly string[] = [
  "r0-baseline-unknown",
  "r3-bridge-holding",
  "r1-closed-day-points",
  "r2-zero-legacy-and-linked",
  "cron-state",
  "r4-legacy-writes-stopped",
  "r5-drop-preflight",
  "r5-pre-drop-count",
  "r6-drop-applied",
  "ledger-row",
  "body-check",
];

/** The TEST read form: one statement, `marker_is_test` first. */
const TEST_READ_FORMS: readonly string[] = ["test-cron-state"];

/** The guarded PROD writes: a DO guard on the marker, a compare-and-set, one cron call, a read-back. */
const PROD_WRITE_FORMS: readonly string[] = ["unschedule-refresh", "reschedule-refresh"];

/** The guarded TEST write: the same shape under the apply-test marker predicate. */
const TEST_WRITE_FORMS: readonly string[] = ["unschedule-refresh-test"];

/** Every form the runbook carries. Add a form here and in the runbook together. */
const EXPECTED_FORMS: readonly string[] = [
  "marker",
  ...PROD_READ_FORMS,
  ...TEST_READ_FORMS,
  ...PROD_WRITE_FORMS,
  ...TEST_WRITE_FORMS,
];

/** [form, the marker column its final SELECT must lead with]. */
const READ_FORMS: ReadonlyArray<readonly [string, string]> = [
  ...PROD_READ_FORMS.map((n) => [n, "marker_is_prod"] as const),
  ...TEST_READ_FORMS.map((n) => [n, "marker_is_test"] as const),
];

/** The apply-test predicate of supabase-migrate.yml, as the TEST forms spell it in SQL. */
const TEST_WORD_PREDICATE = "'(^|[^[:alnum:]_])test([^[:alnum:]_]|$)'";
const PROD_REFUSAL_PREDICATE = "~* 'prod'";

/** The cron objects a form may name. */
function cronTokens(sql: string): string[] {
  return [...new Set([...sql.matchAll(/\bcron\.[a-z_]+/g)].map((m) => m[0]))].sort();
}

function runbookText(): string {
  return readFileSync(RUNBOOK, "utf8");
}

function runbookForms(): Map<string, string> {
  const forms = new Map<string, string>();
  for (const m of runbookText().matchAll(FORM_RE)) forms.set(m[1], m[2]);
  return forms;
}

/** Extracts the renderer the runbook writes with a heredoc, as an operator's shell would. */
function writeRenderer(dir: string): string {
  const m = runbookText().match(/cat > "\$LR_SP\/form\.mjs" <<'JS'\n([\s\S]*?)\nJS\n/);
  expect(m, "the runbook must carry the form.mjs heredoc").not.toBeNull();
  const script = join(dir, "form.mjs");
  writeFileSync(script, m![1] + "\n");
  return script;
}

const PLACEHOLDER_ENV_KEYS = ["LR_SINCE", "LR_DEPLOY_DAY", "LR_VERSION", "LR_PROC", "LR_NEEDLE"] as const;

/** Renders with the placeholder variables ABSENT unless `env` sets them (an inherited value must never leak in). */
function render(script: string, form: string, env: Record<string, string>, cwd = process.cwd()) {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of PLACEHOLDER_ENV_KEYS) delete base[k];
  return spawnSync(process.execPath, [script, form], {
    cwd,
    env: { ...base, ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
}

const GOOD_ENV: Record<string, string> = {
  LR_SINCE: "2026-11-01T00:00:00Z",
  LR_DEPLOY_DAY: "2026-11-01",
  LR_VERSION: "20261101120000",
  LR_PROC: "public.compute_bridge_outcome_deltas()",
  LR_NEEDLE: "extract_symbol_value_at",
};

const committedMarker: string = JSON.parse(readFileSync(MANIFEST, "utf8")).database_marker;

describe("legacyretire runbook", () => {
  const forms = runbookForms();

  it("carries no uuid, no home path and no planning-directory path", () => {
    const text = runbookText();
    expect(UUID_RE.test(text), "uuid-shaped literal in the runbook").toBe(false);
    expect(/\/Users\//.test(text), "home path in the runbook").toBe(false);
    expect(
      text.includes(PLANNING_DIR),
      "lychee checks docs/runbooks links offline: name planning files in prose, never by path",
    ).toBe(false);
  });

  it("holds exactly the pinned forms", () => {
    expect(
      [...forms.keys()].sort(),
      "a form was added, dropped or renamed: update EXPECTED_FORMS, and the runbook's own text, together",
    ).toEqual([...EXPECTED_FORMS].sort());
  });

  it("carries the plain marker read as its first form", () => {
    expect(forms.get("marker")).toContain("shobj_description(oid, 'pg_database')");
  });

  describe.each(READ_FORMS.map(([n, col]) => [n, col] as [string, string]))("read form %s (marker column %s)", (name, markerCol) => {
    const sql = (forms.get(name) ?? "").trim();

    it("is one statement starting with WITH or SELECT", () => {
      expect(/^(WITH|SELECT)\b/i.test(sql), `${name} must start with WITH or SELECT: a read form is a read`).toBe(true);
      expect(sql.split(";").length - 1, `${name} must hold exactly one ';'`).toBe(1);
      expect(sql.endsWith(";"), `${name}: the single ';' must be the last character`).toBe(true);
    });

    it("carries no -- comment", () => {
      expect(sql.includes("--"), `${name} contains '--': a comment line breaks the CLI's inline form; remove it`).toBe(false);
    });

    it("carries no uuid-shaped literal", () => {
      expect(UUID_RE.test(sql), `${name} carries a uuid-shaped literal: the runbook is public`).toBe(false);
    });

    it("carries no write keyword as a whole word", () => {
      for (const word of WRITE_WORDS) {
        expect(new RegExp(`\\b${word}\\b`, "i").test(sql), `${name} contains the word ${word}: a read form must not write`).toBe(false);
      }
    });

    it("selects its marker column as the first column of its one top-level SELECT", () => {
      const topLevel = sql.match(/^SELECT\b/gm) ?? [];
      expect(topLevel.length, `${name}: exactly one SELECT at line start (the final one); indent the CTE selects`).toBe(1);
      expect(
        new RegExp(`^SELECT\\s+m\\.${markerCol}\\b`, "m").test(sql),
        `${name}: the final SELECT must start with m.${markerCol}, or the output cannot prove which database answered`,
      ).toBe(true);
    });
  });

  describe("the guarded write forms", () => {
    const WRITE_FORMS = [...PROD_WRITE_FORMS, ...TEST_WRITE_FORMS];

    it.each(WRITE_FORMS.map((n) => [n] as const))("%s starts with a DO guard that raises", (name) => {
      const sql = forms.get(name) ?? "";
      expect(sql.startsWith("DO $guard$\n"), `${name}: the first statement must be the DO $guard$ block`).toBe(true);
      const guard = sql.slice(0, anchorIndex(sql, "$guard$;", 10));
      expect(guard.includes("RAISE EXCEPTION"), `${name}: the guard must raise`).toBe(true);
      expect(guardOf(sql), `${name}: guardOf and the guard check must agree`).toBe(guard);
    });

    it.each(WRITE_FORMS.map((n) => [n] as const))("%s writes through no keyword of its own", (name) => {
      const sql = forms.get(name) ?? "";
      for (const word of WRITE_WORDS) {
        expect(
          new RegExp(`\\b${word}\\b`, "i").test(sql),
          `${name} contains the word ${word}: its only write is the one cron call`,
        ).toBe(false);
      }
    });

    it.each(PROD_WRITE_FORMS.map((n) => [n] as const))(
      "%s refuses unless the marker names PRODUCTION (a NULL marker refuses exactly as a mismatched one does)",
      (name) => {
        const sql = forms.get(name) ?? "";
        const guard = guardOf(sql);
        expect(guard.includes("IS DISTINCT FROM __MARKER__"), `${name}: use IS DISTINCT FROM so a NULL marker refuses`).toBe(true);
      },
    );

    it.each(TEST_WRITE_FORMS.map((n) => [n] as const))(
      "%s refuses unless the marker names TEST as a whole word and does not name PROD (the apply-test predicate)",
      (name) => {
        const sql = forms.get(name) ?? "";
        const guard = guardOf(sql);
        expect(guard.includes(TEST_WORD_PREDICATE), `${name}: the whole-word TEST predicate of supabase-migrate.yml`).toBe(true);
        expect(guard.includes(PROD_REFUSAL_PREDICATE), `${name}: the PROD refusal of supabase-migrate.yml`).toBe(true);
        expect(guard.includes("IS NULL"), `${name}: a NULL marker must refuse`).toBe(true);
        expect(sql.includes("__MARKER__"), `${name}: a TEST form must not carry the PROD marker`).toBe(false);
      },
    );

    it.each([...PROD_WRITE_FORMS, ...TEST_WRITE_FORMS].map((n) => [n] as const))(
      "%s ends with a read-back whose first column is the marker check, after the write",
      (name) => {
        const sql = forms.get(name) ?? "";
        const col = TEST_WRITE_FORMS.includes(name) ? "marker_is_test" : "marker_is_prod";
        const readBack = sql.search(new RegExp(`^SELECT\\s+m\\.${col}\\b`, "m"));
        expect(readBack, `${name}: the final SELECT must start with m.${col}`).toBeGreaterThan(0);
        const write = Math.max(sql.lastIndexOf("cron.unschedule("), sql.lastIndexOf("cron.schedule("));
        expect(write, `${name}: it must carry its one cron call`).toBeGreaterThan(0);
        expect(readBack, `${name}: the read-back must come after the write`).toBeGreaterThan(write);
        expect(sql.trimEnd().endsWith(";"), `${name}: ends with the ';'`).toBe(true);
      },
    );

    describe.each([...["unschedule-refresh", "unschedule-refresh-test"]].map((n) => [n] as const))("%s", (name) => {
      const sql = forms.get(name) ?? "";
      const guard = guardOf(sql);

      it("is a compare-and-set on the job's name, schedule and command, and on there being exactly one", () => {
        expect(guard.includes(`jobname = '${REFRESH_JOB}'`)).toBe(true);
        expect(guard.includes(`schedule = '${REFRESH_SCHEDULE}'`), `${name}: the guard must pin the schedule`).toBe(true);
        expect(guard.includes(`command = '${REFRESH_COMMAND}'`), `${name}: the guard must pin the command`).toBe(true);
      });

      it("pins every schedule and command literal it carries to the record in this test", () => {
        const schedules = [...sql.matchAll(/schedule = '([^']*)'/g)].map((m) => m[1]);
        const commands = [...sql.matchAll(/command = '([^']*)'/g)].map((m) => m[1]);
        expect(schedules.length).toBeGreaterThan(0);
        expect(commands.length).toBeGreaterThan(0);
        for (const v of schedules) expect(v).toBe(REFRESH_SCHEDULE);
        for (const v of commands) expect(v).toBe(REFRESH_COMMAND);
      });

      it("removes the job by name, once, and touches no other cron object nor a jobid", () => {
        expect(sql.split(`cron.unschedule('${REFRESH_JOB}')`).length - 1, `${name}: exactly one by-name unschedule`).toBe(1);
        expect(sql.split("cron.unschedule(").length - 1, `${name}: no other unschedule call`).toBe(1);
        expect(cronTokens(sql)).toEqual(["cron.job", "cron.unschedule"]);
        expect(/jobid/i.test(sql), `${name}: never a jobid, a jobid differs between databases`).toBe(false);
      });

      it("reads back the count of jobs still carrying the name (expected 0) next to the marker", () => {
        expect(sql).toMatch(/AS jobs_named_refresh\b/);
      });
    });

    describe("reschedule-refresh (the rollback)", () => {
      const sql = forms.get("reschedule-refresh") ?? "";
      const guard = guardOf(sql);

      it("is valid only while the fan-out function exists, and only while no job of that name does", () => {
        expect(
          guard.includes("to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()') IS NULL"),
          "the rollback must refuse once PR 3 drops the function: a cron job that calls a missing function fails every night",
        ).toBe(true);
        expect(guard.includes(`jobname = '${REFRESH_JOB}'`)).toBe(true);
        expect(/count\(\*\) FROM cron\.job WHERE jobname = 'refresh-allocator-equity'\) <> 0/.test(guard)).toBe(true);
      });

      it("schedules the same name, schedule and command as unschedule-refresh removes, by name", () => {
        expect(sql.split("cron.schedule(").length - 1, "reschedule-refresh: exactly one schedule call").toBe(1);
        expect(
          sql.includes(`cron.schedule('${REFRESH_JOB}', '${REFRESH_SCHEDULE}', '${REFRESH_COMMAND}')`),
          "reschedule-refresh must restore exactly the recorded job",
        ).toBe(true);
        expect(cronTokens(sql)).toEqual(["cron.job", "cron.schedule"]);
        expect(/jobid/i.test(sql)).toBe(false);
      });

      it("reads back the count of jobs carrying the name (expected 1)", () => {
        expect(sql).toMatch(/AS jobs_named_refresh\b/);
      });
    });
  });

  describe("the manifest record of the job plan 12 unschedules", () => {
    type Manifest = { jobs: Array<{ jobname: string; schedule: string; command: string }> };
    /** Empty when the manifest carries no `refresh-allocator-equity` row, or carries the recorded one. */
    function refreshRowProblems(manifest: Manifest): string[] {
      const rows = manifest.jobs.filter((j) => j.jobname === REFRESH_JOB);
      if (rows.length === 0) return [];
      const problems: string[] = [];
      if (rows.length > 1) problems.push(`${rows.length} rows named ${REFRESH_JOB}`);
      for (const row of rows) {
        if (row.schedule !== REFRESH_SCHEDULE) problems.push(`schedule ${JSON.stringify(row.schedule)} is not ${JSON.stringify(REFRESH_SCHEDULE)}`);
        if (row.command !== REFRESH_COMMAND) problems.push(`command ${JSON.stringify(row.command)} is not ${JSON.stringify(REFRESH_COMMAND)}`);
      }
      return problems;
    }
    const committed = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;

    it("holds in the committed manifest: the row equals the recorded literals, or is absent (plan 12 removes it)", () => {
      expect(refreshRowProblems(committed)).toEqual([]);
    });

    it("holds in a copy of the manifest with that row deleted, the state plan 12 creates", () => {
      const without: Manifest = { ...committed, jobs: committed.jobs.filter((j) => j.jobname !== REFRESH_JOB) };
      expect(without.jobs.some((j) => j.jobname === REFRESH_JOB), "the copy must really lack the row").toBe(false);
      expect(refreshRowProblems(without)).toEqual([]);
    });

    it("can fail: a row at another schedule, or another command, is reported", () => {
      const moved: Manifest = { jobs: [{ jobname: REFRESH_JOB, schedule: "0 5 * * *", command: REFRESH_COMMAND }] };
      expect(refreshRowProblems(moved).length).toBeGreaterThan(0);
      const recommanded: Manifest = { jobs: [{ jobname: REFRESH_JOB, schedule: REFRESH_SCHEDULE, command: "SELECT 1;" }] };
      expect(refreshRowProblems(recommanded).length).toBeGreaterThan(0);
    });
  });

  describe("what each form reads (intent pins)", () => {
    const sqlOf = (n: string) => forms.get(n) ?? "";
    const flat = (n: string) => sqlOf(n).replace(/\s+/g, " ");

    it("r3-bridge-holding counts the holding-measuring rows the way the cron's holding branch selects them", () => {
      const sql = flat("r3-bridge-holding");
      for (const col of [
        "AS holding_rows",
        "AS with_delta_30d",
        "AS with_delta_90d",
        "AS with_delta_180d",
        "AS needs_recompute",
        "AS computed_since_deploy_day",
        "AS inside_check_window",
        "AS outside_check_window",
        "AS aged_candidates_any_branch",
      ]) {
        expect(sql.includes(col), `r3-bridge-holding must report ${col}`).toBe(true);
      }
      expect(sql.includes("bo.kind = 'allocated'")).toBe(true);
      expect(sql.includes("md.original_strategy_id IS NULL")).toBe(true);
      expect(sql.includes("md.original_holding_ref IS NOT NULL")).toBe(true);
      expect(sql.includes("hp.symbol IS NOT NULL")).toBe(true);
      expect(sql.includes("CURRENT_DATE - '365 days'::interval"), "the bridge_outcomes_allocated_at_check expression").toBe(true);
    });

    it("r1-closed-day-points reports the four counts of the rewritten 181 criterion 4", () => {
      const sql = flat("r1-closed-day-points");
      for (const col of ["AS holders", "AS with_derived_row", "AS trustworthy", "AS with_closed_day_point"]) {
        expect(sql.includes(col), `r1-closed-day-points must report ${col}`).toBe(true);
      }
      expect(sql.includes("lower(h.venue) <> 'deribit'")).toBe(true);
      expect(sql.includes("k.sync_status IS DISTINCT FROM 'revoked'")).toBe(true);
      expect(sql.includes("k.disconnected_at IS NULL")).toBe(true);
      expect(sql.includes("dv.kind = 'equity_curve'")).toBe(true);
      expect(sql.includes("jsonb_typeof(dv.payload -> 'curve') = 'array'"), "a non-array curve counts as no point, it must not raise").toBe(true);
    });

    it("r2-zero-legacy-and-linked labels its two populations and uses the same four counts", () => {
      const sql = flat("r2-zero-legacy-and-linked");
      expect(sql.includes("'no_legacy_row'")).toBe(true);
      expect(sql.includes("'all_keys_linked'")).toBe(true);
      expect(sql.includes("AS population")).toBe(true);
      for (const col of ["AS holders", "AS with_derived_row", "AS trustworthy", "AS with_closed_day_point"]) {
        expect(sql.includes(col), `r2-zero-legacy-and-linked must report ${col}`).toBe(true);
      }
      expect(sql.includes("strategies"), "linked means a non-archived strategy").toBe(true);
      expect(sql.includes("strategy_keys")).toBe(true);
      expect(sql.includes("<> 'archived'")).toBe(true);
    });

    it("cron-state reads the four allocator jobs and the open jobs of the two retired kinds", () => {
      const sql = flat("cron-state");
      for (const job of ["poll-allocator-positions", "refresh-allocator-equity", "derive-allocator-key-dailies", "compute_bridge_outcome_deltas"]) {
        expect(sql.includes(`'${job}'`), `cron-state must read ${job}`).toBe(true);
      }
      expect(sql.includes("'reconstruct_allocator_history'")).toBe(true);
      expect(sql.includes("'refresh_allocator_equity_daily'")).toBe(true);
      expect(sql.includes("c.status"), "the open jobs are reported by status").toBe(true);
    });

    it("test-cron-state reads the same four jobs", () => {
      const sql = flat("test-cron-state");
      for (const job of ["poll-allocator-positions", "refresh-allocator-equity", "derive-allocator-key-dailies", "compute_bridge_outcome_deltas"]) {
        expect(sql.includes(`'${job}'`), `test-cron-state must read ${job}`).toBe(true);
      }
      expect(sql.includes(TEST_WORD_PREDICATE)).toBe(true);
      expect(sql.includes(PROD_REFUSAL_PREDICATE)).toBe(true);
    });

    it("r4-legacy-writes-stopped reads the legacy rows since the instant, the cron row, and the retired kinds by status", () => {
      const sql = flat("r4-legacy-writes-stopped");
      expect(sql.includes("s.reconstructed_at >= '__SINCE__'::timestamptz")).toBe(true);
      expect(sql.includes("AS legacy_rows_since")).toBe(true);
      expect(sql.includes("AS refresh_cron_rows")).toBe(true);
      expect(sql.includes("enqueue_refresh_allocator_equity_for_all")).toBe(true);
      expect(sql.includes("'reconstruct_allocator_history'")).toBe(true);
      expect(sql.includes("'refresh_allocator_equity_daily'")).toBe(true);
      expect(sql.includes("c.created_at >= '__SINCE__'::timestamptz")).toBe(true);
    });

    it("r5-drop-preflight lists functions by name with the comment-stripped test, and the runbook names the expected set", () => {
      const sql = flat("r5-drop-preflight");
      expect(sql.includes("AS proname")).toBe(true);
      expect(sql.includes("AS names_table_outside_comments")).toBe(true);
      expect(sql.includes("regexp_replace"), "comments must be stripped before the name test").toBe(true);
      const text = runbookText();
      for (const fn of [
        "delete_allocator_api_key",
        "enqueue_refresh_allocator_equity_for_all",
        "extract_symbol_value_at",
        "replace_allocator_equity_snapshots",
        "replace_allocator_equity_snapshots_window",
        "backfill_api_keys_history_reconstructed_at",
      ]) {
        expect(text.includes(fn), `the runbook must name ${fn} in the expected pre-flight set`).toBe(true);
      }
    });

    it("r5-pre-drop-count reports the six numbers PR 3 is judged on", () => {
      const sql = flat("r5-pre-drop-count");
      for (const col of [
        "AS legacy_rows",
        "AS legacy_allocators",
        "AS oldest_asof",
        "AS newest_asof",
        "AS dependent_objects",
        "AS cron_jobs_naming_table_or_fanout",
        "AS boundary_rows",
      ]) {
        expect(sql.includes(col), `r5-pre-drop-count must report ${col}`).toBe(true);
      }
      expect(sql.includes("'snapshot_rebuild_boundary'")).toBe(true);
    });

    it("r6-drop-applied checks the table, the bodies, the four dropped signatures, the boundary rows and the ledger", () => {
      const sql = flat("r6-drop-applied");
      for (const col of ["AS table_gone", "AS bodies_naming_table", "AS dropped_functions_present", "AS boundary_rows", "AS ledger_row_present"]) {
        expect(sql.includes(col), `r6-drop-applied must report ${col}`).toBe(true);
      }
      expect(sql.includes("to_regclass('public.allocator_equity_snapshots') IS NULL")).toBe(true);
      for (const sig of [
        "public.replace_allocator_equity_snapshots(uuid, jsonb, integer)",
        "public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)",
        "public.extract_symbol_value_at(uuid, text, date)",
        "public.enqueue_refresh_allocator_equity_for_all()",
      ]) {
        expect(sql.includes(`to_regprocedure('${sig}')`), `r6-drop-applied must look for ${sig}`).toBe(true);
      }
      expect(sql.includes("supabase_migrations.schema_migrations")).toBe(true);
      expect(sql.includes("version = '__VERSION__'")).toBe(true);
    });

    it("ledger-row reads the migration ledger for the version, nothing else", () => {
      const sql = flat("ledger-row");
      expect(sql.includes("AS ledger_row_present")).toBe(true);
      expect(sql.includes("supabase_migrations.schema_migrations")).toBe(true);
      expect(sql.includes("version = '__VERSION__'")).toBe(true);
    });

    it("body-check reads the function by its regprocedure and tests the comment-stripped body for the needle", () => {
      const sql = flat("body-check");
      expect(sql.includes("to_regprocedure('__PROC__')")).toBe(true);
      expect(sql.includes("'__NEEDLE__'")).toBe(true);
      expect(sql.includes("AS proc_exists")).toBe(true);
      expect(sql.includes("AS body_names_needle")).toBe(true);
      expect(sql.includes("regexp_replace"), "a needle in a comment is not in the body").toBe(true);
    });

    it("the runbook states the merge hold around the derive (00:40Z) and the bridge cron (03:00Z)", () => {
      const text = runbookText();
      for (const needle of ["## Merge and deploy hold", "00:30", "03:45", "00:40Z", "03:00Z"]) {
        expect(text.includes(needle), `the merge hold section must carry ${needle}`).toBe(true);
      }
    });
  });

  describe("renderer", () => {
    const dir = mkdtempSync(join(tmpdir(), "lr-render-"));
    const script = writeRenderer(dir);

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("prints the marker form unchanged", () => {
      const r = render(script, "marker", GOOD_ENV);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(forms.get("marker")! + "\n");
    });

    it.each([...EXPECTED_FORMS])("renders %s with no placeholder left", (name) => {
      const r = render(script, name, GOOD_ENV);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(/__[A-Z0-9_]+__/.test(r.stdout)).toBe(false);
    });

    it("substitutes __MARKER__ from the committed manifest, never from the runbook", () => {
      const r = render(script, "r0-baseline-unknown", GOOD_ENV);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.includes("$m$" + committedMarker + "$m$"), "the rendered form must carry the manifest's database_marker").toBe(true);
      expect(
        runbookText().includes(committedMarker),
        "the marker text must not be copied into the runbook: the renderer reads it from the manifest",
      ).toBe(false);
    });

    it("refuses an unknown form name with exit 2 and nothing on stdout", () => {
      for (const bad of ["nosuchform", "R0", "r0 baseline", "", "../etc"]) {
        const r = render(script, bad, GOOD_ENV);
        expect(r.status, `form ${JSON.stringify(bad)} must exit 2`).toBe(2);
        expect(r.stdout, `form ${JSON.stringify(bad)} must print nothing`).toBe("");
      }
    });

    /**
     * One row per placeholder: the form that carries it, its variable, a value the renderer
     * accepts, and values it must refuse. A refusal is exit 2 AND an empty stdout: a partial
     * statement on stdout is the failure this guards (it would be piped straight into a file).
     */
    const PLACEHOLDER_CASES: ReadonlyArray<{
      placeholder: string;
      forms: readonly string[];
      env: string;
      good: string[];
      bad: string[];
    }> = [
      {
        placeholder: "__SINCE__",
        forms: ["r4-legacy-writes-stopped"],
        env: "LR_SINCE",
        good: ["2026-11-01T00:00:00Z", "2026-12-31T23:59:59Z"],
        bad: ["", "2026-11-01", "2026-11-01T00:00:00", "2026-02-31T00:00:00Z", "2026-11-01T24:00:00Z", "2026-11-01T00:00:00.000Z", "x'; DROP TABLE t; --", "2026-11-01T00:00:00Z\n"],
      },
      {
        placeholder: "__DEPLOY_DAY__",
        forms: ["r3-bridge-holding"],
        env: "LR_DEPLOY_DAY",
        good: ["2026-11-01", "2028-02-29"],
        bad: ["", "20261101", "2026-13-01", "2026-02-31", "2027-02-29", "2026-11-01T00:00:00Z", "1; x", "2026-11-01\n"],
      },
      {
        placeholder: "__VERSION__",
        forms: ["ledger-row", "r6-drop-applied"],
        env: "LR_VERSION",
        good: ["20261101120000", "00000000000000"],
        bad: ["", "2026110112000", "202611011200000", "2026110112000a", "20261101120000; x", "20261101120000\n", "2026-11-01 12:00"],
      },
      {
        placeholder: "__PROC__",
        forms: ["body-check"],
        env: "LR_PROC",
        good: ["public.compute_bridge_outcome_deltas()", "public.extract_symbol_value_at(uuid, text, date)"],
        bad: ["", "compute_bridge_outcome_deltas()", "public.f(); DROP", "public.F()", "public.f('x')", "public.f()--", "pg_catalog.f()", "public.f(uuid)\n", "public.f1()", "public.f"],
      },
      {
        placeholder: "__NEEDLE__",
        forms: ["body-check"],
        env: "LR_NEEDLE",
        good: ["allocator_holdings", "a"],
        bad: ["", "A", "a b", "a1", "a'; x", "a.b", "a\n", "%"],
      },
    ];

    describe.each(PLACEHOLDER_CASES.map((c) => [c.placeholder, c] as const))("placeholder %s", (_ph, c) => {
      it.each(c.forms.map((f) => [f] as const))("is carried by form %s", (form) => {
        expect(forms.get(form) ?? "", `${form} must carry ${c.placeholder}`).toContain(c.placeholder);
      });

      it.each(c.good.map((v) => [v] as const))("is accepted with %j and substituted", (value) => {
        for (const form of c.forms) {
          const r = render(script, form, { ...GOOD_ENV, [c.env]: value });
          expect(r.status, `${form}: ${r.stderr}`).toBe(0);
          expect(r.stdout.includes(value), `${form}: the rendered statement must carry the value`).toBe(true);
          expect(r.stdout.includes(c.placeholder), `${form}: the placeholder must be gone`).toBe(false);
        }
      });

      it.each(c.bad.map((v) => [v] as const))("is refused with %j (exit 2, nothing printed)", (value) => {
        for (const form of c.forms) {
          const r = render(script, form, { ...GOOD_ENV, [c.env]: value });
          expect(r.status, `${form} with ${c.env}=${JSON.stringify(value)} must exit 2`).toBe(2);
          expect(r.stdout, `${form} must print nothing`).toBe("");
        }
      });

      it(`is refused when ${c.env} is absent (exit 2, nothing printed)`, () => {
        const env = { ...GOOD_ENV };
        delete env[c.env];
        for (const form of c.forms) {
          const r = render(script, form, env);
          expect(r.status, `${form} with ${c.env} absent must exit 2`).toBe(2);
          expect(r.stdout, `${form} must print nothing`).toBe("");
        }
      });
    });

    describe("against a scratch copy of the repo layout", () => {
      const root = mkdtempSync(join(tmpdir(), "lr-fixture-"));
      mkdirSync(join(root, "docs", "runbooks"), { recursive: true });
      mkdirSync(join(root, "scripts", "prod-prober"), { recursive: true });
      const fixtureRunbook = (body: string) =>
        writeFileSync(
          join(root, RUNBOOK_REL),
          "<!-- form: bogus -->\n```sql\n" + body + "\n```\n",
        );
      const fixtureManifest = (marker: unknown) =>
        writeFileSync(join(root, MANIFEST_REL), JSON.stringify({ database_marker: marker }));

      afterAll(() => {
        rmSync(root, { recursive: true, force: true });
      });

      it("refuses an unresolved __PLACEHOLDER__ with exit 2 and nothing on stdout", () => {
        fixtureRunbook("SELECT 1 AS x, __NOT_A_REAL_ONE__ AS y;");
        fixtureManifest("a database marker long enough to be usable here");
        const r = render(script, "bogus", GOOD_ENV, root);
        expect(r.status, r.stderr).toBe(2);
        expect(r.stdout).toBe("");
        expect(r.stderr.includes("__NOT_A_REAL_ONE__"), "the refusal must name the placeholder").toBe(true);
      });

      it("renders a form with no placeholder at all", () => {
        fixtureRunbook("SELECT 1 AS x;");
        fixtureManifest("a database marker long enough to be usable here");
        const r = render(script, "bogus", GOOD_ENV, root);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toBe("SELECT 1 AS x;\n");
      });

      it("refuses __MARKER__ when the manifest marker is absent, short, not a string, or carries the dollar-quote tag", () => {
        fixtureRunbook("SELECT __MARKER__ AS x;");
        for (const bad of [undefined, "", "short", 12345678901234567890, "a marker with a $m$ tag inside it, long enough"]) {
          fixtureManifest(bad);
          const r = render(script, "bogus", GOOD_ENV, root);
          expect(r.status, `marker ${JSON.stringify(bad)} must exit 2`).toBe(2);
          expect(r.stdout, `marker ${JSON.stringify(bad)} must print nothing`).toBe("");
        }
      });
    });
  });
});
