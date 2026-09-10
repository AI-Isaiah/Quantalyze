/**
 * test-restore-from-baseline WIRING PIN — Phase 164.8 plan 03.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. `scripts/restore-test-from-baseline.sh` proves its
 * own contract with `--self-test`: every arm counted against its own `EXPECTED_ARMS`
 * constant, each with a falsifier that was observed RED (`164.8-02-SUMMARY.md`). The
 * tally is printed by `bash scripts/restore-test-from-baseline.sh --self-test`; a
 * numeral restated here would be stale the first time an arm is added, so it is not.
 * NONE of that survives a WORKFLOW that invokes it differently. A second trigger key,
 * a commented-out `environment:`, a
 * backup step that drifts below the script step, a fork-PR `exit 0` surviving inside
 * the credential branch, or an ancestry assert that passes on a non-ancestor sha —
 * each turns a proven mechanism into a destructive act with no proof around it. The
 * script's arms cannot see any of them. This file is what does.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A MUTATED
 * COPY (the `src/__tests__/prod-prober-wiring.test.ts` idiom). A predicate only ever
 * applied to the passing input is not evidence — it can be satisfied by a function
 * that matches anything. `calibrate()` asserts the mutant genuinely differs, asserts
 * the predicate holds on the real file, and asserts it FLIPS on the mutant.
 *
 * ⭐ AND THE W5 PREMISE ASSERT IS EXECUTED, NOT GREPPED. The two steps that decide
 * whether PROD's ledger really equals the repo file set are EXTRACTED out of the YAML
 * and RUN — against a throwaway git repository, with a stub `gh` on PATH — and this
 * file asserts on their exit codes. A grep pin goes green the moment someone keeps
 * the strings and guts the logic, which is the likelier regression
 * (`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` is the precedent).
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const WF_PATH = ".github/workflows/test-restore-from-baseline.yml";
const CI_PATH = ".github/workflows/ci.yml";
const SCRIPT_PATH = "scripts/restore-test-from-baseline.sh";
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const WF = read(WF_PATH);
const CI = read(CI_PATH);
const SCRIPT = read(SCRIPT_PATH);

// ⛔ SPLIT ON PURPOSE, and it is NOT superstition. Both fixtures below are
// synthetic — EXAMPLE_ placeholders at `example.invalid` — but a contiguous
// `<scheme>://user:pass@host` literal is DSN-SHAPED, and the pre-push secret
// scanner matches on shape, not on whether the password is real. Written out
// whole, these two lines fail every push of this branch, and the only way past
// is to disarm the scanner — which would then also be disarmed for a real
// credential. Assembling the scheme at runtime keeps the guardrail armed and
// leaves the fixtures byte-identical AT RUNTIME, so the redaction twins below
// exercise exactly the string they did before. Same idiom as the SKELETON
// needle in restore-test-from-baseline.test.ts, for the same reason.
const SCHEME = `${"postgres"}${"ql://"}`;

const RESTORE_JOB = "restore";
const GUARD_JOB = "dispatch-guard";

/**
 * The acquire / release steps, from their `- name:` line (6-space step indent) to the
 * next sibling step or comment at that indent — the SAME regex shape
 * `critical-regressions.test.ts` uses for its three-way byte-identity pin, so the two
 * files cannot disagree about what "the step" is. The release variant also stops at a
 * job header, because in `ci.yml` that step is the last one in `sql-tests`.
 */
const ACQUIRE_RE = /^ {6}- name: Acquire shared-test-db mutex\n[\s\S]*?(?=\n {6}[-#])/m;
const RELEASE_RE =
  /^ {6}- name: Release shared-test-db mutex \(best effort\)\n[\s\S]*?(?=\n {6}[-#]|\n {2}\S)/m;
/** The line the byte-identical suffix begins at. Everything before it is ours. */
const SUFFIX_ANCHOR = "          if ! command -v psql";

// ---------------------------------------------------------------------------
// Predicates. Every one takes TEXT, so each can be run against a mutant.
// ---------------------------------------------------------------------------

/** A job's block, header line included, up to the next 2-space job key. */
function jobBlock(text: string, job: string): string {
  const head = `\n  ${job}:\n`;
  const start = text.indexOf(head);
  if (start < 0) return "";
  const after = text.slice(start + head.length);
  const next = after.match(/\n {2}[A-Za-z_][\w-]*:\n/);
  return head + (next ? after.slice(0, next.index) : after);
}

/** The lines under the top-level `on:` key, up to the next column-0 key. */
function onBlockLines(text: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l === "on:");
  if (i < 0) return [];
  const out: string[] = [];
  for (let k = i + 1; k < lines.length; k += 1) {
    if (/^\S/.test(lines[k])) break;
    out.push(lines[k]);
  }
  return out;
}

/** Trigger keys only — the 2-space keys under `on:`, comments excluded. */
function triggerKeys(text: string): string[] {
  return onBlockLines(text)
    .filter((l) => /^ {2}[A-Za-z_]/.test(l))
    .map((l) => l.trim().replace(/:.*$/, ""));
}

/** The `mode` input's declared shape, read out of the `on:` block. */
function modeInput(text: string): {
  type: string | null;
  options: string[];
  default: string | null;
} {
  const lines = onBlockLines(text);
  const i = lines.findIndex((l) => l === "      mode:");
  const spec = { type: null as string | null, options: [] as string[], default: null as string | null };
  if (i < 0) return spec;
  let inOptions = false;
  for (let k = i + 1; k < lines.length; k += 1) {
    if (/^ {6}\S/.test(lines[k])) break; // the next input key
    const t = lines[k].trim();
    if (t === "options:") {
      inOptions = true;
      continue;
    }
    if (inOptions && t.startsWith("- ")) {
      spec.options.push(t.slice(2));
      continue;
    }
    inOptions = false;
    if (t.startsWith("type:")) spec.type = t.slice("type:".length).trim();
    if (t.startsWith("default:")) spec.default = t.slice("default:".length).trim();
  }
  return spec;
}

/** Non-comment lines of a block. A commented-out fence is not a fence. */
function liveLines(block: string): string[] {
  return block.split("\n").filter((l) => !/^\s*#/.test(l));
}

/** How many LIVE lines of the block are exactly this (trimmed) text. */
function liveLineCount(block: string, exact: string): number {
  return liveLines(block).filter((l) => l.trim() === exact).length;
}

/**
 * The line index of a command that must be EXECUTED, not merely mentioned. Matches a
 * flow-scalar `run: <cmd>` and a `<cmd>` line inside a block scalar, by EXACT trimmed
 * equality — so `... --self-test` never satisfies a pin on the bare command.
 */
function liveCommandIndex(block: string, cmd: string): number {
  const lines = block.split("\n");
  return lines.findIndex(
    (l) => !/^\s*#/.test(l) && (l.trim() === cmd || l.trim() === `run: ${cmd}`),
  );
}

/** The line index of a step's `- name:` line within the block. */
function stepIndex(block: string, name: string): number {
  return block.split("\n").findIndex((l) => l.trim() === `- name: ${name}`);
}

/** A step's text from its `- name:` line up to (not including) its `run:` line. */
function stepHead(text: string, name: string): string {
  const start = text.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const rest = text.slice(start);
  const m = rest.match(/\n\s*run:/);
  return m ? rest.slice(0, m.index) : "";
}

/** A step's full body, name line through the end of its `run:` block. */
function stepBody(text: string, name: string): string {
  const re = new RegExp(
    `^ {6}- name: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?(?=\\n {6}[-#]|\\n {2}\\S)`,
    "m",
  );
  // The sentinel gives the LAST step in the file a terminator, so a pin on the final
  // step is not silently vacuous (measured: without it, stepBody() returned "" for the
  // upload step and every key assertion below would have had nothing to look at).
  const m = `${text}\n  __end_of_file__:\n`.match(re);
  return m ? m[0] : "";
}

/**
 * The `-e '…'` expressions of the redaction step's sed program, in order.
 *
 * Sliced between `if sed -i -E` and the `; then` that closes the command, so an
 * unrelated `-e '…'` elsewhere in the step cannot pad the list. Returns [] when the
 * anchors are gone, and its one consumer asserts a non-empty exact length — an empty
 * program would make "the DSN was scrubbed" vacuously reportable.
 */
function redactExpressions(text: string): string[] {
  const body = text.slice(text.indexOf("- name: Redact connection metadata"));
  const a = body.indexOf("if sed -i -E");
  if (a < 0) return [];
  const b = body.indexOf("; then", a);
  if (b < 0) return [];
  return [...body.slice(a, b).matchAll(/-e '([^']*)'/g)].map((m) => m[1]);
}

/**
 * Every shape that could turn a failure into a pass, reported BY NAME.
 *
 * ⚠️ THE LAST FOUR WERE ADDED IN PHASE 164.8.2 (WR-06) because the first five were
 * not a class, they were five spellings of a class, and the ones missing were the
 * ones that fit these workflows:
 *   - `|| :`            a drop-in for the banned `|| true`, and shorter to type.
 *   - `2>/dev/null`     the exact shape that would swallow the marker step's psql
 *                       stderr — the step whose stderr IS the evidence that the
 *                       database could not be identified. On THIS workflow that is
 *                       the worst of the nine: `Which database am I on` is the gate
 *                       standing between a dashboard-shaped mistake and a DROP
 *                       SCHEMA on the wrong database, and a run it cannot be undone.
 *   - `set +o pipefail` re-enables the "a piped command's exit status is discarded"
 *                       bug that `set -euo pipefail` exists here to prevent.
 *   - `|| exit 0`       an explicit "and if that failed, succeed anyway".
 *
 * ⛔ THREE COPIES, KEPT LEVEL BY HAND, ON PURPOSE. The identical list lives in
 * `src/__tests__/supabase-migrate-test-first.test.ts` (which widened first, in
 * Phase 164.8) and in `src/__tests__/prod-prober-wiring.test.ts` (the ORIGIN of the
 * idiom, and the last of the three to widen). It is restated rather than imported
 * for the self-containment reason in this file's header — Phase 164.8 Plan 05
 * Task 2 states the convention outright, and CONTEXT Area 3 re-affirmed it for this
 * phase: no shared helper module that only wiring tests import. The length pin
 * below is the tripwire that makes the duplication survivable — widen one copy and
 * the other two go red naming this file.
 */
const SOFTENING_TOKENS = [
  "continue-on-error",
  "|| true",
  "exit 0",
  "::warning",
  "set +e",
  "|| :",
  "2>/dev/null",
  "set +o pipefail",
  "|| exit 0",
];

/**
 * The `restore:` job with the two ci.yml-copied mutex steps sliced out.
 *
 * ⚠️ THE ACQUIRE STEP IS EXCLUDED TOO, not just the release step, and that is FORCED
 * rather than convenient: this workflow is required to carry a BYTE-IDENTICAL copy of
 * ci.yml's acquire suffix, and that suffix legitimately contains `exit 0` (the
 * successful acquire), `|| true` (the bounded census) and `::warning` (the retried
 * session fault). Scanning it would make the two requirements contradict. Nothing
 * hides in the excluded region: the byte-identity pin below governs the suffix
 * exactly, and a separate pin asserts our own prefix carries no zero-status exit —
 * which is strictly stronger than a token scan over the same bytes.
 */
function scannableRestoreBlock(text: string): string {
  return jobBlock(text, RESTORE_JOB).replace(ACQUIRE_RE, "").replace(RELEASE_RE, "");
}

/**
 * The one token this block is allowed to carry, as an EXACT COUNT — the
 * `restore-test-from-baseline.test.ts` / `gate-family-meta.test.ts` idiom, and for the
 * same reason: eight of the nine must be absent outright, but `2>/dev/null` has
 * legitimate sites here, and "absent outright" would therefore be a rule that could
 * only be satisfied by deleting working code. A count is the alternative that still
 * bites — a NEW site is red, and so is a VANISHED one (a site disappearing means an
 * exit status that used to be checked stopped being checked, or the slicing moved and
 * the scan is now looking at less than it thinks).
 *
 * ⛔ REGENERATED, NOT CARRIED. The number below came out of THIS file's own slicing —
 * `liveLines(scannableRestoreBlock(WF)).join("\n").split("2>/dev/null").length - 1` —
 * not from the plan text and not from a whole-file `grep -c` (the file carries 11;
 * six of them are inside the excluded mutex copies or in comments).
 *
 * ⭐ RE-MEASURED 2026-09-09, Phase 164.8.2 Plan 04, on the workflow AS IT IS AFTER
 * Plan 03 added the `Stage the public artifact` step to this same job. That step
 * contributes ZERO: it reads every optional file with `if [ -f ]` guards precisely so
 * that an aborted run's missing file is not an error and a genuinely failed `cp` still
 * reaches its `trap … ERR`. Had it contributed, the staging step would have been the
 * defect and this allowlist would not have been the place to absorb it.
 *
 * ⭐ RE-MEASURED AGAIN 2026-09-10 — 5 → 4. Silent-failure review F4 removed what was
 * site 1, and the justification below is what it removed: the ancestry probe's
 * `2>/dev/null` was written up here as "git's stderr would only restate 'not a valid
 * object' for a sha the `case` above has already accepted as hex", which conceded the
 * defect while calling it a reason. `--is-ancestor` exits 0, 1 AND 128; the `case`
 * checks hex SHAPE, never existence; and that discarded stderr was the only channel
 * separating "not an ancestor" from "there is no such commit". It now redirects to
 * `${RUNNER_TEMP}/ancestry.err` and the 128 is reported as a MEASURE_FAIL. ⛔ THE
 * ALLOWLIST WENT DOWN, WHICH IS THE GOOD DIRECTION — a justification that reads as an
 * argument for suppressing evidence is a finding, not an entry.
 *
 * `2>/dev/null` x4 — every one a PROBE whose exit status is consumed by the line it
 *                    sits on, so the suppressed channel is noise and never evidence:
 *   1-3. `Probe - the runner image's PostgreSQL server binaries resolve` — the
 *      `pg_config --bindir`, `ls -d …/bin` and `ls -l …/initdb …/pg_ctl` lines. This
 *      whole step is a DIAGNOSTIC ECHO, non-fatal by design (see its own comment: the
 *      pg-lane resolution chain owns the judgement, a second divergent opinion would be
 *      worse than none). Each swallowed stderr is paired with an `|| echo '(absent)'`
 *      that prints the absence, so the log says what was not found either way.
 *   4. `Back up TEST's schema and ledger …` — the `SELECT count(*) FROM
 *      supabase_migrations.schema_migrations;` row count. Its rc IS captured
 *      (`… 2>/dev/null | tr -d '\r' | tail -1)" || rc=$?`) and the very next branch
 *      turns a non-zero into `::error::` + `exit 1`. psql's connect/auth stderr names
 *      the host, its IP and the DB user, and this job's log is PUBLIC — so here the
 *      suppression is a redaction, and the failure is still loud.
 *
 * ⛔ A count that moves in EITHER direction is red. Do not edit the number to make a
 * run pass: a new one has to earn its place in this allowlist with a justification.
 */
const SITE_ALLOWLISTED_TOKEN = "2>/dev/null";

/**
 * The four justified `2>/dev/null` SITES, as the distinguishing text of the line each
 * one sits on — in the order of the enumeration above.
 *
 * ⛔ SITES, NOT A COUNT (Phase 164.8.2, silent-failure review F2). This was
 * `const ALLOWED = { "2>/dev/null": 5 }` with `if (n === allowed) continue`, which is
 * satisfied by ANY five occurrences. The shape it could not see is a ONE-FOR-ONE SWAP:
 * delete one of the benign probe suppressions in the deliberately-non-fatal PostgreSQL
 * binaries step and add one on `Which database am I on`'s psql, and the count is
 * unchanged, the scan reports zero offenders, and the step whose stderr IS the evidence
 * that the wrong database was identified goes quiet. That step is the gate standing
 * between a dashboard-shaped mistake and a DROP SCHEMA on PROD.
 *
 * Both of the calibrations this file already carried MOVE the count — one to 6, one to
 * 4 — so neither exercised the count-preserving direction, which is by construction the
 * one a count cannot see. The site list is not new information either: all of it was
 * already written out as prose in the enumeration above. It is now executable.
 *
 * ⛔ THE RULE IS A BIJECTION, and both halves matter: every live `2>/dev/null` line must
 * match exactly one entry (a NEW site is red) and every entry must match exactly one
 * live line (a VANISHED site is red — a site disappearing means an exit status that used
 * to be checked stopped being checked, or the slicing moved and the scan is now looking
 * at less than it thinks).
 */
const ALLOWED_SITES: readonly string[] = [
  "pg_config --bindir 2>/dev/null",
  "ls -d /usr/lib/postgresql/*/bin 2>/dev/null",
  "/usr/lib/postgresql/*/bin/initdb /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null",
  'FROM supabase_migrations.schema_migrations;" 2>/dev/null',
];

function softeningOffenders(text: string): string[] {
  const lines = liveLines(scannableRestoreBlock(text));
  const live = lines.join("\n");
  const offenders: string[] = [];
  for (const token of SOFTENING_TOKENS) {
    if (token === SITE_ALLOWLISTED_TOKEN) continue;
    const n = live.split(token).length - 1;
    if (n === 0) continue;
    offenders.push(`${token} (${n}) — forbidden outright in the scannable restore block`);
  }

  // ⭐ ATTRIBUTED TO A STEP, not merely quoted. Measured while writing this: the marker
  // step's stderr redirect sits on its OWN continuation line, so the offending text is
  // `2>/dev/null)" || rc=$?` — true, and useless. The step name is what tells the next
  // reader that the quietened channel belongs to `Which database am I on`. It is the
  // nearest preceding `- name:` line.
  //
  // ⛔ THE STEP NAME IS FOR THE MESSAGE ONLY — THE MATCH STAYS PER-LINE. Widening the
  // match to "anywhere in an allowlisted step" was written and then reverted here: it
  // would let a SECOND suppression anywhere inside, say, the backup step ride in on
  // site 4's justification, which is the same ride-in the per-line count check below
  // exists to stop, one scope up.
  const siteLines: { line: string; step: string }[] = [];
  let step = "(before the first step)";
  for (const l of lines) {
    const m = l.match(/^\s*- name: (.+)$/);
    if (m) step = m[1].trim();
    if (l.includes(SITE_ALLOWLISTED_TOKEN)) siteLines.push({ line: l, step });
  }

  for (const { line: l, step: st } of siteLines) {
    const hits = ALLOWED_SITES.filter((s) => l.includes(s));
    if (hits.length !== 1) {
      offenders.push(
        `${SITE_ALLOWLISTED_TOKEN} (UNLISTED SITE in step "${st}", matched ${hits.length} allowlist entr(ies)) — a new suppression has to earn its place in ALLOWED_SITES with a per-site justification: ${l.trim()}`,
      );
      continue;
    }
    const n = l.split(SITE_ALLOWLISTED_TOKEN).length - 1;
    if (n !== 1) {
      offenders.push(
        `${SITE_ALLOWLISTED_TOKEN} (${n} suppressions on ONE allowlisted line in step "${st}" — the extra one is riding in on its neighbour's justification): ${l.trim()}`,
      );
    }
  }
  for (const s of ALLOWED_SITES) {
    const n = siteLines.filter(({ line: l }) => l.includes(s)).length;
    if (n !== 1) {
      offenders.push(
        `${SITE_ALLOWLISTED_TOKEN} (VANISHED OR DUPLICATED SITE, matched ${n} live line(s), want exactly 1): ${s}`,
      );
    }
  }
  return offenders;
}

/**
 * Every `run: |` block in the scannable restore block, with the step it belongs to.
 *
 * Flow-scalar `run: <cmd>` steps are deliberately NOT collected: a one-command step
 * fails when its command fails, with or without `set -e`, so there is nothing there to
 * soften. Only a block scalar can quietly run five commands and report the last one's
 * status.
 */
function runBlocks(text: string): { step: string; live: string[] }[] {
  const lines = scannableRestoreBlock(text).split("\n");
  const out: { step: string; live: string[] }[] = [];
  let step = "(unnamed)";
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*- name: (.+)$/);
    if (m) step = m[1].trim();
    if (!/^\s*run: \|-?\s*$/.test(lines[i])) continue;
    const indent = lines[i].length - lines[i].trimStart().length;
    const body: string[] = [];
    for (let k = i + 1; k < lines.length; k += 1) {
      if (lines[k].trim() === "") continue;
      if (lines[k].length - lines[k].trimStart().length <= indent) break;
      body.push(lines[k]);
    }
    out.push({ step, live: body.filter((l) => !/^\s*#/.test(l)) });
  }
  return out;
}

/** A live line that turns `-e` ON. `set -uo pipefail` does not match; that is the point. */
const ERREXIT_RE = /^\s*set\s+(-[a-zA-Z]*e[a-zA-Z]*(\s|$)|-o\s+errexit)/;

/**
 * The `run: |` blocks that deliberately never turn `-e` on, BY STEP NAME.
 *
 * ⛔ WHY THIS EXISTS (Phase 164.8.2, silent-failure review F3). `set +e` is banned
 * outright by the nine-token scan. `set -uo pipefail` — a block that simply never turns
 * `-e` ON — is functionally the SAME softening over the whole step, contains none of the
 * nine tokens, and was invisible. The scan's own stated purpose is that "the first five
 * were not a class, they were five spellings of a class"; this is a sixth spelling.
 *
 * ⚠️ ALL THREE OF TODAY'S SITES ARE DEFENSIBLE AND WERE RE-CHECKED, one at a time —
 * this closes a coverage gap, it does not report a live defect:
 *   1-2. the extractor self-test / allowlist audit assertions. Both capture `status=$?`
 *      explicitly on the very next line and route EVERY path to a named `::error::` and
 *      an `exit`. Their own comment says omitting `-e` is what lets them avoid `|| true`
 *      — a non-matching `grep` yields the empty string instead of aborting the step, so
 *      an absent line reaches its own MEASURE_FAIL instead of dying before it.
 *   3. the PostgreSQL server-binaries probe, a DIAGNOSTIC ECHO that is non-fatal by
 *      design (pg-lane's four-step resolution chain owns the judgement; a second
 *      divergent opinion would be worse than none).
 *
 * ⛔ THE EXEMPTION IS A BIJECTION, like ALLOWED_SITES. An entry that matches no block, or
 * matches a block that DOES set `-e`, is reported: a stale exemption is a standing
 * permission for a future softening of that step, granted by nobody.
 */
const NO_ERREXIT_SITES: readonly string[] = [
  "Assert the extractor self-test PRINTED its kind census and cleared the floor",
  "Assert the allowlist audit PRINTED its census over a non-empty corpus",
  "Probe - the runner image's PostgreSQL server binaries resolve",
];

/**
 * MEASURED 2026-09-10, Phase 164.8.2: the scannable restore block holds 16 `run: |`
 * blocks, 13 of which set `-e`. A FLOOR, not an equality — a step added later must not
 * have to touch this number, but a parser that silently starts returning nothing must.
 * An empty list would make the rule below vacuously green, which is the failure shape
 * this whole file exists to refuse.
 */
const RUN_BLOCK_FLOOR = 16;

function errexitOffenders(text: string): string[] {
  const blocks = runBlocks(text);
  const offenders: string[] = [];
  for (const { step, live } of blocks) {
    const setsE = live.some((l) => ERREXIT_RE.test(l));
    const exempt = NO_ERREXIT_SITES.includes(step);
    if (!setsE && !exempt) {
      offenders.push(
        `NO ERREXIT in step "${step}" — its \`run: |\` block never turns \`-e\` on, which softens every command in it exactly as \`set +e\` would while carrying none of the nine banned tokens. Fix the step, or add it to NO_ERREXIT_SITES with the per-site justification the others carry.`,
      );
    }
    if (setsE && exempt) {
      offenders.push(
        `STALE EXEMPTION for step "${step}" — it sets \`-e\` and is still listed in NO_ERREXIT_SITES. An exemption nobody needs is a standing permission to soften that step later, granted by nobody. Remove the entry.`,
      );
    }
  }
  for (const site of NO_ERREXIT_SITES) {
    const n = blocks.filter((b) => b.step === site).length;
    if (n !== 1) {
      offenders.push(
        `DANGLING EXEMPTION "${site}" — matched ${n} \`run: |\` block(s), want exactly 1. The step was renamed or removed and the exemption outlived it.`,
      );
    }
  }
  return offenders;
}

/**
 * The SUPERSEDED count rule, kept as a REFERENCE ORACLE and nothing else.
 *
 * Its only caller is the swap calibration below, which asserts that this reports
 * NOTHING on a mutant the site rule reports twice. "The new control is stronger" is a
 * claim, and this is what makes it a measurement.
 */
function countRuleOffenderCount(text: string, allowed: number): number {
  const live = liveLines(scannableRestoreBlock(text)).join("\n");
  const n = live.split(SITE_ALLOWLISTED_TOKEN).length - 1;
  return n === allowed ? 0 : 1;
}

/** The file's header — everything before the `on:` key. */
function headerBlock(text: string): string {
  const i = text.indexOf("\non:\n");
  return i < 0 ? "" : text.slice(0, i);
}

/** ci.yml's step names, read from ci.yml rather than restated here. */
const CI_LINES = CI.split("\n");

// ⛔ RESOLVED BY UNIQUE TOKEN, NOT BY LINE INDEX (2026-09-09, Phase 164.8.1).
// These two were `CI_LINES[1303]` / `CI_LINES[1408]`, and an absolute index into
// ci.yml is a pin that rots on any edit ABOVE it — which is not hypothetical:
// they were re-anchored +32 earlier in THIS SAME PHASE when the extractor's
// self-test pair landed in `sql-gate-lint`, and the next edit in the same phase
// broke them again by +95. Two forced re-anchors in one phase is the signal that
// the mechanism is wrong, not that the numbers were unlucky.
//
// The token is a SHORT, STABLE substring; the full step NAME is still read from
// ci.yml rather than restated here, so a renamed step still reds. The lookup
// REFUSES on zero or multiple matches, so it can never silently resolve to the
// wrong step — the failure mode a line index has by construction.
function ciStepNameContaining(token: string): string {
  const hits = CI_LINES.filter(
    (l) => /^\s*- name:\s*/.test(l) && l.includes(token),
  ).map((l) => l.replace(/^\s*- name:\s*/, "").trim());
  expect(
    hits.length,
    `ci.yml must carry EXACTLY ONE '- name:' step whose text contains ${JSON.stringify(token)}; found ${hits.length}${hits.length ? ` (${hits.join(" | ")})` : ""}. A token that matches none or many cannot identify a step — widen or narrow the token, do not pick one of the matches.`,
  ).toBe(1);
  return hits[0] as string;
}

const CRON_STEP_NAME = ciStepNameContaining("Provision pg_cron");
const PROBE_STEP_NAME = ciStepNameContaining("PostgreSQL server binaries resolve");

// ---------------------------------------------------------------------------
// Calibration harness.
// ---------------------------------------------------------------------------
function calibrate(
  label: string,
  mutate: (s: string) => string,
  predicate: (s: string) => boolean,
  text: string = WF,
): void {
  const mutant = mutate(text);
  expect(
    mutant,
    `CALIBRATION ${label}: the mutation produced an identical string, so the twin proves nothing`,
  ).not.toBe(text);
  expect(predicate(text), `${label}: the predicate is FALSE on the real file`).toBe(true);
  expect(
    predicate(mutant),
    `CALIBRATION ${label}: the predicate did NOT flip on the mutant — it cannot fail, so it is not evidence`,
  ).toBe(false);
}

// ---------------------------------------------------------------------------
// Extraction of a step's shell script, for the steps this file EXECUTES.
// ---------------------------------------------------------------------------
function extractRunScript(yml: string, stepName: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start === -1) {
    throw new Error(
      `${WF_PATH} has no step named "${stepName}". The PROD-ledger premise assert is what ` +
        `stops the ledger seed writing 266 rows claiming a parity PROD does not have. If it ` +
        `was renamed, update the constant here; if it was deleted, say so out loud.`,
    );
  }
  const runIdx = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  if (runIdx === -1) throw new Error(`step "${stepName}" has no "run: |" body`);
  const indent = lines[runIdx].length - lines[runIdx].trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(runIdx + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return `${body.join("\n")}\n`;
}

describe("164.8-03 — test-restore-from-baseline.yml is wired as the plan requires", () => {
  describe("triggers and inputs: the destructive path cannot be reached by accident", () => {
    it("the on: block declares workflow_dispatch and NOTHING else", () => {
      expect(triggerKeys(WF)).toEqual(["workflow_dispatch"]);
      for (const trigger of ["push", "schedule", "pull_request", "pull_request_target"]) {
        calibrate(
          `on: only workflow_dispatch (twin: ${trigger})`,
          (s) => s.replace("\non:\n", `\non:\n  ${trigger}:\n    branches: [main]\n`),
          (s) => triggerKeys(s).length === 1 && triggerKeys(s)[0] === "workflow_dispatch",
        );
      }
    });

    it("the mode input is a choice of exactly preflight|restore, defaulting to preflight", () => {
      const spec = modeInput(WF);
      expect(spec.type).toBe("choice");
      expect(spec.options).toEqual(["preflight", "restore"]);
      expect(spec.default).toBe("preflight");
      calibrate(
        "mode defaults to preflight",
        (s) => s.replace("        default: preflight\n", "        default: restore\n"),
        (s) => modeInput(s).default === "preflight",
      );
      calibrate(
        "mode is a typed choice",
        (s) => s.replace("        type: choice\n", "        type: string\n"),
        (s) => modeInput(s).type === "choice",
      );
    });

    it("the guard job's if: is the exact negation of the restore job's", () => {
      const guard = jobBlock(WF, GUARD_JOB);
      const restore = jobBlock(WF, RESTORE_JOB);
      expect(liveLineCount(guard, "if: github.ref != 'refs/heads/main'")).toBe(1);
      expect(liveLineCount(restore, "if: github.ref == 'refs/heads/main'")).toBe(1);
      calibrate(
        "guard if: is the negation of the restore if:",
        (s) => s.replace("if: github.ref != 'refs/heads/main'", "if: github.ref != 'refs/heads/develop'"),
        (s) =>
          liveLineCount(jobBlock(s, GUARD_JOB), "if: github.ref != 'refs/heads/main'") === 1 &&
          liveLineCount(jobBlock(s, RESTORE_JOB), "if: github.ref == 'refs/heads/main'") === 1,
      );
    });

    it("the guard job FAILS rather than passing quietly", () => {
      const guard = jobBlock(WF, GUARD_JOB);
      expect(
        liveLines(guard).some((l) => l.trim() === "exit 1"),
        "the dispatch-guard no longer exits 1 — a restore dispatched off main would leave a GREEN check, teaching the operator that it ran",
      ).toBe(true);
      expect(liveLines(guard).some((l) => l.trim() === "exit 0")).toBe(false);
    });
  });

  describe("the restore job is bound, bounded, and credential-hard", () => {
    it("environment: Test is a LIVE line inside the restore job, exactly once", () => {
      calibrate(
        "environment: Test",
        (s) => s.replace("    environment: Test\n", "    # environment: Test\n"),
        (s) => liveLineCount(jobBlock(s, RESTORE_JOB), "environment: Test") === 1,
      );
    });

    it("timeout-minutes: 90 is a LIVE line inside the restore job", () => {
      calibrate(
        "timeout-minutes: 90 (the runbook's TTL leg — the holder sleeps 6000s = 100min)",
        (s) => s.replace("    timeout-minutes: 90\n", "    timeout-minutes: 900\n"),
        (s) => liveLineCount(jobBlock(s, RESTORE_JOB), "timeout-minutes: 90") === 1,
      );
    });

    it("the credential assert carries NO if:, and names the variable in an ::error::", () => {
      const head = stepHead(WF, "Assert TEST credential is configured");
      expect(head, "the credential-assert step is gone").not.toBe("");
      expect(
        /^\s*if:/m.test(head),
        "an `if:` appeared between the credential step's name and its run body — that is supabase-migrate.yml's OLDER tolerant shape, which reports success having restored nothing",
      ).toBe(false);
      const body = stepBody(WF, "Assert TEST credential is configured");
      expect(body).toContain("::error::secrets.TEST_SUPABASE_DB_URL is not configured.");
      expect(body).toContain("exit 1");
      calibrate(
        "credential step has no if:",
        (s) =>
          s.replace(
            "      - name: Assert TEST credential is configured\n",
            "      - name: Assert TEST credential is configured\n        if: vars.CONFIGURED == 'true'\n",
          ),
        (s) => !/^\s*if:/m.test(stepHead(s, "Assert TEST credential is configured")),
      );
    });
  });

  describe("ordering: nothing destructive runs before its precondition", () => {
    const ACQUIRE = "Acquire shared-test-db mutex";
    const BACKUP = "Back up TEST before any write (schema + ledger; NOT data)";
    const RUN = "Run the restore script";
    const VERIFY = "Post-verify with the Supabase CLI — ledger SHAPE";
    const PREMISE = "Assert PROD's ledger equals the repo file set";

    function ordered(text: string): boolean {
      const b = jobBlock(text, RESTORE_JOB);
      const i = (n: string) => stepIndex(b, n);
      return (
        i(PREMISE) > -1 &&
        i(ACQUIRE) > -1 &&
        i(BACKUP) > -1 &&
        i(RUN) > -1 &&
        i(VERIFY) > -1 &&
        i(PREMISE) < i(ACQUIRE) &&
        i(ACQUIRE) < i(BACKUP) &&
        i(BACKUP) < i(RUN) &&
        i(RUN) < i(VERIFY)
      );
    }

    it("premise < mutex < backup < script < post-verify", () => {
      calibrate(
        "backup precedes the script (a backup taken after DROP SCHEMA is not a backup)",
        (s) =>
          s
            .replace(`- name: ${BACKUP}`, "- name: __SWAP__")
            .replace(`- name: ${RUN}`, `- name: ${BACKUP}`)
            .replace("- name: __SWAP__", `- name: ${RUN}`),
        ordered,
      );
      calibrate(
        "the PROD-ledger premise is asserted BEFORE the lock is taken",
        (s) =>
          s
            .replace(`- name: ${PREMISE}`, "- name: __SWAP__")
            .replace(`- name: ${ACQUIRE}`, `- name: ${PREMISE}`)
            .replace("- name: __SWAP__", `- name: ${ACQUIRE}`),
        ordered,
      );
    });

    it("the four verbatim commands are LIVE run lines, self-test before corpus", () => {
      const b = jobBlock(WF, RESTORE_JOB);
      const cmds = {
        staleSelf: "node scripts/check-baseline-staleness.mjs --self-test",
        stale: "node scripts/check-baseline-staleness.mjs",
        scriptSelf: "bash scripts/restore-test-from-baseline.sh --self-test",
        scriptRun: 'bash scripts/restore-test-from-baseline.sh --run --mode "$MODE"',
      };
      for (const [key, cmd] of Object.entries(cmds)) {
        expect(
          liveCommandIndex(b, cmd),
          `${key}: \`${cmd}\` is not a LIVE run line in the restore job — a commented-out command is not a command`,
        ).toBeGreaterThan(-1);
      }
      expect(
        liveCommandIndex(b, cmds.staleSelf),
        "the co-edit gate's --self-test must run BEFORE its corpus step (the sql-gate-lint idiom: a gate whose red path was not observed in THIS run is not evidence about this run)",
      ).toBeLessThan(liveCommandIndex(b, cmds.stale));
      expect(
        liveCommandIndex(b, cmds.scriptSelf),
        "the restore script's --self-test must run BEFORE its --run",
      ).toBeLessThan(liveCommandIndex(b, cmds.scriptRun));
      calibrate(
        "the restore script's --run is EXECUTED, not mentioned",
        (s) => s.replace(`          ${cmds.scriptRun}`, `          # ${cmds.scriptRun}`),
        (t) => liveCommandIndex(jobBlock(t, RESTORE_JOB), cmds.scriptRun) > -1,
      );
      calibrate(
        "self-test before corpus for the co-edit gate",
        (s) =>
          s
            .replace(`run: ${cmds.staleSelf}`, "run: __SWAP__")
            .replace(`run: ${cmds.stale}`, `run: ${cmds.staleSelf}`)
            .replace("run: __SWAP__", `run: ${cmds.stale}`),
        (t) => {
          const b2 = jobBlock(t, RESTORE_JOB);
          return liveCommandIndex(b2, cmds.staleSelf) < liveCommandIndex(b2, cmds.stale);
        },
      );
    });

    it("W9 — no pg_cron provisioning step; the server-binaries probe precedes the self-test", () => {
      expect(
        CRON_STEP_NAME,
        "ci.yml line 1304 is no longer the pg_cron provisioning step's `- name:` line — this pin reads it from ci.yml on purpose, so re-anchor it rather than restating the name here",
      ).toContain("pg_cron");
      expect(
        PROBE_STEP_NAME,
        "ci.yml line 1409 is no longer the PostgreSQL server-binaries probe's `- name:` line",
      ).toContain("PostgreSQL server binaries");
      calibrate(
        "the pg_cron provisioning step is NOT copied (Plan 01's fixtures create no cron job)",
        (s) =>
          s.replace(
            "      - name: Restore script self-test\n",
            `      - name: ${CRON_STEP_NAME}\n        run: echo provisioned\n      - name: Restore script self-test\n`,
          ),
        (t) => !t.includes(CRON_STEP_NAME),
      );
      const b = jobBlock(WF, RESTORE_JOB);
      expect(stepIndex(b, PROBE_STEP_NAME)).toBeGreaterThan(-1);
      expect(
        stepIndex(b, PROBE_STEP_NAME),
        "the server-binaries probe must run BEFORE the restore script's --self-test — the self-test boots a throwaway cluster and needs SERVER binaries, not just the client",
      ).toBeLessThan(stepIndex(b, "Restore script self-test"));
    });
  });

  describe("the backup: reversible for schema and ledger, and honest that data is not", () => {
    const BACKUP = "Back up TEST before any write (schema + ledger; NOT data)";
    const UPLOAD = "Upload the pre-restore backup (schema + ledger; NOT data)";

    it("the backup step's own NAME says what the artifact does not hold", () => {
      calibrate(
        "the backup step name says `NOT data`",
        (s) => s.replace(`- name: ${BACKUP}`, "- name: Back up TEST before any write"),
        (t) => {
          const b = jobBlock(t, RESTORE_JOB);
          const i = b.split("\n").findIndex((l) => /^\s*- name: Back up TEST/.test(l));
          return i > -1 && b.split("\n")[i].includes("NOT data");
        },
      );
    });

    it("the upload survives an aborted run and refuses to upload nothing", () => {
      const body = stepBody(WF, UPLOAD);
      expect(body, "the backup upload step is gone").not.toBe("");
      for (const key of ["if: always()", "retention-days: 90", "if-no-files-found: error"]) {
        expect(
          liveLines(body).some((l) => l.trim() === key),
          `the backup upload step no longer carries \`${key}\``,
        ).toBe(true);
      }
      calibrate(
        "the backup artifact is retained for 90 days",
        (s) => s.replace("          retention-days: 90\n", "          retention-days: 7\n"),
        (t) => liveLines(stepBody(t, UPLOAD)).some((l) => l.trim() === "retention-days: 90"),
      );
      calibrate(
        "an empty backup directory is an ERROR, never a quiet upload of nothing",
        (s) =>
          s.replace(
            "          if-no-files-found: error\n",
            "          if-no-files-found: warn\n",
          ),
        (t) =>
          liveLines(stepBody(t, UPLOAD)).some((l) => l.trim() === "if-no-files-found: error"),
      );
      calibrate(
        "the upload runs even when the script aborted",
        (s) =>
          s.replace(
            `      - name: ${UPLOAD}\n        if: always()\n`,
            `      - name: ${UPLOAD}\n`,
          ),
        (t) => liveLines(stepBody(t, UPLOAD)).some((l) => l.trim() === "if: always()"),
      );
    });

    it("the reversibility story is stated in the W6 words, in the header AND the log", () => {
      const header = headerBlock(WF);
      expect(header).toContain("SCHEMA AND LEDGER ARE REVERSIBLE");
      expect(header).toContain("DATA IS NOT");
      expect(
        stepBody(WF, BACKUP),
        "the backup step no longer PRINTS the reversibility story — the header is read by developers, the log by whoever is looking at the run that just destroyed the data",
      ).toContain("DATA IS NOT");
    });
  });

  describe("the redaction is fail-closed: nothing unredacted reaches a PUBLIC artifact", () => {
    const REDACT = "Redact connection metadata from the backup directory (public artifact)";
    const UPLOAD = "Upload the pre-restore backup (schema + ledger; NOT data)";

    it("the redaction step exists, runs on every outcome, and runs BEFORE the upload", () => {
      // ⛔ WHY THE ORDER IS THE WHOLE CONTROL. Both steps are `if: always()`. In a
      // job, `always()` steps run in FILE ORDER — so the only thing that makes the
      // redaction a precondition of the upload rather than a bystander is that it is
      // written above it. Drift the upload above the redaction and every assertion
      // about scrubbing stays true while the unredacted channels ship anyway.
      const b = jobBlock(WF, RESTORE_JOB);
      expect(stepIndex(b, REDACT), "the redaction step is gone").toBeGreaterThan(-1);
      expect(stepIndex(b, UPLOAD), "the upload step is gone").toBeGreaterThan(-1);
      expect(
        liveLines(stepBody(WF, REDACT)).some((l) => l.trim() === "if: always()"),
        "the redaction step no longer carries `if: always()` — on an ABORTED run it would not run at all, and the aborted run is exactly the one whose channels hold a psql connect failure naming the TEST pooler host",
      ).toBe(true);
      calibrate(
        "the redaction step precedes the upload step",
        (s) =>
          s
            .replace(`- name: ${REDACT}`, "- name: __SWAP__")
            .replace(`- name: ${UPLOAD}`, `- name: ${REDACT}`)
            .replace("- name: __SWAP__", `- name: ${UPLOAD}`),
        (t) => {
          const jb = jobBlock(t, RESTORE_JOB);
          const r = stepIndex(jb, REDACT);
          const u = stepIndex(jb, UPLOAD);
          return r > -1 && u > -1 && r < u;
        },
      );
      // ⚠️ RE-ANCHORED 2026-09-10 (Phase 164.8.2, review WR-06). This mutation used to
      // splice on `- name: <REDACT>\n        if: always()\n`; the WR-06 fix put an
      // `id: redact` (and its reasoning) between those two lines, so the replace
      // silently became a no-op — caught by `calibrate()`'s own "the mutation produced
      // an identical string" assertion, which is what that assertion is for.
      calibrate(
        "the redaction runs on an aborted run too",
        (s) => s.replace("        id: redact\n        if: always()\n", "        id: redact\n"),
        (t) => liveLines(stepBody(t, REDACT)).some((l) => l.trim() === "if: always()"),
      );
    });

    it("the scrubbed channel set is exactly .err/.log/.out — never the .sql/.csv the reversal replays", () => {
      // ⭐ THE SCOPE IS AS LOAD-BEARING AS THE SCRUB. A substitution inside
      // `schema.sql` or `ledger.csv` would corrupt the very bytes the reversal recipe
      // replays, so those two are deliberately left byte-exact; the price is that the
      // glob must never widen. Both the destroy loop (`withhold_channels`) and the
      // redact loop are pinned, because a widened destroy loop is a reversal recipe
      // deleted on the way to the artifact.
      const body = stepBody(WF, REDACT);
      expect(body, "the redaction step body could not be extracted").not.toBe("");
      const globLines = liveLines(body).filter((l) => l.includes('"${outdir}"/*.'));
      expect(
        globLines.length,
        "the redaction step no longer has exactly two channel-glob loops (withhold_channels and the redact loop)",
      ).toBe(2);
      for (const l of globLines) {
        expect(l).toContain('"${outdir}"/*.err');
        expect(l).toContain('"${outdir}"/*.log');
        expect(l).toContain('"${outdir}"/*.out');
        expect(
          /\*\.(sql|csv)/.test(l),
          `a channel loop widened to .sql or .csv — those are the reversal recipe and must stay byte-exact: ${l.trim()}`,
        ).toBe(false);
      }
      calibrate(
        "the channel-glob pin bites on a widening to .sql",
        (s) =>
          s.replace(
            'for f in "${outdir}"/*.err "${outdir}"/*.log "${outdir}"/*.out; do',
            'for f in "${outdir}"/*.err "${outdir}"/*.log "${outdir}"/*.out "${outdir}"/*.sql; do',
          ),
        (t) =>
          liveLines(stepBody(t, REDACT))
            .filter((l) => l.includes('"${outdir}"/*.'))
            .every((l) => !/\*\.(sql|csv)/.test(l)),
      );
    });

    it("the step's OWN sed program scrubs a DSN — EXECUTED against a fixture log", () => {
      // ⭐ EXECUTED, NOT GREPPED. The expressions are lifted OUT of the YAML and run,
      // so a step that keeps the strings and guts the program is a RED here. Run as
      // `sed -E` (no `-i`): the step's `sed -i -E` form is GNU-only — BSD sed reads
      // the `-E` as `-i`'s backup-extension argument and never enables extended
      // regexes — and this suite must measure the same thing on a developer's macOS
      // as on the ubuntu runner. The workflow itself only ever runs on ubuntu.
      const exprs = redactExpressions(WF);
      expect(
        exprs.length,
        "the redaction step's sed program no longer carries its five expressions (DSN credentials, host=, user=, `server at \"…\"`, `for user \"…\"`)",
      ).toBe(5);

      const scrub = (program: string[], input: string): string => {
        const dir = mkdtempSync(join(tmpdir(), "redact-"));
        const f = join(dir, "psql.err");
        writeFileSync(f, input);
        const r = spawnSync("sed", ["-E", ...program.flatMap((e) => ["-e", e]), f], {
          encoding: "utf8",
        });
        rmSync(dir, { recursive: true, force: true });
        if (r.status !== 0) throw new Error(`sed failed: ${r.stderr}`);
        return r.stdout ?? "";
      };

      const FIXTURE =
        'psql: error: connection to server at "db.exampleprojref.supabase.co" (10.11.12.13), port 5432 failed: FATAL: password authentication failed for user "postgres.exampleprojref"\n' +
        `DSN=${SCHEME}postgres.exampleprojref:EXAMPLE-NOT-A-REAL-PASSWORD@db.exampleprojref.supabase.co:5432/postgres\n` +
        "host=db.exampleprojref.supabase.co user=postgres.exampleprojref\n";

      const out = scrub(exprs, FIXTURE);
      for (const secret of ["EXAMPLE-NOT-A-REAL-PASSWORD", "postgres.exampleprojref"]) {
        expect(
          out.includes(secret),
          `the redaction left \`${secret}\` in the channel. This artifact is world-readable on a PUBLIC repo; the DB user and the password are exactly what must not survive.\n${out}`,
        ).toBe(false);
      }
      expect(
        out.includes('server at "db.exampleprojref.supabase.co"'),
        "the redaction left psql's `server at \"<host>\" (<ip>)` shape intact — the TEST pooler host and its IP are disclosed",
      ).toBe(false);
      expect(out).toContain("***");

      // CALIBRATION — drop the DSN expression and the credential SURVIVES. Without
      // this twin, `out.includes(secret) === false` could be reported by a fixture
      // that never carried the secret in the first place.
      const withoutDsn = exprs.filter((e) => !e.includes("postgres(ql)?://"));
      expect(
        withoutDsn.length,
        "CALIBRATION: no expression matched the DSN shape, so the twin removes nothing",
      ).toBe(exprs.length - 1);
      expect(
        scrub(withoutDsn, FIXTURE).includes("EXAMPLE-NOT-A-REAL-PASSWORD"),
        "CALIBRATION: the password survived neither program — the fixture does not exercise the DSN expression, so the pin above proves nothing",
      ).toBe(true);
    });

    it("a FAILED substitution DESTROYS the channels and exits 1 — EXECUTED, forced to fail", () => {
      // ⛔ THE CONTROL THIS FILE EXISTS FOR. Both this step and the upload are
      // `if: always()`, so a redaction that merely FAILED would make the run red while
      // the unredacted channels shipped anyway — a control whose failure still
      // publishes the thing it exists to withhold is not a control. The step's answer
      // is to DESTROY the .err/.log/.out channels on any failure. That is executed
      // here, with the substitution forced to fail (`false` in place of `sed`) so the
      // failure is deterministic on every platform rather than depending on which
      // sed the developer has.
      const script = extractRunScript(WF, REDACT);
      expect(
        script.includes("if sed -i -E \\"),
        "the redaction step's substitution is no longer the `if sed -i -E \\` form this twin forces to fail — re-anchor the mutation rather than deleting the twin",
      ).toBe(true);
      const forced = script.replace("if sed -i -E \\", "if false -i -E \\");

      const runnerTemp = mkdtempSync(join(tmpdir(), "redact-run-"));
      const outdir = join(runnerTemp, "test-backup");
      mkdirSync(outdir);
      const channels = ["psql.err", "dump.log", "transaction.out"];
      const keepers = ["schema.sql", "ledger.csv"];
      for (const f of [...channels, ...keepers]) {
        writeFileSync(join(outdir, f), "host=db.exampleprojref.supabase.co\n");
      }
      const scriptFile = join(runnerTemp, "redact.sh");
      writeFileSync(scriptFile, forced);
      const r = spawnSync("bash", [scriptFile], {
        encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: runnerTemp },
      });
      const surviving = readdirSync(outdir).sort();
      rmSync(runnerTemp, { recursive: true, force: true });

      expect(
        r.status,
        `a failed substitution did not fail the step (exit ${r.status}). The upload is \`if: always()\`; a green redaction step is the only thing that makes the artifact safe to publish.\n${r.stdout}${r.stderr}`,
      ).toBe(1);
      for (const c of channels) {
        expect(
          surviving.includes(c),
          `\`${c}\` SURVIVED a failed redaction and would be uploaded unredacted to a world-readable artifact`,
        ).toBe(false);
      }
      expect(
        surviving,
        "the fail-closed path destroyed the reversal recipe too — schema.sql and ledger.csv carry no connection metadata and are what makes the act reversible",
      ).toEqual(keepers.slice().sort());
      expect(`${r.stdout}${r.stderr}`).toContain("::error::");
      expect(`${r.stdout}${r.stderr}`).toContain("WITHHELD");
    });
  });

  // -------------------------------------------------------------------------
  // WR-05 (Phase 164.8.2) — the world-readable artifact is an ENUMERATED
  // allowlist, and every future file the restore script writes is OUT by default.
  //
  // ⛔ THE DEFECT. Until 164.8.2 the upload's `path:` was the backup DIRECTORY, so
  // whatever the script happened to write was published on a PUBLIC repo for 90
  // days. Ten of the eighteen names that reach that directory pass through NEITHER
  // the backup step's secret scan (it runs BEFORE the script writes anything) NOR
  // the redaction above (`*.err/*.log/*.out` only) — `pre-census.txt` and the two
  // rollback views carry a reconstructed `CREATE POLICY … USING (<qual>)` and
  // owner-named rows read off live shared TEST.
  //
  // ⭐ AND THE ARM IS EXECUTED, NOT GREPPED, for the reason the file's header gives:
  // a string pin over the YAML goes green the moment someone keeps the step and
  // guts its copy loop. The step's shell is lifted out and RUN over a fixture
  // directory seeded with all eighteen REAL names (CONTEXT: "a falsifier must
  // reproduce the real shape" — the redaction twin above deliberately uses
  // `schema.sql`, a name this workflow never writes; that fixture is left alone as
  // out of scope, this one uses the measured names).
  // -------------------------------------------------------------------------
  describe("WR-05 — the public artifact carries an enumerated allowlist, default-out", () => {
    const STAGE = "Stage the public artifact (enumerated allowlist; default-out)";
    const REDACT = "Redact connection metadata from the backup directory (public artifact)";
    const UPLOAD = "Upload the pre-restore backup (schema + ledger; NOT data)";
    /** The step that takes the backup, writes the README and runs the secret scan. */
    const BACKUP = "Back up TEST before any write (schema + ledger; NOT data)";

    // ⛔ REGENERATED 2026-09-09, NOT restated from the review (which said "seven
    // unscanned" and was wrong) — from the WRITERS:
    //   grep -oE 'RESTORE_OUT_DIR}?/[A-Za-z0-9_.-]+' scripts/restore-test-from-baseline.sh
    //   grep -oE 'outdir}?/[A-Za-z0-9_.-]+'          .github/workflows/test-restore-from-baseline.yml
    // If the script gains a file, this list goes stale — and the point of the
    // allowlist is that a stale list here is SAFE: an unknown name is not staged.
    const REAL_NAMES = [
      "census.err",
      "census.sql",
      "dump.log",
      "ledger.csv",
      "ledger.err",
      "marker.err",
      "post-census.rollback-view.txt",
      "post-census.txt",
      "pre-census.rollback-view.txt",
      "pre-census.txt",
      "README.txt",
      "refdata.err",
      "refdata.sql",
      "restore.sql",
      "schema-before.sql",
      "survivors.keys",
      "survivors.sql",
      "transaction.out",
    ];
    /** A name the script does not write today — the "future file" the rule is for. */
    const UNEXPECTED = "future-thing.txt";
    /**
     * The SAME rule, in the three extension classes the step used to admit by GLOB.
     *
     * ⛔ WHY A SECOND FUTURE FILE (Phase 164.8.2, review WR-01). `UNEXPECTED` above is a
     * `.txt`, so until 2026-09-10 the default-out rule was PROVEN for one extension and
     * merely ASSERTED for the rest — while the step's channel loop was
     * `for c in "${outdir}"/*.err "${outdir}"/*.log "${outdir}"/*.out`, i.e. in-by-default
     * for three whole classes. The reviewer executed the shipped step with a seeded
     * `future-census.out` carrying `CREATE POLICY … USING (<qual>)` and watched it reach
     * the world-readable artifact. This fixture is that file, and it is seeded with the
     * same DDL marker so its presence is measurable and not merely a name in a list.
     */
    const UNEXPECTED_CHANNEL = "future-census.out";
    /** The DDL shape the finding is actually about, seeded so its absence is measurable. */
    const POLICY_MARKER = "CREATE POLICY p ON t USING (owner = current_user)";
    const DDL_BEARING = [
      "pre-census.txt",
      "post-census.txt",
      "pre-census.rollback-view.txt",
      "post-census.rollback-view.txt",
      "survivors.sql",
      "restore.sql",
      UNEXPECTED_CHANNEL,
    ];

    /**
     * The by-NAME allowlist, parsed OUT of the step's own `for f in …; do` line.
     *
     * ⛔ WHY IT IS PARSED AND NOT RESTATED. A literal copy here would let the two
     * lists drift, and a test asserting the staged set equals ITS OWN list while the
     * workflow copies a different one is green over the wrong question. The literal
     * below exists too — but only so the PARSE can be checked against it, and the
     * parse is calibrated by mutating a name in the YAML.
     */
    function stagedNameList(text: string): string[] {
      const body = stepBody(text, STAGE);
      const m = body.match(/^\s*for f in ([^;\n]+); do$/m);
      return m ? m[1].trim().split(/\s+/) : [];
    }

    /**
     * The diagnostic-channel allowlist, parsed OUT of the step's own `for c in …; do`
     * line — the same discipline, and the same parse, as `stagedNameList` above.
     *
     * ⛔ IT RETURNS THE RAW TOKENS, GLOBS INCLUDED, ON PURPOSE (Phase 164.8.2, WR-01).
     * The predecessor of this function returned bare EXTENSIONS (`err`/`log`/`out`)
     * scraped out of `"${outdir}"/*.err`, which meant every predicate built on it
     * asked "does this file's extension match?" — and a predicate that can only ask
     * that cannot report the defect that a whole extension class is admitted. Reading
     * the tokens verbatim lets the arm below assert that none of them contains `*`,
     * which is the actual rule.
     */
    function stagedChannelNames(text: string): string[] {
      const body = stepBody(text, STAGE);
      const m = body.match(/^\s*for c in ([^;\n]+); do$/m);
      return m ? m[1].trim().split(/\s+/) : [];
    }

    /** What the workflow's OWN two lists say should be staged, given a seeded set. */
    function expectedStaged(text: string, seeded: string[]): string[] {
      const carriedBy = [...stagedNameList(text), ...stagedChannelNames(text)];
      return seeded.filter((f) => carriedBy.includes(f)).sort();
    }

    /**
     * Seed a fixture RUNNER_TEMP and run a (possibly mutated) copy of the step.
     *
     * `redactOutcome` is the value CI passes in through `env: REDACT_OUTCOME:
     * ${{ steps.redact.outcome }}`. It defaults to `"success"` because that is the
     * only outcome under which the artifact is publishable at all; the arms that care
     * about the other direction pass it explicitly (Phase 164.8.2, review WR-06).
     */
    function runStage(
      script: string,
      seed: string[],
      redactOutcome = "success",
    ): {
      status: number | null;
      output: string;
      staged: string[];
      stageExists: boolean;
      /** The staged files' BYTES, read before the fixture is torn down. */
      contents: Record<string, string>;
    } {
      const runnerTemp = mkdtempSync(join(tmpdir(), "stage-run-"));
      const outdir = join(runnerTemp, "test-backup");
      mkdirSync(outdir, { recursive: true });
      for (const f of seed) {
        const extra = DDL_BEARING.includes(f) ? `${POLICY_MARKER}\n` : "";
        writeFileSync(join(outdir, f), `MARKER-${f}\n${extra}`);
      }
      const scriptFile = join(runnerTemp, "stage.sh");
      writeFileSync(scriptFile, script);
      const r = spawnSync("bash", [scriptFile], {
        encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: runnerTemp, REDACT_OUTCOME: redactOutcome },
      });
      const stageDir = join(runnerTemp, "test-backup-artifact");
      let staged: string[] = [];
      let stageExists = true;
      try {
        staged = readdirSync(stageDir).sort();
      } catch {
        stageExists = false;
      }
      // Read the BYTES before the teardown: an arm that asks "did the leaked file
      // actually carry the DDL" cannot ask it of a directory that no longer exists,
      // and "the file is named in the manifest" is a weaker claim than "the file is
      // in the artifact and here is the policy line inside it".
      const contents: Record<string, string> = {};
      for (const f of staged) contents[f] = readFileSync(join(stageDir, f), "utf8");
      rmSync(runnerTemp, { recursive: true, force: true });
      return {
        status: r.status,
        output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
        staged,
        stageExists,
        contents,
      };
    }

    it("the test's allowlist and the step's `for f in …` line are the SAME list", () => {
      // The literal is the DECISION (founder amendment 2026-09-09): the reversal
      // recipe plus the script's four named `.sql` files. `survivors.sql` is IN —
      // pinned here precisely so nobody "completes" the narrowing by removing it,
      // which is what the superseded research recommendation would have done.
      const DECIDED = [
        "ledger.csv",
        "schema-before.sql",
        "README.txt",
        "census.sql",
        "survivors.sql",
        "restore.sql",
        "refdata.sql",
      ];
      expect(
        stagedNameList(WF),
        "the staging step's `for f in …; do` line no longer copies exactly the decided allowlist. If a name was ADDED, the founder's default-out rule says say why in the step comment and update this list in the same edit; if `survivors.sql` was REMOVED, an aborted restore stops being reversible — that was rejected explicitly (CONTEXT Area 2, AMENDED 2026-09-09).",
      ).toEqual(DECIDED);
      // ⛔ THE CHANNELS ARE A LIST OF NAMES, NOT A LIST OF CLASSES (Phase 164.8.2,
      // WR-01). These six are the complete set of `.err`/`.log`/`.out` files written
      // into `${RUNNER_TEMP}/test-backup`, REGENERATED from the two writers rather
      // than carried from the review:
      //   grep -oE 'RESTORE_OUT_DIR}?/[A-Za-z0-9_.-]+\.(err|log|out)' scripts/restore-test-from-baseline.sh
      //   grep -oE 'outdir}?/[A-Za-z0-9_.-]+\.(err|log|out)'          .github/workflows/test-restore-from-baseline.yml
      // A channel this job gains tomorrow is OUT until it is named here and in the
      // step, which is the same default-out rule the content files have always had —
      // and, until this phase, the one thing the channels did not.
      const DECIDED_CHANNELS = [
        "census.err",
        "ledger.err",
        "marker.err",
        "refdata.err",
        "dump.log",
        "transaction.out",
      ];
      expect(
        stagedChannelNames(WF),
        "the staging step's `for c in …; do` line no longer copies exactly the decided channel allowlist. It was a GLOB over three whole extension classes until 2026-09-10 (review WR-01, proven by executing the step against a seeded `future-census.out` carrying reconstructed CREATE POLICY DDL, which reached the artifact). Do not restore the glob: name the channel and say why.",
      ).toEqual(DECIDED_CHANNELS);
      expect(
        stagedChannelNames(WF).some((n) => n.includes("*")),
        "the channel allowlist has been widened back to a glob — every future `.err`/`.log`/`.out` file is then IN by default, which is the defect review WR-01 measured by execution",
      ).toBe(false);
      // CALIBRATION — the channel PARSE must break when a channel name changes, or
      // the agreement above is between two constants.
      calibrate(
        "the channel allowlist is parsed out of the step, not restated",
        (s) => s.replace("for c in census.err ledger.err", "for c in census.ERR ledger.err"),
        (t) => stagedChannelNames(t).includes("census.err"),
      );

      // CALIBRATION — the PARSE must break when a name changes, or the agreement
      // above is between two constants and measures nothing.
      calibrate(
        "the allowlist is parsed out of the step, not restated",
        (s) => s.replace("for f in ledger.csv schema-before.sql", "for f in ledger.csv schema-AFTER.sql"),
        (t) => stagedNameList(t).includes("schema-before.sql"),
      );
      // ⛔ A GLOB IS NOT AN ALLOWLIST. `*.sql` would re-admit every future `.sql` the
      // script writes, which is the in-by-default shape WR-05 exists to remove.
      expect(
        stagedNameList(WF).some((n) => n.includes("*")),
        "the by-name allowlist has been widened to a glob — every future file matching it is then IN by default, which is the exact defect this step replaced",
      ).toBe(false);
    });

    it("EXECUTED — the staged set is exactly the allowlist over all 18 REAL names", () => {
      const script = extractRunScript(WF, STAGE);
      const seed = [...REAL_NAMES, UNEXPECTED, UNEXPECTED_CHANNEL];
      const r = runStage(script, seed);

      expect(
        r.status,
        `the staging step failed on a complete fixture directory (exit ${r.status}).\n${r.output}`,
      ).toBe(0);
      expect(
        r.staged,
        `the staged set is not what the step's own two lists say it should be.\n${r.output}`,
      ).toEqual(expectedStaged(WF, seed));

      // Named, so a failure says WHICH file leaked rather than printing two arrays.
      for (const withheld of [
        "pre-census.txt",
        "post-census.txt",
        "pre-census.rollback-view.txt",
        "post-census.rollback-view.txt",
        "survivors.keys",
        UNEXPECTED,
        UNEXPECTED_CHANNEL,
      ]) {
        expect(
          r.staged.includes(withheld),
          `\`${withheld}\` reached the world-readable artifact. The census text files restate the survivor DDL with owner-named rows read off live shared TEST and have no reversal claim on it (T-164.8-21); \`survivors.keys\` is neither recipe nor channel; \`${UNEXPECTED}\` and \`${UNEXPECTED_CHANNEL}\` stand for every file the job gains tomorrow — a content file and a DIAGNOSTIC CHANNEL — and both must be OUT until someone names them. \`${UNEXPECTED_CHANNEL}\` is seeded with ${JSON.stringify(POLICY_MARKER)}: review WR-01 proved by execution that the channel loop's glob published exactly this.`,
        ).toBe(false);
      }
      expect(
        r.staged.includes("survivors.sql"),
        "`survivors.sql` is NOT staged. It is the DDL that re-creates the non-public objects depending on `public`; without it an aborted restore is not reversible. Dropping it was considered and REJECTED (CONTEXT Area 2, AMENDED 2026-09-09) — do not 'complete' the narrowing this way.",
      ).toBe(true);
      // The count is derived, never restated: 18 real + 1 future, minus the five
      // withheld and the future one.
      expect(r.output).toContain(`staged ${r.staged.length} file(s) from`);

      // ⭐ CALIBRATION 2 — THE OBSERVED RED. Replace the enumerated copy with the OLD
      // shape (`cp -a` of the whole directory) and the arm must SEE it: `pre-census.txt`
      // is staged again. Without this twin, "pre-census.txt is absent" could be
      // reported by a fixture that never contained it.
      const OLD_SHAPE_ANCHOR =
        '  for f in ledger.csv schema-before.sql README.txt census.sql survivors.sql restore.sql refdata.sql; do\n' +
        '    if [ -f "${outdir}/${f}" ]; then\n' +
        '      cp -p "${outdir}/${f}" "${stage}/"\n' +
        "    fi\n" +
        "  done\n";
      expect(
        script.includes(OLD_SHAPE_ANCHOR),
        "the staging step's enumerated copy loop is no longer the form this calibration mutates — re-anchor the mutation rather than deleting the twin, or the arm silently stops being evidence",
      ).toBe(true);
      const neutered = script.replace(OLD_SHAPE_ANCHOR, '  cp -a "${outdir}/." "${stage}/"\n');
      expect(
        neutered,
        "CALIBRATION: the neuter produced an identical script, so it proves nothing",
      ).not.toBe(script);
      const old = runStage(neutered, seed);
      expect(
        old.staged.includes("pre-census.txt"),
        `CALIBRATION: the whole-directory neuter did NOT put \`pre-census.txt\` in the artifact, so this arm cannot see the shape it exists to forbid.\n${old.output}`,
      ).toBe(true);
      expect(
        old.staged.includes(UNEXPECTED),
        "CALIBRATION: the whole-directory neuter did not stage the unexpected file either — the fixture is not exercising the default-out rule",
      ).toBe(true);

      // ⭐ CALIBRATION 3 — THE SHIPPED DEFECT, RE-RUN (Phase 164.8.2, review WR-01).
      // Calibration 2 above mutates the CONTENT loop, so it could only ever prove the
      // default-out rule for the by-name half. Put the channel loop's GLOB back — the
      // exact three-class form that shipped — and the seeded `future-census.out`
      // returns to the world-readable artifact with its CREATE POLICY line intact.
      // That is the reviewer's measurement, kept as a standing twin so the glob cannot
      // come back quietly.
      const CHANNEL_LOOP_ANCHOR =
        "    for c in census.err ledger.err marker.err refdata.err dump.log transaction.out; do\n" +
        '      if [ -f "${outdir}/${c}" ]; then\n' +
        '        cp -p "${outdir}/${c}" "${stage}/"\n' +
        "      fi\n" +
        "    done\n";
      expect(
        script.includes(CHANNEL_LOOP_ANCHOR),
        "the staging step's enumerated CHANNEL loop is no longer the form this calibration mutates — re-anchor the mutation rather than deleting the twin, or the arm silently stops being evidence",
      ).toBe(true);
      const globbed = script.replace(
        CHANNEL_LOOP_ANCHOR,
        '    for c in "${outdir}"/*.err "${outdir}"/*.log "${outdir}"/*.out; do\n' +
          '      if [ -f "${c}" ]; then\n' +
          '        cp -p "${c}" "${stage}/"\n' +
          "      fi\n" +
          "    done\n",
      );
      expect(
        globbed,
        "CALIBRATION: the channel-glob neuter produced an identical script, so it proves nothing",
      ).not.toBe(script);
      const leaked = runStage(globbed, seed);
      expect(
        leaked.staged.includes(UNEXPECTED_CHANNEL),
        `CALIBRATION: restoring the channel GLOB did not put \`${UNEXPECTED_CHANNEL}\` in the artifact, so this arm cannot see the shape review WR-01 measured. Without this twin, "the future channel is absent" could be reported by a fixture that never contained it.`,
      ).toBe(true);
      expect(
        leaked.contents[UNEXPECTED_CHANNEL] ?? "",
        "CALIBRATION: the leaked future channel did not carry the policy marker, so the fixture is not exercising the byte class the finding is about",
      ).toContain(POLICY_MARKER);
    });

    it("EXECUTED — a forced failure inside the step FAILS CLOSED: exit 1, nothing staged", () => {
      // ⛔ THE FAIL-CLOSED HALF. The upload is `if: always()`, so a staging step that
      // merely failed would leave whatever it had already copied to be published. The
      // trap removes the staging directory, and `if-no-files-found: error` then makes
      // the upload red rather than quiet. `false` in place of `cp` is the redaction
      // twin's idiom: deterministic on every platform.
      const script = extractRunScript(WF, STAGE);
      expect(
        script.includes('cp -p "${outdir}/${f}" "${stage}/"'),
        "the staging step's first `cp -p` is no longer the form this twin forces to fail — re-anchor it",
      ).toBe(true);
      const forced = script.replace('cp -p "${outdir}/${f}" "${stage}/"', 'false -p "${outdir}/${f}" "${stage}/"');
      expect(forced, "CALIBRATION: the forced-failure mutation changed nothing").not.toBe(script);

      const r = runStage(forced, REAL_NAMES);
      expect(
        r.status,
        `a failed copy did not fail the staging step (exit ${r.status}). The upload is \`if: always()\`; a green staging step is the only thing that makes the artifact safe to publish.\n${r.output}`,
      ).toBe(1);
      expect(
        r.stageExists && r.staged.length > 0,
        `the staging directory SURVIVED a failed staging run with ${r.staged.length} file(s) in it (${r.staged.join(", ")}) — those would be uploaded. Fail-closed means the directory is REMOVED so \`if-no-files-found: error\` reddens the upload.`,
      ).toBe(false);
      expect(r.output).toContain("::error::");
      expect(r.output).toContain("staging FAILED");
    });

    // -----------------------------------------------------------------------
    // WR-06 (Phase 164.8.2) — a FAILED redaction must not be followed by the
    // publication of the very channels its own error message says not to publish.
    //
    // ⛔ THE DEFECT. `withhold_channels()` prints, verbatim, "Do NOT publish this
    // run's artifact: treat the TEST pooler host, its IP and the DB user as
    // disclosed." The staging step runs `if: always()`, consulted nothing, and
    // copied whatever `*.err/*.log/*.out` survived — after which the `if: always()`
    // upload published them. The workflow shipped exactly what it told the operator
    // not to ship. The trigger (an `rm -f` that fails) is low-realism, but it is
    // explicitly coded for, and the whole point of the fail-closed trap next door is
    // that the unlikely path is the one worth wiring.
    // -----------------------------------------------------------------------
    it("the staging step is WIRED to the redaction step's outcome, by id", () => {
      expect(
        stepHead(WF, REDACT).includes("\n        id: redact\n"),
        "the redaction step lost its `id: redact`, so `steps.redact.outcome` evaluates to the empty string and the staging step's guard would silently withhold every channel on EVERY run — a control that always fires is as uninformative as one that never does",
      ).toBe(true);
      expect(
        stepHead(WF, STAGE).includes("REDACT_OUTCOME: ${{ steps.redact.outcome }}"),
        "the staging step no longer receives the redaction step's outcome. Without it the channel loop is back to copying whatever survived a FAILED redaction into a world-readable artifact (review WR-06).",
      ).toBe(true);
      calibrate(
        "the staging step reads the redaction step's outcome",
        (s) => s.replace("REDACT_OUTCOME: ${{ steps.redact.outcome }}", "REDACT_OUTCOME: success"),
        (t) => stepHead(t, STAGE).includes("REDACT_OUTCOME: ${{ steps.redact.outcome }}"),
      );
      calibrate(
        "the redaction step carries the id the staging step names",
        (s) => s.replace("\n        id: redact\n", "\n"),
        (t) => stepHead(t, REDACT).includes("\n        id: redact\n"),
      );
    });

    it("EXECUTED — a FAILED redaction stages NO channel, and still stages the reversal recipe", () => {
      const script = extractRunScript(WF, STAGE);
      const seed = [...REAL_NAMES, UNEXPECTED, UNEXPECTED_CHANNEL];

      const r = runStage(script, seed, "failure");
      expect(
        r.status,
        `the staging step failed outright on a failed redaction (exit ${r.status}). A failed redaction costs the run's DIAGNOSTICS, never its reversal recipe — that is the discipline the redaction step's own comment states.\n${r.output}`,
      ).toBe(0);

      const channels = stagedChannelNames(WF);
      expect(channels.length, "no channel names parsed — the assertion below would be vacuous").toBe(
        6,
      );
      for (const c of channels) {
        expect(
          r.staged.includes(c),
          `\`${c}\` was published after a FAILED redaction. \`withhold_channels()\` prints "Do NOT publish this run's artifact: treat the TEST pooler host, its IP and the DB user as disclosed" — and this step then published it anyway (review WR-06).`,
        ).toBe(false);
      }
      expect(
        r.staged,
        "the reversal recipe did not survive a failed redaction. ledger.csv, schema-before.sql and the four script `.sql` files carry no connection metadata; withholding them would turn a lost diagnostic into a lost undo.",
      ).toEqual(
        ["ledger.csv", "schema-before.sql", "README.txt", "census.sql", "survivors.sql", "restore.sql", "refdata.sql"].sort(),
      );
      expect(
        r.output,
        "the withheld channels were withheld SILENTLY — an operator reading the artifact would not know the diagnostics are missing rather than absent",
      ).toContain("::error::");
      expect(r.output).toContain("did not succeed");

      // ⭐ CALIBRATION — THE OBSERVED RED. Strip the guard, leaving the unconditional
      // loop that shipped, and the channels come straight back on the same failed
      // redaction. Without this twin, "no channel is staged" could be reported by a
      // fixture that staged nothing for an unrelated reason.
      const GUARD_ANCHOR = '  if [ "${REDACT_OUTCOME:-}" = "success" ]; then\n';
      expect(
        script.includes(GUARD_ANCHOR),
        "the staging step's redaction-outcome guard is no longer the form this calibration strips — re-anchor the mutation rather than deleting the twin",
      ).toBe(true);
      const ungated = script
        .replace(GUARD_ANCHOR, "")
        .replace(
          /^ {2}else\n {4}echo "::error::the redaction step did not succeed[\s\S]*?\n {2}fi\n/m,
          "",
        );
      expect(
        ungated,
        "CALIBRATION: the un-gating mutation changed nothing, so it proves nothing",
      ).not.toBe(script);
      const leaked = runStage(ungated, seed, "failure");
      expect(
        leaked.status,
        `CALIBRATION: the un-gated script did not even run (exit ${leaked.status}) — the mutation broke the shell rather than removing the control, so the arm is not evidence.\n${leaked.output}`,
      ).toBe(0);
      const leakedChannels = channels.filter((c) => leaked.staged.includes(c));
      expect(
        leakedChannels,
        "CALIBRATION: removing the guard did NOT republish the channels on a failed redaction, so this arm cannot see the shape review WR-06 is about",
      ).toEqual(channels);
    });

    it("EXECUTED — a run that died before the backup step still stages a self-explaining note", () => {
      // Not an error path: the run is ALREADY red for its own reason, and a second red
      // from `if-no-files-found: error` would point the next reader at the artifact
      // plumbing instead of the actual failure.
      const script = extractRunScript(WF, STAGE);
      const runnerTemp = mkdtempSync(join(tmpdir(), "stage-nobackup-"));
      const scriptFile = join(runnerTemp, "stage.sh");
      writeFileSync(scriptFile, script);
      const r = spawnSync("bash", [scriptFile], {
        encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: runnerTemp },
      });
      const staged = readdirSync(join(runnerTemp, "test-backup-artifact")).sort();
      const note = readFileSync(join(runnerTemp, "test-backup-artifact", "README.txt"), "utf8");
      rmSync(runnerTemp, { recursive: true, force: true });

      expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
      expect(staged).toEqual(["README.txt"]);
      expect(note).toContain("failed before the backup step");
    });

    it("the stage step runs on every outcome, and BETWEEN the redaction and the upload", () => {
      // ⛔ ORDER IS THE CONTROL, exactly as it is for the redaction. All three steps
      // are `if: always()` and `always()` steps run in FILE ORDER, so the only thing
      // making the redaction a precondition of staging — and staging a precondition of
      // the upload — is that they are written in that order.
      const b = jobBlock(WF, RESTORE_JOB);
      expect(stepIndex(b, STAGE), "the staging step is gone").toBeGreaterThan(-1);
      expect(
        liveLines(stepBody(WF, STAGE)).some((l) => l.trim() === "if: always()"),
        "the staging step no longer carries `if: always()` — on an ABORTED run it would not run at all, and the aborted run is the one whose artifact matters most",
      ).toBe(true);
      expect(stepIndex(b, REDACT)).toBeLessThan(stepIndex(b, STAGE));
      expect(stepIndex(b, STAGE)).toBeLessThan(stepIndex(b, UPLOAD));

      calibrate(
        "the staging step precedes the upload step",
        (s) =>
          s
            .replace(`- name: ${STAGE}`, "- name: __SWAP__")
            .replace(`- name: ${UPLOAD}`, `- name: ${STAGE}`)
            .replace("- name: __SWAP__", `- name: ${UPLOAD}`),
        (t) => {
          const jb = jobBlock(t, RESTORE_JOB);
          const st = stepIndex(jb, STAGE);
          const up = stepIndex(jb, UPLOAD);
          return st > -1 && up > -1 && st < up;
        },
      );
      calibrate(
        "the redaction precedes the staging, so only SCRUBBED channels are copied",
        (s) =>
          s
            .replace(`- name: ${REDACT}`, "- name: __SWAP__")
            .replace(`- name: ${STAGE}`, `- name: ${REDACT}`)
            .replace("- name: __SWAP__", `- name: ${STAGE}`),
        (t) => {
          const jb = jobBlock(t, RESTORE_JOB);
          const rd = stepIndex(jb, REDACT);
          const st = stepIndex(jb, STAGE);
          return rd > -1 && st > -1 && rd < st;
        },
      );
      calibrate(
        "the staging runs on an aborted run too",
        (s) => s.replace(`      - name: ${STAGE}\n        if: always()\n`, `      - name: ${STAGE}\n`),
        (t) => liveLines(stepBody(t, STAGE)).some((l) => l.trim() === "if: always()"),
      );
    });

    /**
     * The `README.txt` heredoc's "WHAT IS HERE" entries, as filename tokens.
     *
     * The README is INSIDE the artifact — it is the first thing whoever downloads it
     * reads — so a README describing a file the artifact does not carry is the same
     * defect as the SCOPE comment that cost Phase 164.8 eight hours, just shipped to a
     * wider audience. Sliced from `WHAT IS HERE` to `DELIBERATELY NOT HERE` (the
     * withheld list is prose ABOUT files that are absent and must not be read as
     * contents). Entry lines carry exactly 12 leading spaces; continuations carry 30,
     * and the description column is fixed at 30 — that fixed layout is what makes the
     * filename field extractable without guessing which dotted token is a filename.
     */
    function readmeEntries(text: string): string[] {
      const body = stepBody(text, BACKUP);
      const from = body.indexOf("WHAT IS HERE");
      if (from < 0) return [];
      const rest = body.slice(from);
      const to = rest.indexOf("DELIBERATELY NOT HERE");
      const section = (to < 0 ? rest : rest.slice(0, to)).split("\n");
      return section
        .filter((l) => /^ {12}\S/.test(l))
        .flatMap((l) => l.slice(12, 30).trim().split(/\s+/))
        .filter((t) => t.length > 0);
    }

    it("the README inside the artifact describes only files the artifact carries", () => {
      // ⛔ NO `*.<ext>` ESCAPE HATCH ANY MORE (Phase 164.8.2, WR-01). This predicate
      // used to admit a `*.err`-shaped entry whenever the step globbed that extension,
      // which is how the README came to describe three whole classes as "here". Both
      // lists are now sets of NAMES, so the agreement is name-for-name.
      const carriedBy = [...stagedNameList(WF), ...stagedChannelNames(WF)];
      const carried = (entry: string): boolean => carriedBy.includes(entry);

      const entries = readmeEntries(WF);
      expect(
        entries.length,
        "the README's WHAT IS HERE list could not be parsed — an empty list would make the agreement below vacuously true",
      ).toBeGreaterThan(4);
      const lying = entries.filter((e) => !carried(e));
      expect(
        lying,
        `the README shipped INSIDE the artifact names ${lying.length} file(s) the staging step does not copy. Whoever downloads this artifact reads that list first; describing a file that is not there is the same false-assurance defect as the SCOPE comment WR-05 was raised about.`,
      ).toEqual([]);

      // CALIBRATION — put `pre-census.txt` back into the README (as an entry line, at
      // the real column) and the predicate must flip. Without this the check could be
      // satisfied by a parser that returns nothing useful.
      calibrate(
        "the README-vs-allowlist agreement bites on a re-inserted pre-census.txt",
        (s) =>
          s.replace(
            "            census.sql        the catalogue query the restore script ran to take its\n",
            "            pre-census.txt    the restore script's pre-drop census, if it got that far.\n" +
              "            census.sql        the catalogue query the restore script ran to take its\n",
          ),
        (t) => {
          const c = [...stagedNameList(t), ...stagedChannelNames(t)];
          return readmeEntries(t).every((x) => c.includes(x));
        },
      );
    });

    /**
     * The files the backup step actually SECRET-SCANS, read off its own calls.
     *
     * ⛔ PARSED, NEVER RESTATED — the whole finding (WR-02) is that a restated scan
     * scope drifted away from the code. A literal `["ledger.csv", "schema-before.sql"]`
     * here would be the same defect one layer up: the test would agree with itself
     * while the workflow scanned something else.
     */
    function scannedFiles(text: string): string[] {
      const body = stepBody(text, BACKUP);
      return [
        ...body.matchAll(/^\s*scan_for_secrets "\$\{outdir\}\/([A-Za-z0-9_.-]+)"/gm),
      ].map((m) => m[1]);
    }

    /** The README's `⚠️ WHAT WAS SCANNED` section, verbatim. */
    function readmeScanSection(text: string): string {
      const body = stepBody(text, BACKUP);
      const from = body.indexOf("⚠️ WHAT WAS SCANNED");
      if (from < 0) return "";
      const rest = body.slice(from);
      const to = rest.indexOf("⛔ WHAT CANNOT BE REVERSED");
      return to < 0 ? rest : rest.slice(0, to);
    }

    it("the README's scan-scope section NAMES every staged file that nothing scanned", () => {
      // ⛔ THE FINDING (Phase 164.8.2, review WR-02). Plan 03 rewrote `WHAT IS HERE` to
      // advertise seven files and left the section immediately below saying "both files
      // were scanned" — "both" being ledger.csv and schema-before.sql. The four
      // script-written `.sql` files pass through NO secret scan and NO redaction; the
      // phase established that itself and wrote it into the maintainer-facing SCOPE
      // comment, and the correction never reached the document that ships INSIDE the
      // world-readable artifact. That is the same false-assurance shape WR-05 was
      // raised about, relocated from a maintainer-facing comment to a world-facing one.
      //
      // The rule below is DERIVED, so it cannot drift again: whatever the staging step
      // carries, minus whatever `scan_for_secrets` is actually called on, must be named
      // in the section. Add a file to the artifact without saying it is unscanned and
      // this reds.
      const scanned = scannedFiles(WF);
      expect(
        scanned,
        "the backup step's `scan_for_secrets` calls could not be parsed, or it stopped scanning the two files the README's guarantee is about — an empty list would make the rule below vacuously satisfiable by a README that says nothing",
      ).toEqual(["ledger.csv", "schema-before.sql"]);

      const section = readmeScanSection(WF);
      expect(
        section,
        "the README's `⚠️ WHAT WAS SCANNED` section could not be sliced — the assertion below would be vacuous",
      ).not.toBe("");

      const staged = [...stagedNameList(WF), ...stagedChannelNames(WF)];
      const unscanned = staged.filter((f) => !scanned.includes(f));
      expect(
        unscanned.length,
        "every staged file is scanned, which cannot be true — the derivation is broken, not the workflow",
      ).toBeGreaterThan(0);
      const unnamed = unscanned.filter((f) => !section.includes(f));
      expect(
        unnamed,
        `the README that ships INSIDE the world-readable artifact does not tell its reader that ${unnamed.length} of the file(s) it carries went through NO secret scan: ${unnamed.join(", ")}. The scan runs in the backup step, before the restore script exists to write them. survivors.sql and restore.sql carry pg_get_triggerdef(...) and a reconstructed CREATE POLICY … USING (<qual>) read off live shared TEST, and this artifact is public for 90 days.`,
      ).toEqual([]);

      // ⛔ AND THE SECTION'S OWN NUMERAL IS DERIVED FROM THE ALLOWLIST, not restated.
      // The heading says how many files this artifact carries; a hand-typed word there
      // is stale the first time a name is added, and a stale numeral beside a corrected
      // paragraph is how WR-02 happened in the first place.
      const WORDS = [
        "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
        "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
        "SEVENTEEN", "EIGHTEEN", "NINETEEN", "TWENTY",
      ];
      const word = WORDS[staged.length];
      expect(word, `no numeral word for a ${staged.length}-file artifact — extend WORDS`).toBeTruthy();
      expect(
        section,
        `the README's scan-scope heading no longer says how many files this artifact carries, or says the wrong number. The staging step's two lists now carry ${staged.length}, so the heading must read "THESE ${word}".`,
      ).toContain(`THESE ${word}`);
      calibrate(
        "the scan-scope heading's file count is derived from the allowlist, not typed",
        (s) =>
          s.replace(
            "for f in ledger.csv schema-before.sql README.txt census.sql",
            "for f in ledger.csv schema-before.sql README.txt survivors.keys census.sql",
          ),
        (t) => {
          const n = [...stagedNameList(t), ...stagedChannelNames(t)].length;
          return readmeScanSection(t).includes(`THESE ${WORDS[n]}`);
        },
      );

      // CALIBRATION 1 — delete one name from the section and the rule must flip.
      // Without this, "nothing is unnamed" could be reported by a section that
      // happens to contain every word.
      // ⚠️ `census.err` and NOT `survivors.sql`, deliberately: survivors.sql is named
      // TWICE in this section (once in the enumeration, once in the sentence about the
      // DDL it carries), so deleting one mention leaves the other and the mutation is
      // a no-op the predicate cannot see. Measured while writing this arm — the first
      // version of it did exactly that and reported a twin that does not bite.
      calibrate(
        "the scan-scope rule bites when a staged file stops being named as unscanned",
        (s) => s.replace("census.err, ledger.err, marker.err", "ledger.err, marker.err"),
        (t) => {
          const sec = readmeScanSection(t);
          const sc = scannedFiles(t);
          return [...stagedNameList(t), ...stagedChannelNames(t)]
            .filter((f) => !sc.includes(f))
            .every((f) => sec.includes(f));
        },
      );
      // CALIBRATION 2 — the direction that actually caused WR-02: a file is ADDED to
      // the artifact and the scan-scope paragraph is left alone.
      calibrate(
        "the scan-scope rule bites on a file added to the artifact but not to the section",
        (s) =>
          s.replace(
            "for f in ledger.csv schema-before.sql README.txt census.sql survivors.sql restore.sql refdata.sql; do",
            "for f in ledger.csv schema-before.sql README.txt census.sql survivors.sql restore.sql refdata.sql pre-census.txt; do",
          ),
        (t) => {
          const sec = readmeScanSection(t);
          const sc = scannedFiles(t);
          return [...stagedNameList(t), ...stagedChannelNames(t)]
            .filter((f) => !sc.includes(f))
            .every((f) => sec.includes(f));
        },
      );
      // ⛔ AND THE SUPERSEDED SENTENCE MUST NOT COME BACK. "both files were scanned"
      // was true of a two-file artifact and false of this one; an absence assertion is
      // only evidence if the presence of the thing can be detected, hence the twin.
      const DEAD = "was allowed to proceed to any write, both files were scanned";
      expect(
        WF.includes(DEAD),
        `the superseded README sentence ${JSON.stringify(DEAD)} is back. It describes a two-file artifact; this one carries ${staged.length} files, ${unscanned.length} of them scanned by nothing.`,
      ).toBe(false);
      calibrate(
        "the dead 'both files were scanned' sentence would be caught if it came back",
        (s) => s.replace("⚠️ WHAT WAS SCANNED", `${DEAD}\n          ⚠️ WHAT WAS SCANNED`),
        (t) => !t.includes(DEAD),
      );
    });

    /**
     * The contiguous `#` comment block immediately ABOVE a step's `- name:` line.
     *
     * ⚠️ `stepHead()` starts AT the `- name:` line, so it cannot see this — measured
     * while writing this arm: the first version used `stepHead` and reported a missing
     * sentence that was present four lines higher. The comment being pinned lives
     * above the step, which is where this file's convention puts the reasoning.
     */
    function precedingComment(text: string, name: string): string {
      const lines = text.split("\n");
      const i = lines.findIndex((l) => l.trim() === `- name: ${name}`);
      if (i < 0) return "";
      const out: string[] = [];
      for (let k = i - 1; k >= 0 && /^\s*#/.test(lines[k]); k -= 1) out.unshift(lines[k]);
      return out.join("\n");
    }

    it("the SCOPE comment no longer claims a scan scope the code does not have", () => {
      // ⛔ THE COMMENT IS THE FINDING. WR-05 is not only about which bytes ship — the
      // step comment asserted that `ledger.csv` and "the two .sql files" were
      // secret-scanned when they were written. There are FIVE `.sql` files in that
      // directory and the scan runs BEFORE four of them exist. A reader who trusted it
      // had no reason to look further, which is how the census text shipped for a phase.
      const scope = precedingComment(WF, REDACT);
      expect(
        scope,
        "the redaction step's preceding comment block could not be sliced — the pin below would be vacuous",
      ).not.toBe("");
      expect(scope).toContain("SCOPE");

      const DEAD = [
        "They are the only files that can carry connection metadata",
        "two .sql files are left byte-exact by design, and are secret-SCANNED at the point",
      ];
      for (const dead of DEAD) {
        expect(
          WF.includes(dead),
          `the false SCOPE sentence ${JSON.stringify(dead)} is back in the workflow. It describes a control the code does not have: the secret scan runs in the BACKUP step, before four of the five .sql files exist.`,
        ).toBe(false);
      }
      // CALIBRATION — an absence assertion proves nothing unless the presence of the
      // thing can be detected. Re-insert the sentence on a scratch copy.
      calibrate(
        "the dead SCOPE sentence would be caught if it came back",
        (s) => s.replace("      # ⚠️ SCOPE — CORRECTED", `      # ${DEAD[0]}\n      # ⚠️ SCOPE — CORRECTED`),
        (t) => DEAD.every((d) => !t.includes(d)),
      );

      // And it must name what ACTUALLY withholds the rest — the staging step — so the
      // next reader is sent to the real mechanism rather than to this one.
      calibrate(
        "the SCOPE comment names the staging step as the control that withholds the rest",
        (s) =>
          s.replace(
            "      #     `Stage the public artifact (enumerated allowlist; default-out)` step below,",
            "      #     a step below,",
          ),
        (t) =>
          precedingComment(t, REDACT).includes(
            "Stage the public artifact (enumerated allowlist; default-out)",
          ),
      );
    });

    it("the upload publishes the STAGING directory, never the raw backup directory", () => {
      const body = stepBody(WF, UPLOAD);
      expect(
        liveLines(body).some((l) => l.trim() === "path: ${{ runner.temp }}/test-backup-artifact"),
        "the upload's `path:` no longer points at the staging directory. Pointed back at `${{ runner.temp }}/test-backup` it publishes every file the restore script wrote — the pre-drop census included — which is the finding this step closed.",
      ).toBe(true);
      calibrate(
        "the upload does not publish the un-enumerated backup directory",
        (s) =>
          s.replace(
            "          path: ${{ runner.temp }}/test-backup-artifact\n",
            "          path: ${{ runner.temp }}/test-backup\n",
          ),
        (t) =>
          liveLines(stepBody(t, UPLOAD)).some(
            (l) => l.trim() === "path: ${{ runner.temp }}/test-backup-artifact",
          ),
      );
    });
  });

  describe("B4 — the workflow's marker gate is coupled to the script's constants", () => {
    it("both hard-coded regexes still equal the script's RESTORE_*_MARKER_RE defaults", () => {
      // ⛔ THE FAILURE DIRECTION. The workflow hard-codes COPIES of two script
      // defaults, and this step is the EARLIER and CHEAPER of the two gates: it
      // refuses before `supabase db dump` reads anything. Tighten the script's
      // defaults without tightening these copies and the cheap gate silently becomes
      // the WEAKER one — it admits a database the script would refuse, after the
      // backup has already read it and written it into a PUBLIC artifact. Nothing but
      // this pin couples them.
      //
      // ⭐ READ BY SYMBOL, never by line number: the script's constants move.
      const defaultOf = (name: string): string => {
        const m = SCRIPT.match(
          new RegExp(`^${name}="\\$\\{${name}:-(.*)\\}"$`, "m"),
        );
        expect(
          m,
          `${SCRIPT_PATH} no longer declares \`${name}\` as a \`\${${name}:-<default>}\` assignment on one line. This pin reads it by SYMBOL on purpose — re-anchor it rather than restating the regex here.`,
        ).not.toBeNull();
        return (m as RegExpMatchArray)[1];
      };
      const expectRe = defaultOf("RESTORE_EXPECT_MARKER_RE");
      const refuseRe = defaultOf("RESTORE_REFUSE_MARKER_RE");

      const marker = stepBody(WF, "Which database am I on");
      expect(marker, "the `Which database am I on` step is gone").not.toBe("");
      const greps = liveLines(marker)
        .map((l) => l.match(/grep -Eiq '([^']*)'/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[1]);
      expect(
        greps,
        "the marker step's two `grep -Eiq '…'` tests are no longer exactly the script's expect-then-refuse defaults, in that order. Whichever side was tightened, tighten the other: this step runs BEFORE the backup, so a workflow regex looser than the script's admits a database the script would refuse.",
      ).toEqual([expectRe, refuseRe]);

      // CALIBRATION — tighten the SCRIPT's default only, exactly the one-sided edit
      // this pin exists to catch, and the pin must flip.
      const tightened = SCRIPT.replace(
        "RESTORE_REFUSE_MARKER_RE:-prod",
        "RESTORE_REFUSE_MARKER_RE:-prod|production",
      );
      expect(tightened, "CALIBRATION: the mutation changed nothing").not.toBe(SCRIPT);
      const mutatedRefuse = (tightened.match(
        /^RESTORE_REFUSE_MARKER_RE="\$\{RESTORE_REFUSE_MARKER_RE:-(.*)\}"$/m,
      ) as RegExpMatchArray)[1];
      expect(
        greps[1] === mutatedRefuse,
        "CALIBRATION: the workflow's copy matched the TIGHTENED script default too, so the pin cannot see a one-sided tightening",
      ).toBe(false);
    });
  });

  describe("no softening: a failure here can never read as a pass", () => {
    it("no softening token survives in the restore job (mutex steps excluded, see the comment)", () => {
      expect(
        softeningOffenders(WF),
        "a softening token appeared in the restore job outside the two ci.yml-copied mutex steps",
      ).toEqual([]);
      calibrate(
        "the softening scan bites",
        (s) =>
          s.replace(
            "      - name: Run the restore script\n",
            "      - name: Run the restore script\n        continue-on-error: true\n",
          ),
        (t) => softeningOffenders(t).length === 0,
      );
      calibrate(
        "the softening scan bites on a bare `exit 0` too",
        (s) =>
          s.replace(
            '          bash scripts/restore-test-from-baseline.sh --run --mode "$MODE"\n',
            '          bash scripts/restore-test-from-baseline.sh --run --mode "$MODE" || exit 0\n',
          ),
        (t) => softeningOffenders(t).length === 0,
      );

      // ⛔ THE ONE THIS PHASE EXISTS FOR (WR-06). Before the list went to nine, this
      // exact mutation was measured GREEN: a `psql … 2>/dev/null` on the ONE step whose
      // stderr is the evidence that the database could not be identified was invisible
      // to this scan. The shape is not invented — it is the marker step's own stderr
      // redirect, pointed at /dev/null instead of at marker.err, which is what a
      // "quieten the log" edit would actually look like.
      calibrate(
        "the softening scan bites on a `2>/dev/null` swallowing the MARKER step's psql stderr",
        (s) => s.replace('2>"${RUNNER_TEMP}/marker.err"', "2>/dev/null"),
        (t) => softeningOffenders(t).length === 0,
      );
      // …and it is named, with the count that moved, not merely counted.
      const softenedMarker = WF.replace('2>"${RUNNER_TEMP}/marker.err"', "2>/dev/null");
      expect(softenedMarker, "the marker-step mutation changed nothing").not.toBe(WF);
      const markerOffenders = softeningOffenders(softenedMarker);
      expect(markerOffenders.length, "the softened marker step went unreported").toBeGreaterThan(0);
      expect(
        markerOffenders.join(" | "),
        "the offender is not named `2>/dev/null` — a count with no name sends the next reader to the wrong step",
      ).toContain("2>/dev/null");
      expect(
        markerOffenders.join(" | "),
        "the offender is not reported as an UNLISTED SITE — since 2026-09-10 the rule is over sites, not over a count, so a new suppression must be named as a site that is not in ALLOWED_SITES (silent-failure review F2)",
      ).toContain("UNLISTED SITE");
      expect(
        markerOffenders.join(" | "),
        "the offender does not quote the offending LINE — a report that says only 'a site appeared' sends the next reader to the wrong step, and this is the step that decides TEST from PROD",
      ).toContain('UNLISTED SITE in step "Which database am I on"');

      calibrate(
        "the softening scan bites on a `|| :` — the drop-in for the banned `|| true`",
        (s) =>
          s.replace(
            '          set -euo pipefail\n          export RESTORE_DB_URL=',
            '          set -euo pipefail\n          command -v supabase >/dev/null || :\n          export RESTORE_DB_URL=',
          ),
        (t) => softeningOffenders(t).length === 0,
      );
      calibrate(
        "the softening scan bites on a `set +o pipefail` re-enabling the discarded-status bug",
        (s) =>
          s.replace(
            '          set -euo pipefail\n          export RESTORE_DB_URL=',
            '          set -euo pipefail\n          set +o pipefail\n          export RESTORE_DB_URL=',
          ),
        (t) => softeningOffenders(t).length === 0,
      );
    });

    it("every `run: |` in the restore job turns `-e` ON, except three named blocks", () => {
      // ⛔ THE TENTH CHECK, AND IT IS STRUCTURAL RATHER THAN LEXICAL (silent-failure
      // review F3). The nine-token scan looks for spellings; this one asks the question
      // the spellings are proxies for — "can a failing command in this block go
      // unnoticed?" A step written `set -uo pipefail` answers yes while matching none
      // of the nine.
      const blocks = runBlocks(WF);
      expect(
        blocks.length,
        `only ${blocks.length} \`run: |\` block(s) were parsed out of the scannable restore block (floor ${RUN_BLOCK_FLOOR}, measured 2026-09-10). A parser returning too few makes the rule below vacuously green — the exact failure this file exists to refuse.`,
      ).toBeGreaterThanOrEqual(RUN_BLOCK_FLOOR);
      // ⚠️ `> 0`, DELIBERATELY, AND NOT A SECOND FLOOR. This guard exists only to catch
      // an ERREXIT_RE that matches nothing (which would make every block an offender or
      // none). A tighter bound here — e.g. `>= RUN_BLOCK_FLOOR - NO_ERREXIT_SITES.length`
      // — was written first and SHADOWED the finding: neutering the marker step failed
      // on "expected 12 to be >= 13" instead of on the offender that names the step.
      // A guard that fires before the rule it guards is a worse message, not a stronger
      // check.
      expect(
        blocks.filter((b) => b.live.some((l) => ERREXIT_RE.test(l))).length,
        "no `run: |` block sets `-e` at all — ERREXIT_RE is not matching what it thinks it is, so this rule is measuring nothing",
      ).toBeGreaterThan(0);
      expect(
        errexitOffenders(WF),
        "a `run: |` block in the restore job never turns `-e` on and is not a named exception",
      ).toEqual([]);

      // ⭐ THE FALSIFIER, AND THE PROOF THAT THE NINE-TOKEN SCAN CANNOT SEE IT.
      // Soften the WHOLE of `Which database am I on` — the gate standing between a
      // dashboard-shaped mistake and a DROP SCHEMA on the wrong database — by dropping
      // one letter. No banned token appears anywhere in the mutant.
      const softened = WF.replace(
        "          set -euo pipefail\n          # The session-mode DSN derived ONCE",
        "          set -uo pipefail\n          # The session-mode DSN derived ONCE",
      );
      expect(softened, "the `-e`-dropping mutation changed nothing").not.toBe(WF);
      expect(
        softeningOffenders(softened),
        "CALIBRATION: the NINE-TOKEN scan already caught a step that simply never sets `-e`, so F3 was not a gap and this whole check is buying nothing",
      ).toEqual([]);
      expect(
        errexitOffenders(softened).join(" | "),
        "dropping `-e` from the marker step's `run: |` went unreported — that is `set +e` by another spelling, over the step that decides TEST from PROD",
      ).toContain('NO ERREXIT in step "Which database am I on"');

      // ⭐ AND THE OTHER DIRECTION: an exemption that stopped being needed.
      const tightened = WF.replace("          set -uo pipefail\n", "          set -euo pipefail\n");
      expect(tightened, "the exemption-staling mutation changed nothing").not.toBe(WF);
      expect(
        errexitOffenders(tightened).join(" | "),
        "a step that now sets `-e` kept its exemption and nothing said so — a standing permission to soften it again later, granted by nobody",
      ).toContain("STALE EXEMPTION");

      // ⭐ AND A RENAMED EXEMPTION MUST NOT OUTLIVE ITS STEP.
      const renamed = WF.replace(
        `- name: ${NO_ERREXIT_SITES[2]}`,
        "- name: Probe - the runner image's PostgreSQL server binaries resolve (renamed)",
      );
      expect(renamed, "the rename mutation changed nothing").not.toBe(WF);
      expect(
        errexitOffenders(renamed).join(" | "),
        "an exemption survived the step it exempts being renamed, and the renamed step was then unreported as well",
      ).toContain("DANGLING EXEMPTION");
    });

    it("the token list is NINE, and its two hand-kept siblings must move with it", () => {
      expect(
        SOFTENING_TOKENS,
        "SOFTENING_TOKENS moved off nine. This list is one of THREE hand-kept copies — the others are in `src/__tests__/supabase-migrate-test-first.test.ts` and `src/__tests__/prod-prober-wiring.test.ts`, and they are duplicated deliberately (CONTEXT Area 3, LOCKED: no shared helper module that only wiring tests import). Widen or narrow ALL THREE in the same commit, or the class this phase closed re-opens as 'one of three hardened'.",
      ).toHaveLength(9);
      expect(new Set(SOFTENING_TOKENS).size, "a token is listed twice").toBe(
        SOFTENING_TOKENS.length,
      );
      // ⛔ EXACTLY ONE token has an allowlist, and the other eight are forbidden
      // OUTRIGHT. This replaces the superseded `expect(Object.keys(ALLOWED)).toEqual(
      // ["2>/dev/null"])` (silent-failure review F2 removed the count map). Proven by
      // mutation rather than by reading the code: give each of the other eight a live
      // occurrence and every one of them must be reported.
      expect(
        SOFTENING_TOKENS.includes(SITE_ALLOWLISTED_TOKEN),
        "the site-allowlisted token is not in the scanned list at all, so the site rule governs nothing",
      ).toBe(true);
      for (const token of SOFTENING_TOKENS.filter((t) => t !== SITE_ALLOWLISTED_TOKEN)) {
        const mutant = WF.replace(
          "          set -euo pipefail\n          export RESTORE_DB_URL=",
          `          set -euo pipefail\n          command -v supabase >/dev/null ${token}\n          export RESTORE_DB_URL=`,
        );
        expect(mutant, `the ${token} mutation changed nothing`).not.toBe(WF);
        expect(
          softeningOffenders(mutant).join(" | "),
          `\`${token}\` was tolerated in the scannable restore block. Only \`${SITE_ALLOWLISTED_TOKEN}\` has an allowlist; the other eight are forbidden outright.`,
        ).toContain(token);
      }
    });

    it("the `2>/dev/null` allowlist is an exact set OF SITES, and it reds in BOTH directions AND on a swap", () => {
      // ⛔ THE TITLE USED TO OVERSTATE THE CONTROL (silent-failure review F2). It said
      // "an exact set" while the exactness was over TOKENS
      // (`expect(Object.keys(ALLOWED)).toEqual(["2>/dev/null"])`); the SITES existed
      // only as a five-item prose enumeration in the doc comment. They are executable
      // now, and this arm proves the bijection in all three directions.
      const live = liveLines(scannableRestoreBlock(WF));
      const siteLines = live.filter((l) => l.includes(SITE_ALLOWLISTED_TOKEN));
      expect(
        siteLines.length,
        "the live `2>/dev/null` site count in the scannable restore block moved off its re-measured 4 (it was 5 until 2026-09-10; F4 removed the ancestry probe's suppression). A count is no longer the rule, but a count that disagrees with the site list means the slicing moved.",
      ).toBe(ALLOWED_SITES.length);
      expect(
        softeningOffenders(WF),
        "the real workflow does not satisfy its own site allowlist",
      ).toEqual([]);

      // UP: a NEW site, on the step whose stderr is the evidence.
      const widened = WF.replace('2>"${RUNNER_TEMP}/marker.err"', SITE_ALLOWLISTED_TOKEN);
      expect(widened, "the site-addition mutation changed nothing").not.toBe(WF);
      expect(
        softeningOffenders(widened).join(" | "),
        "a NEW unlisted site went unreported",
      ).toContain("UNLISTED SITE");

      // DOWN: delete one of the justified sites.
      const narrowed = WF.replace(
        ' 2>/dev/null || echo "(no /usr/lib/postgresql/*/bin)"',
        ' || echo "(no /usr/lib/postgresql/*/bin)"',
      );
      expect(narrowed, "the site-removal mutation changed nothing").not.toBe(WF);
      expect(
        softeningOffenders(narrowed).join(" | "),
        "a VANISHED allowlisted site went unreported — the rule is a ceiling, not an exact set",
      ).toContain("VANISHED OR DUPLICATED SITE");

      // ⭐ THE SHAPE A COUNT CANNOT SEE, AND THE REASON THIS ARM WAS REWRITTEN.
      // One benign probe suppression deleted, one added on `Which database am I on`'s
      // psql. Four in, four out. Under the superseded count rule the scan reported
      // ZERO offenders while the step standing between a dashboard-shaped mistake and
      // a DROP SCHEMA on the wrong database went quiet.
      const swapped = narrowed.replace('2>"${RUNNER_TEMP}/marker.err"', SITE_ALLOWLISTED_TOKEN);
      expect(swapped, "the swap mutation changed nothing beyond the deletion").not.toBe(narrowed);
      const swappedLive = liveLines(scannableRestoreBlock(swapped)).join("\n");
      expect(
        swappedLive.split(SITE_ALLOWLISTED_TOKEN).length - 1,
        "CALIBRATION: the swap did NOT preserve the count, so it is not exercising the direction a count is blind to",
      ).toBe(ALLOWED_SITES.length);
      expect(
        countRuleOffenderCount(swapped, ALLOWED_SITES.length),
        "CALIBRATION: the SUPERSEDED count rule already caught this swap, so the site allowlist is not buying anything and F2 was not a finding",
      ).toBe(0);
      const swapOffenders = softeningOffenders(swapped);
      expect(
        swapOffenders.join(" | "),
        "the count-preserving swap went unreported by the SITE rule too — the new mechanism is no stronger than the one it replaced",
      ).toContain("UNLISTED SITE");
      expect(
        swapOffenders.join(" | "),
        "the swap's VANISHED half went unreported — only half a bijection is being checked",
      ).toContain("VANISHED OR DUPLICATED SITE");
      expect(
        swapOffenders.join(" | "),
        "the report does not name the step whose stderr went quiet — the offending line is a bare continuation (`2>/dev/null)\" || rc=$?`), so without the step name the report is true and useless",
      ).toContain('UNLISTED SITE in step "Which database am I on"');

      // And a second suppression riding in on an allowlisted line's justification.
      const doubled = WF.replace(
        "ls -d /usr/lib/postgresql/*/bin 2>/dev/null",
        "ls -d /usr/lib/postgresql/*/bin 2>/dev/null 2>/dev/null",
      );
      expect(doubled, "the double-suppression mutation changed nothing").not.toBe(WF);
      expect(
        softeningOffenders(doubled).join(" | "),
        "two suppressions on one allowlisted line were accepted — the second is riding in on the first's justification",
      ).toContain("on ONE allowlisted line");
    });
  });

  describe("cross-file: the mutex protocol is ci.yml's, byte for byte", () => {
    it("the acquire suffix is byte-identical to ci.yml's, and our prefix fails loud", () => {
      const ciStep = CI.match(ACQUIRE_RE)?.[0] ?? "";
      const wfStep = WF.match(ACQUIRE_RE)?.[0] ?? "";
      expect(ciStep, "ci.yml's Acquire step could not be extracted").not.toBe("");
      expect(wfStep, `${WF_PATH}'s Acquire step could not be extracted`).not.toBe("");
      const suffix = (s: string): string => s.slice(s.indexOf(SUFFIX_ANCHOR));
      expect(
        suffix(wfStep),
        "the copied mutex protocol has DRIFTED from ci.yml's. Every invariant in that step (session-mode DSN, libpq keepalives, statement_timeout=0, client_connection_check_interval, the 3600s cap, the two-cause error) was reasoned about once and is applied everywhere; a one-site drift means this destructive workflow runs a DIFFERENT protocol than the three CI jobs it shares the lock with. Re-sync the copy — do not edit it here.",
      ).toBe(suffix(ciStep));

      const prefix = wfStep.slice(0, wfStep.indexOf(SUFFIX_ANCHOR));
      expect(
        prefix.includes("exit 0"),
        "the fork-PR early exit SURVIVED in the credential branch. ci.yml's copy may exit 0 there because a fork PR legitimately has no secret; this workflow has no pull_request trigger, so an absent credential is a FAULT — and exiting 0 would hand a DESTRUCTIVE job an unlocked shared database.",
      ).toBe(false);
      expect(
        prefix.includes("exit 1"),
        "the credential branch of the acquire step no longer exits 1",
      ).toBe(true);

      calibrate(
        "the byte-identity pin bites on a one-token drift",
        (s) => s.replace("SELECT pg_advisory_lock(61616158);", "SELECT pg_advisory_lock(61616159);"),
        (t) => {
          const w = t.match(ACQUIRE_RE)?.[0] ?? "";
          return w !== "" && suffix(w) === suffix(ciStep);
        },
      );
      calibrate(
        "the fork-PR exit-0 pin bites",
        (s) =>
          s.replace(
            '            echo "::error::TEST_SUPABASE_DB_URL is empty at the mutex acquire.',
            '            exit 0\n            echo "::error::TEST_SUPABASE_DB_URL is empty at the mutex acquire.',
          ),
        (t) => {
          const w = t.match(ACQUIRE_RE)?.[0] ?? "";
          return !w.slice(0, w.indexOf(SUFFIX_ANCHOR)).includes("exit 0");
        },
      );
    });

    it("the release step is byte-identical to ci.yml's, if: always() included", () => {
      const ciStep = CI.match(RELEASE_RE)?.[0] ?? "";
      const wfStep = WF.match(RELEASE_RE)?.[0] ?? "";
      expect(ciStep).not.toBe("");
      expect(
        wfStep,
        "the release step drifted from ci.yml's. It is the one step here allowed to end zero-status; that licence is ci.yml's reasoning, and it only transfers while the copy is exact.",
      ).toBe(ciStep);
      calibrate(
        "the release byte-identity pin bites",
        (s) => s.replace("      - name: Release shared-test-db mutex (best effort)\n        if: always()\n", "      - name: Release shared-test-db mutex (best effort)\n"),
        (t) => (t.match(RELEASE_RE)?.[0] ?? "") === ciStep,
      );
    });
  });

  describe("the header carries the dispatch recipe an operator actually needs", () => {
    it("both dispatch commands are in the header, and the guard prints the preflight one", () => {
      const header = headerBlock(WF);
      const preflight =
        "gh workflow run test-restore-from-baseline.yml --ref main -f mode=preflight";
      const restore =
        "gh workflow run test-restore-from-baseline.yml --ref main -f mode=restore -f confirm=";
      expect(header, "the header lost the preflight dispatch recipe").toContain(preflight);
      expect(header, "the header lost the restore dispatch recipe").toContain(restore);
      expect(
        jobBlock(WF, GUARD_JOB),
        "the dispatch-guard no longer prints the correct dispatch — that message is the one thing an operator reads at the moment they mis-dispatched",
      ).toContain(preflight);
      expect(
        header,
        "the header no longer says that a workflow_dispatch workflow is only dispatchable from the DEFAULT branch — Plan 04's first checkpoint is 'merge this PR', and without this sentence the first dispatch fails with a confusing 'could not find any workflows named'",
      ).toContain("DEFAULT branch");
      expect(
        header,
        "the header no longer states the publication-row hazard and its founder-run remedy (W3)",
      ).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.");
    });
  });
});

// ---------------------------------------------------------------------------
// W5 — EXECUTED, not grepped.
// ---------------------------------------------------------------------------
describe("164.8-03 W5 — the PROD-ledger premise assert is EXECUTED under stubs", () => {
  const READER = "Read PROD's newest migration apply";
  const ASSERTER = "Assert PROD's ledger equals the repo file set";

  const workdir = mkdtempSync(join(tmpdir(), "w5-"));
  const bindir = join(workdir, "bin");
  mkdirSync(bindir);

  // A `gh` that returns whatever reading the scenario asks for. Every property under
  // test is shell/jq logic; no GitHub API is involved in the decision the steps make.
  writeFileSync(
    join(bindir, "gh"),
    `#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "list" ]; then
  if [ "\${STUB_EMPTY:-0}" = "1" ]; then echo "[]"; exit 0; fi
  printf '[{"status":"%s","conclusion":"%s","headSha":"%s"}]\\n' \\
    "\${STUB_STATUS}" "\${STUB_CONCLUSION}" "\${STUB_SHA}"
  exit 0
fi
echo "stub gh: unexpected invocation: $*" >&2
exit 64
`,
  );
  chmodSync(join(bindir, "gh"), 0o755);

  const readerPath = join(workdir, "reader.sh");
  const asserterPath = join(workdir, "asserter.sh");
  writeFileSync(readerPath, extractRunScript(WF, READER));
  writeFileSync(asserterPath, extractRunScript(WF, ASSERTER));

  // A throwaway repository: A is an ancestor of HEAD; C (on a side branch) is not.
  const repo = mkdtempSync(join(tmpdir(), "w5-repo-"));
  const git = (args: string[]): string => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return (r.stdout ?? "").trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "w5@example.invalid"]);
  git(["config", "user.name", "w5"]);
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "a"]);
  const ANCESTOR_SHA = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "-b", "side"]);
  writeFileSync(join(repo, "c.txt"), "c\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "c"]);
  const SIDE_SHA = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "main"]);
  writeFileSync(join(repo, "b.txt"), "b\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "b"]);

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  let seq = 0;
  function runReader(stub: Record<string, string>): {
    code: number | null;
    out: string;
    outputs: Record<string, string>;
  } {
    seq += 1;
    const outFile = join(workdir, `gh-output-${seq}.txt`);
    writeFileSync(outFile, "");
    const r = spawnSync("bash", [readerPath], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bindir}:${process.env.PATH ?? ""}`,
        GH_TOKEN: "stub-token",
        GITHUB_OUTPUT: outFile,
        ...stub,
      },
    });
    const outputs: Record<string, string> = {};
    for (const line of readFileSync(outFile, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, outputs };
  }

  function runAsserter(outputs: Record<string, string>): { code: number | null; out: string } {
    const r = spawnSync("bash", [asserterPath], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        // The runner always sets this; the step writes git's stderr into it rather
        // than into /dev/null so an UNANSWERED ancestry question can be told apart
        // from a NEGATIVE answer (silent-failure review F4).
        RUNNER_TEMP: workdir,
        APPLY_STATUS: outputs.status ?? "",
        APPLY_CONCLUSION: outputs.conclusion ?? "",
        APPLY_HEAD_SHA: outputs.head_sha ?? "",
      },
    });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("(success, completed, an ANCESTOR sha) → both steps exit 0", () => {
    const reader = runReader({
      STUB_STATUS: "completed",
      STUB_CONCLUSION: "success",
      STUB_SHA: ANCESTOR_SHA,
    });
    expect(reader.code, `reader failed: ${reader.out}`).toBe(0);
    expect(reader.outputs).toEqual({
      status: "completed",
      conclusion: "success",
      head_sha: ANCESTOR_SHA,
    });
    const asserted = runAsserter(reader.outputs);
    expect(asserted.code, `asserter failed on the GREEN reading: ${asserted.out}`).toBe(0);
    expect(asserted.out).toContain("PROD-ledger premise holds");
  });

  it("(FAILURE, completed, an ancestor sha) → exit 1 naming `conclusion`", () => {
    const reader = runReader({
      STUB_STATUS: "completed",
      STUB_CONCLUSION: "failure",
      STUB_SHA: ANCESTOR_SHA,
    });
    expect(reader.code).toBe(0);
    const asserted = runAsserter(reader.outputs);
    expect(
      asserted.code,
      "a FAILED PROD apply did not stop the restore — the ledger seed would write one row per repo file claiming a parity PROD does not have",
    ).toBe(1);
    expect(asserted.out).toContain("conclusion");
    expect(asserted.out).toContain("::error::");
  });

  it("(success, completed, a NON-ancestor sha) → exit 1 naming `ancestor`", () => {
    const reader = runReader({
      STUB_STATUS: "completed",
      STUB_CONCLUSION: "success",
      STUB_SHA: SIDE_SHA,
    });
    expect(reader.code).toBe(0);
    const asserted = runAsserter(reader.outputs);
    expect(
      asserted.code,
      "a green PROD apply at a sha this checkout does NOT descend from was accepted — the premise is about THIS tree, not about any green run",
    ).toBe(1);
    expect(asserted.out).toContain("ancestor");
  });

  // -------------------------------------------------------------------------
  // F4 (Phase 164.8.2 silent-failure review) — rc 1 and rc >= 2 are DIFFERENT
  // answers, and one of them is not an answer at all.
  //
  // ⛔ `git merge-base --is-ancestor` exits 0 (ancestor), 1 (not an ancestor) and
  // 128 (bad object / not a commit). The `case` above this line checks only that
  // APPLY_HEAD_SHA is HEX-SHAPED, never that the object exists — so a sha that was
  // force-pushed away, or one `gh` returned from a different ref, used to produce
  // "X is not an ancestor of this checkout's HEAD": a FALSE STATEMENT ABOUT PROD'S
  // APPLY, with git's own "Not a valid commit name" thrown into /dev/null.
  //
  // Same shape as IN-06 in the restore script (`-le 1`, not `-eq 0`, because "an
  // unreadable dump is not an empty one"). The run was always going to be red;
  // what was wrong is what it told the operator to go and fix.
  // -------------------------------------------------------------------------
  it("(success, completed, a hex sha that is NOT A COMMIT) → MEASURE_FAIL, not a false ancestry verdict", () => {
    // Hex-shaped and 40 long, so the shape `case` admits it; no such object exists
    // in the throwaway repo, so git exits 128.
    const GHOST = `${"0".repeat(39)}1`;
    const asserted = runAsserter({
      status: "completed",
      conclusion: "success",
      head_sha: GHOST,
    });
    expect(
      asserted.code,
      `an unanswerable ancestry question was accepted (exit ${asserted.code}).\n${asserted.out}`,
    ).toBe(1);
    expect(
      asserted.out,
      "the step did not report that the ancestry question went UNANSWERED — it is reporting a verdict it never obtained",
    ).toContain("MEASURE_FAIL");
    expect(
      asserted.out,
      `the step told the operator that ${GHOST} "is not an ancestor of this checkout's HEAD". git never said that: it exited 128 because the object does not exist. A false statement about PROD's apply sends the reader to land migrations that are already landed.`,
    ).not.toContain("is not an ancestor of this checkout's HEAD");
    expect(
      asserted.out,
      "git exited non-zero-non-one and the step did not name the exit code, so the next reader cannot tell a bad object from a broken checkout",
    ).toContain("128");
    expect(
      asserted.out,
      "git's stderr was discarded — that channel is the ONLY thing that distinguishes 'no such object' from every other 128, and the previous version sent it to /dev/null",
    ).toMatch(/not a valid/i);
  });

  it("(status still in progress) → exit 1 naming `status`", () => {
    const asserted = runAsserter({
      status: "in_progress",
      conclusion: "",
      head_sha: ANCESTOR_SHA,
    });
    expect(asserted.code).toBe(1);
    expect(asserted.out).toContain("status");
  });

  it("a reading with ZERO runs is exit 1 at the READER, before any judgement", () => {
    const reader = runReader({ STUB_EMPTY: "1", STUB_STATUS: "", STUB_CONCLUSION: "", STUB_SHA: "" });
    expect(
      reader.code,
      "gh returning no supabase-migrate.yml runs on main was tolerated — that reading means PROD has never applied a migration through that workflow, i.e. there is NO evidence for the parity the seed claims",
    ).toBe(1);
    expect(reader.out).toContain("expected exactly 1");
  });

  it("the premise steps are the ones the workflow actually runs (extraction is not a mock)", () => {
    expect(extractRunScript(WF, ASSERTER)).toContain("git merge-base --is-ancestor");
    expect(extractRunScript(WF, READER)).toContain(
      "gh run list --workflow supabase-migrate.yml --branch main -L 1",
    );
  });
});

// ---------------------------------------------------------------------------
// The post-verify's ErrMissingLocal diagnosis, and the ORDER that makes it
// reachable.
//
// ⛔ WHY THIS EXISTS. Until 2026-09-08 the third assertion in this step was
// `grep -q 'Reverted'`. That capitalised token occurs ZERO times in the pinned
// 2.98.2 binary (measured by installing it and running `strings -a <bin> |
// grep -cF Reverted`) and zero times in 2.84.2. It could never match: it failed
// OPEN and was not evidence about anything. The wording the CLI actually emits
// comes from `internal/migration/up.suggestRevertHistory`.
//
// ⛔ AND WHY ORDER IS THE LOAD-BEARING HALF. ErrMissingLocal exits NON-ZERO, so a
// generic `rc` check placed first consumes it and reports the wrong cause — "the
// CLI could not read the ledger" for what is really a remote row with no local
// file. Swapping the two branches back would leave every string below present
// and every specific diagnosis unreachable, which is why the pin is on the
// ORDER and is proved by EXECUTION, not by substring presence alone.
// ---------------------------------------------------------------------------
describe("post-verify — the ErrMissingLocal diagnosis is reachable", () => {
  const STEP = "Post-verify with the Supabase CLI — ledger SHAPE";
  const SENTENCE = "Remote migration versions not found in local migrations directory.";

  it("the CLI's own ErrMissingLocal sentence is tested BEFORE the generic rc branch", () => {
    const body = extractRunScript(WF, STEP);
    const at = body.indexOf(`grep -aqF '${SENTENCE}'`);
    expect(
      at,
      `the post-verify no longer tests for the CLI's ErrMissingLocal sentence. Do not reinstate a \`Reverted\` grep in its place: that token does not exist in the pinned binary.`,
    ).toBeGreaterThan(-1);
    expect(
      at,
      "the ErrMissingLocal test no longer precedes the generic `rc` branch, so the specific diagnosis is unreachable — a non-zero exit is consumed by the general message first",
    ).toBeLessThan(body.indexOf('if [ "${rc}" -ne 0 ]'));

    // The dead token must not come back — checked on the step's LIVE lines only.
    // Scanning the whole file would match the comment above the step that RECORDS
    // why the grep was removed, which is the note a future reader most needs.
    const live = body
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(
      /grep [^\n]*'Reverted'/.test(live),
      "a `grep 'Reverted'` was reinstated. Measured 2026-09-08: zero occurrences of that capitalised token in the pinned 2.98.2 binary, so the test cannot fail and is not evidence.",
    ).toBe(false);
  });

  it("EXECUTED — a missing-local dry run reports the specific cause, not the generic one", () => {
    const body = extractRunScript(WF, STEP);
    const runWithStub = (stdout: string, rc: number): string => {
      const dir = mkdtempSync(join(tmpdir(), "postverify-"));
      const bin = join(dir, "bin");
      const runnerTemp = join(dir, "tmp");
      for (const d of [bin, runnerTemp]) mkdirSync(d, { recursive: true });
      writeFileSync(join(bin, "supabase"), `#!/bin/bash\ncat <<'EOF'\n${stdout}\nEOF\nexit ${rc}\n`);
      chmodSync(join(bin, "supabase"), 0o755);
      const script = join(dir, "step.sh");
      writeFileSync(script, body);
      const r = spawnSync("bash", [script], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          RUNNER_TEMP: runnerTemp,
          TEST_DB_SESSION_URL: `${SCHEME}EXAMPLE_USER:EXAMPLE_PASSWORD@example.invalid:5432/postgres`,
        },
      });
      rmSync(dir, { recursive: true, force: true });
      return `${r.stdout ?? ""}${r.stderr ?? ""}`;
    };

    const out = runWithStub(`${SENTENCE}\nTry supabase migration repair --status reverted`, 1);
    expect(
      out.includes("remote migration versions with no local file"),
      `a missing-local dry run did not produce the specific diagnosis. If it produced the generic "could not read the ledger" instead, the two branches have been reordered.\n${out}`,
    ).toBe(true);
    expect(
      out.includes("The CLI could not read the ledger"),
      "the generic rc message fired for a missing-local run — it consumed the specific case, which is exactly the ordering defect this pin exists to catch",
    ).toBe(false);

    // CALIBRATION — a genuine connection failure must still reach the generic
    // branch, so the pin above is measuring ORDER and not just string presence.
    const generic = runWithStub("Connection refused", 1);
    expect(generic.includes("The CLI could not read the ledger")).toBe(true);
    expect(generic.includes("remote migration versions with no local file")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // WR-04 remainder (Phase 164.8.2) — the two bare `grep -q` lines in THIS step.
  //
  // ⛔ THE CONTRADICTION. Three lines above them the step states the rule verbatim:
  // "`-a` is mandatory repo-wide: a tracked file carries a deliberate NUL byte and
  // plain grep reports such input clean." The `grep -aqF` on the ErrMissingLocal
  // sentence obeys it; the two below it did not. A rule with a counter-example in its
  // own step is not a rule, and the second of the two is a NEGATIVE check — the shape
  // where NUL-blindness turns "the CLI did not print it" into a red for the wrong
  // reason and hides whatever the ledger actually says.
  // -------------------------------------------------------------------------
  it("both remaining post-verify greps carry -a, so the step's own rule has no counter-example", () => {
    const live = extractRunScript(WF, STEP)
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"));
    const greps = live.filter((l) => /\bgrep\b/.test(l));
    expect(greps.length, "the post-verify step no longer greps at all").toBeGreaterThan(2);
    const bare = greps.filter((l) => /\bgrep -[a-zA-Z]*q/.test(l) && !/\bgrep -[a-zA-Z]*a/.test(l));
    expect(
      bare,
      `${bare.length} post-verify grep(s) still omit \`-a\` while the step's own comment calls it mandatory repo-wide. The NEGATIVE one is the dangerous half: without \`-a\` a single NUL byte makes "the CLI did not print 'Remote database is up to date.'" true for a reason that has nothing to do with the ledger.`,
    ).toEqual([]);
  });

  it("EXECUTED — the positive check READS a dry-run file carrying a NUL byte", () => {
    // ⚠️ WHAT THIS ASSERTS AND WHAT IT DELIBERATELY DOES NOT. It asserts the direction
    // that holds on EVERY grep measured for this repo (ugrep 7.8.4, BSD 2.6.0, and
    // GNU on the runner): with `-a`, a NUL-bearing file is READ and the positive check
    // is satisfied, so the step exits 0. It does NOT assert the pre-fix failure, because
    // that outcome is PLATFORM-DEPENDENT — measured 2026-09-09, ugrep reads such a file
    // as CLEAN (rc=1) while BSD grep reads it fine (rc=0). A calibration stripping the
    // `a` would therefore pass on one developer's machine and fail on another's, which
    // is a flaky test rather than evidence. The pre-fix observation is recorded per
    // flavour in the plan's SUMMARY instead (RESEARCH assumption A1).
    const body = extractRunScript(WF, STEP);
    const CLI_LINE =
      'supabase db push --include-all --dry-run --db-url "${dsn}" >"${raw}" 2>&1 || rc=$?';
    expect(
      body.includes(CLI_LINE),
      "the post-verify's CLI invocation is no longer the line this fixture replaces — re-anchor it rather than dropping the arm",
    ).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "postverify-nul-"));
    const runnerTemp = join(dir, "tmp");
    mkdirSync(runnerTemp, { recursive: true });
    // A NUL byte BEFORE the sentence the positive check looks for — the shape the
    // repo's rule is written about (src/lib/wizardErrors.test.ts carries a deliberate
    // one, which is why the rule exists at all).
    const fixture = join(dir, "dry-run.fixture");
    // ⚠️ The NUL is written as an ESCAPE, never as a raw byte in this source file.
    // A raw NUL here would make THIS file NUL-bearing, and the repo's standing
    // measurement is that grep goes silently blind to such a file — the first draft
    // of this arm did exactly that and `grep -n` reported the line absent.
    const NUL = "\u0000";
    const fixtureBytes =
      `Connecting to remote database...\n${NUL}stray\nRemote database is up to date.\n`;
    expect(
      fixtureBytes.includes(NUL),
      "the fixture carries no NUL byte, so it does not exercise the rule this arm exists for",
    ).toBe(true);
    writeFileSync(fixture, fixtureBytes);
    const patched = body.replace(CLI_LINE, `cat "${fixture}" >"\${raw}" 2>&1 || rc=$?`);
    expect(patched, "the fixture substitution changed nothing").not.toBe(body);
    const scriptFile = join(dir, "step.sh");
    writeFileSync(scriptFile, patched);
    const r = spawnSync("bash", [scriptFile], {
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: runnerTemp,
        TEST_DB_SESSION_URL: `${SCHEME}EXAMPLE_USER:EXAMPLE_PASSWORD@example.invalid:5432/postgres`,
      },
    });
    rmSync(dir, { recursive: true, force: true });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

    expect(
      r.status,
      `a clean dry-run whose bytes include a NUL did not pass the post-verify (exit ${r.status}). With \`-a\` the positive check must READ the file; without it the step reds claiming the CLI never printed the sentence it did print.\n${out}`,
    ).toBe(0);
    expect(
      out.includes("the CLI did not print 'Remote database is up to date.'"),
      "the NEGATIVE check fired on a file that DOES contain the sentence — the grep did not read past the NUL byte",
    ).toBe(false);
    expect(out).toContain("ledger SHAPE is consistent");
  });
});

// ---------------------------------------------------------------------------
// IN-07 (Phase 164.8.2) — three readers of ONE provenance row must agree.
//
// ⛔ THE DEFECT. `BASELINE.md` carries a `| sha256 | `<64 hex>` |` row, and THREE
// places read it: `scripts/check-baseline-staleness.mjs`'s `RECORDED_SHA_RE`, the
// restore script's own `sed`, and this workflow's confirm-token `sed`. The workflow's
// copy was ANCHORED with `^` while the other two were not, under a comment claiming
// it was "the SAME provenance row … spelled for sed". On an INDENTED row the anchored
// copy reads nothing and the workflow refuses with "carries no parseable sha256
// provenance row" — about a file the other two gates read without complaint.
// ---------------------------------------------------------------------------
describe("IN-07 — the confirm token and the staleness gate read the SAME row", () => {
  const SHA = "a".repeat(40) + "b".repeat(24); // 64 hex chars, obviously synthetic
  // Indented, and preceded by a decoy row without `sha256` — the shape that split the
  // three readers. A flush-left fixture would be read identically by all three and
  // would prove nothing.
  const FIXTURE =
    "| field | value |\n" +
    "| --- | --- |\n" +
    "| source | supabase db dump |\n" +
    `  | sha256 | \`${SHA}\` |\n`;

  /** The sed program out of a `sed -nE '<program>' …` line in a file. */
  function sedProgram(text: string, anchor: string): string {
    const line = text.split("\n").find((l) => l.includes(anchor));
    if (!line) return "";
    const m = line.match(/sed -nE '([^']*)'/);
    return m ? m[1] : "";
  }

  const runSed = (program: string, input: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "sha3-"));
    const f = join(dir, "BASELINE.md");
    writeFileSync(f, input);
    const r = spawnSync("sed", ["-nE", program, f], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    if (r.status !== 0) throw new Error(`sed failed: ${r.stderr}`);
    return (r.stdout ?? "").split("\n")[0] ?? "";
  };

  it("all three readers extract the same sha from an INDENTED provenance row", async () => {
    // Imported from the SCRIPT module rather than restated — the convention this repo
    // uses for a constant that must not have a second copy.
    const { RECORDED_SHA_RE } = await import("../../scripts/check-baseline-staleness.mjs");

    const wfProgram = sedProgram(WF, 'sha="$(sed -nE');
    expect(
      wfProgram,
      `${WF_PATH}'s confirm-token step no longer reads the sha with a \`sed -nE '…'\` program — re-anchor this fixture rather than deleting it`,
    ).not.toBe("");
    const scriptProgram = sedProgram(SCRIPT, "recorded=$(sed -nE");
    expect(
      scriptProgram,
      `${SCRIPT_PATH} no longer reads the sha with a \`sed -nE '…'\` program`,
    ).not.toBe("");
    // ⚠️ The local sed is BSD. Both programs are `-nE` with POSIX classes and are
    // portable; asserted rather than assumed, and nothing is skipped silently.
    for (const p of [wfProgram, scriptProgram]) {
      expect(p, "a sed program lost its `p` flag and would print nothing").toContain("/p");
    }
    expect(
      wfProgram.startsWith("s/^"),
      "the workflow's confirm-token sed is ANCHORED again. RECORDED_SHA_RE and the restore script's sed are both unanchored, so an indented provenance row would split the three readers — which is exactly IN-07.",
    ).toBe(false);

    const fromRegex = RECORDED_SHA_RE.exec(FIXTURE)?.[1] ?? "";
    const fromWorkflow = runSed(wfProgram, FIXTURE);
    const fromScript = runSed(scriptProgram, FIXTURE);

    expect(fromRegex, "RECORDED_SHA_RE did not read the fixture — the fixture is wrong, not the gate").toBe(SHA);
    expect(
      fromWorkflow,
      `the workflow's sed read ${JSON.stringify(fromWorkflow)} from an indented row that RECORDED_SHA_RE reads as ${SHA}. The workflow would refuse the dispatch with "carries no parseable sha256 provenance row" about a file the staleness gate accepts.`,
    ).toBe(SHA);
    expect(fromScript, "the restore script's sed disagrees with the other two").toBe(SHA);

    // CALIBRATION — restore the PRE-FIX program (`s/^\|…` in place of `s/.*\|…`) and it
    // must go BLANK on the indented row while the other two still read it. This is the
    // divergence itself, observed rather than described.
    // ⚠️ The mutation replaces the leading `.*` with `^`; replacing only the `s/` with
    // `s/^` does NOT reproduce it — `^.*` still matches the leading spaces, so that
    // mutant is green and the calibration would prove nothing (measured while writing
    // this arm: the first version did exactly that and reported a passing RED).
    expect(
      wfProgram.startsWith("s/.*\\|"),
      "the workflow's sed program no longer begins `s/.*\\|`, so this calibration cannot reconstruct the anchored form — re-anchor the mutation",
    ).toBe(true);
    const reanchored = `s/^\\|${wfProgram.slice("s/.*\\|".length)}`;
    expect(reanchored, "CALIBRATION: re-anchoring changed nothing").not.toBe(wfProgram);
    expect(
      runSed(reanchored, FIXTURE),
      "CALIBRATION: the re-anchored program STILL matched the indented row, so this fixture does not exercise the anchor and the agreement above proves nothing",
    ).toBe("");
    expect(RECORDED_SHA_RE.exec(FIXTURE)?.[1]).toBe(SHA);
    expect(runSed(scriptProgram, FIXTURE)).toBe(SHA);
  });
});

// ---------------------------------------------------------------------------
// The ACTIVITY GATE (Phase 164.8 plan 04 Task 2, moved INTO the workflow).
//
// ⛔ WHY IT IS HERE AND NOT IN A HUMAN'S TERMINAL. Plan 04 specified an EXTERNAL
// probe — a human runs psql, sees zero rows, then dispatches. That is unsound by
// construction and the plan says so itself: probing first "measures a window that
// has already closed". Inside the workflow the probe runs within the advisory-lock
// session already held by `Acquire shared-test-db mutex`, so a colliding run is
// either visible to the query or still blocked on the mutex. There is no window.
//
// ⚠️ `idle in transaction` MUST count as active. A session holding an open
// transaction holds locks and will write when it resumes; a gate blind to it is the
// exact vacuity this phase exists to remove. Plain `idle` must NOT count — pooled
// PostgREST connections park there permanently and would make the gate unpassable.
// Both directions are asserted below, and both were observed on a throwaway
// PostgreSQL 16 lane before this pin was written (idle-in-transaction -> exit 1,
// plain idle -> exit 0).
// ---------------------------------------------------------------------------
describe("the activity gate — measurably quiet, inside the held mutex", () => {
  const GATE = "Activity gate — is shared TEST measurably quiet?";

  it("runs AFTER the mutex is held and the identity is proven, and BEFORE any write", () => {
    const idx = (name: string) => WF.indexOf(`- name: ${name}`);
    const acquire = idx("Acquire shared-test-db mutex");
    const marker = idx("Which database am I on");
    const gate = idx(GATE);
    const backup = idx("Back up TEST before any write (schema + ledger; NOT data)");
    const restore = idx("Run the restore script");

    expect(gate, `the workflow has no step named "${GATE}"`).toBeGreaterThan(-1);
    expect(
      gate,
      "the activity gate no longer runs inside the held mutex — probing before the lock measures a window that has already closed, which is the unsound shape this step exists to replace",
    ).toBeGreaterThan(acquire);
    expect(
      gate,
      "the activity gate no longer runs after the identity marker check — it would be probing a database it has not proven is TEST",
    ).toBeGreaterThan(marker);
    expect(
      gate,
      "the activity gate no longer precedes the backup — a gate after the first write is not a gate",
    ).toBeLessThan(backup);
    expect(gate).toBeLessThan(restore);
  });

  it("the busy predicate is INVERTED, not an enumeration — enumerating is fail-open", () => {
    const body = extractRunScript(WF, GATE);

    // ⛔ THE DEFECT THIS PIN EXISTS FOR, MEASURED. The first version enumerated the
    // busy states: state IN ('active','idle in transaction',
    // 'idle in transaction (aborted)','fastpath function call'). With
    // track_activities=off, PostgreSQL 16 reports EVERY backend's state as `disabled`
    // — on nobody's list — so a lane holding one genuinely idle-in-transaction session
    // returned 0 and the gate printed "measurably quiet" and exited 0. Any unfamiliar
    // future state does the same. The predicate must therefore say what is QUIET and
    // treat everything else as busy, so an unknown state fails CLOSED.
    expect(
      /state\s+IS\s+NULL\s+OR\s+state\s*<>\s*'idle'/.test(body),
      "the activity gate's busy predicate is no longer the inverted form (state IS NULL OR state <> 'idle'). Enumerating busy states is fail-open: a state nobody listed — `disabled` under track_activities=off — reads as quiet while sessions hold locks.",
    ).toBe(true);

    // The enumeration must NOT come back.
    expect(
      /state\s+IN\s*\(/.test(body),
      "the activity gate went back to `state IN (...)`. That shape is fail-open by construction — measured on a PG16 lane, a busy session with state 'disabled' passed the gate.",
    ).toBe(false);

    // ⛔ AND the gate must exclude OUR OWN mutex holder, or it can never pass.
    // `Acquire shared-test-db mutex` leaves a background psql running
    // `SELECT pg_sleep(6000)` — a client backend, different pid, `active` for the whole
    // hold. MEASURED on run 34265750211, the first real dispatch: the gate counted it
    // and refused itself ("1 other client session(s) are not idle"; the 1 was ours).
    // Safe rather than a loophole: PGAPPNAME marks only the holder, and any session
    // carrying it is either ours or another run BLOCKED on the lock we hold.
    // The label is COMPUTED, then excluded via NOT coalesce(...) — which is also
    // NULL-safe, unlike the earlier `application_name <> '...'`: on a NULL
    // application_name that comparison yields NULL and silently drops the row, the
    // same three-valued trap behind the original A1 defect and the `state IN (...)`
    // enumeration. Both halves are pinned so neither can quietly disappear.
    expect(
      body.includes("(application_name = 'ci-shared-test-db-mutex') AS is_mutex_label"),
      "the activity gate no longer computes the mutex-holder label. Without it the gate counts the background psql that HOLDS the advisory lock for this very act, so the count is never 0 and it can never pass — measured on run 34265750211.",
    ).toBe(true);
    expect(
      body.includes("NOT coalesce(is_mutex_label, false)"),
      "the mutex-holder label is computed but no longer excluded from the count, or the exclusion lost its coalesce and is NULL-unsafe again.",
    ).toBe(true);

    // ⛔ AND it must exclude the holder by its REAL BACKEND PID, not only by label.
    // A pooler sits between CI and Postgres; whether it forwards the client's startup
    // `application_name` is its business, not ours. The pid is what the server itself
    // reported (`pg_backend_pid()` inside the holder session), so it survives any
    // rewriting. Runs 34265750211 and 34270157721 both refused with "1", and with no
    // breakdown there was no way to tell our own holder from a foreign session.
    expect(
      body.includes("shared-test-db-mutex-backend-pid"),
      "the activity gate no longer reads the mutex holder's backend pid. application_name alone is not reliable through a pooler, and without the pid the gate can be permanently unpassable while looking like a real refusal.",
    ).toBe(true);
    expect(
      /pid = \$\{holder_pid\}|is_holder_pid/.test(body),
      "the holder pid is read but never used in the predicate",
    ).toBe(true);

    // A refusal MUST say what it saw, or a real refusal is indistinguishable from a
    // bug in the gate — measured twice before this was added.
    expect(
      body.includes("activity-gate breakdown"),
      "the activity gate refuses without printing a breakdown. States and counts only — but without them, triage is guesswork.",
    ).toBe(true);
    // …and the breakdown must stay non-identifying: no query text, user, or host.
    // Scanned over the SQL BLOCK ONLY. A whole-body check is wrong twice over: the
    // comments legitimately discuss "query", and so does the refusal message
    // ("they can carry query text"). Both fired before this was narrowed — a pin
    // that trips on its own documentation gets deleted rather than heeded.
    const sqlStart = body.indexOf("WITH others AS (");
    expect(sqlStart, "the activity gate's probe SQL is no longer recognisable").toBeGreaterThan(-1);
    const liveSql = body.slice(sqlStart, body.indexOf(';"', sqlStart));
    for (const forbidden of ["query", "usename", "client_addr", "backend_start"]) {
      expect(
        liveSql.includes(forbidden),
        `the activity gate breakdown selects \`${forbidden}\` from pg_stat_activity. This log is PUBLIC and TEST is shared with other people's CI — states and counts only.`,
      ).toBe(false);
    }

    // Plain `idle` is the one exclusion, and it must stay excluded: pooled PostgREST
    // connections park there permanently and would make the gate unpassable.
    expect(body).toContain("'idle'");
    expect(stepBody(WF, GATE)).toContain("if: inputs.mode == 'restore'");
  });

  it("EXECUTED — 0 passes, a positive count refuses, and an unreadable probe FAILS CLOSED", () => {
    const body = extractRunScript(WF, GATE);
    const runWithPsql = (stdout: string, rc: number): { out: string; code: number } => {
      const dir = mkdtempSync(join(tmpdir(), "actgate-"));
      const bin = join(dir, "bin");
      const runnerTemp = join(dir, "tmp");
      for (const d of [bin, runnerTemp]) mkdirSync(d, { recursive: true });
      // Stub psql: the gate's decision logic is what is under test here, not libpq.
      // `printf '%b'`, not '%s': with %s bash emits a literal backslash-n, the gate
      // correctly rejects it as non-numeric, and the STUB looks like a gate failure.
      // Measured while writing this test.
      writeFileSync(join(bin, "psql"), `#!/bin/bash\nprintf '%b' ${JSON.stringify(stdout)}\nexit ${rc}\n`);
      chmodSync(join(bin, "psql"), 0o755);
      const script = join(dir, "gate.sh");
      writeFileSync(script, body);
      const r = spawnSync("bash", [script], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          RUNNER_TEMP: runnerTemp,
          // SCHEME (see its definition above) — a contiguous DSN literal trips the
          // pre-push secret scanner on SHAPE, and bypassing that would disarm it for
          // real credentials on every later push.
          TEST_DB_SESSION_URL: `${SCHEME}EXAMPLE_USER:EXAMPLE_PASSWORD@example.invalid:5432/postgres`,
        },
      });
      rmSync(dir, { recursive: true, force: true });
      return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status ?? -1 };
    };

    const quiet = runWithPsql("0\n", 0);
    expect(quiet.code, `a zero count must pass.\n${quiet.out}`).toBe(0);
    expect(quiet.out).toContain("measurably quiet");

    const busy = runWithPsql("1\n", 0);
    expect(busy.code, `a positive count must REFUSE.\n${busy.out}`).toBe(1);
    expect(busy.out).toContain("is NOT quiet");

    // FAIL CLOSED: an unreadable probe is not a passed probe.
    const broken = runWithPsql("", 2);
    expect(
      broken.code,
      "the activity gate tolerated a failed probe. A gate that cannot read must never answer 'safe' — tolerating this would restore shared TEST on an unanswered question.",
    ).toBe(1);
    expect(broken.out).toContain("could not be MEASURED");

    // A non-numeric answer must not be coerced to zero.
    const garbage = runWithPsql("ERROR\n", 0);
    expect(garbage.code, "a non-numeric count was coerced rather than refused").toBe(1);
  });
});
