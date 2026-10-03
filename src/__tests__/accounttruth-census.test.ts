/**
 * Phase 167.1.2 plan 08, Task 1. The ACCOUNTTRUTH census can only read, aborts
 * on any database but PROD before it sends a census query, and prints counts
 * only (success criterion 6; T-167.1.2-37, -38, -40).
 *
 * Why each block matters:
 *   - The static read-only guard is the ONLY write barrier on the
 *     `--print-sql` path: an operator pastes those statements into
 *     `supabase db query --linked`, which has no read-only transaction behind
 *     it. So the guard is pinned on the actual `--print-sql` stdout, and the
 *     printed set must equal the set live mode sends.
 *   - TEST carries a database marker too, so "non-NULL" proves nothing (I2).
 *     Only the manifest's PROD marker, compared exactly, lets the census run.
 *   - Row-level security filters rows WITHOUT an error. A census read by a role
 *     that RLS applies to would print plausible, wrong counts, so live mode
 *     sets row_security=off and both paths carry a role probe.
 *   - The repo is public: an id or a dollar figure in the output is a leak.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DB_MARKER_SQL,
  DEPARTED_DECISION_CTES,
  FIXED_EXCHANGES,
  PGOPTIONS_READ_ONLY,
  READ_ONLY_PROBE_SQL,
  RLS_PROBE_SQL,
  SECTIONS,
  allStatements,
  fixtureSqlRunner,
  parseCounts,
  psqlInvocation,
  readManifestMarker,
  realSqlRunner,
  runCensus,
} from "../../scripts/accounttruth-census.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO, "scripts", "accounttruth-census.mjs");
const MANIFEST = join(REPO, "scripts", "prod-prober", "cron-manifest.json");

const PROD_MARKER: string = JSON.parse(readFileSync(MANIFEST, "utf8")).database_marker;
// The prober's fixture marker, read from its source by symbol, never restated.
const PROBER_FIXTURE_MARKER = (() => {
  const src = readFileSync(join(REPO, "scripts", "prod-prober", "run.mjs"), "utf8");
  const m = src.match(/const FIXTURE_DB_MARKER = "([^"]+)";/);
  if (!m) throw new Error("FIXTURE_DB_MARKER not found in scripts/prod-prober/run.mjs");
  return m[1];
})();
// TEST's real marker is not recorded in the repo (the workflows withhold it);
// what matters is its shape: non-NULL, names TEST, is not the PROD marker.
const TEST_SHAPED_MARKER = "TEST - shared pre-prod database. CI writes here.";

// ---------------------------------------------------------------------------
// The static read-only guard.
// ---------------------------------------------------------------------------

/** Statement-level keywords that write, lock, change session state or run code. */
const WRITE_OR_DDL = new RegExp(
  "\\b(" +
    [
      "insert", "update", "delete", "truncate", "alter", "create", "drop", "grant", "revoke",
      "into", "copy", "call", "do", "set", "reset", "lock", "merge", "vacuum", "analyze",
      "reindex", "cluster", "comment", "notify", "listen", "unlisten", "prepare", "execute",
      "deallocate", "discard", "refresh", "begin", "commit", "rollback", "savepoint",
      "security", "import", "load", "checkpoint",
    ].join("|") +
    ")\\b",
  "i",
);

/** The only functions a census statement may call. */
const ALLOWED_FUNCTIONS = new Set([
  "count", "min", "max", "bool_or", "bool_and", "row_number", "lag", "coalesce", "least",
  "lower", "btrim", "chr", "jsonb_typeof", "jsonb_array_elements", "jsonb_array_length",
  "shobj_description", "current_setting", "current_database",
]);

/** SQL syntax that is followed by "(" without being a function call. */
const PAREN_SYNTAX = new Set([
  "as", "in", "exists", "filter", "over", "values", "and", "or", "not", "on", "from",
  "join", "lateral", "union", "all", "select", "where", "then", "else", "when", "case", "end",
  "with", "recursive", "is", "distinct",
]);

function stripCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/** Names the statement itself declares and then uses with "(": CTEs, alias column lists. */
function declaredNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:\([^()]*\)\s*)?as\s*\(/gi)) names.add(m[1].toLowerCase());
  for (const m of code.matchAll(/\bas\s+([a-z_][a-z0-9_]*)\s*\(/gi)) names.add(m[1].toLowerCase());
  return names;
}

/** Why `sql` is not a lone read-only SELECT, or null when it is. */
function readOnlyViolation(sql: string): string | null {
  const code = stripCommentsAndLiterals(sql).trim();
  const body = code.replace(/;\s*$/, "");
  if (body.includes(";")) return "more than one statement";
  if (!/^(select|with)\b/i.test(body)) return "does not start with SELECT or WITH";
  const kw = body.match(WRITE_OR_DDL);
  if (kw) return `forbidden keyword: ${kw[1]}`;
  if (/\$[a-z_]*\$/i.test(body)) return "dollar-quoted body";
  const declared = declaredNames(body);
  for (const m of body.matchAll(/(?<![.\w])([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const name = m[1].toLowerCase();
    if (ALLOWED_FUNCTIONS.has(name) || PAREN_SYNTAX.has(name) || declared.has(name)) continue;
    return `function not on the allowlist: ${name}`;
  }
  if (/\b[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*\(/i.test(body)) return "schema-qualified function call";
  return null;
}

/** Parse `--print-sql` stdout into labelled statements. */
function parsePrinted(stdout: string): Array<{ label: string; sql: string }> {
  const out: Array<{ label: string; sql: string }> = [];
  const blocks = stdout.split(/^-- census \(/m).filter((b) => b.trim() !== "");
  for (const block of blocks) {
    // A missing ")" or newline would make indexOf answer -1, and slice(0, -1)
    // or slice(0) would quietly pass a wrong label or the whole block on.
    const close = block.indexOf(")");
    const eol = block.indexOf("\n");
    if (close < 0 || eol < 0) throw new Error(`--print-sql block without a "(label)" header line: ${block.slice(0, 40)}`);
    out.push({ label: block.slice(0, close), sql: block.slice(eol + 1).trim() });
  }
  return out;
}

function runCli(args: string[], env: Record<string, string | undefined> = { PATH: process.env.PATH }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: env as NodeJS.ProcessEnv, cwd: REPO });
}

describe("the read-only guard can fail (calibration)", () => {
  it.each([
    ["an UPDATE", "SELECT 1; UPDATE public.api_keys SET label = 'x'"],
    ["an UPDATE alone", "UPDATE public.api_keys SET label = 'x'"],
    ["a WITH ... DELETE", "WITH x AS (DELETE FROM public.api_keys RETURNING 1) SELECT * FROM x"],
    ["SELECT INTO (creates a table)", "SELECT 1 INTO scratch_table"],
    ["a row lock", "SELECT 1 FROM public.api_keys FOR UPDATE"],
    ["a writer function", "SELECT nextval('s')"],
    ["an enqueue RPC", "SELECT public.enqueue_compute_job(NULL)"],
    ["a session SET", "SET statement_timeout = 0"],
    ["a DO block", "DO $$ BEGIN END $$"],
    ["set_config", "SELECT set_config('x', 'y', false)"],
  ])("rejects %s", (_name, sql) => {
    expect(readOnlyViolation(sql)).not.toBeNull();
  });

  it("accepts a lone SELECT, and a forbidden word inside a comment or a literal", () => {
    expect(readOnlyViolation("SELECT 1;")).toBeNull();
    expect(readOnlyViolation("-- no update here\nSELECT 'delete' AS bucket, count(*) FROM t")).toBeNull();
  });
});

describe("(1) every statement the census can send is a lone read-only SELECT", () => {
  it("the exported statements: marker, rls, then (a) to (f), each accepted by the guard", () => {
    const labels = allStatements().map((s: { label: string }) => s.label);
    expect(labels).toEqual(["marker", "rls", "a", "b", "c", "d", "e", "f"]);
    for (const s of allStatements() as Array<{ label: string; sql: string }>) {
      expect({ label: s.label, violation: readOnlyViolation(s.sql) }).toEqual({ label: s.label, violation: null });
    }
    expect(readOnlyViolation(READ_ONLY_PROBE_SQL)).toBeNull();
  });

  it("--print-sql prints exactly those statements, identical apart from the terminating `;`, each passing the guard", () => {
    const res = runCli(["--print-sql"]);
    expect(res.status).toBe(0);
    const printed = parsePrinted(res.stdout);
    expect(printed.map((p) => p.label)).toEqual(["marker", "rls", "a", "b", "c", "d", "e", "f"]);
    const exported = new Map((allStatements() as Array<{ label: string; sql: string }>).map((s) => [s.label, s.sql]));
    for (const p of printed) {
      expect(p.sql.endsWith(";")).toBe(true);
      expect(p.sql.slice(0, -1)).toBe(exported.get(p.label));
      expect({ label: p.label, violation: readOnlyViolation(p.sql) }).toEqual({ label: p.label, violation: null });
    }
  });

  it("--print-sql=b prints only (b), and an unknown label is a usage error", () => {
    const one = runCli(["--print-sql=b"]);
    expect(one.status).toBe(0);
    expect(parsePrinted(one.stdout).map((p) => p.label)).toEqual(["b"]);
    expect(runCli(["--print-sql=z"]).status).toBe(2);
  });

  // IN-03: an extra argument used to be ignored silently, so an operator who
  // typed `--print-sql --fixture x.json` believed a fixture was involved.
  it("--print-sql with any other argument is a usage error and prints no SQL", () => {
    for (const extra of [["--fixture", "x.json"], ["b"], ["--print-sql=a"]]) {
      const res = runCli(["--print-sql", ...extra]);
      expect({ extra, status: res.status }).toEqual({ extra, status: 2 });
      expect(res.stdout).toBe("");
      expect(res.stderr).toContain("--print-sql takes no other argument");
    }
  });

  it("every statement the live loop sends is one of them (spy over the runner)", () => {
    const sent: string[] = [];
    const inner = fixtureSqlRunner(greenFixture());
    const code = runCensus({
      sql: (q: string) => {
        sent.push(q);
        return inner(q);
      },
      expectedMarker: PROD_MARKER,
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(0);
    const allowed = new Set([...(allStatements() as Array<{ sql: string }>).map((s) => s.sql), READ_ONLY_PROBE_SQL]);
    expect(sent.every((q) => allowed.has(q))).toBe(true);
    expect(sent.length).toBe(3 + SECTIONS.length);
  });

  it("no write or DDL word appears in the script outside a comment line", () => {
    const lines = readFileSync(SCRIPT, "utf8").split("\n");
    const hits = lines.filter(
      (l) =>
        /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i.test(l) &&
        !/^\s*(\/\/|\/\*|\*)/.test(l),
    );
    expect(hits).toEqual([]);
  });
});

describe("(2) the live session is read-only and the password stays out of argv", () => {
  const env = {
    PROBER_POOLER_URL: "postgresql://prober@pooler.selftest.invalid:5432/postgres",
    PGPASSWORD: "selftest-password",
    PATH: "/usr/bin",
    HOME: "/home/should-not-pass",
  };

  it("the child environment sets default_transaction_read_only=on and nothing inherited", () => {
    const inv = psqlInvocation(env, "SELECT 1");
    expect(inv.env.PGOPTIONS).toContain("default_transaction_read_only=on");
    expect(inv.env.PGOPTIONS).toContain("row_security=off");
    expect(Object.keys(inv.env).sort()).toEqual(["PATH", "PGCONNECT_TIMEOUT", "PGOPTIONS", "PGPASSWORD"]);
    expect(inv.argv.join(" ")).not.toContain("selftest-password");
    expect(inv.argv).toEqual(expect.arrayContaining(["ON_ERROR_STOP=1", "-At", "-X"]));
  });

  it("the real runner hands psql exactly that environment", () => {
    const calls: Array<{ cmd: string; argv: string[]; env: Record<string, string> }> = [];
    const fakeSpawn = (cmd: string, argv: string[], opts: { env: Record<string, string> }) => {
      calls.push({ cmd, argv, env: opts.env });
      return { status: 0, stdout: "x\n", stderr: "" };
    };
    realSqlRunner(env, fakeSpawn as unknown as typeof spawnSync)("SELECT 1");
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("psql");
    expect(calls[0].env.PGOPTIONS).toBe(PGOPTIONS_READ_ONLY);
    expect(calls[0].env.PGPASSWORD).toBe("selftest-password");
  });

  it("a session that reads back transaction_read_only=off is refused before any census query", () => {
    const sent: string[] = [];
    const inner = fixtureSqlRunner({ ...greenFixture(), read_only: "off" });
    const errs: string[] = [];
    const code = runCensus({
      sql: (q: string) => {
        sent.push(q);
        return inner(q);
      },
      expectedMarker: PROD_MARKER,
      out: () => {},
      err: (s: string) => errs.push(s),
    });
    expect(code).toBe(1);
    expect(sent).toEqual([DB_MARKER_SQL, READ_ONLY_PROBE_SQL]);
    expect(errs.join("\n")).toContain("not read-only");
  });

  it("a session where row_security did not read back off is refused before any census query", () => {
    const sent: string[] = [];
    const inner = fixtureSqlRunner({ ...greenFixture(), row_security: "on" });
    const code = runCensus({
      sql: (q: string) => {
        sent.push(q);
        return inner(q);
      },
      expectedMarker: PROD_MARKER,
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(1);
    expect(sent).toEqual([DB_MARKER_SQL, READ_ONLY_PROBE_SQL]);
  });

  it("a role that RLS applies to is refused before any census query", () => {
    const sent: string[] = [];
    const inner = fixtureSqlRunner({ ...greenFixture(), rls: "subject_to_rls" });
    const errs: string[] = [];
    const code = runCensus({
      sql: (q: string) => {
        sent.push(q);
        return inner(q);
      },
      expectedMarker: PROD_MARKER,
      out: () => {},
      err: (s: string) => errs.push(s),
    });
    expect(code).toBe(1);
    expect(sent).toEqual([DB_MARKER_SQL, READ_ONLY_PROBE_SQL, RLS_PROBE_SQL]);
    expect(errs.join("\n")).toContain("row-level security");
  });

  it("refuses a pooler URL that carries a password", () => {
    const res = runCli([], {
      PATH: process.env.PATH,
      PROBER_POOLER_URL: "postgresql://prober:secret@pooler.selftest.invalid:5432/postgres",
      PGPASSWORD: "x",
    });
    expect(res.status).toBe(2);
    expect(res.stderr).not.toContain("secret");
  });
});

describe("(3) the marker gate: only the manifest's PROD marker proceeds (I2)", () => {
  function gate(marker: string | null) {
    const sent: string[] = [];
    const inner = fixtureSqlRunner({ ...greenFixture(), marker });
    const errs: string[] = [];
    const outs: string[] = [];
    const code = runCensus({
      sql: (q: string) => {
        sent.push(q);
        return inner(q);
      },
      expectedMarker: readManifestMarker(),
      out: (s: string) => outs.push(s),
      err: (s: string) => errs.push(s),
    });
    return { code, sent, err: errs.join("\n"), out: outs.join("\n") };
  }

  it("the expected marker is the manifest's database_marker, read at run time", () => {
    expect(readManifestMarker()).toBe(PROD_MARKER);
    expect(readFileSync(SCRIPT, "utf8")).not.toContain(PROD_MARKER);
  });

  it("(3) a NULL marker aborts before any census query", () => {
    const r = gate(null);
    expect(r.code).toBe(1);
    expect(r.sent).toEqual([DB_MARKER_SQL]);
    expect(r.err).toContain("NULL");
    expect(r.err).toContain(JSON.stringify(PROD_MARKER));
  });

  it.each([
    ["a TEST-shaped marker", TEST_SHAPED_MARKER],
    ["the prober's fixture marker", PROBER_FIXTURE_MARKER],
    ["the PROD marker with a trailing space", `${PROD_MARKER} `],
  ])("(3b) %s aborts with exit 1, naming both markers", (_name, marker) => {
    const r = gate(marker);
    expect(r.code).toBe(1);
    expect(r.sent).toEqual([DB_MARKER_SQL]);
    expect(r.err).toContain(JSON.stringify(marker));
    expect(r.err).toContain(JSON.stringify(PROD_MARKER));
  });

  it("(3c) the exact manifest marker proceeds to every section", () => {
    const r = gate(PROD_MARKER);
    expect(r.code).toBe(0);
    expect(r.sent).toEqual([DB_MARKER_SQL, READ_ONLY_PROBE_SQL, RLS_PROBE_SQL, ...SECTIONS.map((s: { sql: string }) => s.sql)]);
  });
});

describe("(4) a fixture run prints the six sections, counts only", () => {
  it("end to end through the CLI's --fixture seam", () => {
    const dir = mkdtempSync(join(tmpdir(), "act-census-"));
    try {
      const path = join(dir, "answers.json");
      writeFileSync(path, JSON.stringify(greenFixture()));
      const res = runCli(["--fixture", path]);
      expect(res.status).toBe(0);
      for (const s of SECTIONS) {
        expect(res.stdout).toContain(`(${s.letter}) ${s.title}`);
      }
      expect(res.stdout).toContain("duplicate.blocking: 1");
      expect(res.stdout).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(res.stdout).not.toContain("$");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // IN-03: a missing or malformed fixture used to end in an uncaught stack trace.
  it("a missing, malformed or non-object --fixture file is a clean usage error (exit 2, no stack trace)", () => {
    const dir = mkdtempSync(join(tmpdir(), "act-census-"));
    try {
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{ not json");
      const arr = join(dir, "arr.json");
      writeFileSync(arr, "[]");
      for (const path of [join(dir, "absent.json"), bad, arr]) {
        const res = runCli(["--fixture", path]);
        expect({ path, status: res.status }).toEqual({ path, status: 2 });
        expect(res.stderr).toMatch(/--fixture file/);
        expect(res.stderr).not.toMatch(/\n\s+at /);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an id-shaped or non-token bucket, or a non-count, is refused rather than printed", () => {
    const id = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";
    expect(parseCounts(`${id}\t1\n`).problem).toMatch(/identifier/);
    expect(parseCounts("owner@example.com\t1\n").problem).toMatch(/plain token/);
    expect(parseCounts("total_usd\t12.5\n").problem).toMatch(/integer/);
    expect(parseCounts("ready\t3\n").rows).toEqual([["ready", 3]]);

    const outs: string[] = [];
    const fx = greenFixture();
    fx.sections.b = [[id, 1]];
    const code = runCensus({
      sql: fixtureSqlRunner(fx),
      expectedMarker: PROD_MARKER,
      out: (s: string) => outs.push(s),
      err: () => {},
    });
    expect(code).toBe(1);
    expect(outs.join("\n")).not.toContain(id);
  });
});

function greenFixture(): {
  marker: string | null;
  read_only?: string;
  row_security?: string;
  rls?: string;
  sections: Record<string, Array<[string, number]>>;
} {
  // Every section's required buckets (SFH M-4) at 0, then the values the
  // assertions read, then the GROUP BY buckets a real answer may carry.
  const values: Record<string, Record<string, number>> = {
    a: { "all.live_keys": 10, "all.live_keys_venue_account_id_null": 2, "okx.live_keys": 4 },
    b: { "duplicate.blocking": 1, "duplicate.marked": 2 },
    c: { owners_with_eligible_keys: 5, owners_missing_returns: 1 },
    d: { equity_curve_rows: 5, "version=2,is_trustworthy=true": 4, "degrade_reason=dropped_key": 1 },
    e: { owners_with_eligible_keys: 5, ready: 3, "rebuilding:duplicate_account": 1 },
    f: { departed_keys: 4, "included:distinct_account": 2, departed_key_inputs_row_gone: 1 },
  };
  const sections: Record<string, Array<[string, number]>> = {};
  for (const s of SECTIONS as ReadonlyArray<{ letter: string; required: readonly string[] }>) {
    const rows = new Map<string, number>(s.required.map((b) => [b, 0]));
    for (const [b, n] of Object.entries(values[s.letter] ?? {})) rows.set(b, n);
    sections[s.letter] = [...rows.entries()];
  }
  return { marker: PROD_MARKER, read_only: "on", row_security: "off", rls: "bypasses_rls", sections };
}

// ---------------------------------------------------------------------------
// SFH M-4: every section returns rows by construction, so an empty answer or a
// missing fixed bucket is a measure failure, never "(no rows)" and exit 0. An
// operator reading an absent line could read it as 0.
// ---------------------------------------------------------------------------

describe("(4b) an empty section or a missing fixed bucket fails, naming it", () => {
  function run(mutate: (fx: ReturnType<typeof greenFixture>) => void) {
    const fx = greenFixture();
    mutate(fx);
    const outs: string[] = [];
    const errs: string[] = [];
    const code = runCensus({
      sql: fixtureSqlRunner(fx),
      expectedMarker: PROD_MARKER,
      out: (s: string) => outs.push(s),
      err: (s: string) => errs.push(s),
    });
    return { code, out: outs.join("\n"), err: errs.join("\n") };
  }

  it("the green fixture passes (calibration: the checks below are not always red)", () => {
    expect(run(() => {}).code).toBe(0);
  });

  it.each(["a", "b", "c", "d", "e", "f"])("an empty (%s) exits 1 and says so", (letter) => {
    const r = run((fx) => {
      fx.sections[letter] = [];
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain(`(${letter}) answered with no rows`);
    expect(r.out).not.toContain("(no rows)");
  });

  it("each section's required bucket, removed alone, exits 1 naming that bucket", () => {
    for (const s of SECTIONS as ReadonlyArray<{ letter: string; required: readonly string[] }>) {
      for (const bucket of s.required) {
        const r = run((fx) => {
          fx.sections[s.letter] = fx.sections[s.letter].filter(([b]) => b !== bucket);
        });
        expect({ bucket, code: r.code }).toEqual({ bucket, code: 1 });
        expect(r.err).toContain(`(${s.letter}) answered without bucket ${bucket}`);
      }
    }
  });

  // Declared in the script, not read from the runbook: the runbook lives under
  // .planning/, which the -pr filter strips and which a planning-only PR can
  // change without running this file. The runbook's section table names the
  // same buckets (a: <venue>.live_keys_unstamped_unmarked, b: duplicate.blocking,
  // c: owners_missing_either, d: version=2,is_trustworthy=true, e: ready,
  // f: departed_key_inputs_row_gone).
  it("every gate bucket is required, except (d)'s GROUP BY bucket, whose absence is a 0", () => {
    const sections = SECTIONS as ReadonlyArray<{
      letter: string;
      required: readonly string[];
      gate: readonly string[];
      gateMayBeAbsent: boolean;
    }>;
    expect(Object.fromEntries(sections.map((s) => [s.letter, [...s.gate]]))).toEqual({
      a: ["binance", "okx", "bybit", "deribit", "sfox", "mt5"].map((x) => `${x}.live_keys_unstamped_unmarked`),
      b: ["duplicate.blocking"],
      c: ["owners_missing_either"],
      d: ["version=2,is_trustworthy=true"],
      e: ["ready"],
      f: ["departed_key_inputs_row_gone"],
    });
    for (const s of sections) {
      for (const bucket of s.gate) {
        expect({ letter: s.letter, bucket, required: s.required.includes(bucket) }).toEqual({
          letter: s.letter,
          bucket,
          required: !s.gateMayBeAbsent,
        });
      }
    }
    expect(sections.filter((s) => s.gateMayBeAbsent).map((s) => s.letter)).toEqual(["d"]);
  });

  // SFH R2-L2: the M-4 error text teaches "an absent line is not a 0", so a gate
  // the runbook reads must never be an absent line. (d)'s gate is a GROUP BY
  // bucket with no row exactly when its count is 0; the script prints that 0
  // explicitly, marked absent, rather than leaving the line out.
  it("(d)'s gate prints its real count when present, and an explicit 0 marked absent when its GROUP BY bucket has no row", () => {
    const gate = "version=2,is_trustworthy=true";
    const present = run(() => {});
    expect(present.code).toBe(0);
    expect(present.out).toContain(`  ${gate}: 4`);
    expect(present.out).not.toContain("(absent");

    const absent = run((fx) => {
      fx.sections.d = fx.sections.d.filter(([b]) => b !== gate);
    });
    expect(absent.code).toBe(0);
    expect(absent.out.split("\n").filter((l) => l.startsWith(`  ${gate}:`))).toEqual([
      `  ${gate}: 0 (absent: a GROUP BY bucket with no rows)`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// (5) Section (a) separates "unstamped" from "marked as sharing an account".
// Debug session unstamped-venue-account-id (2026-10-03): 12 of the 14 PROD
// keys `live_keys_venue_account_id_null` counted were keys the stamper had
// MARKED duplicate. A marked key keeps venue_account_id NULL by design (the
// unique index refuses its id), so the runbook's stamp gate, which read that
// bucket, could never pass while a duplicate was live. The gate must read a
// bucket that leaves marked keys out.
// ---------------------------------------------------------------------------

describe("(5) census (a) has a stamp-gate bucket that excludes marked keys", () => {
  const sqlA = (SECTIONS as ReadonlyArray<{ letter: string; sql: string }>).find((s) => s.letter === "a")!.sql;
  const arms = sqlA.split(/^UNION ALL$/m);

  it("prints live_keys_unstamped_unmarked per exchange and for all", () => {
    const perExchange = arms.filter((a) => a.includes("'.live_keys_unstamped_unmarked'"));
    const all = arms.filter((a) => a.includes("'all.live_keys_unstamped_unmarked'"));
    expect(perExchange).toHaveLength(1);
    expect(all).toHaveLength(1);
  });

  // WR-01 / SFH M-2 (2026-10-03): a marker is never cleared when its holder
  // departs (D-18), so "has a marker" is not "resolved". Only a holder that
  // still holds the unique index's slot (same owner, disconnected_at NULL)
  // blocks the stamp. Section (6) proves the semantics on a real cluster; this
  // pins the shape so both arms read the one definition.
  it("both unstamped_unmarked arms read one `unresolved` set, whose marker test is the index's own condition", () => {
    const unmarked = arms.filter((a) => a.includes("live_keys_unstamped_unmarked"));
    expect(unmarked).toHaveLength(2);
    for (const arm of unmarked) expect(arm).toMatch(/\bunresolved\b/);
    const cte = sqlA.match(/unresolved AS \(([\s\S]*?)\n\)/);
    expect(cte, "SQL_A declares an `unresolved` CTE").not.toBeNull();
    const body = cte![1];
    expect(body).toMatch(/k\.eligible/);
    expect(body).toMatch(/NOT k\.venue_known/);
    expect(body).toMatch(/h\.id = k\.holder_id AND h\.user_id = k\.user_id/);
    expect(body).toMatch(/h\.disconnected_at IS NULL/);
    expect(body).toMatch(/h\.venue_known AND h\.exchange = k\.exchange/);
    expect(body).not.toMatch(/holder_id IS NULL/);
    expect(body).not.toMatch(/h\.(eligible|working)/);
  });

  it("the raw NULL buckets stay, and do not filter on the marker", () => {
    const raw = arms.filter((a) => a.includes("live_keys_venue_account_id_null"));
    expect(raw).toHaveLength(2);
    for (const arm of raw) {
      expect(arm).not.toMatch(/holder_id/);
    }
  });
});


// ---------------------------------------------------------------------------
// (6) SFH M-3: the census SQL EXECUTED, on a throwaway local PostgreSQL cluster.
//
// Every block above checks text: the guard, the arm shapes, canned fixture
// answers. None of them can fail on a wrong predicate, and a wrong predicate
// prints plausible counts with exit 0 into a PROD recompute gate. This block
// boots a private cluster, seeds stand-in rows, and runs the real statements
// through the real runner (realSqlRunner -> psql -> runCensus), so the marker
// gate, the read-only read-back, the RLS probe, parseCounts and the M-4
// required-bucket checks all read real psql output.
//
// WHY NOT `scripts/pg-lane/run.sh` ITSELF. That lane preloads pg_cron on every
// boot and fails loud without it, and the vitest shards (`frontend-test`) do
// not provision pg_cron. So this block asks the lane only for its server
// binaries (`--print-pgbin`, the repo's one selector) and boots a minimal
// cluster of its own: socket-only (`listen_addresses = ''`, so no port can
// collide with another worker), trust auth, removed in afterAll.
//
// ⛔ It never touches TEST or PROD: the cluster is initdb'd here, has no TCP
// listener, and its marker is a local string, not the manifest's.
//
// ⛔ No skip gate. With no PostgreSQL server binaries, beforeAll THROWS with the
// lane's own diagnosis, so the file fails instead of passing on nothing.
//
// The stand-in tables carry only the columns the census reads, with the real
// types (uuid ids) and the real partial unique index. They deliberately leave
// out api_keys_exchange_check, so an exchange outside the fixed list (SFH L-2)
// can be seeded.
// ---------------------------------------------------------------------------

const LOCAL_MARKER = "accounttruth-census local harness. Throwaway cluster, not TEST, not PROD.";

const STAND_IN_DDL = `
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  exchange text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sync_status text DEFAULT 'idle',
  disconnected_at timestamptz,
  venue_account_id text,
  account_shared_with_api_key_id uuid,
  account_share_kind text,
  history_inclusion text,
  CHECK ((account_shared_with_api_key_id IS NULL) = (account_share_kind IS NULL)),
  CHECK (account_shared_with_api_key_id IS NULL OR account_shared_with_api_key_id <> id),
  CHECK (venue_account_id IS NULL OR btrim(venue_account_id) <> '')
);
CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id)
  WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL;
CREATE TABLE public.csv_daily_returns (
  id bigserial PRIMARY KEY,
  date date NOT NULL,
  api_key_id uuid,
  allocator_id uuid
);
CREATE TABLE public.allocator_equity_derived (
  allocator_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (allocator_id, kind)
);
COMMENT ON DATABASE postgres IS '${LOCAL_MARKER}';
`;

const RESET_SQL = "TRUNCATE public.api_keys, public.csv_daily_returns, public.allocator_equity_derived;";

function lit(v: string | boolean | null | undefined): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${v.replace(/'/g, "''")}'`;
}

type KeyRow = {
  id: string;
  user_id: string;
  exchange: string;
  is_active?: boolean;
  sync_status?: string | null;
  disconnected_at?: string | null;
  venue_account_id?: string | null;
  holder?: string | null;
  share_kind?: string | null;
  history_inclusion?: string | null;
};

function insertKeys(rows: KeyRow[]): string {
  if (rows.length === 0) return "";
  const values = rows.map(
    (r) =>
      `(${lit(r.id)}, ${lit(r.user_id)}, ${lit(r.exchange)}, ${lit(r.is_active ?? true)}, ${lit(r.sync_status ?? "complete")}, ` +
      `${lit(r.disconnected_at ?? null)}, ${lit(r.venue_account_id ?? null)}, ${lit(r.holder ?? null)}, ` +
      `${lit(r.share_kind ?? null)}, ${lit(r.history_inclusion ?? null)})`,
  );
  return (
    "INSERT INTO public.api_keys (id, user_id, exchange, is_active, sync_status, disconnected_at, venue_account_id, " +
    `account_shared_with_api_key_id, account_share_kind, history_inclusion) VALUES\n${values.join(",\n")};\n`
  );
}

describe("(6) the census SQL, executed on a throwaway local PostgreSQL cluster (SFH M-3)", () => {
  let root = "";
  let pgbin = "";
  let started = false;

  // IN-R2-02: the harness's own server and seeding calls get a stripped env,
  // like the census runner's psqlInvocation, so a caller's PGHOSTADDR, PGPORT,
  // PGUSER or PGDATABASE cannot redirect them away from this socket.
  const harnessEnv: Record<string, string | undefined> = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };
  const HARNESS_ENV = harnessEnv as NodeJS.ProcessEnv;

  function pg(tool: string, args: string[]) {
    const res = spawnSync(join(pgbin, tool), args, { encoding: "utf8", env: HARNESS_ENV });
    if (res.status !== 0) {
      throw new Error(`${tool} ${args[0] ?? ""} exited ${res.status}: ${res.stderr || res.stdout}`);
    }
    return res.stdout;
  }

  /** Run SQL as the cluster superuser; returns psql -At stdout. */
  function psql(sql: string): string {
    const res = spawnSync(
      join(pgbin, "psql"),
      ["-h", root, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q", "-X", "-F", "\t", "-f", "-"],
      { encoding: "utf8", input: sql, env: HARNESS_ENV },
    );
    if (res.status !== 0) throw new Error(`psql exited ${res.status}: ${res.stderr}`);
    return res.stdout;
  }

  /** The env realSqlRunner reads, pointed at this cluster's socket. */
  function localEnv() {
    return {
      PROBER_POOLER_URL: `postgresql://postgres@/postgres?host=${root}`,
      PGPASSWORD: "unused-under-trust-auth",
      PATH: `${pgbin}:${process.env.PATH ?? ""}`,
    };
  }

  function counts(sql: string): Map<string, number> {
    const res = realSqlRunner(localEnv())(sql);
    expect(res.measureFail).toBeNull();
    const parsed = parseCounts(res.stdout);
    expect(parsed.problem).toBeNull();
    return new Map(parsed.rows as Array<[string, number]>);
  }

  beforeAll(() => {
    const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
    if (sel.status !== 0 || sel.stdout.trim() === "") {
      throw new Error(
        "census SQL harness: no PostgreSQL server binaries. `bash scripts/pg-lane/run.sh --print-pgbin` said:\n" +
          sel.stderr,
      );
    }
    pgbin = sel.stdout.trim();
    // /tmp, not os.tmpdir(): the socket path must stay under the ~104-byte
    // sun_path limit, and a long TMPDIR would push it past.
    root = mkdtempSync("/tmp/acs-");
    const data = join(root, "pgd");
    pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
    writeFileSync(
      join(data, "postgresql.conf"),
      `${readFileSync(join(data, "postgresql.conf"), "utf8")}\nlisten_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`,
    );
    // IN-R2-02: set BEFORE the start. A start that times out on a loaded runner
    // can still bring the postmaster up late; afterAll must then stop it
    // before deleting its data directory. Stopping a cluster that never came
    // up only exits non-zero, which afterAll ignores.
    started = true;
    pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
    psql(STAND_IN_DDL);
  }, 90000);

  afterAll(() => {
    if (started) spawnSync(join(pgbin, "pg_ctl"), ["-D", join(root, "pgd"), "-m", "immediate", "-w", "stop"], { env: HARNESS_ENV });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  // ---- (a): stamped / unresolved / resolved, on real rows ------------------
  //
  // owner A, okx:
  //   S   stamped 'acct-1', live                          -> stamped
  //   U   no id, no marker                                 -> unresolved
  //   M1  no id, duplicate of S (live holder)              -> resolved
  //   HD  holder that DEPARTED (disconnected), 'acct-2'    -> not live
  //   M2  no id, duplicate of HD (departed holder)         -> unresolved (WR-01)
  // owner B, okx:
  //   X   stamped 'acct-1', the SAME account as A's S      -> stamped; cross-owner
  //       keys on one account are expected and are no duplicate
  //   MX  no id, marked against A's S (another owner)      -> unresolved: only a
  //       holder in the SAME owner's keys can hold this key's index slot
  // owner A, deribit:
  //   R   revoked but still connected, 'acct-9'            -> not eligible, but it
  //       still holds the index slot
  //   MR  no id, duplicate of R                            -> resolved (a holder
  //       test on `eligible` would wrongly call it unresolved)
  // owner A, kraken (outside the fixed list, SFH L-2):
  //   K1  stamped 'k-1'; K2 no id, no marker               -> own per-exchange lines
  const A = "a0000000-0000-4000-8000-00000000000a";
  const B = "b0000000-0000-4000-8000-00000000000b";
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const SEED_A: KeyRow[] = [
    { id: id(1), user_id: A, exchange: "okx", venue_account_id: "acct-1" },
    { id: id(2), user_id: A, exchange: "okx" },
    { id: id(3), user_id: A, exchange: "okx", holder: id(1), share_kind: "duplicate" },
    { id: id(4), user_id: A, exchange: "okx", venue_account_id: "acct-2", is_active: false, disconnected_at: "2026-09-01T00:00:00Z" },
    { id: id(5), user_id: A, exchange: "okx", holder: id(4), share_kind: "duplicate" },
    { id: id(6), user_id: B, exchange: "okx", venue_account_id: "acct-1" },
    { id: id(7), user_id: B, exchange: "okx", holder: id(1), share_kind: "duplicate" },
    { id: id(8), user_id: A, exchange: "deribit", venue_account_id: "acct-9", sync_status: "revoked" },
    { id: id(9), user_id: A, exchange: "deribit", holder: id(8), share_kind: "duplicate" },
    { id: id(10), user_id: A, exchange: "kraken", venue_account_id: "k-1" },
    { id: id(11), user_id: A, exchange: "kraken" },
  ];

  const sqlA = () => (SECTIONS as ReadonlyArray<{ letter: string; sql: string }>).find((s) => s.letter === "a")!.sql;
  const sqlB = () => (SECTIONS as ReadonlyArray<{ letter: string; sql: string }>).find((s) => s.letter === "b")!.sql;

  it("the full census runs end to end through realSqlRunner and exits 0 (marker, read-only, RLS, every section)", () => {
    psql(RESET_SQL + insertKeys(SEED_A));
    const outs: string[] = [];
    const errs: string[] = [];
    const code = runCensus({
      sql: realSqlRunner(localEnv()),
      expectedMarker: LOCAL_MARKER,
      out: (s: string) => outs.push(s),
      err: (s: string) => errs.push(s),
    });
    expect({ code, errs }).toEqual({ code: 0, errs: [] });
    const text = outs.join("\n");
    expect(text).toContain("session is read-only with row security off");
    for (const s of SECTIONS as ReadonlyArray<{ letter: string; title: string }>) expect(text).toContain(`(${s.letter}) ${s.title}`);
  });

  it("the marker gate refuses this cluster against the manifest's PROD marker, sending nothing else", () => {
    const sent: string[] = [];
    const inner = realSqlRunner(localEnv());
    const code = runCensus({
      sql: (q: string) => {
        sent.push(q);
        return inner(q);
      },
      expectedMarker: PROD_MARKER,
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(1);
    expect(sent).toEqual([DB_MARKER_SQL]);
  });

  it("(a) counts each fixture where it belongs: departed-holder and other-owner markers are unresolved", () => {
    psql(RESET_SQL + insertKeys(SEED_A));
    const got = counts(sqlA());
    const expected = new Map<string, number>();
    for (const x of FIXED_EXCHANGES as readonly string[]) {
      expected.set(`${x}.live_keys`, 0);
      expected.set(`${x}.live_keys_venue_account_id_null`, 0);
      expected.set(`${x}.live_keys_unstamped_unmarked`, 0);
    }
    // okx live: S U M1 M2 X MX (HD departed); NULL: U M1 M2 MX; unresolved: U M2 MX.
    expected.set("okx.live_keys", 6);
    expected.set("okx.live_keys_venue_account_id_null", 4);
    expected.set("okx.live_keys_unstamped_unmarked", 3);
    // deribit live: MR (R revoked); NULL: MR; unresolved: none (R holds the slot).
    expected.set("deribit.live_keys", 1);
    expected.set("deribit.live_keys_venue_account_id_null", 1);
    expected.set("deribit.live_keys_unstamped_unmarked", 0);
    // kraken (L-2): its own lines, so the per-exchange lines add up to all.*.
    expected.set("kraken.live_keys", 2);
    expected.set("kraken.live_keys_venue_account_id_null", 1);
    expected.set("kraken.live_keys_unstamped_unmarked", 1);
    expected.set("all.live_keys", 9);
    expected.set("all.live_keys_venue_account_id_null", 6);
    expected.set("all.live_keys_unstamped_unmarked", 4);
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(expected));
  });

  it("(b) the cross-owner key on one account is no duplicate; only the marker with a working holder blocks", () => {
    psql(RESET_SQL + insertKeys(SEED_A));
    const got = counts(sqlB());
    expect(Object.fromEntries(got)).toEqual({
      "composite_member.marked": 0,
      "composite_member.marked_live": 0,
      // M1, M2, MX and MR carry 'duplicate'.
      "duplicate.marked": 4,
      "duplicate.marked_live": 4,
      // M1 only: M2's holder departed, MX's holder is another owner's key, and
      // MR's holder is revoked, so none of them is working.
      "duplicate.blocking": 1,
      "duplicate.blocking_owners": 1,
    });
  });

  // The proof that (a) can fail: the pre-fix predicate and the tempting
  // `eligible` holder test, each run against the same rows, give other counts.
  it("calibration: the pre-WR-01 predicate and an `eligible` holder test each miscount the same rows", () => {
    psql(RESET_SQL + insertKeys(SEED_A));
    const fixed = sqlA();
    const holderClause =
      /AND NOT EXISTS \(SELECT 1 FROM keys h\s+WHERE h\.id = k\.holder_id AND h\.user_id = k\.user_id\s+AND h\.disconnected_at IS NULL\s+AND h\.venue_known AND h\.exchange = k\.exchange\)/;
    expect(fixed).toMatch(holderClause);

    const preFix = counts(fixed.replace(holderClause, "AND k.holder_id IS NULL"));
    expect(preFix.get("okx.live_keys_unstamped_unmarked")).toBe(1);
    expect(preFix.get("all.live_keys_unstamped_unmarked")).toBe(2);

    const onEligible = counts(fixed.replace("AND h.disconnected_at IS NULL", "AND h.eligible"));
    expect(onEligible.get("deribit.live_keys_unstamped_unmarked")).toBe(1);

    const fixedCounts = counts(fixed);
    expect(fixedCounts.get("okx.live_keys_unstamped_unmarked")).toBe(3);
    expect(fixedCounts.get("deribit.live_keys_unstamped_unmarked")).toBe(0);
  });

  // IN-R2-03: the index blocks a stamp only through a holder that HOLDS the
  // slot: same owner, same exchange, connected, AND stamped. A connected holder
  // with no id, or one on another exchange, holds no slot this key could
  // collide with, so a key marked against it is unresolved. No current writer
  // produces such a marker (_find_live_holder names stamped holders only), so
  // this pins the edge rather than a live path.
  //   N   okx, no id, no marker, connected                 -> unresolved itself
  //   MN  okx, no id, duplicate of N (holder has no id)    -> unresolved
  //   D   deribit, stamped 'acct-1', connected             -> stamped
  //   MD  okx, no id, duplicate of D (another exchange)    -> unresolved
  //   M   okx, no id, duplicate of S (stamped okx holder)  -> resolved (control)
  //   S   okx, stamped 'acct-1', connected                 -> stamped
  it("(a) a marker against a holder that holds no slot (no id, or another exchange) is unresolved", () => {
    const seed: KeyRow[] = [
      { id: id(21), user_id: A, exchange: "okx" },
      { id: id(22), user_id: A, exchange: "okx", holder: id(21), share_kind: "duplicate" },
      { id: id(23), user_id: A, exchange: "deribit", venue_account_id: "acct-1" },
      { id: id(24), user_id: A, exchange: "okx", holder: id(23), share_kind: "duplicate" },
      { id: id(26), user_id: A, exchange: "okx", venue_account_id: "acct-1" },
      { id: id(25), user_id: A, exchange: "okx", holder: id(26), share_kind: "duplicate" },
    ];
    psql(RESET_SQL + insertKeys(seed));
    const got = counts(sqlA());
    // okx unresolved: N, MN, MD. M is resolved by S.
    expect(got.get("okx.live_keys_unstamped_unmarked")).toBe(3);
    expect(got.get("deribit.live_keys_unstamped_unmarked")).toBe(0);
    expect(got.get("all.live_keys_unstamped_unmarked")).toBe(3);

    // Calibration: without the slot test, MN and MD read as resolved.
    const loose = counts(sqlA().replace("\n                        AND h.venue_known AND h.exchange = k.exchange", ""));
    expect(loose.get("okx.live_keys_unstamped_unmarked")).toBe(1);
  });

  // ---- (f): DEPARTED_DECISION_CTES replayed against the shared D-09 fixture --
  //
  // analytics-service/tests/fixtures/departed_history_inclusion.json is the ONE
  // spec both the TS and the Python implementations read. Replaying it here
  // makes the SQL twin the third reader, so a rule change that moves the TS and
  // the Python but not the census fails in CI rather than in a PROD reading.
  // Each case gets its own owner. Synthetic ids map to uuids in the TS
  // comparator's order (departed-history.ts sorts ids with `<`), so the D-09 id
  // tie-break orders them the same way under COLLATE "C".
  // ⚠️ One case is not replayed, by name: a timestamptz column cannot hold an
  // unreadable disconnected_at.
  const D09_NOT_REPLAYABLE = new Set(["20_an_unreadable_disconnected_at_ends_on_the_last_returns_day_in_both_languages"]);

  it("(f) every replayable D-09 case decides each departed key exactly as the shared fixture expects", () => {
    type D09Key = {
      id: string;
      exchange: string;
      venue_account_id: string | null;
      disconnected_at: string | null;
      sync_status: string | null;
      history_inclusion: string | null;
      first_returns_day: string | null;
      last_returns_day: string | null;
      account_shared_with_api_key_id?: string | null;
      account_share_kind?: string | null;
      is_active?: boolean;
      anchored?: boolean;
    };
    type D09Case = {
      name: string;
      keys: D09Key[];
      expected: Record<string, { included: boolean; until: string | null; reason: string }>;
    };
    const fixture: { cases: D09Case[] } = JSON.parse(
      readFileSync(join(REPO, "analytics-service", "tests", "fixtures", "departed_history_inclusion.json"), "utf8"),
    );
    const replayed = fixture.cases.filter((c) => !D09_NOT_REPLAYABLE.has(c.name));
    expect(fixture.cases.length - replayed.length).toBe(D09_NOT_REPLAYABLE.size);
    expect(fixture.cases.filter((c) => D09_NOT_REPLAYABLE.has(c.name)).map((c) => c.name)).toEqual([...D09_NOT_REPLAYABLE]);
    // SFH R2-L3: the replay must not pass on nothing. If the shared fixture lost
    // its cases, or a case's `expected` map were emptied, the decision query
    // would return no rows and `toEqual({})` would pass. Floors measured
    // 2026-10-03: 22 replayed cases, 34 expected decisions, none empty. A floor,
    // not an equality, so adding a case to the fixture does not fail here.
    expect(replayed.length).toBeGreaterThanOrEqual(22);
    expect(replayed.filter((c) => Object.keys(c.expected).length === 0).map((c) => c.name)).toEqual([]);
    const wantDecisions = replayed.reduce((n, c) => n + Object.keys(c.expected).length, 0);
    expect(wantDecisions).toBeGreaterThanOrEqual(34);

    let sql = RESET_SQL;
    const back = new Map<string, { caseName: string; synthetic: string }>();
    replayed.forEach((c, ci) => {
      const owner = `c0000000-0000-4000-8000-${String(ci + 1).padStart(12, "0")}`;
      const ranked = c.keys.map((k) => k.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const uuidOf = new Map(
        ranked.map((sid, r) => [sid, `d${String(ci + 1).padStart(7, "0")}-0000-4000-8000-${String(r + 1).padStart(12, "0")}`]),
      );
      for (const [sid, u] of uuidOf) back.set(u, { caseName: c.name, synthetic: sid });
      sql += insertKeys(
        c.keys.map((k) => ({
          id: uuidOf.get(k.id)!,
          user_id: owner,
          exchange: k.exchange,
          is_active: k.is_active ?? true,
          sync_status: k.sync_status,
          disconnected_at: k.disconnected_at,
          venue_account_id: k.venue_account_id,
          holder: k.account_shared_with_api_key_id ? uuidOf.get(k.account_shared_with_api_key_id)! : null,
          share_kind: k.account_share_kind ?? null,
          history_inclusion: k.history_inclusion,
        })),
      );
      for (const k of c.keys) {
        const kid = uuidOf.get(k.id)!;
        for (const day of new Set([k.first_returns_day, k.last_returns_day].filter((d): d is string => d !== null))) {
          sql += `INSERT INTO public.csv_daily_returns (date, api_key_id, allocator_id) VALUES (${lit(day)}, ${lit(kid)}, ${lit(owner)});\n`;
        }
        const anchor = k.anchored === false ? "null" : "1000";
        sql += `INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload) VALUES (${lit(owner)}, ${lit(`key_inputs:${kid}`)}, '{"anchor_usd": ${anchor}}'::jsonb);\n`;
      }
    });
    psql(sql);

    const out = psql(
      `WITH RECURSIVE ${DEPARTED_DECISION_CTES}\nSELECT id::text, included, COALESCE(until_day::text, ''), reason FROM decision ORDER BY 1;`,
    );
    const got: Record<string, Record<string, { included: boolean; until: string | null; reason: string }>> = {};
    for (const line of out.split("\n").filter(Boolean)) {
      const [u, inc, until, reason] = line.split("\t");
      const ref = back.get(u);
      expect(ref, `decision row for an id no case seeded: ${u}`).toBeDefined();
      (got[ref!.caseName] ??= {})[ref!.synthetic] = { included: inc === "t", until: until === "" ? null : until, reason };
    }
    const want = Object.fromEntries(replayed.map((c) => [c.name, c.expected]));
    // Every replayed case answered, with every decision it expects.
    expect(Object.keys(got).length).toBe(replayed.length);
    expect(Object.values(got).reduce((n, m) => n + Object.keys(m).length, 0)).toBe(wantDecisions);
    expect(got).toEqual(want);
  });
});
