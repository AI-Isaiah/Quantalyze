/**
 * BASELINE RE-DUMP WIRING PIN — Phase 164.9.5 plan 09.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. `supabase-migrate.yml` carries two jobs that turn a
 * succeeded PROD apply into a bot PR refreshing `supabase/schema/baseline.sql`:
 * `redump-dump` holds the PROD credential and a READ-ONLY token, and `redump-pr` holds a
 * WRITE token and NO PROD credential. Every security property of that split is one line
 * away from being nothing at all — a secret copied into `redump-pr`, `actions: write`
 * added to either job, an `${{ }}` expression pasted into a `run:` body (script
 * injection), `persist-credentials` dropped from a checkout, a `--schema` flag narrowing
 * the dump, an `always()` on the upload so an ungated dump leaves the job, or a gitleaks
 * binary whose version drifts from the one `ci.yml` vets. None of those changes a test
 * that only asserts the file parses, and none of them is read by anyone after this phase.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A MUTATED
 * COPY. `calibrate()` asserts the mutant genuinely differs, asserts the predicate holds
 * on the real file, and asserts it FLIPS on the mutant. A predicate only ever applied to
 * the passing input is not evidence — it can be satisfied by a function that matches
 * anything.
 *
 * ⭐ AN ABSENT JOB IS AN OFFENDER, NEVER A CLEAN SCAN. `jobBlock` returns "" for a job
 * that was renamed or deleted, and every absence check ("no secret in redump-pr") is
 * vacuously true over "". Each absence predicate below first requires a non-empty block.
 *
 * ⚠️ THE HELPERS BELOW ARE COPIED BY SYMBOL, never imported from another test:
 * `jobBlock` (with `NEXT_JOB_RE` / `ANY_JOB_KEY_RE`), `liveLines`, `liveLineCount`,
 * `liveCommandIndex`, `calibrate` and `mutateInJob` from
 * `src/__tests__/supabase-migrate-test-first.test.ts`; `readPermissions`, `indentOf`,
 * `isBlank` and `isComment` from
 * `src/__tests__/contracts/ghcr-login-before-image-pull.contract.test.ts`; the
 * `GITLEAKS_VERSION` pin regex and `gitleaksStepBlock` from
 * `src/__tests__/gitleaks-allowlist.test.ts`. The repo's workflow-wiring tests are
 * deliberately self-contained: a shared helper module couples pins that must be able
 * to fail independently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GITLEAKS_VERSION } from "../../scripts/baseline-redump.mjs";

const ROOT = process.cwd();
const WF_PATH = ".github/workflows/supabase-migrate.yml";
const CI_PATH = ".github/workflows/ci.yml";
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const WF = read(WF_PATH);
const CI = read(CI_PATH);

const DIVERGENCE_JOB = "prod-credential-divergence-verdict";
const DUMP_JOB = "redump-dump";
const PR_JOB = "redump-pr";
const APPLY_JOB = "apply";
const REDUMP_JOBS = [DUMP_JOB, PR_JOB] as const;

// ---------------------------------------------------------------------------
// Copied helpers (see the header). Every predicate takes TEXT, so it can run on a mutant.
// ---------------------------------------------------------------------------

const indentOf = (l: string) => l.length - l.trimStart().length;
const isComment = (l: string) => l.trimStart().startsWith("#");
const isBlank = (l: string) => l.trim() === "";

/** A job's block, header line included, up to the next 2-space job key. */
function jobBlock(text: string, job: string): string {
  const head = `\n  ${job}:\n`;
  const start = text.indexOf(head);
  if (start < 0) return "";
  const after = text.slice(start + head.length);
  // `[^\S\n]*` admits trailing horizontal whitespace and `(#[^\n]*)?` a trailing
  // comment on the successor key, so a valid-YAML successor never lets the slice run on.
  const NEXT_JOB_RE = /\n {2}[A-Za-z_][\w-]*:[^\S\n]*(#[^\n]*)?\n/;
  /** Deliberately weaker: ANY 2-space key. The gap between the two is what throws. */
  const ANY_JOB_KEY_RE = /\n {2}[A-Za-z_][\w-]*:/;
  const next = after.match(NEXT_JOB_RE);
  const loose = after.match(ANY_JOB_KEY_RE);
  if (loose && (!next || (loose.index ?? 0) < (next.index ?? 0))) {
    throw new Error(
      `jobBlock(${job}): a top-level key FOLLOWS it ` +
        `(${JSON.stringify(after.slice(loose.index ?? 0, (loose.index ?? 0) + 60))}) ` +
        "but NEXT_JOB_RE did not match it, so this slice would silently run past it. " +
        "Widen NEXT_JOB_RE.",
    );
  }
  return head + (next ? after.slice(0, next.index) : after);
}

/** Non-comment lines of a block. A commented-out line is not a line that runs. */
function liveLines(block: string): string[] {
  return block.split("\n").filter((l) => !/^\s*#/.test(l));
}

/** How many LIVE lines of the block are exactly this (trimmed) text. */
function liveLineCount(block: string, exact: string): number {
  return liveLines(block).filter((l) => l.trim() === exact).length;
}

/**
 * The line index of a command that must be EXECUTED, not merely mentioned: a flow-scalar
 * `run: <cmd>` or a `<cmd>` line inside a block scalar, by EXACT trimmed equality.
 */
function liveCommandIndex(block: string, cmd: string): number {
  const lines = block.split("\n");
  return lines.findIndex(
    (l) => !/^\s*#/.test(l) && (l.trim() === cmd || l.trim() === `run: ${cmd}`),
  );
}

/**
 * Replace `from` with `to` INSIDE one job's block only. A bare `text.replace(...)`
 * rewrites the FIRST occurrence in the file, and `persist-credentials: false` and
 * `node-version: 22` sit in both redump jobs, so a mutant could land in the wrong one.
 */
function mutateInJob(
  text: string,
  job: string,
  from: string,
  to: string,
): string {
  const block = jobBlock(text, job);
  if (block === "" || !block.includes(from)) return text;
  const mutated = block.replace(from, to);
  return text.replace(block, () => mutated);
}

/** `key: value` pairs of a permissions block starting at `at`, children at `childIndent`. */
function readPermissions(
  lines: string[],
  at: number,
  childIndent: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines.slice(at + 1)) {
    if (isBlank(line) || isComment(line)) continue;
    if (indentOf(line) !== childIndent) break;
    const m = line.trim().match(/^([a-z-]+):\s*(read|write|none)\s*(?:#.*)?$/);
    if (!m) break;
    out[m[1]] = m[2];
  }
  return out;
}

/** The `uses: gitleaks/gitleaks-action@` step of ci.yml, to its dedent. */
function gitleaksStepBlock(ci: string): string | null {
  const lines = ci.split("\n");
  const start = lines.findIndex((l) =>
    /^\s*-\s+uses:\s*gitleaks\/gitleaks-action@/.test(l),
  );
  if (start === -1) return null;
  const stepIndent = /^(\s*)/.exec(lines[start])![1].length;
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (/^(\s*)/.exec(line)![1].length <= stepIndent) break;
    block.push(line);
  }
  return block.join("\n");
}

/** Trailing comments after the value are legal YAML and must not read as "no pin". */
const GITLEAKS_PIN_RE =
  /^\s*GITLEAKS_VERSION:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*(?:#.*)?$/gm;

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
  expect(
    predicate(text),
    `${label}: the predicate is FALSE on the real file`,
  ).toBe(true);
  expect(
    predicate(mutant),
    `CALIBRATION ${label}: the predicate did NOT flip on the mutant — it cannot fail, so it is not evidence`,
  ).toBe(false);
}

// ---------------------------------------------------------------------------
// Predicates written for this file.
// ---------------------------------------------------------------------------

/** Job keys in file order, read ONLY below `jobs:` (`on:` and `permissions:` also have 2-space keys). */
function jobKeys(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (at < 0) return [];
  const keys: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l) && !isComment(l)) break;
    const m = l.match(/^ {2}([A-Za-z_][\w-]*):[^\S\n]*(#.*)?$/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function jobOrderHolds(text: string): boolean {
  const keys = jobKeys(text);
  const at = [DIVERGENCE_JOB, DUMP_JOB, PR_JOB, APPLY_JOB].map((k) =>
    keys.indexOf(k),
  );
  if (at.some((i) => i < 0)) return false;
  for (let i = 1; i < at.length; i++) if (at[i] <= at[i - 1]) return false;
  return keys[keys.length - 1] === APPLY_JOB;
}

/**
 * A job's own 4-space `key:` line, trimmed. "" when absent and "<duplicate>" when there
 * are two, so neither can equal a pinned constant.
 */
function jobKeyLine(text: string, job: string, key: string): string {
  const hits = liveLines(jobBlock(text, job)).filter((l) =>
    new RegExp(`^ {4}${key}:`).test(l),
  );
  if (hits.length > 1) return "<duplicate>";
  return hits[0]?.trim() ?? "";
}

const DUMP_NEEDS = "needs: [apply]";
const DUMP_IF =
  "if: needs.apply.result == 'success' && github.ref == 'refs/heads/main'";
const PR_NEEDS = "needs: [redump-dump]";
const PR_IF =
  "if: needs.redump-dump.result == 'success' && needs.redump-dump.outputs.changed == 'true' && github.ref == 'refs/heads/main'";

function gatesHold(text: string): boolean {
  return (
    jobKeyLine(text, DUMP_JOB, "needs") === DUMP_NEEDS &&
    jobKeyLine(text, DUMP_JOB, "if") === DUMP_IF &&
    jobKeyLine(text, PR_JOB, "needs") === PR_NEEDS &&
    jobKeyLine(text, PR_JOB, "if") === PR_IF
  );
}

/** Live `environment:` lines of a job, at ANY indent (a step cannot carry one, but a typo can). */
function environmentLines(text: string, job: string): string[] {
  return liveLines(jobBlock(text, job)).filter((l) =>
    /^\s*environment:/.test(l),
  );
}

function environmentsHold(text: string): boolean {
  const dump = environmentLines(text, DUMP_JOB);
  return (
    jobBlock(text, DUMP_JOB) !== "" &&
    jobBlock(text, PR_JOB) !== "" &&
    dump.length === 1 &&
    dump[0] === "    environment: Production" &&
    environmentLines(text, PR_JOB).length === 0
  );
}

/** A job's `permissions:` map, or null when the job has none or has two. */
function jobPermissions(
  text: string,
  job: string,
): Record<string, string> | null {
  const lines = jobBlock(text, job).split("\n");
  const heads = lines
    .map((l, i) => (/^ {4}permissions:\s*(#.*)?$/.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (heads.length !== 1) return null;
  return readPermissions(lines, heads[0], 6);
}

const DUMP_PERMISSIONS = { contents: "read", packages: "read" };
const PR_PERMISSIONS = { contents: "write", "pull-requests": "write" };

function sameMap(
  a: Record<string, string> | null,
  b: Record<string, string>,
): boolean {
  if (a === null) return false;
  const norm = (m: Record<string, string>) =>
    JSON.stringify(Object.entries(m).sort(([x], [y]) => x.localeCompare(y)));
  return norm(a) === norm(b);
}

function permissionsHold(text: string): boolean {
  return (
    sameMap(jobPermissions(text, DUMP_JOB), DUMP_PERMISSIONS) &&
    sameMap(jobPermissions(text, PR_JOB), PR_PERMISSIONS)
  );
}

/** Does this line carry an expression that reads the secrets or vars context? */
function readsCredentialContext(line: string): boolean {
  for (const m of line.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (/\b(secrets|vars)\b/.test(m[1])) return true;
  }
  return false;
}

/** The exact shape of a step-level `env:` child carrying one secret or var. */
const STEP_ENV_CREDENTIAL_RE =
  /^ {10}[A-Z][A-Z0-9_]*: \$\{\{ (secrets|vars)\.[A-Z][A-Z0-9_]* \}\}\s*$/;

/**
 * Credential placement offenders, BY NAME.
 *
 * `redump-dump`: every live line reading `secrets`/`vars` must be a child of a
 * STEP-level `env:` (the parent `env:` at 8 spaces, the child at 10). A job-level `env:`
 * would hand the PROD credential to every step, including the third-party actions; a
 * `with:` would hand it to that action; a `run:` body would print it into the script.
 *
 * `redump-pr`: no live line reads `secrets`/`vars` or names `SUPABASE_`, and the job
 * token appears on exactly ONE live line, the push step's `GH_TOKEN`.
 */
function credentialOffenders(text: string): string[] {
  const out: string[] = [];
  const dump = jobBlock(text, DUMP_JOB);
  if (dump === "") {
    out.push(`${DUMP_JOB}: JOB IS MISSING (the scan over it proved nothing)`);
  } else {
    const lines = dump.split("\n");
    let refs = 0;
    lines.forEach((l, i) => {
      if (isComment(l) || !readsCredentialContext(l)) return;
      refs++;
      if (!STEP_ENV_CREDENTIAL_RE.test(l)) {
        out.push(`${DUMP_JOB}: not a step env child: ${l.trim()}`);
        return;
      }
      let p = i - 1;
      while (
        p >= 0 &&
        (isBlank(lines[p]) || isComment(lines[p]) || indentOf(lines[p]) >= 10)
      )
        p--;
      if (p < 0 || lines[p] !== "        env:") {
        out.push(`${DUMP_JOB}: parent of ${l.trim()} is not a step-level env:`);
      }
    });
    if (refs === 0) {
      out.push(`${DUMP_JOB}: reads NO credential at all — the placement scan proved nothing`);
    }
  }
  const pr = jobBlock(text, PR_JOB);
  if (pr === "") {
    out.push(`${PR_JOB}: JOB IS MISSING (the scan over it proved nothing)`);
  } else {
    for (const l of liveLines(pr)) {
      if (readsCredentialContext(l)) out.push(`${PR_JOB}: reads a credential: ${l.trim()}`);
      if (l.includes("SUPABASE_")) out.push(`${PR_JOB}: names SUPABASE_: ${l.trim()}`);
    }
    const token = liveLines(pr).filter((l) => l.includes("github.token"));
    if (token.length !== 1 || token[0] !== "          GH_TOKEN: ${{ github.token }}") {
      out.push(
        `${PR_JOB}: the job token must appear on exactly one live line, the push step's GH_TOKEN; found ${JSON.stringify(token.map((l) => l.trim()))}`,
      );
    }
  }
  return out;
}

/**
 * Every `run:` body of a block: a block scalar's more-indented lines, or a flow scalar's
 * value. ⚠️ `#` lines INSIDE a block scalar are KEPT: they are shell comments, part of
 * the script string, and GitHub substitutes `${{ }}` in them exactly as in any other
 * line. Only YAML comments OUTSIDE a body are excluded, and those by structure.
 */
function runBodies(block: string): string[][] {
  const lines = block.split("\n");
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isComment(l)) continue;
    const m = l.match(/^(\s*)(- )?run:(.*)$/);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const rest = m[3].trim();
    if (/^[|>][+-]?[0-9]?\s*(#.*)?$/.test(rest)) {
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (!isBlank(lines[j]) && indentOf(lines[j]) <= keyIndent) break;
        body.push(lines[j]);
      }
      out.push(body);
      i = j - 1;
    } else {
      out.push([rest]);
    }
  }
  return out;
}

function runBodyOffenders(text: string): string[] {
  const out: string[] = [];
  for (const job of REDUMP_JOBS) {
    const block = jobBlock(text, job);
    if (block === "") {
      out.push(`${job}: JOB IS MISSING (an absent job scans clean, which is how a corpus quietly becomes empty)`);
      continue;
    }
    const bodies = runBodies(block);
    if (bodies.length === 0) out.push(`${job}: no run: body found — the scan proved nothing`);
    for (const body of bodies) {
      for (const l of body) {
        if (l.includes("${{")) out.push(`${job}: ${l.trim()}`);
      }
    }
  }
  return out;
}

/** A job's steps, each as its lines, split at the 6-space `- ` step items. */
function stepsOf(block: string): string[][] {
  const lines = block.split("\n");
  const at = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (at < 0) return [];
  const steps: string[][] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^ {6}- /.test(l)) steps.push([l]);
    else if (steps.length > 0) steps[steps.length - 1].push(l);
  }
  return steps;
}

/** The ONE step whose live lines match `re`; null when none or several do. */
function stepMatching(block: string, re: RegExp): string | null {
  const hits = stepsOf(block).filter((s) => liveLines(s.join("\n")).some((l) => re.test(l)));
  return hits.length === 1 ? hits[0].join("\n") : null;
}

const SETUP_CLI_VERSION = "2.98.2";

function setupCliPinned(text: string): boolean {
  const step = stepMatching(jobBlock(text, DUMP_JOB), /uses:\s*supabase\/setup-cli@/);
  return step !== null && liveLineCount(step, `version: ${SETUP_CLI_VERSION}`) === 1;
}

/** The single live `GITLEAKS_VERSION:` value in `redump-dump`, or null. */
function dumpGitleaksPin(text: string): string | null {
  const live = liveLines(jobBlock(text, DUMP_JOB)).join("\n");
  const pins = [...live.matchAll(GITLEAKS_PIN_RE)].map((m) => m[1]);
  return pins.length === 1 ? pins[0] : null;
}

/** ci.yml's secret-scan pin, or null. */
function ciGitleaksPin(ci: string): string | null {
  const block = gitleaksStepBlock(ci);
  if (block === null) return null;
  const pins = [...block.matchAll(GITLEAKS_PIN_RE)].map((m) => m[1]);
  return pins.length === 1 ? pins[0] : null;
}

function gitleaksVersionsAgree(wf: string, ci: string): boolean {
  const a = dumpGitleaksPin(wf);
  return a !== null && a === ciGitleaksPin(ci) && a === GITLEAKS_VERSION;
}

/**
 * The install step verifies the tarball against ONE hard-coded 64-hex sha256 with
 * `sha256sum -c` BEFORE extracting, and never fetches the release's checksums file.
 */
function gitleaksVerifiedBeforeExtract(text: string): boolean {
  const step = stepMatching(jobBlock(text, DUMP_JOB), /GITLEAKS_SHA256:/);
  if (step === null) return false;
  const live = liveLines(step);
  const shas = live.filter((l) => /^\s*GITLEAKS_SHA256:\s*[0-9a-f]{64}\s*$/.test(l));
  const check = live.findIndex(
    (l) => l.includes("sha256sum -c") && l.includes("${GITLEAKS_SHA256}"),
  );
  const extract = live.findIndex((l) => /\btar\s+-x/.test(l));
  return (
    shas.length === 1 &&
    check >= 0 &&
    extract > check &&
    !live.some((l) => /checksums/i.test(l))
  );
}

const SELF_TEST_PLAIN = "node scripts/baseline-redump.mjs --self-test";
const SELF_TEST_GITLEAKS = `${SELF_TEST_PLAIN} --with-gitleaks`;

/**
 * `redump-dump` runs the gitleaks form; `redump-pr` runs the plain form and names
 * gitleaks on NO live line (its comments legitimately say it runs no scanner binary).
 */
function selfTestFormsHold(text: string): boolean {
  const dump = jobBlock(text, DUMP_JOB);
  const pr = jobBlock(text, PR_JOB);
  return (
    dump !== "" &&
    pr !== "" &&
    liveCommandIndex(dump, SELF_TEST_GITLEAKS) >= 0 &&
    liveCommandIndex(pr, SELF_TEST_PLAIN) >= 0 &&
    !liveLines(pr).some((l) => /gitleaks/i.test(l))
  );
}

/** The dump goes to $RUNNER_TEMP (never the tracked path) and is never narrowed by `--schema`. */
const DUMP_LINE = 'supabase db dump --linked -f "${RUNNER_TEMP}/redump/baseline.sql"';

function dumpLineHolds(text: string): boolean {
  const dump = jobBlock(text, DUMP_JOB);
  const dumps = liveLines(dump).filter((l) => l.trim().startsWith("supabase db dump"));
  return (
    dump !== "" &&
    dumps.length === 1 &&
    dumps[0].trim() === DUMP_LINE &&
    !liveLines(dump).some((l) => l.includes("--schema"))
  );
}

const UPLOAD_IF = "if: steps.gate.outputs.changed == 'true'";

/**
 * The upload is reachable only after every gate passed: gated on the `gate` step's
 * `changed` output, kept one day, and no `always()` anywhere in the job.
 */
function uploadHolds(text: string): boolean {
  const dump = jobBlock(text, DUMP_JOB);
  const step = stepMatching(dump, /uses:\s*actions\/upload-artifact@/);
  return (
    dump !== "" &&
    step !== null &&
    liveLineCount(dump, "id: gate") === 1 &&
    liveLineCount(step, UPLOAD_IF) === 1 &&
    liveLineCount(step, "retention-days: 1") === 1 &&
    !liveLines(dump).some((l) => l.includes("always()"))
  );
}

/** Every checkout in both jobs carries `persist-credentials: false`. */
function checkoutsHold(text: string): boolean {
  return REDUMP_JOBS.every((job) => {
    const checkouts = stepsOf(jobBlock(text, job)).filter((s) =>
      liveLines(s.join("\n")).some((l) => /uses:\s*actions\/checkout@/.test(l)),
    );
    return (
      checkouts.length >= 1 &&
      checkouts.every((s) => liveLineCount(s.join("\n"), "persist-credentials: false") === 1)
    );
  });
}

// ---------------------------------------------------------------------------
// Task 1 — the job shape.
// ---------------------------------------------------------------------------
describe("164.9.5-09 — the two redump jobs keep their credential split and their gates", () => {
  it("job order: divergence verdict < redump-dump < redump-pr < apply, and apply is last", () => {
    expect(
      jobOrderHolds(WF),
      `job order in ${WF_PATH} is ${JSON.stringify(jobKeys(WF))}. Both redump jobs must sit ` +
        `between ${DIVERGENCE_JOB} and ${APPLY_JOB}, and ${APPLY_JOB} must stay the LAST job (WR-05). ` +
        "Move the job back; do not reorder this test.",
    ).toBe(true);
    calibrate(
      "moving redump-pr after apply",
      (s) => {
        const b = jobBlock(s, PR_JOB);
        return s.replace(b, "") + b.slice(1) + "\n";
      },
      jobOrderHolds,
    );
  });

  it("needs: and if: are line-exact on both jobs (D-01, D-02, D-21)", () => {
    expect(jobKeyLine(WF, DUMP_JOB, "needs")).toBe(DUMP_NEEDS);
    expect(
      jobKeyLine(WF, DUMP_JOB, "if"),
      `${DUMP_JOB} must run only after a SUCCEEDED apply, on main. A softer if: re-dumps PROD after a failed apply or from another ref.`,
    ).toBe(DUMP_IF);
    expect(jobKeyLine(WF, PR_JOB, "needs")).toBe(PR_NEEDS);
    expect(
      jobKeyLine(WF, PR_JOB, "if"),
      `${PR_JOB} must run only on a succeeded dump that CHANGED, on main. Dropping a clause opens a PR on every apply or from another ref.`,
    ).toBe(PR_IF);
    calibrate(
      "redump-dump if: without its ref clause",
      (s) => mutateInJob(s, DUMP_JOB, " && github.ref == 'refs/heads/main'", ""),
      gatesHold,
    );
    calibrate(
      "redump-pr if: without its ref clause",
      (s) => mutateInJob(s, PR_JOB, " && github.ref == 'refs/heads/main'", ""),
      gatesHold,
    );
    calibrate(
      "redump-pr if: without its changed clause",
      (s) => mutateInJob(s, PR_JOB, " && needs.redump-dump.outputs.changed == 'true'", ""),
      gatesHold,
    );
    calibrate(
      "redump-dump needs: plan instead of apply",
      (s) => mutateInJob(s, DUMP_JOB, "    needs: [apply]\n", "    needs: [plan]\n"),
      gatesHold,
    );
  });

  it("redump-dump runs in environment Production and redump-pr in none (D-03, D-21)", () => {
    expect(environmentLines(WF, DUMP_JOB)).toEqual(["    environment: Production"]);
    expect(jobBlock(WF, PR_JOB), `${PR_JOB} is missing from ${WF_PATH}`).not.toBe("");
    expect(
      environmentLines(WF, PR_JOB),
      `${PR_JOB} holds the WRITE token; it must not also be granted the Production environment's secrets.`,
    ).toEqual([]);
    calibrate(
      "redump-dump without its environment",
      (s) => mutateInJob(s, DUMP_JOB, "    environment: Production\n", ""),
      environmentsHold,
    );
    calibrate(
      "redump-pr given the Production environment",
      (s) => mutateInJob(s, PR_JOB, "    timeout-minutes: 15\n", "    timeout-minutes: 15\n    environment: Production\n"),
      environmentsHold,
    );
  });

  it("permissions are exactly {contents: read, packages: read} and {contents: write, pull-requests: write} (D-05)", () => {
    expect(
      jobPermissions(WF, DUMP_JOB),
      `${DUMP_JOB} holds the PROD credential, so its token must stay read-only.`,
    ).toEqual(DUMP_PERMISSIONS);
    expect(
      jobPermissions(WF, PR_JOB),
      `${PR_JOB} gets exactly what pushing the bot branch and opening its PR needs. No actions: write (D-12).`,
    ).toEqual(PR_PERMISSIONS);
    calibrate(
      "actions: write added to redump-dump",
      (s) => mutateInJob(s, DUMP_JOB, "      packages: read\n", "      packages: read\n      actions: write\n"),
      permissionsHold,
    );
    calibrate(
      "actions: write added to redump-pr",
      (s) => mutateInJob(s, PR_JOB, "      pull-requests: write\n", "      pull-requests: write\n      actions: write\n"),
      permissionsHold,
    );
  });

  it("credentials: step-level env: only in redump-dump; none in redump-pr but its one GH_TOKEN (D-03, D-05)", () => {
    expect(
      credentialOffenders(WF),
      "A PROD credential outside a step-level env:, or any credential in the write-token job, " +
        "breaks the D-21 split. Put it back in the step's env: and reference it as $NAME in the run body.",
    ).toEqual([]);
    const ok = (s: string) => credentialOffenders(s).length === 0;
    calibrate(
      "a PROD secret seeded into redump-pr",
      (s) =>
        mutateInJob(
          s,
          PR_JOB,
          "          GH_TOKEN: ${{ github.token }}\n",
          "          GH_TOKEN: ${{ github.token }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n",
        ),
      ok,
    );
    calibrate(
      "a PROD secret hoisted to a job-level env: in redump-dump",
      (s) =>
        mutateInJob(
          s,
          DUMP_JOB,
          "    timeout-minutes: 20\n",
          "    timeout-minutes: 20\n    env:\n      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n",
        ),
      ok,
    );
    calibrate(
      "the project ref read inline in a redump-dump run body",
      (s) =>
        mutateInJob(
          s,
          DUMP_JOB,
          'supabase link --project-ref "$SUPABASE_PROJECT_REF"',
          'supabase link --project-ref "${{ vars.SUPABASE_PROJECT_REF }}"',
        ),
      ok,
    );
    calibrate(
      "the job token exposed to the compose step too",
      (s) =>
        mutateInJob(
          s,
          PR_JOB,
          "        id: compose\n",
          "        id: compose\n        env:\n          GH_TOKEN: ${{ github.token }}\n",
        ),
      ok,
    );
  });

  it("no run: body in either job contains an ${{ }} expression (D-03, D-18)", () => {
    expect(
      runBodyOffenders(WF),
      "An expression inside a run: body is substituted into the script BEFORE the shell sees it, " +
        "which is script injection. Move the value into the step's env: and read it as $NAME.",
    ).toEqual([]);
    const ok = (s: string) => runBodyOffenders(s).length === 0;
    calibrate(
      "an expression seeded into the gate step's body",
      (s) => mutateInJob(s, DUMP_JOB, '--merge "${GITHUB_SHA}"', '--merge "${{ github.sha }}"'),
      ok,
    );
    calibrate(
      "an expression seeded into redump-pr's flow-scalar compose line",
      (s) => mutateInJob(s, PR_JOB, '--in "${RUNNER_TEMP}/redump-in"', '--in "${{ runner.temp }}/redump-in"'),
      ok,
    );
    calibrate(
      "an expression seeded into a SHELL comment inside the gate body (still substituted)",
      (s) =>
        mutateInJob(
          s,
          DUMP_JOB,
          '          CLI_VERSION="$(supabase --version)"\n',
          '          # merge ${{ github.sha }}\n          CLI_VERSION="$(supabase --version)"\n',
        ),
      ok,
    );
    calibrate(
      "redump-pr deleted (an absent job is an offender, not a clean scan)",
      (s) => s.replace(jobBlock(s, PR_JOB), "\n"),
      ok,
    );
  });

  it(`setup-cli is pinned to ${SETUP_CLI_VERSION} in redump-dump (D-04)`, () => {
    expect(
      setupCliPinned(WF),
      `${DUMP_JOB}'s supabase/setup-cli step must pin version: ${SETUP_CLI_VERSION}, the CLI apply ran with.`,
    ).toBe(true);
    calibrate(
      "setup-cli bumped to 2.98.3",
      (s) => mutateInJob(s, DUMP_JOB, `version: ${SETUP_CLI_VERSION}`, "version: 2.98.3"),
      setupCliPinned,
    );
  });

  it("gitleaks: one version across the workflow, ci.yml and the script; sha256-checked before extraction (D-26)", () => {
    expect(dumpGitleaksPin(WF), `${DUMP_JOB} has no single GITLEAKS_VERSION pin`).not.toBeNull();
    expect(
      gitleaksVersionsAgree(WF, CI),
      `GITLEAKS_VERSION: workflow ${dumpGitleaksPin(WF)}, ci.yml ${ciGitleaksPin(CI)}, script ${GITLEAKS_VERSION}. ` +
        "All three must move together, with a new sha256 from the release you vetted.",
    ).toBe(true);
    expect(
      gitleaksVerifiedBeforeExtract(WF),
      "The gitleaks tarball must be checked against ONE hard-coded 64-hex GITLEAKS_SHA256 with sha256sum -c " +
        "before tar extracts it, and the release's checksums file must never be fetched.",
    ).toBe(true);
    calibrate(
      "the workflow's gitleaks version drifts from ci.yml's",
      (s) => mutateInJob(s, DUMP_JOB, `GITLEAKS_VERSION: ${GITLEAKS_VERSION}`, "GITLEAKS_VERSION: 8.30.2"),
      (s) => gitleaksVersionsAgree(s, CI),
    );
    calibrate(
      "ci.yml's gitleaks version drifts from the workflow's",
      (s) => s.replace(`GITLEAKS_VERSION: ${GITLEAKS_VERSION}`, "GITLEAKS_VERSION: 8.30.2"),
      (s) => gitleaksVersionsAgree(WF, s),
      CI,
    );
    calibrate(
      "the sha256sum -c check removed",
      (s) => mutateInJob(s, DUMP_JOB, ' | sha256sum -c -', ""),
      gitleaksVerifiedBeforeExtract,
    );
    calibrate(
      "the pinned sha256 shortened by one hex digit",
      (s) => s.replace(/(GITLEAKS_SHA256: [0-9a-f]{63})[0-9a-f]/, "$1"),
      gitleaksVerifiedBeforeExtract,
    );
  });

  it("redump-dump runs the gitleaks self-test; redump-pr the plain one, with no gitleaks on a live line", () => {
    expect(
      selfTestFormsHold(WF),
      `${DUMP_JOB} must run \`${SELF_TEST_GITLEAKS}\` and ${PR_JOB} \`${SELF_TEST_PLAIN}\`. ` +
        `${PR_JOB} installs no scanner binary, so gitleaks on any of its live lines is a regression.`,
    ).toBe(true);
    calibrate(
      "redump-dump self-test without --with-gitleaks",
      (s) => mutateInJob(s, DUMP_JOB, `run: ${SELF_TEST_GITLEAKS}`, `run: ${SELF_TEST_PLAIN}`),
      selfTestFormsHold,
    );
    calibrate(
      "redump-pr self-test with --with-gitleaks",
      (s) => mutateInJob(s, PR_JOB, `run: ${SELF_TEST_PLAIN}\n`, `run: ${SELF_TEST_GITLEAKS}\n`),
      selfTestFormsHold,
    );
  });

  it("the dump is `supabase db dump --linked -f` into $RUNNER_TEMP, with no --schema (D-04)", () => {
    expect(
      dumpLineHolds(WF),
      `${DUMP_JOB} must carry exactly one live \`${DUMP_LINE}\`. A --schema flag narrows the baseline; ` +
        "the tracked path would leave a half-written tracked file on a failed dump (RESEARCH F3).",
    ).toBe(true);
    calibrate(
      "the dump narrowed by --schema",
      (s) => mutateInJob(s, DUMP_JOB, DUMP_LINE, `${DUMP_LINE} --schema public`),
      dumpLineHolds,
    );
    calibrate(
      "the dump written to the tracked path",
      (s) => mutateInJob(s, DUMP_JOB, DUMP_LINE, "supabase db dump --linked -f supabase/schema/baseline.sql"),
      dumpLineHolds,
    );
  });

  it("the upload is gated on the gate step's changed output, kept 1 day, with no always() (D-21)", () => {
    expect(
      uploadHolds(WF),
      `${DUMP_JOB}'s upload must carry \`${UPLOAD_IF}\` and \`retention-days: 1\`, and the job no always(): ` +
        "the default success() is what keeps an ungated dump from ever leaving the job.",
    ).toBe(true);
    calibrate(
      "always() added to the upload's if:",
      (s) => mutateInJob(s, DUMP_JOB, UPLOAD_IF, "if: always() && steps.gate.outputs.changed == 'true'"),
      uploadHolds,
    );
    calibrate(
      "the upload's if: removed",
      (s) => mutateInJob(s, DUMP_JOB, `        ${UPLOAD_IF}\n`, ""),
      uploadHolds,
    );
    calibrate(
      "the artifact kept 7 days",
      (s) => mutateInJob(s, DUMP_JOB, "retention-days: 1", "retention-days: 7"),
      uploadHolds,
    );
  });

  it("every checkout in both jobs sets persist-credentials: false (D-05, D-22)", () => {
    expect(
      checkoutsHold(WF),
      "A checkout without persist-credentials: false writes the job token into .git/config, where every later step can read it.",
    ).toBe(true);
    calibrate(
      "persist-credentials removed from redump-dump's checkout",
      (s) => mutateInJob(s, DUMP_JOB, "          persist-credentials: false\n", ""),
      checkoutsHold,
    );
    calibrate(
      "persist-credentials removed from redump-pr's checkout",
      (s) => mutateInJob(s, PR_JOB, "          persist-credentials: false\n", ""),
      checkoutsHold,
    );
  });
});
