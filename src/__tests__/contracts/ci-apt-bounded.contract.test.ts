import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 164.9.8 APTHANG - the guard that keeps a CI apt step from hanging.
 *
 * THE DEFECT (2026-10-07). Several CI jobs sat on `apt-get update` / `install`
 * until their job-level timeout, because a package mirror trickled instead of
 * dying. The runner image already sets Acquire::Retries and 15 s http/https
 * timeouts, and every failing log shows the azure fail-over working; apt's own
 * inactivity timers simply never fire on a trickle. The fix is therefore NOT
 * "add -o flags to every apt line" (the D-02 correction). It is one wrapper,
 * `scripts/ci-apt.sh`, that keeps the explicit Acquire options AND bounds each
 * network phase by wall clock inside one retry budget, and that skips apt when
 * the tool is already on PATH.
 *
 * WHAT THIS FILE ENFORCES, so the next workflow someone adds with a raw apt
 * line cannot reopen that failure unnoticed:
 *   R1  no workflow step calls apt / apt-get update|install|... at COMMAND
 *       position (sudo, sudo -E, env VAR=x, sudo env, bare VAR=x prefixes
 *       included). An `echo "... apt install ..."` is not a call.
 *   R2  every step that calls the wrapper has a step `timeout-minutes` of at
 *       most 10, so a hang ends the step with a NAMED failure (D-03).
 *   R3  a Playwright `install --with-deps` / `install-deps` step (apt happens
 *       inside Playwright, out of the wrapper's reach) has the same limit.
 *   R4  the wrapper keeps its three Acquire keys, never gains an option that
 *       weakens signature verification, and its own --self-test exits 0.
 *   R5  the `Provision pg_cron` step carries the SAME timeout-minutes in
 *       ci.yml `sql-mutation` and the nightly's `sql-mutation-full`.
 *       sql-mutation-nightly-parity pins that step's run: block byte-equal but
 *       NOT its timeout-minutes (measured: a one-sided change leaves it green),
 *       so this rule closes that gap (D-05).
 *   R6  the budget arithmetic holds: for every non-exempt wrapper call,
 *       budget + 60 s must fit inside the step's timeout-minutes x 60. The
 *       measured caps and the budget only protect a step whose limit can hold
 *       them; a step limit shorter than the budget turns a named MEASURE_FAIL
 *       back into an anonymous kill (or, worse, into the hang).
 *   Census  the number of apt-reaching steps and of wrapper callers is a PIN.
 *       A step that silently vanishes (a call line commented out) leaves R1-R6
 *       green, because there is nothing left to violate; the census is what
 *       says so. Move the numbers deliberately, in the same commit as the
 *       workflow change, and read the step list in the failure message first.
 *
 * WHY THE MUTEX STEPS ARE EXEMPT FROM R2 AND R6 (recorded D-03 deviation,
 * CONTEXT.md and the ROADMAP 164.9.8 block). The two `Acquire shared-test-db
 * mutex` steps reach apt only through a dead branch (`if ! command -v psql`),
 * but the step itself waits for the shared-TEST advisory lock BY DESIGN,
 * measured at up to about 33 minutes. A short step limit would kill a
 * legitimate lock wait. Their apt is bounded by the wrapper's own default
 * budget instead. That exemption is the ONLY one, and it is by exact step name.
 *
 * KNOWN LIMIT, stated so nobody mistakes it for a hole in the rules: R1 reads
 * workflow `run:` text. It does not read other scripts, and a `timeout N apt-get`
 * form is deliberately NOT special-cased: the wrapper is the one sanctioned
 * entry point, so bypassing it is a violation even when it happens to be bounded.
 *
 * HOW THIS TEST IS KEPT HONEST. Every rule is a pure function over workflow /
 * wrapper TEXT, and the CALIBRATION block applies an in-memory mutant to the REAL
 * text (never written to disk) and requires the rule to flip. Each mutant helper
 * throws when its pattern does not match, so a mutant can never be vacuous
 * because the file drifted. The on-disk neuter-and-restore proof lives in the
 * 164.9.8-04 SUMMARY.
 *
 * Do not add the literal CI-suppression trailer tokens to this file or to any
 * commit that carries it: GitHub honours them anywhere in a message.
 */

const ROOT = process.cwd();
const WORKFLOW_DIR = join(ROOT, ".github/workflows");
const WRAPPER_PATH = join(ROOT, "scripts/ci-apt.sh");

const EXEMPT_STEP = "Acquire shared-test-db mutex";
const MAX_STEP_MINUTES = 10;
/** Slack R6 requires on top of the budget: kill-after + one retry sleep + the local unpack. */
const R6_SLACK_SECONDS = 60;
/** The census pins. A deliberate change to the step set moves these knowingly. */
const EXPECTED_APT_REACHING_STEPS = 18;
const EXPECTED_WRAPPER_CALLERS = 14;

type Workflows = Record<string, string>;

interface Step {
  file: string;
  job: string;
  name: string;
  /** zero-based line range [start, end) of the step inside its file */
  start: number;
  end: number;
  /** the step's text minus comment-only lines, backslash continuations joined */
  live: string;
  /** null when absent or not a plain integer */
  timeout: number | null;
}

// ---------------------------------------------------------------------------
// Parsing: pure functions over text.
// ---------------------------------------------------------------------------

function loadWorkflows(): Workflows {
  const out: Workflows = {};
  for (const f of readdirSync(WORKFLOW_DIR).sort()) {
    if (/\.ya?ml$/.test(f)) out[f] = readFileSync(join(WORKFLOW_DIR, f), "utf8");
  }
  return out;
}

function liveText(lines: string[]): string {
  return lines
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n")
    .replace(/\\\n[ \t]*/g, " ");
}

function parseSteps(file: string, text: string): Step[] {
  const lines = text.split("\n");
  const steps: Step[] = [];
  let inJobs = false;
  let job = "";
  let open: { start: number; job: string } | null = null;

  const close = (end: number) => {
    if (!open) return;
    const slice = lines.slice(open.start, end);
    let name = "";
    let timeout: number | null = null;
    for (const l of slice) {
      const nm = /^ {6}- name:\s*(.*)$|^ {8}name:\s*(.*)$/.exec(l);
      if (nm && !name) name = (nm[1] ?? nm[2] ?? "").trim().replace(/^["']|["']$/g, "");
      const tm = /^ {6}- timeout-minutes:\s*(\d+)\s*(?:#.*)?$|^ {8}timeout-minutes:\s*(\d+)\s*(?:#.*)?$/.exec(l);
      if (tm) timeout = Number(tm[1] ?? tm[2]);
    }
    steps.push({
      file,
      job: open.job,
      name,
      start: open.start,
      end,
      live: liveText(slice),
      timeout,
    });
    open = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^jobs:\s*$/.test(l)) {
      inJobs = true;
      continue;
    }
    if (/^\S/.test(l) && !l.startsWith("#")) {
      close(i);
      inJobs = false;
      job = "";
      continue;
    }
    if (!inJobs) continue;
    const jm = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (jm) {
      close(i);
      job = jm[1];
      continue;
    }
    if (/^ {6}- /.test(l)) {
      close(i);
      open = { start: i, job };
      continue;
    }
    // A non-blank, non-comment line shallower than a step ends the step.
    if (open && l.trim() !== "" && !l.trim().startsWith("#") && l.length - l.trimStart().length < 6) {
      close(i);
    }
  }
  close(lines.length);
  return steps;
}

function parseAll(wf: Workflows): Step[] {
  return Object.entries(wf).flatMap(([file, text]) => parseSteps(file, text));
}

const label = (s: Step) => `${s.file} :: job ${s.job || "?"} :: step "${s.name || "(unnamed)"}"`;

// ---------------------------------------------------------------------------
// R1: apt at command position.
// ---------------------------------------------------------------------------

// Where a command may start: line start, after && || ; |, after then/else/do, or after ( { !.
const CMD_POS = String.raw`(?:^|&&|\|\||;|\||\bthen\b|\belse\b|\bdo\b|[({!])`;
// What may sit between the command position and `apt`: sudo / env / nohup, their flags
// (including `-u user`), and VAR=value assignments.
const PREFIX = String.raw`(?:(?:sudo|env|nohup|exec|command)[ \t]+|(?:-u|--user|-g|--group)[ \t]+\S+[ \t]+|-{1,2}[A-Za-z][\w-]*(?:=\S+)?[ \t]+|[A-Za-z_]\w*=\S*[ \t]+)*`;
// apt's own options between `apt-get` and the subcommand (`-o Key=Val` takes an argument).
const APT_OPT = String.raw`(?:(?:-o|--option|-c|--config-file|-t|--target-release)[ \t]+\S+|-\S+)[ \t]+`;
const APT_VERBS = "update|install|upgrade|dist-upgrade|full-upgrade|download|source|build-dep";
const RAW_APT = new RegExp(
  `${CMD_POS}[ \\t]*${PREFIX}apt(?:-get)?[ \\t]+(?:${APT_OPT})*(?:${APT_VERBS})\\b`,
  "m",
);

function r1(wf: Workflows): string[] {
  return parseAll(wf)
    .filter((s) => RAW_APT.test(s.live))
    .map((s) => `R1: ${label(s)} calls apt directly; route it through scripts/ci-apt.sh`);
}

// ---------------------------------------------------------------------------
// Step classification.
// ---------------------------------------------------------------------------

const callsWrapper = (s: Step) => s.live.includes("scripts/ci-apt.sh");
const DEPS_INSTALL =
  /playwright[ \t]+install(?:[ \t]+\S+)*?[ \t]+--with-deps\b|playwright[ \t]+install-deps\b/;
const runsPlaywrightDeps = (s: Step) => DEPS_INSTALL.test(s.live);

function limitProblem(s: Step): string | null {
  if (s.timeout === null) return "has no step timeout-minutes";
  if (s.timeout > MAX_STEP_MINUTES) return `has timeout-minutes ${s.timeout}, above ${MAX_STEP_MINUTES}`;
  return null;
}

function r2(wf: Workflows): string[] {
  return parseAll(wf)
    .filter((s) => callsWrapper(s) && s.name !== EXEMPT_STEP)
    .flatMap((s) => {
      const p = limitProblem(s);
      return p ? [`R2: ${label(s)} calls scripts/ci-apt.sh and ${p}`] : [];
    });
}

function r3(wf: Workflows): string[] {
  return parseAll(wf)
    .filter(runsPlaywrightDeps)
    .flatMap((s) => {
      const p = limitProblem(s);
      return p ? [`R3: ${label(s)} runs a Playwright --with-deps install and ${p}`] : [];
    });
}

// ---------------------------------------------------------------------------
// R4: the wrapper text (static part) and its --self-test.
// ---------------------------------------------------------------------------

function r4Static(wrapper: string): string[] {
  const v: string[] = [];
  for (const key of ["Acquire::Retries=", "Acquire::http::Timeout=", "Acquire::https::Timeout="]) {
    if (!wrapper.includes(key)) v.push(`R4: scripts/ci-apt.sh lost its "${key}" option`);
  }
  if (/allow-unauthenticated|AllowInsecureRepositories/i.test(wrapper)) {
    v.push("R4: scripts/ci-apt.sh mentions an option that weakens apt signature verification");
  }
  return v;
}

function defaultBudget(wrapper: string): number {
  const m = /^DEFAULT_BUDGET=(\d+)/m.exec(wrapper);
  if (!m) {
    throw new Error("scripts/ci-apt.sh has no DEFAULT_BUDGET=<n> line; rule R6 cannot read the default budget");
  }
  return Number(m[1]);
}

function runSelfTest(script: string) {
  return spawnSync("bash", [script, "--self-test"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 55_000,
    killSignal: "SIGKILL",
  });
}

// ---------------------------------------------------------------------------
// R5: the pg_cron step limit is equal across the two copies.
// ---------------------------------------------------------------------------

const PG_CRON_COPIES: ReadonlyArray<{ file: string; job: string }> = [
  { file: "ci.yml", job: "sql-mutation" },
  { file: "sql-mutation-nightly.yml", job: "sql-mutation-full" },
];

function r5(wf: Workflows): string[] {
  const v: string[] = [];
  const limits: Array<number | null> = [];
  for (const { file, job } of PG_CRON_COPIES) {
    if (!(file in wf)) {
      v.push(`R5: workflow ${file} is missing`);
      limits.push(null);
      continue;
    }
    const hits = parseSteps(file, wf[file]).filter(
      (s) => s.job === job && s.name.startsWith("Provision pg_cron"),
    );
    if (hits.length !== 1) {
      v.push(`R5: ${file} job ${job} has ${hits.length} "Provision pg_cron" steps, expected exactly 1`);
      limits.push(null);
      continue;
    }
    if (hits[0].timeout === null) v.push(`R5: ${label(hits[0])} has no step timeout-minutes`);
    limits.push(hits[0].timeout);
  }
  if (limits.every((x) => x !== null) && limits[0] !== limits[1]) {
    v.push(
      `R5: the "Provision pg_cron" step timeout-minutes differs: ${PG_CRON_COPIES[0].file} ${limits[0]} vs ` +
        `${PG_CRON_COPIES[1].file} ${limits[1]} (sql-mutation-nightly-parity does not compare it)`,
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// R6: budget + slack must fit the step limit.
// ---------------------------------------------------------------------------

function r6(wf: Workflows, wrapper: string): string[] {
  const dflt = defaultBudget(wrapper);
  const v: string[] = [];
  for (const s of parseAll(wf)) {
    if (!callsWrapper(s) || s.name === EXEMPT_STEP || s.timeout === null) continue;
    const calls = s.live.split("\n").filter((l) => l.includes("scripts/ci-apt.sh"));
    const budgets = calls.map((l) => {
      const m = /--budget[ \t]+(\d+)/.exec(l);
      return m ? Number(m[1]) : dflt;
    });
    // Sequential calls in one step add up; each carries its own slack.
    const need = budgets.reduce((a, b) => a + b + R6_SLACK_SECONDS, 0);
    const have = s.timeout * 60;
    if (need > have) {
      v.push(
        `R6: ${label(s)} needs ${need} s (budgets ${budgets.join("+")} s, plus ${R6_SLACK_SECONDS} s each) ` +
          `but its timeout-minutes ${s.timeout} allows only ${have} s`,
      );
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Census.
// ---------------------------------------------------------------------------

function census(wf: Workflows) {
  const steps = parseAll(wf);
  const wrappers = steps.filter(callsWrapper);
  const aptReaching = steps.filter((s) => callsWrapper(s) || runsPlaywrightDeps(s));
  return { wrappers, aptReaching };
}

function censusViolations(wf: Workflows): string[] {
  const { wrappers, aptReaching } = census(wf);
  const v: string[] = [];
  const list = (xs: Step[]) => xs.map((s) => `    - ${label(s)}`).join("\n");
  if (aptReaching.length !== EXPECTED_APT_REACHING_STEPS) {
    v.push(
      `census: ${aptReaching.length} apt-reaching steps, pinned at ${EXPECTED_APT_REACHING_STEPS}. ` +
        `If the change is deliberate, move EXPECTED_APT_REACHING_STEPS. Steps found:\n${list(aptReaching)}`,
    );
  }
  if (wrappers.length !== EXPECTED_WRAPPER_CALLERS) {
    v.push(
      `census: ${wrappers.length} wrapper callers, pinned at ${EXPECTED_WRAPPER_CALLERS}. ` +
        `If the change is deliberate, move EXPECTED_WRAPPER_CALLERS. Steps found:\n${list(wrappers)}`,
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// In-memory mutants. Each throws when the pattern is absent or changes nothing.
// ---------------------------------------------------------------------------

function sub(text: string, re: RegExp, replacement: string): string {
  const out = text.replace(re, replacement);
  if (out === text) throw new Error(`mutant pattern did not match or changed nothing: ${re}`);
  return out;
}

function mutate(wf: Workflows, file: string, fn: (t: string) => string): Workflows {
  if (!(file in wf)) throw new Error(`mutant target ${file} is not a workflow`);
  return { ...wf, [file]: fn(wf[file]) };
}

const WRAPPER_PSQL_LINE = /^( *)bash scripts\/ci-apt\.sh install --provides psql postgresql-client$/m;

function duplicateStep(wf: Workflows, file: string, namePrefix: string): Workflows {
  const step = parseSteps(file, wf[file]).find((s) => s.name.startsWith(namePrefix));
  if (!step) throw new Error(`no step named "${namePrefix}..." in ${file}`);
  const lines = wf[file].split("\n");
  const block = lines.slice(step.start, step.end);
  lines.splice(step.end, 0, ...block);
  return { ...wf, [file]: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// The real tree.
// ---------------------------------------------------------------------------

const WF = loadWorkflows();
const WRAPPER = readFileSync(WRAPPER_PATH, "utf8");

describe("ci-apt-bounded: every apt-reaching CI step is bounded (Phase 164.9.8)", () => {
  it("finds the workflows by directory listing and parses steps out of every one that has jobs", () => {
    expect(Object.keys(WF).length).toBeGreaterThan(5);
    expect(Object.keys(WF)).toContain("ci.yml");
    expect(existsSync(WRAPPER_PATH)).toBe(true);
    for (const [file, text] of Object.entries(WF)) {
      if (/^jobs:\s*$/m.test(text)) {
        expect(parseSteps(file, text).length, `${file} has jobs: but no parsed steps`).toBeGreaterThan(0);
      }
    }
  });

  it("R1: no workflow step calls apt or apt-get directly (command position)", () => {
    expect(r1(WF)).toEqual([]);
  });

  it("R2: every wrapper-calling step has a timeout-minutes of at most 10 (mutex steps exempt)", () => {
    expect(r2(WF)).toEqual([]);
  });

  it("R3: every Playwright --with-deps / install-deps step has a timeout-minutes of at most 10", () => {
    expect(r3(WF)).toEqual([]);
  });

  it("R4: scripts/ci-apt.sh keeps its three Acquire keys and no signature-weakening option", () => {
    expect(r4Static(WRAPPER)).toEqual([]);
  });

  it(
    "R4: scripts/ci-apt.sh --self-test exits 0",
    () => {
      const r = runSelfTest(WRAPPER_PATH);
      const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-1500);
      expect(
        r.status,
        `bash scripts/ci-apt.sh --self-test did not exit 0 (status ${r.status}, signal ${r.signal}); ` +
          `a null status means it hit the 55 s spawn timeout, i.e. a phase was not bounded.\n${tail}`,
      ).toBe(0);
      expect(r.stdout).toContain("ci-apt self-test OK");
    },
    60_000,
  );

  it("R5: the Provision pg_cron step limit is equal in ci.yml sql-mutation and the nightly sql-mutation-full", () => {
    expect(r5(WF)).toEqual([]);
  });

  it("R6: every non-exempt wrapper call's budget + 60 s fits its step's timeout-minutes x 60", () => {
    expect(r6(WF, WRAPPER)).toEqual([]);
  });

  it(`census: ${EXPECTED_APT_REACHING_STEPS} apt-reaching steps and ${EXPECTED_WRAPPER_CALLERS} wrapper callers`, () => {
    expect(censusViolations(WF)).toEqual([]);
  });
});

describe("ci-apt-bounded: CALIBRATION - an in-memory mutant flips each rule", () => {
  const MUTEX_PROBE = "mutex-probe.yml";

  it("baseline: the real tree is clean under every pure rule, so a flip below is the mutant's doing", () => {
    expect([...r1(WF), ...r2(WF), ...r3(WF), ...r4Static(WRAPPER), ...r5(WF), ...r6(WF, WRAPPER), ...censusViolations(WF)]).toEqual([]);
  });

  it("R1a: a wrapper line replaced by a raw sudo apt-get install is flagged", () => {
    const m = mutate(WF, MUTEX_PROBE, (t) => sub(t, WRAPPER_PSQL_LINE, "$1sudo apt-get install -y postgresql-client"));
    const v = r1(m);
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v.join("\n")).toContain(MUTEX_PROBE);
  });

  it("R1b: env-prefixed and bare-assignment forms are flagged", () => {
    const forms = [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client",
      "env DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client",
      "DEBIAN_FRONTEND=noninteractive sudo apt-get update -y",
    ];
    for (const form of forms) {
      const m = mutate(WF, MUTEX_PROBE, (t) => sub(t, WRAPPER_PSQL_LINE, `$1${form}`));
      expect(r1(m).length, `form not flagged: ${form}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("R1c: sudo env, sudo -E, apt options, continuation and chained forms are flagged", () => {
    const forms = [
      "sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client",
      "sudo -E apt-get install -y postgresql-client",
      "sudo -E env DEBIAN_FRONTEND=noninteractive apt install -y postgresql-client",
      "sudo -u root apt-get update",
      "sudo apt-get -o Acquire::Retries=1 -y update",
      "sudo \\\n          apt-get install -y postgresql-client",
      "true && sudo apt-get update -y",
      "true || apt-get install -y postgresql-client",
      "echo hi | sudo apt-get install -y postgresql-client",
    ];
    for (const form of forms) {
      const m = mutate(WF, MUTEX_PROBE, (t) => sub(t, WRAPPER_PSQL_LINE, `$1${form}`));
      expect(r1(m).length, `form not flagged: ${JSON.stringify(form)}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("R1-neg: an echo line that merely mentions apt install produces NO violation", () => {
    const m = mutate(WF, MUTEX_PROBE, (t) =>
      sub(t, WRAPPER_PSQL_LINE, '$1echo "skipping apt install, do not run apt-get update here"'),
    );
    expect(r1(m)).toEqual([]);
    // apt-cache policy is a read, not one of the verbs.
    const m2 = mutate(WF, MUTEX_PROBE, (t) => sub(t, WRAPPER_PSQL_LINE, "$1apt-cache policy postgresql-client"));
    expect(r1(m2)).toEqual([]);
  });

  it("R2a: deleting an Install psql client step's timeout-minutes is flagged", () => {
    const m = mutate(WF, "prod-prober.yml", (t) =>
      sub(t, /(- name: Install psql client\n) {8}timeout-minutes: 8\n/, "$1"),
    );
    const v = r2(m);
    expect(v.length).toBe(1);
    expect(v[0]).toContain("prod-prober.yml");
    expect(v[0]).toContain("no step timeout-minutes");
  });

  it("R2b: raising that timeout-minutes to 60 is flagged", () => {
    const m = mutate(WF, "prod-prober.yml", (t) =>
      sub(t, /(- name: Install psql client\n) {8}timeout-minutes: 8\n/, "$1        timeout-minutes: 60\n"),
    );
    const v = r2(m);
    expect(v.length).toBe(1);
    expect(v[0]).toContain("above 10");
  });

  it("R2-exempt: the mutex-acquire step stays exempt, and ONLY by that exact name", () => {
    // Real tree: the exempt steps call the wrapper and carry no timeout, yet R2 is clean.
    const exempt = parseAll(WF).filter((s) => callsWrapper(s) && s.name === EXEMPT_STEP);
    expect(exempt.length).toBe(2);
    expect(exempt.every((s) => s.timeout === null)).toBe(true);
    // Rename one and the same text is a violation.
    const m = mutate(WF, "supabase-migrate.yml", (t) =>
      sub(t, /- name: Acquire shared-test-db mutex\n/, "- name: Acquire the mutex\n"),
    );
    expect(r2(m).join("\n")).toContain("Acquire the mutex");
  });

  it("R3a: deleting a Playwright --with-deps step's timeout-minutes is flagged", () => {
    const m = mutate(WF, "ci.yml", (t) =>
      sub(t, /(- name: Install Playwright \(browser bundle from cache when available\)\n) {8}timeout-minutes: 10\n/, "$1"),
    );
    const v = r3(m);
    expect(v.length).toBe(1);
    expect(v[0]).toContain("no step timeout-minutes");
  });

  it("R3b: raising that timeout-minutes to 30 is flagged", () => {
    const m = mutate(WF, "ci.yml", (t) =>
      sub(
        t,
        /(- name: Install Playwright \(browser bundle from cache when available\)\n) {8}timeout-minutes: 10\n/,
        "$1        timeout-minutes: 30\n",
      ),
    );
    const v = r3(m);
    expect(v.length).toBe(1);
    expect(v[0]).toContain("above 10");
  });

  it("R3-nightly-form: the nightly's `- timeout-minutes:` on the step's first line is read, and raising it is flagged", () => {
    const real = parseAll(WF).filter((s) => s.file === "nightly.yml" && runsPlaywrightDeps(s));
    expect(real.length).toBe(1);
    expect(real[0].timeout).toBe(10);
    const m = mutate(WF, "nightly.yml", (t) => sub(t, /^( {6}- )timeout-minutes: 10$/m, "$1timeout-minutes: 30"));
    expect(r3(m).join("\n")).toContain("nightly.yml");
    const gone = mutate(WF, "nightly.yml", (t) => sub(t, /^ {6}- timeout-minutes: 10\n {8}run:/m, "      - run:"));
    expect(r3(gone).join("\n")).toContain("no step timeout-minutes");
  });

  it("R3-neg: a comment that merely mentions `playwright install-deps` is not a Playwright install", () => {
    const m = mutate(WF, "ci.yml", (t) =>
      sub(t, /(- name: Install Playwright \(browser bundle from cache when available\)\n) {8}timeout-minutes: 10\n/, "$1"),
    );
    // The lighthouse step carries the words in a comment and keeps its own real install: still exactly one violation (above).
    expect(r3(m).length).toBe(1);
    const commentOnly = "# npx playwright install --with-deps chromium\n";
    expect(runsPlaywrightDeps({ live: liveText(commentOnly.split("\n")) } as Step)).toBe(false);
  });

  it("R4a: removing an Acquire key from the wrapper text is flagged", () => {
    const v = r4Static(sub(WRAPPER, /Acquire::https::Timeout=/g, ""));
    expect(v.join("\n")).toContain("Acquire::https::Timeout=");
    expect(r4Static(sub(WRAPPER, /Acquire::Retries=/g, "")).join("\n")).toContain("Acquire::Retries=");
    expect(r4Static(sub(WRAPPER, /Acquire::http::Timeout=/g, "")).join("\n")).toContain("Acquire::http::Timeout=");
  });

  it("R4b: adding a signature-weakening option to the wrapper text is flagged", () => {
    expect(r4Static(`${WRAPPER}\nAPT_NET_OPTS+=(--allow-unauthenticated)\n`).join("\n")).toContain("weakens");
    expect(r4Static(`${WRAPPER}\n-o Acquire::AllowInsecureRepositories=true\n`).join("\n")).toContain("weakens");
    expect(r4Static(`${WRAPPER}\n# --Allow-Unauthenticated\n`).join("\n")).toContain("weakens");
  });

  it(
    "R4c: a wrapper whose --self-test fails makes the self-test check fail",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "ci-apt-calib-"));
      try {
        const broken = join(dir, "ci-apt.sh");
        writeFileSync(broken, sub(WRAPPER, /^self_test\(\) \{\n/m, "self_test() {\n  exit 7\n"));
        const r = runSelfTest(broken);
        expect(r.status).toBe(7);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("R5: changing the nightly's pg_cron step limit so it differs from ci.yml is flagged", () => {
    const m = mutate(WF, "sql-mutation-nightly.yml", (t) =>
      sub(t, /(- name: Provision pg_cron[^\n]*\n) {8}timeout-minutes: 7\n/, "$1        timeout-minutes: 6\n"),
    );
    const v = r5(m);
    expect(v.length).toBe(1);
    expect(v[0]).toContain("differs");
    // sql-mutation-nightly-parity cannot see this; that is the gap the rule closes.
    const gone = mutate(WF, "sql-mutation-nightly.yml", (t) =>
      sub(t, /(- name: Provision pg_cron[^\n]*\n) {8}timeout-minutes: 7\n/, "$1"),
    );
    expect(r5(gone).join("\n")).toContain("no step timeout-minutes");
  });

  it("R6: a psql call given --budget 900 under its 8-minute limit is flagged, and R2 stays quiet", () => {
    for (const call of [
      "bash scripts/ci-apt.sh install --budget 900 --provides psql postgresql-client",
      "bash scripts/ci-apt.sh install --provides psql --budget 900 postgresql-client",
    ]) {
      const m = mutate(WF, "ci.yml", (t) => sub(t, WRAPPER_PSQL_LINE, `$1${call}`));
      const v = r6(m, WRAPPER);
      expect(v.length, call).toBe(1);
      expect(v[0]).toContain("960 s");
      expect(v[0]).toContain("480 s");
      expect(r2(m)).toEqual([]);
    }
    // And the arithmetic is exact at the boundary: the real pg_cron step sits at 360 + 60 = 420 = 7 x 60.
    const pg = mutate(WF, "ci.yml", (t) => sub(t, /--budget 360/, "--budget 361"));
    expect(r6(pg, WRAPPER).length).toBe(1);
  });

  it("census-down: a wrapper call line turned into a comment drops the count to 17", () => {
    const m = mutate(WF, MUTEX_PROBE, (t) => sub(t, WRAPPER_PSQL_LINE, "$1# bash scripts/ci-apt.sh install --provides psql postgresql-client"));
    expect(census(m).aptReaching.length).toBe(EXPECTED_APT_REACHING_STEPS - 1);
    const v = censusViolations(m);
    expect(v.join("\n")).toContain("17 apt-reaching steps");
    expect(v.join("\n")).toContain("13 wrapper callers");
    // The silent-vanish case: every other rule stays green.
    expect(r1(m)).toEqual([]);
    expect(r2(m)).toEqual([]);
    expect(r6(m, WRAPPER)).toEqual([]);
  });

  it("census-up: a duplicated Playwright step block raises the count to 19", () => {
    const m = duplicateStep(WF, "ci.yml", "Install Playwright Chromium");
    expect(census(m).aptReaching.length).toBe(EXPECTED_APT_REACHING_STEPS + 1);
    expect(censusViolations(m).join("\n")).toContain("19 apt-reaching steps");
    // Wrapper callers did not move.
    expect(census(m).wrappers.length).toBe(EXPECTED_WRAPPER_CALLERS);
  });
});
