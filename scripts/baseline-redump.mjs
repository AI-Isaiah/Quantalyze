#!/usr/bin/env node
/**
 * BASELINE RE-DUMP automation (Phase 164.9.5 AUTOREDUMP) — the offline half of
 * the `redump-dump` / `redump-pr` jobs in `.github/workflows/supabase-migrate.yml`.
 *
 * ⚠️ WHY THIS EXISTS: after a PROD migration apply, `supabase/schema/baseline.sql`
 * no longer describes production, and `baseline-content-drift` goes red on `main`
 * until someone runs the manual procedure in `supabase/schema/BASELINE.md`
 * `## Regenerating`. PR #864 (merge 35d1d412f) is the worked example of that
 * procedure's output: exactly six files. This script reproduces it mechanically,
 * in two halves, so the PROD credential and the repository write token never
 * share a job (decision D-21):
 *
 *   --gate-dump   (credentialed job) hash a dump, count its shapes, regenerate the
 *                 carried-migrations marker from the MERGE tree (never the working
 *                 tree, D-09), and write a gated out dir. A dump byte-identical to
 *                 the committed pair is a no-op (D-10): `changed=false`, exit 0.
 *   --compose     (write-token job) copy the gated pair onto a checkout of `main`,
 *                 run the real offline gates as child processes, write VERSION,
 *                 package.json, CHANGELOG.md and BASELINE.md, stage EXACTLY the six
 *                 paths by explicit path (D-17), and commit as github-actions[bot].
 *
 * ⛔ THIS REPOSITORY IS PUBLIC and the dump is a pg_dump of the production
 * catalogue. Nothing here prints a line of the dump, a DSN, a token or a project
 * ref (D-06). Every printed value is a sha prefix, a byte count, a shape count or
 * a gate's own summary line.
 *
 * ⛔ node builtins only. `redump-pr` runs this with no `npm ci`, so the three
 * offline gates run as CHILD PROCESSES rather than being imported — with one
 * exception: `RECORDED_SHA_RE_ALL` is imported from check-baseline-staleness.mjs
 * (node builtins only itself, and its `main` is guarded by `invokedDirectly()`),
 * so this writer and CI's co-edit gate read the provenance row with ONE regex.
 * `scripts/check-version-bump.mjs` is NOT imported: it calls
 * `process.exit(main())` at module scope. Its three defects are MIRRORED in
 * `versionDefects()` below instead.
 *
 * The frozen CLI (plan 04 wires exactly these; later plans add behaviour behind
 * them without renaming anything):
 *
 *     node scripts/baseline-redump.mjs --self-test [--with-gitleaks]
 *     node scripts/baseline-redump.mjs --gate-dump --dump <file> --merge <40-hex> \
 *          --run-id <digits> --cli-version <x.y.z> --out <dir>
 *     node scripts/baseline-redump.mjs --compose --in <dir> --out <dir>
 */
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORDED_SHA_RE_ALL } from "./check-baseline-staleness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The five-class secret scan, as a plain STRING byte-equal to the argument of the
 * `grep -anE '…'` line in `supabase/schema/BASELINE.md` `## Regenerating` (D-06).
 * A STRING, not a regex literal: a literal's `.source` escapes `/`, so it could
 * never compare equal to the ERE text the doc carries. The self-test asserts the
 * equality against the doc, so the prose and the command cannot drift apart.
 */
export const SECRET_SCAN_PATTERN = String.raw`postgres(ql)?://|@[a-z0-9.-]+\.supabase\.(co|com)|[a-z]{20}\.supabase|\\connect|ALTER DATABASE|eyJ[A-Za-z0-9_-]{10,}`;
export const SECRET_SCAN_RE = new RegExp(SECRET_SCAN_PATTERN);

/**
 * STRICTER than `check-baseline-currency.mjs`'s `MIGRATION_BASENAME_RE`
 * (`^[0-9]+_…`): exactly fourteen timestamp digits. A basename is interpolated
 * into a commit message, a CHANGELOG entry and a PR body here (D-27), so the
 * shape every real migration has (measured: all 278 at plan time) is the only
 * shape accepted — anything else is refused before it is written anywhere.
 */
export const MIGRATION_BASENAME_STRICT_RE = /^[0-9]{14}_[a-z0-9_]+\.sql$/;

export const BOT_BRANCH = "automation/baseline-redump";
export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
/** The six paths of PR #864's footprint (D-15, D-16, D-17), sorted. */
export const STAGED_PATHS = [
  "CHANGELOG.md",
  "VERSION",
  "package.json",
  "supabase/schema/BASELINE.md",
  "supabase/schema/baseline-carried-migrations.txt",
  "supabase/schema/baseline.sql",
];
/** Must equal `ci.yml`'s `secret-scan` job `GITLEAKS_VERSION:` (D-26; plan 09 pins the equality). */
export const GITLEAKS_VERSION = "8.30.1";

const BASELINE_SQL_REL = "supabase/schema/baseline.sql";
const MARKER_REL = "supabase/schema/baseline-carried-migrations.txt";
const BASELINE_MD_REL = "supabase/schema/BASELINE.md";
const MIGRATIONS_REL = "supabase/migrations/";

// ── pure functions (no I/O; the self-test drives them directly) ──────────────

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Shape counts over the dump (D-27; RESEARCH F8, the `restore-test-from-baseline.sh`
 * `grep -ac '^CREATE TABLE'` precedent). Every regex is multiline and anchored per
 * line. Measured on the committed dump: 63 / 155 / 123 / 121 / 0.
 */
export function countShapes(text) {
  const count = (re) => (text.match(re) ?? []).length;
  const names = new Set();
  for (const m of text.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ("[^"]+"\."[^"]+")/gm)) names.add(m[1]);
  return {
    tables: count(/^CREATE TABLE/gm),
    policies: count(/^CREATE POLICY/gm),
    function_statements: count(/^CREATE (OR REPLACE )?FUNCTION/gm),
    distinct_functions: names.size,
    data_statements: count(/^(INSERT INTO|COPY |SELECT pg_catalog\.setval)/gm),
  };
}

/** At most this many line numbers are printed per finding class; the count is always exact. */
const MAX_LINES_PRINTED = 50;

/** `n,n,…` capped at MAX_LINES_PRINTED, with the remainder counted, never listed. */
function lineList(lines) {
  const shown = lines.slice(0, MAX_LINES_PRINTED).join(",");
  return lines.length > MAX_LINES_PRINTED ? `${shown} (+${lines.length - MAX_LINES_PRINTED} more)` : shown;
}

/**
 * The five-class scan (D-06), the `grep -a` equivalent: the dump is read as
 * `latin1`, so a NUL-bearing or non-UTF-8 file is scanned byte for byte and never
 * skipped as "binary". Returns the 1-based line numbers of every hit. ⛔ The
 * caller prints the COUNT and these NUMBERS only, never a line's text: this runs
 * in a PUBLIC Actions log, and `BASELINE.md`'s own `grep -anE` would publish the
 * secret it found.
 */
export function judgeSecretScan(buffer) {
  const hits = [];
  buffer
    .toString("latin1")
    .split("\n")
    .forEach((line, i) => {
      if (SECRET_SCAN_RE.test(line)) hits.push(i + 1);
    });
  return hits;
}

/**
 * The home-path needles: a GitHub runner's `/home/`, and the macOS home prefix
 * built from char codes exactly as `scripts/check-planning-hygiene.ts` builds its
 * `HOME_PREFIX`, so no tracked file spells that prefix.
 */
const HOME_PATH_NEEDLES = ["/home/", String.fromCharCode(47, 85, 115, 101, 114, 115, 47)];

/**
 * Integrity (D-08, the #864 provenance table): zero NUL bytes, exactly ONE
 * `SET client_encoding` line, zero home-directory paths. Every defect names a
 * count or a line number, never the path.
 *
 * D-08's "no local home path / username" clause is delivered by the home-path
 * check, and a separate bare-username scan is DELIBERATELY not added. In CI the
 * dump is captured by the runner account, whose name is a common English word
 * that occurs in legitimate catalogue text, so a username needle would refuse
 * every run. The developer's own username cannot be written into this PUBLIC
 * repository as a scan needle at all. A username reaches a dump through a
 * home-directory path, which the two needles above catch.
 */
export function judgeIntegrity(buffer) {
  let nul = 0;
  for (let i = buffer.indexOf(0); i !== -1; i = buffer.indexOf(0, i + 1)) nul += 1;
  let clientEncoding = 0;
  const homeLines = [];
  buffer
    .toString("latin1")
    .split("\n")
    .forEach((line, i) => {
      if (/^SET client_encoding/.test(line)) clientEncoding += 1;
      if (HOME_PATH_NEEDLES.some((n) => line.includes(n))) homeLines.push(i + 1);
    });
  const defects = [];
  if (nul !== 0) defects.push(`${nul} NUL byte(s); a text dump carries none`);
  if (clientEncoding !== 1) defects.push(`${clientEncoding} 'SET client_encoding' line(s); exactly 1 is required`);
  if (homeLines.length !== 0) {
    defects.push(`${homeLines.length} home-directory path(s) at line(s) ${lineList(homeLines)}`);
  }
  return { nul, client_encoding: clientEncoding, home_path: homeLines.length, defects };
}

/** Shape refusals (D-27; the `restore-test-from-baseline.sh` zero-table refusal). */
export function judgeShapeCounts(shapes) {
  const defects = [];
  if (shapes.tables === 0) defects.push("0 CREATE TABLE lines: a dump that creates nothing is not a baseline");
  if (shapes.data_statements > 0) {
    defects.push(`${shapes.data_statements} data statement(s): a schema-only dump carrying data is a leak class of its own`);
  }
  return defects;
}

/**
 * The ONE gitleaks invocation (D-07 as amended by D-26; RESEARCH F4, measured on
 * 8.30.1). `dir` scans one file without git. `--config .gitleaks.toml` is always
 * EXPLICIT (gitleaks auto-loads a config from the cwd, so omitting it tests
 * nothing), and it resolves against the spawn cwd, which is the repo root.
 * `--redact` keeps the secret out of the text and the JSON report.
 * `--ignore-gitleaks-allow` stops a `gitleaks:allow` comment, which a PROD
 * function comment could carry, from suppressing a finding.
 */
export function gitleaksArgv(target, reportPath) {
  return [
    "dir", target,
    "--config", ".gitleaks.toml",
    "--redact",
    "--no-banner",
    "--ignore-gitleaks-allow",
    "--report-format", "json",
    "--report-path", reportPath,
    "--log-level", "error",
  ];
}

/**
 * ⛔ MEASURED TRAP (RESEARCH F4): `gitleaks dir` on a MISSING or EMPTY target
 * prints a skip warning and exits 0, "no leaks found". This runs BEFORE gitleaks
 * is spawned, so that false clean can never be read as a pass. Messages never
 * carry the path.
 */
export function assertScanTarget(path) {
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("the dump does not exist; gitleaks exits 0 on a missing target, which is a false clean");
    throw new Error(`MEASURE_FAIL: the dump could not be inspected (${e.code ?? e.name}); a scan that could not run is never clean`);
  }
  if (!st.isFile()) throw new Error("the dump is not a regular file; refusing to scan it");
  if (st.size === 0) throw new Error("the dump is EMPTY (0 bytes); gitleaks exits 0 on an empty target, which is a false clean");
}

/**
 * Judge one gitleaks run from its exit code and JSON report. Exit 0 with `[]` is
 * the ONLY clean. Exit 1 with findings refuses. Exit 0 WITH findings refuses too:
 * a disagreement is never clean. Any other exit, exit 1 with no finding, an
 * unparseable report or a non-array is MEASURE_FAIL. Each finding keeps only its
 * RuleID (reduced to a safe charset) and StartLine; Secret and Match are dropped
 * here, so no caller can print them even redacted.
 */
export function judgeGitleaksReport({ rc, reportText }) {
  if (rc !== 0 && rc !== 1) return { verdict: "measure_fail", reason: `gitleaks exited ${rc}`, findings: [] };
  let report;
  try {
    report = JSON.parse(reportText);
  } catch {
    return { verdict: "measure_fail", reason: "the gitleaks report is not JSON", findings: [] };
  }
  if (!Array.isArray(report)) return { verdict: "measure_fail", reason: "the gitleaks report is not a JSON array", findings: [] };
  const findings = report.map((f) => ({
    rule: /^[A-Za-z0-9_.-]{1,80}$/.test(String(f?.RuleID)) ? String(f.RuleID) : "unreadable-rule-id",
    line: Number.isInteger(f?.StartLine) ? f.StartLine : "unknown",
  }));
  if (rc === 0 && findings.length === 0) return { verdict: "clean", findings };
  if (rc === 1 && findings.length > 0) return { verdict: "refuse", findings };
  if (rc === 0) return { verdict: "refuse", reason: "exit 0 with findings, and a disagreement is never clean", findings };
  return { verdict: "measure_fail", reason: "gitleaks exited 1 with no finding in its report", findings };
}

/**
 * The marker exactly as the `## Regenerating` recipe builds it: the `#` header
 * lines in order (`sed -n '/^#/p'`), then `baseline-sha256: <sha>`, then the
 * basenames sorted in byte order (the committed file is `LC_ALL=C`-sorted;
 * measured), one per line, newline-terminated.
 */
export function buildMarker({ headerLines, sha, basenames }) {
  const sorted = [...basenames].sort();
  return [...headerLines, `baseline-sha256: ${sha}`, ...sorted].join("\n") + "\n";
}

/** The marker's `#` header lines, in order — what `sed -n '/^#/p'` keeps. */
export function markerHeaderLines(markerText) {
  return markerText.split("\n").filter((l) => l.startsWith("#"));
}

/** The marker's basename entries (neither `#`, blank, nor the sha line). */
export function markerBasenames(markerText) {
  return markerText
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("baseline-sha256:"));
}

/** 4th-digit bump (D-15). Any other shape is refused, never guessed. */
export function nextVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  if (!m) throw new Error(`VERSION '${String(v).slice(0, 40)}' is not a 4-digit X.Y.Z.B string`);
  return `${m[1]}.${m[2]}.${m[3]}.${Number(m[4]) + 1}`;
}

/**
 * A single regex replace of `"version": "<old>"`. It never re-serialises the file
 * (that would reformat it), and it re-parses the result to confirm the version
 * reads back as `newV`. Never `npm version`, which rewrites the lockfile.
 */
export function bumpPackageJson(text, oldV, newV) {
  const esc = oldV.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"version": "${esc}"`, "g");
  const hits = (text.match(re) ?? []).length;
  if (hits !== 1) throw new Error(`package.json carries ${hits} '"version": "${oldV}"' occurrence(s); exactly 1 is required`);
  const out = text.replace(re, `"version": "${newV}"`);
  const back = JSON.parse(out).version;
  if (back !== newV) throw new Error(`package.json version reads back as '${back}', not '${newV}'`);
  return out;
}

/** Insert the entry before the first `\n## [` after the `# Changelog` title. */
export function insertChangelogEntry(text, entry) {
  if (!text.startsWith("# Changelog")) throw new Error("CHANGELOG.md does not start with the '# Changelog' title");
  const at = text.indexOf("\n## [");
  if (at === -1) throw new Error("CHANGELOG.md carries no '## [' entry heading to insert before");
  const heading = entry.split("\n")[0];
  const version = /^## \[([^\]]+)\]/.exec(heading)?.[1];
  if (!version) throw new Error("the composed entry does not start with a '## [X.Y.Z.B]' heading");
  if (text.includes(`\n## [${version}]`)) throw new Error(`CHANGELOG.md already carries a '## [${version}]' heading`);
  return text.slice(0, at + 1) + entry.replace(/\n*$/, "\n\n") + text.slice(at + 1);
}

/**
 * The `[start, end)` line range of the `## Provenance` capture table: from the
 * line after the `## Provenance` heading to the first following heading at ANY
 * level (`^#{1,6} `). ⚠️ The first `### Regenerated` heading sits INSIDE
 * `## Provenance`, and the file carries four `| Shape |` and five `| sha256 |`
 * rows file-wide (measured at plan time) — stopping at the next `## ` would sweep
 * in every regenerated section's rows.
 */
export function provenanceSpan(lines) {
  const head = lines.findIndex((l) => /^## Provenance\s*$/.test(l));
  if (head === -1) throw new Error("BASELINE.md carries no '## Provenance' heading");
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [head + 1, end];
}

/**
 * Replace the four capture rows (`Taken`, `Supabase CLI`, `sha256` — the ONLY
 * full-64-hex row, `Shape`) inside `provenanceSpan` ONLY (D-16). A line outside
 * the span is never read for a match and never written. A row that is not found
 * exactly once in the span is refused: the writer does not guess which row is
 * the capture table's.
 */
export function rewriteBaselineMd(text, values) {
  const lines = text.split("\n");
  const [start, end] = provenanceSpan(lines);
  const rows = {
    Taken: `| Taken | ${values.date} |`,
    "Supabase CLI": `| Supabase CLI | ${values.cliVersion} (the \`redump-dump\` job, Supabase Migrate run \`${values.runId}\`) |`,
    sha256: `| sha256 | \`${values.sha}\` |`,
    Shape: `| Shape | ${shapeProse(values.shapes)} |`,
  };
  for (const [key, row] of Object.entries(rows)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^\\|\\s*${esc}\\s*\\|`);
    const hits = [];
    for (let i = start; i < end; i++) if (re.test(lines[i])) hits.push(i);
    if (hits.length !== 1) {
      throw new Error(`the '## Provenance' capture table carries ${hits.length} '| ${key} |' row(s); exactly 1 is required`);
    }
    lines[hits[0]] = row;
  }
  return lines.join("\n");
}

function shapeProse(s) {
  return (
    `${s.tables} tables, ${s.policies} policies, ${s.function_statements} function statements ` +
    `(${s.distinct_functions} distinct names), **${s.data_statements} data statements**`
  );
}

const short = (sha, n = 8) => String(sha).slice(0, n);

/**
 * ONE fixed template (D-14: it names none of the CI skip tokens, not even to deny
 * one, and carries no credential-shaped literal). Plan 07 completes the entry
 * with every remaining D-16 value behind this same function name.
 */
export function composeChangelogEntry(m) {
  return [
    `## [${m.newVersion}] - ${m.date} — BASELINE: automated re-dump after the PROD apply of ${short(m.merge)}`,
    "",
    "### Changed",
    `- \`supabase/schema/baseline.sql\` re-dumped from PRODUCTION by Supabase Migrate run \`${m.runId}\`, ` +
      `after the PROD apply of merge \`${short(m.merge)}\`: sha256 \`${short(m.oldSha)}…\` → \`${short(m.newSha)}…\`.`,
  ].join("\n");
}

export function composePrTitle(m) {
  return `chore(release): v${m.newVersion} — baseline re-dump after the PROD apply of ${short(m.merge)}`;
}

export function composeCommitMessage(m) {
  const carried = m.newlyCarried.length === 0 ? "(none)" : m.newlyCarried.join(", ");
  return [
    composePrTitle(m),
    "",
    `Automated by the redump jobs of Supabase Migrate run ${m.runId}, after the PROD apply of merge ${short(m.merge)}.`,
    "",
    `- sha256 ${short(m.oldSha)}… -> ${short(m.newSha)}…`,
    `- shape: ${m.shapes.tables} tables, ${m.shapes.policies} policies, ${m.shapes.function_statements} function statements, ${m.shapes.data_statements} data statements`,
    `- migrations newly carried: ${carried}`,
    `- VERSION ${m.oldVersion} -> ${m.newVersion}`,
    "",
  ].join("\n");
}

/**
 * MIRROR of `scripts/check-version-bump.mjs` `judge()`'s three defects, so the bot
 * cannot compose a tree CI's `version-gate` would reject. Mirrored, not imported:
 * that module exits the process at import.
 */
export function versionDefects({ baseVersion, headVersion, packageVersion, changelog }) {
  const d = [];
  if (headVersion === baseVersion) d.push({ kind: "version-not-bumped", detail: `VERSION is still ${headVersion}` });
  if (headVersion !== packageVersion) {
    d.push({ kind: "version-package-mismatch", detail: `VERSION ${headVersion} but package.json ${packageVersion}` });
  }
  if (headVersion !== baseVersion && !changelog.includes(`[${headVersion}]`)) {
    d.push({ kind: "changelog-missing-entry", detail: `CHANGELOG.md has no [${headVersion}] heading` });
  }
  return d;
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

function git(repoRoot, args, opts = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: opts.encoding === undefined ? "utf8" : opts.encoding,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: opts.env ?? process.env,
  });
}

/** The committed bytes of `rel` at `ref` (never the working tree). */
function committedBytes(repoRoot, ref, rel) {
  return git(repoRoot, ["show", `${ref}:${rel}`], { encoding: "buffer" });
}

/**
 * One machine-readable line always; the `$GITHUB_OUTPUT` append only when the
 * variable is present (the `classify-changed-paths.mjs` `emit` idiom). Injected
 * into the modes so the self-test never writes a real job output.
 */
function emitToGithubOutput(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** The real child-process runner. Output is passed through so the log carries each gate's own lines. */
function realRunner(cmd, args, { cwd }) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return { status: r.error ? -1 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * The real gitleaks runner. `gitleaks version` first: a missing binary or a
 * version other than GITLEAKS_VERSION is MEASURE_FAIL. The report lives in a
 * temp dir, never in the out dir. gitleaks' own stdout is not passed through;
 * stderr is, only when the run could not complete (it carries config and I/O
 * errors, never a finding).
 */
function probeGitleaksVersion() {
  const v = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (v.error) {
    throw new Error(`MEASURE_FAIL: gitleaks could not be run (${v.error.code ?? v.error.name}); a scan that could not run is never clean`);
  }
  const version = String(v.stdout ?? "").trim().replace(/^v/, "");
  if (v.status !== 0 || version !== GITLEAKS_VERSION) {
    const shown = /^[0-9A-Za-z._-]{1,40}$/.test(version) ? version : "unreadable";
    throw new Error(`MEASURE_FAIL: gitleaks reports version ${shown}, not the pinned ${GITLEAKS_VERSION}`);
  }
  return version;
}

function realGitleaks({ repoRoot, target }) {
  const version = probeGitleaksVersion();
  const tmp = mkdtempSync(join(tmpdir(), "baseline-redump-gitleaks-"));
  try {
    const reportPath = join(tmp, "gitleaks.json");
    const r = spawnSync("gitleaks", gitleaksArgv(target, reportPath), { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`MEASURE_FAIL: gitleaks could not be run (${r.error.code ?? r.error.name})`);
    if (r.status !== 0 && r.status !== 1 && r.stderr) process.stderr.write(r.stderr.slice(0, 2000));
    let reportText = "";
    try {
      reportText = readFileSync(reportPath, "utf8");
    } catch {
      reportText = ""; // judged unparseable, so MEASURE_FAIL
    }
    return { rc: r.status, reportText, version };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The gitleaks gate: target assertion, then the injected runner, then the judge.
 * Prints the finding count and one `RuleID=<id> line=<n>` per finding, never a
 * Secret or Match field. Returns the version the runner reported.
 */
export function runGitleaksGate({ gitleaks, repoRoot, target }) {
  assertScanTarget(target);
  const { rc, reportText, version } = gitleaks({ repoRoot, target });
  const j = judgeGitleaksReport({ rc, reportText });
  if (j.verdict === "measure_fail") throw new Error(`MEASURE_FAIL: ${j.reason}; a scan that could not run is never clean`);
  console.log(`baseline-redump gitleaks: ${j.findings.length} finding(s)`);
  for (const f of j.findings.slice(0, MAX_LINES_PRINTED)) console.log(`  RuleID=${f.rule} line=${f.line}`);
  if (j.verdict !== "clean") {
    throw new Error(`gitleaks refused the dump: ${j.findings.length} finding(s)${j.reason ? ` (${j.reason})` : ""}`);
  }
  return version;
}

// ── modes ─────────────────────────────────────────────────────────────────────

/**
 * --gate-dump. Run from the repo root of the MERGE checkout. Returns
 * `{changed, measured}`. Throws on any refusal; the caller maps a throw to
 * `::error::` + exit 1.
 */
export function gateDump({ repoRoot, dump, merge, runId, cliVersion, out, emit, gitleaks }) {
  if (typeof gitleaks !== "function") throw new Error("gateDump was given no gitleaks runner; the gate is never skipped");
  if (!/^[0-9a-f]{40}$/.test(merge)) throw new Error("--merge must be a full 40-hex commit sha");
  if (!/^[0-9]+$/.test(runId)) throw new Error("--run-id must be digits only");
  if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) throw new Error("--cli-version must be X.Y.Z");
  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  // D-09. A refusal names the flag and the rule, never a value: argv is runner text.
  if (head !== merge) throw new Error("--merge is not this checkout's HEAD; the marker must come from the MERGE tree");

  // Every section-C gate runs BEFORE the out dir is written, and on the D-10
  // no-op path too: a run that writes nothing still proves the dump is clean.
  // Order (D-26): the target assertion, gitleaks, then the five-class scan.
  const gitleaksVersion = runGitleaksGate({ gitleaks, repoRoot, target: dump });
  let bytes;
  try {
    bytes = readFileSync(dump);
  } catch (e) {
    // D-06's grep exit >= 2: a scan that could not run is never clean.
    throw new Error(`MEASURE_FAIL: the dump could not be read (${e.code ?? e.name}); a scan that could not run is never clean`);
  }
  if (bytes.length === 0) throw new Error("the dump is EMPTY (0 bytes); an empty file measures nothing");

  const hits = judgeSecretScan(bytes);
  console.log(`baseline-redump secret-scan: ${hits.length} hit(s)${hits.length > 0 ? ` at line(s) ${lineList(hits)}` : ""}`);
  if (hits.length > 0) {
    throw new Error(`the five-class secret scan found ${hits.length} hit(s); the line numbers are above and the text is never printed`);
  }

  const integrity = judgeIntegrity(bytes);
  console.log(
    `baseline-redump integrity: nul=${integrity.nul} client_encoding=${integrity.client_encoding} home_path=${integrity.home_path}`,
  );
  if (integrity.defects.length > 0) throw new Error(`integrity refused: ${integrity.defects.join("; ")}`);

  const dumpSha = sha256(bytes);
  const shapes = countShapes(bytes.toString("utf8"));
  const shapeDefects = judgeShapeCounts(shapes);
  if (shapeDefects.length > 0) throw new Error(`shape counts refused: ${shapeDefects.join("; ")}`);

  // D-09: the MERGE tree, never the working tree — an uncommitted migration in
  // the checkout is not one PRODUCTION received.
  const listed = git(repoRoot, ["ls-tree", "--name-only", merge, MIGRATIONS_REL])
    .split("\n")
    .filter((p) => p.endsWith(".sql"))
    .map((p) => p.replace(/^.*\//, ""));
  // D-27: refused by count and 1-based position, never by name — a basename
  // that fails the rule is exactly the text that must not reach a log.
  const badAt = listed.flatMap((b, i) => (MIGRATION_BASENAME_STRICT_RE.test(b) ? [] : [i + 1]));
  if (badAt.length > 0) {
    throw new Error(
      `${badAt.length} migration basename(s) at the merge (position(s) ${lineList(badAt)}) do not match ` +
        `${MIGRATION_BASENAME_STRICT_RE}; refusing to write them anywhere`,
    );
  }

  const committedMarker = committedBytes(repoRoot, merge, MARKER_REL).toString("utf8");
  const committedDumpSha = sha256(committedBytes(repoRoot, merge, BASELINE_SQL_REL));
  const marker = buildMarker({ headerLines: markerHeaderLines(committedMarker), sha: dumpSha, basenames: listed });
  const changed = !(dumpSha === committedDumpSha && marker === committedMarker);

  const measured = {
    schema: 1,
    run_id: runId,
    merge,
    cli_version: cliVersion,
    dump_sha256: dumpSha,
    dump_bytes: bytes.length,
    shapes,
    marker_sha256: sha256(Buffer.from(marker, "utf8")),
    carried_count: listed.length,
    gitleaks: "clean",
    gitleaks_version: gitleaksVersion,
    secret_scan_hits: hits.length,
    integrity: { nul: integrity.nul, client_encoding: integrity.client_encoding, home_path: integrity.home_path },
  };

  // Never let a clean run and a run that did nothing look alike.
  console.log(
    `baseline-redump gate: sha256=${short(dumpSha)}… bytes=${bytes.length} tables=${shapes.tables} ` +
      `policies=${shapes.policies} carried=${listed.length} changed=${changed}`,
  );
  if (!changed) {
    console.log("::notice::baseline-redump: dump and marker are byte-identical to the committed pair — no PR");
    emit("changed", "false");
    return { changed, measured };
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "baseline.sql"), bytes);
  writeFileSync(join(out, "baseline-carried-migrations.txt"), marker);
  writeFileSync(join(out, "measured.json"), JSON.stringify(measured, null, 2) + "\n");
  emit("changed", "true");
  return { changed, measured };
}

/** Run one gate; a non-zero exit refuses. Returns its stdout. */
function runGate(runner, repoRoot, cmd, args) {
  const r = runner(cmd, args, { cwd: repoRoot });
  if (r.status !== 0) throw new Error(`gate '${[cmd, ...args].join(" ")}' exited ${r.status}; refusing to compose`);
  return r.stdout;
}

/** The single stdout line starting with `prefix`; refused when absent or repeated. */
function captureLine(stdout, prefix, gateName) {
  const hits = stdout.split("\n").filter((l) => l.startsWith(prefix));
  if (hits.length !== 1) throw new Error(`${gateName} printed ${hits.length} '${prefix}' line(s); exactly 1 is required`);
  return hits[0];
}

/**
 * --compose. Run from the repo root of a checkout of `main`. Returns
 * `{committed, staged, measured}`. Throws on any refusal.
 */
export function compose({ repoRoot, inDir, out, runner, emit, date }) {
  const measured = JSON.parse(readFileSync(join(inDir, "measured.json"), "utf8"));
  if (measured.schema !== 1) throw new Error(`measured.json schema is ${measured.schema}, expected 1`);
  if (!/^[0-9]+$/.test(String(measured.run_id))) throw new Error("measured.json run_id is not digits");
  if (!/^[0-9a-f]{40}$/.test(String(measured.merge))) throw new Error("measured.json merge is not a 40-hex sha");
  const newDump = readFileSync(join(inDir, "baseline.sql"));
  const newMarker = readFileSync(join(inDir, "baseline-carried-migrations.txt"), "utf8");
  if (sha256(newDump) !== measured.dump_sha256) throw new Error("the in-dir dump does not hash to measured.json's dump_sha256");

  // Second D-10 check: main may have moved between the two jobs.
  const oldDumpBytes = committedBytes(repoRoot, "HEAD", BASELINE_SQL_REL);
  const oldMarker = committedBytes(repoRoot, "HEAD", MARKER_REL).toString("utf8");
  const oldSha = sha256(oldDumpBytes);
  if (oldSha === measured.dump_sha256 && oldMarker === newMarker) {
    console.log("::notice::baseline-redump: the gated pair is byte-identical to this checkout's committed pair — nothing to commit");
    emit("committed", "false");
    return { committed: false, staged: [], measured };
  }

  // ⛔ A pre-existing edit to one of the six paths would ride into the bot commit.
  const dirty = git(repoRoot, ["status", "--porcelain", "--", ...STAGED_PATHS]).trim();
  if (dirty !== "") throw new Error("one of the six paths is already modified in this checkout; refusing to compose on top of it");

  const oldBasenames = new Set(markerBasenames(oldMarker));
  const newBasenames = markerBasenames(newMarker);
  const bad = newBasenames.filter((b) => !MIGRATION_BASENAME_STRICT_RE.test(b));
  if (bad.length > 0) throw new Error(`${bad.length} marker basename(s) do not match ${MIGRATION_BASENAME_STRICT_RE}`);
  const newlyCarried = newBasenames.filter((b) => !oldBasenames.has(b)).sort();

  const oldShapes = countShapes(oldDumpBytes.toString("utf8"));
  writeFileSync(join(repoRoot, BASELINE_SQL_REL), newDump);
  writeFileSync(join(repoRoot, MARKER_REL), newMarker);

  const currencyOut = runGate(runner, repoRoot, "bash", ["scripts/local-stack/run.sh", "--check-currency"]);
  const currencyLine = captureLine(currencyOut, "baseline-currency:", "the currency gate");
  runGate(runner, repoRoot, "node", ["scripts/baseline-content-drift-check.mjs", "--self-test"]);
  const driftOut = runGate(runner, repoRoot, "node", ["scripts/baseline-content-drift-check.mjs"]);
  const driftFindingsLine = captureLine(driftOut, "baseline-content-drift: findings", "the content-drift gate");
  const driftComparedLine = captureLine(driftOut, "baseline-content-drift: functions compared", "the content-drift gate");

  const oldVersion = readFileSync(join(repoRoot, "VERSION"), "utf8").replace(/\n$/, "");
  const newVersion = nextVersion(oldVersion);
  const m = {
    ...measured,
    runId: String(measured.run_id),
    merge: measured.merge,
    date,
    oldSha,
    newSha: measured.dump_sha256,
    oldShapes,
    shapes: measured.shapes,
    oldVersion,
    newVersion,
    newlyCarried,
    currencyLine,
    driftFindingsLine,
    driftComparedLine,
  };

  writeFileSync(join(repoRoot, "VERSION"), newVersion); // no trailing newline (RESEARCH F7)
  const pkgPath = join(repoRoot, "package.json");
  writeFileSync(pkgPath, bumpPackageJson(readFileSync(pkgPath, "utf8"), oldVersion, newVersion));
  const clPath = join(repoRoot, "CHANGELOG.md");
  const changelog = insertChangelogEntry(readFileSync(clPath, "utf8"), composeChangelogEntry(m));
  writeFileSync(clPath, changelog);
  const mdPath = join(repoRoot, BASELINE_MD_REL);
  writeFileSync(
    mdPath,
    rewriteBaselineMd(readFileSync(mdPath, "utf8"), {
      date,
      cliVersion: measured.cli_version,
      runId: m.runId,
      sha: m.newSha,
      shapes: m.shapes,
    }),
  );
  const vd = versionDefects({
    baseVersion: oldVersion,
    headVersion: readFileSync(join(repoRoot, "VERSION"), "utf8"),
    packageVersion: JSON.parse(readFileSync(pkgPath, "utf8")).version,
    changelog,
  });
  if (vd.length > 0) throw new Error(`the composed tree would fail version-gate: ${vd.map((d) => d.kind).join(", ")}`);

  runGate(runner, repoRoot, "node", ["scripts/check-baseline-staleness.mjs"]);

  // D-17: exactly the six paths, by explicit path — never `-A` or `.`.
  // `supabase link` writes supabase/.temp/* on the runner; that is never staged.
  git(repoRoot, ["add", "--", ...STAGED_PATHS]);
  const staged = git(repoRoot, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
  if (staged.join("\n") !== [...STAGED_PATHS].sort().join("\n")) {
    throw new Error(`the staged set is not exactly the six paths (staged ${staged.length}); refusing to commit`);
  }

  const tmp = mkdtempSync(join(tmpdir(), "baseline-redump-msg-"));
  try {
    const msgFile = join(tmp, "commit-message.txt");
    writeFileSync(msgFile, composeCommitMessage(m));
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: BOT_NAME,
      GIT_AUTHOR_EMAIL: BOT_EMAIL,
      GIT_COMMITTER_NAME: BOT_NAME,
      GIT_COMMITTER_EMAIL: BOT_EMAIL,
    };
    git(
      repoRoot,
      ["-c", `user.name=${BOT_NAME}`, "-c", `user.email=${BOT_EMAIL}`, "-c", "commit.gpgsign=false", "commit", "-q", "-F", msgFile],
      { env },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "pr-title.txt"), composePrTitle(m) + "\n");
  console.log(
    `baseline-redump compose: VERSION ${oldVersion} -> ${newVersion} sha256=${short(oldSha)}… -> ${short(m.newSha)}… ` +
      `newly-carried=${newlyCarried.length} staged=${staged.length}`,
  );
  emit("committed", "true");
  return { committed: true, staged, measured: m };
}

// ── self-test ─────────────────────────────────────────────────────────────────

/**
 * How many `ok()` calls `selfTest()` is declared to run. ⛔ Raise it only
 * together with the arm that adds one; lowering it to make a run green is
 * deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 91;
/**
 * How many MORE `ok()` calls `--self-test --with-gitleaks` runs: the real-binary
 * arms the `redump-dump` job runs (D-18, D-21). Same rule as above.
 */
export const EXPECTED_GITLEAKS_ASSERTIONS = 7;

function selfTest({ withGitleaks = false } = {}) {
  let pass = true;
  let asserted = 0;
  const ok = (cond, msg) => {
    asserted += 1;
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    if (!cond) pass = false;
    return cond;
  };
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  /** True only when `fn` throws AND the message names the expected refusal; a stray throw is not a refusal. */
  const refuses = (fn, re) => {
    try {
      fn();
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };
  /**
   * Run `fn` with console.log/console.error captured, and render a throw the way
   * `main` does (`::error::baseline-redump: …`), so an arm can assert on EVERYTHING
   * a run would put in the public Actions log. `threw` is the Error or null.
   */
  const capture = (fn) => {
    const lines = [];
    const [log, err] = [console.log, console.error];
    console.log = (...a) => lines.push(a.join(" "));
    console.error = (...a) => lines.push(a.join(" "));
    let threw = null;
    try {
      fn();
    } catch (e) {
      threw = e;
      lines.push(`::error::baseline-redump: ${e.message}`);
    } finally {
      console.log = log;
      console.error = err;
    }
    return { threw, text: lines.join("\n") };
  };

  /**
   * A fake gitleaks runner that counts its calls. Plain `--self-test` needs no
   * binary (vitest in CI and the write job have none), so every `gateDump` arm
   * gets one of these unless it is a real-binary arm under `--with-gitleaks`.
   */
  const fakeGitleaks = (result) => {
    const f = () => {
      f.calls += 1;
      return result;
    };
    f.calls = 0;
    return f;
  };
  const cleanGl = () => fakeGitleaks({ rc: 0, reportText: "[]", version: "self-test-fake" });
  /** The runner for the happy-path and no-op arms: the real binary under --with-gitleaks. */
  const gl = () => (withGitleaks ? realGitleaks : cleanGl());
  /** A JWT-shaped value joined at runtime; this file never carries one (RESEARCH F13). */
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwtValue = [b64({ alg: "HS256", typ: "JWT" }), b64({ iss: "self-test", role: "fixture" }), randomBytes(24).toString("base64url")].join(".");

  if (withGitleaks) {
    // A missing or wrong binary fails LOUD before any arm runs; it never skips.
    try {
      probeGitleaksVersion();
    } catch (e) {
      console.error(`=== SELF-TEST FAILED: ${e.message} ===`);
      return 1;
    }
  }

  console.log("=== SELF-TEST 1/4: pure functions");
  const docGrep = /grep -anE '([^']+)' supabase\/schema\/baseline\.sql/.exec(readFileSync(join(REPO_ROOT, BASELINE_MD_REL), "utf8"));
  ok(
    Boolean(docGrep) && docGrep[1] === SECRET_SCAN_PATTERN,
    "SECRET_SCAN_PATTERN is byte-equal to the grep -anE argument in BASELINE.md `## Regenerating`",
  );
  /**
   * The writer contract (D-15, D-16): `{text, defects}`, where a refusal is a named
   * defect and never a silent no-op. A writer that throws, or returns a bare
   * string, does not honour the contract, and `defects` comes back null so every
   * arm below reads it as a FAIL rather than crashing the self-test.
   */
  const w = (fn) => {
    try {
      const r = fn();
      return r && typeof r === "object" && Array.isArray(r.defects) ? r : { text: null, defects: null };
    } catch {
      return { text: null, defects: null };
    }
  };
  const hasDefect = (r, kind, re = /./) => Array.isArray(r.defects) && r.defects.some((d) => d.kind === kind && re.test(d.detail));
  const isClean = (r) => Array.isArray(r.defects) && r.defects.length === 0 && typeof r.text === "string";

  console.log("=== SELF-TEST 1b/4: every writer produces exactly its edit or refuses by name");
  const v1 = w(() => nextVersion("0.93.0.3"));
  const v2 = w(() => nextVersion("1.2.3.9"));
  ok(isClean(v1) && v1.text === "0.93.0.4" && isClean(v2) && v2.text === "1.2.3.10", "nextVersion bumps the 4th field, returning {text, defects}");
  ok(
    ["0.93.0", "0.93.0.3.1", "v0.93.0.3", "0.93.0.x", "0.96.0.1\n"].every((bad) => {
      const r = w(() => nextVersion(bad));
      return r.text === null && hasDefect(r, "version-shape");
    }),
    "nextVersion refuses 0.93.0, 0.93.0.3.1, v0.93.0.3, 0.93.0.x and a trailing newline as 'version-shape'",
  );
  const twoPkg = w(() => bumpPackageJson('{"version": "1.0.0.0", "x": {"version": "1.0.0.0"}}', "1.0.0.0", "1.0.0.1"));
  ok(twoPkg.text === null && hasDefect(twoPkg, "package-version-count", /\b2\b/), "bumpPackageJson refuses 2 '\"version\"' occurrences, naming the count");
  const zeroPkg = w(() => bumpPackageJson('{"version": "9.9.9.9"}', "1.0.0.0", "1.0.0.1"));
  ok(zeroPkg.text === null && hasDefect(zeroPkg, "package-version-count", /\b0\b/), "bumpPackageJson refuses 0 occurrences, naming the count");
  const nestedPkg = w(() => bumpPackageJson('{"a": {"version": "1.0.0.0"}, "version": "9.9.9.9"}', "1.0.0.0", "1.0.0.1"));
  ok(
    nestedPkg.text === null && hasDefect(nestedPkg, "package-version-readback"),
    "bumpPackageJson refuses when the one replaced occurrence is not the top-level version (the JSON read-back differs)",
  );
  const badJson = w(() => bumpPackageJson('{"version": "1.0.0.0",}', "1.0.0.0", "1.0.0.1"));
  ok(badJson.text === null && hasDefect(badJson, "package-json-unparseable"), "bumpPackageJson refuses a result that is not JSON");

  // `scripts/check-version-bump.mjs` exports DEFECTS, but importing it runs its main.
  const jv = (args) => {
    try {
      return judgeVersionBump(args);
    } catch {
      return null;
    }
  };
  const vbase = { baseVersion: "1.0.0.0", headVersion: "1.0.0.1", packageVersion: "1.0.0.1", changelog: "## [1.0.0.1] - x" };
  const kinds = (d) => (Array.isArray(d) ? d.map((x) => x.kind).join(",") : "not-a-list");
  ok(kinds(jv(vbase)) === "", "judgeVersionBump: a well-formed bump has no defect");
  ok(
    kinds(jv({ ...vbase, headVersion: "1.0.0.0", packageVersion: "1.0.0.0" })) === "version-not-bumped",
    "judgeVersionBump: VERSION equal to the base is 'version-not-bumped' (check-version-bump.mjs DEFECTS[0])",
  );
  ok(
    kinds(jv({ ...vbase, packageVersion: "1.0.0.0" })) === "version-package-mismatch",
    "judgeVersionBump: VERSION and package.json differing is 'version-package-mismatch' (DEFECTS[1])",
  );
  ok(
    kinds(jv({ ...vbase, changelog: "## [1.0.0.0] - old" })) === "changelog-missing-entry",
    "judgeVersionBump: a moved VERSION with no CHANGELOG heading is 'changelog-missing-entry' (DEFECTS[2])",
  );

  const sampleMForWriters = {
    oldVersion: "1.2.3.4", date: "2026-02-03", runId: "7", merge: "c".repeat(40), cliVersion: "2.98.2",
    oldSha: "a".repeat(64), newSha: "b".repeat(64), newlyCarried: ["20260101000000_a.sql"],
    oldShapes: { tables: 1, policies: 2, function_statements: 3, distinct_functions: 3, data_statements: 0 },
    shapes: { tables: 1, policies: 2, function_statements: 3, distinct_functions: 3, data_statements: 0 },
    currencyLine: "baseline-currency: carried=1 replay=0 marker-sha=match defects=0",
    driftComparedLine: "baseline-content-drift: functions compared 3 — MATCH 3, DRIFT 0",
    driftFindingsLine: "baseline-content-drift: findings 0",
  };
  const entryFor = (v) => composeChangelogEntry({ ...sampleMForWriters, newVersion: v });
  const clFixture = "# Changelog\n\n## [1.2.3.4] - 2026-01-01 — prior\n\n### Notes\n- prior\n";
  const ins = w(() => insertChangelogEntry(clFixture, entryFor("1.2.3.5")));
  ok(
    isClean(ins) && /\n## \[([^\]]+)\]/.exec(ins.text)?.[1] === "1.2.3.5" && ins.text.endsWith("## [1.2.3.4] - 2026-01-01 — prior\n\n### Notes\n- prior\n"),
    "insertChangelogEntry puts the new heading FIRST and leaves the prior entry byte-unchanged",
  );
  const dupCl = w(() => insertChangelogEntry(clFixture, entryFor("1.2.3.4")));
  ok(dupCl.text === null && hasDefect(dupCl, "changelog-duplicate-heading", /1\.2\.3\.4/), "insertChangelogEntry refuses a '## [<new>]' heading that already exists");
  const noTitle = w(() => insertChangelogEntry(clFixture.replace("# Changelog", "# Log"), entryFor("1.2.3.5")));
  ok(noTitle.text === null && hasDefect(noTitle, "changelog-no-title"), "insertChangelogEntry refuses a file without the '# Changelog' title");
  const noEntry = w(() => insertChangelogEntry("# Changelog\n\nnothing yet\n", entryFor("1.2.3.5")));
  ok(noEntry.text === null && hasDefect(noEntry, "changelog-no-entry-heading"), "insertChangelogEntry refuses a file with no '\\n## [' heading");

  // The scoping fixture (T-164.9.5-33): the capture table, then a NESTED
  // `### Regenerated` and a later `## ` section that carry EXTRA `| Shape |` and
  // prefix-form `| sha256 |` rows. File-wide that is 3 Shape and 3 sha256 rows.
  const fxSha = "1".repeat(64);
  const fxNewSha = "2".repeat(64);
  const fxExtra = ["| Shape | 9 tables — historical |", "| sha256 | `aaaaaaaa…` → `bbbbbbbb…` |"];
  const fxLater = ["| Shape | 8 tables — a later section |", "| sha256 | `cccccccc…` → `dddddddd…` |"];
  const mdFixture = [
    "# fixture", "", "## Provenance", "", "| | |", "|---|---|", "| Taken | 2026-01-01 |", "| Source | fixture |",
    "| Supabase CLI | 0.0.1 |", `| sha256 | \`${fxSha}\` |`, "| Shape | 0 tables |", "", "Prose under the table.", "",
    "### Regenerated 2026-01-01 — historical", "", "| | |", "|---|---|", ...fxExtra, "",
    "## Later", "", ...fxLater, "",
  ].join("\n");
  const fxSection = "### Regenerated 2026-02-03 — automated re-dump after Supabase Migrate run 7\n\nFixture provenance sentence.\n";
  const fxValues = {
    date: "2026-02-03", cliVersion: "2.98.2", runId: "7", sha: fxNewSha,
    shapes: { tables: 5, policies: 6, function_statements: 7, distinct_functions: 7, data_statements: 0 }, section: fxSection,
  };
  const scoped = w(() => rewriteBaselineMd(mdFixture, fxValues));
  const scopedLines = isClean(scoped) ? scoped.text.split("\n") : [];
  const newHead = scopedLines.indexOf("### Regenerated 2026-02-03 — automated re-dump after Supabase Migrate run 7");
  ok(
    isClean(scoped) && [...fxExtra, ...fxLater].every((l) => scopedLines.includes(l)) &&
      newHead !== -1 && newHead < scopedLines.indexOf("### Regenerated 2026-01-01 — historical") &&
      provenanceSpan(scopedLines)[1] === newHead &&
      scoped.text.includes(`| sha256 | \`${fxNewSha}\` |`) && !scoped.text.includes(`\`${fxSha}\``),
    "rewriteBaselineMd rewrites the capture rows only, leaves the nested and later EXTRA rows byte-unchanged, and inserts the section as the new end of the span",
  );
  const dupShape = w(() => rewriteBaselineMd(mdFixture.replace("| Shape | 0 tables |", "| Shape | 0 tables |\n| Shape | 0 tables again |"), fxValues));
  ok(
    dupShape.text === null && hasDefect(dupShape, "capture-row-count", /Shape.*\b2\b/),
    "rewriteBaselineMd refuses a DUPLICATE '| Shape |' row inside the table, naming the row and the count 2 (calibration)",
  );
  const noTaken = w(() => rewriteBaselineMd(mdFixture.replace("| Taken | 2026-01-01 |\n", ""), fxValues));
  ok(noTaken.text === null && hasDefect(noTaken, "capture-row-count", /Taken.*\b0\b/), "rewriteBaselineMd refuses a capture row that matches 0 times, naming the row and the count 0");
  const noProv = w(() => rewriteBaselineMd(mdFixture.replace("## Provenance", "## Origin"), fxValues));
  ok(noProv.text === null && hasDefect(noProv, "provenance-missing"), "rewriteBaselineMd refuses a file with no '## Provenance' heading");
  const noRegen = w(() => rewriteBaselineMd(mdFixture.replace("### Regenerated 2026-01-01 — historical", "### Earlier capture"), fxValues));
  ok(noRegen.text === null && hasDefect(noRegen, "regenerated-missing"), "rewriteBaselineMd refuses a file with no '### Regenerated' heading to insert above");

  // The REAL committed files, read-only (nothing below writes to REPO_ROOT). These
  // run wherever the self-test runs, so a hand edit that breaks the span is caught.
  const realMd = readFileSync(join(REPO_ROOT, BASELINE_MD_REL), "utf8");
  const realSynth = { ...fxValues, sha: "3".repeat(64) };
  const realRw = w(() => rewriteBaselineMd(realMd, realSynth));
  const realShaRows = isClean(realRw) ? realRw.text.match(RECORDED_SHA_RE_ALL) ?? [] : [];
  const captureRowRe = /^\|\s*(Taken|Supabase CLI|sha256|Shape)\s*\|/;
  const realSpan = provenanceSpan(realMd.split("\n")) ?? [0, 0];
  const keptInOrder = (() => {
    if (!isClean(realRw)) return false;
    const outLines = realRw.text.split("\n");
    let j = 0;
    return realMd.split("\n").every((line, i) => {
      if (i >= realSpan[0] && i < realSpan[1] && captureRowRe.test(line)) return true; // one of the four rewritten rows
      while (j < outLines.length && outLines[j] !== line) j += 1;
      if (j === outLines.length) return false;
      j += 1;
      return true;
    });
  })();
  ok(
    isClean(realRw) && realShaRows.length === 1 && realShaRows[0].includes(realSynth.sha) && keptInOrder,
    "[real BASELINE.md, read-only] no defect, exactly ONE RECORDED_SHA_RE_ALL row and it is the new sha, every other original line kept in order",
  );
  const realVersion = readFileSync(join(REPO_ROOT, "VERSION"), "utf8");
  const realNext = w(() => nextVersion(realVersion));
  const realCl = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  const realIns = isClean(realNext) && !realCl.includes(`\n## [${realNext.text}]`) ? w(() => insertChangelogEntry(realCl, entryFor(realNext.text))) : { defects: null };
  ok(
    isClean(realIns) && /\n## \[([^\]]+)\]/.exec(realIns.text)?.[1] === realNext.text,
    "[real CHANGELOG.md, read-only] the next version is absent, and inserting its entry has no defect and puts it first",
  );
  const realPkg = isClean(realNext)
    ? w(() => bumpPackageJson(readFileSync(join(REPO_ROOT, "package.json"), "utf8"), realVersion, realNext.text))
    : { defects: null };
  ok(
    isClean(realPkg) && JSON.parse(realPkg.text).version === realNext.text,
    "[real package.json + VERSION, read-only] the bump has no defect and reads back as the next version",
  );
  const shapesFixture = [
    'CREATE TABLE IF NOT EXISTS "public"."a" (',
    '  x int); CREATE TABLE "not"."anchored" (',
    'CREATE POLICY "p" ON "public"."a";',
    'CREATE OR REPLACE FUNCTION "public"."f"() RETURNS int;',
    'CREATE FUNCTION "public"."f"(int) RETURNS int;',
    'CREATE OR REPLACE FUNCTION "public"."g"() RETURNS int;',
    "INSERT INTO t VALUES (1);",
    "",
  ].join("\n");
  const sh = countShapes(shapesFixture);
  ok(
    sh.tables === 1 && sh.policies === 1 && sh.function_statements === 3 && sh.distinct_functions === 2 && sh.data_statements === 1,
    `countShapes counts line-anchored statements only (got ${JSON.stringify(sh)})`,
  );
  ok(
    buildMarker({ headerLines: ["# h1", "#"], sha: "a".repeat(64), basenames: ["20260102000000_b.sql", "20260101000000_a.sql"] }) ===
      `# h1\n#\nbaseline-sha256: ${"a".repeat(64)}\n20260101000000_a.sql\n20260102000000_b.sql\n`,
    "buildMarker keeps header order, then the sha line, then byte-sorted basenames, newline-terminated",
  );
  ok(
    MIGRATION_BASENAME_STRICT_RE.test("20260101000000_a_b.sql") && !MIGRATION_BASENAME_STRICT_RE.test("2026_a.sql") &&
      !MIGRATION_BASENAME_STRICT_RE.test("20260101000000_A.sql"),
    "MIGRATION_BASENAME_STRICT_RE takes exactly 14 digits and lower snake case",
  );
  ok(STAGED_PATHS.join(",") === [...STAGED_PATHS].sort().join(",") && STAGED_PATHS.length === 6, "STAGED_PATHS is the six paths, sorted");
  const guardRe = new RegExp(`\\[(${["skip", "ci"].join(" ")}|${["ci", "skip"].join(" ")}|${["no", "ci"].join(" ")}|${["skip", "actions"].join(" ")}|${["actions", "skip"].join(" ")})\\]|${["skip", "checks"].join("-")}\\s*:\\s*true`, "i");
  const sampleM = {
    newVersion: "1.2.3.5", oldVersion: "1.2.3.4", date: "2026-01-02", runId: "123", merge: "c".repeat(40),
    oldSha: "a".repeat(64), newSha: "b".repeat(64), newlyCarried: ["20260101000000_a.sql"],
    shapes: { tables: 1, policies: 2, function_statements: 3, distinct_functions: 3, data_statements: 0 },
  };
  ok(
    ![composeChangelogEntry(sampleM), composeCommitMessage(sampleM), composePrTitle(sampleM)].some((t) => guardRe.test(t)),
    "the fixed templates carry no CI skip token (D-14)",
  );

  ok(judgeGitleaksReport({ rc: 0, reportText: "[]" }).verdict === "clean", "judgeGitleaksReport: exit 0 with an empty array is the one clean");
  const oneFinding = judgeGitleaksReport({ rc: 1, reportText: JSON.stringify([{ RuleID: "jwt", StartLine: 2, Secret: "REDACTED", Match: "REDACTED" }]) });
  ok(
    oneFinding.verdict === "refuse" && JSON.stringify(oneFinding.findings) === JSON.stringify([{ rule: "jwt", line: 2 }]),
    "judgeGitleaksReport: exit 1 with a finding refuses, keeping RuleID and StartLine only",
  );
  ok(
    judgeGitleaksReport({ rc: 0, reportText: JSON.stringify([{ RuleID: "jwt", StartLine: 2 }]) }).verdict === "refuse",
    "judgeGitleaksReport: exit 0 WITH a finding refuses (a disagreement is never clean)",
  );
  ok(
    [
      { rc: 2, reportText: "[]" }, { rc: null, reportText: "[]" }, { rc: 0, reportText: "" },
      { rc: 0, reportText: "{}" }, { rc: 1, reportText: "[]" },
    ].every((r) => judgeGitleaksReport(r).verdict === "measure_fail"),
    "judgeGitleaksReport: any other exit, no report, a non-array, or exit 1 with no finding is MEASURE_FAIL",
  );
  const argv = gitleaksArgv("/t/dump.sql", "/r/report.json");
  const pairAt = (flag, value) => argv.indexOf(flag) !== -1 && argv[argv.indexOf(flag) + 1] === value;
  ok(
    argv[0] === "dir" && argv[1] === "/t/dump.sql" && pairAt("--config", ".gitleaks.toml") && argv.includes("--redact") &&
      argv.includes("--ignore-gitleaks-allow") && pairAt("--report-format", "json") && pairAt("--report-path", "/r/report.json"),
    "gitleaksArgv: dir <target>, an explicit --config .gitleaks.toml, --redact, --ignore-gitleaks-allow, a JSON report",
  );

  console.log("=== SELF-TEST 2/4: --gate-dump in a scratch repo (the MERGE tree, never the working tree)");
  const realDump = readFileSync(join(REPO_ROOT, BASELINE_SQL_REL)); // read-only: never written back
  const dir = mkdtempSync(join(tmpdir(), "baseline-redump-selftest-"));
  const g = (args, opts = {}) =>
    execFileSync(
      "git",
      ["-c", "user.name=self-test", "-c", "user.email=self-test@invalid", "-c", "commit.gpgsign=false", ...args],
      { cwd: opts.cwd ?? join(dir, "repo"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const repo = join(dir, "repo");
  try {
    mkdirSync(join(repo, "supabase/schema"), { recursive: true });
    mkdirSync(join(repo, "supabase/migrations"), { recursive: true });
    const M1 = "20260101000000_first.sql";
    const M2 = "20260102000000_second.sql";
    const M3 = "20260103000000_uncommitted.sql";
    const fixtureSha = sha256(realDump);
    const regeneratedRows = "| Shape | 1 tables — unchanged |\n| sha256 | `aaaaaaaa…` → `bbbbbbbb…` |\n";
    const secondSectionRows = "| Shape | 2 tables, an unrelated table |\n";
    const baselineMd = [
      "# `baseline.sql` — fixture",
      "",
      "## Provenance",
      "",
      "| | |",
      "|---|---|",
      "| Taken | 2026-01-01 |",
      "| Source | fixture |",
      "| Supabase CLI | 0.0.1 |",
      `| sha256 | \`${fixtureSha}\` |`,
      "| Shape | 0 tables |",
      "",
      "### Regenerated 2026-01-01 — fixture",
      "",
      "| | |",
      "|---|---|",
      regeneratedRows,
      "## Another section",
      "",
      secondSectionRows,
    ].join("\n");
    writeFileSync(join(repo, "VERSION"), "1.2.3.4");
    writeFileSync(join(repo, "package.json"), '{\n  "name": "fixture",\n  "version": "1.2.3.4"\n}\n');
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [1.2.3.4] - 2026-01-01 — prior\n\n### Notes\n- prior\n");
    writeFileSync(join(repo, BASELINE_MD_REL), baselineMd);
    writeFileSync(join(repo, BASELINE_SQL_REL), realDump);
    // The real config, so a real-binary arm resolves `--config .gitleaks.toml` here too.
    writeFileSync(join(repo, ".gitleaks.toml"), readFileSync(join(REPO_ROOT, ".gitleaks.toml")));
    writeFileSync(join(repo, "supabase/migrations", M1), "SELECT 1;\n");
    writeFileSync(join(repo, "supabase/migrations", M2), "SELECT 2;\n");
    writeFileSync(
      join(repo, MARKER_REL),
      buildMarker({ headerLines: ["# fixture marker", "#", "# second header line"], sha: fixtureSha, basenames: [M1, M2] }),
    );
    g(["init", "-q"], { cwd: repo });
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "fixture"]);
    // D-09 failing direction: a migration present in the working tree but NOT in the merge.
    writeFileSync(join(repo, "supabase/migrations", M3), "SELECT 3;\n");
    const base = g(["rev-parse", "HEAD"]).trim();

    const outputs = [];
    const emit = (k, v) => outputs.push(`${k}=${v}`);

    const same = gateDump({
      repoRoot: repo, dump: join(repo, BASELINE_SQL_REL), merge: base, runId: "1", cliVersion: "2.98.2",
      out: join(dir, "art0"), emit, gitleaks: gl(),
    });
    ok(
      same.changed === false && outputs.join(",") === "changed=false" && throws(() => readFileSync(join(dir, "art0/baseline.sql"))),
      "the committed dump is a D-10 no-op: changed=false and no out file written",
    );

    const dumpPath = join(dir, "dump.sql");
    writeFileSync(dumpPath, Buffer.concat([realDump, Buffer.from("\n")]));
    const newSha = sha256(readFileSync(dumpPath));
    outputs.length = 0;
    const gd = gateDump({ repoRoot: repo, dump: dumpPath, merge: base, runId: "4242", cliVersion: "2.98.2", out: join(dir, "art"), emit, gitleaks: gl() });
    ok(gd.changed === true && outputs.join(",") === "changed=true", "a changed dump emits changed=true");
    const art = readFileSync(join(dir, "art/baseline-carried-migrations.txt"), "utf8");
    ok(markerBasenames(art).join(",") === [M1, M2].join(","), "the marker lists exactly the two committed basenames");
    ok(!art.includes(M3), "an UNCOMMITTED migration in the working tree is absent from the marker (D-09)");
    ok(
      art.split("\n").filter((l) => l.startsWith("baseline-sha256:")).join() === `baseline-sha256: ${newSha}` &&
        art.startsWith("# fixture marker\n#\n# second header line\n"),
      "the marker's single sha line is the dump's sha256, below the preserved header lines",
    );
    const mj = JSON.parse(readFileSync(join(dir, "art/measured.json"), "utf8"));
    ok(
      mj.schema === 1 && mj.dump_sha256 === newSha && mj.run_id === "4242" && mj.merge === base && mj.carried_count === 2 &&
        mj.shapes.tables > 0 && mj.shapes.data_statements === 0,
      "measured.json carries the schema-1 measured values",
    );
    ok(
      throws(() => gateDump({ repoRoot: repo, dump: dumpPath, merge: "d".repeat(40), runId: "1", cliVersion: "2.98.2", out: join(dir, "x"), emit, gitleaks: cleanGl() })),
      "a --merge that names no commit in this repository is refused (the real not-HEAD arm is in 4b/4)",
    );

    console.log("=== SELF-TEST 2b/4: every section-C refusal fires on a red fixture built at runtime");
    // ⛔ Every secret-shaped value below is JOINED FROM FRAGMENTS at runtime, so this
    // file never carries a DSN-, host-, ref- or JWT-shaped literal (RESEARCH F13);
    // `ci.yml`'s secret-scan scans the push-to-main range. The macOS home prefix is
    // built from char codes for the same reason (check-planning-hygiene Rule 2).
    const dumpText = realDump.toString("latin1");
    if (!dumpText.endsWith("\n")) throw new Error("self-test premise: the committed dump ends with a newline");
    const appendedLine = dumpText.split("\n").length; // 1-based number of a line appended after the last "\n"
    const withLine = (line) => Buffer.concat([realDump, Buffer.from(line + "\n", "latin1")]);
    let redN = 0;
    const redGate = (bytes, gitleaks = cleanGl()) => {
      redN += 1;
      const p = join(dir, `red-${redN}.sql`);
      const outDir = join(dir, `red-out-${redN}`);
      if (bytes !== null) writeFileSync(p, bytes);
      outputs.length = 0;
      const r = capture(() =>
        gateDump({ repoRoot: repo, dump: p, merge: base, runId: "1", cliVersion: "2.98.2", out: outDir, emit, gitleaks }),
      );
      return { ...r, wroteNothing: !existsSync(outDir) && outputs.length === 0 };
    };
    const secretClasses = [
      ["a DSN scheme", ["postgres", "ql", ":/", "/self-test", ":x", "@db", ".example.invalid/postgres"].join("")],
      ["a Supabase host", ["@db.fixture", ".supa", "base", ".co"].join("")],
      ["a 20-letter ref subdomain", ["q".repeat(20), ".supa", "base"].join("")],
      ["the psql connect meta-command", ["\\", "con", "nect", " fixture"].join("")],
      ["ALTER DATABASE", ["ALTER", " DATA", "BASE", " fixture SET x = 1;"].join("")],
      ["a JWT-shaped token", jwtValue],
    ];
    for (const [label, value] of secretClasses) {
      const r = redGate(withLine(`-- ${value}`));
      ok(
        r.threw !== null && r.text.includes(`baseline-redump secret-scan: 1 hit(s) at line(s) ${appendedLine}`) &&
          !r.text.includes(value) && r.wroteNothing,
        `secret class '${label}' refuses at line ${appendedLine}, prints only the count and line, and writes nothing`,
      );
    }
    const homeRunner = ["/ho", "me/", "runner/work/x"].join("");
    const homeMac = String.fromCharCode(47, 85, 115, 101, 114, 115, 47) + "fixture/x";
    const integrityCases = [
      ["an appended NUL byte", Buffer.concat([realDump, Buffer.from([0])]), /integrity refused: .*1 NUL byte/, null],
      ["a second SET client_encoding", withLine("SET client_encoding = 'UTF8';"), /integrity refused: .*2 'SET client_encoding' line/, null],
      ["no SET client_encoding", Buffer.from(dumpText.replace(/^SET client_encoding[^\n]*\n/m, ""), "latin1"), /integrity refused: .*0 'SET client_encoding' line/, null],
      ["a runner home path", withLine(`-- ${homeRunner}`), new RegExp(`integrity refused: .*home-directory path.*line\\(s\\) ${appendedLine}`), homeRunner],
      ["a macOS home path", withLine(`-- ${homeMac}`), new RegExp(`integrity refused: .*home-directory path.*line\\(s\\) ${appendedLine}`), homeMac],
    ];
    for (const [label, bytes, re, secret] of integrityCases) {
      const r = redGate(bytes);
      ok(
        r.threw !== null && re.test(r.threw.message) && (secret === null || !r.text.includes(secret)) && r.wroteNothing,
        `integrity refuses ${label}${secret ? ", naming the line and never the path" : ""}`,
      );
    }
    const noTables = redGate(Buffer.from(dumpText.replace(/^CREATE TABLE/gm, "-- CREATE TABLE"), "latin1"));
    ok(
      noTables.threw !== null && /creates nothing is not a baseline/.test(noTables.threw.message) && noTables.wroteNothing,
      "a dump with zero CREATE TABLE lines refuses (a dump that creates nothing is not a baseline)",
    );
    const withData = redGate(withLine('INSERT INTO "public"."t" VALUES (1);'));
    ok(
      withData.threw !== null && /carrying data/.test(withData.threw.message) && withData.wroteNothing,
      "a dump with one INSERT INTO line refuses (a schema-only dump carrying data)",
    );
    // A merge tree holding a basename outside the strict 14-digit shape (D-27).
    const repo2 = join(dir, "repo2");
    g(["clone", "-q", repo, repo2], { cwd: dir });
    writeFileSync(join(repo2, "supabase/migrations/2026_bad.sql"), "SELECT 0;\n");
    g(["add", "--", "supabase/migrations/2026_bad.sql"], { cwd: repo2 });
    g(["commit", "-q", "-m", "bad basename"], { cwd: repo2 });
    outputs.length = 0;
    const badName = capture(() =>
      gateDump({
        repoRoot: repo2, dump: join(repo2, BASELINE_SQL_REL), merge: g(["rev-parse", "HEAD"], { cwd: repo2 }).trim(),
        runId: "1", cliVersion: "2.98.2", out: join(dir, "bad-out"), emit, gitleaks: cleanGl(),
      }),
    );
    // Position 3: `git ls-tree` lists in byte order, and `_` (0x5f) sorts after every digit.
    ok(
      badName.threw !== null && /1 migration basename\(s\) at the merge \(position\(s\) 3\)/.test(badName.threw.message) &&
        !badName.text.includes("2026_bad") && !existsSync(join(dir, "bad-out")),
      "a merge tree holding supabase/migrations/2026_bad.sql refuses by count and position, never echoing the name",
    );
    const corpus = git(REPO_ROOT, ["ls-tree", "--name-only", "HEAD", MIGRATIONS_REL]).split("\n").filter((p) => p.endsWith(".sql"));
    ok(
      corpus.length > 0 && corpus.every((p) => MIGRATION_BASENAME_STRICT_RE.test(p.replace(/^.*\//, ""))),
      `every committed migration basename (${corpus.length}) passes the strict rule`,
    );
    ok(
      mj.secret_scan_hits === 0 && JSON.stringify(mj.integrity) === JSON.stringify({ nul: 0, client_encoding: 1, home_path: 0 }),
      "measured.json records secret_scan_hits 0 and integrity {nul 0, client_encoding 1, home_path 0}",
    );
    const cleanIntegrity = judgeIntegrity(realDump);
    ok(
      judgeSecretScan(realDump).length === 0 && cleanIntegrity.defects.length === 0 && cleanIntegrity.client_encoding === 1 &&
        judgeShapeCounts(countShapes(realDump.toString("utf8"))).length === 0,
      "the committed dump passes the pure secret-scan, integrity and shape judges (the green fixture)",
    );

    console.log("=== SELF-TEST 2c/4: the gitleaks gate inside --gate-dump (fake runner; the real binary is --with-gitleaks)");
    const missingGl = cleanGl();
    const missing = redGate(null, missingGl);
    ok(
      missing.threw !== null && /does not exist/.test(missing.threw.message) && missingGl.calls === 0 && missing.wroteNothing,
      "a MISSING dump is refused before gitleaks is spawned (gitleaks exits 0 on a missing target)",
    );
    const emptyGl = cleanGl();
    const empty = redGate(Buffer.alloc(0), emptyGl);
    ok(
      empty.threw !== null && /EMPTY/.test(empty.threw.message) && emptyGl.calls === 0 && empty.wroteNothing,
      "an EMPTY dump is refused before gitleaks is spawned (gitleaks exits 0 on an empty target)",
    );
    const fakeSecret = ["fake", "-secret-", "value"].join("");
    const finding = JSON.stringify([{ RuleID: "jwt", StartLine: 7, Secret: fakeSecret, Match: fakeSecret }]);
    const found = redGate(realDump, fakeGitleaks({ rc: 1, reportText: finding, version: "self-test-fake" }));
    ok(
      found.threw !== null && /gitleaks refused/.test(found.threw.message) && found.text.includes("baseline-redump gitleaks: 1 finding(s)") &&
        found.text.includes("RuleID=jwt line=7") && !found.text.includes(fakeSecret) && found.wroteNothing,
      "a gitleaks finding refuses, printing RuleID and line only, never the Secret/Match field",
    );
    const firstGl = fakeGitleaks({ rc: 1, reportText: finding, version: "self-test-fake" });
    const first = redGate(withLine(`-- ${jwtValue}`), firstGl);
    ok(
      first.threw !== null && /gitleaks refused/.test(first.threw.message) && firstGl.calls === 1 && !first.text.includes("secret-scan:"),
      "gitleaks runs BEFORE the five-class scan (D-26 order: target assertion, gitleaks, then the scan)",
    );
    const brokenGl = fakeGitleaks({ rc: 2, reportText: "", version: "self-test-fake" });
    const broken = redGate(realDump, brokenGl);
    ok(
      broken.threw !== null && /MEASURE_FAIL/.test(broken.threw.message) && broken.wroteNothing,
      "a gitleaks run that could not complete (exit 2, no report) is MEASURE_FAIL and refuses",
    );
    const noRunner = capture(() =>
      gateDump({ repoRoot: repo, dump: join(repo, BASELINE_SQL_REL), merge: base, runId: "1", cliVersion: "2.98.2", out: join(dir, "nr"), emit }),
    );
    ok(noRunner.threw !== null && /gitleaks runner/.test(noRunner.threw.message), "a gateDump call with no gitleaks runner refuses, never skips the gate");
    ok(
      mj.gitleaks === "clean" && mj.gitleaks_version === (withGitleaks ? GITLEAKS_VERSION : "self-test-fake"),
      "measured.json records gitleaks 'clean' and the version the runner reported",
    );
    const aDump = join(dir, "target.sql");
    writeFileSync(aDump, "x\n");
    ok(!throws(() => assertScanTarget(aDump)), "assertScanTarget accepts a non-empty regular file");
    ok(refuses(() => assertScanTarget(join(dir, "absent.sql")), /does not exist/), "assertScanTarget refuses a missing path");
    writeFileSync(join(dir, "zero.sql"), "");
    ok(refuses(() => assertScanTarget(join(dir, "zero.sql")), /EMPTY/), "assertScanTarget refuses a zero-byte file");
    ok(refuses(() => assertScanTarget(dir), /not a regular file/), "assertScanTarget refuses a directory");
    if (withGitleaks) {
      const realFirst = redGate(withLine(`-- ${jwtValue}`), realGitleaks);
      ok(
        realFirst.threw !== null && realFirst.text.includes("baseline-redump gitleaks: 1 finding(s)") && realFirst.text.includes("RuleID=jwt") &&
          !realFirst.text.includes("secret-scan:") && !realFirst.text.includes(jwtValue) && realFirst.wroteNothing,
        "[real gitleaks] gateDump refuses a JWT-bearing dump at the gitleaks gate, printing RuleID only, writing nothing",
      );
    }

    console.log("=== SELF-TEST 3/4: --compose in the same scratch repo, with the child gates injected");
    const calls = [];
    const fakeRunner = (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      if (args.includes("--check-currency")) return { status: 0, stdout: "baseline-currency: carried=2 replay=0 marker-sha=match defects=0\n", stderr: "" };
      if (args[0] === "scripts/baseline-content-drift-check.mjs" && args.length === 1) {
        return {
          status: 0,
          stdout:
            "baseline-content-drift: functions compared 1 — MATCH 1, DRIFT 0\nbaseline-content-drift: findings 0\nbaseline-content-drift: SCOPE — long line\n",
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    let stagedBeforeCommit = null;
    outputs.length = 0;
    const cp = compose({ repoRoot: repo, inDir: join(dir, "art"), out: join(dir, "pr"), runner: fakeRunner, emit, date: "2026-02-03" });
    stagedBeforeCommit = cp.staged;
    ok(cp.committed === true && outputs.join(",") === "committed=true", "compose emits committed=true");
    ok(stagedBeforeCommit.join(",") === STAGED_PATHS.join(","), "the cached set before commit equals STAGED_PATHS (D-17)");
    ok(
      g(["diff", "--name-only", base, "HEAD"]).split("\n").filter(Boolean).sort().join(",") === STAGED_PATHS.join(","),
      "the bot commit touches exactly the six paths",
    );
    ok(g(["status", "--porcelain", "--", "supabase/migrations"]).trim() === `?? supabase/migrations/${M3}`, "the uncommitted migration was never staged");
    const version = readFileSync(join(repo, "VERSION"), "utf8");
    ok(version === "1.2.3.5", "VERSION is bumped in its 4th digit, with no trailing newline");
    ok(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version === version, "package.json's version equals VERSION");
    const cl = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
    ok(
      /\n## \[([^\]]+)\]/.exec(cl)?.[1] === "1.2.3.5" && cl.includes(`\`${newSha.slice(0, 8)}…\``) && cl.includes("run `4242`"),
      "CHANGELOG's first entry is the new version and carries the run id and the new sha prefix",
    );
    const md = readFileSync(join(repo, BASELINE_MD_REL), "utf8");
    const shaRows = md.match(RECORDED_SHA_RE_ALL) ?? [];
    ok(shaRows.length === 1 && shaRows[0].includes(newSha), "BASELINE.md carries exactly ONE full-sha row, and it is the new sha");
    ok(
      md.includes(`\n### Regenerated 2026-01-01 — fixture\n\n| | |\n|---|---|\n${regeneratedRows}\n## Another section\n\n${secondSectionRows}`) &&
        md.includes("| Source | fixture |"),
      "rows under the fixture's `### Regenerated` and the next `## ` section are byte-unchanged",
    );
    ok(
      md.includes("| Taken | 2026-02-03 |") && md.includes("| Shape | " + shapeProse(mj.shapes) + " |"),
      "the capture table's Taken and Shape rows carry the composed date and measured shapes",
    );
    ok(g(["log", "-1", "--format=%an|%ae|%cn|%ce"]).trim() === `${BOT_NAME}|${BOT_EMAIL}|${BOT_NAME}|${BOT_EMAIL}`, "author and committer are the bot");
    ok(
      calls.join(" ; ") ===
        "bash scripts/local-stack/run.sh --check-currency ; node scripts/baseline-content-drift-check.mjs --self-test ; " +
          "node scripts/baseline-content-drift-check.mjs ; node scripts/check-baseline-staleness.mjs",
      "the three offline gates ran, in order, as child processes",
    );

    console.log("=== SELF-TEST 4/4: the second D-10 check and a red gate");
    outputs.length = 0;
    const again = compose({ repoRoot: repo, inDir: join(dir, "art"), out: join(dir, "pr2"), runner: fakeRunner, emit, date: "2026-02-03" });
    ok(again.committed === false && outputs.join(",") === "committed=false", "composing the already-committed pair is a no-op: committed=false");
    writeFileSync(dumpPath, Buffer.concat([realDump, Buffer.from("\n\n")]));
    const head2 = g(["rev-parse", "HEAD"]).trim();
    gateDump({ repoRoot: repo, dump: dumpPath, merge: head2, runId: "5", cliVersion: "2.98.2", out: join(dir, "art2"), emit, gitleaks: cleanGl() });
    const redRunner = (cmd, args) => (args.includes("--check-currency") ? { status: 1, stdout: "", stderr: "" } : fakeRunner(cmd, args));
    ok(
      throws(() => compose({ repoRoot: repo, inDir: join(dir, "art2"), out: join(dir, "pr3"), runner: redRunner, emit, date: "2026-02-03" })) &&
        g(["rev-parse", "HEAD"]).trim() === head2,
      "a red child gate refuses and no commit is made",
    );
    // A writer defect inside --compose: a CHANGELOG that already carries the next
    // version's heading. Run in a CLONE, because section 4b needs HEAD to stay head2.
    const repo3 = join(dir, "repo3");
    g(["clone", "-q", repo, repo3], { cwd: dir });
    writeFileSync(join(repo3, "CHANGELOG.md"), readFileSync(join(repo3, "CHANGELOG.md"), "utf8").replace("\n## [", "\n## [1.2.3.6] - 2026-02-02 — a collision\n\n## ["));
    g(["commit", "-q", "-am", "a colliding CHANGELOG heading"], { cwd: repo3 });
    const head3pre = g(["rev-parse", "HEAD"], { cwd: repo3 }).trim();
    const collided = capture(() =>
      compose({ repoRoot: repo3, inDir: join(dir, "art2"), out: join(dir, "pr4"), runner: fakeRunner, emit, date: "2026-02-03" }),
    );
    ok(
      collided.threw !== null && /^::error::.*changelog-duplicate-heading/m.test(collided.text) &&
        g(["diff", "--cached", "--name-only"], { cwd: repo3 }).trim() === "" &&
        g(["status", "--porcelain", "--", "VERSION", "package.json", "CHANGELOG.md", BASELINE_MD_REL], { cwd: repo3 }).trim() === "" &&
        g(["rev-parse", "HEAD"], { cwd: repo3 }).trim() === head3pre && !existsSync(join(dir, "pr4")),
      "a writer defect in --compose prints ::error:: with its kind and refuses before VERSION, package.json, CHANGELOG or BASELINE.md is written or anything is staged",
    );

    console.log("=== SELF-TEST 4b/4: the MERGE-tree marker, the argument validators and D-10 idempotency");
    // HEAD is now the bot commit, so `base` is a REAL commit that is not HEAD. With
    // a format-valid but absent sha the arm above would refuse even without the
    // equality check (`git show` fails); a real older commit refuses ONLY on it.
    const notHead = capture(() =>
      gateDump({ repoRoot: repo, dump: join(dir, "dump.sql"), merge: base, runId: "1", cliVersion: "2.98.2", out: join(dir, "nh"), emit, gitleaks: cleanGl() }),
    );
    ok(
      notHead.threw !== null && /--merge/.test(notHead.threw.message) && /MERGE tree/.test(notHead.threw.message) &&
        !notHead.text.includes(base.slice(0, 7)) && !notHead.text.includes(head2.slice(0, 7)) && !existsSync(join(dir, "nh")),
      "a --merge that is a real commit but not HEAD refuses, naming --merge and the rule, echoing neither sha",
    );
    const argCases = [
      ["--merge", { merge: "zz-rejected-merge-value" }, /--merge must be/],
      ["--run-id", { runId: "12a-rejected-run-value" }, /--run-id must be/],
      ["--cli-version", { cliVersion: "2.98.2-rejected-cli-value" }, /--cli-version must be/],
    ];
    for (const [flag, bad, re] of argCases) {
      const value = Object.values(bad)[0];
      const r = capture(() =>
        gateDump({ repoRoot: repo, dump: dumpPath, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "arg"), emit, gitleaks: cleanGl(), ...bad }),
      );
      ok(r.threw !== null && re.test(r.threw.message) && !r.text.includes(value), `a malformed ${flag} refuses by name without echoing the value`);
    }
    // Mirror of `check-baseline-currency.mjs` `SHA_LINE_RE` (not exported there; this
    // plan does not edit that file).
    const SHA_LINE_RE = /^baseline-sha256:[ \t]*(\S*)[ \t]*$/;
    const committedMarkerNow = g(["show", `HEAD:${MARKER_REL}`]);
    const shaLines = art.split("\n").filter((l) => SHA_LINE_RE.test(l));
    ok(
      markerHeaderLines(art).join("\n") === markerHeaderLines(committedMarkerNow).join("\n") &&
        shaLines.length === 1 && SHA_LINE_RE.exec(shaLines[0])[1] === newSha,
      "the regenerated marker's # header lines are byte-identical to the committed marker's, and its one sha line (SHA_LINE_RE) is the dump's sha256",
    );
    const committedDump = join(dir, "committed.sql");
    writeFileSync(committedDump, g(["show", `HEAD:${BASELINE_SQL_REL}`], { encoding: "buffer" }));
    outputs.length = 0;
    const noop = capture(() =>
      gateDump({ repoRoot: repo, dump: committedDump, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "noop"), emit, gitleaks: cleanGl() }),
    );
    ok(
      noop.threw === null && /^::notice::.*no PR$/m.test(noop.text) && outputs.join(",") === "changed=false" && !existsSync(join(dir, "noop")),
      "a dump and marker byte-identical to HEAD's committed pair: changed=false, a ::notice::, and no out dir at all",
    );
    // $GITHUB_OUTPUT: exactly one `changed=` line per run when set; nothing when unset.
    const ghOut = join(dir, "github-output.txt");
    const savedGh = process.env.GITHUB_OUTPUT;
    let ghLines;
    let ghLinesAfterUnset;
    try {
      process.env.GITHUB_OUTPUT = ghOut;
      capture(() =>
        gateDump({ repoRoot: repo, dump: committedDump, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "gh1"), emit: emitToGithubOutput, gitleaks: cleanGl() }),
      );
      ghLines = readFileSync(ghOut, "utf8").split("\n").filter((l) => l.startsWith("changed="));
      delete process.env.GITHUB_OUTPUT;
      capture(() =>
        gateDump({ repoRoot: repo, dump: committedDump, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "gh2"), emit: emitToGithubOutput, gitleaks: cleanGl() }),
      );
      ghLinesAfterUnset = readFileSync(ghOut, "utf8").split("\n").filter((l) => l.startsWith("changed="));
    } finally {
      if (savedGh === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = savedGh;
    }
    ok(
      ghLines.join(",") === "changed=false" && ghLinesAfterUnset.join(",") === "changed=false",
      "$GITHUB_OUTPUT receives exactly one changed= line when set, and nothing when unset",
    );
    // The committed dump UNCHANGED, but a NEW migration committed at the merge: the
    // marker differs, so this is a change (D-09 + D-10).
    g(["add", "--", `supabase/migrations/${M3}`]);
    g(["commit", "-q", "-m", "a new migration at the merge"]);
    const head3 = g(["rev-parse", "HEAD"]).trim();
    outputs.length = 0;
    const newMig = capture(() =>
      gateDump({ repoRoot: repo, dump: committedDump, merge: head3, runId: "1", cliVersion: "2.98.2", out: join(dir, "art3"), emit, gitleaks: cleanGl() }),
    );
    ok(
      newMig.threw === null && outputs.join(",") === "changed=true" &&
        markerBasenames(readFileSync(join(dir, "art3/baseline-carried-migrations.txt"), "utf8")).includes(M3),
      "an unchanged dump with a NEW committed migration at the merge is changed=true, and the marker carries it",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (withGitleaks) {
    console.log("=== SELF-TEST 5/5 (--with-gitleaks): the real binary");
    const gdir = mkdtempSync(join(tmpdir(), "baseline-redump-gitleaks-selftest-"));
    try {
      let spawned = 0;
      const counted = (a) => {
        spawned += 1;
        return realGitleaks(a);
      };
      ok(probeGitleaksVersion() === GITLEAKS_VERSION, `[real gitleaks] 'gitleaks version' is the pinned ${GITLEAKS_VERSION}`);
      const clean = capture(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: join(REPO_ROOT, BASELINE_SQL_REL) }));
      ok(clean.threw === null && clean.text.includes("baseline-redump gitleaks: 0 finding(s)"), "[real gitleaks] the committed dump is clean");
      const jwtFile = join(gdir, "jwt.sql");
      writeFileSync(jwtFile, `SET client_encoding = 'UTF8';\n-- ${jwtValue}\n`);
      const hit = capture(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: jwtFile }));
      ok(
        hit.threw !== null && hit.text.includes("RuleID=jwt line=2") && !hit.text.includes(jwtValue),
        "[real gitleaks] a runtime JWT-shaped fixture refuses, printing RuleID and line only",
      );
      const allowFile = join(gdir, "allow.sql");
      writeFileSync(allowFile, `SET client_encoding = 'UTF8';\n-- ${jwtValue} -- ${["gitleaks", "allow"].join(":")}\n`);
      const allowed = capture(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: allowFile }));
      ok(
        allowed.threw !== null && allowed.text.includes("RuleID=jwt line=2") && !allowed.text.includes(jwtValue),
        "[real gitleaks] the same fixture with an inline allow comment STILL refuses (--ignore-gitleaks-allow)",
      );
      const before = spawned;
      ok(
        refuses(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: join(gdir, "absent.sql") }), /does not exist/) &&
          spawned === before,
        "[real gitleaks] a MISSING target is refused before gitleaks is spawned (it would exit 0, a false clean)",
      );
      writeFileSync(join(gdir, "empty.sql"), "");
      ok(
        refuses(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: join(gdir, "empty.sql") }), /EMPTY/) &&
          spawned === before,
        "[real gitleaks] an EMPTY target is refused before gitleaks is spawned (it would exit 0, a false clean)",
      );
    } finally {
      rmSync(gdir, { recursive: true, force: true });
    }
  }

  console.log("");
  const expected = EXPECTED_ASSERTIONS + (withGitleaks ? EXPECTED_GITLEAKS_ASSERTIONS : 0);
  if (asserted !== expected) {
    console.error(
      `=== SELF-TEST FAILED: ${asserted} assertion(s) ran, but this self-test declares ` +
        `${expected}. An arm was deleted, skipped, or added without updating ` +
        `EXPECTED_ASSERTIONS or EXPECTED_GITLEAKS_ASSERTIONS. A shrinking self-test that still says PASSED is the defect. ===`,
    );
    return 1;
  }
  if (!pass) {
    console.error(`=== SELF-TEST FAILED: ${asserted} assertion(s) run, at least one did not hold ===`);
    return 1;
  }
  console.log(`baseline-redump self-test OK: ${asserted} assertion(s)${withGitleaks ? " (with gitleaks)" : ""}`);
  return 0;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

/** Parse `--flag value` pairs against a whitelist; refuse unknown, repeated or missing flags. */
function parseFlags(argv, allowed) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!allowed.includes(k)) throw new Error(`unknown argument: ${k}`);
    if (k in out) throw new Error(`repeated argument: ${k}`);
    if (v === undefined || v.startsWith("--")) throw new Error(`argument ${k} needs a value`);
    out[k] = v;
  }
  const missing = allowed.filter((k) => !(k in out));
  if (missing.length > 0) throw new Error(`missing argument(s): ${missing.join(" ")}`);
  return out;
}

/** The repo root of the cwd; the modes must be run FROM it. */
function cwdRepoRoot() {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (realpathSync(top) !== realpathSync(process.cwd())) throw new Error("run this from the repository root");
  return top;
}

function main(argv) {
  try {
    if (argv.length === 1 && argv[0] === "--self-test") return selfTest();
    if (argv.length === 2 && argv[0] === "--self-test" && argv[1] === "--with-gitleaks") return selfTest({ withGitleaks: true });
    if (argv[0] === "--gate-dump") {
      const f = parseFlags(argv.slice(1), ["--dump", "--merge", "--run-id", "--cli-version", "--out"]);
      gateDump({
        repoRoot: cwdRepoRoot(),
        dump: resolve(f["--dump"]),
        merge: f["--merge"],
        runId: f["--run-id"],
        cliVersion: f["--cli-version"],
        out: resolve(f["--out"]),
        emit: emitToGithubOutput,
        gitleaks: realGitleaks,
      });
      return 0;
    }
    if (argv[0] === "--compose") {
      const f = parseFlags(argv.slice(1), ["--in", "--out"]);
      compose({
        repoRoot: cwdRepoRoot(),
        inDir: resolve(f["--in"]),
        out: resolve(f["--out"]),
        runner: realRunner,
        emit: emitToGithubOutput,
        date: new Date().toISOString().slice(0, 10),
      });
      return 0;
    }
    // ⛔ A typo'd flag must not silently fall through to a green run.
    console.error(
      `::error::unknown argument(s): ${argv.join(" ") || "(none)"} — this script takes --self-test [--with-gitleaks], ` +
        `--gate-dump --dump --merge --run-id --cli-version --out, or --compose --in --out`,
    );
    return 1;
  } catch (e) {
    console.error(`::error::baseline-redump: ${e.message}`);
    return 1;
  }
}

/**
 * Realpath-safe main-module guard — copied verbatim from
 * `scripts/check-baseline-staleness.mjs` (the `[VAC04-C2]` lesson), so the
 * wiring test can import the pure functions without running `main`.
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
