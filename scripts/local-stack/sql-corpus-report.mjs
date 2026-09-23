#!/usr/bin/env node
/**
 * LOCAL-STACK SQL CORPUS REPORT — run `supabase/tests/test_*.sql` on the local-stack
 * lane the way CI's `sql-tests` step runs it, but CONTINUE past a failure so every
 * file gets a verdict. (Phase 164.4.2 plan 11, Task 0.)
 *
 * ⛔ THIS IS A DIAGNOSTIC, NOT A GATE. It is not wired into CI, and CI's `sql-tests`
 * step ("Run SQL self-tests against the local-stack lane" in .github/workflows/ci.yml)
 * stays the authority. That step STOPS at the first failing file, which is right for
 * a gate and useless for a census: plan 08's checkpoint needed every file's result to
 * learn that the ACL fix had moved the corpus from 35 failures to 8, and it got that
 * number from a hand-rolled loop. This file is that loop, committed, so the next
 * census is a command rather than a reconstruction.
 *
 * WHAT IT REPRODUCES from that step, and nothing more:
 *   - the per-file `psql -X -v ON_ERROR_STOP=1 -f <file>`, with client_min_messages
 *     forced to `notice` through PGOPTIONS exactly as the step forces it;
 *   - the `^-- LANE-ONLY:` exclusion, decided from the file's TEXT before psql runs;
 *   - NET 1: a file's own `RAISE NOTICE 'SKIP: …` marker appearing in its output;
 *   - NET 2: `NOTICE:  SKIP:` in the output.
 * WHAT IT DOES NOT REPRODUCE: the step's static accounting (sentinel declarations,
 * the roster-vs-count coherence and the arms bound), the NOTICE-channel probe and the
 * narrow-partial-skip annotations. A green report is therefore NOT a green `sql-tests`.
 *
 * USAGE
 *   node scripts/local-stack/sql-corpus-report.mjs                 # the whole corpus
 *   node scripts/local-stack/sql-corpus-report.mjs --file <path> [--file <path> …]
 * `--file` narrows the run and may name a file OUTSIDE supabase/tests (a scratch
 * assertion file); such a file is run exactly like a corpus file and counted.
 *
 * PRINTS one `PASS|FAIL|SKIP|LANE-ONLY <file>` line per file (a FAIL also prints its
 * first `ERROR:` line), then a scope line, then:
 *   sql-corpus: files=<n> pass=<p> fail=<f> whole-file-skip=<s> lane-only=<l>
 * COUNTING: `files` counts EVERY file considered, LANE-ONLY included, so
 * files = pass + fail + whole-file-skip + lane-only and each file is in one bucket.
 * PRECEDENCE: LANE-ONLY (decided before running) → FAIL → SKIP → PASS. A file that
 * prints a SKIP marker and THEN errors is a FAIL: an error must never be masked as a
 * skip, and the louder label wins.
 *
 * and, always beside it, a `not-checked:` line naming what `sql-tests` checks and this
 * report does not (review 164.4.2 IN-05).
 *
 * EXIT 0 only when fail = 0 and whole-file-skip = 0; 1 otherwise; 2 when it cannot
 * measure (no DB_URL in scripts/local-stack/.stack-env, a non-loopback DSN, an empty
 * corpus, no psql, or a `--file` that does not exist).
 *
 * ⛔ THE REPO IS PUBLIC. Output names files and the first `ERROR:` line only. The DSN
 * is read from the lane's mode-600 handoff and is never printed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { refuseNonLocalDsn } from "./capability-probe.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENV_FILE = join(REPO_ROOT, "scripts", "local-stack", ".stack-env");
const CORPUS_DIR = join(REPO_ROOT, "supabase", "tests");
const HOMEBREW_PSQL = "/opt/homebrew/opt/postgresql@16/bin/psql";
// A single file that has not finished in 10 minutes is reported FAIL, never waited on.
const PER_FILE_TIMEOUT_MS = 10 * 60 * 1000;

function cannotMeasure(msg) {
  console.error(`sql-corpus-report: CANNOT MEASURE: ${msg}`);
  process.exit(2);
}

// ── arguments ───────────────────────────────────────────────────────────────
const narrowed = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--file") {
    const p = argv[i + 1];
    if (!p) cannotMeasure("--file needs a path");
    const abs = resolve(p);
    if (!existsSync(abs) || !statSync(abs).isFile()) cannotMeasure(`--file ${p} does not exist`);
    narrowed.push(abs);
    i++;
  } else {
    cannotMeasure(`unknown argument '${argv[i]}' (only --file <path> is accepted)`);
  }
}

// ── the lane's DSN: the same sed and the same loopback refusal as load_baseline ─
let envText = "";
try {
  envText = readFileSync(ENV_FILE, "utf8");
} catch {
  cannotMeasure(`no DB_URL: ${relative(REPO_ROOT, ENV_FILE)} is absent (is the lane up? run scripts/local-stack/run.sh up)`);
}
const dbUrl = envText
  .split("\n")
  .map((l) => /^DB_URL="?([^"]*)"?$/.exec(l))
  .find(Boolean)?.[1];
if (!dbUrl) cannotMeasure(`no DB_URL line in ${relative(REPO_ROOT, ENV_FILE)}`);
// Review 164.4.2 WR-08, applied to this caller too: the ONE parse-based loopback rule
// (capability-probe.mjs's refuseNonLocalDsn). The `@127.0.0.1:` regex it replaces
// accepted a ?host= / hostaddr= override, which libpq honours.
const dsnRefusal = refuseNonLocalDsn(dbUrl);
if (dsnRefusal) cannotMeasure(`${dsnRefusal}; this report is local-only`);

// ── psql, resolved as resolve_psql() resolves it ────────────────────────────
function resolvePsql() {
  for (const d of (process.env.PATH ?? "").split(delimiter)) {
    if (d && existsSync(join(d, "psql"))) return join(d, "psql");
  }
  return existsSync(HOMEBREW_PSQL) ? HOMEBREW_PSQL : null;
}
const psql = resolvePsql();
if (!psql) cannotMeasure("psql not found on PATH or at the homebrew postgresql@16 keg");

// ── the corpus ──────────────────────────────────────────────────────────────
let corpus = [];
try {
  corpus = readdirSync(CORPUS_DIR)
    .filter((f) => /^test_.*\.sql$/.test(f))
    .sort()
    .map((f) => join(CORPUS_DIR, f));
} catch {
  corpus = [];
}
if (corpus.length === 0) cannotMeasure("supabase/tests/test_*.sql is EMPTY; a run over no files proves nothing");

const files = narrowed.length > 0 ? narrowed : corpus;
const inCorpus = (abs) => dirname(abs) === CORPUS_DIR;

// ── run ─────────────────────────────────────────────────────────────────────
const tally = { pass: 0, fail: 0, skip: 0, laneOnly: 0 };
for (const abs of files) {
  // psql prefixes every message with the `-f` argument AS GIVEN, so it is handed a
  // repo-relative path (as CI hands it) or, for a file outside the repo, its bare
  // name run from its own directory — never an absolute path, which would print a
  // home directory into the report.
  const repoRel = relative(REPO_ROOT, abs);
  const outside = repoRel.startsWith("..");
  const name = outside ? `(outside the repo) ${basename(abs)}` : repoRel;
  const text = readFileSync(abs, "utf8");
  if (/^-- LANE-ONLY:/m.test(text)) {
    tally.laneOnly++;
    console.log(`LANE-ONLY ${name}`);
    continue;
  }
  const r = spawnSync(psql, [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", outside ? basename(abs) : repoRel], {
    cwd: outside ? dirname(abs) : REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c client_min_messages=notice" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PER_FILE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const errorLine = out.split("\n").find((l) => /ERROR:/.test(l));
  if (r.error || r.status !== 0 || errorLine) {
    tally.fail++;
    console.log(`FAIL ${name}`);
    const why = r.error
      ? `(psql did not complete: ${r.error.code ?? r.error.message})`
      : (errorLine ?? `(psql exited ${r.status} with no ERROR: line)`);
    console.log(`     ${why}`);
    continue;
  }
  // NET 1: the whole-file markers THIS file defines, found in its output.
  const markers = [...text.matchAll(/RAISE NOTICE 'SKIP: [^'%]{0,60}/g)].map((m) =>
    m[0].replace(/^.*RAISE NOTICE '/, ""),
  );
  const net1 = markers.some((m) => out.includes(m));
  // NET 2: label-anchored, for a skip message composed at runtime.
  const net2 = /NOTICE: +SKIP:/.test(out);
  if (net1 || net2) {
    tally.skip++;
    console.log(`SKIP ${name}`);
    continue;
  }
  tally.pass++;
  console.log(`PASS ${name}`);
}

if (narrowed.length > 0) {
  const k = narrowed.filter(inCorpus).length;
  console.log(
    `scope: NARROWED to ${narrowed.length} file(s) by --file (${k} inside supabase/tests, ${narrowed.length - k} outside) of ${corpus.length} corpus files`,
  );
} else {
  console.log(`scope: ${corpus.length} of ${corpus.length} files in supabase/tests`);
}
console.log(
  `sql-corpus: files=${files.length} pass=${tally.pass} fail=${tally.fail} whole-file-skip=${tally.skip} lane-only=${tally.laneOnly}`,
);
// Review 164.4.2 IN-05: printed on every completed run, beside the verdict, so a
// green report is never read as a green `sql-tests`.
console.log(
  "not-checked: completion sentinels, arm rosters (roster-vs-count coherence and the arms bound), the NOTICE-channel " +
    "probe and narrow-partial-skip annotations — sql-tests checks those; this report is NOT a green sql-tests",
);
process.exit(tally.fail === 0 && tally.skip === 0 ? 0 : 1);
