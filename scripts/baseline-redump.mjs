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
 *     node scripts/baseline-redump.mjs --self-test
 *     node scripts/baseline-redump.mjs --gate-dump --dump <file> --merge <40-hex> \
 *          --run-id <digits> --cli-version <x.y.z> --out <dir>
 *     node scripts/baseline-redump.mjs --compose --in <dir> --out <dir>
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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

// ── modes ─────────────────────────────────────────────────────────────────────

/**
 * --gate-dump. Run from the repo root of the MERGE checkout. Returns
 * `{changed, measured}`. Throws on any refusal; the caller maps a throw to
 * `::error::` + exit 1.
 */
export function gateDump({ repoRoot, dump, merge, runId, cliVersion, out, emit }) {
  if (!/^[0-9a-f]{40}$/.test(merge)) throw new Error("--merge must be a full 40-hex commit sha");
  if (!/^[0-9]+$/.test(runId)) throw new Error("--run-id must be digits only");
  if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) throw new Error("--cli-version must be X.Y.Z");
  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  if (head !== merge) {
    throw new Error(`--merge ${short(merge, 12)} is not this checkout's HEAD (${short(head, 12)}); the marker must come from the MERGE tree`);
  }

  const bytes = readFileSync(dump);
  if (bytes.length === 0) throw new Error("the dump is EMPTY (0 bytes); an empty file measures nothing");
  const dumpSha = sha256(bytes);
  const shapes = countShapes(bytes.toString("utf8"));

  // D-09: the MERGE tree, never the working tree — an uncommitted migration in
  // the checkout is not one PRODUCTION received.
  const listed = git(repoRoot, ["ls-tree", "--name-only", merge, MIGRATIONS_REL])
    .split("\n")
    .filter((p) => p.endsWith(".sql"))
    .map((p) => p.replace(/^.*\//, ""));
  const bad = listed.filter((b) => !MIGRATION_BASENAME_STRICT_RE.test(b));
  if (bad.length > 0) {
    throw new Error(`${bad.length} migration basename(s) at the merge do not match ${MIGRATION_BASENAME_STRICT_RE}; refusing to write them anywhere`);
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
export const EXPECTED_ASSERTIONS = 30;

function selfTest() {
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

  console.log("=== SELF-TEST 1/4: pure functions");
  const docGrep = /grep -anE '([^']+)' supabase\/schema\/baseline\.sql/.exec(readFileSync(join(REPO_ROOT, BASELINE_MD_REL), "utf8"));
  ok(
    Boolean(docGrep) && docGrep[1] === SECRET_SCAN_PATTERN,
    "SECRET_SCAN_PATTERN is byte-equal to the grep -anE argument in BASELINE.md `## Regenerating`",
  );
  ok(nextVersion("0.96.0.1") === "0.96.0.2" && nextVersion("1.2.3.9") === "1.2.3.10", "nextVersion bumps the 4th field");
  ok(throws(() => nextVersion("0.96.0")) && throws(() => nextVersion("0.96.0.1\n")), "nextVersion refuses a non-4-digit shape");
  ok(
    throws(() => bumpPackageJson('{"version": "1.0.0.0", "x": {"version": "1.0.0.0"}}', "1.0.0.0", "1.0.0.1")),
    "bumpPackageJson refuses an ambiguous (two-occurrence) version",
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
      out: join(dir, "art0"), emit,
    });
    ok(
      same.changed === false && outputs.join(",") === "changed=false" && throws(() => readFileSync(join(dir, "art0/baseline.sql"))),
      "the committed dump is a D-10 no-op: changed=false and no out file written",
    );

    const dumpPath = join(dir, "dump.sql");
    writeFileSync(dumpPath, Buffer.concat([realDump, Buffer.from("\n")]));
    const newSha = sha256(readFileSync(dumpPath));
    outputs.length = 0;
    const gd = gateDump({ repoRoot: repo, dump: dumpPath, merge: base, runId: "4242", cliVersion: "2.98.2", out: join(dir, "art"), emit });
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
      throws(() => gateDump({ repoRoot: repo, dump: dumpPath, merge: "d".repeat(40), runId: "1", cliVersion: "2.98.2", out: join(dir, "x"), emit })),
      "a --merge that is not HEAD is refused",
    );

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
    gateDump({ repoRoot: repo, dump: dumpPath, merge: head2, runId: "5", cliVersion: "2.98.2", out: join(dir, "art2"), emit });
    const redRunner = (cmd, args) => (args.includes("--check-currency") ? { status: 1, stdout: "", stderr: "" } : fakeRunner(cmd, args));
    ok(
      throws(() => compose({ repoRoot: repo, inDir: join(dir, "art2"), out: join(dir, "pr3"), runner: redRunner, emit, date: "2026-02-03" })) &&
        g(["rev-parse", "HEAD"]).trim() === head2,
      "a red child gate refuses and no commit is made",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
  console.log(`baseline-redump self-test OK: ${asserted} assertion(s)`);
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
      `::error::unknown argument(s): ${argv.join(" ") || "(none)"} — this script takes --self-test, ` +
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
