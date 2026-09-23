#!/usr/bin/env node
/**
 * LOCAL-STACK CAPABILITY PROBE — does the ephemeral Supabase stack SUPPLY what
 * the SQL self-test corpus DEMANDS? (Phase 164.4.2 plan 04.)
 *
 * RED PHASE: the self-test below is written; the functions it drives are stubs.
 */

export const EXIT = Object.freeze({ SUFFICIENT: 0, MEASURE_FAIL: 1, INSUFFICIENT: 2 });

export const LANE_ONLY_RE = /^-- LANE-ONLY:/m;

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

// ── stubs (RED) ──────────────────────────────────────────────────────────────
export function deriveDemand(_fileTexts) {
  return { files: 0, laneOnly: 0, demand: {} };
}
export function buildSupplyQuery() {
  return "";
}
export function parseSupply(_stdout) {
  return {};
}
export function refuseNonLocalDsn(_dsn) {
  return null;
}
export function judge(_facts) {
  return { verdict: "SUFFICIENT", findings: [], rows: [] };
}
export function verdictLine(_corpus, _result) {
  return "";
}

// ── self-test ────────────────────────────────────────────────────────────────

/**
 * How many `ok()` calls the sections below are declared to run.
 * ⛔ Raise it only together with the arm that adds one; lowering it to make a
 * run green is deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 52;

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

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  console.error("::error::RED phase — only --self-test is implemented");
  return 1;
}

process.exit(main(process.argv.slice(2)));
