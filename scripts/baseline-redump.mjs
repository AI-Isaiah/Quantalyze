#!/usr/bin/env node
/**
 * BASELINE RE-DUMP automation (Phase 164.9.5 AUTOREDUMP) — the offline half of
 * the `redump-dump` / `redump-push` jobs in `.github/workflows/supabase-migrate.yml`.
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
 *   --compose-and-push  (write-token job, Phase 258) copy the gated pair onto a
 *                 checkout of `main`, run the real offline gates as child processes,
 *                 write VERSION, package.json, CHANGELOG.md and BASELINE.md, stage
 *                 EXACTLY the six paths by explicit path (D-17), commit as
 *                 github-actions[bot], then ONE plain push of HEAD to
 *                 refs/heads/main through PUSH_ARGV. The token reaches the push
 *                 child only (D-21 kept): takePushToken removes it from process.env
 *                 before anything is composed.
 *
 * ⛔ THIS REPOSITORY IS PUBLIC and the dump is a pg_dump of the production
 * catalogue. Nothing here prints a line of the dump, a DSN, a token or a project
 * ref (D-06). Every printed value is a sha prefix, a byte count, a shape count or
 * a gate's own summary line.
 *
 * ⛔ node builtins only. `redump-push` runs this with no `npm ci`, so the three
 * offline gates run as CHILD PROCESSES rather than being imported — with one
 * exception: `RECORDED_SHA_RE_ALL` is imported from check-baseline-staleness.mjs
 * (node builtins only itself, and its `main` is guarded by `invokedDirectly()`),
 * so this writer and CI's co-edit gate read the provenance row with ONE regex.
 * `scripts/check-version-bump.mjs` is NOT imported: it calls
 * `process.exit(main())` at module scope. Its three defects are MIRRORED in
 * `judgeVersionBump()` below instead.
 *
 * The frozen CLI (plan 04 wires exactly these; later plans add behaviour behind
 * them without renaming anything):
 *
 *     node scripts/baseline-redump.mjs --self-test [--with-gitleaks]
 *     node scripts/baseline-redump.mjs --gate-dump --dump <file> --merge <40-hex> \
 *          --run-id <digits> --cli-version <x.y.z> --out <dir>
 *     node scripts/baseline-redump.mjs --compose-and-push --in <dir>
 *
 * ⛔ CORRECTED 2026-11-27 (Phase 258): the write-token job opened ONE bot pull request on a fixed bot branch until this phase; it now pushes the bot commit straight to main (founder ruling, CONTEXT).
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
 * The secret scan, as a plain STRING byte-equal to the argument of the
 * `grep -anE '…'` line in `supabase/schema/BASELINE.md` `## Regenerating` (D-06).
 * A STRING, not a regex literal: a literal's `.source` escapes `/`, so it could
 * never compare equal to the ERE text the doc carries. The self-test asserts the
 * equality against the doc, so the prose and the command cannot drift apart.
 *
 * D-06's five classes, then WR-03's two:
 * - `sb_secret_…`, Supabase's current secret-key format, which is not a JWT.
 * - `password` as a word in any case (never `encrypted_password`, the committed
 *   dump's one hit), in a CREDENTIAL form only (WR-08):
 *   - a quoted string after it, past a space, `=` or `:=`, optionally as an
 *     `E'…'` literal: `OPTIONS (password '…')`, `password := '…'`,
 *     `PASSWORD '…'`. The quote is written as `[^ -&(-~]`, "any byte but
 *     printable ASCII other than the quote", because the doc's grep sits inside
 *     single quotes and cannot spell one. The byte after it must be printable
 *     ASCII other than a space or a quote, so an empty `''` and the UTF-8 bytes
 *     of an em-dash (house-style comment prose) are not a credential;
 *   - a JSON member, `"password": "…"`;
 *   - the libpq keyword form, `password=…` with no space (a connection string).
 *   - the same keyword with a quoted value as pg_dump writes it inside a SQL
 *     literal, `password=''…''`: `=`, two quote bytes, then a printable byte
 *     other than a space or a quote (WR-10). No space is allowed around `=`, so
 *     `RETURN password = '';` stays clear; the compact `password='';` IS a hit,
 *     the same accepted cost as the compact `password=crypt(…)` (R3-04).
 *   Ordinary SQL is NOT a hit: `WHERE password = x`, `password = ANY(…)`,
 *   `IF password = '' THEN`, a quoted column `"password" "text"`, or a literal
 *   that merely ends in the word.
 * Portable ERE only (no `\s`, `\b`, `(?:` or POSIX classes): the same text must
 * mean the same thing to JS `RegExp`, GNU grep and BSD grep.
 */
export const SECRET_SCAN_PATTERN = String.raw`postgres(ql)?://|@[a-z0-9.-]+\.supabase\.(co|com)|[a-z]{20}\.supabase|\\connect|ALTER DATABASE|eyJ[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{16,}|(^|[^_A-Za-z])[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]("? *(:=|=| ) *[Ee]?[^ -&(-~][!-&(-~]|"? *: *"[!#-~]|=[!-&(-~]|=[^ -&(-~]{2}[!-&(-~])`;
export const SECRET_SCAN_RE = new RegExp(SECRET_SCAN_PATTERN);

/**
 * STRICTER than `check-baseline-currency.mjs`'s `MIGRATION_BASENAME_RE`
 * (`^[0-9]+_…`): exactly fourteen timestamp digits. A basename is interpolated
 * into a commit message and a CHANGELOG entry here (D-27), so the
 * shape every real migration has (measured: all 278 at plan time) is the only
 * shape accepted — anything else is refused before it is written anywhere.
 */
export const MIGRATION_BASENAME_STRICT_RE = /^[0-9]{14}_[a-z0-9_]+\.sql$/;

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
 * SFH-03: the extension and schema NAMES a dump creates, from its
 * `CREATE EXTENSION` / `CREATE SCHEMA` lines (optionally `IF NOT EXISTS`, the name
 * optionally double-quoted). Names, not counts, so a refusal can say what vanished.
 */
export function schemaObjectNames(text) {
  const names = (re) => new Set([...String(text).matchAll(re)].map((m) => m[1]));
  return {
    extensions: names(/^CREATE EXTENSION (?:IF NOT EXISTS )?"?([^"\s;]+)"?/gm),
    schemas: names(/^CREATE SCHEMA (?:IF NOT EXISTS )?"?([^"\s;]+)"?/gm),
  };
}

/**
 * SFH-03: a completeness floor against the committed dump. A dump that exits 0 but
 * is truncated, or a CLI change that narrows what it dumps, loses `CREATE EXTENSION`
 * or `CREATE SCHEMA` lines, and no other gate reads them. Any extension or schema
 * the committed dump creates and the new one does not refuses, by name (a name that
 * is not plain identifier text is counted, never printed). A migration that really
 * drops one needs a hand re-dump through the `## Regenerating` procedure.
 * ⚠️ The schema half is forward-looking only: the committed dump has 0 `CREATE SCHEMA`
 * lines, so it covers nothing today. A truncated dump is a recorded limit (D-33).
 */
export function judgeCompleteness(committedText, newText) {
  const was = schemaObjectNames(committedText);
  const now = schemaObjectNames(newText);
  const defects = [];
  for (const kind of ["extensions", "schemas"]) {
    const lost = [...was[kind]].filter((n) => !now[kind].has(n)).sort();
    if (lost.length === 0) continue;
    const shown = lost.filter((n) => /^[A-Za-z0-9_.-]{1,63}$/.test(n));
    const hidden = lost.length - shown.length;
    defects.push(
      `${lost.length} ${kind === "extensions" ? "extension" : "schema"}(s) the committed dump creates are missing: ` +
        `${shown.join(", ")}${hidden > 0 ? `${shown.length > 0 ? ", " : ""}${hidden} with an unprintable name` : ""}`,
    );
  }
  return { was, now, defects };
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

/*
 * ── The writers (D-15, D-16) ──
 * Each returns `{text, defects}`: `defects` is a list of `{kind, detail}` whose
 * details carry counts, versions and row names only, and `text` is null whenever
 * a defect is present. A regex replace that matched nothing is the defect class
 * these exist to refuse: a writer that silently produced no edit would hand CI
 * a tree it rejects, or a BASELINE.md whose provenance row was never moved.
 */
const refused = (kind, detail) => ({ text: null, defects: [{ kind, detail }] });
const written = (text) => ({ text, defects: [] });

/** 4th-digit bump (D-15). Any other shape is refused, never guessed. */
export function nextVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  if (!m) return refused("version-shape", `VERSION '${String(v).slice(0, 40).replace(/\n/g, "\\n")}' is not a 4-digit X.Y.Z.B string`);
  return written(`${m[1]}.${m[2]}.${m[3]}.${Number(m[4]) + 1}`);
}

/**
 * A single regex replace of `"version": "<old>"`. It never re-serialises the file
 * (that would reformat it), and it re-parses the result to confirm the TOP-LEVEL
 * version reads back as `newV`. Never `npm version`, which rewrites the lockfile.
 */
export function bumpPackageJson(text, oldV, newV) {
  const esc = oldV.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"version": "${esc}"`, "g");
  const hits = (text.match(re) ?? []).length;
  if (hits !== 1) {
    return refused("package-version-count", `package.json carries ${hits} '"version": "${oldV}"' occurrence(s); exactly 1 is required`);
  }
  const out = text.replace(re, `"version": "${newV}"`);
  let back;
  try {
    back = JSON.parse(out).version;
  } catch {
    return refused("package-json-unparseable", "package.json is not JSON after the version replace");
  }
  if (back !== newV) return refused("package-version-readback", `package.json's top-level version reads back as '${back}', not '${newV}'`);
  return written(out);
}

/**
 * Insert the entry before the first `\n## [` after the `# Changelog` title, and
 * confirm afterwards that the new heading IS the first `## [` — the heading
 * `check-version-bump.mjs` and the release notes read.
 */
export function insertChangelogEntry(text, entry) {
  if (!text.startsWith("# Changelog")) return refused("changelog-no-title", "CHANGELOG.md does not start with the '# Changelog' title");
  const at = text.indexOf("\n## [");
  if (at === -1) return refused("changelog-no-entry-heading", "CHANGELOG.md carries no '## [' entry heading to insert before");
  const version = /^## \[([^\]]+)\]/.exec(entry.split("\n")[0])?.[1];
  if (!version) return refused("changelog-entry-heading", "the composed entry does not start with a '## [X.Y.Z.B]' heading");
  if (text.includes(`\n## [${version}]`)) {
    return refused("changelog-duplicate-heading", `CHANGELOG.md already carries a '## [${version}]' heading`);
  }
  const out = text.slice(0, at + 1) + entry.replace(/\n*$/, "\n\n") + text.slice(at + 1);
  const first = /\n## \[([^\]]+)\]/.exec(out)?.[1];
  if (first !== version) return refused("changelog-not-first", `the first '## [' heading after insertion is '${first}', not '${version}'`);
  return written(out);
}

/**
 * The `[start, end)` line range of the `## Provenance` capture table: from the
 * line after the `## Provenance` heading to the first following heading at ANY
 * level (`^#{1,6} `), or null when there is no `## Provenance` heading.
 * ⚠️ The first `### Regenerated` heading sits INSIDE `## Provenance`, and the
 * file carries four `| Shape |` and five `| sha256 |` rows file-wide (measured at
 * plan time) — stopping at the next `## ` would sweep in every regenerated
 * section's rows.
 */
export function provenanceSpan(lines) {
  const head = lines.findIndex((l) => /^## Provenance\s*$/.test(l));
  if (head === -1) return null;
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [head + 1, end];
}

const REGENERATED_HEADING_RE = /^### Regenerated /;

/**
 * Replace the four capture rows (`Taken`, `Supabase CLI`, `sha256` — the ONLY
 * full-64-hex row, `Shape`) inside `provenanceSpan` ONLY (D-16), then insert
 * `values.section` (composeRegeneratedSection) immediately above the FIRST
 * `### Regenerated` heading, which must be the heading that ends the span.
 *
 * ⛔ The count is exactly-once INSIDE the span, never file-wide. File-wide the
 * real file carries four `| Shape |` and five `| sha256 |` rows, and every bot
 * run adds one more of each under its own `### Regenerated`: a file-wide count
 * would pass a first run and refuse every run after it. A line outside the span
 * is never read for a match and never written.
 *
 * Refuses, by name, on: no `## Provenance`; any capture row found 0 or 2+ times
 * in the span; no `### Regenerated` heading; a span that does not end at it; and
 * an output whose provenance does not read back as ONE full-sha row equal to
 * `values.sha` with the span ending at the inserted heading (so the NEXT run's
 * count is scoped too).
 */
export function rewriteBaselineMd(text, values) {
  const lines = text.split("\n");
  const span = provenanceSpan(lines);
  if (span === null) return refused("provenance-missing", "BASELINE.md carries no '## Provenance' heading");
  const [start, end] = span;
  const rows = {
    Taken: `| Taken | ${values.date} |`,
    "Supabase CLI": `| Supabase CLI | ${values.cliVersion} (the \`redump-dump\` job, Supabase Migrate run \`${values.runId}\`) |`,
    sha256: `| sha256 | \`${values.sha}\` |`,
    Shape: `| Shape | ${shapeProse(values.shapes)} |`,
  };
  const defects = [];
  for (const [key, row] of Object.entries(rows)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^\\|\\s*${esc}\\s*\\|`);
    const hits = [];
    for (let i = start; i < end; i++) if (re.test(lines[i])) hits.push(i);
    if (hits.length !== 1) {
      defects.push({
        kind: "capture-row-count",
        detail: `the '## Provenance' capture table carries ${hits.length} '| ${key} |' row(s); exactly 1 is required`,
      });
    } else {
      lines[hits[0]] = row;
    }
  }
  const firstRegen = lines.findIndex((l, i) => i >= start && REGENERATED_HEADING_RE.test(l));
  if (firstRegen === -1) {
    defects.push({ kind: "regenerated-missing", detail: "BASELINE.md carries no '### Regenerated' heading under '## Provenance' to insert above" });
  } else if (firstRegen !== end) {
    defects.push({
      kind: "regenerated-not-span-end",
      detail: `the '## Provenance' span ends at line ${end + 1}, not at the first '### Regenerated' heading (line ${firstRegen + 1})`,
    });
  }
  if (defects.length > 0) return { text: null, defects };

  const section = String(values.section ?? "").replace(/\n*$/, "").split("\n");
  const out = [...lines.slice(0, end), ...section, "", ...lines.slice(end)];
  const outText = out.join("\n");
  const outSpan = provenanceSpan(out);
  if (outSpan === null || outSpan[1] !== end || !REGENERATED_HEADING_RE.test(out[end] ?? "")) {
    return refused("section-not-span-end", "the inserted section does not start with a '### Regenerated' heading that ends the '## Provenance' span");
  }
  // A `g` regex: `match` resets `lastIndex`; `test`/`exec` would carry it over.
  const shaRows = outText.match(RECORDED_SHA_RE_ALL) ?? [];
  if (shaRows.length !== 1 || !shaRows[0].includes(values.sha)) {
    return refused("sha-row-count", `the result carries ${shaRows.length} full-sha provenance row(s); exactly 1, equal to the new sha, is required`);
  }
  return written(outText);
}

function shapeProse(s) {
  return (
    `${s.tables} tables, ${s.policies} policies, ${s.function_statements} function statements ` +
    `(${s.distinct_functions} distinct names), **${s.data_statements} data statements**`
  );
}

const short = (sha, n = 8) => String(sha).slice(0, n);

/*
 * ── The composers (D-14, D-16) ──
 * Each takes the measured object `--compose` assembles (the run id, the merge,
 * the old and new sha256 and shapes, the newly carried basenames, the captured
 * gate lines) and nothing else: no composer reads a file or re-measures, so every
 * figure it writes is one a gate or a hash produced. The templates are fixed and
 * name none of the CI skip tokens, not even to deny one, and carry no
 * credential-shaped literal.
 */

/** Old → new for every counted shape but data statements, which the section gives its own row. */
function shapeDelta(o, n) {
  return (
    `tables ${o.tables} → ${n.tables}, policies ${o.policies} → ${n.policies}, ` +
    `function statements ${o.function_statements} → ${n.function_statements}, ` +
    `distinct function names ${o.distinct_functions} → ${n.distinct_functions}`
  );
}

/** A measured statement, never an omission, when the marker diff added nothing. */
const NONE_CARRIED = "none — the marker diff added no migration basename";

/**
 * The CHANGELOG entry (D-16), in this repo's vocabulary: `### Changed` for what
 * the six paths now say, `### Notes` for provenance and for the statement that the
 * bot does not write the "what it adds" judgment. The drift gate's `SCOPE —` line is never carried: only the two
 * captured lines (`functions compared …`, `findings …`) reach it.
 */
export function composeChangelogEntry(m) {
  const carried = m.newlyCarried.length === 0 ? NONE_CARRIED : m.newlyCarried.map((b) => `\`${b}\``).join(", ");
  return [
    `## [${m.newVersion}] - ${m.date} — BASELINE: automated re-dump after the PROD apply of ${short(m.merge)}`,
    "",
    "### Changed",
    `- \`supabase/schema/baseline.sql\` re-dumped from PRODUCTION by Supabase Migrate run \`${m.runId}\`, ` +
      `after the PROD apply of merge \`${short(m.merge)}\`: sha256 \`${short(m.oldSha)}…\` → \`${short(m.newSha)}…\`.`,
    `- Shape, old → new: ${shapeDelta(m.oldShapes, m.shapes)}, ` +
      `data statements ${m.oldShapes.data_statements} → ${m.shapes.data_statements}.`,
    `- Migrations the dump newly carries, from the marker diff: ${carried}.`,
    `- \`supabase/schema/BASELINE.md\` gets the new \`## Provenance\` capture rows and a dated \`### Regenerated ${m.date}\` ` +
      `section; \`baseline-carried-migrations.txt\` is regenerated from the merge tree; VERSION and package.json ` +
      `${m.oldVersion} → ${m.newVersion}.`,
    `- The gates on the composed tree, verbatim: \`${m.currencyLine}\`, \`${m.driftComparedLine}\`, \`${m.driftFindingsLine}\`.`,
    "",
    "### Notes",
    `- The dump was taken read-only by the \`redump-dump\` job after the \`apply\` job of Supabase Migrate run ` +
      `\`${m.runId}\` succeeded, ` +
      "and this entry was composed and pushed straight to `main` by the `redump-push` job. " +
      `Run \`${m.runId}\` is the provenance anchor.`,
    '- The "what it adds" judgment for each newly carried migration is a human one, so the bot does not write it. ' +
      "Every figure above is measured.",
  ].join("\n");
}

/**
 * The dated `### Regenerated` section `rewriteBaselineMd` inserts above the newest
 * one (D-16), shaped like the hand-written ones minus their "what it adds" column,
 * which is a human judgment. ⛔ sha256 stays in PREFIX form: a second full-64-hex
 * row would make `check-baseline-staleness.mjs` read an ambiguous provenance
 * table (IN-03).
 */
export function composeRegeneratedSection(m) {
  const carried = m.newlyCarried.length === 0 ? [`- ${NONE_CARRIED}`] : m.newlyCarried.map((b) => `- \`${b}\``);
  return [
    `### Regenerated ${m.date} — automated re-dump after Supabase Migrate run ${m.runId}`,
    "",
    `Taken read-only by the \`redump-dump\` job of Supabase Migrate run \`${m.runId}\`, after that run's \`apply\` job ` +
      `applied merge \`${short(m.merge)}\` to PRODUCTION, ` +
      "and composed and pushed straight to `main` by the `redump-push` job. Every value below is measured.",
    "",
    "**Which migrations the new dump now carries** — from the marker diff:",
    "",
    ...carried,
    "",
    "**MEASURED:**",
    "",
    "| | |",
    "|---|---|",
    `| Taken | ${m.date} |`,
    `| Supabase CLI | ${m.cliVersion} |`,
    `| Shape | ${shapeDelta(m.oldShapes, m.shapes)} |`,
    `| Data statements | ${m.oldShapes.data_statements} → ${m.shapes.data_statements} |`,
    `| sha256 | \`${short(m.oldSha)}…\` → \`${short(m.newSha)}…\` |`,
    `| Currency gate | \`${m.currencyLine}\` |`,
    `| Body drift | \`${m.driftComparedLine}\`; \`${m.driftFindingsLine}\` |`,
  ].join("\n");
}

export function composeCommitTitle(m) {
  return `chore(release): v${m.newVersion} — baseline re-dump after the PROD apply of ${short(m.merge)}`;
}

export function composeCommitMessage(m) {
  const carried = m.newlyCarried.length === 0 ? "(none)" : m.newlyCarried.join(", ");
  return [
    composeCommitTitle(m),
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
 * MIRROR of `scripts/check-version-bump.mjs` `judge()` and its `DEFECTS`
 * (`version-not-bumped`, `version-package-mismatch`, `changelog-missing-entry`),
 * by name and meaning, so the bot cannot compose a tree CI's `version-gate` would
 * reject (D-15). Mirrored, NOT imported: that module calls `process.exit(main())`
 * at module scope, so importing it would end this process. `judge()`'s
 * planning-only exemption is omitted because the bot's six paths are never under
 * `.planning/`. Change one and you must change the other.
 */
export function judgeVersionBump({ baseVersion, headVersion, packageVersion, changelog }) {
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

/*
 * ── The compose-side judges (D-09, D-21) ──
 * A child gate is judged by the CONTENT of its verdict line as well as its exit
 * code. A judge that finds no verdict line returns MEASURE_FAIL, never a pass:
 * a gate that printed nothing is not a green gate. Each returns
 * `{verdict: "pass" | "refuse" | "measure_fail", line, detail}`; `line` is the
 * verdict line (the gate's own summary, safe to print), null when absent.
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whitespace-delimited token, so `defects=0` never matches inside `defects=01`. */
const hasToken = (line, token) => new RegExp(`(^|\\s)${escapeRe(token)}(\\s|$)`).test(line);

/** `check-baseline-currency.mjs --replay-set` via `run.sh --check-currency`: one line, `marker-sha=match defects=0`. */
export function judgeCurrencyLine(stdout) {
  const hits = String(stdout).split(/\r?\n/).filter((l) => l.startsWith("baseline-currency:"));
  if (hits.length !== 1) {
    return { verdict: "measure_fail", line: null, detail: `the currency gate printed ${hits.length} 'baseline-currency:' line(s); exactly 1 is required` };
  }
  const [line] = hits;
  if (!hasToken(line, "marker-sha=match") || !hasToken(line, "defects=0")) {
    return { verdict: "refuse", line, detail: `the currency gate reads '${line}', not marker-sha=match defects=0` };
  }
  return { verdict: "pass", line, detail: "" };
}

/**
 * `baseline-content-drift-check.mjs` prints FIVE `baseline-content-drift:` lines
 * (chain files, functions compared, allowlisted rows, findings, and a SCOPE
 * prose line). Only the line matching this regex carries the verdict; the first
 * line, or any line merely mentioning findings, is not it.
 */
export const DRIFT_FINDINGS_RE = /^baseline-content-drift: findings (\d+)$/;

export function judgeDriftLine(stdout) {
  const hits = String(stdout).split(/\r?\n/).filter((l) => DRIFT_FINDINGS_RE.test(l));
  if (hits.length !== 1) {
    return {
      verdict: "measure_fail",
      line: null,
      detail: `the content-drift gate printed ${hits.length} line(s) matching ${DRIFT_FINDINGS_RE}; exactly 1 is required`,
    };
  }
  const [line] = hits;
  const n = Number(DRIFT_FINDINGS_RE.exec(line)[1]);
  if (n !== 0) {
    return {
      verdict: "refuse",
      line,
      detail:
        `the content-drift gate reports ${n} finding(s). Likely cause: main holds a migration that has not applied to PROD yet; ` +
        "the queued apply run will produce the right dump",
    };
  }
  return { verdict: "pass", line, detail: "" };
}

const HEX64_RE = /^[0-9a-f]{64}$/;
const isCount = (v) => Number.isInteger(v) && v >= 0;
/**
 * Schema 1 of `measured.json`, exactly the keys `gateDump` writes, each with the
 * rule it must meet. `merge` and `run_id` are the plan-02 validators; the scan
 * and integrity values are the only clean ones `gateDump` can record, so any
 * other value is a tampered or foreign artifact.
 */
const MEASURED_SCHEMA = {
  schema: (v) => v === 1,
  run_id: (v) => typeof v === "string" && /^[0-9]+$/.test(v),
  merge: (v) => typeof v === "string" && /^[0-9a-f]{40}$/.test(v),
  cli_version: (v) => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v),
  dump_sha256: (v) => typeof v === "string" && HEX64_RE.test(v),
  dump_bytes: (v) => Number.isInteger(v) && v > 0,
  "shapes.tables": (v) => Number.isInteger(v) && v > 0,
  "shapes.policies": isCount,
  "shapes.function_statements": isCount,
  "shapes.distinct_functions": isCount,
  "shapes.data_statements": (v) => v === 0,
  marker_sha256: (v) => typeof v === "string" && HEX64_RE.test(v),
  carried_count: isCount,
  gitleaks: (v) => v === "clean",
  gitleaks_version: (v) => typeof v === "string" && /^[0-9A-Za-z._-]{1,40}$/.test(v),
  secret_scan_hits: (v) => v === 0,
  "integrity.nul": (v) => v === 0,
  "integrity.client_encoding": (v) => v === 1,
  "integrity.home_path": (v) => v === 0,
};

/**
 * The write job's check of the artifact's `measured.json` (D-21): refuses a
 * partial (unparseable) file, a missing schema-1 key, or a value failing its
 * rule. Returns `{measured, defects}`; `measured` is null whenever a defect is
 * present. Details name the KEY, never the value: the value is artifact text.
 */
export function judgeMeasured(text) {
  let m;
  try {
    m = JSON.parse(String(text));
  } catch {
    return { measured: null, defects: [{ kind: "measured-unparseable", detail: "measured.json is not JSON (a partial or truncated artifact)" }] };
  }
  const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  if (!isObject(m)) return { measured: null, defects: [{ kind: "measured-unparseable", detail: "measured.json is not a JSON object" }] };
  const defects = [];
  for (const parent of ["shapes", "integrity"]) {
    if (!(parent in m)) defects.push({ kind: "measured-key", detail: `measured.json has no '${parent}' key` });
    else if (!isObject(m[parent])) defects.push({ kind: "measured-value", detail: `measured.json '${parent}' is not an object` });
  }
  for (const [path, valid] of Object.entries(MEASURED_SCHEMA)) {
    const [a, b] = path.split(".");
    const holder = b === undefined ? m : m[a];
    if (!isObject(holder)) continue; // the missing or malformed parent is already a defect
    const key = b ?? a;
    if (!(key in holder)) defects.push({ kind: "measured-key", detail: `measured.json has no '${path}' key` });
    else if (!valid(holder[key])) defects.push({ kind: "measured-value", detail: `measured.json '${path}' fails its schema-1 rule` });
  }
  return defects.length > 0 ? { measured: null, defects } : { measured: m, defects };
}

/** A staged path is printed only in a safe charset; anything else is named generically. */
const showPath = (p) => (/^[A-Za-z0-9._/-]{1,200}$/.test(String(p)) ? String(p) : "an unprintable path");

/**
 * D-17: the staged list must be exactly `STAGED_PATHS`, in any order. Returns a
 * list of `{kind, detail}`: `staged-duplicate`, `staged-extra` (for example
 * `supabase/.temp/project-ref`, which `supabase link` writes on the runner) and
 * `staged-missing`.
 */
export function judgeStagedSet(paths) {
  const defects = [];
  const seen = new Set();
  for (const p of paths) {
    if (seen.has(p)) defects.push({ kind: "staged-duplicate", detail: `'${showPath(p)}' is listed more than once` });
    seen.add(p);
  }
  for (const p of seen) {
    if (!STAGED_PATHS.includes(p)) defects.push({ kind: "staged-extra", detail: `'${showPath(p)}' is staged but is not one of the six paths` });
  }
  for (const p of STAGED_PATHS) {
    if (!seen.has(p)) defects.push({ kind: "staged-missing", detail: `'${p}' is one of the six paths but is not staged` });
  }
  return defects;
}

/**
 * D-14: the six CI skip tokens of CLAUDE.md "CI gate integrity" §1, which GitHub
 * honours ANYWHERE in a commit message and which a squash merge carries onto
 * `main`. Each is ASSEMBLED FROM FRAGMENTS so this file spells none of them.
 * Case-insensitive, and `\s*` around the trailer's colon (RESEARCH F11): stricter
 * than GitHub, which is the safe direction. Classes 1 to 5 are the bracketed
 * tokens, class 6 the trailer; a refusal reports the class index, never the text.
 */
const SKIP_TOKEN_CLASSES = [
  ["skip", "ci"],
  ["ci", "skip"],
  ["no", "ci"],
  ["skip", "actions"],
  ["actions", "skip"],
]
  .map(([a, b]) => new RegExp(`\\[${a} ${b}\\]`, "i"))
  .concat([new RegExp(`${["skip", "checks"].join("-")}\\s*:\\s*true`, "i")]);

/** The 1-based class indices of every skip token in `text`; empty when clean. Plan 08 re-runs this before `gh`. */
export function judgeSkipTokens(text) {
  const t = String(text);
  return SKIP_TOKEN_CLASSES.flatMap((re, i) => (re.test(t) ? [i + 1] : []));
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

// ── the one push, straight to main (Phase 258 REDUMPDIRECT) ───────────────────

/**
 * The ONE git invocation in this file that writes to the remote. D-25's principle is
 * kept (CONTEXT A6): a single hard-coded refspec, and nothing builds the remote or the
 * ref, which is now HEAD:refs/heads/main. The push is plain: no lease, no plus-prefixed
 * refspec, no force, mirror, all, tags, delete or prune flag. A refusal is answered by
 * re-composing onto the fresh main, never by forcing. The credential helper is cleared,
 * then delegated to `gh auth git-credential`, the form proven live by run 46036945243.
 * ⛔ Production code must not put the word for this operation inside quote characters
 * anywhere but the array below, and must not repeat the argv constant's spread outside
 * pushToMain: the wiring test counts both in the production region.
 */
export const PUSH_ARGV = Object.freeze([
  "-c",
  "credential.helper=",
  "-c",
  "credential.helper=!gh auth git-credential",
  "push",
  "origin",
  "HEAD:refs/heads/main",
]);

/**
 * The push credential leaves `process.env` before any child is spawned. `realRunner`
 * passes no env option, and `git()`, `anonGit` and compose's merge-base spawn all
 * inherit `process.env`, so this delete is what keeps compose and its gates from ever
 * seeing the token (CONTEXT: the job token is exposed to the push invocation ONLY).
 */
export function takePushToken(env) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "";
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return token;
}

/**
 * The only consumer of the token and the only spawn of the argv constant. git's
 * refusal text carries no secret and the token is never in argv, so the first 2000
 * characters of stderr are passed through for the log.
 */
function pushToMain({ repoRoot, token }) {
  const r = spawnSync("git", [...PUSH_ARGV], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.stderr) process.stderr.write(r.stderr.slice(0, 2000));
  return { status: r.error ? -1 : r.status };
}

/**
 * How many times --compose-and-push may attempt the plain push of HEAD to main, in total
 * (CONTEXT: bounded at three attempts). Only a refusal caused by a concurrent merge
 * counts toward a retry; any other refusal fails at once.
 */
export const MAX_PUSH_ATTEMPTS = 3;

/**
 * The tip of the remote's CURRENT main, fetched fresh (never a stale tracking ref) and
 * anonymously: anonGit clears the credential helper and the repository is public, so
 * this holds no token. Any failure is MEASURE_FAIL: whether main moved was not measured.
 */
function fetchMainTip({ repoRoot, remote }) {
  assertRemoteName(remote);
  const fetched = anonGit(repoRoot, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/main:refs/remotes/${remote}/main`]);
  if (fetched.status !== 0) {
    throw new Error(`MEASURE_FAIL: git fetch of main exit ${fetched.status}; whether main moved was not measured, so nothing more is pushed`);
  }
  const tip = anonGit(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/main^{commit}`]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(tip)) throw new Error("MEASURE_FAIL: main's fetched tip is unreadable");
  return tip;
}

// ── anonymous git and main's migration listing ───────────────────────────────

/** A remote NAME, never an option or a URL: it is the first positional of `git fetch`. */
const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function assertRemoteName(remote) {
  if (!REMOTE_NAME_RE.test(String(remote))) {
    throw new Error("--remote must be a plain git remote name (letters, digits, '.', '_', '-'; not an option or a URL)");
  }
}

/**
 * git with NO credential: the helper list is reset and the terminal prompt is off, so
 * this can never pick up a token or hang waiting for one. The repository is public,
 * so a fetch of `main` needs none. stderr is not passed through.
 */
function anonGit(repoRoot, args) {
  const r = spawnSync("git", ["-c", "credential.helper=", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { status: r.error ? -1 : r.status, stdout: r.stdout ?? "" };
}

/** The `.sql` basenames of one `git ls-tree --name-only <ref> supabase/migrations/` listing, in listing order. */
function migrationBasenames(lsTreeText) {
  return String(lsTreeText)
    .split("\n")
    .filter((p) => p.endsWith(".sql"))
    .map((p) => p.replace(/^.*\//, ""));
}

/**
 * SFH-01: the migration basenames on the remote's CURRENT `main`, fetched with
 * anonGit (no credential; the repository is public). Any failure is MEASURE_FAIL:
 * a comparison that could not run is never a match. No `--depth`: the fetch only
 * adds the commits between this checkout and `main`.
 */
function anonMainMigrationListing({ repoRoot, remote }) {
  assertRemoteName(remote);
  const track = `refs/remotes/${remote}/main`;
  const fetched = anonGit(repoRoot, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/main:${track}`]);
  if (fetched.status !== 0) {
    throw new Error(`MEASURE_FAIL: git fetch of main exit ${fetched.status}; main's migration listing was not measured, so no marker is written`);
  }
  const ls = anonGit(repoRoot, ["ls-tree", "--name-only", track, MIGRATIONS_REL]);
  if (ls.status !== 0) throw new Error(`MEASURE_FAIL: git ls-tree of main exit ${ls.status}; main's migration listing was not measured`);
  return migrationBasenames(ls.stdout);
}

/**
 * SFH-01 / WR-02 / D-31: the merge's migration set against current `main`'s. The
 * marker is built from the merge tree while the dump is taken from PROD NOW, so the
 * two agree only while `main` carries exactly the merge's migrations. Returns
 * `{ verdict, text }`: "equal" (text null), "behind" (main LACKS a migration the
 * merge carries, a refusal; it wins when both directions differ), or "ahead" (main
 * carries a migration the merge lacks). D-31: "ahead" is a skip, not a refusal. The
 * concurrency group holds the later merge's apply until this run ends, so PROD has
 * not applied it yet and this dump is correct but about to be superseded; that
 * later run re-dumps. Counts only: `main`'s basenames were never put through the
 * strict rule.
 */
export function judgeMainListing(mergeListing, mainListing) {
  const merge = new Set(mergeListing);
  const main = new Set(mainListing);
  const mainOnly = [...main].filter((b) => !merge.has(b)).length;
  const mergeOnly = [...merge].filter((b) => !main.has(b)).length;
  if (mergeOnly > 0) {
    return {
      verdict: "behind",
      text:
        `main lacks ${mergeOnly} migration(s) this merge carries: main no longer holds what PROD was given, so no marker from this merge ` +
        "is safe to write. Find out how main lost them before re-dispatching supabase-migrate.yml on main",
    };
  }
  if (mainOnly > 0) {
    return {
      verdict: "ahead",
      text:
        `main carries ${mainOnly} migration(s) this merge does not: a later migration merge landed after this run's apply, ` +
        "so this dump would be superseded and nothing is proposed (D-31). The later merge's own apply run re-dumps; " +
        "if none is queued, dispatch a fresh run: gh workflow run supabase-migrate.yml --ref main",
    };
  }
  return { verdict: "equal", text: null };
}

// ── modes ─────────────────────────────────────────────────────────────────────

/**
 * --gate-dump. Run from the repo root of the MERGE checkout. Returns
 * `{changed, measured}`. Throws on any refusal; the caller maps a throw to
 * `::error::` + exit 1.
 */
export function gateDump({
  repoRoot, dump, merge, runId, runAttempt, cliVersion, out, emit, gitleaks, remote = "origin", mainListing = anonMainMigrationListing,
}) {
  if (typeof gitleaks !== "function") throw new Error("gateDump was given no gitleaks runner; the gate is never skipped");
  if (!/^[0-9a-f]{40}$/.test(merge)) throw new Error("--merge must be a full 40-hex commit sha");
  if (!/^[0-9]+$/.test(runId)) throw new Error("--run-id must be digits only");
  if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) throw new Error("--cli-version must be X.Y.Z");
  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  // D-09. A refusal names the flag and the rule, never a value: argv is runner text.
  if (head !== merge) throw new Error("--merge is not this checkout's HEAD; the marker must come from the MERGE tree");
  // CR-03 / D-32: a re-run is NOT refused. "Re-run failed jobs" keeps the old run's
  // github.sha but dumps PROD as it is now, and the main-listing verdict below is
  // what guards that: a stale re-run lands on "ahead" (skipped, D-31) or on "equal"
  // (PROD holds exactly the merge's migrations, so the dump is valid). The attempt
  // is printed so a re-run's log says which one it was.
  const attemptShown = runAttempt === undefined || runAttempt === "" ? "unset" : /^[0-9]{1,6}$/.test(String(runAttempt)) ? runAttempt : "unreadable";
  console.log(`baseline-redump attempt: ${attemptShown} (the main-listing verdict decides a re-run)`);

  // Every section-C gate runs BEFORE the out dir is written, and on the D-10
  // no-op path too: a run that writes nothing still proves the dump is clean.
  // Order (D-26): the target assertion, gitleaks, then the five-class scan.
  // The one exception is the completeness floor, which runs after the
  // main-listing verdict, so a D-31 skip is decided first (R3-01).
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
  const listed = migrationBasenames(git(repoRoot, ["ls-tree", "--name-only", merge, MIGRATIONS_REL]));
  // D-27: refused by count and 1-based position, never by name — a basename
  // that fails the rule is exactly the text that must not reach a log.
  const badAt = listed.flatMap((b, i) => (MIGRATION_BASENAME_STRICT_RE.test(b) ? [] : [i + 1]));
  if (badAt.length > 0) {
    throw new Error(
      `${badAt.length} migration basename(s) at the merge (position(s) ${lineList(badAt)}) do not match ` +
        `${MIGRATION_BASENAME_STRICT_RE}; refusing to write them anywhere`,
    );
  }
  // SFH-01: refuse when main LACKS one of the merge's migrations. D-31: when main
  // is AHEAD, skip as the D-10 no-op does (changed=false, no out dir), so
  // `redump-push` skips and a superseded dump never turns main red.
  const mainJudged = judgeMainListing(listed, mainListing({ repoRoot, remote }));
  console.log(`baseline-redump main-listing: ${mainJudged.verdict === "equal" ? "equal to the merge's" : "differs from the merge's"}`);
  if (mainJudged.verdict === "behind") throw new Error(mainJudged.text);
  if (mainJudged.verdict === "ahead") {
    console.log(`::notice::baseline-redump: ${mainJudged.text}`);
    emit("changed", "false");
    return { changed: false, measured: null };
  }

  // SFH-03, after the main-listing verdict (R3-01, D-33): the completeness floor
  // judges only a dump whose main carries exactly the merge's migrations. A dump
  // whose main is ahead was skipped above, so a later migration that dropped an
  // extension cannot turn a superseded re-run into a false refusal.
  const committedDumpBytes = committedBytes(repoRoot, merge, BASELINE_SQL_REL);
  const complete = judgeCompleteness(committedDumpBytes.toString("utf8"), bytes.toString("utf8"));
  console.log(
    `baseline-redump completeness: extensions=${complete.now.extensions.size} (committed ${complete.was.extensions.size}) ` +
      `schemas=${complete.now.schemas.size} (committed ${complete.was.schemas.size})`,
  );
  if (complete.defects.length > 0) {
    throw new Error(`completeness refused: ${complete.defects.join("; ")}; a dump that lost them is truncated or narrowed, not a baseline`);
  }

  const committedMarker = committedBytes(repoRoot, merge, MARKER_REL).toString("utf8");
  const committedDumpSha = sha256(committedDumpBytes);
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
    // D-10: a no-op prints one notice. ⛔ CORRECTED 2026-11-27 (Phase 258): it also reported the bot PR's status until the bot branch was retired (CONTEXT A7).
    console.log("::notice::baseline-redump: dump and marker are byte-identical to the committed pair — nothing to commit");
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

/**
 * One `::error::` per writer, version-gate, measured or staged-set defect, naming
 * its kind and detail (counts, versions, keys, paths and row names only), then a
 * refusal. `after` states what the refusal left undone at its call site.
 */
function refuseWriterDefects(defects, after = "nothing was staged") {
  for (const d of defects) console.error(`::error::baseline-redump: ${d.kind}: ${d.detail}`);
  throw new Error(`refusing to compose: ${defects.length} defect(s) (${defects.map((d) => d.kind).join(", ")}); ${after}`);
}

/** The verdict line of a passing judge; anything else refuses, MEASURE_FAIL named as such. */
function passedLine(judged, gateName) {
  if (judged.verdict === "pass") return judged.line;
  const prefix = judged.verdict === "measure_fail" ? "MEASURE_FAIL: " : "";
  throw new Error(`${prefix}${gateName}: ${judged.detail}; refusing to compose`);
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
export function compose({ repoRoot, inDir, runner, emit, date }) {
  const judgedMeasured = judgeMeasured(readFileSync(join(inDir, "measured.json"), "utf8"));
  if (judgedMeasured.defects.length > 0) refuseWriterDefects(judgedMeasured.defects);
  const measured = judgedMeasured.measured;
  const newDump = readFileSync(join(inDir, "baseline.sql"));
  const newMarker = readFileSync(join(inDir, "baseline-carried-migrations.txt"), "utf8");
  if (sha256(newDump) !== measured.dump_sha256) throw new Error("the in-dir dump does not hash to measured.json's dump_sha256");
  if (sha256(Buffer.from(newMarker, "utf8")) !== measured.marker_sha256) {
    throw new Error("the in-dir marker does not hash to measured.json's marker_sha256");
  }

  // The compose-side re-scan (D-06, D-08, D-21), defence in depth: the credentialed
  // job scanned this dump, but the write job trusts no verdict it has not measured
  // itself. The node judges only — ⛔ no gitleaks binary and no `npm ci` here: this
  // job holds the write token, so it runs no third-party code (RESEARCH F10).
  const rescanHits = judgeSecretScan(newDump);
  const rescanIntegrity = judgeIntegrity(newDump);
  console.log(
    `baseline-redump re-scan: ${rescanHits.length} hit(s)${rescanHits.length > 0 ? ` at line(s) ${lineList(rescanHits)}` : ""}; ` +
      `integrity nul=${rescanIntegrity.nul} client_encoding=${rescanIntegrity.client_encoding} home_path=${rescanIntegrity.home_path}`,
  );
  if (rescanHits.length > 0) {
    throw new Error(
      `the compose-side re-scan found ${rescanHits.length} five-class hit(s) in the artifact dump that measured.json does not admit; ` +
        "the line numbers are above and the text is never printed",
    );
  }
  if (rescanIntegrity.defects.length > 0) {
    throw new Error(`the compose-side re-scan refused the artifact dump's integrity: ${rescanIntegrity.defects.join("; ")}`);
  }

  // Second D-10 check: main may have moved between the two jobs.
  const oldDumpBytes = committedBytes(repoRoot, "HEAD", BASELINE_SQL_REL);
  const oldMarker = committedBytes(repoRoot, "HEAD", MARKER_REL).toString("utf8");
  const oldSha = sha256(oldDumpBytes);
  if (oldSha === measured.dump_sha256 && oldMarker === newMarker) {
    console.log("::notice::baseline-redump: the gated pair is byte-identical to this checkout's committed pair — nothing to commit");
    emit("committed", "false");
    return { committed: false, staged: [], measured };
  }

  // SFH-02: an older run's artifact must never replace a newer baseline. The dump's
  // merge must be an ancestor of (or equal to) the main being composed onto.
  const anc = spawnSync("git", ["merge-base", "--is-ancestor", measured.merge, "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (anc.error || (anc.status !== 0 && anc.status !== 1)) {
    throw new Error(
      `MEASURE_FAIL: git merge-base --is-ancestor exit ${anc.error ? -1 : anc.status}; whether the dump's merge is on main was not measured, so nothing is composed`,
    );
  }
  if (anc.status === 1) {
    throw new Error(
      "the dump's merge is not an ancestor of this checkout's main: the artifact comes from a run main has moved past, " +
        "and composing it could replace a newer baseline with an older one. Nothing was written; dispatch a fresh run on main",
    );
  }

  // ⛔ A pre-existing edit to one of the six paths would ride into the bot commit.
  const dirty = git(repoRoot, ["status", "--porcelain", "--", ...STAGED_PATHS]).trim();
  if (dirty !== "") throw new Error("one of the six paths is already modified in this checkout; refusing to compose on top of it");

  const oldBasenames = new Set(markerBasenames(oldMarker));
  const newBasenames = markerBasenames(newMarker);
  const bad = newBasenames.filter((b) => !MIGRATION_BASENAME_STRICT_RE.test(b));
  if (bad.length > 0) throw new Error(`${bad.length} marker basename(s) do not match ${MIGRATION_BASENAME_STRICT_RE}`);
  const newlyCarried = newBasenames.filter((b) => !oldBasenames.has(b)).sort();
  // SFH-02: the new marker must carry every migration main's committed marker carries.
  // WR-07: except one main's own checkout no longer holds. That is a migration file
  // renamed or deleted on main, not a newer baseline, and refusing it would wedge
  // every later re-dump (the committed marker only moves through this compose).
  const newSet = new Set(newBasenames);
  const mainTree = new Set(migrationBasenames(git(repoRoot, ["ls-tree", "--name-only", "HEAD", MIGRATIONS_REL])));
  const omitted = [...oldBasenames].filter((b) => !newSet.has(b)).sort();
  const exempt = omitted.filter((b) => !mainTree.has(b));
  if (exempt.length > 0) {
    // main's committed marker was never put through the strict rule: print only what passes it.
    const shown = exempt.filter((b) => MIGRATION_BASENAME_STRICT_RE.test(b));
    const hidden = exempt.length - shown.length;
    console.log(
      `::notice::baseline-redump: main's committed marker carries ${exempt.length} migration(s) main's checkout no longer holds ` +
        `(renamed or deleted on main), so the new marker may omit them: ${shown.join(", ")}` +
        `${hidden > 0 ? `${shown.length > 0 ? ", " : ""}${hidden} with a name outside the strict rule` : ""}`,
    );
  }
  const dropped = omitted.length - exempt.length;
  if (dropped > 0) {
    throw new Error(
      `the new marker omits ${dropped} migration(s) main's committed marker carries and main's checkout still holds: an older dump ` +
        "must never replace a newer baseline. Nothing was written; dispatch a fresh run on main",
    );
  }

  const oldShapes = countShapes(oldDumpBytes.toString("utf8"));
  writeFileSync(join(repoRoot, BASELINE_SQL_REL), newDump);
  writeFileSync(join(repoRoot, MARKER_REL), newMarker);

  // D-09: each gate needs a zero exit (runGate) AND a green verdict line.
  // ⛔ `scripts/dump-sql-functions.ts --check` is deliberately NOT run here
  // (RESEARCH Open Question 4, resolved): it needs `npm ci`, which would put
  // third-party code in the job holding the write token. That check first runs
  // on the next push to `main` after the bot commit (CONTEXT "Main's CI").
  const currencyLine = passedLine(
    judgeCurrencyLine(runGate(runner, repoRoot, "bash", ["scripts/local-stack/run.sh", "--check-currency"])),
    "the currency gate",
  );
  runGate(runner, repoRoot, "node", ["scripts/baseline-content-drift-check.mjs", "--self-test"]);
  const driftOut = runGate(runner, repoRoot, "node", ["scripts/baseline-content-drift-check.mjs"]);
  const driftFindingsLine = passedLine(judgeDriftLine(driftOut), "the content-drift gate");
  const driftComparedLine = captureLine(driftOut, "baseline-content-drift: functions compared", "the content-drift gate");

  const oldVersion = readFileSync(join(repoRoot, "VERSION"), "utf8").replace(/\n$/, "");
  const next = nextVersion(oldVersion);
  if (next.defects.length > 0) refuseWriterDefects(next.defects);
  const newVersion = next.text;
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
    cliVersion: measured.cli_version,
    newlyCarried,
    currencyLine,
    driftFindingsLine,
    driftComparedLine,
  };

  // Every writer's text is computed FIRST and nothing is written until all of
  // them, and the version-gate mirror, report no defect: a refusal leaves the
  // four files exactly as `main` has them and the index empty.
  const pkgPath = join(repoRoot, "package.json");
  const clPath = join(repoRoot, "CHANGELOG.md");
  const mdPath = join(repoRoot, BASELINE_MD_REL);
  const entry = composeChangelogEntry(m);
  const section = composeRegeneratedSection(m);
  const pkg = bumpPackageJson(readFileSync(pkgPath, "utf8"), oldVersion, newVersion);
  const cl = insertChangelogEntry(readFileSync(clPath, "utf8"), entry);
  const md = rewriteBaselineMd(readFileSync(mdPath, "utf8"), {
    date,
    cliVersion: m.cliVersion,
    runId: m.runId,
    sha: m.newSha,
    shapes: m.shapes,
    section,
  });
  const writerDefects = [...pkg.defects, ...cl.defects, ...md.defects];
  if (writerDefects.length > 0) refuseWriterDefects(writerDefects);
  const vd = judgeVersionBump({
    baseVersion: oldVersion,
    headVersion: newVersion,
    packageVersion: JSON.parse(pkg.text).version,
    changelog: cl.text,
  });
  if (vd.length > 0) refuseWriterDefects(vd);

  writeFileSync(join(repoRoot, "VERSION"), newVersion); // no trailing newline (RESEARCH F7)
  writeFileSync(pkgPath, pkg.text);
  writeFileSync(clPath, cl.text);
  writeFileSync(mdPath, md.text);

  runGate(runner, repoRoot, "node", ["scripts/check-baseline-staleness.mjs"]);

  // D-17: exactly the six paths, by explicit path — never `-A` or `.`.
  // `supabase link` writes supabase/.temp/* on the runner; that is never staged.
  git(repoRoot, ["add", "--", ...STAGED_PATHS]);
  const staged = git(repoRoot, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
  const stagedDefects = judgeStagedSet(staged);
  if (stagedDefects.length > 0) refuseWriterDefects(stagedDefects, "nothing was committed");

  // D-14: the composed CHANGELOG entry and Regenerated section are judged beside
  // the commit message (CONTEXT A8), the only inputs that carry free text (the date).
  // All three run BEFORE the commit, on every call, a retry's re-compose included.
  const message = composeCommitMessage(m);
  const tokenHits = [
    ["the commit message", message],
    ["the CHANGELOG entry", entry],
    ["the Regenerated section", section],
  ].flatMap(([where, text]) => judgeSkipTokens(text).map((cls) => `${where} carries skip-token class ${cls} of 6`));
  if (tokenHits.length > 0) {
    for (const h of tokenHits) console.error(`::error::baseline-redump: skip-token: ${h}`);
    throw new Error(`refusing to commit: ${tokenHits.join("; ")}; nothing was committed`);
  }

  const tmp = mkdtempSync(join(tmpdir(), "baseline-redump-msg-"));
  try {
    const msgFile = join(tmp, "commit-message.txt");
    writeFileSync(msgFile, message);
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

  console.log(
    `baseline-redump compose: VERSION ${oldVersion} -> ${newVersion} sha256=${short(oldSha)}… -> ${short(m.newSha)}… ` +
      `newly-carried=${newlyCarried.length} staged=${staged.length}`,
  );
  emit("committed", "true");
  return { committed: true, staged, measured: m };
}

/**
 * --compose-and-push (Phase 258, replacing --compose). Compose the gated pair onto the
 * checked-out main exactly as before, then push HEAD to refs/heads/main through the
 * frozen argv. A refusal while origin/main moved is retried by re-composing onto the
 * fresh main, at most MAX_PUSH_ATTEMPTS attempts in all. Returns `{ pushed, attempts }`;
 * throws on every refusal.
 *
 * `token` is the credential `takePushToken` removed from `process.env` first; this
 * function hands it to the push seam and to nothing else. The seam is injectable so
 * the self-test can race it; the self-test's real-push arm uses the real one.
 */
export function composeAndPush({ repoRoot, inDir, runner, emit, date, token, remote = "origin", push = pushToMain, fetchMain = fetchMainTip }) {
  // An empty token would let `gh auth git-credential` fall back to a local keyring login.
  if (typeof token !== "string" || token === "") {
    throw new Error("no push credential: GH_TOKEN is unset or empty in this step's env, so nothing was composed or pushed");
  }
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
    const base = git(repoRoot, ["rev-parse", "HEAD"]).trim();
    const { committed } = compose({ repoRoot, inDir, runner, emit: () => {}, date });
    if (!committed) {
      console.log("::notice::baseline-redump: nothing was pushed: the composed pair is already on main");
      emit("committed", "false");
      emit("pushed", "false");
      return { pushed: false, attempts: attempt };
    }
    const { status } = push({ repoRoot, token });
    if (status === 0) {
      console.log(
        `baseline-redump push: ${short(git(repoRoot, ["rev-parse", "HEAD"]).trim())} pushed to main on attempt ${attempt} of ${MAX_PUSH_ATTEMPTS}`,
      );
      emit("committed", "true");
      emit("pushed", "true");
      return { pushed: true, attempts: attempt };
    }
    const fresh = fetchMain({ repoRoot, remote });
    if (fresh === base) {
      throw new Error(
        `the push to main was refused although origin/main did not move from ${short(base)}: not a race ` +
          "(auth, a ruleset or a network fault); nothing was retried",
      );
    }
    if (attempt === MAX_PUSH_ATTEMPTS) {
      throw new Error(
        `the push to main was refused ${MAX_PUSH_ATTEMPTS} time(s) and main moved each time (now ${short(fresh)}); nothing was pushed`,
      );
    }
    console.log(
      `::notice::baseline-redump: the push was refused because main moved from ${short(base)} to ${short(fresh)}; ` +
        `re-composing onto the fresh main (attempt ${attempt + 1} of ${MAX_PUSH_ATTEMPTS})`,
    );
    // Re-compose, never rebase and never force: every merge moves VERSION, package.json and
    // the top of CHANGELOG.md, so a rebased bot commit would carry a stale version. compose
    // re-reads VERSION, re-picks the next one, and re-runs every refusal on each call.
    git(repoRoot, ["reset", "--hard", fresh]);
  }
  throw new Error("unreachable: the attempt loop ended without a verdict");
}

// ── self-test ─────────────────────────────────────────────────────────────────

/**
 * How many `ok()` calls `selfTest()` is declared to run. ⛔ Raise it only
 * together with the arm that adds one; lowering it to make a run green is
 * deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 201;
/**
 * How many MORE `ok()` calls `--self-test --with-gitleaks` runs: the real-binary
 * arms the `redump-dump` job runs (D-18, D-21). Same rule as above.
 */
export const EXPECTED_GITLEAKS_ASSERTIONS = 9;

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
  /**
   * gateDump as the arms that test something else call it: attempt 1, and `main`
   * standing exactly at the checkout's HEAD. A re-run attempt and the real
   * anonymous main fetch have their own arms in 4b2 (SFH-01, CR-03).
   */
  const mainAtHead = ({ repoRoot }) => migrationBasenames(git(repoRoot, ["ls-tree", "--name-only", "HEAD", MIGRATIONS_REL]));
  const gateDumpT = (o) => gateDump({ runAttempt: "1", mainListing: mainAtHead, ...o });
  /** The runner for the happy-path and no-op arms: the real binary under --with-gitleaks. */
  const gl = () => (withGitleaks ? realGitleaks : cleanGl());
  /** A JWT-shaped value joined at runtime; this file never carries one (RESEARCH F13). */
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwtValue = [b64({ alg: "HS256", typ: "JWT" }), b64({ iss: "self-test", role: "fixture" }), randomBytes(24).toString("base64url")].join(".");

  /** WR-08: ordinary SQL naming a password column; the pure arm and the real-gitleaks arm both hold it. */
  const pwNegatives = [
    'CREATE TABLE "public"."accounts" ("id" "uuid", "password" "text" NOT NULL, "encrypted_password" "text");',
    "    SELECT 1 FROM auth.users WHERE password = crypt(p_secret, password);",
    "    IF password = '' THEN RAISE EXCEPTION 'empty'; END IF;",
    "    RETURN password = ANY(p_list);",
    "COMMENT ON COLUMN \"public\".\"accounts\".\"password\" IS 'reset the password';",
    "-- password \u2014 hashed by the auth service, never stored in clear",
    "    v_row.encrypted_password := crypt(p_new, gen_salt('bf'));",
    'COMMENT ON TABLE "public"."t" IS \'{"password": ""}\';',
  ];

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
    dupShape.text === null && hasDefect(dupShape, "capture-row-count", /carries 2 .\| Shape \|. row/),
    "rewriteBaselineMd refuses a DUPLICATE '| Shape |' row inside the table, naming the row and the count 2 (calibration)",
  );
  const noTaken = w(() => rewriteBaselineMd(mdFixture.replace("| Taken | 2026-01-01 |\n", ""), fxValues));
  ok(noTaken.text === null && hasDefect(noTaken, "capture-row-count", /carries 0 .\| Taken \|. row/), "rewriteBaselineMd refuses a capture row that matches 0 times, naming the row and the count 0");
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

  console.log("=== SELF-TEST 1c/4: every D-16 value in the CHANGELOG entry and the Regenerated section");
  /** A composer that is missing or throws renders as "", so its presence arms read FAIL instead of crashing the run. */
  const safe = (fn) => {
    try {
      return String(fn());
    } catch {
      return "";
    }
  };
  // Every value distinctive, so a presence arm can only be satisfied by ITS value.
  const M = {
    newVersion: "4.5.6.8", oldVersion: "4.5.6.7", date: "2026-03-04", runId: "987654321",
    merge: "0a1b2c3d" + "4".repeat(32), cliVersion: "2.98.2",
    oldSha: "a1b2c3d4" + "5".repeat(56), newSha: "e6f7a8b9" + "6".repeat(56),
    oldShapes: { tables: 61, policies: 151, function_statements: 117, distinct_functions: 113, data_statements: 2 },
    shapes: { tables: 62, policies: 153, function_statements: 119, distinct_functions: 115, data_statements: 0 },
    newlyCarried: ["20260301000000_first_fixture.sql", "20260302000000_second_fixture.sql"],
    currencyLine: "baseline-currency: carried=279 replay=0 marker-sha=match defects=0",
    driftComparedLine:
      "baseline-content-drift: functions compared 119 — MATCH 116, DRIFT 3, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0",
    driftFindingsLine: "baseline-content-drift: findings 0",
  };
  const M0 = { ...M, newlyCarried: [] };
  const entry = safe(() => composeChangelogEntry(M));
  const section = safe(() => composeRegeneratedSection(M));
  const shared = [
    ["the applying run id", "987654321"],
    ["the merge short sha", "`0a1b2c3d`"],
    ["the old sha256 prefix", "`a1b2c3d4…`"],
    ["the new sha256 prefix", "`e6f7a8b9…`"],
    ["tables old and new", "tables 61 → 62"],
    ["policies old and new", "policies 151 → 153"],
    ["function statements old and new", "function statements 117 → 119"],
    ["distinct function names old and new", "distinct function names 113 → 115"],
    ["newly carried basename 1", "`20260301000000_first_fixture.sql`"],
    ["newly carried basename 2", "`20260302000000_second_fixture.sql`"],
    ["the baseline-currency line, verbatim", `\`${M.currencyLine}\``],
    ["the functions-compared drift line, verbatim", `\`${M.driftComparedLine}\``],
    ["the findings drift line, verbatim", `\`${M.driftFindingsLine}\``],
  ];
  const perTarget = {
    "CHANGELOG entry": [entry, [...shared, ["data statements old and new", "data statements 2 → 0"]]],
    "regenerated section": [section, [...shared, ["data statements old and new", "| Data statements | 2 → 0 |"]]],
  };
  for (const [target, [text, needles]] of Object.entries(perTarget)) {
    for (const [label, needle] of needles) ok(text.includes(needle), `D-16 presence (${target}): ${label}`);
  }
  const noneNeedle = "none — the marker diff added no migration basename";
  ok(safe(() => composeChangelogEntry(M0)).includes(noneNeedle), "D-16 presence (CHANGELOG entry): no newly carried migration is a measured 'none', not an omission");
  ok(safe(() => composeRegeneratedSection(M0)).includes(noneNeedle), "D-16 presence (regenerated section): no newly carried migration is a measured 'none', not an omission");
  const entryLines = entry.split("\n");
  ok(
    /^## \[4\.5\.6\.8\] - 2026-03-04 — \S/.test(entryLines[0]) &&
      entryLines.filter((l) => l.startsWith("#")).slice(1).join("|") === "### Changed|### Notes",
    "the entry's heading is '## [<new>] - <date> — …' and its sections are ### Changed then ### Notes",
  );
  ok(
    section.startsWith(`### Regenerated 2026-03-04 — automated re-dump after Supabase Migrate run 987654321\n`) &&
      !/what it adds/i.test(section) && !/[0-9a-f]{64}/.test(section) && section.includes("| sha256 | `a1b2c3d4…` → `e6f7a8b9…` |"),
    "the section heading ends with the run id, it has no 'what it adds' column, zero full-64-hex values, and a prefix-form sha256 row",
  );
  const oldJob = ["redump", "pr"].join("-");
  ok(
    [entry, section].every(
      (t) =>
        t.includes("`redump-push`") && t.includes("straight to `main`") && !t.includes(oldJob) && !/reviewer/i.test(t) && !/pull request/i.test(t),
    ),
    "the CHANGELOG entry and the Regenerated section each name the `redump-push` job and say the commit went straight to `main`, and neither names the old job, a reviewer or a pull request (T-258-07)",
  );
  const commitTitle = "chore(release): v4.5.6.8 — baseline re-dump after the PROD apply of 0a1b2c3d";
  ok(
    safe(() => composeCommitTitle(M)) === commitTitle && safe(() => composeCommitMessage(M)).split("\n")[0] === commitTitle,
    "composeCommitTitle(M) is exactly the commit title text, and the first line of composeCommitMessage(M) equals it",
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
  ok(
    ![M, M0].some((x) =>
      [safe(() => composeChangelogEntry(x)), composeCommitMessage(x), composeCommitTitle(x), safe(() => composeRegeneratedSection(x))]
        .some((t) => guardRe.test(t)),
    ),
    "the fixed templates (entry, commit message, commit title, regenerated section) carry no CI skip token (D-14)",
  );

  console.log("=== SELF-TEST 1e/4: the staged-set (D-17) and skip-token (D-14) refusals");
  /** A judge that is missing or throws reads back as null, so its arm is a FAIL rather than a crash. */
  const list = (fn) => {
    try {
      const r = fn();
      return Array.isArray(r) ? r : null;
    } catch {
      return null;
    }
  };
  const tempRef = "supabase/.temp/project-ref";
  ok(
    list(() => judgeStagedSet([...STAGED_PATHS]))?.length === 0 && list(() => judgeStagedSet([...STAGED_PATHS].reverse()))?.length === 0,
    "judgeStagedSet passes exactly STAGED_PATHS, in any order",
  );
  ok(
    list(() => judgeStagedSet([...STAGED_PATHS, tempRef]))?.some((d) => d.kind === "staged-extra" && d.detail.includes(tempRef)),
    "judgeStagedSet refuses one extra path (supabase/.temp/project-ref), naming it",
  );
  ok(
    list(() => judgeStagedSet(STAGED_PATHS.slice(1)))?.some((d) => d.kind === "staged-missing" && d.detail.includes(STAGED_PATHS[0])),
    "judgeStagedSet refuses one missing path, naming it",
  );
  ok(list(() => judgeStagedSet([...STAGED_PATHS, "VERSION"]))?.some((d) => d.kind === "staged-duplicate"), "judgeStagedSet refuses a duplicated path");
  // Every token below is assembled from fragments at runtime; this file spells none of them.
  const bracketed = (a, b) => `[${a} ${b}]`;
  const tokenClasses = [
    [1, bracketed("skip", "ci")],
    [2, bracketed("ci", "skip")],
    [3, bracketed("no", "ci")],
    [4, bracketed("skip", "actions")],
    [5, bracketed("actions", "skip")],
  ];
  for (const [cls, tok] of tokenClasses) {
    ok(
      list(() => judgeSkipTokens(`subject\n\nbody ${tok} tail`))?.join() === String(cls) &&
        list(() => judgeSkipTokens(tok.toUpperCase()))?.join() === String(cls),
      `judgeSkipTokens refuses token class ${cls} of 6, in lower and upper case, reporting the class index only`,
    );
  }
  const trailerKey = ["skip", "checks"].join("-");
  ok(
    ["", " "].every((sp) => list(() => judgeSkipTokens(`body\n\n${trailerKey}:${sp}true`))?.join() === "6") &&
      list(() => judgeSkipTokens(`${trailerKey.toUpperCase()}: TRUE`))?.join() === "6",
    "judgeSkipTokens refuses token class 6 of 6 (the trailer) with and without the space after the colon, and in upper case",
  );
  ok(
    [M, M0].every((x) =>
      [composeCommitMessage(x), composeCommitTitle(x)].every((t) => t !== "" && list(() => judgeSkipTokens(t))?.length === 0),
    ),
    "judgeSkipTokens passes the commit message and commit title composed from the fixed templates",
  );

  console.log("=== SELF-TEST 1d/4: each child gate is judged by its VERDICT line's content, not only its exit code (D-09)");
  /** A judge that is missing or throws reads back as null, so its arm is a FAIL rather than a crash. */
  const jg = (fn) => {
    try {
      const r = fn();
      return r && typeof r === "object" && typeof r.verdict === "string" ? r : null;
    } catch {
      return null;
    }
  };
  const CUR_GREEN = "baseline-currency: carried=277 replay=0 marker-sha=match defects=0";
  // The measured `--check-currency` shape: the verdict line among lines with other prefixes.
  const curOut = (...lines) =>
    ["[local-stack] a preceding line", ...lines, "baseline-replay: 0 migration(s) newer than the dump (none)", ""].join("\n");
  const cg = jg(() => judgeCurrencyLine(curOut(CUR_GREEN)));
  ok(cg?.verdict === "pass" && cg.line === CUR_GREEN, "judgeCurrencyLine passes the one 'marker-sha=match defects=0' line among other prefixes, returning it verbatim");
  ok(jg(() => judgeCurrencyLine(curOut(CUR_GREEN.replace("marker-sha=match", "marker-sha=mismatch"))))?.verdict === "refuse", "judgeCurrencyLine refuses marker-sha=mismatch");
  ok(jg(() => judgeCurrencyLine(curOut(CUR_GREEN.replace("defects=0", "defects=1"))))?.verdict === "refuse", "judgeCurrencyLine refuses defects=1");
  ok(
    jg(() => judgeCurrencyLine(curOut(CUR_GREEN.replace("defects=0", "defects=01"))))?.verdict === "refuse",
    "judgeCurrencyLine refuses defects=01 (each token is anchored, never a substring match)",
  );
  ok(jg(() => judgeCurrencyLine(curOut(CUR_GREEN, CUR_GREEN)))?.verdict === "measure_fail", "judgeCurrencyLine: two 'baseline-currency:' lines are MEASURE_FAIL");
  ok(
    jg(() => judgeCurrencyLine(curOut()))?.verdict === "measure_fail" && jg(() => judgeCurrencyLine(""))?.verdict === "measure_fail",
    "judgeCurrencyLine: no 'baseline-currency:' line, or no output at all, is MEASURE_FAIL and never a pass",
  );
  /**
   * The REAL five-line shape of `baseline-content-drift-check.mjs` (measured), with
   * `findingsLines` in the fourth position. The SCOPE line is synthetic prose that
   * CONTAINS the word "findings", so a judge reading the first line, or any line
   * mentioning findings, fails the green arm below.
   */
  const driftOut = (findingsLines) =>
    [
      "baseline-content-drift: chain files 121 (supabase/schema/functions/*.sql, sorted)",
      "baseline-content-drift: functions compared 123 — MATCH 120, DRIFT 3, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0",
      "baseline-content-drift: allowlisted rows 3 — fixture_a/1, fixture_b/0, fixture_c/0",
      ...findingsLines,
      "baseline-content-drift: SCOPE — this gate compares FUNCTION BODIES ONLY; its findings count says nothing about tables or policies",
      "",
    ].join("\n");
  const FINDINGS_0 = "baseline-content-drift: findings 0";
  const dg = jg(() => judgeDriftLine(driftOut([FINDINGS_0])));
  ok(
    dg?.verdict === "pass" && dg.line === FINDINGS_0,
    "judgeDriftLine passes the REAL five-line shape on its 'findings 0' line only (a first-line or any-'findings' judge fails here)",
  );
  const d2 = jg(() => judgeDriftLine(driftOut(["baseline-content-drift: findings 2"])));
  ok(
    d2?.verdict === "refuse" &&
      d2.detail.includes("main holds a migration that has not applied to PROD yet; the queued apply run will produce the right dump"),
    "judgeDriftLine refuses 'findings 2', naming the likely cause: a migration on main that has not applied to PROD yet",
  );
  ok(
    jg(() => judgeDriftLine(driftOut([])))?.verdict === "measure_fail",
    "judgeDriftLine: no findings line (only the SCOPE prose mentions 'findings') is MEASURE_FAIL, never a pass",
  );
  ok(jg(() => judgeDriftLine(driftOut([FINDINGS_0, FINDINGS_0])))?.verdict === "measure_fail", "judgeDriftLine: two findings lines are MEASURE_FAIL");
  ok(
    jg(() => judgeDriftLine(driftOut([`${FINDINGS_0} — trailing text`])))?.verdict === "measure_fail",
    "judgeDriftLine: a findings line with trailing text does not match '^…findings \\d+$' and is MEASURE_FAIL",
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
      { cwd: opts.cwd ?? join(dir, "repo"), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
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
    // The fixture carries a local bare `origin`, so no arm reaches a missing remote by accident.
    g(["init", "-q", "--bare", join(dir, "origin.git")], { cwd: dir });
    g(["remote", "add", "origin", join(dir, "origin.git")]);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "fixture"]);
    // D-09 failing direction: a migration present in the working tree but NOT in the merge.
    writeFileSync(join(repo, "supabase/migrations", M3), "SELECT 3;\n");
    const base = g(["rev-parse", "HEAD"]).trim();

    const outputs = [];
    const emit = (k, v) => outputs.push(`${k}=${v}`);

    const same = gateDumpT({
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
    const gd = gateDumpT({ repoRoot: repo, dump: dumpPath, merge: base, runId: "4242", cliVersion: "2.98.2", out: join(dir, "art"), emit, gitleaks: gl() });
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
    // judgeMeasured (D-21): the write job trusts nothing in measured.json it has not re-checked.
    const jm = (text) => {
      try {
        const r = judgeMeasured(text);
        return r && typeof r === "object" && Array.isArray(r.defects) ? r : null;
      } catch {
        return null;
      }
    };
    const mjText = readFileSync(join(dir, "art/measured.json"), "utf8");
    const mOk = jm(mjText);
    ok(mOk !== null && mOk.defects.length === 0 && mOk.measured?.dump_sha256 === newSha, "judgeMeasured accepts the measured.json --gate-dump just wrote");
    const keyPaths = [
      "schema", "run_id", "merge", "cli_version", "dump_sha256", "dump_bytes", "shapes", "shapes.tables", "shapes.policies",
      "shapes.function_statements", "shapes.distinct_functions", "shapes.data_statements", "marker_sha256", "carried_count",
      "gitleaks", "gitleaks_version", "secret_scan_hits", "integrity", "integrity.nul", "integrity.client_encoding", "integrity.home_path",
    ];
    const withoutKey = (path) => {
      const o = JSON.parse(mjText);
      const [a, b] = path.split(".");
      if (b) delete o[a][b];
      else delete o[a];
      return JSON.stringify(o);
    };
    const refusedNaming = (text, key) => {
      const r = jm(text);
      return r !== null && r.measured === null && r.defects.some((d) => d.detail.includes(`'${key}'`));
    };
    const notRefused = keyPaths.filter((p) => !refusedNaming(withoutKey(p), p));
    ok(
      notRefused.length === 0,
      `judgeMeasured refuses a measured.json missing any one of the ${keyPaths.length} schema-1 keys, naming it (not refused: ${notRefused.join(",") || "none"})`,
    );
    const tampered = (patch) => JSON.stringify({ ...JSON.parse(mjText), ...patch });
    ok(refusedNaming(tampered({ gitleaks: "findings" }), "gitleaks"), "judgeMeasured refuses gitleaks other than 'clean'");
    ok(refusedNaming(tampered({ secret_scan_hits: 1 }), "secret_scan_hits"), "judgeMeasured refuses secret_scan_hits other than 0");
    ok(
      refusedNaming(tampered({ merge: "zz-tampered-merge-value" }), "merge") && refusedNaming(tampered({ run_id: "12a-tampered-run-value" }), "run_id") &&
        !JSON.stringify(jm(tampered({ merge: "zz-tampered-merge-value", run_id: "12a-tampered-run-value" }))).includes("tampered"),
      "judgeMeasured refuses a merge or run_id failing the plan-02 validators, naming the key and never echoing the value",
    );
    ok(refusedNaming(tampered({ schema: 2 }), "schema"), "judgeMeasured refuses a schema other than 1");
    ok(
      refusedNaming(tampered({ integrity: { nul: 1, client_encoding: 1, home_path: 0 } }), "integrity.nul"),
      "judgeMeasured refuses an integrity record other than {nul 0, client_encoding 1, home_path 0}",
    );
    const partial = jm(mjText.slice(0, Math.floor(mjText.length / 2)));
    ok(
      partial !== null && partial.measured === null && partial.defects.some((d) => d.kind === "measured-unparseable"),
      "judgeMeasured refuses a PARTIAL measured.json (truncated, so not JSON) by kind",
    );
    ok(
      throws(() => gateDumpT({ repoRoot: repo, dump: dumpPath, merge: "d".repeat(40), runId: "1", cliVersion: "2.98.2", out: join(dir, "x"), emit, gitleaks: cleanGl() })),
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
        gateDumpT({ repoRoot: repo, dump: p, merge: base, runId: "1", cliVersion: "2.98.2", out: outDir, emit, gitleaks }),
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
      // WR-03: random at run time, so no credential-shaped literal is ever committed.
      ["a Supabase sb_secret_ key in a COMMENT ON literal", `COMMENT ON TABLE "public"."t" IS '${["sb", "_secret_"].join("")}${randomBytes(24).toString("base64url")}';`],
      [
        "a password in a SUBSCRIPTION connection string",
        `CREATE SUBSCRIPTION "s" CONNECTION 'host=h ${["pass", "word="].join("")}${randomBytes(12).toString("hex")} dbname=d' PUBLICATION "p";`,
      ],
      [
        "a password in a USER MAPPING OPTIONS list",
        `CREATE USER MAPPING FOR "u" SERVER "s" OPTIONS ("user" 'u', ${["pass", "word"].join("")} '${randomBytes(12).toString("hex")}');`,
      ],
      // WR-08: the credential forms the first password class missed.
      ["a plpgsql password assignment", `  ${["pass", "word"].join("")} := '${randomBytes(12).toString("hex")}';`],
      ["a JSON password member in a COMMENT ON literal", `COMMENT ON TABLE "public"."t" IS '{"${["pass", "word"].join("")}": "${randomBytes(12).toString("hex")}"}';`],
      ["an upper-case PASSWORD with an E'' literal", `CREATE ROLE "r" ${["PASS", "WORD"].join("")} E'${randomBytes(12).toString("hex")}';`],
      // WR-10: pg_dump doubles a quote inside a SQL literal, so a quoted libpq value reads password=''…''.
      [
        "a quoted libpq password in a dumped CONNECTION string",
        `CREATE SUBSCRIPTION "s" CONNECTION 'host=h ${["pass", "word="].join("")}''${randomBytes(12).toString("hex")}'' dbname=d' PUBLICATION "p";`,
      ],
    ];
    for (const [label, value] of secretClasses) {
      const r = redGate(withLine(`-- ${value}`));
      ok(
        r.threw !== null && r.text.includes(`baseline-redump secret-scan: 1 hit(s) at line(s) ${appendedLine}`) &&
          !r.text.includes(value) && r.wroteNothing,
        `secret class '${label}' refuses at line ${appendedLine}, prints only the count and line, and writes nothing`,
      );
    }
    // WR-08: ordinary SQL and prose naming a password column is NOT a credential. Read
    // as latin1 bytes exactly as the gate reads a dump, so the em-dash's UTF-8 bytes
    // are what the class sees (the lines are `pwNegatives`, above).
    const pwNegHits = judgeSecretScan(Buffer.from(pwNegatives.join("\n") + "\n", "utf8"));
    ok(
      pwNegHits.length === 0,
      `the password class does not match ordinary SQL (a comparison, = ANY, an empty literal, a quoted column, an em-dash comment) (WR-08; hits at ${pwNegHits.join(",") || "none"})`,
    );
    // WR-10: the doubled-quote alternation allows no space around `=`, so a spaced
    // comparison with an empty literal stays clear.
    const pwEmptyHits = judgeSecretScan(Buffer.from(["    RETURN password = '';", "password = ''"].join("\n") + "\n", "utf8"));
    ok(
      pwEmptyHits.length === 0,
      `the doubled-quote password alternation ignores a spaced \`password = ''\` (WR-10; hits at ${pwEmptyHits.join(",") || "none"})`,
    );
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
    // SFH-03: the committed dump creates pg_cron and pg_net; a dump that lost one is refused by name.
    const noCron = redGate(Buffer.from(dumpText.replace(/^CREATE EXTENSION IF NOT EXISTS "pg_cron"[^\n]*\n/m, ""), "latin1"));
    ok(
      noCron.threw !== null && /completeness refused: 1 extension\(s\) the committed dump creates are missing: pg_cron;/.test(noCron.threw.message) &&
        noCron.wroteNothing,
      "a dump that lost the pg_cron CREATE EXTENSION line refuses, naming pg_cron, and writes nothing (SFH-03)",
    );
    const schemaJudge = judgeCompleteness(
      'CREATE SCHEMA IF NOT EXISTS "kept";\nCREATE SCHEMA "lost_one";\nCREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";\n',
      'CREATE SCHEMA IF NOT EXISTS "kept";\nCREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";\nCREATE EXTENSION "added";\n',
    );
    ok(
      schemaJudge.defects.length === 1 && schemaJudge.defects[0] === "1 schema(s) the committed dump creates are missing: lost_one" &&
        judgeCompleteness(realDump.toString("utf8"), realDump.toString("utf8")).defects.length === 0 &&
        schemaObjectNames(realDump.toString("utf8")).extensions.has("pg_net"),
      "judgeCompleteness names a lost schema, accepts an added extension, and passes the committed dump against itself (pg_net read)",
    );
    // A merge tree holding a basename outside the strict 14-digit shape (D-27).
    const repo2 = join(dir, "repo2");
    g(["clone", "-q", repo, repo2], { cwd: dir });
    writeFileSync(join(repo2, "supabase/migrations/2026_bad.sql"), "SELECT 0;\n");
    g(["add", "--", "supabase/migrations/2026_bad.sql"], { cwd: repo2 });
    g(["commit", "-q", "-m", "bad basename"], { cwd: repo2 });
    outputs.length = 0;
    const badName = capture(() =>
      gateDumpT({
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
      gateDumpT({ repoRoot: repo, dump: join(repo, BASELINE_SQL_REL), merge: base, runId: "1", cliVersion: "2.98.2", out: join(dir, "nr"), emit }),
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
        return { status: 0, stdout: driftOut([FINDINGS_0]), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    let stagedBeforeCommit = null;
    outputs.length = 0;
    const cp = compose({
      repoRoot: repo, inDir: join(dir, "art"), runner: fakeRunner, emit, date: "2026-02-03",
    });
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
    const fakeCompared =
      "`baseline-content-drift: functions compared 123 — MATCH 120, DRIFT 3, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`";
    ok(
      cl.includes(fakeCompared) && md.includes(fakeCompared) && !cl.includes("SCOPE —") && !md.includes("SCOPE —"),
      "the captured drift lines reach the entry and the section verbatim, and the SCOPE line the gate also printed reaches neither",
    );
    ok(
      calls.join(" ; ") ===
        "bash scripts/local-stack/run.sh --check-currency ; node scripts/baseline-content-drift-check.mjs --self-test ; " +
          "node scripts/baseline-content-drift-check.mjs ; node scripts/check-baseline-staleness.mjs",
      "the three offline gates ran, in order, as child processes",
    );

    console.log("=== SELF-TEST 4/4: the second D-10 check and a red gate");
    outputs.length = 0;
    const again = compose({ repoRoot: repo, inDir: join(dir, "art"), runner: fakeRunner, emit, date: "2026-02-03" });
    ok(again.committed === false && outputs.join(",") === "committed=false", "composing the already-committed pair is a no-op: committed=false");
    writeFileSync(dumpPath, Buffer.concat([realDump, Buffer.from("\n\n")]));
    const head2 = g(["rev-parse", "HEAD"]).trim();
    gateDumpT({ repoRoot: repo, dump: dumpPath, merge: head2, runId: "5", cliVersion: "2.98.2", out: join(dir, "art2"), emit, gitleaks: cleanGl() });
    const redRunner = (cmd, args) => (args.includes("--check-currency") ? { status: 1, stdout: "", stderr: "" } : fakeRunner(cmd, args));
    ok(
      throws(() => compose({ repoRoot: repo, inDir: join(dir, "art2"), runner: redRunner, emit, date: "2026-02-03" })) &&
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
      compose({ repoRoot: repo3, inDir: join(dir, "art2"), runner: fakeRunner, emit, date: "2026-02-03" }),
    );
    ok(
      collided.threw !== null && /^::error::.*changelog-duplicate-heading/m.test(collided.text) &&
        g(["diff", "--cached", "--name-only"], { cwd: repo3 }).trim() === "" &&
        g(["status", "--porcelain", "--", "VERSION", "package.json", "CHANGELOG.md", BASELINE_MD_REL], { cwd: repo3 }).trim() === "" &&
        g(["rev-parse", "HEAD"], { cwd: repo3 }).trim() === head3pre,
      "a writer defect in --compose prints ::error:: with its kind and refuses before VERSION, package.json, CHANGELOG or BASELINE.md is written or anything is staged",
    );

    console.log("=== SELF-TEST 4a/4: --compose re-judges the artifact, then judges each gate's verdict line (D-06, D-08, D-09, D-21)");
    // Each arm composes in a FRESH clone of `repo` at head2 (4b needs `repo` itself untouched).
    let cloneN = 0;
    const freshClone = () => {
      cloneN += 1;
      const p = join(dir, `compose-clone-${cloneN}`);
      g(["clone", "-q", repo, p], { cwd: dir });
      return p;
    };
    const artVariant = (name, { dump, measuredPatch } = {}) => {
      const p = join(dir, name);
      mkdirSync(p, { recursive: true });
      for (const f of ["baseline.sql", "baseline-carried-migrations.txt", "measured.json"]) {
        writeFileSync(join(p, f), readFileSync(join(dir, "art2", f)));
      }
      const mm = JSON.parse(readFileSync(join(p, "measured.json"), "utf8"));
      if (dump) {
        // The hash is made to AGREE with the tampered dump, so only a re-scan can catch it.
        writeFileSync(join(p, "baseline.sql"), dump);
        mm.dump_sha256 = sha256(dump);
        mm.dump_bytes = dump.length;
      }
      writeFileSync(join(p, "measured.json"), JSON.stringify({ ...mm, ...(measuredPatch ?? {}) }, null, 2) + "\n");
      return p;
    };
    /** Compose in a fresh clone; report the refusal text and whether the clone was left exactly as `main` has it. */
    const composeIn = (inDir, runner = fakeRunner, extra = {}, prep = () => {}) => {
      const c = freshClone();
      prep(c);
      const headBefore = g(["rev-parse", "HEAD"], { cwd: c }).trim();
      const r = capture(() => compose({ repoRoot: c, inDir, runner, emit, date: "2026-02-03", ...extra }));
      return {
        ...r,
        clone: c,
        headBefore,
        noCommit: g(["rev-parse", "HEAD"], { cwd: c }).trim() === headBefore,
        nothingStaged: g(["diff", "--cached", "--name-only"], { cwd: c }).trim() === "",
        untouched: g(["status", "--porcelain", "--", ...STAGED_PATHS], { cwd: c }).trim() === "",
      };
    };
    const art2Dump = readFileSync(join(dir, "art2/baseline.sql"));
    const rescanSecret = composeIn(artVariant("art-rescan-secret", { dump: Buffer.concat([art2Dump, Buffer.from(`-- ${jwtValue}\n`)]) }));
    ok(
      rescanSecret.threw !== null && /re-scan/.test(rescanSecret.threw.message) && /1 hit/.test(rescanSecret.text) &&
        !rescanSecret.text.includes(jwtValue) && rescanSecret.noCommit && rescanSecret.untouched,
      "compose re-runs the five-class scan on the artifact dump: a hit measured.json does not admit refuses before any file is copied, printing no line text",
    );
    const rescanNul = composeIn(artVariant("art-rescan-nul", { dump: Buffer.concat([art2Dump, Buffer.from([0])]) }));
    ok(
      rescanNul.threw !== null && /re-scan/.test(rescanNul.threw.message) && /NUL byte/.test(rescanNul.threw.message) &&
        rescanNul.noCommit && rescanNul.untouched,
      "compose re-runs the integrity judge on the artifact dump: an appended NUL byte refuses before any file is copied",
    );
    const badMeasured = composeIn(artVariant("art-bad-measured", { measuredPatch: { gitleaks: "findings" } }));
    ok(
      badMeasured.threw !== null && /^::error::.*measured-value/m.test(badMeasured.text) && badMeasured.noCommit && badMeasured.untouched,
      "compose runs judgeMeasured first: a measured.json whose gitleaks is not 'clean' refuses by kind before anything is copied",
    );
    const runnerWith = ({ currency, drift }) => (cmd, args) => {
      if (currency && args.includes("--check-currency")) return currency;
      if (drift && args[0] === "scripts/baseline-content-drift-check.mjs" && args.length === 1) return drift;
      return fakeRunner(cmd, args);
    };
    const curRed = composeIn(
      join(dir, "art2"),
      runnerWith({ currency: { status: 0, stdout: "baseline-currency: carried=2 replay=0 marker-sha=mismatch defects=1\n", stderr: "" } }),
    );
    ok(
      curRed.threw !== null && /currency/.test(curRed.threw.message) && curRed.noCommit && curRed.nothingStaged,
      "a currency gate that exits 0 but prints marker-sha=mismatch refuses (content, not exit code), and no commit is made",
    );
    const driftRed = composeIn(
      join(dir, "art2"),
      runnerWith({ drift: { status: 0, stdout: driftOut(["baseline-content-drift: findings 2"]), stderr: "" } }),
    );
    ok(
      driftRed.threw !== null &&
        driftRed.threw.message.includes("main holds a migration that has not applied to PROD yet; the queued apply run will produce the right dump") &&
        driftRed.noCommit && driftRed.nothingStaged,
      "a content-drift gate that exits 0 but prints 'findings 2' refuses, naming the likely cause (D-09), and no commit is made",
    );
    const driftSilent = composeIn(join(dir, "art2"), runnerWith({ drift: { status: 0, stdout: "", stderr: "" } }));
    ok(
      driftSilent.threw !== null && /MEASURE_FAIL/.test(driftSilent.threw.message) && driftSilent.noCommit && driftSilent.nothingStaged,
      "a content-drift gate that exits 0 and prints nothing is MEASURE_FAIL: a gate that printed nothing is not a green gate",
    );
    // SFH-02: a real commit in every clone that is NOT an ancestor of head2 (commit-tree
    // moves nothing; the ref only makes the clone carry the object).
    const sideMerge = g(["commit-tree", `${base}^{tree}`, "-p", base, "-m", "a side commit main never merged"]).trim();
    g(["update-ref", "refs/heads/self-test-side-merge", sideMerge]);
    const notAncestor = composeIn(artVariant("art-side-merge", { measuredPatch: { merge: sideMerge } }));
    ok(
      notAncestor.threw !== null && notAncestor.threw.message.startsWith("the dump's merge is not an ancestor of this checkout's main") &&
        notAncestor.noCommit && notAncestor.untouched,
      "compose refuses an artifact whose merge is a real commit that is not an ancestor of main, before any file is written (SFH-02)",
    );
    const absentMerge = composeIn(artVariant("art-absent-merge", { measuredPatch: { merge: "d".repeat(40) } }));
    ok(
      absentMerge.threw !== null && /^MEASURE_FAIL: git merge-base --is-ancestor exit 128/.test(absentMerge.threw.message) &&
        absentMerge.noCommit && absentMerge.untouched,
      "compose refuses as MEASURE_FAIL when the artifact's merge is not in the checkout at all (exit 128 is never 'is an ancestor')",
    );
    const droppedArt = artVariant("art-dropped-m1");
    const droppedMarker = readFileSync(join(droppedArt, "baseline-carried-migrations.txt"), "utf8").replace(`${M1}\n`, "");
    writeFileSync(join(droppedArt, "baseline-carried-migrations.txt"), droppedMarker);
    const droppedMj = JSON.parse(readFileSync(join(droppedArt, "measured.json"), "utf8"));
    writeFileSync(
      join(droppedArt, "measured.json"),
      JSON.stringify({ ...droppedMj, marker_sha256: sha256(Buffer.from(droppedMarker, "utf8")), carried_count: droppedMj.carried_count - 1 }, null, 2) + "\n",
    );
    const dropped = composeIn(droppedArt);
    ok(
      !droppedMarker.includes(M1) && dropped.threw !== null &&
        dropped.threw.message.startsWith("the new marker omits 1 migration(s) main's committed marker carries and main's checkout still holds") &&
        !dropped.text.includes(M1) &&
        dropped.noCommit && dropped.untouched,
      "compose refuses a marker that omits a migration main's committed marker carries, by count only, before any file is written (SFH-02)",
    );

    // WR-07: main's committed marker names migrations main's checkout no longer holds
    // (renamed or deleted on main). The artifact's marker omits them, and that is not
    // an older dump: compose proceeds and names each exempted file in a ::notice::,
    // counting (never printing) a name outside the strict rule.
    const GHOST = "20251231000000_renamed_away.sql";
    const GHOST_BAD = ["Ghost", "Not", "Strict.sql"].join("_");
    const renamed = composeIn(join(dir, "art2"), fakeRunner, {}, (c) => {
      const mk = join(c, MARKER_REL);
      writeFileSync(mk, readFileSync(mk, "utf8") + `${GHOST}\n${GHOST_BAD}\n`);
      g(["add", "--", MARKER_REL], { cwd: c });
      g(["commit", "-q", "-m", "main's marker names migrations its tree lacks"], { cwd: c });
    });
    ok(
      renamed.threw === null && !renamed.noCommit &&
        renamed.text.includes(
          `::notice::baseline-redump: main's committed marker carries 2 migration(s) main's checkout no longer holds (renamed or deleted on main), ` +
            `so the new marker may omit them: ${GHOST}, 1 with a name outside the strict rule`,
        ) && !renamed.text.includes(GHOST_BAD),
      "compose exempts a migration main's committed marker carries but main's checkout lacks (a rename or deletion on main), naming it in a ::notice:: and committing (WR-07)",
    );

    console.log("=== SELF-TEST 4a2/4: --compose stages exactly the six paths and refuses a skip token before committing (D-14, D-17)");
    // What `supabase link` leaves in a runner checkout.
    const withRef = (c) => {
      mkdirSync(join(c, "supabase/.temp"), { recursive: true });
      writeFileSync(join(c, tempRef), "fixture-ref\n");
    };
    const untrackedRef = composeIn(join(dir, "art2"), fakeRunner, {}, withRef);
    ok(
      untrackedRef.threw === null && !untrackedRef.noCommit &&
        g(["diff", "--name-only", untrackedRef.headBefore, "HEAD"], { cwd: untrackedRef.clone }).split("\n").filter(Boolean).sort().join(",") ===
          STAGED_PATHS.join(",") &&
        g(["status", "--porcelain", "--", tempRef], { cwd: untrackedRef.clone }).trim() === `?? ${tempRef}`,
      "an untracked supabase/.temp/project-ref is never staged: the bot commit is exactly the six paths and the file stays untracked",
    );
    const stagedRef = composeIn(join(dir, "art2"), fakeRunner, {}, (c) => {
      withRef(c);
      g(["add", "--", tempRef], { cwd: c });
    });
    ok(
      stagedRef.threw !== null && /^::error::.*staged-extra/m.test(stagedRef.text) && stagedRef.noCommit,
      "a path already in the index beyond the six refuses at judgeStagedSet as 'staged-extra', and no commit is made",
    );
    const tokenDate = ["2026-02-03 ", "[", "skip", " ", "ci", "]"].join("");
    const tokenRun = composeIn(join(dir, "art2"), fakeRunner, { date: tokenDate });
    ok(
      tokenRun.threw !== null && /skip-token class 1 of 6/.test(tokenRun.threw.message) && !tokenRun.text.includes(tokenDate.slice(11)) &&
        tokenRun.noCommit,
      "a skip token reaching the composed CHANGELOG entry or Regenerated section refuses before the commit, naming the class index and never the token",
    );

    console.log("=== SELF-TEST 4b/4: the MERGE-tree marker, the argument validators and D-10 idempotency");
    // HEAD is now the bot commit, so `base` is a REAL commit that is not HEAD. With
    // a format-valid but absent sha the arm above would refuse even without the
    // equality check (`git show` fails); a real older commit refuses ONLY on it.
    const notHead = capture(() =>
      gateDumpT({ repoRoot: repo, dump: join(dir, "dump.sql"), merge: base, runId: "1", cliVersion: "2.98.2", out: join(dir, "nh"), emit, gitleaks: cleanGl() }),
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
        gateDumpT({ repoRoot: repo, dump: dumpPath, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "arg"), emit, gitleaks: cleanGl(), ...bad }),
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
      gateDumpT({ repoRoot: repo, dump: committedDump, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "noop"), emit, gitleaks: cleanGl() }),
    );
    ok(
      noop.threw === null && /^::notice::baseline-redump: dump and marker are byte-identical to the committed pair — nothing to commit$/m.test(noop.text) &&
        outputs.join(",") === "changed=false" && !existsSync(join(dir, "noop")),
      "a dump and marker byte-identical to HEAD's committed pair: changed=false, a ::notice:: that says nothing is committed, and no out dir at all",
    );
    // $GITHUB_OUTPUT: exactly one `changed=` line per run when set; nothing when unset.
    const ghOut = join(dir, "github-output.txt");
    const savedGh = process.env.GITHUB_OUTPUT;
    let ghLines;
    let ghLinesAfterUnset;
    try {
      process.env.GITHUB_OUTPUT = ghOut;
      capture(() =>
        gateDumpT({ repoRoot: repo, dump: committedDump, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "gh1"), emit: emitToGithubOutput, gitleaks: cleanGl() }),
      );
      ghLines = readFileSync(ghOut, "utf8").split("\n").filter((l) => l.startsWith("changed="));
      delete process.env.GITHUB_OUTPUT;
      capture(() =>
        gateDumpT({ repoRoot: repo, dump: committedDump, merge: head2, runId: "1", cliVersion: "2.98.2", out: join(dir, "gh2"), emit: emitToGithubOutput, gitleaks: cleanGl() }),
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
      gateDumpT({ repoRoot: repo, dump: committedDump, merge: head3, runId: "1", cliVersion: "2.98.2", out: join(dir, "art3"), emit, gitleaks: cleanGl() }),
    );
    ok(
      newMig.threw === null && outputs.join(",") === "changed=true" &&
        markerBasenames(readFileSync(join(dir, "art3/baseline-carried-migrations.txt"), "utf8")).includes(M3),
      "an unchanged dump with a NEW committed migration at the merge is changed=true, and the marker carries it",
    );

    console.log("=== SELF-TEST 4b2/4: a dump proceeds only while main carries exactly the merge's migrations, on any run attempt (SFH-01, CR-03)");
    // A clone detached at head2 (the committed dump is a no-op there), whose `origin`
    // is a bare repository whose `main` this arm moves. gateDump runs with the REAL
    // anonymous fetch here: no mainListing is injected.
    const mainBare = join(dir, "main-listing.git");
    g(["init", "-q", "--bare", mainBare], { cwd: dir });
    const atHead2 = join(dir, "at-head2");
    g(["clone", "-q", repo, atHead2], { cwd: dir });
    g(["checkout", "-q", head2], { cwd: atHead2 });
    g(["remote", "set-url", "origin", mainBare], { cwd: atHead2 });
    const realMain = (over = {}) => {
      outputs.length = 0;
      const outDir = join(dir, `main-listing-out-${randomBytes(4).toString("hex")}`);
      const r = capture(() =>
        gateDump({
          repoRoot: atHead2, dump: committedDump, merge: head2, runId: "1", runAttempt: "1", cliVersion: "2.98.2", out: outDir, emit,
          gitleaks: cleanGl(), ...over,
        }),
      );
      return { ...r, wroteNothing: !existsSync(outDir) && outputs.length === 0 };
    };
    g(["push", "-q", mainBare, `${head3}:refs/heads/main`]);
    // D-31: a CHANGED dump, so a gate that fell through past the main-ahead skip
    // would write an out dir and emit changed=true, and this arm would go red.
    const aheadOut = join(dir, `main-ahead-out-${randomBytes(4).toString("hex")}`);
    outputs.length = 0;
    const ahead = capture(() =>
      gateDump({
        repoRoot: atHead2, dump: dumpPath, merge: head2, runId: "1", runAttempt: "1", cliVersion: "2.98.2", out: aheadOut, emit,
        gitleaks: cleanGl(),
      }),
    );
    ok(
      ahead.threw === null &&
        /^::notice::baseline-redump: main carries 1 migration\(s\) this merge does not: .*nothing is proposed \(D-31\)/m.test(ahead.text) &&
        ahead.text.includes("baseline-redump main-listing: differs from the merge's") && !ahead.text.includes(M3) &&
        outputs.join(",") === "changed=false" && !existsSync(aheadOut),
      "a CHANGED dump whose main (fetched anonymously) carries one more migration is skipped: a ::notice:: by count, never the name, changed=false, no out dir (D-31)",
    );
    // CR-03 / D-32: a re-run (attempt 2) with main ahead is the stale-re-run hazard
    // the removed attempt refusal was for; the main-listing verdict skips it.
    const ahead2Out = join(dir, `main-ahead2-out-${randomBytes(4).toString("hex")}`);
    outputs.length = 0;
    const ahead2 = capture(() =>
      gateDump({
        repoRoot: atHead2, dump: dumpPath, merge: head2, runId: "1", runAttempt: "2", cliVersion: "2.98.2", out: ahead2Out, emit,
        gitleaks: cleanGl(),
      }),
    );
    ok(
      ahead2.threw === null && ahead2.text.includes("baseline-redump attempt: 2 (the main-listing verdict decides a re-run)") &&
        /^::notice::baseline-redump: main carries 1 migration\(s\) this merge does not: .*\(D-31\)/m.test(ahead2.text) &&
        outputs.join(",") === "changed=false" && !existsSync(ahead2Out),
      "attempt 2 of a CHANGED dump whose main is ahead is skipped exactly as attempt 1 is: a ::notice::, changed=false, no out dir (CR-03, D-32)",
    );
    // R3-01: a stale re-run dumps PROD as it is now, so a later migration that dropped
    // an extension leaves the dump one CREATE EXTENSION short. With main ahead, the
    // main-listing verdict decides first: skipped with the D-31 notice, never refused
    // by the completeness floor. The last clause proves the dump IS one the floor refuses.
    const committedAtHead2 = g(["show", `${head2}:${BASELINE_SQL_REL}`]);
    const noCronText = committedAtHead2.replace(/^CREATE EXTENSION IF NOT EXISTS "pg_cron"[^\n]*\n/m, "");
    const noCronAtHead2 = join(dir, "no-cron-at-head2.sql");
    writeFileSync(noCronAtHead2, noCronText);
    const staleOut = join(dir, `main-ahead-stale-out-${randomBytes(4).toString("hex")}`);
    outputs.length = 0;
    const stale = capture(() =>
      gateDump({
        repoRoot: atHead2, dump: noCronAtHead2, merge: head2, runId: "1", runAttempt: "2", cliVersion: "2.98.2", out: staleOut, emit,
        gitleaks: cleanGl(),
      }),
    );
    ok(
      stale.threw === null && !stale.text.includes("completeness") &&
        /^::notice::baseline-redump: main carries 1 migration\(s\) this merge does not: .*\(D-31\)/m.test(stale.text) &&
        outputs.join(",") === "changed=false" && !existsSync(staleOut) &&
        judgeCompleteness(committedAtHead2, noCronText).defects.length === 1,
      "attempt 2, main ahead, a dump one CREATE EXTENSION short: skipped with the D-31 notice (changed=false, no out dir), not refused by the completeness floor (R3-01)",
    );
    g(["push", "-q", "--force", mainBare, `${head2}:refs/heads/main`]);
    const equal = realMain();
    ok(
      equal.threw === null && equal.text.includes("baseline-redump main-listing: equal to the merge's") && outputs.join(",") === "changed=false",
      "the same merge passes once main carries exactly its migrations: the real anonymous fetch reads main and the no-op proceeds",
    );
    // CR-03 / D-32: a re-run (attempt 2) while main carries exactly the merge's
    // migrations is a valid dump: PROD is the merge tree. A CHANGED dump, so the arm
    // proves the gate went all the way to writing the out dir.
    const equal2 = realMain({ runAttempt: "2", dump: dumpPath });
    ok(
      equal2.threw === null && equal2.text.includes("baseline-redump attempt: 2 (the main-listing verdict decides a re-run)") &&
        equal2.text.includes("baseline-redump main-listing: equal to the merge's") && outputs.join(",") === "changed=true" && !equal2.wroteNothing,
      "attempt 2 of a CHANGED dump while main carries exactly the merge's migrations proceeds: changed=true and an out dir is written (CR-03, D-32)",
    );
    const lacks = realMain({ mainListing: () => [M1] });
    ok(
      lacks.threw !== null && lacks.threw.message.startsWith("main lacks 1 migration(s) this merge carries") && lacks.wroteNothing,
      "a main that LACKS a migration the merge carries refuses too, naming the other direction by count",
    );
    g(["remote", "set-url", "origin", join(dir, "no-such-main-remote.git")], { cwd: atHead2 });
    const unmeasured = realMain();
    ok(
      unmeasured.threw !== null && /^MEASURE_FAIL: git fetch of main exit [0-9]+/.test(unmeasured.threw.message) && unmeasured.wroteNothing,
      "a main that cannot be fetched is MEASURE_FAIL and writes nothing: a comparison that could not run is never a match",
    );

    console.log("=== SELF-TEST 4e/4: --compose-and-push composes onto main and pushes HEAD to refs/heads/main with one frozen argv (D-25, CONTEXT A6)");
    const SENTINEL_TOKEN = "self-test-sentinel-token";
    // A local bare origin that carries a fresh clone's HEAD as `main`. A push to a local
    // path never invokes the credential helper, so the REAL pushToMain runs here.
    // Self-contained on purpose: it shares nothing with the fixtures above.
    let pushN = 0;
    const pushOrigin = () => {
      pushN += 1;
      const clone = freshClone();
      const bare = join(dir, `push-origin-${pushN}.git`);
      g(["init", "-q", "--bare", bare], { cwd: dir });
      g(["push", "-q", bare, "HEAD:refs/heads/main"], { cwd: clone });
      g(["remote", "set-url", "origin", bare], { cwd: clone });
      return { clone, bare };
    };
    const bareTip = (bare) => g(["rev-parse", "refs/heads/main"], { cwd: bare }).trim();
    const expectedPushArgv = [
      "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "origin", "HEAD:refs/heads/main",
    ];
    ok(
      JSON.stringify(PUSH_ARGV) === JSON.stringify(expectedPushArgv) && Object.isFrozen(PUSH_ARGV) &&
        PUSH_ARGV.filter((a) => a === "push").length === 1 && !PUSH_ARGV.some((a) => a.startsWith("+")) &&
        !PUSH_ARGV.some((a) => /^--(force|force-with-lease|mirror|all|tags|delete|prune)(=|$)/.test(a)),
      "PUSH_ARGV is the frozen seven elements, one push, HEAD:refs/heads/main, no plus prefix and no force, lease, mirror, all, tags, delete or prune flag (D-25)",
    );
    const envBoth = { GH_TOKEN: "a", GITHUB_TOKEN: "b", OTHER: "c" };
    const tokBoth = takePushToken(envBoth);
    const envOne = { GITHUB_TOKEN: "b" };
    const tokOne = takePushToken(envOne);
    const envNone = {};
    const tokNone = takePushToken(envNone);
    ok(
      tokBoth === "a" && JSON.stringify(envBoth) === JSON.stringify({ OTHER: "c" }) &&
        tokOne === "b" && Object.keys(envOne).length === 0 && tokNone === "" && Object.keys(envNone).length === 0,
      "takePushToken returns GH_TOKEN over GITHUB_TOKEN, an empty string for neither, and leaves neither key in the env it was given",
    );
    // The artifact `art2` composes on a fresh clone of `repo` (HEAD = head2, its merge), the
    // one the 4a arms compose; its own committed === true is asserted below.
    outputs.length = 0;
    const firstTry = pushOrigin();
    const firstBase = g(["rev-parse", "HEAD"], { cwd: firstTry.clone }).trim();
    let firstRes = null;
    const firstCap = capture(() => {
      firstRes = composeAndPush({
        repoRoot: firstTry.clone, inDir: join(dir, "art2"), runner: fakeRunner, emit, date: "2026-02-03", token: SENTINEL_TOKEN,
      });
    });
    const firstTip = bareTip(firstTry.bare);
    const firstVersion = g(["show", `${firstTip}:VERSION`], { cwd: firstTry.bare });
    ok(
      firstCap.threw === null && firstRes?.pushed === true && firstRes.attempts === 1 &&
        firstTip === g(["rev-parse", "HEAD"], { cwd: firstTry.clone }).trim() &&
        g(["rev-parse", `${firstTip}^`], { cwd: firstTry.bare }).trim() === firstBase &&
        g(["diff", "--name-only", `${firstTip}^`, firstTip], { cwd: firstTry.bare }).split("\n").filter(Boolean).sort().join(",") === STAGED_PATHS.join(",") &&
        /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(firstVersion) &&
        JSON.parse(g(["show", `${firstTip}:package.json`], { cwd: firstTry.bare })).version === firstVersion &&
        outputs.join(",") === "committed=true,pushed=true",
      "--compose-and-push: the real push lands the six-path commit on a bare origin's main on attempt 1, VERSION equal to package.json's as a 4-digit string, and emits committed=true then pushed=true",
    );
    outputs.length = 0;
    const noCred = pushOrigin();
    const noCredHead = g(["rev-parse", "HEAD"], { cwd: noCred.clone }).trim();
    let noCredPushes = 0;
    const noCredRun = capture(() =>
      composeAndPush({
        repoRoot: noCred.clone, inDir: join(dir, "art2"), runner: fakeRunner, emit, date: "2026-02-03", token: "",
        push: () => {
          noCredPushes += 1;
          return { status: 0 };
        },
      }),
    );
    ok(
      noCredRun.threw !== null && noCredRun.threw.message.startsWith("no push credential") &&
        g(["rev-parse", "HEAD"], { cwd: noCred.clone }).trim() === noCredHead &&
        g(["status", "--porcelain", "--", ...STAGED_PATHS], { cwd: noCred.clone }).trim() === "" &&
        noCredPushes === 0 && outputs.length === 0,
      "an empty token refuses with 'no push credential' before anything is composed: HEAD and the six paths are untouched and the push seam is never called (T-258-06)",
    );

    console.log("=== SELF-TEST 4f/4: a refused push retries by re-composing onto the fresh main, three attempts at most, never by force (CONTEXT)");
    // ONE commit by a non-bot author, pushed to the bare main: what a human merge does between
    // this run's compose and its push. `merge` moves VERSION, package.json and the top of
    // CHANGELOG.md, as every real merge does.
    let raceN = 0;
    const raceCommit = (bare, kind) => {
      raceN += 1;
      const work = join(dir, `race-work-${raceN}`);
      // `-b main`: the bare repo was created by `git init --bare` and holds only `main`. A git whose
      // init.defaultBranch is unset (ubuntu CI runners) points the bare HEAD at `master`, so a plain
      // clone would check out nothing.
      g(["clone", "-q", "-b", "main", bare, work], { cwd: dir });
      if (kind === "merge") {
        const oldV = readFileSync(join(work, "VERSION"), "utf8");
        const newV = nextVersion(oldV).text;
        writeFileSync(join(work, "VERSION"), newV);
        writeFileSync(join(work, "package.json"), bumpPackageJson(readFileSync(join(work, "package.json"), "utf8"), oldV, newV).text);
        writeFileSync(
          join(work, "CHANGELOG.md"),
          insertChangelogEntry(readFileSync(join(work, "CHANGELOG.md"), "utf8"), `## [${newV}] - 2026-02-02 — a race merge`).text,
        );
        g(["add", "--", "VERSION", "package.json", "CHANGELOG.md"], { cwd: work });
      } else if (kind === "same-pair") {
        writeFileSync(join(work, BASELINE_SQL_REL), readFileSync(join(dir, "art2/baseline.sql")));
        writeFileSync(join(work, MARKER_REL), readFileSync(join(dir, "art2/baseline-carried-migrations.txt")));
        g(["add", "--", BASELINE_SQL_REL, MARKER_REL], { cwd: work });
      } else if (kind === "newer-marker") {
        const landed = "20990101000000_race_landed.sql";
        writeFileSync(join(work, "supabase/migrations", landed), "SELECT 4;\n");
        writeFileSync(join(work, MARKER_REL), readFileSync(join(work, MARKER_REL), "utf8") + `${landed}\n`);
        g(["add", "--", `supabase/migrations/${landed}`, MARKER_REL], { cwd: work });
      } else {
        throw new Error(`self-test: unknown race kind ${kind}`);
      }
      g(["-c", "user.name=self-test human", "-c", "user.email=human@example.invalid", "commit", "-q", "-m", `a race ${kind} commit`], { cwd: work });
      g(["push", "-q", bare, "HEAD:refs/heads/main"], { cwd: work });
    };
    /** A push seam: on call i it first lands `kinds[i]` on the bare main (when defined), then runs the REAL pushToMain. */
    const racingPush = (bare, kinds) => {
      const f = ({ repoRoot, token }) => {
        const i = f.calls;
        f.calls += 1;
        f.tokens.push(token);
        if (kinds[i] !== undefined) {
          raceCommit(bare, kinds[i]);
          f.raceTips.push(bareTip(bare));
        }
        return pushToMain({ repoRoot, token });
      };
      f.calls = 0;
      f.tokens = [];
      f.raceTips = [];
      return f;
    };
    /** A seam that never touches the remote and always reports a refusal. */
    const refusingPush = () => {
      const f = () => {
        f.calls += 1;
        return { status: 1 };
      };
      f.calls = 0;
      return f;
    };
    /** The fake gate runner, recording whether a push credential was visible in process.env at each call. */
    const recordingRunner = ({ findingsOnDriftCall } = {}) => {
      const f = (cmd, args) => {
        f.calls += 1;
        f.leaks.push(process.env.GH_TOKEN !== undefined || process.env.GITHUB_TOKEN !== undefined);
        if (args[0] === "scripts/baseline-content-drift-check.mjs" && args.length === 1) {
          f.driftCalls += 1;
          if (f.driftCalls === findingsOnDriftCall) {
            return { status: 0, stdout: driftOut(["baseline-content-drift: findings 2"]), stderr: "" };
          }
        }
        return fakeRunner(cmd, args);
      };
      f.calls = 0;
      f.driftCalls = 0;
      f.leaks = [];
      return f;
    };
    const isAncestor = (bare, a, b) => {
      try {
        g(["merge-base", "--is-ancestor", a, b], { cwd: bare });
        return true;
      } catch {
        return false;
      }
    };
    /** composeAndPush as the 4f arms call it; `threw` is the Error or null, `res` its return value. */
    const pushRun = (o, extra = {}) => {
      outputs.length = 0;
      let res = null;
      const cap = capture(() => {
        res = composeAndPush({
          repoRoot: o.clone, inDir: join(dir, "art2"), runner: fakeRunner, emit, date: "2026-02-03", token: SENTINEL_TOKEN, ...extra,
        });
      });
      return { ...cap, res, outputs: [...outputs] };
    };

    const raced = pushOrigin();
    const racedBase = bareTip(raced.bare);
    const racedPush = racingPush(raced.bare, ["merge"]);
    const racedRun = pushRun(raced, { push: racedPush });
    const racedTip = bareTip(raced.bare);
    const racedVersion = racedPush.raceTips[0] ? g(["show", `${racedPush.raceTips[0]}:VERSION`], { cwd: raced.bare }) : "";
    const racedTipVersion = g(["show", `${racedTip}:VERSION`], { cwd: raced.bare });
    ok(
      racedRun.threw === null && racedRun.res?.pushed === true && racedRun.res.attempts === 2 && racedPush.calls === 2 &&
        racedPush.raceTips[0] !== racedBase && g(["rev-parse", `${racedTip}^`], { cwd: raced.bare }).trim() === racedPush.raceTips[0] &&
        isAncestor(raced.bare, racedPush.raceTips[0], racedTip) &&
        racedTipVersion === nextVersion(racedVersion).text &&
        JSON.parse(g(["show", `${racedTip}:package.json`], { cwd: raced.bare })).version === racedTipVersion &&
        g(["diff", "--name-only", `${racedTip}^`, racedTip], { cwd: raced.bare }).split("\n").filter(Boolean).sort().join(",") === STAGED_PATHS.join(",") &&
        /^::notice::baseline-redump: the push was refused because main moved/m.test(racedRun.text),
      "a push refused because main moved is retried by re-composing onto the fresh main: attempt 2 pushes a six-path commit whose parent is the race tip, VERSION one past the race's and equal to package.json's, and nothing was forced",
    );

    const stillMain = pushOrigin();
    const stillBefore = bareTip(stillMain.bare);
    const stillPush = refusingPush();
    const still = pushRun(stillMain, { push: stillPush });
    ok(
      still.threw !== null && /did not move/.test(still.threw.message) && /not a race/.test(still.threw.message) &&
        stillPush.calls === 1 && bareTip(stillMain.bare) === stillBefore,
      "a refused push with origin/main unmoved fails at once naming 'not a race' (auth, a ruleset or a network fault): one push call, the remote untouched",
    );

    const exhausted = pushOrigin();
    const exhaustedPush = racingPush(exhausted.bare, ["merge", "merge", "merge"]);
    const exhaustedRun = pushRun(exhausted, { push: exhaustedPush });
    ok(
      exhaustedRun.threw !== null && exhaustedRun.threw.message.includes("refused 3 time(s)") && exhaustedRun.threw.message.includes("main moved each time") &&
        exhaustedPush.calls === 3 && exhaustedPush.raceTips.length === 3 && bareTip(exhausted.bare) === exhaustedPush.raceTips[2],
      "three refused pushes with main moving each time fail red naming 'main moved each time': exactly three push calls, and the remote tip is the third race commit",
    );

    const samePair = pushOrigin();
    const samePairPush = racingPush(samePair.bare, ["same-pair"]);
    const samePairRun = pushRun(samePair, { push: samePairPush });
    ok(
      samePairRun.threw === null && samePairRun.res?.pushed === false && samePairRun.res.attempts === 2 &&
        samePairRun.outputs.join(",") === "committed=false,pushed=false" && samePairPush.calls === 1,
      "a race that lands the artifact's own pair on main makes the re-compose a no-op: pushed=false, committed=false emitted once, one push call",
    );

    const newerMarker = pushOrigin();
    const newerMarkerPush = racingPush(newerMarker.bare, ["newer-marker"]);
    const newerMarkerRun = pushRun(newerMarker, { push: newerMarkerPush });
    ok(
      newerMarkerRun.threw !== null && newerMarkerRun.threw.message.startsWith("the new marker omits 1 migration(s)") &&
        newerMarkerPush.calls === 1 && bareTip(newerMarker.bare) === newerMarkerPush.raceTips[0],
      "a race that lands a newer marker is refused by the re-compose ('the new marker omits 1 migration(s)'): one push call, the remote is the race tip",
    );

    const migMerge = pushOrigin();
    const migMergePush = racingPush(migMerge.bare, ["merge"]);
    const migMergeRun = pushRun(migMerge, { push: migMergePush, runner: recordingRunner({ findingsOnDriftCall: 2 }) });
    ok(
      migMergeRun.threw !== null &&
        migMergeRun.threw.message.includes("main holds a migration that has not applied to PROD yet; the queued apply run will produce the right dump") &&
        migMergePush.calls === 1,
      "a re-compose whose content-drift gate reports findings (a migration merged since) is refused naming the likely cause, after one push call",
    );

    const noFetch = pushOrigin();
    const noFetchBase = g(["rev-parse", "HEAD"], { cwd: noFetch.clone }).trim();
    g(["remote", "set-url", "origin", join(dir, "no-such-push-origin.git")], { cwd: noFetch.clone });
    const noFetchPush = refusingPush();
    const noFetchRun = pushRun(noFetch, { push: noFetchPush });
    ok(
      noFetchRun.threw !== null && /^MEASURE_FAIL: git fetch of main/.test(noFetchRun.threw.message) && noFetchPush.calls === 1 &&
        g(["rev-parse", "HEAD^"], { cwd: noFetch.clone }).trim() === noFetchBase,
      "a refused push whose main cannot be fetched is MEASURE_FAIL: whether main moved was not measured, and HEAD was not reset",
    );

    ok(
      refuses(() => fetchMainTip({ repoRoot: join(dir, "no-such-repo-root"), remote: "--upload-pack=x" }), /plain git remote name/),
      "fetchMainTip refuses a remote that is an option string before git is spawned",
    );

    const prevGh = process.env.GH_TOKEN;
    const prevGithub = process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "self-test-boundary-gh-sentinel";
    process.env.GITHUB_TOKEN = "self-test-boundary-github-sentinel";
    try {
      const taken = takePushToken(process.env);
      const boundary = pushOrigin();
      const boundaryPush = racingPush(boundary.bare, ["merge"]);
      const boundaryRunner = recordingRunner();
      const boundaryRun = pushRun(boundary, { push: boundaryPush, runner: boundaryRunner, token: taken });
      ok(
        boundaryRun.threw === null && boundaryRun.res?.attempts === 2 && boundaryRunner.calls >= 8 &&
          boundaryRunner.leaks.every((leaked) => leaked === false) &&
          process.env.GH_TOKEN === undefined && process.env.GITHUB_TOKEN === undefined &&
          boundaryPush.tokens.length === 2 && boundaryPush.tokens.every((t) => t === "self-test-boundary-gh-sentinel"),
        "across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN in process.env, and the push seam receives the token on both calls (T-258-01)",
      );
    } finally {
      if (prevGh === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = prevGh;
      if (prevGithub === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevGithub;
    }

    const skipOrigin = pushOrigin();
    const skipPush = refusingPush();
    const skipRun = pushRun(skipOrigin, { push: skipPush, date: tokenDate });
    ok(
      skipRun.threw !== null && /skip-token class 1 of 6/.test(skipRun.threw.message) && !skipRun.text.includes(tokenDate.slice(11)) &&
        skipPush.calls === 0,
      "a skip token in the composed text refuses before the commit with zero push calls, naming the class index and never the token (D-14, T-258-04)",
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
      // WR-03: the two rules this phase adds to .gitleaks.toml. The password rule is
      // path-scoped to a file named baseline.sql, which is the dump's name in redump-dump.
      const wr03File = join(gdir, "baseline.sql");
      const sbValue = ["sb", "_secret_"].join("") + randomBytes(24).toString("base64url");
      const pwValue = randomBytes(12).toString("hex");
      const pwUpper = randomBytes(12).toString("hex");
      const pwQuoted = randomBytes(12).toString("hex");
      writeFileSync(
        wr03File,
        `SET client_encoding = 'UTF8';\nCOMMENT ON TABLE "t" IS '${sbValue}';\n` +
          `CREATE SUBSCRIPTION "s" CONNECTION 'host=h ${["pass", "word="].join("")}${pwValue} dbname=d' PUBLICATION "p";\n` +
          `CREATE ROLE "r" ${["PASS", "WORD"].join("")} E'${pwUpper}';\n` +
          `CREATE SUBSCRIPTION "s" CONNECTION 'host=h ${["pass", "word="].join("")}''${pwQuoted}'' dbname=d' PUBLICATION "p";\n`,
      );
      const wr03 = capture(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: wr03File }));
      ok(
        wr03.threw !== null && wr03.text.includes("RuleID=supabase-secret-key line=2") && wr03.text.includes("RuleID=baseline-dump-password line=3") &&
          wr03.text.includes("RuleID=baseline-dump-password line=4") && wr03.text.includes("RuleID=baseline-dump-password line=5") &&
          !wr03.text.includes(sbValue) && !wr03.text.includes(pwValue) && !wr03.text.includes(pwUpper) && !wr03.text.includes(pwQuoted),
        "[real gitleaks] a runtime sb_secret_ key, a connection-string password, an upper-case PASSWORD E'' literal and a doubled-quote libpq password in baseline.sql all refuse by RuleID, printing no value (WR-03, WR-08, WR-10)",
      );
      // WR-08: the same ordinary-SQL lines the pure arm holds, in a file named
      // baseline.sql so the path-scoped rule is live, are no finding at all.
      mkdirSync(join(gdir, "neg"), { recursive: true });
      const negFile = join(gdir, "neg", "baseline.sql");
      writeFileSync(negFile, `SET client_encoding = 'UTF8';\n${pwNegatives.join("\n")}\n`);
      const neg = capture(() => runGitleaksGate({ gitleaks: counted, repoRoot: REPO_ROOT, target: negFile }));
      ok(
        neg.threw === null && neg.text.includes("baseline-redump gitleaks: 0 finding(s)"),
        "[real gitleaks] ordinary SQL naming a password column in baseline.sql is no finding: the baseline-dump-password rule has the script's narrowing (WR-08)",
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
        // CR-03: logged only (a re-run is judged by the main listing). It reaches the script through the runner's environment, never an expression.
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        cliVersion: f["--cli-version"],
        out: resolve(f["--out"]),
        emit: emitToGithubOutput,
        gitleaks: realGitleaks,
      });
      return 0;
    }
    if (argv[0] === "--compose-and-push") {
      // ⛔ FIRST statement: nothing below may spawn a child while the token is in process.env.
      const token = takePushToken(process.env);
      const f = parseFlags(argv.slice(1), ["--in"]);
      composeAndPush({
        repoRoot: cwdRepoRoot(),
        inDir: resolve(f["--in"]),
        runner: realRunner,
        emit: emitToGithubOutput,
        date: new Date().toISOString().slice(0, 10),
        token,
      });
      return 0;
    }
    // ⛔ A typo'd flag must not silently fall through to a green run.
    console.error(
      `::error::unknown argument(s): ${argv.join(" ") || "(none)"} — this script takes --self-test [--with-gitleaks], ` +
        `--gate-dump --dump --merge --run-id --cli-version --out, or --compose-and-push --in`,
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
