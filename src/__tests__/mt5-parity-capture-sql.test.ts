import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/**
 * Phase 155 PARITYHARNESS plan 02 (PARITY-03, PARITY-04): the read-only PROD
 * census lives as committed files under `docs/runbooks/mt5-parity/` and the
 * phase orchestrator runs each one on PROD through the Supabase MCP under a
 * standing read authorization. This is a static guard (no database) that
 * keeps every file in that directory a read.
 *
 * It is a SUPERSET of the marksource census guard
 * (`marksource-okx-census-sql.test.ts`): that guard's ten write words miss
 * `SELECT ... INTO` (which creates a table), `DO` blocks, `LOCK`, `SET`,
 * `MERGE`, `VACUUM`, `REFRESH`, `COMMENT`, `PREPARE`, `EXECUTE` and `REVOKE`,
 * and it has no function denylist for the calls that mutate state without a
 * write keyword (`nextval`, `set_config`, advisory locks, `pg_notify`).
 *
 * Why each rule exists:
 *  - One statement, starting WITH or SELECT, exactly one `;` and it is last:
 *    a file that starts with anything else is not a read, and a second
 *    statement is where a write hides.
 *  - No `--` anywhere: a comment line breaks the inline form of the tool.
 *  - No write keyword as a whole word, no function call outside `ALLOWED_CALLS`
 *    (an allowlist: a denylist misses search_path-resolved and admin builtins),
 *    no `/*` comment, no locking clause (`FOR SHARE`, `FOR KEY SHARE`, ...), no
 *    backslash or dollar quote (they hide a call inside a literal): the files
 *    run on PROD under an authorization that covers reads.
 *  - No uuid-shaped literal: the directory is public, a PROD row id must
 *    never be committed.
 *  - The README names exactly the .sql files that exist: the orchestrator
 *    follows it.
 *  - `/.mt5-parity/` is gitignored and pinned: raw capture rows carry amounts
 *    and ids and must never be committed by accident.
 *
 * The rules live in ONE function, `violations`, and the two RED-proof tests
 * call that same function, so the proof exercises the code the gate runs.
 * Keyword lists are built from arrays so this file's own source does not read
 * as SQL.
 */

const DIR = join(process.cwd(), "docs", "runbooks", "mt5-parity");

/** The census files (plan 02) and the ten capture files (plan 03). */
const EXPECTED_FILES = [
  "bind.sql",
  "capture-analytics.sql",
  "capture-btc.sql",
  "capture-equity-curve.sql",
  "capture-holdings.sql",
  "capture-key-inputs.sql",
  "capture-keymap.sql",
  "capture-marks.sql",
  "capture-returns.sql",
  "capture-series.sql",
  "capture-strategy.sql",
  "census-accounts.sql",
  "census-edges.sql",
  "marker.sql",
] as const;

/** The only file that may name api_keys.label: the orchestrator reads it once for labels.json. */
const KEYMAP_FILE = "capture-keymap.sql";

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
  "INTO",
  "MERGE",
  "DO",
  "REVOKE",
  "VACUUM",
  "REFRESH",
  "COMMENT",
  "LOCK",
  "PREPARE",
  "EXECUTE",
  "SET",
] as const;

/**
 * Every `identifier(` the capture files put in front of a parenthesis: the pure functions they call
 * (aggregates, JSON builders, date and string helpers, the marker's `current_database` and
 * `shobj_description`) plus the SQL syntax words that read the same way (`IN (`, `AS (`, `OVER (`, ...).
 * It is an ALLOWLIST on purpose: a denylist of side-effecting functions cannot be complete (search_path
 * resolves an unqualified name to any schema, `pg_catalog` alone has dozens of admin builtins), so a
 * call is refused unless this set names it. A file that needs a new function adds it HERE, in review.
 * Qualified names (`public.fn`, `vault.fn`, `pg_catalog.fn`) are never in the set: the capture files
 * read tables and call no schema-qualified function. The "allowlist holds nothing unused" test below
 * keeps the set from growing past what the 14 committed files use.
 */
const ALLOWED_CALLS: ReadonlySet<string> = new Set([
  "abs",
  "array_agg",
  "as",
  "bool_or",
  "by",
  "coalesce",
  "count",
  "current_database",
  "date_trunc",
  "else",
  "exists",
  "extract",
  "filter",
  "from",
  "generate_series",
  "greatest",
  "in",
  "jsonb_agg",
  "jsonb_array_elements",
  "jsonb_array_length",
  "jsonb_build_object",
  "jsonb_object_keys",
  "jsonb_typeof",
  "length",
  "max",
  "min",
  "now",
  "nullif",
  "over",
  "row_number",
  "select",
  "shobj_description",
  "sum",
  "then",
  "to_jsonb",
  "when",
]);

/**
 * The lowercase name of every `identifier(` in the text, schema qualifiers kept. String literals are
 * emptied and quoted identifiers unquoted in ONE left-to-right pass (so a `'` inside a quoted
 * identifier cannot swallow a call), and whitespace around dots is dropped, so `public . fn (`,
 * `"public"."fn"(` and `public.fn(` all read as `public.fn`. A quoted identifier that is not already a
 * plain lowercase name (a space, a capital: a different function from the builtin it resembles) reads as
 * `__quoted__`, which no allowlist holds.
 */
function callNames(text: string): string[] {
  const flat = text
    .replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, (m) =>
      m[0] === "'" ? "''" : /^"[a-z_][a-z0-9_$]*"$/.test(m) ? m.slice(1, -1) : "__quoted__",
    )
    .replace(/\s*\.\s*/g, ".");
  return [...flat.matchAll(/((?:[\p{L}_][\p{L}\p{N}_$]*\.)*[\p{L}_][\p{L}\p{N}_$]*)\s*\(/gu)].map((m) =>
    m[1].toLowerCase(),
  );
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Built from parts: a test source that spells the directory is scanned as a planning reader. */
const PLANNING_DIR = [".plan", "ning/"].join("");

/**
 * Every rule, one place. Returns the names of the rules the text breaks, so
 * a caller can assert on a specific rule: a bare write word comes back as the
 * upper-case word (`INTO`), every other rule as `rule:detail`.
 */
function violations(name: string, text: string): string[] {
  const found: string[] = [];
  if (!/^(WITH|SELECT)\b/i.test(text.trim())) {
    found.push(`start:${name}`);
  }
  const semicolons = text.split(";").length - 1;
  if (semicolons !== 1) found.push(`semicolons:${semicolons}`);
  if (!text.trimEnd().endsWith(";")) found.push("semicolon-not-last");
  if (text.includes("--")) found.push("comment");
  if (UUID_RE.test(text)) found.push("uuid");
  for (const word of WRITE_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) found.push(word);
  }
  for (const name of new Set(callNames(text))) {
    if (!ALLOWED_CALLS.has(name)) found.push(`fn:${name}`);
  }
  // A comment can hide a call from every rule above; a backslash (E'' strings) or a dollar quote can hide
  // one inside a literal the call scan has emptied; a locking clause takes row locks from a SELECT.
  if (text.includes("/*")) found.push("block-comment");
  if (/[\\$]/.test(text)) found.push("escape-or-dollar-quote");
  if (/\bFOR\s+(NO\s+KEY\s+UPDATE|KEY\s+SHARE|SHARE|UPDATE)\b/i.test(text)) found.push("row-lock");
  // `U&"pg_sl!0065ep" UESCAPE '!' (1)` is one identifier token to the server but leaves a literal between the
  // name and its `(`, so callNames never sees the call. No capture file needs a Unicode escape: refuse it.
  if (/\bU&/i.test(text) || /\bUESCAPE\b/i.test(text)) found.push("unicode-escape");
  return found;
}

function sqlFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function read(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

describe("mt5-parity census directory", () => {
  it("holds exactly the pinned .sql files", () => {
    expect(
      sqlFiles(),
      "a census file was added, deleted or renamed: update EXPECTED_FILES and the README table together",
    ).toEqual([...EXPECTED_FILES].sort());
  });

  it("README backticked .sql names equal the directory listing", () => {
    const readme = read("README.md");
    const named = new Set(
      [...readme.matchAll(/`([A-Za-z0-9._-]+\.sql)`/g)].map((m) => m[1]),
    );
    expect(
      [...named].sort(),
      "README.md must name every .sql file in the directory, and no file that is not there",
    ).toEqual(sqlFiles());
  });
});

describe.each([...EXPECTED_FILES])("mt5-parity census file %s", (name) => {
  const text = read(name);
  const found = violations(name, text);

  it("is one statement starting with WITH or SELECT", () => {
    expect(
      found.filter(
        (v) => v.startsWith("start:") || v.startsWith("semicolons:") || v === "semicolon-not-last",
      ),
      `${name} must be one WITH/SELECT statement with exactly one trailing ';'`,
    ).toEqual([]);
  });

  it("carries no -- comment", () => {
    expect(found, `${name} contains '--': remove it`).not.toContain("comment");
  });

  it("carries no uuid-shaped literal", () => {
    expect(
      found,
      `${name} carries a uuid-shaped literal: the directory is public, select by position instead`,
    ).not.toContain("uuid");
  });

  it("carries no write keyword and calls no denylisted function", () => {
    const writes = found.filter(
      (v) => (WRITE_WORDS as readonly string[]).includes(v) || v.startsWith("fn:"),
    );
    expect(writes, `${name} must not write`).toEqual([]);
  });

  it("never reads the login or the label into its output", () => {
    expect(
      /\blabel\b/i.test(text),
      name === KEYMAP_FILE
        ? `${name} must carry the account label for labels.json`
        : `${name} names api_keys.label: only ${KEYMAP_FILE} may read it`,
    ).toBe(name === KEYMAP_FILE);
    expect(
      /\bAS\s+venue_account_id\b/i.test(text),
      `${name} outputs the MT5 login as a column`,
    ).toBe(false);
    // The login may appear only inside the keys_sharing_login comparison.
    const rest = text.replace(/\bo\.venue_account_id\s*=\s*ak\.venue_account_id\b/g, "");
    expect(
      /venue_account_id/i.test(rest),
      `${name} touches venue_account_id outside the keys_sharing_login comparison`,
    ).toBe(false);
  });
});

describe.each([...EXPECTED_FILES])("mt5-parity file %s selects no secret column", (name) => {
  it("names no credential, key-material or raw venue payload column", () => {
    expect(
      /_encrypted|\bnonce\b|\bdek_|\bkek_|raw_payload/i.test(read(name)),
      `${name} names a secret or raw-payload column`,
    ).toBe(false);
  });
});

describe("capture files follow capture-contract.json", () => {
  interface Spec {
    extra_witness: string[];
  }
  const contract = JSON.parse(readFileSync(join(DIR, "capture-contract.json"), "utf8")) as {
    witness_columns: string[];
    files: Record<string, Spec>;
  };
  const captureFiles = sqlFiles().filter((f) => f.startsWith("capture-"));

  it("the capture-*.sql set equals the contract file keys", () => {
    expect(
      captureFiles,
      "a capture file and capture-contract.json disagree: add or remove both together",
    ).toEqual(Object.keys(contract.files).sort());
  });

  it("is the full ten slices (anti-vacuity)", () => {
    expect(captureFiles.length).toBe(10);
  });

  it.each(captureFiles)("%s aliases every witness column of its slice", (name) => {
    const text = read(name);
    const wanted = [...contract.witness_columns, ...contract.files[name].extra_witness];
    for (const col of wanted) {
      expect(
        new RegExp(`\\bAS\\s+${col}\\b`, "i").test(text),
        `${name} must alias a column AS ${col}`,
      ).toBe(true);
    }
  });

  it.each(captureFiles)("%s stays read-only inside the per-ordinal wrapper", (name) => {
    // The one sanctioned run-time form (render-ordinal): the wrapper adds no write word.
    const inner = read(name).trimEnd().replace(/;$/, "");
    const wrapped = `SELECT * FROM (${inner}) AS q WHERE q.key_ordinal = 'k1';`;
    expect(violations(name, wrapped)).toEqual([]);
  });

  it("the wrapper check can fail: a write word inside the statement is still seen", () => {
    const inner = read("capture-marks.sql").trimEnd().replace(/;$/, "");
    const wrapped = `SELECT * FROM (${inner} INTO scratch) AS q WHERE q.key_ordinal = 'k1';`;
    expect(violations("capture-marks.sql", wrapped)).toContain("INTO");
  });
});

describe("census-accounts.sql carries the PARITY-04 fields", () => {
  const text = read("census-accounts.sql");

  it("states the server as the unmeasured literal exactly once", () => {
    expect(text.split("unmeasured (155.1 reading owns it)").length - 1).toBe(1);
  });

  it("names every column the census promises", () => {
    for (const col of [
      "s_raw_marks",
      "s_key_inputs",
      "s_flags",
      "s_agree",
      "identity_ratio",
      "identity_days",
      "identity_flow_days",
      "flag_keys",
      "keys_examined",
      "key_inputs_present",
      "first_flow_present",
    ]) {
      expect(text, `census-accounts.sql must name ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("prints a summary row for an empty census", () => {
    expect(text).toMatch(/UNION ALL[\s\S]*'all'/i);
    expect(read("census-edges.sql")).toMatch(/UNION ALL[\s\S]*'all'[\s\S]*rows_examined|rows_examined[\s\S]*UNION ALL[\s\S]*'all'/i);
  });

  it("enumerates every Friday instead of two hard-coded dates", () => {
    expect(read("census-edges.sql")).toMatch(/generate_series/);
    expect(read("census-edges.sql")).toMatch(/isodow/i);
  });
});

describe("the read-only gate can fail (neuter, RED, byte restore, GREEN)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mt5p-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const target = "census-accounts.sql";
  const original = readFileSync(join(DIR, target));

  it("an INTO neuter is reported, and the byte restore reports nothing", () => {
    // The gate is clean on the real file first: a neuter is only informative
    // against a green baseline.
    expect(violations(target, original.toString("utf8"))).toEqual([]);

    const backupPath = join(scratch, "census-accounts.backup");
    writeFileSync(backupPath, original);
    const backup = readFileSync(backupPath);

    const copyPath = join(scratch, target);
    const source = original.toString("utf8");
    const last = source.lastIndexOf(";");
    writeFileSync(copyPath, source.slice(0, last) + " INTO scratch" + source.slice(last));

    // Vacuity guard: the neuter really changed the bytes.
    expect(sha256(readFileSync(copyPath))).not.toBe(sha256(original));
    expect(violations(target, readFileSync(copyPath, "utf8"))).toContain("INTO");

    // Restore from the byte backup, never from git.
    writeFileSync(copyPath, backup);
    expect(sha256(readFileSync(copyPath))).toBe(sha256(original));
    expect(violations(target, readFileSync(copyPath, "utf8"))).toEqual([]);
  });

  it("a leading DO block is reported by two independent rules", () => {
    const copyPath = join(scratch, "census-accounts.do.sql");
    writeFileSync(copyPath, "DO $$ BEGIN END $$; " + original.toString("utf8"));

    expect(sha256(readFileSync(copyPath))).not.toBe(sha256(original));
    const found = violations(target, readFileSync(copyPath, "utf8"));
    expect(found).toContain("DO");
    expect(found).toContain("semicolons:2");
    expect(found.some((v) => v.startsWith("start:"))).toBe(true);
  });

  it("a denylisted function call is reported without any write keyword", () => {
    const copyPath = join(scratch, "census-accounts.fn.sql");
    const source = original.toString("utf8");
    writeFileSync(copyPath, source.replace("count(*)", "count(*) + nextval('x')"));
    const found = violations(target, readFileSync(copyPath, "utf8"));
    expect(found).toContain("fn:nextval");
  });
});

describe("the read-only gate allows only the pure functions the capture files use (WR-07)", () => {
  // Each statement starts with SELECT and is one statement with one ';': a denylist returned [] for every
  // bypass in the tables below, so a PROD capture file could have carried any of them. The gate is an
  // allowlist now: a call is refused unless ALLOWED_CALLS names it.
  it.each([
    // families the first denylist named
    ["SELECT pg_try_advisory_lock(1);", "fn:pg_try_advisory_lock"],
    ["SELECT pg_advisory_lock_shared(1);", "fn:pg_advisory_lock_shared"],
    ["SELECT pg_try_advisory_xact_lock(1);", "fn:pg_try_advisory_xact_lock"],
    ["SELECT dblink_exec('x', 'y');", "fn:dblink_exec"],
    ["SELECT cron.schedule('j', '* * * * *', 'select 1');", "fn:cron.schedule"],
    ["SELECT net.http_post('http://x');", "fn:net.http_post"],
    ["SELECT pg_terminate_backend(1);", "fn:pg_terminate_backend"],
    ["SELECT pg_cancel_backend(1);", "fn:pg_cancel_backend"],
    ["SELECT nextval('x');", "fn:nextval"],
    // unqualified, resolved through search_path
    ["SELECT some_writer_rpc();", "fn:some_writer_rpc"],
    // admin builtins a denylist never named
    ["SELECT pg_reload_conf();", "fn:pg_reload_conf"],
    ["SELECT pg_switch_wal();", "fn:pg_switch_wal"],
    ["SELECT pg_create_restore_point('x');", "fn:pg_create_restore_point"],
    ["SELECT pg_read_file('x');", "fn:pg_read_file"],
    ["SELECT pg_ls_dir('x');", "fn:pg_ls_dir"],
    ["SELECT pg_sleep(1);", "fn:pg_sleep"],
    ["SELECT pg_sleep_for('1 second');", "fn:pg_sleep_for"],
    ["SELECT pg_sleep_until('2030-01-01');", "fn:pg_sleep_until"],
    ["SELECT pg_stat_reset();", "fn:pg_stat_reset"],
    ["SELECT pg_stat_reset_shared('bgwriter');", "fn:pg_stat_reset_shared"],
    // schema-qualified: every schema, and every spelling of the dot
    ["SELECT public.some_writer_rpc();", "fn:public.some_writer_rpc"],
    ["SELECT public . some_writer_rpc();", "fn:public.some_writer_rpc"],
    ['SELECT "public"."some_writer_rpc"();', "fn:public.some_writer_rpc"],
    ["SELECT PUBLIC\n  .\n  some_writer_rpc ( );", "fn:public.some_writer_rpc"],
    ["SELECT auth.some_helper();", "fn:auth.some_helper"],
    ["SELECT storage.some_helper();", "fn:storage.some_helper"],
    ["SELECT vault.create_secret('x');", "fn:vault.create_secret"],
    ["SELECT realtime.send('x', 'y', 'z');", "fn:realtime.send"],
    ["SELECT extensions.uuid_generate_v4();", "fn:extensions.uuid_generate_v4"],
    ["SELECT supabase_functions.http_request();", "fn:supabase_functions.http_request"],
    ["SELECT pg_catalog.set_config('a', 'b', false);", "fn:pg_catalog.set_config"],
    // a quoted name is a different function from the builtin it resembles
    ['SELECT "Count"(1);', "fn:__quoted__"],
    ['SELECT "my count"(1);', "fn:__quoted__"],
    ["SELECT \u00fccount(1);", "fn:\u00fccount"],
    // a call hidden behind a literal the scan empties: a quote inside a quoted identifier
    [`SELECT "x'", pg_sleep(1), "'";`, "fn:pg_sleep"],
  ])("%s is reported as %s", (statement, rule) => {
    expect(violations("probe.sql", statement)).toContain(rule);
  });

  it.each([
    ["a block comment", "SELECT 1 /* pg_sleep(1) */;", "block-comment"],
    ["FOR SHARE", "SELECT id FROM public.api_keys FOR SHARE;", "row-lock"],
    ["FOR KEY SHARE", "SELECT id FROM public.api_keys FOR\nKEY  SHARE;", "row-lock"],
    ["FOR NO KEY UPDATE", "SELECT id FROM public.api_keys FOR NO KEY UPDATE;", "row-lock"],
    ["an escape string", "SELECT E'\\'' || pg_sleep(1);", "escape-or-dollar-quote"],
    ["a dollar-quoted string", "SELECT $$ x $$;", "escape-or-dollar-quote"],
    ["a Unicode-escaped call (sleep)", `SELECT U&"pg_sl!0065ep" UESCAPE '!' (1.0);`, "unicode-escape"],
    ["a Unicode-escaped call (reload)", `SELECT U&"pg_reload_conf" UESCAPE '!' ();`, "unicode-escape"],
    ["a lowercase uescape clause", `select u&"pg_sleep" uescape '!' (1);`, "unicode-escape"],
  ])("%s is refused", (_what, statement, rule) => {
    expect(violations("probe.sql", statement)).toContain(rule);
  });

  it("each bypass above is refused on its own: the statement has no other violation to hide behind", () => {
    expect(violations("probe.sql", "SELECT pg_sleep(1);")).toEqual(["fn:pg_sleep"]);
    expect(violations("probe.sql", "SELECT public . some_writer_rpc();")).toEqual(["fn:public.some_writer_rpc"]);
    expect(violations("probe.sql", "SELECT 1 /* x */;")).toEqual(["block-comment"]);
    expect(violations("probe.sql", "SELECT id FROM public.api_keys FOR KEY SHARE;")).toEqual(["row-lock"]);
    expect(violations("probe.sql", `SELECT U&"pg_sl!0065ep" UESCAPE '!' (1.0);`)).toEqual(["unicode-escape"]);
    expect(violations("probe.sql", `SELECT U&"pg_reload_conf" UESCAPE '!' ();`)).toEqual(["unicode-escape"]);
  });

  it("a plain schema-qualified table reference and the pure functions are not refused", () => {
    expect(violations("probe.sql", "SELECT ak.id FROM public.api_keys ak;")).toEqual([]);
    expect(violations("probe.sql", "SELECT coalesce(max(x), 0), count(*) FILTER (WHERE y) FROM t;")).toEqual([]);
    expect(violations("probe.sql", "SELECT 'pg_sleep(1) is only text' AS note;")).toEqual([]);
  });

  it("the allowlist holds nothing the 14 committed files do not use", () => {
    const used = new Set(EXPECTED_FILES.flatMap((f) => callNames(read(f))));
    expect([...ALLOWED_CALLS].filter((n) => !used.has(n))).toEqual([]);
  });
});

describe("the capture directory is untracked", () => {
  it(".gitignore holds the root-anchored /.mt5-parity/ line", () => {
    const lines = readFileSync(join(process.cwd(), ".gitignore"), "utf8").split(/\r?\n/);
    expect(lines).toContain("/.mt5-parity/");
  });

  it("git agrees a file inside it is ignored", () => {
    const r = spawnSync("git", ["check-ignore", "-q", ".mt5-parity/probe.json"], {
      cwd: process.cwd(),
    });
    expect(r.status).toBe(0);
  });

  it("no tracked file lives under it", () => {
    const r = spawnSync("git", ["ls-files", ".mt5-parity"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("redaction scan over the runbook directory", () => {
  const files = walk(DIR);

  it("scans the census files (anti-vacuity)", () => {
    const scanned = files.map((f) => relative(DIR, f));
    for (const name of [...EXPECTED_FILES, "README.md"]) {
      expect(scanned).toContain(name);
    }
  });

  it("carries no uuid, home path, planning path or long digit run (file names only)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const rel = relative(DIR, file);
      if (UUID_RE.test(text)) offenders.push(`${rel}: uuid-shaped string`);
      if (text.includes("\/Users\/") || text.includes("/home/")) {
        offenders.push(`${rel}: home-directory prefix`);
      }
      if (text.includes(PLANNING_DIR)) offenders.push(`${rel}: planning-directory path`);
      if (/\d{5,}/.test(text.replace(/\d{4}-\d{2}-\d{2}/g, ""))) {
        offenders.push(`${rel}: run of 5 or more digits outside an ISO date`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
