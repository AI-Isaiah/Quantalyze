#!/usr/bin/env node
/**
 * LOCAL-STACK CAPABILITY PROBE — does the ephemeral Supabase stack SUPPLY what
 * the SQL self-test corpus DEMANDS? (Phase 164.4.2 plan 04.)
 *
 * ⚠️ WHY THIS EXISTS. Phase 164.4.2 moves `sql-tests` off the shared TEST
 * project onto the local stack `scripts/local-stack/run.sh up` boots. Whether
 * that stack can host `supabase/tests/test_*.sql` was RESEARCH Assumption A1,
 * recorded as NOT verified: the Supabase image "plausibly" ships vault, pg_net
 * and the auth functions, and nothing in this repo had asked it. CONTEXT Area C
 * allows the fallback only on a MEASURED refutation written down with its
 * measurement. This probe is that measurement. It is not an inference from the
 * image tag, the docs, or the live-DB lane being green.
 *
 * WHAT IT PRINTS — one always-on line, both sides of the question on it:
 *
 *   stack-probe: corpus=<N> lane-only-excluded=<M> <class>=<demand>/<present|absent> … verdict <V>
 *
 *   DEMAND comes from the corpus: for each class, how many corpus FILES mention
 *   its object. It is re-derived every run. ⛔ It is NOT pinned, NOT floored and
 *   NOT compared with a stored number. `supabase/tests/` already has several
 *   independent census pins, and this probe deliberately adds none.
 *   A mention counts wherever it sits, comments included, so demand is an UPPER
 *   bound. That errs toward INSUFFICIENT and never toward a false SUFFICIENT.
 *   Files carrying a `-- LANE-ONLY:` line are excluded, using the same
 *   line-start predicate `sql-tests` uses to skip them. They never run under
 *   `sql-tests`, so what they mention is not demand on the lane `sql-tests`
 *   runs on.
 *
 *   SUPPLY comes from the lane: ONE `psql` call against the DSN in the mode-600
 *   handoff `run.sh up` writes (`scripts/local-stack/.stack-env`), with one
 *   catalogue query per class.
 *
 * VERDICTS AND EXIT CODES
 *   SUFFICIENT    exit 0  every class some file demands is present
 *   INSUFFICIENT  exit 2  the lane was measured and lacks >= 1 demanded class
 *   MEASURE_FAIL  exit 1  either side could not be read. That covers an empty
 *                         corpus, an unreadable demand count, an unreadable
 *                         supply for ANY class (demanded or not), a missing
 *                         handoff, a refused DSN and a failed psql. Unknown is
 *                         not absent and it is not present.
 *
 * ⛔ LOCAL ONLY. The DSN is refused before any connection unless it is a
 * postgres URL naming 127.0.0.1 or localhost with a port and no query string,
 * whose authority libpq reads as a URL parser does (no whitespace, one '@', no
 * comma host list; review 164.4.2 round 2 WR-02).
 * libpq honours host=/hostaddr=/service= in a query string, which would re-point
 * the connection. That was stricter than `run.sh`'s old `*@127.0.0.1:*` glob,
 * because a glob also matches `@127.0.0.1:` smuggled into the userinfo; since
 * review 164.4.2 WR-08 every lane DSN gate calls this rule through
 * `--refuse-nonlocal-dsn` instead of carrying that glob. psql
 * gets the DSN as an argv ELEMENT, never through a shell, and runs with every
 * PG* environment variable stripped: PGHOSTADDR, PGSERVICE and the rest would
 * otherwise apply to anything the DSN leaves unset.
 *
 * ⛔ THE DSN IS NEVER PRINTED. Output is class names, counts and verdicts only.
 * The execFileSync error message embeds the full argv, so it is never printed.
 * psql's stderr is printed only after the DSN and its password are redacted.
 *
 * Env seams, used so the refusal paths can run without a stack:
 *   STACK_ENV_FILE  the handoff to read (default scripts/local-stack/.stack-env)
 *   SQL_TESTS_DIR   the corpus directory  (default supabase/tests)
 *
 * The EXACT commands CI runs, and the exact commands a developer runs locally:
 *
 *     node scripts/local-stack/capability-probe.mjs --self-test
 *     node scripts/local-stack/capability-probe.mjs      # after `bash scripts/local-stack/run.sh up`
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({ SUFFICIENT: 0, MEASURE_FAIL: 1, INSUFFICIENT: 2 });

/** `sql-tests`'s own predicate (`grep -a -m1 '^-- LANE-ONLY:'`), as a regex. */
export const LANE_ONLY_RE = /^-- LANE-ONLY:/m;

/**
 * The five capability classes, taken from the RESEARCH R2 census. Each class
 * carries its OWN demand detector and its OWN supply query. A class is
 * present when its query returns at least `required`.
 *
 * ⚠️ `vault` is the supabase_vault EXTENSION. It is NOT the commented-out
 * `[db.vault]` block in `supabase/config.toml`, which governs a secret-key
 * override and says nothing about whether the extension exists.
 */
export const CLASSES = Object.freeze([
  {
    name: "pg_net",
    demand: /\bpg_net\b|\bnet\.http_/i,
    supplySql: "SELECT count(*) FROM pg_extension WHERE extname = 'pg_net'",
    required: 1,
    supplies: "the pg_net extension is installed",
  },
  {
    name: "vault",
    demand: /\bvault\./i,
    supplySql: "SELECT count(*) FROM pg_extension WHERE extname = 'supabase_vault'",
    required: 1,
    supplies: "the supabase_vault extension is installed",
  },
  {
    name: "auth-functions",
    demand: /\bauth\.(uid|jwt)\s*\(/i,
    supplySql:
      "SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
      "WHERE n.nspname = 'auth' AND p.proname IN ('uid', 'jwt') AND p.pronargs = 0",
    required: 2,
    supplies: "auth.uid() and auth.jwt() both resolve in the catalogue",
  },
  {
    name: "platform-roles",
    demand: /\b(anon|authenticated|service_role)\b|\bSET\s+(LOCAL\s+|SESSION\s+)?ROLE\b/i,
    supplySql: "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')",
    required: 3,
    supplies: "all three of anon, authenticated and service_role exist",
  },
  {
    name: "pg_cron",
    demand: /\bcron\.|\bpg_cron\b/i,
    supplySql: "SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron'",
    required: 1,
    supplies: "the pg_cron extension is installed",
  },
]);

/** Finding kinds that mean "could not measure". Any one of them makes the verdict MEASURE_FAIL. */
export const MEASURE_FAIL_KINDS = Object.freeze(["empty-corpus", "demand-unreadable", "supply-unreadable"]);

const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * PURE: corpus file TEXTS -> how many non-LANE-ONLY files demand each class.
 * @param {string[]} fileTexts
 */
export function deriveDemand(fileTexts) {
  const demand = Object.fromEntries(CLASSES.map((c) => [c.name, 0]));
  let files = 0;
  let laneOnly = 0;
  for (const text of fileTexts) {
    if (LANE_ONLY_RE.test(text)) {
      laneOnly += 1;
      continue;
    }
    files += 1;
    for (const c of CLASSES) if (c.demand.test(text)) demand[c.name] += 1;
  }
  return { files, laneOnly, demand };
}

/** The ONE query: one row per class, `<class>|<count>` under psql -A -t -F '|'. */
export function buildSupplyQuery() {
  return (
    CLASSES.map((c) => `SELECT '${c.name}' AS class, (${c.supplySql})::int AS n`).join("\nUNION ALL\n") + ";"
  );
}

/**
 * PURE: psql's answer -> { class: count | null }. Every class has to be
 * answered exactly once, as a non-negative integer. Anything else is null,
 * which means unreadable. A line that is not ours makes EVERY class
 * unreadable, because an answer carrying something we did not ask for is not
 * an answer to what we asked.
 */
export function parseSupply(stdout) {
  const none = () => Object.fromEntries(CLASSES.map((c) => [c.name, null]));
  const out = none();
  const known = new Set(CLASSES.map((c) => c.name));
  const seen = new Map();
  for (const raw of String(stdout ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = /^([A-Za-z0-9_-]+)\|([0-9]+)$/.exec(line);
    if (!m || !known.has(m[1])) return none();
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    out[m[1]] = Number(m[2]);
  }
  for (const [name, n] of seen) if (n > 1) out[name] = null;
  return out;
}

/**
 * PURE: null when the DSN is a loopback postgres URL this probe may connect to.
 * Otherwise a reason. ⛔ The reason never quotes the DSN, its password or its host.
 */
export function refuseNonLocalDsn(dsn) {
  const raw = String(dsn);
  // Review 164.4.2 round 2, WR-02: every check below reads `new URL()`, but the
  // connection is made by libpq, and the two parse some authorities differently.
  // Such a DSN is refused before either reading is trusted:
  //   - a URL parser strips tab and newline anywhere; libpq keeps them;
  //   - a URL parser splits userinfo at the LAST '@', libpq at the FIRST, and
  //     libpq then reads a comma host list and tries its first host. So
  //     `u@remote,@127.0.0.1:54322` is 127.0.0.1 to the URL parser and `remote`
  //     to libpq. The authority is read as libpq reads it, up to the first '/'.
  if (/[\s\x00-\x1f\x7f]/.test(raw)) {
    return "the handoff's DB_URL carries whitespace or a control character, which a URL parser strips and libpq does not";
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    return "the handoff's DB_URL is not a parseable URL";
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    return "the handoff's DB_URL is not a postgres:// or postgresql:// URL";
  }
  const authority = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "").split("/")[0];
  if ((authority.match(/@/g) ?? []).length > 1 || authority.includes(",")) {
    return "the handoff's DB_URL carries a second '@' or a host list, which libpq parses differently from a URL parser (it connects to the first host of the list)";
  }
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    return "the handoff's DB_URL names a host other than 127.0.0.1/localhost. This probe is local-only: TEST is shared and PROD is PROD";
  }
  if (u.port === "") {
    return "the handoff's DB_URL carries no port. The lane always writes one, and run.sh's own guard requires it";
  }
  if (u.search !== "" || u.hash !== "") {
    return "the handoff's DB_URL carries a query string or fragment. libpq honours host=, hostaddr= and service= there, and those can re-point the connection away from the loopback host";
  }
  return null;
}

/**
 * PURE: demand (from the corpus) x supply (from the lane) -> verdict, named
 * findings, and one row per class for the verdict line.
 * @param {{files: number, demand: Record<string, number|null>, supply: Record<string, number|null>}} facts
 */
export function judge({ files, demand, supply }) {
  const findings = [];
  if (!isCount(files) || files === 0) {
    findings.push({
      kind: "empty-corpus",
      class: null,
      detail: isCount(files)
        ? "the corpus holds ZERO test files, so there is nothing to measure demand from. An empty corpus is never a clean probe."
        : `the corpus size is unreadable (got ${String(files)})`,
    });
  }
  const rows = [];
  for (const c of CLASSES) {
    const d = demand?.[c.name];
    const s = supply?.[c.name];
    if (!isCount(d)) {
      findings.push({ kind: "demand-unreadable", class: c.name, detail: `the demand count for ${c.name} is unreadable (got ${String(d)})` });
    }
    if (!isCount(s)) {
      findings.push({
        kind: "supply-unreadable",
        class: c.name,
        detail: `the lane's supply of ${c.name} is unreadable (got ${String(s)}). The lane was not measured for it, so it is reported neither absent nor present.`,
      });
    }
    const state = !isCount(s) ? "UNREADABLE" : s >= c.required ? "present" : "absent";
    if (isCount(d) && d > 0 && state === "absent") {
      findings.push({
        kind: "unsatisfied",
        class: c.name,
        detail: `${d} corpus file(s) demand ${c.name} and the lane does not supply it. Needs: ${c.supplies}. Measured ${s} of ${c.required}.`,
      });
    }
    rows.push({ name: c.name, demand: isCount(d) ? d : "UNREADABLE", state });
  }
  const verdict = findings.some((f) => MEASURE_FAIL_KINDS.includes(f.kind))
    ? "MEASURE_FAIL"
    : findings.some((f) => f.kind === "unsatisfied")
      ? "INSUFFICIENT"
      : "SUFFICIENT";
  return { verdict, findings, rows };
}

/** PURE: the one always-on line. Every class appears on every path. */
export function verdictLine(corpus, result) {
  const n = (v) => (isCount(v) ? v : "UNREADABLE");
  const classes = result.rows.map((r) => `${r.name}=${r.demand}/${r.state}`).join(" ");
  return `stack-probe: corpus=${n(corpus?.files)} lane-only-excluded=${n(corpus?.laneOnly)} ${classes} verdict ${result.verdict}`;
}

// ── I/O (main only; the pure functions above never touch the disk or the network) ──

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DEFAULT_STACK_ENV = join(HERE, ".stack-env");
const DEFAULT_TESTS_DIR = join(REPO_ROOT, "supabase", "tests");
const shown = (p) => relative(REPO_ROOT, p) || ".";

/** The corpus as TEXT, read latin1 so an odd byte can never make a file unreadable. */
function readCorpus(dir) {
  try {
    const names = readdirSync(dir)
      .filter((n) => /^test_.*\.sql$/.test(n))
      .sort();
    return { texts: names.map((n) => readFileSync(join(dir, n), "latin1")), error: null };
  } catch (e) {
    return { texts: [], error: `could not read the corpus directory ${shown(dir)} (${e.code ?? "error"})` };
  }
}

/** Every PG* variable stripped. Anything the DSN leaves unset must not come from the environment. */
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("PG")) env[k] = v;
  env.PGCONNECT_TIMEOUT = "10";
  return env;
}

function redact(text, dsn) {
  let out = String(text ?? "");
  if (dsn) out = out.split(dsn).join("<DB_URL>");
  try {
    const pw = decodeURIComponent(new URL(dsn).password);
    if (pw) out = out.split(pw).join("<redacted>");
  } catch {
    /* an unparseable DSN was refused before psql ran */
  }
  return out;
}

/** -> { supply, error }. On ANY failure every class is null (unreadable), never 0 (absent). */
function readSupply(envFile) {
  const unreadable = (error) => ({ supply: Object.fromEntries(CLASSES.map((c) => [c.name, null])), error });
  if (!existsSync(envFile)) {
    return unreadable(`the lane handoff ${shown(envFile)} does not exist, so the lane was not measured. Boot it first: bash scripts/local-stack/run.sh up`);
  }
  let raw;
  try {
    raw = readFileSync(envFile, "utf8");
  } catch (e) {
    return unreadable(`could not read the lane handoff ${shown(envFile)} (${e.code ?? "error"})`);
  }
  // Same key and shape `run.sh`'s load_baseline() and the lane spec read.
  const m = raw.match(/^DB_URL="?([^"\n]*)"?$/m);
  if (!m || !m[1]) return unreadable(`the lane handoff ${shown(envFile)} carries no usable DB_URL`);
  const dsn = m[1];

  const refusal = refuseNonLocalDsn(dsn);
  if (refusal) return unreadable(`refusing to connect: ${refusal}`);

  let stdout;
  try {
    stdout = execFileSync(
      "psql",
      ["-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "|", "-d", dsn, "-c", buildSupplyQuery()],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, env: childEnv() },
    );
  } catch (e) {
    // ⛔ Never print e.message. It is "Command failed: psql … -d <DSN> …".
    const why = e.code === "ENOENT" ? "psql is not on PATH" : `exit ${e.status ?? e.signal ?? "unknown"}`;
    const first = redact(e.stderr, dsn).trim().split("\n")[0] ?? "";
    return unreadable(`psql could not answer the supply query (${why})${first ? `: ${first}` : ""}`);
  }
  return { supply: parseSupply(stdout), error: null };
}

/**
 * `--refuse-nonlocal-dsn` (review 164.4.2 WR-08): the ONE loopback-DSN gate every
 * lane caller uses — `run.sh`'s `load_baseline` and `probe_function_denial_survives`,
 * and `sql-tests`' corpus step — so none carries its own `*@127.0.0.1:*` glob. That
 * glob accepted a `?host=`/`hostaddr=` override and `@127.0.0.1:` smuggled into the
 * userinfo. The DSN arrives in `LOOPBACK_DSN`, never argv (argv is visible in a
 * process listing), and is never printed. Exit 0 = loopback, 1 = refused or unset.
 */
function refuseNonLocalDsnCli() {
  const dsn = process.env.LOOPBACK_DSN;
  const why = dsn ? refuseNonLocalDsn(dsn) : "LOOPBACK_DSN is unset or empty, so there is no DSN to prove local";
  if (why) {
    console.error(`::error::refusing a non-local database: ${why}`);
    return 1;
  }
  console.log("loopback-dsn: OK (127.0.0.1/localhost, one host, a port, no query string)");
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  if (argv.length === 1 && argv[0] === "--refuse-nonlocal-dsn") return refuseNonLocalDsnCli();
  // ⛔ A typo'd flag must not fall through to a probe the caller did not ask for.
  if (argv.length > 0) {
    console.error(
      `::error::unknown argument(s): ${argv.join(" ")}. This probe takes only --self-test, or --refuse-nonlocal-dsn on its own`,
    );
    return EXIT.MEASURE_FAIL;
  }

  const { texts, error: corpusError } = readCorpus(process.env.SQL_TESTS_DIR || DEFAULT_TESTS_DIR);
  const corpus = deriveDemand(texts);
  const { supply, error: supplyError } = readSupply(process.env.STACK_ENV_FILE || DEFAULT_STACK_ENV);
  const result = judge({ files: corpus.files, demand: corpus.demand, supply });

  // Always printed, whatever the verdict, so "clean" and "did not run" never look alike.
  console.log(verdictLine(corpus, result));
  if (corpusError) console.error(`::error::MEASURE_FAIL — ${corpusError}`);
  if (supplyError) console.error(`::error::MEASURE_FAIL — ${supplyError}`);
  for (const f of result.findings) {
    if (f.kind === "unsatisfied") console.log(`  unsatisfied: ${f.class} — ${f.detail}`);
    else console.error(`::error::${f.kind}${f.class ? ` (${f.class})` : ""} — ${f.detail}`);
  }
  return EXIT[result.verdict];
}

// ── self-test ────────────────────────────────────────────────────────────────

/**
 * How many `ok()` calls the sections below are declared to run.
 * ⛔ Raise it only together with the arm that adds one; lowering it to make a
 * run green is deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 55;

const SECTIONS = 15;

/** A supply map where every class is present at exactly its required count. */
function allPresent() {
  return Object.fromEntries(CLASSES.map((c) => [c.name, c.required]));
}
/** A demand map where every class is asked for by `n` files. */
function allDemanded(n) {
  return Object.fromEntries(CLASSES.map((c) => [c.name, n]));
}

function selfTest() {
  let pass = true;
  let asserted = 0;
  const ok = (cond, msg) => {
    asserted += 1;
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    if (!cond) pass = false;
    return cond;
  };
  let section = 0;
  const head = (title) => console.log(`=== SELF-TEST ${++section}/${SECTIONS}: ${title}`);
  const has = (r, kind, cls) => r.findings.some((f) => f.kind === kind && (cls === undefined || f.class === cls));

  head("demand 0 and supply absent -> SATISFIED (nothing asked for it)");
  {
    const r = judge({
      files: 10,
      demand: { ...allDemanded(4), pg_net: 0 },
      supply: { ...allPresent(), pg_net: 0 },
    });
    ok(r.verdict === "SUFFICIENT", `an absent class nobody demands leaves the verdict SUFFICIENT (got ${r.verdict})`);
    ok(!r.findings.some((f) => f.class === "pg_net"), "and raises no finding against that class");
  }

  head("demand > 0 and supply present -> SATISFIED");
  {
    const r = judge({ files: 10, demand: allDemanded(4), supply: allPresent() });
    ok(r.verdict === "SUFFICIENT", `every demanded class present -> SUFFICIENT (got ${r.verdict})`);
    ok(Array.isArray(r.findings) && r.findings.length === 0, "and no findings at all");
  }

  head("demand > 0 and supply absent -> UNSATISFIED, and the class is NAMED");
  {
    const r = judge({ files: 10, demand: { ...allDemanded(4), vault: 2 }, supply: { ...allPresent(), vault: 0 } });
    ok(r.verdict === "INSUFFICIENT", `a demanded, absent class -> INSUFFICIENT (got ${r.verdict})`);
    ok(has(r, "unsatisfied", "vault"), "the finding is 'unsatisfied' and names vault");
    ok(r.findings.length === 1, `exactly one finding — the satisfied classes stay silent (got ${r.findings.length})`);
  }

  head("a PARTIAL supply is absent, not present (2 of 3 platform roles)");
  {
    const r = judge({
      files: 10,
      demand: allDemanded(4),
      supply: { ...allPresent(), "platform-roles": 2 },
    });
    ok(
      r.verdict === "INSUFFICIENT" && has(r, "unsatisfied", "platform-roles"),
      `a class below its required count is unsatisfied (got ${r.verdict})`,
    );
  }

  head("supply UNREADABLE -> MEASURE_FAIL; unknown is not absent and it is not present");
  {
    const r = judge({ files: 10, demand: allDemanded(4), supply: { ...allPresent(), pg_cron: null } });
    ok(r.verdict === "MEASURE_FAIL", `a null supply reading -> MEASURE_FAIL (got ${r.verdict})`);
    ok(has(r, "supply-unreadable", "pg_cron"), "the finding is 'supply-unreadable' and names pg_cron");
    const row = (r.rows ?? []).find((x) => x.name === "pg_cron");
    ok(row?.state === "UNREADABLE", `its row reads UNREADABLE, never present/absent (got ${row?.state})`);
    const r0 = judge({
      files: 10,
      demand: { ...allDemanded(4), pg_cron: 0 },
      supply: { ...allPresent(), pg_cron: null },
    });
    ok(r0.verdict === "MEASURE_FAIL", "unreadable supply is a MEASURE_FAIL even where NOTHING demands the class");
    const partial = allPresent();
    delete partial.vault;
    ok(
      judge({ files: 10, demand: allDemanded(4), supply: partial }).verdict === "MEASURE_FAIL",
      "a class MISSING from the supply map is unreadable, never absent",
    );
    ok(
      [Number.NaN, -1, 1.5, "1", undefined].every(
        (bad) => judge({ files: 10, demand: allDemanded(4), supply: { ...allPresent(), vault: bad } }).verdict === "MEASURE_FAIL",
      ),
      "NaN, negative, fractional, string and undefined supply readings are all MEASURE_FAIL",
    );
  }

  head("an EMPTY corpus -> MEASURE_FAIL; it is never a clean probe");
  {
    const r = judge({ files: 0, demand: allDemanded(0), supply: allPresent() });
    ok(r.verdict === "MEASURE_FAIL" && has(r, "empty-corpus"), `zero corpus files -> MEASURE_FAIL empty-corpus (got ${r.verdict})`);
    ok(
      judge({ files: undefined, demand: allDemanded(0), supply: allPresent() }).verdict === "MEASURE_FAIL",
      "an unreadable corpus size is a MEASURE_FAIL too",
    );
  }

  head("demand UNREADABLE -> MEASURE_FAIL");
  {
    const r = judge({ files: 10, demand: { ...allDemanded(4), vault: null }, supply: allPresent() });
    ok(r.verdict === "MEASURE_FAIL" && has(r, "demand-unreadable", "vault"), `a null demand count -> MEASURE_FAIL (got ${r.verdict})`);
  }

  head("MEASURE_FAIL outranks INSUFFICIENT, and the unsatisfied class is still named");
  {
    const r = judge({
      files: 10,
      demand: allDemanded(4),
      supply: { ...allPresent(), vault: 0, pg_cron: null },
    });
    ok(r.verdict === "MEASURE_FAIL", `unreadable + unsatisfied -> MEASURE_FAIL (got ${r.verdict})`);
    ok(has(r, "unsatisfied", "vault"), "the unsatisfied vault finding is reported beside the measurement failure");
  }

  head("the verdict line names EVERY class with both numbers — on the satisfied path too");
  {
    const corpus = { files: 10, laneOnly: 1 };
    const good = verdictLine(corpus, judge({ files: 10, demand: allDemanded(4), supply: allPresent() }));
    ok(good.startsWith("stack-probe: "), `the line starts with 'stack-probe: ' (got '${good}')`);
    ok(
      CLASSES.every((c) => new RegExp(`(^| )${c.name}=4/present( |$)`).test(good)),
      "every class appears as <class>=<demand>/present on a SUFFICIENT line",
    );
    ok(/ verdict SUFFICIENT$/.test(good), "the SUFFICIENT line ends with its verdict");
    const bad = verdictLine(
      corpus,
      judge({ files: 10, demand: { ...allDemanded(4), vault: 2 }, supply: { ...allPresent(), vault: 0 } }),
    );
    ok(/ vault=2\/absent /.test(bad) && / verdict INSUFFICIENT$/.test(bad), `the INSUFFICIENT line names vault=2/absent (got '${bad}')`);
    const unk = verdictLine(corpus, judge({ files: 10, demand: allDemanded(4), supply: { ...allPresent(), pg_cron: null } }));
    ok(/ pg_cron=4\/UNREADABLE /.test(unk) && / verdict MEASURE_FAIL$/.test(unk), `the MEASURE_FAIL line prints UNREADABLE (got '${unk}')`);
  }

  head("exit codes: SUFFICIENT 0, INSUFFICIENT and MEASURE_FAIL non-zero and distinct");
  ok(
    EXIT.SUFFICIENT === 0 && EXIT.INSUFFICIENT !== 0 && EXIT.MEASURE_FAIL !== 0 && EXIT.INSUFFICIENT !== EXIT.MEASURE_FAIL,
    "a caller can tell 'the lane lacks something' from 'the probe could not measure' by status alone",
  );

  head("demand is DERIVED from file text; LANE-ONLY files are excluded by the SAME predicate sql-tests uses");
  {
    const texts = [
      "SELECT auth.uid();",
      "-- LANE-ONLY: {\"job\":\"sql-mutation\"}\nSELECT net.http_post('x'); SELECT * FROM vault.decrypted_secrets;",
      "SET ROLE authenticated; SELECT cron.schedule('j', '* * * * *', 'SELECT 1');",
      "SELECT 1;",
    ];
    const d = deriveDemand(texts);
    ok(d.files === 3 && d.laneOnly === 1, `3 corpus files, 1 LANE-ONLY excluded (got files=${d.files} laneOnly=${d.laneOnly})`);
    ok(d.demand?.pg_net === 0 && d.demand?.vault === 0, "a LANE-ONLY file's mentions demand nothing — it never runs under sql-tests");
    ok(
      d.demand?.["auth-functions"] === 1 && d.demand?.["platform-roles"] === 1 && d.demand?.pg_cron === 1,
      `the other classes are counted per FILE (got ${JSON.stringify(d.demand)})`,
    );
    const empty = deriveDemand([]);
    ok(
      judge({ files: empty.files, demand: empty.demand, supply: allPresent() }).verdict === "MEASURE_FAIL",
      "a corpus with no files derives to a MEASURE_FAIL, end to end",
    );
    ok(deriveDemand(["SELECT 1; -- LANE-ONLY: not at line start"]).laneOnly === 0, "the marker counts only at the START of a line");
  }

  head("each demand detector fires on its object and not on a near-miss");
  {
    const cases = {
      pg_net: ["PERFORM net.http_post(url := 'x');", "SELECT internet.http_status;"],
      vault: ["SELECT * FROM vault.decrypted_secrets;", "CREATE EXTENSION supabase_vault;"],
      "auth-functions": ["WHERE user_id = auth.uid()", "SELECT oauth.uid(), auth.uidx();"],
      "platform-roles": ["GRANT SELECT ON t TO authenticated;", "-- unauthenticated callers are refused"],
      pg_cron: ["SELECT jobname FROM cron.job;", "SELECT cron_expression FROM t;"],
    };
    for (const c of CLASSES) {
      const [hit, miss] = cases[c.name];
      ok(c.demand.test(hit) && !c.demand.test(miss), `${c.name}: matches '${hit}', not '${miss}'`);
    }
  }

  head("parseSupply: every class exactly once as an integer, or it is UNREADABLE");
  {
    const good = CLASSES.map((c) => `${c.name}|${c.required}`).join("\n") + "\n";
    const p = parseSupply(good);
    ok(CLASSES.every((c) => p[c.name] === c.required), `a well-formed answer parses to integers (got ${JSON.stringify(p)})`);
    const missing = CLASSES.filter((c) => c.name !== "vault").map((c) => `${c.name}|1`).join("\n");
    const pm = parseSupply(missing);
    ok(pm.vault === null && pm.pg_net === 1, "a class the answer omits is null, the others still read");
    const pd = parseSupply(good + "vault|1\n");
    ok(pd.vault === null && pd.pg_net === 1, "a class answered TWICE is null — two answers are no answer");
    const pg = parseSupply(good + "ERROR:  relation does not exist\n");
    ok(CLASSES.every((c) => pg[c.name] === null), "an unattributable line makes EVERY class unreadable");
    const pe = parseSupply("");
    ok(CLASSES.every((c) => pe[c.name] === null), "an empty answer makes every class unreadable, never absent");
    const pu = parseSupply(good + "pg_graphql|1\n");
    ok(CLASSES.every((c) => pu[c.name] === null), "a class nobody asked about means the answer is not ours — all unreadable");
  }

  head("refuseNonLocalDsn: loopback only, and the refusal never echoes the DSN");
  {
    const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    ok(refuseNonLocalDsn(LOCAL) === null, "127.0.0.1 with a port is accepted");
    ok(refuseNonLocalDsn("postgresql://postgres:postgres@localhost:54322/postgres") === null, "localhost with a port is accepted");
    const refusals = {
      remote: "postgresql://postgres:s3cret@db.example.invalid:5432/postgres",
      smuggled: "postgresql://u:x@127.0.0.1:1@db.example.invalid:5432/postgres",
      query: "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.example.invalid",
      scheme: "mysql://postgres:postgres@127.0.0.1:54322/postgres",
      unparseable: "not a dsn at all",
      portless: "postgresql://postgres:postgres@127.0.0.1/postgres",
      // Review 164.4.2 round 2, WR-02: a URL parser splits the authority at the
      // LAST '@', libpq at the FIRST, then reads a comma host list. libpq tries
      // the remote host first; the URL parser sees only 127.0.0.1.
      hostList: "postgresql://u@db.example.invalid,@127.0.0.1:54322/postgres",
      doubleAt: "postgresql://u@db.example.invalid@127.0.0.1:54322/postgres",
      // A URL parser strips tab and newline anywhere; libpq keeps them.
      whitespace: "postgresql://postgres@127.0.0.1:54\t322/postgres",
    };
    ok(typeof refuseNonLocalDsn(refusals.remote) === "string", "a remote host is refused");
    ok(
      typeof refuseNonLocalDsn(refusals.smuggled) === "string",
      "'@127.0.0.1:' smuggled into the userinfo is refused — the host is what libpq connects to",
    );
    ok(typeof refuseNonLocalDsn(refusals.query) === "string", "a query string is refused — host=/hostaddr=/service= re-point libpq");
    ok(typeof refuseNonLocalDsn(refusals.scheme) === "string", "a non-postgres scheme is refused");
    ok(typeof refuseNonLocalDsn(refusals.unparseable) === "string", "an unparseable DSN is refused");
    ok(typeof refuseNonLocalDsn(refusals.portless) === "string", "a DSN with no port is refused, matching run.sh's own '@127.0.0.1:' guard");
    ok(
      typeof refuseNonLocalDsn(refusals.hostList) === "string",
      "a comma host list behind a second '@' is refused — libpq connects to its FIRST, remote, host",
    );
    ok(typeof refuseNonLocalDsn(refusals.doubleAt) === "string", "a second '@' in the authority is refused — libpq and a URL parser split it differently");
    ok(typeof refuseNonLocalDsn(refusals.whitespace) === "string", "whitespace inside the DSN is refused — a URL parser strips it, libpq does not");
    ok(
      Object.values(refusals).every((dsn) => {
        const why = String(refuseNonLocalDsn(dsn) ?? "");
        return why.length > 0 && !why.includes(dsn) && !why.includes("s3cret") && !why.includes("example.invalid");
      }),
      "no refusal message carries the DSN, its password or its host",
    );
  }

  head("the class table is well-formed and the supply query asks every class");
  {
    const names = CLASSES.map((c) => c.name);
    ok(
      new Set(names).size === names.length &&
        CLASSES.every((c) => c.demand instanceof RegExp && c.supplySql.length > 0 && Number.isInteger(c.required) && c.required >= 1),
      "class names are unique and each carries a detector, a supply query and a required count >= 1",
    );
    const q = buildSupplyQuery();
    ok(CLASSES.every((c) => q.includes(`'${c.name}'`) && q.includes(c.supplySql)), "the ONE supply query carries every class's own query");
  }

  console.log("");
  if (asserted !== EXPECTED_ASSERTIONS) {
    console.error(
      `=== SELF-TEST FAILED: ${asserted} assertion(s) ran, but this self-test declares ` +
        `${EXPECTED_ASSERTIONS}. An arm was deleted, skipped, or added without updating ` +
        `EXPECTED_ASSERTIONS. A shrinking self-test that still says PASSED is the defect. ===`,
    );
    return 1;
  }
  if (!pass) {
    console.error(`=== SELF-TEST FAILED: ${asserted} assertion(s) run, at least one did not hold ===`);
    return 1;
  }
  console.log(`=== SELF-TEST PASSED: ${asserted}/${EXPECTED_ASSERTIONS} declared assertions across ${SECTIONS} sections ===`);
  return 0;
}

/**
 * Realpath-safe main-module guard, the `[VAC04-C2]` lesson. Comparing
 * `import.meta.url` with `file://${process.argv[1]}` silently does nothing on
 * symlinked or space-bearing paths, which turns the CLI into a library without
 * telling anyone. Same idiom as `scripts/check-baseline-currency.mjs`.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
