/**
 * Red/green proof for the SQL gate vacuity linter (Phase 164.3, VAC-03).
 *
 * ⛔ FOUNDER RULE, MACHINE-CHECKED HERE: a rule that cannot fire is worse than
 * no rule. Every rule the linter ships is exercised below against TWO committed
 * fixtures — one it MUST flag and one it MUST pass — so a rule whose pattern
 * has been defanged stops failing its red fixture and this file goes red.
 *
 * ⛔ THE RULE SET IS PINNED EXACTLY. Phase decision D-16 bounds VAC-03 honestly:
 * mechanisms 1, 2 and 4 are statically detectable, 3 only narrowly, and 5 is NOT
 * — its detector is the mutation runner's first-failure identity assertion.
 * Shipping a mechanism-5 lint rule to make the count look complete would be this
 * phase committing its own named defect, so the pin below asserts BOTH that the
 * four shipped rules are present AND that no rule claims mechanism 5. Adding a
 * rule reds this file until its fixture pair exists; dropping one reds it too.
 *
 * ⛔ THE ALLOWLIST IS PINNED EXACTLY. VAC-03's scope is "new gate files": the 70
 * files that Phase 164.4 will clean up carry pre-existing findings, which are
 * allowlisted per (file, rule) with an EXACT COUNT and a reason. The count is
 * what stops the allowlist absorbing new violations silently (T-164.3-15) — one
 * more finding in an already-allowlisted file still fails the gate.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RULES,
  DELEGATED_MECHANISMS,
  ALLOWLIST,
  lintFile,
  lintPaths,
  FIXTURE_DIR,
} from "../../scripts/lint-sql-gates.mjs";

const ROOT = process.cwd();
const LINTER = "scripts/lint-sql-gates.mjs";

/** The exact set of rules this phase is allowed to ship (D-16). */
const EXPECTED_RULE_IDS = [
  "R1-exception-handler-probe",
  "R2-functiondef-comment-strip",
  "R3-additive-diagnostic-narrow",
  "R4-tgtype-bitmask-completeness",
] as const;

function fixture(ruleId: string, arm: "red" | "green"): string {
  return join(ROOT, FIXTURE_DIR, `${ruleId}.${arm}.sql`);
}

function runCli(args: string[]) {
  const res = spawnSync("node", [LINTER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

describe("lint-sql-gates: the shipped rule set (D-16)", () => {
  it("ships exactly the four statically-detectable rules, no more and no fewer", () => {
    expect(RULES.map((r) => r.id).sort()).toEqual([...EXPECTED_RULE_IDS].sort());
  });

  it("ships NO rule for mechanism 5 — it is delegated, not detected", () => {
    // D-16: arm reachability is not statically decidable. A rule here that
    // could never fire would be the vacuity this phase exists to eliminate.
    expect(RULES.filter((r) => r.mechanism === 5)).toEqual([]);
    const five = DELEGATED_MECHANISMS.find((m) => m.mechanism === 5);
    expect(five, "mechanism 5 must be explicitly delegated, not silently absent").toBeDefined();
    expect(five!.decision).toBe("D-16");
    expect(five!.detector.length).toBeGreaterThan(20);
  });

  it("covers each detectable mechanism exactly once", () => {
    expect(RULES.map((r) => r.mechanism).sort()).toEqual([1, 2, 3, 4]);
  });

  it("states each rule's honest scope in a non-trivial sentence", () => {
    for (const rule of RULES) {
      expect(rule.scope.length, `${rule.id} needs a stated scope boundary`).toBeGreaterThan(40);
    }
  });

  it("names the narrow rule's undecidability limit in its own scope text", () => {
    const r3 = RULES.find((r) => r.mechanism === 3)!;
    expect(r3.scope.toLowerCase()).toContain("undecidable");
  });

  it("G3: the PLANNING DOCUMENTS do not claim more shapes than the linter ships", () => {
    // ⛔ Verification gap G3. D-16 narrowed VAC-03 from five shapes to four
    // plus a delegation, and the narrowing reached ROADMAP:538 (the plan line)
    // but NOT ROADMAP's success criterion 3 nor REQUIREMENTS.md's VAC-03 —
    // both of which still read "the five measured (vacuity) shapes". The
    // shipped artifact was correct; the requirement sentence over-claimed it,
    // which is the shape this phase catalogues, and "a scope amendment that
    // touches one file is incomplete" is a standing rule here.
    //
    // Pinned by machine so the count in the requirement and the count in the
    // code cannot drift apart again in either direction.
    const shipped = RULES.length;
    expect(shipped).toBe(4);

    for (const rel of [".planning/REQUIREMENTS.md", ".planning/ROADMAP.md"]) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      const claims = text
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(
          ({ line }) =>
            /\bVAC-03\b/.test(line) ||
            /static linter (rejects|for)/i.test(line),
        )
        .filter(({ line }) => /\bfive\b[^.]{0,40}\b(measured )?(vacuity )?shapes?\b/i.test(line));

      expect(
        claims.map(({ n, line }) => `${rel}:${n}: ${line.trim().slice(0, 140)}`),
        `A planning sentence still claims FIVE shapes while the linter ships ${shipped} rules and ` +
          `delegates mechanism 5 to the mutation runner per D-16. Correct the sentence, or — if a ` +
          `fifth rule was genuinely added — update this test and DELEGATED_MECHANISMS together.`,
      ).toEqual([]);
    }
  });
});

describe("lint-sql-gates: every rule fires on red and passes on green", () => {
  it.each(EXPECTED_RULE_IDS)("%s has BOTH fixtures committed", (ruleId) => {
    expect(existsSync(fixture(ruleId, "red")), `missing red fixture for ${ruleId}`).toBe(true);
    expect(existsSync(fixture(ruleId, "green")), `missing green fixture for ${ruleId}`).toBe(true);
  });

  it.each(EXPECTED_RULE_IDS)("%s FIRES on its red fixture", (ruleId) => {
    const res = lintFile(fixture(ruleId, "red"));
    expect(res.measureFail, `${ruleId} red fixture failed to parse`).toBeNull();
    const fired = res.findings.map((f: { rule: string }) => f.rule);
    expect(fired, `${ruleId} did not fire on its own red fixture`).toContain(ruleId);
    // The red fixture isolates ONE defect: no other rule may fire on it, or the
    // "it fired" evidence would not be evidence about this rule.
    expect(new Set(fired)).toEqual(new Set([ruleId]));
    for (const f of res.findings) {
      expect(typeof f.line).toBe("number");
      expect(f.line).toBeGreaterThan(0);
    }
  });

  it.each(EXPECTED_RULE_IDS)("%s PASSES its green fixture (the repaired idiom)", (ruleId) => {
    const res = lintFile(fixture(ruleId, "green"));
    expect(res.measureFail, `${ruleId} green fixture failed to parse`).toBeNull();
    expect(res.findings, `${ruleId} green fixture must be clean`).toEqual([]);
  });

  it("every red fixture cites the mechanism it reproduces — the NUMBER, derived from RULES", () => {
    // ⛔ SP-I02. This asserted only `toContain("RED FIXTURE")`, which is the
    // banner every fixture has by construction — so a fixture whose mechanism
    // attribution was DELETED, or COPIED from another rule, passed the arm
    // titled "cites the mechanism it reproduces". The number is now derived
    // from `RULES`, which the linter owns, so the citation is compared to the
    // thing rather than to itself.
    const attribution = (ruleId: string) => {
      const rule = RULES.find((r: { id: string }) => r.id === ruleId);
      expect(rule, `${ruleId} is not in RULES`).toBeDefined();
      return `RED FIXTURE for ${ruleId} (mechanism ${(rule as { mechanism: number }).mechanism}).`;
    };

    for (const ruleId of EXPECTED_RULE_IDS) {
      const text = readFileSync(fixture(ruleId, "red"), "utf8");
      expect(
        text,
        `${ruleId}'s red fixture does not cite its own rule id and mechanism number`,
      ).toContain(attribution(ruleId));
    }

    // Calibration, both failure shapes the finding names, applied to a COPY of
    // the red fixture's REAL BYTES so the fixtures on disk are untouched:
    //   * attribution DEGRADED to a bare banner — the banner alone must not
    //     satisfy the arm;
    //   * attribution COPIED from another rule — a real risk, since the
    //     fixtures are written by hand from a template.
    //
    // ⛔ [VAC-SELFREF-01] FIXED HERE — Phase 164.3.1 plan 08. The DEGRADED half
    // used to assert against `const banner = "-- RED FIXTURE (see the rule for
    // the mechanism).\n"`, a string literal declared one line above the two
    // assertions that read it. Those assertions held whether or not the
    // fixtures, `RULES` or `attribution` existed, so they could not fail: a
    // self-referential oracle, primitive D. It was not caught by four review
    // rounds; it was caught by machine —
    // `src/__tests__/self-referential-oracle.test.ts` flagged this file at
    // `:183` and `:184` AT HEAD, before this fix, recorded verbatim in
    // `164.3.1-02-CALIBRATION.md` § II. The subject below is now the fixture's
    // real bytes, degraded by the very mutation the finding describes, so it
    // fails when the fixtures, the linter's `RULES`, or `attribution` change.
    //
    // MEASURED 2026-09-01 (`grep -ac "RED FIXTURE"
    // scripts/lint-sql-gates-fixtures/*.red.sql` → 1 per file): the phrase
    // "RED FIXTURE" occurs EXACTLY ONCE in each red fixture — inside the
    // attribution line itself. So the degradation that reproduces the reported
    // blindness is REPLACING the attribution with a bare banner, not deleting
    // it: an outright deletion would take "RED FIXTURE" with it and the old
    // assertion would have reddened too. The synthetic const asserted a
    // property of an imagined fixture; these bytes are the real ones.
    const first = EXPECTED_RULE_IDS[0];
    const other = EXPECTED_RULE_IDS[1];
    expect(other, "need two rules to prove a cross-attribution is caught").toBeDefined();
    const text = readFileSync(fixture(first, "red"), "utf8");

    const degraded = text.replace(attribution(first), "RED FIXTURE (see the rule for the mechanism).");
    expect(
      degraded,
      "the degradation must have changed the real fixture text — if it did not, the fixture no longer carries its attribution and the loop above should already have failed",
    ).not.toBe(text);
    expect(
      degraded,
      'the OLD arm — a bare toContain("RED FIXTURE") — still passes on a fixture whose mechanism attribution has been degraded away; that is the SP-I02 vacuity, demonstrated on the real bytes',
    ).toContain("RED FIXTURE");
    expect(
      degraded,
      "the CURRENT arm must catch a degraded attribution that the old banner-only arm accepted",
    ).not.toContain(attribution(first));

    const crossAttributed = text.replace(attribution(first), attribution(other));
    expect(crossAttributed, "the mutation must have changed the text").not.toBe(text);
    expect(crossAttributed).not.toContain(attribution(first));
  });
});

describe("lint-sql-gates: cannot report a pass it did not measure", () => {
  it("emits MEASURE_FAIL rather than zero findings on an unparseable file", () => {
    const res = lintFile(join(ROOT, FIXTURE_DIR, "unparseable.sql"));
    expect(res.measureFail, "an unbalanced block must be MEASURE_FAIL, never 0 findings").not.toBeNull();
    expect(res.findings).toEqual([]);
  });

  it("exits non-zero on an empty corpus rather than reporting clean", () => {
    const res = lintPaths([], { applyAllowlist: false });
    expect(res.measureFails.length).toBeGreaterThan(0);
    expect(res.ok).toBe(false);
  });
});

describe("lint-sql-gates: the pre-existing-violation allowlist (T-164.3-15)", () => {
  it("pins the allowlist exactly — entries cannot accumulate silently", () => {
    const snapshot = ALLOWLIST.map(
      (e: { file: string; rule: string; count: number }) => `${e.file}::${e.rule}::${e.count}`,
    ).sort();
    // MEASURED 2026-08-29 by running the linter over the full corpus at HEAD,
    // BEFORE the allowlist was written — 43 findings across 9 (file, rule)
    // pairs, and ZERO in test_strategy_shares_rls.sql, the one file whose
    // idioms Phase 164 already repaired. A finding there would have been a
    // regression to investigate, not something to allowlist.
    expect(snapshot).toMatchInlineSnapshot(`
      [
        "supabase/tests/test_api_keys_venue_identity_uniq.sql::R2-functiondef-comment-strip::6",
        "supabase/tests/test_compute_analytics_kind_retired.sql::R2-functiondef-comment-strip::6",
        "supabase/tests/test_get_verified_cohort_rank_gate.sql::R3-additive-diagnostic-narrow::3",
        "supabase/tests/test_guard_wizard_draft_updates_auth_uid.sql::R2-functiondef-comment-strip::4",
        "supabase/tests/test_log_audit_event_service_ceiling.sql::R2-functiondef-comment-strip::4",
        "supabase/tests/test_retention_crons_safe.sql::R2-functiondef-comment-strip::1",
        "supabase/tests/test_sanitize_user_hardening.sql::R2-functiondef-comment-strip::6",
        "supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql::R2-functiondef-comment-strip::9",
        "supabase/tests/test_wizard_session_idempotency.sql::R2-functiondef-comment-strip::4",
      ]
    `);
    expect(ALLOWLIST.reduce((n: number, e: { count: number }) => n + e.count, 0)).toBe(43);
  });

  it("gives every entry a real reason, not a placeholder", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length, `${entry.file}/${entry.rule} needs a reason`).toBeGreaterThan(30);
      expect(entry.count).toBeGreaterThan(0);
    }
  });

  it("fails when an allowlisted file gains ONE more finding of the same rule", () => {
    // The count is the anti-accumulation mechanism. Prove it bites: raise the
    // observed count by pretending the file produced one extra finding.
    const entry = ALLOWLIST[0];
    const res = lintPaths([join(ROOT, entry.file)], {
      applyAllowlist: true,
      allowlistOverride: [{ ...entry, count: entry.count - 1 }],
    });
    expect(res.ok, "an un-allowlisted extra finding must fail the gate").toBe(false);
  });

  it("fails when an allowlist entry goes STALE (fewer findings than allowed)", () => {
    const entry = ALLOWLIST[0];
    const res = lintPaths([join(ROOT, entry.file)], {
      applyAllowlist: true,
      allowlistOverride: [{ ...entry, count: entry.count + 1 }],
    });
    expect(res.ok, "a stale allowlist entry must fail so the ratchet tightens").toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [MUT-W02] — the aggregator's tolerance posture, parsed STRUCTURALLY
// ═══════════════════════════════════════════════════════════════════════════
//
// THE DEFECT, MEASURED. The pin this replaces asserted each job's tolerance
// posture with a regex over ONE literal spelling —
// `new RegExp('\\[ "\\$name" = "' + job + '" \\]')` — and for a `tolerance:
// null` row asserted `not.toMatch(...)`. That is an assertion about BYTES. An
// equivalently-written arm (`[[ $name == 'sql-mutation' ]]`) is a real, working
// per-job skip tolerance that widens what branch protection accepts, and the
// regex does not match a byte of it, so the old pin stayed GREEN. Observed
// 2026-09-01 against `MW02-alternate-spelling.red.yml`:
//
//     AssertionError: expected '# MW02 RED FIXTURE — a per-job tolera…'
//     to match /\[ "\$name" = "sql-mutation" \]/
//
// THE RE-EXPRESSION. Extract the result-loop script block from the workflow
// bytes by its own literal markers (`for r in \` … `done` — the SP-L02 extract
// idiom this file already uses), then enumerate the shell BRANCH CONDITIONS
// line-wise, normalising bracket style, operator spelling, quoting and `${x}`
// bracing away. The assertion becomes one about the SET of tolerance arms
// rather than one spelling of one arm.
//
// NO YAML DEPENDENCY. RESEARCH § "Don't Hand-Roll" is about parsers for
// languages whose grammar you do not control; this reads a script block the
// repo itself wrote, by markers the repo itself placed, and its non-vacuity
// floor fires if that assumption ever stops holding. Adding a YAML parser to a
// repo with a banned-package supply-chain gate to read four `if` lines is the
// worse trade.

type LoopCondition = {
  /** The `$name = <job>` arm this condition sits inside, or null at chain level. */
  job: string | null;
  indent: number;
  raw: string;
  normalized: string;
  /** Shell variables the condition tests, other than the loop's own `name`/`result`. */
  guards: string[];
};

export type ResultLoopParse = {
  /** Non-null when the parse cannot be trusted. NEVER report zero findings instead. */
  measureFail: string | null;
  conditions: LoopCondition[];
  /** Jobs given their own `$name = …` arm, in source order. */
  jobArms: string[];
  /** job -> guard variables of its tolerance arm(s). Absent => no tolerance arm. */
  tolerance: Map<string, string[]>;
};

/**
 * Normalise a shell condition to a spelling-independent form:
 * `[[ "$result" == 'skipped' && "${is_fork_pr}" == 'true' ]]`
 *   -> `$result = skipped && $is_fork_pr = true`
 */
export function normalizeCondition(raw: string): string {
  // The sentinel is written as an explicit escape, NEVER as a raw control
  // byte in the source: this repo has a MEASURED grep-blind file
  // (`src/lib/wizardErrors.test.ts` carries a literal NUL at line 1572, and
  // `grep` exits 1 there, which reads as "clean").
  const NE = "\u0001";
  return raw
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$$$1") // ${x} -> $x
    .replace(/[[\]{};]/g, " ") // bracket style and grouping braces are noise
    .replace(/["']/g, "") // quoting is noise
    .replace(/\s*!=\s*/g, ` ${NE} `) // protect != from the = collapse below
    .replace(/\s*==?\s*/g, " = ") // `==` and `=` are the same test
    .split(NE)
    .join("!=")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The `for r in \` … `done` block of a result loop, from raw workflow bytes.
 * Anchored on the loop's own markers rather than on the step name, so the same
 * function reads `ci.yml` and the MW02 fixture snippets.
 */
export function extractResultLoopBlock(yamlText: string): string | null {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((l) => /^\s*for r in \\\s*$/.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*done\s*$/.test(l));
  if (end < 0) return null;
  return lines.slice(start, end + 1).join("\n");
}

// ── [MUT-W02] EXECUTION ORACLE (WR-03, 164.3.1 review) ─────────────────────
//
// `extractResultLoopConditions` above reads `if`/`elif` lines. That is a
// spelling FAMILY, not the behaviour: a tolerance written as
// `case "$result" in success|skipped) …`, as a negated guard
// (`[[ $result != success && $is_fork_pr != true ]]`), or as an `||` chain is a
// real, effective skip tolerance the parser reports as ABSENT — and the
// `tolerance === null` arm then passes on a workflow that grew one. GRAMMAR § 3
// of the mutation runner states this phase's own lesson: any rule stated over
// a spelling can be re-spelled around. So the loop is RUN. The block is the
// real script; `${{ needs.<job>.result }}` is substituted per job and every
// other `${{ … }}` expression (the event guards) is forced to BOTH values,
// over all combinations. What comes back is the loop's own verdict.
const NEEDS_RESULT_RE = /\$\{\{\s*needs\.([A-Za-z0-9_-]+)\.result\s*\}\}/g;
const ANY_EXPRESSION_RE = /\$\{\{([^}]*)\}\}/g;

/** The jobs the loop iterates, read off its own `"<job>=${{ needs.<job>.result }}"` rows. */
export function resultLoopJobs(block: string): string[] {
  return [...block.matchAll(/"([A-Za-z0-9_-]+)=\$\{\{\s*needs\.\1\.result\s*\}\}"/g)].map((m) => m[1]);
}

/** Every DISTINCT non-`needs` `${{ … }}` expression in the block — the event guards. */
export function resultLoopGuardExpressions(block: string): string[] {
  const out = new Set<string>();
  for (const m of block.matchAll(ANY_EXPRESSION_RE)) {
    const expr = m[1].trim();
    if (!/^needs\.[A-Za-z0-9_-]+\.result$/.test(expr)) out.add(expr);
  }
  return [...out];
}

/** All 2^n truth assignments over the guard expressions. */
export function guardCombinations(exprs: string[]): Array<Record<string, boolean>> {
  const combos: Array<Record<string, boolean>> = [];
  for (let bits = 0; bits < 1 << exprs.length; bits += 1) {
    const g: Record<string, boolean> = {};
    exprs.forEach((e, i) => {
      g[e] = Boolean(bits & (1 << i));
    });
    combos.push(g);
  }
  return combos;
}

/**
 * RUN the loop under bash with the given job results (default `success`) and
 * guard values. Throws — never returns a verdict — when the script does not
 * reach its own `fail` variable, so a broken substitution is a MEASURE_FAIL
 * rather than a pass.
 */
export function executeResultLoop(
  block: string,
  results: Record<string, string>,
  guards: Record<string, boolean>,
): { fail: boolean; stdout: string } {
  const script = block
    .replace(NEEDS_RESULT_RE, (_m, job: string) => results[job] ?? "success")
    .replace(ANY_EXPRESSION_RE, (m, expr: string) => {
      const key = expr.trim();
      if (!(key in guards)) throw new Error(`unsubstituted expression in the result loop: ${m}`);
      return guards[key] ? "true" : "false";
    });
  // `-eo pipefail` is what GitHub's default `run:` shell sets.
  const res = spawnSync("bash", ["-eo", "pipefail"], {
    input: `fail=0\n${script}\nprintf 'FAIL=%s\\n' "$fail"\n`,
    encoding: "utf8",
  });
  const m = /^FAIL=(\d+)$/m.exec(res.stdout ?? "");
  if (res.status !== 0 || m === null) {
    throw new Error(
      `the result loop did not run to its verdict (status ${res.status}) — nothing below may be read as a pass:\n${res.stdout}${res.stderr}`,
    );
  }
  return { fail: m[1] !== "0", stdout: res.stdout };
}

/**
 * The loop's tolerance POSTURE by execution: for every job, how many guard
 * combinations tolerate a `skipped` result (the loop passes with that one job
 * skipped and every other job successful).
 */
export function executedTolerancePosture(block: string): {
  jobs: string[];
  combos: number;
  toleratedSkips: Map<string, number>;
} {
  const jobs = resultLoopJobs(block);
  const combos = guardCombinations(resultLoopGuardExpressions(block));
  const toleratedSkips = new Map<string, number>();
  for (const job of jobs) {
    let n = 0;
    for (const g of combos) if (!executeResultLoop(block, { [job]: "skipped" }, g).fail) n += 1;
    toleratedSkips.set(job, n);
  }
  return { jobs, combos: combos.length, toleratedSkips };
}

/**
 * Enumerate the result loop's per-job branch conditions.
 *
 * A JOB ARM is a chain-level condition testing the loop's `$name` against a
 * literal. A TOLERANCE ARM is a condition INSIDE a job arm, at that arm's own
 * if-chain indent, that admits `skipped` as an outcome.
 *
 * The indent test is what distinguishes a tolerance from a message selector:
 * the real `sql-tests` arm contains a nested `if [ "$result" = "skipped" ]`
 * inside its FAILING branch, two spaces deeper, which only chooses which error
 * text to print. Classifying that as a tolerance would report the aggregator as
 * laxer than it is — the mirror of the defect being closed here, and the
 * non-vacuity floor would not have caught it.
 */
export function extractResultLoopConditions(yamlText: string): ResultLoopParse {
  const empty: ResultLoopParse = {
    measureFail: null,
    conditions: [],
    jobArms: [],
    tolerance: new Map(),
  };

  const block = extractResultLoopBlock(yamlText);
  if (block === null) {
    return {
      ...empty,
      measureFail:
        "no `for r in \\` … `done` block found — the result loop's own markers are gone, so this parse measured NOTHING",
    };
  }

  const conditions: LoopCondition[] = [];
  const jobArms: string[] = [];
  const tolerance = new Map<string, string[]>();

  let chainIndent: number | null = null; // indent of the `$name = …` chain
  let currentJob: string | null = null;
  let jobChainIndent: number | null = null; // indent of the current job's inner chain

  for (const line of block.split("\n")) {
    const m = /^(\s*)(?:el)?if\s+(.+?)\s*;\s*then\s*$/.exec(line);
    if (m === null) continue;
    const indent = m[1].length;
    const raw = m[2];
    const normalized = normalizeCondition(raw);

    const nameArm = /^\$name\s*=\s*(\S+)$/.exec(normalized);
    if (nameArm !== null) {
      if (chainIndent === null) chainIndent = indent;
      currentJob = nameArm[1];
      jobChainIndent = null;
      jobArms.push(currentJob);
    } else if (chainIndent !== null && indent <= chainIndent) {
      // Back at chain level on a non-name condition: the strict default arm.
      currentJob = null;
      jobChainIndent = null;
    } else if (currentJob !== null) {
      if (jobChainIndent === null) jobChainIndent = indent;
      if (indent === jobChainIndent && /\$result\s*=\s*skipped/.test(normalized)) {
        const guards = [...normalized.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)]
          .map((g) => g[1])
          .filter((v) => v !== "name" && v !== "result");
        tolerance.set(currentJob, [...new Set([...(tolerance.get(currentJob) ?? []), ...guards])]);
      }
    }

    const guards = [...normalized.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((g) => g[1])
      .filter((v) => v !== "name" && v !== "result");
    conditions.push({ job: currentJob, indent, raw, normalized, guards });
  }

  if (conditions.length === 0 || jobArms.length === 0) {
    return {
      ...empty,
      measureFail: `the loop block parsed to ${conditions.length} condition(s) and ${jobArms.length} job arm(s) — an empty parse is never a pass`,
    };
  }

  return { measureFail: null, conditions, jobArms, tolerance };
}

/**
 * NON-VACUITY FLOOR. MEASURED 2026-09-01 at 420b8fcb:
 *
 *   $ node -e '…extractResultLoopConditions(readFileSync(".github/workflows/ci.yml"))…'
 *   conditions=11 jobArms=3 tolerance=e2e-seeded,sql-tests,plan-anchor-verify
 *
 * 11 = 3 `$name = …` arms + 1 strict default at chain level, + 2 inner
 * conditions each for `e2e-seeded` and `plan-anchor-verify`, + 3 for
 * `sql-tests` (its failing branch carries the nested message selector).
 *
 * The floor is 8, not 11: pinned AT the measurement it reds on every legitimate
 * arm removal and gets raised by reflex, which is how a floor stops being a
 * measurement (D-10 — wide separation, never taste). 8 still catches the
 * failure this exists for: a marker rename or an indentation change that makes
 * the walk return a handful of conditions and report a clean, lax aggregator.
 * Total collapse is caught separately and unconditionally by `measureFail`.
 */
const RESULT_LOOP_CONDITION_FLOOR = 8;

/**
 * The FULL tolerance-bearing set of the real aggregator, measured 2026-09-01 at
 * 420b8fcb by the command in the floor's comment above. Pinned exactly TWICE:
 * by the `if`/`elif` parser over the spellings it reads, and — WR-03 (164.3.1
 * review) — by the EXECUTION oracle below, which RUNS the loop and so cannot
 * be re-spelled around (`case`, negated guards, `||` chains). [MUT-W02]
 * pinned one spelling of one arm; the parser widened that to a family; the
 * execution oracle closes the class.
 *
 * All three are tolerances of a SKIP-BY-DESIGN, and each is justified by
 * something the job cannot control:
 *   * `e2e-seeded`  — a fork PR cannot see `E2E_TEST_DB_CONFIGURED`.
 *   * `sql-tests`   — same, plus `workflow_dispatch`, which its `if:` excludes.
 *   * `plan-anchor-verify` — its `if:` scopes it to `pull_request` so a drifting
 *     anchor on main cannot stall the Railway deploy (D-13).
 * Every other row takes the strict default: any non-success fails the aggregate.
 * A FOURTH entry appearing here means some job grew a reason to be allowed to
 * skip, and that is a decision, not a refactor.
 */
const TOLERANCE_BEARING_JOBS = ["e2e-seeded", "plan-anchor-verify", "sql-tests"] as const;

describe("lint-sql-gates: the CI invocation (mode identity)", () => {
  it("exits 0 over the real 71-file corpus with the allowlist applied", () => {
    const res = runCli([]);
    expect(res.out).toMatch(/scanned 71 file/);
    expect(res.status, res.out).toBe(0);
  });

  it("exits 1 when pointed at a red fixture", () => {
    const res = runCli(["--files", fixture("R2-functiondef-comment-strip", "red")]);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("R2-functiondef-comment-strip");
  });

  it("passes its own self-test", () => {
    const res = runCli(["--self-test"]);
    expect(res.status, res.out).toBe(0);
  });

  it("documents its invocation in its own header", () => {
    const header = readFileSync(join(ROOT, LINTER), "utf8").slice(0, 4000);
    expect(header).toContain("node scripts/lint-sql-gates.mjs");
  });

  it("is invoked by CI with the EXACT local command, unwrapped", () => {
    // Mode identity (164.3-RESEARCH Pitfall 2, and this repo's measured
    // gstack-evidence case where a WRAPPED run reddened a suite a direct run
    // passed): a CI-only invocation mode is a different program. Pinning the
    // bare `run:` lines stops a future edit adding `npm run`, `npx`, a
    // `|| true`, or a shell wrapper around either step.
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const runLines = ci
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("lint-sql-gates.mjs") && l.startsWith("run:"));
    expect(runLines).toEqual([
      "run: node scripts/lint-sql-gates.mjs --self-test",
      "run: node scripts/lint-sql-gates.mjs",
    ]);
  });

  // ── SP-I03 ───────────────────────────────────────────────────────────────
  // This pin used to cover `sql-gate-lint` ALONE. `sql-mutation` — the phase's
  // headline detector — and `plan-anchor-verify` had none, so either could have
  // been dropped from `needs:` or from the result loop and stayed green. Either
  // half alone leaves a gate advisory, and that is not hypothetical: SEAMCORE-09
  // records `frontend-seam-redis` sitting in exactly that half-wired state.
  //
  // The table is the SUBJECT, so widening it is one line. Each row also records
  // its tolerance posture, because "no tolerance arm" is a DIFFERENT claim for
  // `plan-anchor-verify` (which legitimately self-skips off a pull_request)
  // than for the two hermetic jobs — asserting the same thing about all three
  // would have been wrong, and would have had to be deleted the first time it
  // was read.
  const AGGREGATED_JOBS = [
    { job: "sql-gate-lint", tolerance: null },
    { job: "sql-mutation", tolerance: null },
    { job: "plan-anchor-verify", tolerance: "is_pr" },
  ] as const;

  it.each(AGGREGATED_JOBS)(
    "$job is BLOCKING — in the aggregator's needs AND in its result loop",
    ({ job }) => {
      const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
      expect(ci, `${job} is missing from the aggregator's needs:`).toContain(
        `      - ${job}\n`,
      );
      expect(ci, `${job} is missing from the aggregator's result loop`).toContain(
        `"${job}=\${{ needs.${job}.result }}"`,
      );
    },
  );

  // ── [MUT-W02], re-expressed ────────────────────────────────────────────
  // The parse itself must be sound before any conclusion is drawn from it.
  // MEASURE_FAIL and the floor are checked FIRST and unconditionally, so a
  // walker that stopped finding the loop reds here instead of reporting a
  // clean, permissive aggregator.
  it("the result-loop parse is sound before anything is concluded from it", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const parsed = extractResultLoopConditions(ci);

    // DIAGNOSTIC-FIRST (D-12): print what was SEEN, not only the verdict. This
    // is also the measurement command for the floor above — running this file
    // bare re-derives it, so the threshold's provenance is a command anyone can
    // repeat, not a number in a comment. Written with process.stdout.write, not
    // console.log: vitest 4's default reporter swallows console output from
    // PASSING tests, and a measurement visible only on failure is not one.
    process.stdout.write(
      `MW02 result-loop parse: ${parsed.conditions.length} condition(s), ` +
        `${parsed.jobArms.length} job arm(s) [${parsed.jobArms.join(", ")}], ` +
        `tolerance-bearing: ${[...parsed.tolerance]
          .map(([j, g]) => `${j}(${g.join("+") || "unguarded"})`)
          .join(", ")}\n`,
    );

    expect(
      parsed.measureFail,
      "the aggregator's result loop could not be parsed — this gate must never report a tolerance posture it did not measure",
    ).toBeNull();
    expect(
      parsed.conditions.length,
      `only ${parsed.conditions.length} branch condition(s) parsed out of the result loop; 11 were measured on 2026-09-01 at 420b8fcb, so anything under ${RESULT_LOOP_CONDITION_FLOOR} means the walk broke rather than the loop shrank`,
    ).toBeGreaterThanOrEqual(RESULT_LOOP_CONDITION_FLOOR);
  });

  it("the FULL tolerance-bearing set is exactly the three skip-by-design jobs, in any if/elif spelling the parser reads", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const parsed = extractResultLoopConditions(ci);
    expect(parsed.measureFail).toBeNull();

    // This is the assertion [MUT-W02] could not make. The old pin asked "does
    // this job's arm appear, spelled THIS way?" — one job, one spelling. This
    // asks "which jobs are allowed to skip at all?", over every `if`/`elif`
    // arm in the loop, bracket style / operator / quoting normalised away. It
    // is STILL a parse of a spelling family (WR-03): a `case` arm or a negated
    // guard is invisible to it, which is why the EXECUTION oracle below makes
    // the same claim by running the loop. A fourth job appearing here — or one
    // of these three losing its arm — fails by name.
    expect(
      [...parsed.tolerance.keys()].sort(),
      "the aggregator's set of skip-tolerant jobs changed. A job gaining tolerance means a `skipped` result now passes branch protection for it; a job losing it means it will redden every event it legitimately skips on. Either is a decision that belongs in TOLERANCE_BEARING_JOBS with its reason, not a silent edit to ci.yml",
    ).toEqual([...TOLERANCE_BEARING_JOBS].sort());
  });

  it.each(AGGREGATED_JOBS)(
    "$job's tolerance posture is exactly what its hermeticity justifies",
    ({ job, tolerance }) => {
      const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
      const parsed = extractResultLoopConditions(ci);
      expect(parsed.measureFail).toBeNull();
      const guards = parsed.tolerance.get(job);

      if (tolerance === null) {
        // Hermetic: no database, no secret, no network, no `if:`. A `skipped`
        // is therefore ALWAYS a fault, so the strict default arm must apply.
        // Asserted over the PARSE, so an equivalently-spelled `if`/`elif` arm
        // is caught — the MW02 alternate-spelling fixture is the standing
        // proof. Spellings the parser cannot read (`case`, negated guards)
        // are caught by the EXECUTION oracle, which asserts the same thing.
        expect(
          guards,
          `${job} has grown a per-job tolerance arm (guards: ${guards?.join("+") ?? "-"}); it is hermetic and cannot legitimately skip`,
        ).toBeUndefined();
      } else {
        // `plan-anchor-verify` scopes itself to pull_request on purpose (D-13:
        // an anchor drifting on main must not stall the Railway deploy), so its
        // skip tolerance is REQUIRED — and must stay conditioned on the EVENT,
        // not on the result alone. An unguarded arm parses to an empty guard
        // list and fails the containment check below.
        expect(
          guards,
          `${job} lost its tolerance arm; it self-skips off a pull_request and would redden every push`,
        ).toBeDefined();
        expect(
          guards,
          `${job}'s tolerance is no longer conditioned on ${tolerance}; a skip tolerated on the result alone tolerates the fault too`,
        ).toContain(tolerance);
        // The guard must still be BOUND to the event — the parse sees the
        // condition, not the assignment that gives the variable its value.
        expect(ci).toContain(`${tolerance}='\${{ github.event_name ==`);
      }
    },
  );

  // ── The MW02 fixture pair ──────────────────────────────────────────────
  it("MW02 red fixture: the OLD single-spelling regex is BLIND to it, the parser is not", () => {
    const red = readFileSync(
      join(ROOT, "scripts/aggregator-tolerance-fixtures/MW02-alternate-spelling.red.yml"),
      "utf8",
    );

    // (1) THE RECORDED DEFECT, kept permanently. This is the exact regex the
    // pre-plan-08 pin built, applied to an arm that really does tolerate a skip
    // for `sql-mutation`. It matches nothing, so `not.toMatch(...)` — the old
    // "this job has NOT grown a tolerance arm" assertion — passed on a
    // workflow that HAD grown one. Observed 2026-09-01 as the TDD red step.
    const oldArm = new RegExp(`\\[ "\\$name" = "sql-mutation" \\]`);
    expect(
      red,
      "the red fixture must remain invisible to the old regex; if this starts matching, the fixture has drifted back toward the literal spelling and stops modelling the defect",
    ).not.toMatch(oldArm);

    // (2) THE NEW VISIBILITY.
    const parsed = extractResultLoopConditions(red);
    expect(parsed.measureFail, "the red fixture must parse — an unparseable fixture proves nothing").toBeNull();
    expect(
      parsed.jobArms,
      "the parser must recognise the alternate-spelled `[[ $name == 'sql-mutation' ]]` as a job arm",
    ).toContain("sql-mutation");
    expect(
      parsed.tolerance.get("sql-mutation"),
      "the parser must classify sql-mutation as tolerance-bearing in the red fixture; if it does not, the re-expression has been narrowed back toward a spelling and [MUT-W02] is reopened",
    ).toContain("is_fork_pr");
  });

  it("MW02 green fixture: classifies IDENTICALLY to the real ci.yml (fixture fidelity)", () => {
    const green = readFileSync(
      join(ROOT, "scripts/aggregator-tolerance-fixtures/MW02-current-spelling.green.yml"),
      "utf8",
    );
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

    const fromFixture = extractResultLoopConditions(green);
    const fromReal = extractResultLoopConditions(ci);
    expect(fromFixture.measureFail).toBeNull();
    expect(fromReal.measureFail).toBeNull();

    // VACUITY FENCE. Two empty parses are "identical" too. Prove the fixture
    // parse found real arms before proving it agrees with the real file — the
    // lesson the SRO green fixture cost (`self-referential-oracle.test.ts`'s
    // countExpectCallSites: an ABSENCE is satisfied perfectly by rubble).
    expect(
      fromFixture.jobArms.length,
      "the green fixture must parse to real job arms; an empty parse would agree with anything",
    ).toBeGreaterThanOrEqual(3);

    const classify = (p: ResultLoopParse) =>
      [...p.tolerance].map(([j, g]) => `${j}:${[...g].sort().join("+")}`).sort();
    expect(
      classify(fromFixture),
      "the green fixture no longer models the real result loop — ci.yml's tolerance posture changed and the fixture was not updated with it, so the red fixture is being compared against a stale model",
    ).toEqual(classify(fromReal));
    expect(fromFixture.jobArms.slice().sort()).toEqual(fromReal.jobArms.slice().sort());
  });

  it("the MW02 fixture-ID set is pinned exactly — pairs and nothing else", () => {
    // The two members are named for what they SPELL, not by a shared ID, so
    // they cannot be paired by `<id>.{red,green}` the way
    // `scripts/lint-sql-gates-fixtures/` pairs its members. Each side is
    // therefore pinned by name. The contract that matters is unchanged: adding
    // a member reds until its arm exists, and dropping one reds immediately.
    const dir = join(ROOT, "scripts/aggregator-tolerance-fixtures");
    const onDisk = readdirSync(dir);
    const red = onDisk.filter((n) => n.endsWith(".red.yml")).map((n) => n.replace(/\.red\.yml$/, ""));
    const green = onDisk
      .filter((n) => n.endsWith(".green.yml"))
      .map((n) => n.replace(/\.green\.yml$/, ""));

    expect(red.sort(), "every registered MW02 fixture ID must have a RED member").toEqual([
      "MW02-alternate-spelling",
      "MW02-case-spelling",
    ]);
    expect(green.sort(), "every registered MW02 fixture ID must have a GREEN member").toEqual([
      "MW02-current-spelling",
    ]);
    expect(
      onDisk.filter((n) => !n.endsWith(".red.yml") && !n.endsWith(".green.yml")),
      "the fixture directory holds the pair and nothing else",
    ).toEqual([]);
  });

  it("the table above covers EVERY job this phase added — derived from ci.yml, not restated", () => {
    // Without this arm the table is a hand-list, and a fourth job added by
    // 164.4 would be unpinned exactly as `sql-mutation` was. The population is
    // read off ci.yml: every job that runs one of this phase's three scripts.
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const PHASE_SCRIPTS = [
      "scripts/lint-sql-gates.mjs",
      "scripts/mutation-runner/run.mjs",
      "scripts/verify-plan-anchors.mjs",
    ];
    // Job headers are exactly two spaces deep in this workflow.
    const jobs = [...ci.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => ({
      name: m[1],
      at: m.index as number,
    }));
    expect(jobs.length, "no job headers parsed — this arm would be checking an empty set").toBeGreaterThan(10);
    const owning = new Set<string>();
    for (let i = 0; i < jobs.length; i++) {
      const body = ci.slice(jobs[i].at, jobs[i + 1]?.at ?? ci.length);
      if (PHASE_SCRIPTS.some((s) => body.includes(s))) owning.add(jobs[i].name);
    }
    expect([...owning].sort()).toEqual(
      AGGREGATED_JOBS.map((r) => r.job).slice().sort(),
    );
  });

  // ── [MUT-W02] by EXECUTION (WR-03) ────────────────────────────────────
  describe("EXECUTION ORACLE — the result loop is RUN, so a skip tolerance is observed in ANY spelling", () => {
    const loopOf = (rel: string): string => {
      const block = extractResultLoopBlock(readFileSync(join(ROOT, rel), "utf8"));
      expect(block, `${rel}: no \`for r in \\\` … \`done\` block — nothing was executed`).not.toBeNull();
      return block as string;
    };
    const CI = ".github/workflows/ci.yml";
    const RED_ALT = "scripts/aggregator-tolerance-fixtures/MW02-alternate-spelling.red.yml";
    const RED_CASE = "scripts/aggregator-tolerance-fixtures/MW02-case-spelling.red.yml";
    const GREEN = "scripts/aggregator-tolerance-fixtures/MW02-current-spelling.green.yml";

    it("CONTROL: with every job successful the real loop PASSES under every guard combination", () => {
      // Without this, a loop that always sets fail=1 would satisfy every
      // "the skip is rejected" arm below.
      const block = loopOf(CI);
      const combos = guardCombinations(resultLoopGuardExpressions(block));
      expect(combos.length, "no guard expressions parsed — the substitution found nothing").toBeGreaterThan(1);
      for (const g of combos) expect(executeResultLoop(block, {}, g).fail, JSON.stringify(g)).toBe(false);
    });

    it("the real loop: the jobs whose SKIP is tolerated are exactly TOLERANCE_BEARING_JOBS — by execution, spelling-free", () => {
      const block = loopOf(CI);
      const posture = executedTolerancePosture(block);
      // DIAGNOSTIC-FIRST (D-12): what was executed, not only the verdict.
      process.stdout.write(
        `MW02 executed posture: ${posture.jobs.length} job(s) × ${posture.combos} guard combination(s); ` +
          `tolerated skips: ${[...posture.toleratedSkips].map(([j, n]) => `${j}=${n}`).join(", ")}\n`,
      );
      // Non-vacuity: every aggregated job is in the loop and was executed.
      for (const { job } of AGGREGATED_JOBS) expect(posture.jobs, `${job} is not iterated by the loop`).toContain(job);
      expect(posture.combos).toBeGreaterThan(1);

      const tolerant = [...posture.toleratedSkips].filter(([, n]) => n > 0).map(([j]) => j).sort();
      expect(
        tolerant,
        "the set of jobs whose `skipped` result passes the aggregate changed — by EXECUTION, so no spelling hides it. A job gaining tolerance means branch protection now passes on its skip; a job losing it reddens every event it legitimately skips on. Either belongs in TOLERANCE_BEARING_JOBS with its reason",
      ).toEqual([...TOLERANCE_BEARING_JOBS].sort());
    });

    it("every tolerated skip is CONDITIONED on the event — some guard combination still rejects it", () => {
      // A tolerance that passes under EVERY combination tolerates the fault
      // too (the same claim the parser arm makes via `toContain(tolerance)`).
      const block = loopOf(CI);
      const posture = executedTolerancePosture(block);
      for (const job of TOLERANCE_BEARING_JOBS) {
        const n = posture.toleratedSkips.get(job) ?? 0;
        expect(n, `${job}: its skip is tolerated under no combination`).toBeGreaterThan(0);
        expect(n, `${job}: its skip is tolerated UNCONDITIONALLY — the fault is tolerated with the design skip`).toBeLessThan(posture.combos);
      }
    });

    it("hermetic jobs reject skipped, failure AND cancelled under every combination", () => {
      const block = loopOf(CI);
      const combos = guardCombinations(resultLoopGuardExpressions(block));
      const hermetic = AGGREGATED_JOBS.filter((r) => r.tolerance === null).map((r) => r.job);
      expect(hermetic.length).toBeGreaterThan(0);
      for (const job of hermetic) {
        for (const outcome of ["skipped", "failure", "cancelled"]) {
          for (const g of combos) {
            expect(
              executeResultLoop(block, { [job]: outcome }, g).fail,
              `${job}=${outcome} PASSED the aggregate under ${JSON.stringify(g)}`,
            ).toBe(true);
          }
        }
      }
    });

    it("MW02 alternate-spelling red fixture: EXECUTION sees sql-mutation's skip tolerated under the fork-PR guard", () => {
      const posture = executedTolerancePosture(loopOf(RED_ALT));
      expect(posture.toleratedSkips.get("sql-mutation"), "the oracle no longer observes the `[[`/`==` tolerance").toBeGreaterThan(0);
      expect(posture.toleratedSkips.get("sql-gate-lint")).toBe(0);
    });

    it("MW02 case-spelling red fixture: the if/elif PARSER is BLIND to it (recorded) — EXECUTION is not", () => {
      const yaml = readFileSync(join(ROOT, RED_CASE), "utf8");
      // (1) THE RECORDED BLINDNESS, kept permanently as the contrast pin. The
      // parser sees the `[ "$name" = "sql-mutation" ]` job arm and NO
      // tolerance — the `case` statement carries no `if` line for it to read.
      // If this starts reporting a tolerance the fixture has drifted back into
      // the parser's spelling family and stops modelling the gap.
      const parsed = extractResultLoopConditions(yaml);
      expect(parsed.measureFail).toBeNull();
      expect(parsed.jobArms).toContain("sql-mutation");
      expect(parsed.tolerance.get("sql-mutation"), "the parser must stay blind to the `case` spelling for this fixture to model WR-03").toBeUndefined();
      // (2) THE NEW VISIBILITY. Running it: skipped + fork-PR guard true passes.
      const block = loopOf(RED_CASE);
      const posture = executedTolerancePosture(block);
      expect(
        posture.toleratedSkips.get("sql-mutation"),
        "EXECUTION must classify sql-mutation as tolerance-bearing in the case-spelled fixture; if it does not, the oracle has been narrowed back toward a spelling and [MUT-W02] is reopened one spelling wider",
      ).toBeGreaterThan(0);
      expect(posture.toleratedSkips.get("sql-mutation")).toBeLessThan(posture.combos);
    });

    it("MW02 green fixture executes to the SAME tolerance posture as the real ci.yml (fixture fidelity, by execution)", () => {
      const real = executedTolerancePosture(loopOf(CI));
      const fixture = executedTolerancePosture(loopOf(GREEN));
      // Vacuity fence: the fixture parsed to real jobs before agreement means anything.
      expect(fixture.jobs.length).toBeGreaterThanOrEqual(3);
      const tolerant = (p: ReturnType<typeof executedTolerancePosture>) =>
        [...p.toleratedSkips].filter(([, n]) => n > 0).map(([j, n]) => `${j}:${n}/${p.combos}`).sort();
      expect(tolerant(fixture), "the green fixture no longer executes like the real loop").toEqual(tolerant(real));
    });
  });

  it("leaves the corpus untouched — a linter that could edit gate files is a liability", () => {
    const src = readFileSync(join(ROOT, LINTER), "utf8");
    expect(src).not.toMatch(/writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|child_process/);
  });
});
