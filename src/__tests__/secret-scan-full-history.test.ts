/**
 * The scheduled full-history secret scan and its suppression contract
 * (Phase 242 SECRETSHYGIENE, SECR-03; decisions SCAN-SUPPRESS, SCAN-SCOPE,
 * SCAN-RED, AUTO-INSTALL, AUTO-CADENCE, AUTO-PIN).
 *
 * WHY THIS FILE EXISTS. The repo-root `.gitleaksignore` is the suppression
 * contract every gitleaks scan of this repo reads, and gitleaks fails SILENTLY
 * on a bad line in two ways, both measured on 8.30.1:
 *   - a three-part line (`file:rule:line`, no commit) is a GLOBAL fingerprint
 *     that suppresses that site in every past and future commit, so it would
 *     hide a real credential committed later at the same site;
 *   - anything after the fingerprint on the same line (an inline comment, a
 *     trailing space) makes the line malformed, logged at a low level, and inert.
 * The ignore-file shape pinned here is the only thing standing between a typo
 * and a silently inert or globally widened suppression. A scan alone cannot
 * catch the first (a global line makes the scan GREEN, which is the trap).
 *
 * Every predicate below is a function over ARBITRARY text, and the calibration
 * copies run through the SAME function, so a predicate that cannot fail is
 * caught by its own calibration in this file.
 *
 * Fixture values are built at runtime, never written as source literals.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IGNORE_TEXT = readFileSync(join(REPO_ROOT, ".gitleaksignore"), "utf8");
const WORKFLOW_FILE = "secret-scan-full-history.yml";
const WORKFLOW_TEXT = readFileSync(join(REPO_ROOT, ".github", "workflows", WORKFLOW_FILE), "utf8");
/** The sibling workflow that owns the sha256 literal; it is compared by equality, never restated here. */
const MIGRATE_TEXT = readFileSync(join(REPO_ROOT, ".github", "workflows", "supabase-migrate.yml"), "utf8");
const GITLEAKS_TOML = join(REPO_ROOT, ".gitleaks.toml");

const DEDUP_LABEL = "nightly-canary-failure:secret-scan-full-history";
const REPORT_IF = "always() && needs.scan.result != 'success'";
/** The only values the issue-filing script may read: none of them carries a file, line, commit or fingerprint. */
const REPORT_ENV_ALLOWED = ["FINDINGS", "JOB_RESULT", "REPO_NAME", "RUN_ID"];

/** `<40-hex commit>:<file>:<rule>:<line>`, nothing before it and nothing after it. */
const ENTRY_RE = /^[0-9a-f]{40}:[^:\s#]+:[a-z0-9-]+:[0-9]+$/;

// ABSENT ANCHOR IS A FINDING, NOT A VALUE. An unchecked indexOf -> slice
// degenerates (slice(-1) is the LAST character) and every assertion over the
// result then passes vacuously. Throw, and name the anchor.
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject text. ` +
        `Fix the anchor or the subject; do not default it.`,
    );
  }
  return at;
}

/** Replace exactly the first occurrence of `from`; a miss throws by name. */
function replaceOnce(text: string, from: string, to: string): string {
  const at = anchorIndex(text, from);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** The text with every whole-line YAML comment removed (a header may name a forbidden word in prose). */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}

/** A job's text, from its two-space key to the next two-space key (or the end of the file). */
function jobSlice(text: string, key: string): string {
  const start = anchorIndex(text, `\n  ${key}:\n`);
  const next = /\n {2}[A-Za-z0-9_-]+:\n/g;
  next.lastIndex = start + 1;
  const m = next.exec(text);
  return text.slice(start, m ? m.index : text.length);
}

const SCAN_STEP = "Scan the full history of main";
const SELFTEST_STEP = "Self-test the pinned binary";

/** One step's text (six-space `- name:` to the next step), or null when no step has that name prefix. */
function stepSlice(text: string, namePrefix: string): string | null {
  const start = text.indexOf(`      - name: ${namePrefix}`);
  if (start < 0) return null;
  const next = text.indexOf("\n      - ", start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

/** Replace the first `from` found at or after the named step's start; a miss throws by name. */
function replaceInStep(text: string, namePrefix: string, from: string, to: string): string {
  const start = anchorIndex(text, `      - name: ${namePrefix}`);
  const at = anchorIndex(text, from, start);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** Every line that is neither blank nor a whole-line `#` comment. */
function ignoreEntries(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));
}

/** Every entry line that is not exactly one four-part commit fingerprint. */
function ignoreEntryOffenders(text: string): string[] {
  return ignoreEntries(text).filter((l) => !ENTRY_RE.test(l));
}

/** Every blank-line-separated block that holds an entry but does not begin with a `#` line. */
function ungroupedEntries(text: string): string[] {
  const offenders: string[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const holdsEntry = lines.some((l) => !l.startsWith("#"));
    if (holdsEntry && !lines[0].startsWith("#")) offenders.push(block);
  }
  return offenders;
}

describe("the commit-scoped .gitleaksignore", () => {
  it("ignore file: every entry is a four-part commit fingerprint with nothing after it", () => {
    expect(ignoreEntryOffenders(IGNORE_TEXT)).toEqual([]);
  });

  it("ignore file: every group of entries opens with a reason comment", () => {
    expect(ungroupedEntries(IGNORE_TEXT)).toEqual([]);
  });

  it("ignore file: the entry count is at least 1", () => {
    // Anti-vacuity: an empty file passes both arms above.
    expect(ignoreEntries(IGNORE_TEXT).length).toBeGreaterThanOrEqual(1);
  });

  it("calibration: a three-part global line, an inline-comment line and an ungrouped entry are each refused by the predicates above", () => {
    const hex = randomBytes(20).toString("hex");
    const other = randomBytes(20).toString("hex");
    const good = `${hex}:src/a.ts:generic-api-key:3`;
    const goodTwo = `${other}:src/b.ts:jwt:9`;
    const grouped = `# why\n${good}\n\n# why too\n${goodTwo}\n`;
    const globalLine = "src/a.ts:generic-api-key:3";
    const inlineComment = `${good}  # fixture`;
    const trailingSpace = `${good} `;
    const ungrouped = `# why\n${good}\n\n${goodTwo}\n`;

    const verdicts: Array<[string, number]> = [
      ["well-formed grouped text, shape", ignoreEntryOffenders(grouped).length],
      ["well-formed grouped text, grouping", ungroupedEntries(grouped).length],
    ];
    const refused: Array<[string, number]> = [
      ["three-part global line", ignoreEntryOffenders(`# why\n${globalLine}\n`).length],
      ["inline comment after a fingerprint", ignoreEntryOffenders(`# why\n${inlineComment}\n`).length],
      ["trailing space after a fingerprint", ignoreEntryOffenders(`# why\n${trailingSpace}\n`).length],
      ["entry outside a commented group", ungroupedEntries(ungrouped).length],
    ];
    const misses: string[] = [];
    for (const [label, n] of verdicts) if (n !== 0) misses.push(`${label}: false positive (${n})`);
    for (const [label, n] of refused) if (n === 0) misses.push(`${label}: not refused`);
    expect(misses).toEqual([]);
  });
});

describe("the scheduled full-history scan workflow", () => {
  it("workflow: the scan step runs gitleaks git over main's HEAD, merge diffs included, with the repo config, redacted", () => {
    const scan = jobSlice(WORKFLOW_TEXT, "scan");
    const missing: string[] = [];
    for (const needle of ['gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD" --redact', "ref: main"]) {
      if (!scan.includes(needle)) missing.push(needle);
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workflow predicates. Each takes ARBITRARY workflow text and returns the list
// of problems it finds (empty = clean), so the calibration arms can feed it a
// bad copy and require a non-empty answer.
// ---------------------------------------------------------------------------

/** Trigger keys under `on:` must be exactly schedule + workflow_dispatch, and the schedule one daily cron. */
function triggerProblems(text: string): string[] {
  const problems: string[] = [];
  const start = anchorIndex(text, "\non:\n") + 1;
  const rest = text.slice(start + 4);
  const end = rest.search(/\n\S/);
  const block = stripComments(end < 0 ? rest : rest.slice(0, end));
  const keys = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
  if (keys.join(",") !== "schedule,workflow_dispatch") {
    problems.push(`trigger keys are [${keys.join(", ")}], expected exactly [schedule, workflow_dispatch]`);
  }
  const crons = [...block.matchAll(/- cron: "([^"]*)"/g)].map((m) => m[1]);
  if (crons.length !== 1 || !/^\d{1,2} \d{1,2} \* \* \*$/.test(crons[0])) {
    problems.push(`schedule is [${crons.join("; ")}], expected one daily cron`);
  }
  return problems;
}

/** The scan job checks out main with full history, never the dispatching ref. */
function checkoutProblems(text: string): string[] {
  const scan = stripComments(jobSlice(text, "scan"));
  const problems: string[] = [];
  if (!/^\s+ref: main\s*$/m.test(scan)) problems.push("scan checkout does not pin `ref: main`");
  if (!/^\s+fetch-depth: 0\s*$/m.test(scan)) problems.push("scan checkout is not `fetch-depth: 0`");
  if (!/^\s+persist-credentials: false\s*$/m.test(scan)) problems.push("scan checkout keeps credentials");
  return problems;
}

/** The scan command: main's HEAD with merge diffs, redacted, never verbose. */
function scanCommandProblems(text: string): string[] {
  const scan = stripComments(stepSlice(text, SCAN_STEP) ?? "");
  const problems: string[] = [];
  if (!scan.includes('gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD"')) {
    problems.push('scan command is not `gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD"`');
  }
  if (!scan.includes("--redact")) problems.push("scan command lacks --redact");
  if (/(^|\s)(-v|--verbose)(\s|$)/m.test(scan)) problems.push("scan command is verbose");
  return problems;
}

/**
 * The scan step must be able to turn the job red, and must not read clean when gitleaks scanned
 * nothing: `--exit-code 2`, a final `exit "${rc}"`, a MEASURE_FAIL branch for an incomplete run, an
 * ERR-line and commit-count coverage check, no `continue-on-error`, and no `|| true` on the scan.
 */
function failRedProblems(text: string): string[] {
  const job = stripComments(jobSlice(text, "scan"));
  const step = stripComments(stepSlice(text, SCAN_STEP) ?? "");
  const problems: string[] = [];
  if (!/--exit-code 2(\s|$)/m.test(step)) problems.push("scan step lacks `--exit-code 2`");
  const lastLine = step.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  if (lastLine !== 'exit "${rc}"') problems.push('scan step does not end with `exit "${rc}"`');
  for (const needle of [
    "MEASURE_FAIL: gitleaks exited",
    "MEASURE_FAIL: gitleaks scanned",
    "grep -aq ' ERR ' \"${log}\"",
    '[ "${got}" != "${want}" ]',
    "want=$(git log --remerge-diff",
    '! [ "${want}" -gt 0 ]',
    '($1+$2)>0',
  ]) {
    if (!step.includes(needle)) problems.push(`scan step lacks \`${needle}\``);
  }
  if (/continue-on-error/.test(job)) problems.push("the scan job sets continue-on-error");
  if (/\|\|\s*(true|:)(\s|$)/m.test(step)) problems.push("the scan step swallows a failure with `|| true`");
  const command = /gitleaks git [\s\S]*?\n(?=\s*rc=\$\?)/.exec(step)?.[0] ?? "";
  if (command === "") problems.push("`rc=$?` does not directly follow the gitleaks command");
  else if (command.includes("||")) problems.push("the gitleaks command carries a `||` fallback");
  if (!command.includes("--no-color")) problems.push("the gitleaks command lacks --no-color, so the ERR check is blind to coloured levels");
  if (!/MEASURE_FAIL: gitleaks scanned[^\n]*\n\s*exit 1\n\s*fi\b/.test(step)) {
    problems.push("the coverage MEASURE_FAIL branch does not end in `exit 1`");
  }
  if (/^ {8}if:/m.test(step)) problems.push("the scan step has a step-level `if:`");
  const afterRc = step.slice(step.indexOf("rc=$?") + "rc=$?".length);
  if (/^\s*rc=/m.test(afterRc)) problems.push("`rc` is reassigned after the gitleaks command");
  const exits = [...afterRc.matchAll(/^\s*exit\b.*$/gm)].map((m) => m[0].trim());
  if (exits.join("|") !== 'exit 1|exit "${rc}"') problems.push(`exits after the gitleaks command are [${exits.join(" | ")}], expected [exit 1 | exit "\${rc}"]`);
  return problems;
}

/**
 * The scan job proves the pinned binary before it scans: a planted fixture exits 2, a four-part
 * fingerprint suppresses exactly its own commit's finding, and merge-only content is detected.
 */
function selfTestProblems(text: string): string[] {
  const raw = stepSlice(text, SELFTEST_STEP);
  if (raw === null) return ["the pre-scan self-test step is absent"];
  const step = stripComments(raw);
  const problems: string[] = [];
  const scanAt = text.indexOf(`      - name: ${SCAN_STEP}`);
  if (scanAt >= 0 && text.indexOf(`      - name: ${SELFTEST_STEP}`) > scanAt) problems.push("the self-test runs after the scan");
  if (!step.includes('--log-opts="--remerge-diff HEAD"')) problems.push("the self-test does not scan with --remerge-diff");
  if (!step.includes("--exit-code 2")) problems.push("the self-test does not use --exit-code 2");
  for (const needle of [
    'fail() { echo "::error::MEASURE_FAIL: gitleaks self-test: $1"; exit 1; }',
    'fixture "RSA PRIVATE KEY" > src/planted.pem',
    "g merge -q --no-ff --no-commit side",
    'g commit -q -m "plant only in the merge commit"',
    '[ "${rc}" -eq 2 ] || fail "a planted fixture exited',
    '|| fail "expected 3 findings',
    '[ "${rc}" -eq 2 ] || fail "after suppressing one commit',
    '|| fail "a four-part line did not suppress exactly its own commit',
    "src/planted.pem:private-key:1",
    '|| fail "a three-part line did not suppress both same-site findings.',
    "%s  # inline",
    '|| fail "an inline comment did not void the line.',
    'echo "gitleaks self-test passed"',
  ]) {
    if (!step.includes(needle)) problems.push(`the self-test lacks \`${needle}\``);
  }
  if (/continue-on-error|\|\|\s*(true|:)(\s|$)/.test(step)) problems.push("the self-test can swallow a failure");
  if (/^ {8}if:/m.test(step)) problems.push("the self-test step has a step-level `if:`");
  return problems;
}

/** The pinned version, and the sha256 equal to the one in the sibling workflow. */
function binaryPinProblems(text: string, migrateText: string): string[] {
  const problems: string[] = [];
  if (!/^\s+GITLEAKS_VERSION: 8\.30\.1\s*$/m.test(text)) problems.push("GITLEAKS_VERSION is not 8.30.1");
  const own = /^\s+GITLEAKS_SHA256: ([0-9a-f]{64})\s*$/m.exec(text);
  const theirs = /^\s+GITLEAKS_SHA256: ([0-9a-f]{64})\s*$/m.exec(migrateText);
  if (!own) problems.push("GITLEAKS_SHA256 is absent or not 64 lowercase hex");
  if (!theirs) problems.push("the sibling workflow's GITLEAKS_SHA256 could not be read");
  if (own && theirs && own[1] !== theirs[1]) problems.push("GITLEAKS_SHA256 differs from the sibling workflow's");
  if (!text.includes("sha256sum -c")) problems.push("the tarball is not verified with sha256sum -c");
  return problems;
}

/** The report never leaves the runner: nothing uploads, downloads, adds, commits or pushes it. */
function reportEscapeProblems(text: string): string[] {
  const code = stripComments(text);
  const problems: string[] = [];
  for (const re of [/upload-artifact/, /download-artifact/, /git (add|commit|push)\b/]) {
    if (re.test(code)) problems.push(`workflow matches ${re}`);
  }
  return problems;
}

/** `issues: write` is held by the report job and nowhere else. */
function issuesWriteProblems(text: string): string[] {
  const report = jobSlice(text, "report");
  const outside = stripComments(text.replace(report, ""));
  const problems: string[] = [];
  if (/^\s*issues:\s*write\s*$/m.test(outside)) problems.push("`issues: write` is granted outside the report job");
  const inside = stripComments(report).match(/^\s*issues:\s*write\s*$/gm) ?? [];
  if (inside.length !== 1) problems.push(`the report job grants issues: write ${inside.length} times, expected once`);
  return problems;
}

/** The report job's trigger, label, and what its script may read or contain. */
function reportJobProblems(text: string): string[] {
  const report = jobSlice(text, "report");
  const code = stripComments(report);
  const problems: string[] = [];
  if (!/^ {4}needs: \[scan\]\s*$/m.test(code)) problems.push("report does not `needs: [scan]`");
  if (!code.includes(`if: ${REPORT_IF}`)) problems.push(`report is not gated by \`if: ${REPORT_IF}\``);
  if (!code.includes(`const dedupLabel = "${DEDUP_LABEL}";`)) problems.push("report does not use the dedup label");
  const envKeys = [...code.matchAll(/^ {10}([A-Z_]+): \$\{\{/gm)].map((m) => m[1]).sort();
  for (const k of envKeys) if (!REPORT_ENV_ALLOWED.includes(k)) problems.push(`report env carries ${k}`);
  for (const k of REPORT_ENV_ALLOWED) if (!envKeys.includes(k)) problems.push(`report env lacks ${k}`);
  const script = code.slice(anchorIndex(code, "script: |"));
  if (script.includes("${{")) problems.push("the report script interpolates a workflow expression");
  const read = [...script.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
  for (const k of read) if (!REPORT_ENV_ALLOWED.includes(k)) problems.push(`report script reads ${k}`);
  const destructured = /const \{([^}]*)\} = process\.env;/.exec(script);
  for (const k of (destructured?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!REPORT_ENV_ALLOWED.includes(k)) problems.push(`report script destructures ${k}`);
  }
  if (/readFileSync|require\(["']node:fs["']\)|\.File\b|StartLine|Fingerprint/.test(script)) {
    problems.push("the report script reads a file or a finding field");
  }
  const uses = [...code.matchAll(/^\s+- uses: (\S+)|^\s+uses: (\S+)/gm)].map((m) => (m[1] ?? m[2]).split("@")[0]);
  if (uses.join(",") !== "actions/github-script") problems.push(`report uses [${uses.join(", ")}], expected only actions/github-script`);
  return problems;
}

/**
 * The labels of the bad copies a predicate wrongly accepts. A copy whose CODE (comments stripped) equals the
 * real workflow's is reported too: a calibration that edits only a comment proves nothing.
 */
function acceptedBad(bad: Record<string, string>, predicate: (text: string) => string[]): string[] {
  const realCode = stripComments(WORKFLOW_TEXT);
  const out: string[] = [];
  for (const [label, text] of Object.entries(bad)) {
    if (stripComments(text) === realCode) out.push(`${label} (the calibration changed no code)`);
    else if (predicate(text).length === 0) out.push(label);
  }
  return out;
}

describe("workflow pins, each calibrated RED on a bad copy of the real text", () => {
  it("workflow: the triggers are schedule and workflow_dispatch only, on one daily cron", () => {
    expect(triggerProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "a pull_request trigger": replaceOnce(WORKFLOW_TEXT, "  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n"),
      "a push trigger": replaceOnce(WORKFLOW_TEXT, "  workflow_dispatch:\n", "  workflow_dispatch:\n  push:\n"),
      "a merge_group trigger": replaceOnce(WORKFLOW_TEXT, "  workflow_dispatch:\n", "  workflow_dispatch:\n  merge_group:\n"),
      "a pull_request_target trigger": replaceOnce(WORKFLOW_TEXT, "  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request_target:\n"),
      "no dispatch": replaceOnce(WORKFLOW_TEXT, "  workflow_dispatch:\n", ""),
      "a weekly cron": replaceOnce(WORKFLOW_TEXT, '"30 5 * * *"', '"30 5 * * 1"'),
    };
    const accepted = acceptedBad(bad, (t) => triggerProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: the scan job checks out main with full history", () => {
    expect(checkoutProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "no ref pin": replaceOnce(WORKFLOW_TEXT, "          ref: main\n", ""),
      "the dispatching ref": replaceOnce(WORKFLOW_TEXT, "ref: main", "ref: ${{ github.ref }}"),
      "a shallow clone": replaceOnce(WORKFLOW_TEXT, "fetch-depth: 0", "fetch-depth: 1"),
    };
    const accepted = acceptedBad(bad, (t) => checkoutProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: the scan command is main's HEAD with merge diffs, redacted, and never verbose", () => {
    expect(scanCommandProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "no --redact": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, '--log-opts="--remerge-diff HEAD" --redact', '--log-opts="--remerge-diff HEAD"'),
      "-v": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, " --no-color \\\n", " --no-color -v \\\n"),
      "--verbose": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, " --no-color \\\n", " --no-color --verbose \\\n"),
      "every ref": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, '--log-opts="--remerge-diff HEAD"', "--log-opts=--all"),
      "plain HEAD, so merge commits' own diffs are never scanned": replaceInStep(
        WORKFLOW_TEXT,
        SCAN_STEP,
        '--log-opts="--remerge-diff HEAD"',
        "--log-opts=HEAD",
      ),
    };
    const accepted = acceptedBad(bad, (t) => scanCommandProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: the scan step fails red, and refuses a clean verdict that scanned nothing", () => {
    expect(failRedProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "--exit-code 0": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, "--exit-code 2", "--exit-code 0"),
      'a final exit 0 instead of exit "${rc}"': replaceInStep(WORKFLOW_TEXT, SCAN_STEP, '          exit "${rc}"\n', "          exit 0\n"),
      "continue-on-error on the scan step": replaceInStep(
        WORKFLOW_TEXT,
        SCAN_STEP,
        "        run: |\n          set -uo pipefail\n          report=",
        "        continue-on-error: true\n        run: |\n          set -uo pipefail\n          report=",
      ),
      "|| true on the gitleaks command": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, '2> "${log}"\n', '2> "${log}" || true\n'),
      "no MEASURE_FAIL for an incomplete run": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, "MEASURE_FAIL: gitleaks exited", "gitleaks exited"),
      "no ERR-line check": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, "grep -aq ' ERR ' \"${log}\" || ", ""),
      "no commit-count comparison": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, ' || [ "${got}" != "${want}" ]', ""),
      "a coverage branch that exits 0": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, "            exit 1\n          fi", "            exit 0\n          fi"),
      "no --no-color (the ERR check goes blind)": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, " --redact --no-banner --no-color \\\n", " --redact --no-banner \\\n"),
      "a step-level if: false": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, `      - name: ${SCAN_STEP}\n`, `      - name: ${SCAN_STEP}\n        if: false\n`),
      "an exit 0 right after rc=$?": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, "          rc=$?\n", "          rc=$?\n          exit 0\n"),
      "rc reset to 0 before the final exit": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, '          cat "${log}" >&2\n', '          cat "${log}" >&2\n          rc=0\n'),
      "no floor on the expected count": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, '! [ "${want}" -gt 0 ] || ', ""),
      "a count that includes zero-line changes": replaceInStep(WORKFLOW_TEXT, SCAN_STEP, " && ($1+$2)>0", ""),
    };
    const accepted = acceptedBad(bad, (t) => failRedProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit", () => {
    expect(selfTestProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "no self-test step": replaceOnce(WORKFLOW_TEXT, `      - name: ${SELFTEST_STEP}`, "      - name: Something else"),
      "a self-test that does not demand exit 2": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, '[ "${rc}" -eq 2 ] || fail "a planted fixture', "true || fail \"a planted fixture"),
      "a self-test that does not count the suppression": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, '|| fail "a four-part line did not suppress exactly', '|| true # a four-part line did not suppress exactly'),
      "a self-test with no three-part check": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, '|| fail "a three-part line did not', '|| true # a three-part line did not'),
      "a self-test with no inline-comment check": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, '|| fail "an inline comment did not', '|| true # an inline comment did not'),
      "a self-test whose fixtures sit at different paths": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, 'fixture "RSA PRIVATE KEY" > src/planted.pem', 'fixture "RSA PRIVATE KEY" > src/planted-two.pem'),
      "a self-test with no merge-only plant": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, "g merge -q --no-ff --no-commit side", "g merge -q --no-ff side"),
      "a fail() that does not exit": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, 'gitleaks self-test: $1"; exit 1; }', 'gitleaks self-test: $1"; }'),
      "a step-level if: false on the self-test": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, "        run: |\n          set -euo pipefail\n          t=", "        if: false\n        run: |\n          set -euo pipefail\n          t="),
      "a self-test blind to merge-only content": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, '--log-opts="--remerge-diff HEAD"', "--log-opts=HEAD"),
      "a self-test that cannot fail": replaceInStep(WORKFLOW_TEXT, SELFTEST_STEP, "        run: |\n          set -euo pipefail\n          t=", "        continue-on-error: true\n        run: |\n          set -euo pipefail\n          t="),
    };
    const accepted = acceptedBad(bad, (t) => selfTestProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: the binary is the pinned 8.30.1 and its sha256 equals supabase-migrate.yml's", () => {
    expect(binaryPinProblems(WORKFLOW_TEXT, MIGRATE_TEXT)).toEqual([]);
    const own = /GITLEAKS_SHA256: ([0-9a-f]{64})/.exec(WORKFLOW_TEXT);
    if (!own) throw new Error("ANCHOR MISSING: GITLEAKS_SHA256 in the workflow");
    const flipped = (own[1][0] === "0" ? "1" : "0") + own[1].slice(1);
    const bad: Record<string, string> = {
      "one hex character flipped": replaceOnce(WORKFLOW_TEXT, own[1], flipped),
      "another version": replaceOnce(WORKFLOW_TEXT, "GITLEAKS_VERSION: 8.30.1", "GITLEAKS_VERSION: 8.24.3"),
      "no checksum verification": replaceOnce(WORKFLOW_TEXT, "sha256sum -c", "cat"),
    };
    const accepted = acceptedBad(bad, (t) => binaryPinProblems(t, MIGRATE_TEXT));
    expect(accepted).toEqual([]);
  });

  it("workflow: the report is never uploaded, downloaded, added, committed or pushed", () => {
    expect(reportEscapeProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "an upload-artifact step": replaceOnce(
        WORKFLOW_TEXT,
        "      - name: Count findings",
        "      - uses: actions/upload-artifact@0000000000000000000000000000000000000000\n        with:\n          path: x\n      - name: Count findings",
      ),
      "a git add of the report": replaceOnce(WORKFLOW_TEXT, '          echo "gitleaks exit code: ${rc}"', '          git add "${report}"'),
      "a git commit": replaceOnce(WORKFLOW_TEXT, '          echo "gitleaks exit code: ${rc}"', "          git commit -m x"),
      "a git push": replaceOnce(WORKFLOW_TEXT, '          echo "gitleaks exit code: ${rc}"', "          git push"),
    };
    const accepted = acceptedBad(bad, (t) => reportEscapeProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: issues: write is granted to the report job and to nothing else", () => {
    expect(issuesWriteProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "in the scan job": replaceOnce(WORKFLOW_TEXT, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    permissions:\n      issues: write\n"),
      "at the top level": replaceOnce(WORKFLOW_TEXT, "permissions:\n  contents: read\n", "permissions:\n  contents: read\n  issues: write\n"),
    };
    const accepted = acceptedBad(bad, (t) => issuesWriteProblems(t));
    expect(accepted).toEqual([]);
  });

  it("workflow: the report job files one deduplicated issue from a count and a run link only", () => {
    expect(reportJobProblems(WORKFLOW_TEXT)).toEqual([]);
    const bad: Record<string, string> = {
      "an always-red condition": replaceOnce(WORKFLOW_TEXT, `if: ${REPORT_IF}`, "if: always()"),
      "another dedup label": replaceOnce(WORKFLOW_TEXT, `const dedupLabel = "${DEDUP_LABEL}";`, 'const dedupLabel = "nightly-canary-failure:other";'),
      "an extra env value": replaceOnce(WORKFLOW_TEXT, "          FINDINGS: ", "          LOCATION: ${{ needs.scan.outputs.location }}\n          FINDINGS: "),
      "an interpolated expression in the script": replaceOnce(WORKFLOW_TEXT, "const today", "const leak = `${{ needs.scan.outputs.findings }}`;\n            const today"),
      "a file read": replaceOnce(WORKFLOW_TEXT, "const today", 'const raw = require("node:fs").readFileSync("report.json", "utf8");\n            const today'),
      "a download-artifact step": replaceOnce(
        WORKFLOW_TEXT,
        "      - name: Open or update",
        "      - uses: actions/download-artifact@0000000000000000000000000000000000000000\n      - name: Open or update",
      ),
    };
    const accepted = acceptedBad(bad, (t) => reportJobProblems(t));
    expect(accepted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behavioural arm: the real scanner, on a throwaway repo, with fixture values
// built at runtime. It proves the three properties the ignore-file shape pin
// rests on, so the pin cannot be a belief about gitleaks.
// ---------------------------------------------------------------------------
function gitleaksAvailable(): boolean {
  return spawnSync("gitleaks", ["version"], { encoding: "utf8" }).status === 0;
}
const HAS_GITLEAKS = gitleaksAvailable();

describe("gitleaks .gitleaksignore scoping, on a throwaway repo (real binary)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const SITE = "src/lib/leaky.pem";

  /** Runs one scan of `dir` and returns the findings' Fingerprint values (never Match or Secret). */
  function scan(dir: string): string[] {
    const reportPath = join(dir, "..", `${dir.split("/").pop()}-${randomBytes(4).toString("hex")}.json`);
    const r = spawnSync(
      "gitleaks",
      ["git", dir, "--config", GITLEAKS_TOML, "--redact", "--no-banner", "--report-format", "json", "--report-path", reportPath, "--exit-code", "7"],
      { encoding: "utf8" },
    );
    if (r.status !== 0 && r.status !== 7) {
      throw new Error(`gitleaks did not complete (exit ${r.status}): ${r.stderr}`);
    }
    const raw = readFileSync(reportPath, "utf8").trim();
    rmSync(reportPath, { force: true });
    if (raw === "" || raw === "[]") return [];
    return (JSON.parse(raw) as Array<{ Fingerprint: string }>).map((f) => f.Fingerprint);
  }

  it.skipIf(!HAS_GITLEAKS)(
    "a four-part line suppresses only its own commit, a three-part line suppresses every commit, an inline comment voids the line",
    () => {
      const root = mkdtempSync(join(tmpdir(), "secret-scan-scope-"));
      dirs.push(root);
      const dir = join(root, "repo");
      mkdirSync(join(dir, "src", "lib"), { recursive: true });
      const git = (...args: string[]) => {
        const r = spawnSync("git", ["-c", "user.name=scope-test", "-c", "user.email=scope-test@example.invalid", ...args], { cwd: dir, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
        return r.stdout.trim();
      };
      git("init", "-q");
      // Two DIFFERENT runtime-built values at the SAME file and line, in two commits.
      // A private-key block is detected by shape alone; a random api_key assignment slipped past the
      // generic rule's entropy/stopword filters in about 3 runs in 100, so this arm flaked. The two
      // blocks differ on every line (header, body, footer), so the second commit's -U0 hunk is a whole block.
      const fixture = (kind: string) => `-----BEGIN ${kind}-----\n${randomBytes(96).toString("base64")}\n-----END ${kind}-----\n`;
      writeFileSync(join(dir, SITE), fixture("PRIVATE KEY"));
      git("add", SITE);
      git("commit", "-q", "-m", "fixture a");
      const commitA = git("rev-parse", "HEAD");
      writeFileSync(join(dir, SITE), fixture("RSA PRIVATE KEY"));
      git("add", SITE);
      git("commit", "-q", "-m", "fixture b");

      const ignorePath = join(dir, ".gitleaksignore");
      const withIgnore = (text: string | null): string[] => {
        if (text === null) rmSync(ignorePath, { force: true });
        else writeFileSync(ignorePath, text);
        return scan(dir);
      };

      const none = withIgnore(null);
      // Anti-vacuity: with no ignore file both commits are findings.
      expect(none.length).toBe(2);
      const fingerprintA = none.find((f) => f.startsWith(`${commitA}:`));
      if (!fingerprintA) throw new Error("ANCHOR MISSING: no finding at the first commit");

      const counts = {
        "no ignore file": none.length,
        "only the first commit's four-part line": withIgnore(`# why\n${fingerprintA}\n`).length,
        "the three-part global line": withIgnore(`# why\n${SITE}:private-key:1\n`).length,
        "the four-part line followed by an inline comment": withIgnore(`# why\n${fingerprintA}  # inline\n`).length,
      };
      expect(counts).toEqual({
        "no ignore file": 2,
        "only the first commit's four-part line": 1,
        "the three-part global line": 0,
        "the four-part line followed by an inline comment": 2,
      });
    },
    120_000,
  );
});
