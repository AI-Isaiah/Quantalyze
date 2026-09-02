/**
 * Phase 164.3.1 plan 12 — the gate family's META checks (SC-1, SC-7, SC-9).
 *
 * Three machine checks over the family of gates this phase made sound:
 *
 *   1. INSTANCE → ARM REGISTRY (SC-1). Every measured instance in the phase
 *      taxonomy — the fifteen IDs in PHASE_TAXONOMY below — is bound to a named
 *      arm in a named file. The check reads each file's bytes and asserts the
 *      arm's distinctive name is there; a renamed or deleted arm fails BY
 *      INSTANCE NAME, and an instance added to the taxonomy without a registry
 *      entry (or an entry without an instance) fails the exact set. This is the
 *      corpus's anti-decay gate: "every measured instance is an executable arm"
 *      as a machine-checked invariant rather than a sentence in a SUMMARY.
 *
 *   2. DIAGNOSTIC-FIRST meta-arm (SC-7, D-12). Over the family's SHELL gates —
 *      whose only interface is what they print — every failure emission must
 *      carry at least one runtime-interpolated value. A gate in this family
 *      cannot ship a bare conclusion. Exceptions are an exact-set allowlist,
 *      each with its justification.
 *
 *   3. BARE-MEASUREMENT audit meta-arm (SC-9, D-10). Every threshold the family
 *      carries — FLOOR/MIN constants and the literal comparisons inside its
 *      absurdity blocks — must have a measured justification (a measurement
 *      token AND a date) beside it. Criterion 9's grep, executed as a permanent
 *      arm, with a non-vacuity floor on the number of thresholds it found.
 *
 * ── WHAT THIS FILE DOES AND DOES NOT CHECK, stated rather than implied ──────
 * The registry binds NAMES to FILES so the corpus cannot decay silently. It does
 * NOT re-prove that the arms fail: the recursive neuter→RED→restore proofs live
 * in the committed records each entry cites (plans 04/06/07/08's SUMMARY
 * evidence blocks, 164.3.1-11-CORPUS-PROOFS.md, 164.3.1-12-CORPUS-PROOFS.md).
 * A needle present in a file proves the arm still EXISTS under that name; it
 * does not prove the arm still bites — that is the job of the arm itself and
 * of the CI job that runs it.
 *
 * Both meta-arms are deliberately STRUCTURAL. They check emission SHAPE (a
 * shell expansion present in the emitted text; a measurement token and a date
 * near the threshold), not runtime truth. A gate can interpolate the wrong
 * variable, and a comment can carry a date beside a number that was never
 * measured; neither predicate can tell. The runtime half — that the printed
 * quantity is the one the verdict rests on, that the threshold separates the
 * measured fires-shape from the measured silent-shape — lives in the per-gate
 * DRIVEN arms the registry binds (VAC08-253, VAC04-C1, the VAC-04 and runner
 * absurdity-floor fire/silent pairs). The two halves are complementary and
 * neither claims the other's ground.
 *
 * All reads go through node:fs. Never shell grep: this repo carries a MEASURED
 * NUL-blind test file (src/lib/wizardErrors.test.ts:1572), where grep's exit 1
 * reads as "clean".
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE INSTANCE → ARM REGISTRY (SC-1)
// ═══════════════════════════════════════════════════════════════════════════

export type Primitive = "A" | "B" | "C" | "D";

/**
 * The phase taxonomy — every MEASURED instance, by primitive. Declared apart
 * from the registry so the two can be compared as sets in both directions.
 *
 * SOURCE: 164.3.1-CONTEXT.md § Phase Boundary (the four primitives and their
 * measured members) and 164.3.1-12-PLAN.md § must_haves (the fifteen IDs as
 * the corpus-completeness set). Adding an instance here without a registry
 * entry, or an entry without an instance here, fails below by name.
 */
export const PHASE_TAXONOMY: ReadonlyArray<{ instance: string; primitive: Primitive }> = [
  // A — an accepted neuter leaves privileged state live
  { instance: "R4-C01/P3", primitive: "A" },
  { instance: "MUT-I01-P4", primitive: "A" },
  { instance: "MUT-I01-P5", primitive: "A" },
  // B — an arm counts toward `biting` without executing
  { instance: "R4-C02", primitive: "B" },
  { instance: "NESTED-EXECUTE", primitive: "B" },
  // C — a verdict not bounded by what was measured, in either direction
  { instance: "VAC04-C1", primitive: "C" },
  { instance: "VAC04-C2", primitive: "C" },
  { instance: "VAC04-C3", primitive: "C" },
  { instance: "VAC04-C4", primitive: "C" },
  { instance: "VAC08-253", primitive: "C" },
  { instance: "VAC08-JOIN", primitive: "C" },
  // D — a control whose own oracle or fixture agrees with it by construction
  { instance: "VAC-SELFREF-01", primitive: "D" },
  { instance: "SP-C04", primitive: "D" },
  { instance: "AUDCOV-01", primitive: "D" },
  { instance: "MUT-W02", primitive: "D" },
];

export type RegistryEntry = {
  instance: string;
  primitive: Primitive;
  /** Repo-relative file holding the arm. */
  file: string;
  /** A distinctive substring of the arm's NAME — a test title, a scenario
   *  header, or a describe title — quoted from the file's bytes. */
  armNeedle: string;
  /** Further (file, needle) bindings for the same instance — e.g. the unit
   *  arm beside the lane-driven scenario. Each must resolve. */
  also?: ReadonlyArray<{ file: string; needle: string }>;
  /** A fixture file the arm reads; checked with existsSync. */
  fixture?: string;
  /** Which plan shipped the arm, and which committed record proves it can
   *  fail. The registry does not re-prove; it cites. */
  citation: string;
};

/**
 * Needle values were populated by READING each target file and quoting a
 * stable, distinctive string — never by guessing a title. Each occurs in its
 * file's bytes at HEAD (measured 2026-09-02; the check below re-measures on
 * every run).
 */
export const INSTANCE_ARM_REGISTRY: ReadonlyArray<RegistryEntry> = [
  // ── Primitive A ────────────────────────────────────────────────────────
  {
    instance: "R4-C01/P3",
    primitive: "A",
    file: "scripts/mutation-runner/run.mjs",
    armNeedle: "SELF-TEST 9/12: [R4-C01] the P3 compound HEAD must be REFUSED",
    also: [
      {
        file: "src/__tests__/mutation-runner-neuter.test.ts",
        needle: "P3: `SET ROLE postgres; IF NOT ok THEN` can no longer produce an accepted neuter",
      },
    ],
    fixture: "scripts/mutation-runner/fixtures/selftest/compound-head-gate.sql",
    // Shipped by plan 11 (lane-driven scenario 9/12) over plan 01's tokenizer;
    // RED under neuter N1 in 164.3.1-11-CORPUS-PROOFS.md §2.
    citation: "164.3.1-11 (scenario 9/12) + 164.3.1-01 (unit arm); proof: 164.3.1-11-CORPUS-PROOFS.md §2 (N1)",
  },
  {
    instance: "MUT-I01-P4",
    primitive: "A",
    file: "scripts/mutation-runner/run.mjs",
    armNeedle: "neither refuse the neuter (P4)",
    also: [
      {
        file: "src/__tests__/mutation-runner-neuter.test.ts",
        needle: "P4 (odd parity, LOUD): an apostrophe in a `--` comment is not a spurious neuter-missed",
      },
    ],
    fixture: "scripts/mutation-runner/fixtures/selftest/comment-parity-gate.sql",
    // Scenario 10/12 covers both parities; the P4 half is the spurious
    // `neuter-missed`. RED under neuter N2 in 164.3.1-11-CORPUS-PROOFS.md §3.
    citation: "164.3.1-11 (scenario 10/12, P4 half) + 164.3.1-01 (unit arm); proof: 164.3.1-11-CORPUS-PROOFS.md §3 (N2)",
  },
  {
    instance: "MUT-I01-P5",
    primitive: "A",
    file: "scripts/mutation-runner/run.mjs",
    armNeedle: "nor over-neuter the statement after it (P5)",
    also: [
      {
        file: "src/__tests__/mutation-runner-neuter.test.ts",
        needle: "P5 (even parity, SILENT): the statement after the RAISE's terminator must SURVIVE",
      },
    ],
    fixture: "scripts/mutation-runner/fixtures/selftest/comment-parity-gate.sql",
    // The silent over-neuter, made loud by the fixture's SURVIVOR LOST raise.
    // RED under neuter N2 in 164.3.1-11-CORPUS-PROOFS.md §3.
    citation: "164.3.1-11 (scenario 10/12, P5 half) + 164.3.1-01 (unit arm); proof: 164.3.1-11-CORPUS-PROOFS.md §3 (N2)",
  },
  // ── Primitive B ────────────────────────────────────────────────────────
  {
    instance: "R4-C02",
    primitive: "B",
    file: "scripts/mutation-runner/run.mjs",
    armNeedle: "SELF-TEST 11/12: [R4-C02] a current_query() trigger",
    fixture: "scripts/mutation-runner/fixtures/selftest/current-query-forge-gate.sql",
    // Plan 05's FORGE 1 / CTRL 1 promoted verbatim by plan 11; RED under the
    // attribution neuter N3 in 164.3.1-11-CORPUS-PROOFS.md §4.
    citation: "164.3.1-11 (scenario 11/12) over 164.3.1-05's attribution; proof: 164.3.1-11-CORPUS-PROOFS.md §4 (N3)",
  },
  {
    instance: "NESTED-EXECUTE",
    primitive: "B",
    file: "scripts/mutation-runner/run.mjs",
    armNeedle: "SELF-TEST 12/12: the nested-EXECUTE DO forgery",
    fixture: "scripts/mutation-runner/fixtures/selftest/nested-execute-forge-gate.sql",
    // FORGE 2 + echo-free FORGE 3; RED under the chain-length-only neuter N4
    // while scenario 11 stayed green — 164.3.1-11-CORPUS-PROOFS.md §5.
    citation: "164.3.1-11 (scenario 12/12) over 164.3.1-05's attribution; proof: 164.3.1-11-CORPUS-PROOFS.md §5 (N4)",
  },
  // ── Primitive C ────────────────────────────────────────────────────────
  {
    instance: "VAC04-C1",
    primitive: "C",
    file: "src/__tests__/drift-check-scripts.test.ts",
    armNeedle: "REOPEN PIN: the composing zero path prints BOTH readers' evidence and then EXITS NON-ZERO",
    // Plan 07's reopen pin, failing two ways (execution + marker); neuter A/B
    // record in 164.3.1-07-SUMMARY.md § The reopen pin's two-directional proof.
    citation: "164.3.1-07 task 2; proof: 164.3.1-07-SUMMARY.md § reopen pin two-directional proof (neuters A and B, restore a669211c)",
  },
  {
    instance: "VAC04-C2",
    primitive: "C",
    file: "src/__tests__/vac04-reader-guards.test.ts",
    armNeedle: "main-module guard ([VAC04-C2]) — every invocation shape must actually RUN the reader",
    // Plan 04: the realpath guard in both union members; pre-fix RED recorded
    // verbatim (symlinked invocation exits 0 having run nothing).
    citation: "164.3.1-04 task 1; proof: 164.3.1-04-SUMMARY.md § Pre-fix RED / [VAC04-C2]",
  },
  {
    instance: "VAC04-C3",
    primitive: "C",
    file: "src/__tests__/drift-check-scripts.test.ts",
    armNeedle: "VAC04-C3 RED: a grep that ERRORS on the name index is a MEASURE_FAIL, not 'measured absent'",
    // Plan 07 task 1 (landed as ab99ab99): three-way grep exit branching; the
    // pre-fix fail-open observation is quoted in the SUMMARY.
    citation: "164.3.1-07 task 1; proof: 164.3.1-07-SUMMARY.md § Task 1 — cited, not re-derived",
  },
  {
    instance: "VAC04-C4",
    primitive: "C",
    file: "src/__tests__/vac04-reader-guards.test.ts",
    armNeedle: "charset refusal ([VAC04-C4]) — a reader that cannot read the name must REFUSE, never narrow it",
    // Plan 04: the P10 non-ASCII input, pre-fix truncate-or-drop in two
    // directions, post-fix refusal in both members.
    citation: "164.3.1-04 task 2; proof: 164.3.1-04-SUMMARY.md § Pre-fix RED / [VAC04-C4]",
  },
  {
    instance: "VAC08-253",
    primitive: "C",
    file: "src/__tests__/drift-check-scripts.test.ts",
    armNeedle: "RED: a populated ledger matching under half the repo is MEASURE_FAIL, not drift",
    // The absurdity-floor family (RED arm + two controls) shipped in 164.3;
    // proven load-bearing in this phase by disabling the floor — cycle 2.
    citation: "164.3 (floor arms) re-proven by 164.3.1-12 task 1; proof: 164.3.1-12-CORPUS-PROOFS.md §4 (cycle 2)",
  },
  {
    instance: "VAC08-JOIN",
    primitive: "C",
    file: "src/__tests__/drift-check-scripts.test.ts",
    armNeedle: "VAC08-JOIN: a ledger row matching under EACH convention is not reported missing",
    // This plan: the per-convention driven arm; RED under a removed clause.
    citation: "164.3.1-12 task 1; proof: 164.3.1-12-CORPUS-PROOFS.md §2 (cycle 1) and §3 (cycle 1b)",
  },
  // ── Primitive D ────────────────────────────────────────────────────────
  {
    instance: "VAC-SELFREF-01",
    primitive: "D",
    file: "src/__tests__/self-referential-oracle.test.ts",
    armNeedle: "SRO-01 red fixture is flagged",
    also: [
      {
        // The fixed site itself: it now asserts over the red fixture's real bytes.
        file: "src/__tests__/lint-sql-gates.test.ts",
        needle: "every red fixture cites the mechanism it reproduces — the NUMBER, derived from RULES",
      },
    ],
    fixture: "scripts/self-referential-oracle-fixtures/SRO-01-same-block-const.red.ts",
    // Plan 02 observed the rule flagging the live :182-186 site at HEAD before
    // any fix (D-06); plan 08 fixed the site and re-ran the fire proof.
    citation: "164.3.1-02 (rule + SRO-01 pair) + 164.3.1-08 (site fix); proof: 164.3.1-02-CALIBRATION.md § II and § V, 164.3.1-08-SUMMARY.md § Task 2",
  },
  {
    instance: "SP-C04",
    primitive: "D",
    file: "src/__tests__/self-referential-oracle.test.ts",
    armNeedle: "BLOCKING corpus scan over src/__tests__ — exact against SRO_ALLOWLIST",
    fixture: "scripts/self-referential-oracle-fixtures/SRO-01-same-block-const.red.ts",
    // SP-C04 is the same-block-const SHAPE (local-stack-teardown-assertion
    // :178, since removed); the blocking scan is the arm that refuses it
    // corpus-wide, proven to bite on a planted probe in plan 08.
    citation: "164.3.1-08 task 1 (blocking) over 164.3.1-02's rule; proof: 164.3.1-08-SUMMARY.md § Task 2 observations 1–3 (plant RED, neuter, restore ad01e593)",
  },
  {
    instance: "AUDCOV-01",
    primitive: "D",
    file: "src/__tests__/audit-coverage.test.ts",
    armNeedle: "case A ([AUDCOV-01]): a `/*` inside a MULTI-LINE template no longer blanks the file",
    // Plan 06: pre-fix RED (A=[]), calibration control B, shipped fence C;
    // quote-carry neutered → A regresses, B stays green; restore ce51e2fb.
    citation: "164.3.1-06; proof: 164.3.1-06-SUMMARY.md § Case A's pre-fix RED and § Neuter/restore proof",
  },
  {
    instance: "MUT-W02",
    primitive: "D",
    file: "src/__tests__/lint-sql-gates.test.ts",
    armNeedle: "MW02 red fixture: the OLD single-spelling regex is BLIND to it, the parser is not",
    fixture: "scripts/aggregator-tolerance-fixtures/MW02-alternate-spelling.red.yml",
    // Plan 08 task 3: the structural result-loop parse; parser blinded to `[[`
    // → only the red-fixture arm reds; restore c7348516.
    citation: "164.3.1-08 task 3; proof: 164.3.1-08-SUMMARY.md § TASK 3 — [MUT-W02], measured",
  },
];

/** A needle shorter than this binds too little to name an arm. */
const NEEDLE_MIN_LENGTH = 16;

describe("164.3.1-12 — instance → arm registry (SC-1 corpus completeness, mechanical)", () => {
  it("non-vacuity: every needle is non-trivial and unique — a needle that matches everything binds nothing", () => {
    const seen = new Map<string, string>();
    for (const e of INSTANCE_ARM_REGISTRY) {
      const needles = [e.armNeedle, ...(e.also ?? []).map((a) => a.needle)];
      for (const n of needles) {
        expect(n.trim().length, `${e.instance}: empty needle`).toBeGreaterThan(0);
        expect(n.length, `${e.instance}: needle "${n}" is shorter than ${NEEDLE_MIN_LENGTH} chars`).toBeGreaterThanOrEqual(
          NEEDLE_MIN_LENGTH,
        );
        const prior = seen.get(n);
        expect(prior, `${e.instance} and ${prior ?? ""} share the needle "${n}" — one arm cannot stand for two instances`).toBeUndefined();
        seen.set(n, e.instance);
      }
      expect(e.citation, `${e.instance}: citation must name the shipping plan (164.3.1-NN)`).toMatch(/164\.3(\.1)?-\d\d|^164\.3 /);
      expect(e.citation, `${e.instance}: citation must name the committed record proving the arm can fail`).toMatch(
        /CORPUS-PROOFS|SUMMARY|CALIBRATION/,
      );
    }
  });

  it.each(INSTANCE_ARM_REGISTRY)("$instance (primitive $primitive) → $file binds by name", (e) => {
    const bindings = [{ file: e.file, needle: e.armNeedle }, ...(e.also ?? [])];
    for (const b of bindings) {
      expect(existsSync(join(ROOT, b.file)), `${e.instance}: arm file ${b.file} is gone`).toBe(true);
      const n = countOf(read(b.file), b.needle);
      expect(
        n,
        `${e.instance}: its arm "${b.needle}" is no longer in ${b.file}. The arm was renamed or deleted. If renamed, update the needle HERE with the new title; if deleted, the corpus lost a measured instance — restore it (see ${e.citation}). Do NOT drop the registry entry.`,
      ).toBeGreaterThanOrEqual(1);
    }
    if (e.fixture !== undefined) {
      expect(existsSync(join(ROOT, e.fixture)), `${e.instance}: fixture ${e.fixture} is gone`).toBe(true);
    }
  });

  it("EXACT SET, both directions: registry instances === phase taxonomy, failing by name", () => {
    const taxonomy = new Set(PHASE_TAXONOMY.map((t) => t.instance));
    const registered = new Set(INSTANCE_ARM_REGISTRY.map((e) => e.instance));

    expect(taxonomy.size, "duplicate instance IDs in PHASE_TAXONOMY").toBe(PHASE_TAXONOMY.length);
    expect(registered.size, "duplicate instance IDs in INSTANCE_ARM_REGISTRY").toBe(INSTANCE_ARM_REGISTRY.length);

    const unbound = [...taxonomy].filter((i) => !registered.has(i));
    expect(
      unbound,
      `measured instance(s) with NO arm in the corpus: ${unbound.join(", ")}. SC-1 says every measured instance is an executable arm — ship the arm, prove it RED under the neuter of its fix, then register it here with its citation. Do NOT delete the taxonomy entry.`,
    ).toEqual([]);

    const orphan = [...registered].filter((i) => !taxonomy.has(i));
    expect(
      orphan,
      `registry entr(y/ies) for instance(s) NOT in the phase taxonomy: ${orphan.join(", ")}. Either a new measured instance was found — add it to PHASE_TAXONOMY with its source — or the entry is a typo.`,
    ).toEqual([]);

    // The primitive letter is part of the identity: an instance filed under
    // the wrong primitive would be counted for a class it does not belong to.
    for (const e of INSTANCE_ARM_REGISTRY) {
      const t = PHASE_TAXONOMY.find((x) => x.instance === e.instance);
      expect(t?.primitive, `${e.instance}: registry says primitive ${e.primitive}, taxonomy says ${t?.primitive}`).toBe(e.primitive);
    }

    // Coverage across ALL FOUR primitives — the "corpus-wide" in SC-1.
    const covered = new Set(INSTANCE_ARM_REGISTRY.map((e) => e.primitive));
    expect([...covered].sort()).toEqual(["A", "B", "C", "D"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DIAGNOSTIC-FIRST meta-arm (SC-7, D-12)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The family's SHELL gates — the members whose ONLY interface is their output.
 * INCLUSION RULE: a bash gate this phase made sound, run by CI with its stdout
 * and exit code as the whole verdict. A new shell gate in this family goes
 * here; the meta-arm then reads its every failure emission.
 */
export const FAMILY_SHELL_GATES: readonly string[] = [
  "scripts/test-ledger-drift-check.sh",
  "scripts/prod-body-drift-check.sh",
];

export type Emission = {
  file: string;
  /** 1-based line of the emission's first line. */
  line: number;
  kind: "fail-call" | "error-block";
  /** The emitted text — the `fail` argument, or the joined block. */
  text: string;
};

/**
 * Every failure emission in a shell gate: each `fail "…"` call site, and each
 * contiguous `echo "::error::…"` block (evidence pipes, `if/else/fi` control
 * lines and comments inside the block are part of it; a blank line or any
 * other statement ends it).
 */
export function findFailureEmissions(file: string, src: string): Emission[] {
  const lines = src.split("\n");
  const out: Emission[] = [];
  const isErrorEcho = (l: string) => /^\s*echo "::error::/.test(l);
  const continues = (l: string) =>
    isErrorEcho(l) || /^\s*(sed |head |run_ledger_query |if .*\bthen\b|else\b|fi\b|&&|\|\||#)/.test(l);

  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isErrorEcho(l)) {
      let j = i;
      const buf: string[] = [];
      while (j < lines.length && continues(lines[j])) {
        buf.push(lines[j]);
        j++;
      }
      out.push({ file, line: i + 1, kind: "error-block", text: buf.join("\n") });
      i = j;
      continue;
    }
    // A `fail "…"` call site. The helper's own definition (`fail() {`) is not
    // an emission; a comment line is not either.
    if (!/^\s*#/.test(l) && !/^\s*fail\(\)/.test(l)) {
      const m = /\bfail "(.*)$/.exec(l);
      if (m !== null) out.push({ file, line: i + 1, kind: "fail-call", text: m[1] });
    }
    i++;
  }
  return out;
}

/**
 * Does the emitted text carry at least one RUNTIME-interpolated value?
 * `${GATE}` is the gate's constant name and is excluded — with it counted the
 * rule would be satisfied by every line in the family and bind nothing.
 * `$*` / `$@` / `$0` / `$(…)` / `${x}` / `$x` all count.
 */
export function carriesRuntimeValue(text: string): boolean {
  const stripped = text.split("${GATE}").join("");
  return /\$\{[A-Za-z_#@*!?0-9]|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|\$[#@*?0-9]/.test(stripped);
}

/** The emissions that ship a BARE conclusion. */
export function diagnosticFirstViolations(file: string, src: string): Emission[] {
  void file;
  void src;
  return []; // TDD RED: not yet implemented
}

/** A short, stable identity for an emission: file :: kind :: first 48 chars. */
export function emissionKey(e: Emission): string {
  return `${e.file} :: ${e.kind} :: ${e.text.replace(/\s+/g, " ").trim().slice(0, 48)}`;
}

// ── FIXTURES (SP-L02: same predicate, mutilated input) ──────────────────────
// These strings are INPUTS to the predicates under test, never assertion
// subjects — the assertions below read the predicates' RESULTS. That is why
// they are not the same-block-const shape the SRO rule flags.
const DIAGNOSTIC_RED_FIXTURE = [
  "#!/usr/bin/env bash",
  "GATE=\"fixture gate\"",
  "if [ \"$count\" -lt 3 ]; then",
  "  echo \"::error::${GATE}: the check failed.\"",
  "  echo \"::error::Something was wrong with the input. Fix it and re-run.\"",
  "  exit 1",
  "fi",
  "[ -f \"$f\" ] || fail \"the file is missing.\"",
  "",
].join("\n");

const DIAGNOSTIC_GREEN_FIXTURE = [
  "#!/usr/bin/env bash",
  "GATE=\"fixture gate\"",
  "if [ \"$count\" -lt 3 ]; then",
  "  echo \"::error::${GATE}: MEASURE_FAIL — only ${count} row(s) read, floor is 3.\"",
  "  echo \"::error::  first rows actually read:\"",
  "  head -n 3 \"$rows\" | sed 's|^|::error::    |'",
  "  exit 1",
  "fi",
  "[ -f \"$f\" ] || fail \"the file is missing at ${f}.\"",
  "",
].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// 3. BARE-MEASUREMENT audit meta-arm (SC-9, D-10)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The threshold-bearing members of the family. INCLUSION RULE: every file in
 * this family that declares a numeric FLOOR/MIN threshold or compares against
 * a literal inside an absurdity block — the two shell gates, the mutation
 * runner, and the two vitest gates that carry non-vacuity floors. A new
 * threshold anywhere in these files must carry its measurement AND be
 * registered in KNOWN_THRESHOLD_SITES below.
 */
export const THRESHOLD_BEARING_FILES: readonly string[] = [
  ...FAMILY_SHELL_GATES,
  "scripts/mutation-runner/run.mjs",
  "src/__tests__/lint-sql-gates.test.ts",
  "src/__tests__/self-referential-oracle.test.ts",
];

export type ThresholdSite = {
  file: string;
  /** 1-based line of the threshold. */
  line: number;
  /** `NAME=<n>` for a constant, `<lhs> <op> <n>` for a literal comparison. */
  label: string;
  /** Whether a measurement token AND a date sit within JUSTIFICATION_WINDOW lines above. */
  justified: boolean;
  /** What justified it — for the diagnostic print. */
  evidence: string;
};

/** Lines above a threshold within which its measurement must be recorded. */
export const JUSTIFICATION_WINDOW = 80;

/** Every threshold site in a family file, each with its justification verdict. */
export function findThresholdSites(file: string, src: string): ThresholdSite[] {
  void file;
  void src;
  return []; // TDD RED: not yet implemented
}

// ── FIXTURES ────────────────────────────────────────────────────────────────
const THRESHOLD_RED_FIXTURE = [
  "#!/usr/bin/env bash",
  "# Refuse tiny inputs.",
  "ROWS_FLOOR=7",
  "if [ \"$rows\" -lt \"$ROWS_FLOOR\" ]; then exit 1; fi",
  "if [ \"$other\" -ge 25 ]; then exit 1; fi",
  "",
].join("\n");

const THRESHOLD_GREEN_FIXTURE = [
  "#!/usr/bin/env bash",
  "# MEASURED 2026-09-02 over the whole fixture corpus: legitimate runs score",
  "# 40-60 rows, the broken reader scores 0; the floor sits an order of",
  "# magnitude under the silent shape (sample size 12 runs).",
  "ROWS_FLOOR=7",
  "if [ \"$rows\" -lt \"$ROWS_FLOOR\" ]; then exit 1; fi",
  "",
].join("\n");

describe("164.3.1-12 — META-ARM fixtures: both rules can fire (SP-L02, same predicate as the family scan)", () => {
  it("diagnostic-first: the RED fixture's bare-conclusion block AND bare fail are flagged; the GREEN fixture is clean and really read", () => {
    const red = diagnosticFirstViolations("fixture.red.sh", DIAGNOSTIC_RED_FIXTURE);
    expect(
      red.map((e) => e.kind).sort(),
      `the rule must flag the fixture's bare ::error:: block and its bare fail call; findings were ${JSON.stringify(red)}`,
    ).toEqual(["error-block", "fail-call"]);

    // Vacuity fence: the green fixture must PARSE to emissions before its
    // emptiness means anything (an absence is satisfied perfectly by rubble).
    const greenEmissions = findFailureEmissions("fixture.green.sh", DIAGNOSTIC_GREEN_FIXTURE);
    expect(greenEmissions.map((e) => e.kind).sort()).toEqual(["error-block", "fail-call"]);
    expect(
      diagnosticFirstViolations("fixture.green.sh", DIAGNOSTIC_GREEN_FIXTURE),
      "an emission that interpolates its quantity must not be flagged",
    ).toEqual([]);
  });

  it("bare-measurement: the RED fixture's unjustified floor and literal comparison are flagged; the GREEN fixture's measured floor is not", () => {
    const red = findThresholdSites("fixture.red.sh", THRESHOLD_RED_FIXTURE);
    expect(
      red.map((s) => s.label).sort(),
      `the scan must find both the ROWS_FLOOR constant and the literal \`-ge 25\` comparison; sites were ${JSON.stringify(red)}`,
    ).toEqual(["ROWS_FLOOR=7", "other -ge 25"]);
    expect(red.every((s) => !s.justified), "neither site carries a measurement, so both must be UNJUSTIFIED").toBe(true);

    const green = findThresholdSites("fixture.green.sh", THRESHOLD_GREEN_FIXTURE);
    expect(green.map((s) => s.label)).toEqual(["ROWS_FLOOR=7"]);
    expect(green[0]?.justified, `the measured floor must be justified; evidence was ${green[0]?.evidence}`).toBe(true);
  });
});
