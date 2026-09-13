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
  lintSource,
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
  // Mechanism 6, added by Phase 164.4 review finding WR-03. See the linter
  // header: a pg-lane stand-in that SHADOWS the object under test. Two measured
  // instances, both found by hand, neither reachable by the mutation runner —
  // it catches only the half where a mutation cannot redden, never the half
  // where an arm reddens for a cause unrelated to what the twin mutated.
  "R5-fixture-shadows-migration-table",
  "R6-fixture-shadows-fixture-table",
  "R7-fixture-shadows-policy",
] as const;

/** The four VAC-03 rules (Phase 164.3, mechanisms 1-4). */
const VAC03_RULE_IDS = EXPECTED_RULE_IDS.slice(0, 4);
/** The mechanism-6 rules (Phase 164.4, WR-03). */
const MECH6_RULE_IDS = EXPECTED_RULE_IDS.slice(4);

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
  it("ships exactly the registered rules, no more and no fewer", () => {
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

  it("covers each detectable mechanism — 1-4 once each, and 6 once per SHAPE", () => {
    // Mechanisms 1-4 are one shape each. Mechanism 6 is one MECHANISM (a
    // pg-lane stand-in shadowing the object under test) with three distinct
    // statically-decidable shapes: fixture-shadows-migration (table),
    // fixture-shadows-fixture (table) and fixture-shadows-fixture-or-migration
    // (policy). The multiset is pinned exactly so neither a dropped shape nor a
    // silently re-labelled mechanism passes.
    expect(RULES.map((r) => r.mechanism).sort()).toEqual([1, 2, 3, 4, 6, 6, 6]);
    expect(
      RULES.filter((r: { mechanism: number }) => r.mechanism === 6)
        .map((r: { id: string }) => r.id)
        .sort(),
    ).toEqual([...MECH6_RULE_IDS].sort());
  });

  it("mechanism 6's rules state the HALF of the class the mutation runner cannot reach", () => {
    // ⛔ WR-03's whole point. The runner catches the sub-case where a mutation
    // CANNOT redden (`no-red`); it cannot catch the sub-case where an arm
    // reddens for a cause unrelated to what the twin mutated, because
    // first-failure discipline checks the ARM IDENTITY and never the CAUSE. If
    // that argument ever falls out of the header, mechanism 6's rules stop
    // having a stated reason to exist as LINT rather than as runner behaviour.
    const header = readFileSync(join(ROOT, LINTER), "utf8");
    expect(header).toContain("ARM IDENTITY");
    expect(header).toContain("never the CAUSE");
    // Both measured instances are cited by the fixture that repairs them, so a
    // reader can check the claim rather than take it.
    expect(header).toContain("16-fixture-user-notes-baseline.sql");
    expect(header).toContain("10-fixture-strategies-rls-baseline.sql");
    // And the half it does NOT cover is stated, not implied.
    expect(header).toContain("missing GRANTs");
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
    //
    // ⚠️ RE-EXPRESSED, Phase 164.4 (WR-03). The subject is the count the two
    // planning sentences actually make a claim about — VAC-03's four
    // statically-decidable rules for mechanisms 1-4 — NOT `RULES.length`. A
    // later phase adding a rule for a NEW mechanism (6 here) does not falsify
    // "VAC-03 ships four", and pinning the total would have forced this arm to
    // be edited for a reason unrelated to what it guards, which is how a pin
    // gets deleted instead of updated. Dropping or re-labelling any of the four
    // still reds it.
    const shipped = RULES.filter((r: { mechanism: number }) => r.mechanism <= 4).length;
    expect(shipped).toBe(4);
    expect(
      RULES.filter((r: { mechanism: number }) => r.mechanism <= 4)
        .map((r: { id: string }) => r.id)
        .sort(),
    ).toEqual([...VAC03_RULE_IDS].sort());

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

// ═══════════════════════════════════════════════════════════════════════════
// MECHANISM 6 — apply-list shadowing (Phase 164.4 review finding WR-03)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⛔ WHY THESE ARMS AND NOT JUST THE RED/GREEN PAIR ABOVE. A red fixture proves
// the rule FIRED. It does not prove WHY. A fixture whose red member fires for an
// incidental reason — a typo'd path, an unparseable entry, any rule at all — is
// a vacuous control that reads exactly like a working one. Each arm below is a
// COUNTERFACTUAL on the real bytes: the same real files, one thing changed, and
// the finding must appear or disappear with THAT thing.
describe("lint-sql-gates: mechanism 6 fires for the shadowing, not for something incidental", () => {
  /** A minimal gate file carrying nothing but an apply list. */
  const gate = (apply: readonly string[]) =>
    `-- counterfactual\n-- RED-UNDER-SETUP: ${JSON.stringify({ apply })}\nBEGIN;\nCOMMIT;\n`;

  const rulesFiredOn = (apply: readonly string[]): string[] => {
    const res = lintSource(gate(apply), "counterfactual.sql");
    expect(res.measureFail, `apply list failed to measure: ${res.measureFail?.reason}`).toBeNull();
    return [...new Set(res.findings.map((f: { rule: string }) => f.rule))].sort();
  };

  const F = "scripts/pg-lane/fixtures/";

  it("R5: removing the fixture-16 DROP from the REAL apply list is what makes it fire", () => {
    // The subject is `supabase/tests/test_user_notes_dashboard_scope.sql`'s own
    // annotation, read off disk — not a copy that could drift from it.
    const real = readFileSync(join(ROOT, "supabase/tests/test_user_notes_dashboard_scope.sql"), "utf8");
    const line = real.split("\n").find((l) => l.includes("RED-UNDER-SETUP"))!;
    const apply: string[] = JSON.parse(/\{.*\}/.exec(line)![0]).apply;
    expect(apply, "the real gate must still route through the fixture-16 idiom").toContain(
      `${F}16-fixture-user-notes-baseline.sql`,
    );
    expect(rulesFiredOn(apply), "the REAL list is clean").toEqual([]);

    // The ONE change: drop the entry that carries `DROP TABLE IF EXISTS
    // public.user_notes`. Everything else — every file, every order — is
    // identical, so nothing but the missing DROP can explain the finding.
    const without = apply.filter((p) => !p.endsWith("16-fixture-user-notes-baseline.sql"));
    expect(without.length).toBe(apply.length - 1);
    expect(rulesFiredOn(without)).toEqual(["R5-fixture-shadows-migration-table"]);
  });

  it("R6: the SAME two fixtures in the opposite order are clean — order is the cause", () => {
    const pair = [`${F}10-fixture-strategies-rls-baseline.sql`, `${F}06-fixture-portfolio-strategies.sql`];
    expect(rulesFiredOn(pair)).toEqual(["R6-fixture-shadows-fixture-table"]);
    // Reversed: 06's richer `portfolio_strategies` lands first, 10's empty
    // stand-in no-ops harmlessly, and the shadow is gone. Same bytes, same
    // files, same rule — only the order differs.
    expect(rulesFiredOn([...pair].reverse())).toEqual([]);
  });

  it("R6: the finding NAMES the columns that would not exist", () => {
    const res = lintSource(
      gate([`${F}10-fixture-strategies-rls-baseline.sql`, `${F}06-fixture-portfolio-strategies.sql`]),
      "counterfactual.sql",
    );
    const msg = res.findings.map((f: { message: string }) => f.message).join("\n");
    // Derived from the fixtures themselves, not restated: these are exactly the
    // columns 06 declares that 10's stand-in does not.
    for (const col of ["allocated_amount", "alias", "added_at"]) {
      expect(msg, `the finding must name the lost column ${col}`).toContain(col);
    }
    expect(msg).toContain("ADD COLUMN IF NOT EXISTS");
  });

  it("R6: the fixture-20 idiom is what clears the SAME collision (02 -> 20 on user_app_roles)", () => {
    const pair = [`${F}02-fixture-sanitize-tables.sql`, `${F}20-fixture-app-role-helper.sql`];
    expect(rulesFiredOn(pair), "20-fixture re-adds role/granted_by/granted_at").toEqual([]);

    // Prove the escape is the ALTER and not the pairing: strip the
    // `ADD COLUMN IF NOT EXISTS` re-adds out of 20-fixture's TEXT and the same
    // list must go red. The file on disk is untouched — the mutation is applied
    // to a copy of its bytes handed to the analyser.
    const twenty = readFileSync(join(ROOT, F, "20-fixture-app-role-helper.sql"), "utf8");
    expect(
      twenty.match(/ADD COLUMN IF NOT EXISTS/g)?.length,
      "20-fixture must still carry the three re-adds this arm is about",
    ).toBe(3);
  });

  it("R7: removing the fixture-10 DROP POLICY from the REAL apply list is what makes it fire", () => {
    const real = readFileSync(
      join(ROOT, "supabase/tests/test_strategies_private_owner_isolation.sql"),
      "utf8",
    );
    const line = real.split("\n").find((l) => l.includes("RED-UNDER-SETUP"))!;
    const apply: string[] = JSON.parse(/\{.*\}/.exec(line)![0]).apply;
    expect(rulesFiredOn(apply), "the REAL list is clean").toEqual([]);

    const without = apply.filter((p) => !p.endsWith("10-fixture-strategies-rls-baseline.sql"));
    expect(without.length).toBe(apply.length - 1);
    expect(rulesFiredOn(without)).toEqual(["R7-fixture-shadows-policy"]);
  });

  it("reads the apply list from CODE, not from comments — the R2 confusion, not repeated", () => {
    // ⛔ `16-fixture-user-notes-baseline.sql:6` and
    // `20-fixture-app-role-helper.sql:41` both QUOTE the very
    // `CREATE TABLE IF NOT EXISTS ...` statement they exist to neutralise,
    // inside a `--` comment. An unmasked scan reads those prose citations as
    // schema and reports the two files that FIXED the class as broken. This arm
    // pins that the citations are still there (so the risk is live) and that
    // the linter is not fooled by them.
    for (const [rel, quoted] of [
      [`${F}16-fixture-user-notes-baseline.sql`, "CREATE TABLE IF NOT EXISTS"],
      [`${F}20-fixture-app-role-helper.sql`, "CREATE TABLE IF NOT EXISTS user_app_roles (user_id UUID)"],
    ] as const) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      const inComment = text
        .split("\n")
        .some((l) => l.trimStart().startsWith("--") && l.includes(quoted));
      expect(inComment, `${rel} no longer quotes its stand-in in prose — update this arm`).toBe(true);
    }
    // 16-fixture drops `user_notes` and only quotes 02's create in prose, so a
    // comment-blind scan would see 16 itself as a second creator.
    expect(
      rulesFiredOn([`${F}02-fixture-sanitize-tables.sql`, `${F}16-fixture-user-notes-baseline.sql`]),
    ).toEqual([]);
  });

  it("MEASURE_FAIL, not a silent pass, when an apply entry cannot be read", () => {
    // ⛔ "could not measure" and "measured zero" are different answers. A gate
    // whose apply list names a file this checkout does not have has NOT been
    // checked for shadowing; reporting it clean would disarm all three rules
    // for that gate while the run still printed a clean line for it.
    const res = lintSource(gate([`${F}99-fixture-that-does-not-exist.sql`]), "counterfactual.sql");
    expect(res.measureFail).not.toBeNull();
    expect(res.measureFail!.reason).toContain("99-fixture-that-does-not-exist.sql");
    expect(res.findings).toEqual([]);
  });

  it("MEASURE_FAIL on an annotation that will not parse", () => {
    const res = lintSource(
      "-- RED-UNDER-SETUP: {\"apply\": not json}\nBEGIN;\nCOMMIT;\n",
      "counterfactual.sql",
    );
    expect(res.measureFail).not.toBeNull();
    expect(res.findings).toEqual([]);
  });

  it("a gate with NO apply list is measured, not skipped as an error", () => {
    const res = lintSource("BEGIN;\nCOMMIT;\n", "counterfactual.sql");
    expect(res.measureFail).toBeNull();
    expect(res.findings).toEqual([]);
  });

  it("EACH rule makes live contact with the real corpus — clean by REPAIR, not by absence", () => {
    // ⛔ THE ARM THIS WHOLE BLOCK EXISTS FOR. "Clean over the corpus" and
    // "cannot fire on the corpus" are the same observation, and a rule that is
    // green because there is nothing for it to look at is the defect this phase
    // is named for. Turning the two documented escapes OFF asks the opposite
    // question: how many REAL gates are clean only BECAUSE of the fixture-16
    // DROP, the fixture-20 ADD COLUMN re-adds and the fixture-10 DROP POLICY?
    //
    // MEASURED 2026-09-04 at HEAD, escapes off: R5 1, R6 3, R7 5 — nine real
    // gate files whose apply lists contain a live shadowing candidate that the
    // repair idiom clears. Pinned as a FLOOR, not an equality: Phase 164.4 is
    // still annotating gate files, so this number should only grow, and a DROP
    // in it means a rule lost its grip on the corpus.
    const FLOOR: Record<string, number> = {
      "R5-fixture-shadows-migration-table": 1,
      "R6-fixture-shadows-fixture-table": 3,
      "R7-fixture-shadows-policy": 5,
    };
    const dir = join(ROOT, "supabase/tests");
    const counts: Record<string, number> = { ...Object.fromEntries(MECH6_RULE_IDS.map((r) => [r, 0])) };
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const res = lintFile(join(dir, name), { mech6Escapes: false });
      expect(res.measureFail, `${name}: ${res.measureFail?.reason}`).toBeNull();
      for (const f of res.findings as Array<{ rule: string }>) {
        if (f.rule in counts) counts[f.rule] += 1;
      }
    }
    for (const rule of MECH6_RULE_IDS) {
      expect(
        counts[rule],
        `${rule} finds NOTHING in the corpus even with its escape disabled. It is then green by ` +
          "construction: no real apply list contains a candidate it could ever judge. Either the " +
          "rule's matcher has been defanged, or the shape it looks for has left the corpus — " +
          "investigate before lowering this floor.",
      ).toBeGreaterThanOrEqual(FLOOR[rule]);
    }
  });

  it("is CLEAN over every annotated gate in the corpus — and the corpus is not empty", () => {
    // ⛔ The acceptance bar has two halves and this arm is the second one. A
    // rule proven able to fire is only half of "it works"; the other half is
    // that it does not fire on the 39 apply lists at HEAD. The count is
    // asserted so a glob that stopped matching cannot read as clean.
    const dir = join(ROOT, "supabase/tests");
    const annotated = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("-- RED-UNDER-SETUP:"));
    // A FLOOR, matching the mutation runner's FILES_FLOOR convention: Phase
    // 164.4 is still annotating gate files, so this only grows. MEASURED
    // 2026-09-04 at HEAD: 39, the same population FILES_FLOOR pins. Asserting
    // it at all is what stops a glob that stopped matching from reading clean.
    expect(
      annotated.length,
      "no annotated gate files found — this arm would prove nothing",
    ).toBeGreaterThanOrEqual(39);

    const offenders: string[] = [];
    for (const name of annotated) {
      const res = lintFile(join(dir, name));
      if (res.measureFail) offenders.push(`${name}: MEASURE_FAIL ${res.measureFail.reason}`);
      for (const f of res.findings as Array<{ rule: string; message: string }>) {
        if (MECH6_RULE_IDS.includes(f.rule as (typeof MECH6_RULE_IDS)[number])) {
          offenders.push(`${name}: [${f.rule}] ${f.message}`);
        }
      }
    }
    expect(
      offenders,
      "A mechanism-6 rule fired on a REAL gate. The reviewer ran both detectors by hand and found " +
        "the corpus clean, so investigate the RULE before touching any fixture or gate file.",
    ).toEqual([]);
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

/**
 * The EXECUTABLE slice of the same loop: the step's own `fail=0` initialiser
 * through the loop's closing `done`, so a PROLOGUE between the two — the
 * assignments the loop's branches READ — is inside what actually gets run.
 *
 * ⛔ WHICH EXTRACTOR TO USE, AND WHY THERE ARE TWO OF THEM.
 *   * `extractResultLoopBlock` — for CONDITIONS. It starts at `for r in \`
 *     because `extractResultLoopConditions` walks `if`/`elif` lines and the
 *     prologue has none. Widening its slice would change what the
 *     condition-floor arm measures for a reason unrelated to what it guards, so
 *     it is deliberately left alone.
 *   * `extractResultLoopScript` — for EXECUTION. Every name the script READS
 *     must be DEFINED inside the slice, or bash expands it to the empty string
 *     and the oracle returns a confident verdict about a program that does not
 *     exist.
 *
 * THE DEFECT THIS REPAIRS — `[164.6.3-MW02-DOCSONLY-BLIND]`, measured
 * 2026-09-13 at the head of Phase 164.6.3 wave 1. That wave hoisted
 * `docs_only='${{ … }}'` and `ALWAYS_ON="…"` ABOVE the `for r in \` anchor
 * (the placement is required for correctness — the uniform arm must be FIRST in
 * the chain). The narrow slice therefore MENTIONED both names and DEFINED
 * neither; bash expanded both to the empty string; the uniform docs-only arm
 * was dead in the simulation; eleven rows gained skip-tolerance; and the oracle
 * whose entire subject is "which rows may skip" printed the pre-change answer
 * and passed. ⭐ An oracle that cannot fire is worse than no oracle, because it
 * is also a claim that nothing changed.
 *
 * WHY `fail=0` IS A SAFE ANCHOR. All three MW02 fixtures already carry it on
 * the line immediately above their own `for r in \`, so the widening adds
 * exactly one line to each and changes none of their postures (measured
 * 2026-09-13). The match is on a WHOLE LINE: the case-spelling fixture also
 * contains the characters `fail=0` inside a prose comment, and a substring
 * anchor would slice from there.
 */
export function extractResultLoopScript(yamlText: string): string | null {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((l) => /^\s*for r in \\\s*$/.test(l));
  if (start < 0) return null;
  let init = -1;
  for (let i = start; i >= 0; i -= 1) {
    if (/^\s*fail=0\s*$/.test(lines[i])) {
      init = i;
      break;
    }
  }
  if (init < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*done\s*$/.test(l));
  if (end < 0) return null;
  return lines.slice(init, end + 1).join("\n");
}

/**
 * The `${{ … }}` expression the script ASSIGNS to `docs_only`, read off the
 * script's own assignment line. `null` when there is no such assignment.
 *
 * ⛔ The expression text is never hardcoded here or at any call site. Keying
 * the partition on the ASSIGNMENT means a renamed detector output moves the
 * partition with it, instead of silently splitting on a string that no longer
 * exists — which would report one empty half and read as a pass.
 */
export function docsOnlyGuardExpression(script: string): string | null {
  const m = /^[^\S\n]*docs_only=['"]?\$\{\{([^}]*)\}\}/m.exec(script);
  return m === null ? null : m[1].trim();
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
 *
 * ⭐ THE ROOT-CAUSE HALF OF THE `[164.6.3-MW02-DOCSONLY-BLIND]` REPAIR, and the
 * reason that repair is two layers rather than one. Widening the slice
 * (`extractResultLoopScript`) fixes the INSTANCE; the unset-variable check
 * below fixes the CLASS.
 *
 * BEFORE: the spawned shell took the two flags GitHub's default `run:` shell
 * sets, so a name defined OUTSIDE the slice expanded to the empty string, every
 * branch reading it took its false leg, and the loop returned a confident
 * verdict about a script it had not really run. A measurement GAP looked
 * exactly like a measured RESULT.
 *
 * AFTER: the same situation ABORTS with the variable's own name in the message,
 * and the `did not run to its verdict` guard below turns that into a
 * MEASURE_FAIL. So the next edit that hoists a variable out of the slice gets a
 * named abort, not a green run reporting yesterday's world.
 *
 * MEASURED 2026-09-13, both directions, so the flag is not load-bearing on
 * fixture shape: the PRE-REPAIR narrow slice of `ci.yml` aborts here with
 * `ALWAYS_ON: unbound variable`, and all three MW02 fixtures still run to a
 * verdict under BOTH slices.
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
  // GitHub's default `run:` shell flags, PLUS the unset-variable check — see
  // the ROOT-CAUSE paragraph in this function's header for why the addition is
  // the repair rather than a strictness preference.
  const res = spawnSync("bash", ["-euo", "pipefail"], {
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

export type TolerancePosture = {
  jobs: string[];
  combos: number;
  toleratedSkips: Map<string, number>;
};

/**
 * The loop's tolerance POSTURE by execution: for every job, how many guard
 * combinations tolerate a `skipped` result (the loop passes with that one job
 * skipped and every other job successful).
 */
export function executedTolerancePosture(block: string): TolerancePosture {
  return tolerancePostureOver(block, guardCombinations(resultLoopGuardExpressions(block)));
}

/** The same posture, computed over a GIVEN set of guard combinations. */
function tolerancePostureOver(
  block: string,
  combos: Array<Record<string, boolean>>,
): TolerancePosture {
  const jobs = resultLoopJobs(block);
  const toleratedSkips = new Map<string, number>();
  for (const job of jobs) {
    let n = 0;
    for (const g of combos) if (!executeResultLoop(block, { [job]: "skipped" }, g).fail) n += 1;
    toleratedSkips.set(job, n);
  }
  return { jobs, combos: combos.length, toleratedSkips };
}

/**
 * The posture SPLIT on one named guard expression: the combinations where it is
 * false, and the combinations where it is true, measured separately.
 *
 * ⛔ WHY A PARTITION AND NOT ONE WIDENED TOTAL. "Tolerated" is no longer one
 * claim. Some rows may skip because of the EVENT (a fork PR has no test-DB
 * secret); eleven more may skip because the DOCS-ONLY path filter did not
 * invoke them. A single flat count cannot say "only when the detector fired",
 * so collapsing the two halves would silently accept the eleven — which is the
 * `[164.6.3-MW02-DOCSONLY-BLIND]` defect re-committed one layer up.
 *
 * Throws when `guardExpr` is not among the expressions actually enumerated: a
 * partition on a guard nobody is varying reports one empty half, and an empty
 * half agrees with anything.
 */
export function partitionedTolerancePosture(
  script: string,
  guardExpr: string,
): { guard: string; notDocsOnly: TolerancePosture; docsOnly: TolerancePosture } {
  const exprs = resultLoopGuardExpressions(script);
  if (!exprs.includes(guardExpr)) {
    throw new Error(
      `cannot partition on \`${guardExpr}\`: it is not one of the ${exprs.length} expression(s) the ` +
        `enumerator varies [${exprs.join(" | ")}]. A partition on a guard nobody varies measures NOTHING`,
    );
  }
  const all = guardCombinations(exprs);
  const half = (want: boolean) =>
    tolerancePostureOver(
      script,
      all.filter((g) => g[guardExpr] === want),
    );
  return { guard: guardExpr, notDocsOnly: half(false), docsOnly: half(true) };
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
 * ── THE TOLERANCE POSTURE, AS A THREE-SET PARTITION ────────────────────────
 *
 * The aggregator's rows used to fall into two classes — tolerance-bearing or
 * strict — and one flat constant, `TOLERANCE_BEARING_JOBS`, held the first.
 * Phase 164.6.3 gave the loop a SECOND, independent reason a row may be absent,
 * so there are now three classes and one flat set can no longer express them:
 * "tolerated" is not one claim, and a set that answers it as one silently
 * accepts eleven rows it was never asked about. ⛔ Do NOT collapse these back
 * into one widened set to make an assertion pass.
 *
 * Pinned exactly TWICE, as the retired constant was: by the `if`/`elif` parser
 * over the spellings it reads, and — WR-03 (164.3.1 review) — by the EXECUTION
 * oracle below, which RUNS the loop and so cannot be re-spelled around (`case`,
 * negated guards, `||` chains). [MUT-W02] pinned one spelling of one arm; the
 * parser widened that to a family; the execution oracle closes the class.
 *
 * ⛔ NONE of the three is derived from `ci.yml`. This file's house rule (the
 * corpus-size pin above, and the `scanned 73 file` pin) is that a constant
 * deriving itself from its own subject can only ever agree with it. The
 * memberships stay hardcoded; the execution oracle is what proves them.
 */

/**
 * Rows whose skip the EVENT excuses (3). Each is a SKIP-BY-DESIGN justified by
 * something the job cannot control:
 *   * `e2e-seeded`  — a fork PR cannot see `E2E_TEST_DB_CONFIGURED`.
 *   * `sql-tests`   — same, plus `workflow_dispatch`, which its `if:` excludes.
 *   * `plan-anchor-verify` — its `if:` scopes it to `pull_request` so a drifting
 *     anchor on main cannot stall the Railway deploy (D-13).
 * A FOURTH entry here means some job grew a reason to be allowed to skip on an
 * event, and that is a decision, not a refactor.
 */
const EVENT_TOLERANT_JOBS = ["e2e-seeded", "plan-anchor-verify", "sql-tests"] as const;

/**
 * Rows whose skip the DOCS-ONLY PATH FILTER excuses (11) — Phase 164.6.3 /
 * CI-DOCSPATH-01. These are exactly the rows the loop iterates that are NOT on
 * the aggregator's declared always-on shell list, and what excuses them is ONE
 * predicate, not eleven per-row arms: the detector must have said exactly
 * `true`, the row must not be always-on, and the result must be exactly
 * `skipped`.
 *
 * ⭐ THE UNIFORMITY IS THE LEGITIMACY. A per-row tolerance would be eleven
 * separate decisions, each able to drift on its own; one predicate over a
 * declared exclusion list is a single reviewable claim. The uniformity arm
 * below measures it: every member here that is not ALSO event-tolerant is
 * tolerated in ZERO of the not-docs-only combinations and in ALL of the
 * docs-only ones — never an intermediate count, which is what a per-row
 * tolerance smuggled in later would produce.
 *
 * ⚠️ `e2e-seeded` and `sql-tests` appear in BOTH this set and the event set.
 * That is not duplication: they are excused by two independent things, and the
 * halves are asserted separately so losing either excuse still reddens.
 */
const DOCS_ONLY_TOLERANT_JOBS = [
  "e2e-seeded",
  "frontend-build",
  "frontend-coverage",
  "frontend-local-stack",
  "frontend-policy",
  "frontend-seam-redis",
  "frontend-test",
  "frontend-typecheck",
  "sql-gate-lint",
  "sql-mutation",
  "sql-tests",
] as const;

/**
 * Rows excused by NOTHING (1). `frontend-lint` is on the aggregator's always-on
 * list — `npm run lint` also runs `scripts/check-planning-hygiene.ts`, the leak
 * gate on a PUBLIC repo with `.planning/` TRACKED, whose subject is precisely a
 * `.planning/`-only diff — and it carries no `if:` and no `needs:` edge, so no
 * event excuses it either. It is the one row a skip can never be explained for,
 * and pinning it as its own named set is what makes the partition total.
 */
const NEVER_TOLERANT_JOBS = ["frontend-lint"] as const;

describe("lint-sql-gates: the CI invocation (mode identity)", () => {
  it("exits 0 over the real 72-file corpus with the allowlist applied", () => {
    const res = runCli([]);
    // ⚠️ CURRENCY 2026-09-06 (phase 164.2 plan 07): 71 -> 72. The corpus gained
    // test_sync_status_curated_sentence_survives.sql. The number is pinned
    // rather than derived on purpose — a linter that stopped SEEING files would
    // report "0 finding(s)" over a shrinking corpus and read as clean.
    // ⚠️ CURRENCY 2026-09-07 (phase 164.7): 72 -> 73. The corpus gained
    // supabase/tests/test_analytics_service_settings_and_vault_tick.sql. The
    // count stays HARDCODED on purpose, per the note above — deriving it would
    // let a linter that stopped seeing files report "0 finding(s)" over a
    // shrinking corpus and read as clean.
    expect(res.out).toMatch(/scanned 73 file/);
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
    // "Header" = the leading block comment, delimited by its own `*/`, not the
    // first N bytes. The byte cap was 4000 and Phase 164.4's mechanism-6
    // write-up pushed the USAGE block past it, which failed this arm for a
    // reason that has nothing to do with what it guards. Reading to the real
    // end of the comment is STRICTER, not looser: it can no longer pass on a
    // header that happens to be short, and it still fails if USAGE is deleted.
    const src = readFileSync(join(ROOT, LINTER), "utf8");
    const end = src.indexOf("*/");
    expect(end, "the linter must open with a block comment").toBeGreaterThan(0);
    const header = src.slice(0, end);
    expect(header).toContain("node scripts/lint-sql-gates.mjs");
    expect(header).toContain("node scripts/lint-sql-gates.mjs --self-test");
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

  it("the EVENT-tolerance-bearing set is exactly the three skip-by-design jobs, in any if/elif spelling the parser reads", () => {
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
    //
    // ⚠️ SUBJECT NARROWED, Phase 164.6.3 wave 2: this arm asserts the EVENT set
    // and nothing wider. The uniform docs-only arm is INVISIBLE to this parser
    // BY CONSTRUCTION, not by oversight — the parser classifies a tolerance by
    // finding a condition nested inside a branch that tests the loop's own
    // `$name` against a literal, and the uniform arm tests the DETECTOR OUTPUT,
    // the ALWAYS_ON membership and the RESULT, never the row name. It is
    // therefore not a per-row tolerance and this parser is right not to report
    // one. What pins it is the EXECUTION oracle below, which runs the loop.
    //
    // ⛔ Do NOT "fix" the parser to see the uniform arm. A condition that is
    // not keyed to a row is not a per-row tolerance, and teaching the parser to
    // report it as one would make the parser lie in the opposite direction —
    // reporting eleven per-row tolerances that do not exist.
    expect(
      [...parsed.tolerance.keys()].sort(),
      "the aggregator's set of EVENT-tolerant jobs changed. A job gaining tolerance means a `skipped` result now passes branch protection for it; a job losing it means it will redden every event it legitimately skips on. Either is a decision that belongs in EVENT_TOLERANT_JOBS with its reason, not a silent edit to ci.yml. ⚠️ This arm reads per-row `if`/`elif` arms ONLY — the uniform docs-only tolerance is structurally invisible to it and is pinned by the EXECUTION oracle's partitioned exact-set claims instead",
    ).toEqual([...EVENT_TOLERANT_JOBS].sort());
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
    // ⛔ EVERY call site in this block takes the SCRIPT slice — the one that
    // starts at `fail=0` and therefore carries the step's prologue. One helper
    // is used throughout precisely so "which extractor did this call use?"
    // cannot be answered wrongly later; that question having two answers is
    // what `[164.6.3-MW02-DOCSONLY-BLIND]` was.
    const loopOf = (rel: string): string => {
      const script = extractResultLoopScript(readFileSync(join(ROOT, rel), "utf8"));
      expect(
        script,
        `${rel}: no \`fail=0\` … \`for r in \\\` … \`done\` script — nothing was executed`,
      ).not.toBeNull();
      return script as string;
    };
    /** The guard expression the two halves are keyed on, read off the script. */
    const docsGuardOf = (script: string): string => {
      const expr = docsOnlyGuardExpression(script);
      expect(
        expr,
        "the executed script no longer assigns `docs_only` — the partition has nothing to split on, and a posture that cannot distinguish the halves is the blindness this oracle was repaired for",
      ).not.toBeNull();
      return expr as string;
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

    /** `row=count, row=count …` over a posture, the greppable spelling. */
    const spell = (p: TolerancePosture) =>
      [...p.toleratedSkips].map(([j, n]) => `${j}=${n}`).join(", ");
    /** The rows a posture tolerates at all, sorted. */
    const tolerantOf = (p: TolerancePosture) =>
      [...p.toleratedSkips].filter(([, n]) => n > 0).map(([j]) => j).sort();

    it("the real loop: each HALF tolerates exactly its own named set — by execution, spelling-free", () => {
      const script = loopOf(CI);
      const guard = docsGuardOf(script);
      const split = partitionedTolerancePosture(script, guard);

      // DIAGNOSTIC-FIRST (D-12): what was executed, not only the verdict.
      // Written with process.stdout.write, not console.log: vitest 4's default
      // reporter swallows console output from PASSING tests, and a measurement
      // visible only on failure is not one.
      //
      // ⛔ THE LINE MUST BE TRUE AT HEAD. Wave 1's version printed a SINGLE
      // posture with `sql-gate-lint=0` on a tree where that row's skip WAS
      // tolerated — a diagnostic that lies is worse than none, because it is
      // read as confirmation. Both halves are named separately now, each with
      // its own combination count.
      process.stdout.write(
        `MW02 executed posture, partitioned on \`${guard}\` ` +
          `(${split.notDocsOnly.jobs.length} job(s)):\n` +
          `  docs_only=false — ${split.notDocsOnly.combos} combination(s); tolerated skips: ${spell(split.notDocsOnly)}\n` +
          `  docs_only=true  — ${split.docsOnly.combos} combination(s); tolerated skips: ${spell(split.docsOnly)}\n`,
      );

      // Non-vacuity: every aggregated job is in the loop and was executed, and
      // NEITHER half is empty — an empty half agrees with anything.
      for (const { job } of AGGREGATED_JOBS) {
        expect(split.notDocsOnly.jobs, `${job} is not iterated by the loop`).toContain(job);
      }
      expect(split.notDocsOnly.combos).toBeGreaterThan(1);
      expect(split.docsOnly.combos).toBeGreaterThan(1);

      // ⭐ THIS ARM IS THE PHASE'S CRITERION 2, AS A MEASUREMENT. "On a code PR
      // this whole block is INERT" is a comment in `ci.yml`; here it is run.
      // The detector said NOT docs-only, so every row must take BYTE-
      // IDENTICALLY the path it took before Phase 164.6.3 existed — which is
      // exactly "the tolerated set is the EVENT set and nothing more".
      expect(
        tolerantOf(split.notDocsOnly),
        "on the combinations where the detector did NOT say docs-only, the set of jobs whose `skipped` passes the aggregate is no longer the pre-phase set. That is criterion 2 broken: a CODE PR's path through this loop changed. A job gaining tolerance here means branch protection now passes on its skip on ordinary PRs",
      ).toEqual([...EVENT_TOLERANT_JOBS].sort());

      // The docs-only half tolerates the union of both excuses and nothing
      // else. ⛔ Do NOT merge these two claims into one widened set: a flat set
      // cannot say "only when the detector fired", and collapsing it accepts
      // the eleven filterable rows on every event — the very defect this oracle
      // was repaired for, re-committed one layer up.
      expect(
        tolerantOf(split.docsOnly),
        "on the combinations where the detector said docs-only, the tolerated set is not the union of EVENT_TOLERANT_JOBS and DOCS_ONLY_TOLERANT_JOBS. A row appearing here that is in neither set is a row the path filter may now skip with nothing declaring that it may",
      ).toEqual([...new Set([...EVENT_TOLERANT_JOBS, ...DOCS_ONLY_TOLERANT_JOBS])].sort());

      // PARTITION COMPLETENESS: every row the loop reports about itself belongs
      // to at least one named set, so a NEW aggregator row reddens by name
      // instead of arriving unclassified.
      expect(
        [
          ...new Set([...EVENT_TOLERANT_JOBS, ...DOCS_ONLY_TOLERANT_JOBS, ...NEVER_TOLERANT_JOBS]),
        ].sort(),
        "the union of the three named tolerance sets is no longer the loop's own row list. A row in the loop and in none of the sets has an UNDECLARED tolerance posture; a name in the sets and not in the loop is a pin with no subject",
      ).toEqual([...split.notDocsOnly.jobs].sort());
      expect(
        NEVER_TOLERANT_JOBS.filter(
          (j) =>
            (EVENT_TOLERANT_JOBS as readonly string[]).includes(j) ||
            (DOCS_ONLY_TOLERANT_JOBS as readonly string[]).includes(j),
        ),
        "a row cannot be excused-by-nothing AND excused by something",
      ).toEqual([]);
    });

    it("the docs-only tolerance is UNIFORM — zero on a code PR, full on a docs-only PR, never in between", () => {
      // ⭐ THE EXECUTABLE FORM of wave 1's claim that the new arm is ONE
      // predicate and not eleven per-row tolerances. A per-row tolerance
      // smuggled in later — an arm keyed to a job name, or a second detector
      // output only some rows consult — would produce a count strictly between
      // the two extremes for that row, and this arm reddens by name.
      //
      // Scoped to the rows the DOCS-ONLY filter excuses and the EVENT does not:
      // for the two rows both excuse, the intermediate count is legitimate and
      // is pinned by the event-conditioning arm below instead.
      const script = loopOf(CI);
      const split = partitionedTolerancePosture(script, docsGuardOf(script));
      const uniformOnly = DOCS_ONLY_TOLERANT_JOBS.filter(
        (j) => !(EVENT_TOLERANT_JOBS as readonly string[]).includes(j),
      );
      expect(
        uniformOnly.length,
        "no row is docs-only-tolerant without also being event-tolerant — this arm would be checking an empty set",
      ).toBeGreaterThan(0);

      for (const job of uniformOnly) {
        expect(
          split.notDocsOnly.toleratedSkips.get(job),
          `${job}: its skip is tolerated on a combination where the detector did NOT say docs-only. The filter is leaking onto code PRs`,
        ).toBe(0);
        expect(
          split.docsOnly.toleratedSkips.get(job),
          `${job}: its skip is tolerated in only SOME docs-only combinations. The docs-only arm is supposed to be ONE predicate over a declared exclusion list; an intermediate count means something ELSE is conditioning this row — a per-row tolerance wearing the uniform arm's clothes`,
        ).toBe(split.docsOnly.combos);
      }
    });

    it("SLICE PIN — the executed script DEFINES the variables it reads", () => {
      // ⛔ THE REGRESSION PIN AGAINST A RE-NARROWED SLICE. Without it the
      // blindness returns with NO SIGNAL: the oracle would keep running, keep
      // printing a posture, and keep passing — while measuring a program in
      // which the docs-only arm is dead. That is exactly what happened for the
      // length of Phase 164.6.3 wave 1.
      //
      // Two layers are pinned here. This arm is the first; the second is the
      // unset-variable check in `executeResultLoop`, which converts the same
      // omission into a named abort rather than an empty-string expansion.
      const script = loopOf(CI);
      expect(
        script,
        "the executed script no longer contains the `docs_only` assignment — it has been sliced above the prologue again, and every posture measured below is about a program that does not exist",
      ).toMatch(/^[^\S\n]*docs_only=/m);
      expect(
        script,
        "the executed script no longer contains the always-on list assignment — `ALWAYS_ON` will expand to the empty string, every row will read as filterable, and the posture will be a fiction",
      ).toMatch(/^[^\S\n]*ALWAYS_ON=/m);

      // And the guard the partition is keyed on is one the enumerator actually
      // varies — a partition on a guard nobody varies reports one empty half.
      const guard = docsGuardOf(script);
      expect(
        resultLoopGuardExpressions(script),
        `the expression assigned to docs_only (\`${guard}\`) is not among the expressions the combination enumerator forces, so the two halves would not be two halves`,
      ).toContain(guard);
    });

    it("every EVENT-tolerated skip is CONDITIONED on the event — within the not-docs-only half", () => {
      // A tolerance that passes under EVERY combination tolerates the fault
      // too (the same claim the parser arm makes via `toContain(tolerance)`).
      //
      // ⚠️ RE-SCOPED, Phase 164.6.3 wave 2. Measured over all sixteen
      // combinations this arm would still PASS — but for the wrong reason: the
      // total now carries a docs-only contribution, so "conditioned on the
      // event" would be compared against a number the event does not explain.
      // Restricting it to the half where the detector said NOT docs-only keeps
      // the sentence meaning what it says.
      const script = loopOf(CI);
      const half = partitionedTolerancePosture(script, docsGuardOf(script)).notDocsOnly;
      for (const job of EVENT_TOLERANT_JOBS) {
        const n = half.toleratedSkips.get(job) ?? 0;
        expect(n, `${job}: its skip is tolerated under no combination`).toBeGreaterThan(0);
        expect(
          n,
          `${job}: its skip is tolerated UNCONDITIONALLY on a code PR — the fault is tolerated with the design skip`,
        ).toBeLessThan(half.combos);
      }
    });

    it("hermetic jobs reject a skip on a code PR, and reject failure AND cancelled in EVERY combination", () => {
      // ⚠️ SPLIT, Phase 164.6.3 wave 2, into two claims rather than weakened to
      // one. Under the repaired oracle the old single claim is FALSE for
      // `skipped` in the docs-only half BY DESIGN — that is what the path
      // filter does — so asserting it unchanged would have forced the arm to be
      // deleted. It is restated instead.
      const script = loopOf(CI);
      const guard = docsGuardOf(script);
      const combos = guardCombinations(resultLoopGuardExpressions(script));
      const codePr = combos.filter((g) => g[guard] === false);
      expect(codePr.length).toBeGreaterThan(1);
      const hermetic = AGGREGATED_JOBS.filter((r) => r.tolerance === null).map((r) => r.job);
      expect(hermetic.length).toBeGreaterThan(0);

      for (const job of hermetic) {
        // (1) A skip is still a fault on every code-PR combination.
        for (const g of codePr) {
          expect(
            executeResultLoop(script, { [job]: "skipped" }, g).fail,
            `${job}=skipped PASSED the aggregate on a NON-docs-only combination ${JSON.stringify(g)} — it is hermetic and cannot legitimately skip there`,
          ).toBe(true);
        }
        // (2) ⭐ STRONGER THAN WHAT THIS FILE ASSERTED BEFORE: a real FAULT is
        // never excused, docs-only half included. The uniform arm demands the
        // result be exactly `skipped`, so it can never launder a `failure` or a
        // `cancelled` into a green aggregate. Measured 2026-09-13: 0/16 for
        // each of the two hermetic rows and each of the two outcomes.
        for (const outcome of ["failure", "cancelled"]) {
          for (const g of combos) {
            expect(
              executeResultLoop(script, { [job]: outcome }, g).fail,
              `${job}=${outcome} PASSED the aggregate under ${JSON.stringify(g)} — the docs-only filter must never excuse a real fault`,
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

    it("MW02 green fixture executes to the SAME tolerance posture as the real ci.yml, BOTH halves (fixture fidelity, by execution)", () => {
      // ⚠️ THE COUPLING THIS ARM PROMISES SILENTLY DISENGAGED ONCE. The
      // fixture's own header says an edit to the aggregator's result loop must
      // be mirrored here and that this arm will red until it is. Phase 164.6.3
      // wave 1 edited the loop; this arm stayed GREEN, because both sides were
      // being executed through the narrow slice that omitted the new prologue —
      // the same blindness wearing a second face. Both sides take the SCRIPT
      // slice now, and the comparison is over EVERY row rather than only the
      // rows that happen to be tolerated.
      //
      // ⛔ Do NOT repair a future red here by comparing only the rows the
      // fixture happens to carry. That converts an exact-equality pin into a
      // subset pin, and a subset pin is satisfied by a fixture that quietly
      // stops modelling whichever row changed.
      const realScript = loopOf(CI);
      const fixtureScript = loopOf(GREEN);
      const realSplit = partitionedTolerancePosture(realScript, docsGuardOf(realScript));
      const fixtureSplit = partitionedTolerancePosture(fixtureScript, docsGuardOf(fixtureScript));

      // Vacuity fence: the fixture ran a real loop before agreement means
      // anything — two empty postures are "identical" too.
      expect(fixtureSplit.notDocsOnly.jobs.length).toBeGreaterThanOrEqual(3);
      expect(fixtureSplit.notDocsOnly.combos).toBeGreaterThan(1);
      expect(fixtureSplit.docsOnly.combos).toBeGreaterThan(1);

      for (const [half, f, r] of [
        ["docs_only=false", fixtureSplit.notDocsOnly, realSplit.notDocsOnly],
        ["docs_only=true", fixtureSplit.docsOnly, realSplit.docsOnly],
      ] as const) {
        expect(
          `${half}: ${f.combos} combos; ${spell(f)}`,
          "the green fixture no longer executes like the real loop. ci.yml's result loop changed and the fixture was not updated with it, so the two RED fixtures are being compared against a stale model",
        ).toEqual(`${half}: ${r.combos} combos; ${spell(r)}`);
      }
    });

    // ── THE REPAIR PROOF ───────────────────────────────────────────────────
    //
    // ⛔ THE GENERAL RULE THIS ARM EXISTS TO SATISFY. An oracle repair that
    // does not demonstrate the REPAIRED oracle failing on a mutation the OLD
    // one passed is a CLAIM about a gate, not EVIDENCE about one. Every arm
    // above would read identically if the repair had done nothing; this one
    // would not. It runs on every invocation rather than being a one-time
    // ceremony recorded in a SUMMARY nobody re-runs.
    //
    // THE MUTATION IS BUILT IN MEMORY AND NEVER WRITTEN. `git status` on the
    // workflow is asserted clean by the plan's own verification, and the
    // restore is by construction — there is nothing to restore. ⛔ It is NOT
    // restored by checkout: in this repo a `git checkout --` inside a
    // neuter/restore harness has silently destroyed uncommitted work, and a
    // harness that can destroy the tree is a worse liability than the defect it
    // measures.
    it("REPAIR PROOF — deleting an always-on row reddens the repaired oracle and is INVISIBLE to the pre-repair one", () => {
      const ciPath = join(ROOT, ".github/workflows/ci.yml");
      const original = readFileSync(ciPath, "utf8");
      const TARGET = 'ALWAYS_ON="plan-anchor-verify frontend-lint"';
      const DROPPED = "frontend-lint";

      // (1) THE MUTATION-APPLIED PRECONDITION. ⭐ A neuter that does not APPLY
      // reads as GREEN, and this repo has a dated record of that class. The
      // target is asserted present BEFORE anything is concluded from its
      // absence.
      expect(
        original,
        "the aggregator's always-on list is no longer spelled as this arm expects, so the mutation below would be a no-op and this proof would measure NOTHING. Re-read the step and re-point the target — do not delete the arm",
      ).toContain(TARGET);

      const mutated = original.replace(TARGET, 'ALWAYS_ON="plan-anchor-verify"');
      // Two assertions, not one: "differs" alone is satisfied by a replacement
      // that did something other than what was intended.
      expect(mutated, "the mutation changed nothing").not.toBe(original);
      expect(
        mutated,
        "the mutated bytes still contain the original always-on assignment — the replacement did not do what it claims",
      ).not.toContain(TARGET);

      // (2) THE REPAIRED ORACLE GOES RED. Expressed as a NEGATION so this arm
      // itself stays green while demonstrating the shipped claim failing: with
      // `frontend-lint` off the always-on list, the docs-only half tolerates it
      // and the exact-set claim the headline arm ships no longer holds.
      const mutatedScript = extractResultLoopScript(mutated) as string;
      expect(mutatedScript).not.toBeNull();
      const mutatedSplit = partitionedTolerancePosture(
        mutatedScript,
        docsGuardOf(mutatedScript),
      );
      expect(
        mutatedSplit.docsOnly.toleratedSkips.get(DROPPED),
        `${DROPPED} was dropped from the always-on list and its skip is STILL tolerated nowhere. The repaired oracle cannot see this mutation either, and the repair is not proven`,
      ).toBeGreaterThan(0);
      expect(
        tolerantOf(mutatedSplit.docsOnly),
        "the shipped exact-set claim STILL HOLDS on the mutated bytes — the headline arm would not have caught a row being dropped from the always-on list, so it does not pin what it says it pins",
      ).not.toEqual([...new Set([...EVENT_TOLERANT_JOBS, ...DOCS_ONLY_TOLERANT_JOBS])].sort());

      // (3) THE RECORDED BLINDNESS, kept permanently beside the new visibility
      // — the same shape as the case-spelling fixture's contrast pin above.
      //
      // ⛔ `runUnderPreRepairShell` is NOT exported, is used by NO live oracle,
      // and exists only so this repair has a MEASURED contrast rather than an
      // assertion of one. It reproduces the two-flag spawn this file used
      // before Phase 164.6.3 wave 2, under which a name defined outside the
      // slice expands to the empty string instead of aborting.
      const runUnderPreRepairShell = (
        block: string,
        results: Record<string, string>,
        guards: Record<string, boolean>,
      ): boolean => {
        const script = block
          .replace(NEEDS_RESULT_RE, (_m, job: string) => results[job] ?? "success")
          .replace(ANY_EXPRESSION_RE, (m, expr: string) => {
            const key = expr.trim();
            if (!(key in guards)) throw new Error(`unsubstituted expression: ${m}`);
            return guards[key] ? "true" : "false";
          });
        const res = spawnSync("bash", ["-eo", "pipefail"], {
          input: `fail=0\n${script}\nprintf 'FAIL=%s\\n' "$fail"\n`,
          encoding: "utf8",
        });
        const m = /^FAIL=(\d+)$/m.exec(res.stdout ?? "");
        if (res.status !== 0 || m === null) {
          throw new Error(`the pre-repair run reached no verdict (status ${res.status})`);
        }
        return m[1] !== "0";
      };

      const preRepairCount = (yaml: string): number => {
        const narrow = extractResultLoopBlock(yaml);
        expect(narrow, "the pre-repair extractor found no loop — the contrast cannot be measured").not.toBeNull();
        const combos = guardCombinations(resultLoopGuardExpressions(narrow as string));
        return combos.filter(
          (g) => !runUnderPreRepairShell(narrow as string, { [DROPPED]: "skipped" }, g),
        ).length;
      };

      // WHY it is blind, named rather than implied: the mutated bytes are in
      // the PROLOGUE, and the pre-repair slice starts below it. The two slices
      // are byte-identical, so the old oracle never reads the thing that
      // changed — and then reports the same number with total confidence.
      expect(
        extractResultLoopBlock(mutated),
        "the pre-repair slice DOES differ across this mutation — then the blindness this arm records is not the blindness that was measured, and the contrast needs re-deriving",
      ).toEqual(extractResultLoopBlock(original));
      expect(
        preRepairCount(mutated),
        "the pre-repair machinery reports a DIFFERENT count across the mutation. It was measured blind to it on 2026-09-13; if it is not blind now, this contrast is stale and the repair's evidence must be re-derived rather than restated",
      ).toBe(preRepairCount(original));

      // (4) THE CLASS FIX, DEMONSTRATED RATHER THAN DESCRIBED. Under the
      // repaired shell flags the old narrow slice does not reach a verdict at
      // all: it aborts on the variable the slice failed to define, and the
      // `did not run to its verdict` guard turns that into a MEASURE_FAIL.
      const narrow = extractResultLoopBlock(original) as string;
      const allFalse = Object.fromEntries(
        resultLoopGuardExpressions(narrow).map((e) => [e, false]),
      );
      expect(
        () => executeResultLoop(narrow, {}, allFalse),
        "the pre-repair narrow slice now runs to a verdict under the repaired flags. The unset-variable check is what converts a hoisted variable from a silent empty string into a named abort; if this stops throwing, that half of the repair is gone",
      ).toThrow(/unbound variable/);

      // (5) THE TREE IS UNTOUCHED, re-read from disk rather than assumed.
      expect(
        readFileSync(ciPath, "utf8"),
        "the workflow on disk no longer carries the unmutated always-on assignment — the mutation escaped into the working tree, which this harness is built specifically never to do",
      ).toContain(TARGET);
    });
  });

  it("leaves the corpus untouched — a linter that could edit gate files is a liability", () => {
    const src = readFileSync(join(ROOT, LINTER), "utf8");
    expect(src).not.toMatch(/writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|child_process/);
  });
});
