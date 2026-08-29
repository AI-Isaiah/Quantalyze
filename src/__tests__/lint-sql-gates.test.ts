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
import { existsSync, readFileSync } from "node:fs";
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

  it("every red fixture cites the mechanism it reproduces", () => {
    for (const ruleId of EXPECTED_RULE_IDS) {
      const text = readFileSync(fixture(ruleId, "red"), "utf8");
      expect(text).toContain("RED FIXTURE");
    }
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

  it.each(AGGREGATED_JOBS)(
    "$job's tolerance posture is exactly what its hermeticity justifies",
    ({ job, tolerance }) => {
      const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
      const arm = new RegExp(`\\[ "\\$name" = "${job}" \\]`);
      if (tolerance === null) {
        // Hermetic: no database, no secret, no network, no `if:`. A `skipped`
        // is therefore ALWAYS a fault, so the strict default arm must apply.
        expect(ci, `${job} has grown a per-job tolerance arm; it is hermetic and cannot legitimately skip`).not.toMatch(arm);
      } else {
        // `plan-anchor-verify` scopes itself to pull_request on purpose (D-13:
        // an anchor drifting on main must not stall the Railway deploy), so its
        // skip tolerance is REQUIRED — and must stay conditioned on the event,
        // not on the result alone.
        expect(ci, `${job} lost its tolerance arm; it self-skips off a pull_request and would redden every push`).toMatch(arm);
        expect(ci).toContain(`${tolerance}='\${{ github.event_name ==`);
        expect(ci).toContain(`[ "$result" = "skipped" ] && [ "$${tolerance}" != "true" ]`);
      }
    },
  );

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

  it("leaves the corpus untouched — a linter that could edit gate files is a liability", () => {
    const src = readFileSync(join(ROOT, LINTER), "utf8");
    expect(src).not.toMatch(/writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|child_process/);
  });
});
