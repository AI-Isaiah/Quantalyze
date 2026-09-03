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
    armNeedle: "SELF-TEST 9/17: [R4-C01] the P3 compound HEAD must be REFUSED",
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
    armNeedle: "SELF-TEST 11/17: [R4-C02] a current_query() trigger",
    fixture: "scripts/mutation-runner/fixtures/selftest/current-query-forge-gate.sql",
    // Plan 05's FORGE 1 / CTRL 1 promoted verbatim by plan 11; RED under the
    // attribution neuter N3 in 164.3.1-11-CORPUS-PROOFS.md §4.
    citation: "164.3.1-11 (scenario 11/12) over 164.3.1-05's attribution; proof: 164.3.1-11-CORPUS-PROOFS.md §4 (N3)",
  },
  {
    instance: "NESTED-EXECUTE",
    primitive: "B",
    file: "scripts/mutation-runner/run.mjs",
    armNeedle: "SELF-TEST 12/17: the nested-EXECUTE DO forgery",
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
    // READER-LEVEL (plan 04): the two reader CLIs driven through a symlink and a space path.
    file: "src/__tests__/vac04-reader-guards.test.ts",
    armNeedle: "main-module guard ([VAC04-C2]) — every invocation shape must actually RUN the reader",
    // GATE-LEVEL (plan 13, SC-4 "driven through the real gate"): the same guard
    // reached through scripts/prod-body-drift-check.sh via its injected reader paths.
    also: [
      {
        file: "src/__tests__/drift-check-scripts.test.ts",
        needle: "[VAC04-C2] GATE-LEVEL — the realpath guard driven THROUGH THE REAL GATE",
      },
    ],
    // Plan 04: the realpath guard in both union members; pre-fix RED recorded
    // verbatim (symlinked invocation exits 0 having run nothing).
    citation:
      "164.3.1-04 task 1; proof: 164.3.1-04-SUMMARY.md § Pre-fix RED / [VAC04-C2] + 164.3.1-13 task 1 (gate-level arm through scripts/prod-body-drift-check.sh); proof: 164.3.1-13-SUMMARY.md § cycles C2-N1/C2-N2",
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
    // READER-LEVEL (plan 04): the two reader CLIs on the P10 non-ASCII identifier.
    file: "src/__tests__/vac04-reader-guards.test.ts",
    armNeedle: "charset refusal ([VAC04-C4]) — a reader that cannot read the name must REFUSE, never narrow it",
    // GATE-LEVEL (plan 13, SC-4 "driven through the real gate"): the same input
    // through scripts/prod-body-drift-check.sh — exit 1 naming U+00FA, no body text.
    also: [
      {
        file: "src/__tests__/drift-check-scripts.test.ts",
        needle: "[VAC04-C4] GATE-LEVEL — the charset refusal driven THROUGH THE REAL GATE",
      },
    ],
    // Plan 04: the P10 non-ASCII input, pre-fix truncate-or-drop in two
    // directions, post-fix refusal in both members.
    citation:
      "164.3.1-04 task 2; proof: 164.3.1-04-SUMMARY.md § Pre-fix RED / [VAC04-C4] + 164.3.1-13 task 2 (gate-level arm through scripts/prod-body-drift-check.sh); proof: 164.3.1-13-SUMMARY.md § cycle C4-N1",
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

/**
 * A needle shorter than this binds too little to name an arm.
 * MEASURED 2026-09-02 at 8969513e over INSTANCE_ARM_REGISTRY: 21 needles,
 * shortest 29 chars ("SRO-01 red fixture is flagged"), longest 94. The floor
 * sits under the shortest real needle so a registry entry cut down to a bare
 * word ("fixture", "RED:") reds here; it is not tuned to the corpus's exact
 * minimum, which would red on every legitimate short title.
 */
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
      // The quoted argument (balanced double quotes); an unterminated quote
      // falls back to the rest of the line rather than being skipped.
      const m = /\bfail "((?:[^"\\]|\\.)*)"/.exec(l) ?? /\bfail "(.*)$/.exec(l);
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
  return findFailureEmissions(file, src).filter((e) => !carriesRuntimeValue(e.text));
}

/** A short, stable identity for an emission: file :: kind :: first 48 chars. */
export function emissionKey(e: Emission): string {
  return `${e.file} :: ${e.kind} :: ${e.text.replace(/\s+/g, " ").trim().slice(0, 48).trimEnd()}`;
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
 * runner, the two vitest gates that carry non-vacuity floors — and THIS FILE,
 * whose own NEEDLE_MIN_LENGTH and EMISSION_FLOOR are thresholds the rule must
 * not exempt (a meta-arm that skips itself is the D primitive it audits for).
 * A new threshold anywhere in these files must carry its measurement AND be
 * registered in KNOWN_THRESHOLD_SITES below.
 */
export const THRESHOLD_BEARING_FILES: readonly string[] = [
  ...FAMILY_SHELL_GATES,
  "scripts/mutation-runner/run.mjs",
  "src/__tests__/lint-sql-gates.test.ts",
  "src/__tests__/self-referential-oracle.test.ts",
  "src/__tests__/gate-family-meta.test.ts",
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

/**
 * What counts as a measurement beside a threshold: one of these tokens AND a
 * dated stamp. The vocabulary is the family's own — every measured comment in
 * it says MEASURED, records what a shape SCORED, or states a SAMPLE SIZE.
 */
const MEASUREMENT_TOKEN = /MEASURED|measured|Measured|scored|SAMPLE SIZE|sample size/;
const DATE_STAMP = /\b20\d\d-\d\d-\d\d\b/;

/**
 * Every threshold site in a family file, each with its justification verdict.
 * A site is (a) a FLOOR/MIN/CEILING/MAX/LIMIT-named constant bound to a numeric
 * literal (JS `const`/`export const`, or a shell `NAME=<n>`), or (b) a shell
 * numeric comparison against a literal of two or more digits (`-ge 50`);
 * single-digit literals are exit codes and booleans, not thresholds. Comment
 * lines never produce a site.
 *
 * ⚠️ The name class covers BOTH directions deliberately. It was `FLOOR|MIN`
 * only until 2026-09-02, which let `WAIVED_CEILING = 0` (run.mjs:228) escape
 * the SC-9 no-bare-thresholds arm — a bound that fails when the corpus carries
 * MORE than was measured is exactly as capable of being picked by taste as a
 * lower bound, and this phase's whole thesis is that a control scoped to the
 * spellings that happen to exist today is unsound by construction.
 *
 * ⛔ TWO COUNTING CONVENTIONS, NAMED — they were conflated here until
 * 2026-09-02 and produced three different integers for one list. `shCmp` above
 * matches a shell literal comparison and is NOT gated by the name class, so
 * widening the class moves the NAME-CLASS count and the TOTAL-SITE count by the
 * same one, from different bases:
 *
 *   RE-MEASURED 2026-09-02 at HEAD, by running the two name classes over all
 *   six THRESHOLD_BEARING_FILES (a node scan reproducing this function):
 *     `FLOOR|MIN`                     → 7 name-class constants + 1 shell
 *                                       comparison = 8 TOTAL sites
 *     `FLOOR|MIN|CEILING|MAX|LIMIT`   → 8 name-class constants + 1 shell
 *                                       comparison = 9 TOTAL sites
 *
 * The one added site is `WAIVED_CEILING=0` at run.mjs:228, and it is justified,
 * so the arm stays green on a real gain rather than on an unchanged set. TOTAL
 * SITES is the convention the arm's own diagnostic prints (`META
 * bare-measurement: N threshold site(s) over 6 file(s)` — 9 today) and the
 * convention KNOWN_THRESHOLD_SITES is counted in. The RED fixture below carries
 * a CEILING case so a regression of this name class fails by fixture, not by
 * audit.
 */
export function findThresholdSites(file: string, src: string): ThresholdSite[] {
  const lines = src.split("\n");
  const sites: ThresholdSite[] = [];
  lines.forEach((l, idx) => {
    if (/^\s*(#|\/\/|\*)/.test(l)) return;
    let label: string | null = null;
    const jsConst = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:FLOOR|MIN|CEILING|MAX|LIMIT)[A-Z0-9_]*)\s*=\s*(\d+)\b/.exec(l);
    const shConst = /^\s*([A-Z][A-Z0-9_]*(?:FLOOR|MIN|CEILING|MAX|LIMIT)[A-Z0-9_]*)=(\d+)\b/.exec(l);
    const shCmp = /\[\s*"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?\s+-(ge|gt|lt|le)\s+(\d{2,})\s*\]/.exec(l);
    if (jsConst !== null) label = `${jsConst[1]}=${jsConst[2]}`;
    else if (shConst !== null) label = `${shConst[1]}=${shConst[2]}`;
    else if (shCmp !== null) label = `${shCmp[1]} -${shCmp[2]} ${shCmp[3]}`;
    if (label === null) return;

    const window = lines.slice(Math.max(0, idx - JUSTIFICATION_WINDOW), idx + 1).join("\n");
    const tok = MEASUREMENT_TOKEN.exec(window);
    const date = DATE_STAMP.exec(window);
    const justified = tok !== null && date !== null;
    sites.push({
      file,
      line: idx + 1,
      label,
      justified,
      evidence: justified
        ? `"${(tok as RegExpExecArray)[0]}" + ${(date as RegExpExecArray)[0]} within ${JUSTIFICATION_WINDOW} lines`
        : `missing ${tok === null ? "measurement token" : ""}${tok === null && date === null ? " and " : ""}${date === null ? "date stamp" : ""} within ${JUSTIFICATION_WINDOW} lines`,
    });
  });
  return sites;
}

// ── FIXTURES ────────────────────────────────────────────────────────────────
const THRESHOLD_RED_FIXTURE = [
  "#!/usr/bin/env bash",
  "# Refuse tiny inputs.",
  "ROWS_FLOOR=7",
  "if [ \"$rows\" -lt \"$ROWS_FLOOR\" ]; then exit 1; fi",
  "if [ \"$other\" -ge 25 ]; then exit 1; fi",
  // An UPPER bound, unjustified. Pins the CEILING/MAX/LIMIT half of the name
  // class: if it ever narrows back to FLOOR|MIN this line stops being a site
  // and the arm below goes RED on the missing label.
  "WAIVERS_CEILING=3",
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
      `the scan must find the ROWS_FLOOR constant, the WAIVERS_CEILING upper bound and the literal \`-ge 25\` comparison; sites were ${JSON.stringify(red)}`,
    ).toEqual(["ROWS_FLOOR=7", "WAIVERS_CEILING=3", "other -ge 25"]);
    expect(red.every((s) => !s.justified), "no site carries a measurement, so all must be UNJUSTIFIED").toBe(true);

    const green = findThresholdSites("fixture.green.sh", THRESHOLD_GREEN_FIXTURE);
    expect(green.map((s) => s.label)).toEqual(["ROWS_FLOOR=7"]);
    expect(green[0]?.justified, `the measured floor must be justified; evidence was ${green[0]?.evidence}`).toBe(true);
  });
});

// ── THE FAMILY SCANS ────────────────────────────────────────────────────────

/**
 * Justified exceptions to diagnostic-first — EXACT SET, keyed by emissionKey
 * (file :: kind :: first 48 chars), never by line number. Every entry says
 * why that emission legitimately carries no runtime quantity. A new bare
 * emission fails below by key; a discharged entry fails too.
 */
export const DIAGNOSTIC_FIRST_ALLOWLIST: ReadonlyArray<{ key: string; reason: string }> = [
  // MEASURED 2026-09-02 at 03585b88 by running this arm with the list EMPTY:
  // 68 emissions over the two gates, 17 bare. Every one of the 17 falls into
  // one of four classes, stated per entry. None was silenced by taste: the
  // classes were decided BEFORE the keys were transcribed from the scan.
  //
  //   PRECONDITION  the failure is the ABSENCE of a tool or credential. There is
  //                 no runtime quantity — the value is unset — and the text
  //                 names the variable or binary, which IS the diagnostic.
  //   REDACTED      the observable is withheld by the gates' public-log rule
  //                 (NON-NEGOTIABLES: never a DSN, host, username or body text).
  //   EMPTY-BY-COND the branch condition IS the measurement: the list/index
  //                 was found empty, and the text says so. Printing an empty
  //                 string would add nothing.
  //   READER-STDERR the failure is a child reader's non-zero exit whose own
  //                 stderr passes through UN-redirected on the lines above the
  //                 `|| fail` (plan 164.3.1-04's refusals name file, line and
  //                 byte). The wrapper adds only the conclusion; the diagnostic
  //                 was already printed by the reader. The reader's exit CODE
  //                 is not captured by the `|| fail` idiom — recorded as a
  //                 follow-up in 164.3.1-12-SUMMARY.md and booked in TODOS.md
  //                 (§ Phase 164.3.1 review-fix), not fixed here. Reasons name
  //                 the reader MODE, never a line: the gate script is edited by
  //                 later plans in this phase and line anchors go stale.
  //
  // ── scripts/test-ledger-drift-check.sh ──────────────────────────────────
  {
    key: "scripts/test-ledger-drift-check.sh :: fail-call :: node is not on PATH; the shared normalizer canno",
    reason: "PRECONDITION — `node` absent from PATH; the binary name is the diagnostic",
  },
  {
    key: "scripts/test-ledger-drift-check.sh :: error-block :: echo \"::error::${GATE}: TEST_SUPABASE_DB_URL is",
    reason: "PRECONDITION — the DSN is unset; the five-line block names the variable and the job contract, and the value must never be printed (REDACTED as well)",
  },
  {
    key: "scripts/test-ledger-drift-check.sh :: fail-call :: psql is not on PATH.",
    reason: "PRECONDITION — `psql` absent from PATH",
  },
  {
    key: "scripts/test-ledger-drift-check.sh :: fail-call :: the ledger presence query failed (output withhel",
    reason: "REDACTED — psql's output can carry connection detail; withheld by design. Exit code not captured (follow-up)",
  },
  {
    key: "scripts/test-ledger-drift-check.sh :: fail-call :: BODY_CHECK_FUNCTIONS is empty or whitespace-only",
    reason: "EMPTY-BY-COND — the list was measured empty/whitespace by the branch; there is nothing to interpolate",
  },
  // ── scripts/prod-body-drift-check.sh ────────────────────────────────────
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: BODY_FETCH_CMD is unset — there is no way to rea",
    reason: "PRECONDITION — injectable command unset; the variable name is the diagnostic",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: BODY_NAME_INDEX_CMD is unset — without PROD's fu",
    reason: "PRECONDITION — injectable command unset",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: BODY_NAME_INDEX_XCHECK_CMD is unset — with ONE i",
    reason: "PRECONDITION — injectable command unset",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: node is not on PATH; the shared normalizer canno",
    reason: "PRECONDITION — `node` absent from PATH",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: could not extract function names from the change",
    reason: "READER-STDERR — `node $NORMALIZER --function-names` exits non-zero with its stderr on the log; the refusal names file/line/byte",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: the independent name reader failed on the change",
    reason: "READER-STDERR — `node $NAIVE_NAMES` (unqualified mode) exits non-zero with its stderr on the log",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: could not read the schema qualifiers of this PR'",
    reason: "READER-STDERR — `node $NORMALIZER --function-qualified-names` exits non-zero with its stderr on the log",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: the independent name reader could not read the s",
    reason: "READER-STDERR — `node $NAIVE_NAMES --qualified` exits non-zero with its stderr on the log",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: could not index PROD's function names (stderr wi",
    reason: "REDACTED — the index command reads a PROD dump; its stderr is redirected to a file and withheld from the public log by design",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: could not build the INDEPENDENT cross-check inde",
    reason: "REDACTED — same as the primary index; stderr withheld by design",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: PROD's function-name index came back EMPTY. A da",
    reason: "EMPTY-BY-COND — `grep -q` on the primary index found no non-blank line; the quantity is zero and the text says so",
  },
  {
    key: "scripts/prod-body-drift-check.sh :: fail-call :: the INDEPENDENT cross-check index of PROD's func",
    reason: "EMPTY-BY-COND — same, for the cross-check index",
  },
];

/**
 * Non-vacuity floor on the emission walk. MEASURED 2026-09-02 at 03585b88:
 * 68 emissions over the two gates (test-ledger 30, prod-body 38); re-measured
 * 2026-09-02 at 8969513e (review-fix branch, prod-body gate under edit): 71
 * (test-ledger 27, prod-body 44). The floor
 * is 40, not 68 — pinned at the measurement it reds on every legitimate
 * consolidation of an error block and gets raised by reflex (D-10, wide
 * separation). A walker that stopped recognising `echo "::error::` or `fail "`
 * scores a handful and reds here rather than reporting a clean family of
 * nothing.
 */
const EMISSION_FLOOR = 40;

describe("164.3.1-12 — META-ARM diagnostic-first over the family's shell gates (SC-7)", () => {
  it("every failure emission prints a runtime value — exact against DIAGNOSTIC_FIRST_ALLOWLIST, both directions", () => {
    const emissions: Emission[] = [];
    const violations: Emission[] = [];
    for (const rel of FAMILY_SHELL_GATES) {
      const src = read(rel);
      const found = findFailureEmissions(rel, src);
      emissions.push(...found);
      violations.push(...diagnosticFirstViolations(rel, src));
    }

    // DIAGNOSTIC-FIRST about itself (D-12): print what was seen. A raw
    // process.stdout.write because vitest 4's default reporter swallows
    // console output from passing tests.
    process.stdout.write(
      `META diagnostic-first: ${emissions.length} emission(s) over ${FAMILY_SHELL_GATES.length} gate(s), ` +
        `${violations.length} bare, ${DIAGNOSTIC_FIRST_ALLOWLIST.length} allowlisted\n` +
        violations.map((v) => `  bare ${emissionKey(v)} (line ${v.line})\n`).join(""),
    );

    expect(
      emissions.length,
      `the emission walk found ${emissions.length} site(s); a broken walk reports a clean family of nothing`,
    ).toBeGreaterThanOrEqual(EMISSION_FLOOR);

    const allow = new Set(DIAGNOSTIC_FIRST_ALLOWLIST.map((a) => a.key));
    const found = new Set(violations.map(emissionKey));

    const unexplained = violations.filter((v) => !allow.has(emissionKey(v)));
    expect(
      unexplained.map((v) => `${emissionKey(v)} (line ${v.line})`),
      "a gate in this family ships a BARE CONCLUSION — a failure emission with no runtime-interpolated value. Print what the gate SAW (the count, the name, the exit code) before the verdict (D-12/SC-7). Do NOT add the site to DIAGNOSTIC_FIRST_ALLOWLIST to silence this; that list holds emissions that legitimately have no quantity, each with its reason",
    ).toEqual([]);

    const discharged = DIAGNOSTIC_FIRST_ALLOWLIST.filter((a) => !found.has(a.key));
    expect(
      discharged.map((a) => a.key),
      "allowlist entr(y/ies) no longer match a bare emission — either the site now prints its quantity (delete the entry) or the walker stopped seeing it (a regression in this rule; re-run the fixture arm before touching the list)",
    ).toEqual([]);
  });
});

/**
 * Every threshold the family carries, EXACT SET by `file :: label`. A new
 * threshold anywhere in THRESHOLD_BEARING_FILES must be measured (the scan
 * asserts that) AND registered here — a floor set by taste and a floor set by
 * measurement look identical to a reader who did not check.
 */
export const KNOWN_THRESHOLD_SITES: readonly string[] = [
  // ⚠️ EVERY COUNT HERE IS A **TOTAL SITE** COUNT — name-class constants PLUS
  // the shell literal comparisons, which the name class does not gate. That is
  // the convention this list is length-checked in and the one the arm's
  // diagnostic prints; the 7-vs-8 pair in findThresholdSites' doc-comment is the
  // NAME-CLASS convention and counts a different thing.
  //
  // MEASURED 2026-09-02 at 03585b88 by running this arm with the list EMPTY:
  // 6 threshold sites over the 5 threshold-bearing files, all 6 justified
  // (token + date within the window). Re-measured 2026-09-02 at 8969513e with
  // this file added: 8 sites over 6 files, NEEDLE_MIN_LENGTH was BARE (no date)
  // until its measurement was recorded. RE-MEASURED 2026-09-02 at HEAD after
  // the name class widened past `FLOOR|MIN`: 9 sites over the same 6 files
  // (8 name-class constants + 1 shell literal comparison), all 9 justified —
  // the entries below, one per site. The known count IS the non-vacuity
  // floor: an exact set both directions is strictly stronger than `>= 6`, and
  // a threshold leaving this family is a decision worth a red, not churn.
  "scripts/test-ledger-drift-check.sh :: ledger_rows -ge 50", //  VAC-08 absurdity floor: 'scored' + 2026-08-29
  "scripts/prod-body-drift-check.sh :: SNAPSHOT_MIN=50", //         VAC-04 absurdity floor: 'measured' + 2026-09-01
  "scripts/mutation-runner/run.mjs :: FILES_FLOOR=17", //           coverage ratchet: MEASURED + 2026-09-03 (fourth FILE move, plan 164.4-07)
  "scripts/mutation-runner/run.mjs :: ARMS_FLOOR=189", //           biting ratchet: MEASURED + 2026-09-03 (re-derived, plan 164.4-07)
  // The family's only UPPER bound. Invisible to this arm until the name class
  // widened past FLOOR|MIN on 2026-09-02 — registered here on the run that
  // first saw it, with its measurement at run.mjs:201-227 and the constant
  // itself at run.mjs:228 (MEASURED + a dated --parse-only run at 8969513e
  // scoring 0 waivers, cross-checked by an independent fs scan). Both anchors
  // RE-MEASURED at HEAD 2026-09-02; they had shifted by two lines.
  "scripts/mutation-runner/run.mjs :: WAIVED_CEILING=0", //          waiver ceiling: MEASURED + 2026-09-02
  "src/__tests__/lint-sql-gates.test.ts :: RESULT_LOOP_CONDITION_FLOOR=8", // [MUT-W02] parse floor: 'measured' + 2026-09-01
  "src/__tests__/self-referential-oracle.test.ts :: CORPUS_FLOOR=100", //    SRO corpus-walk floor: MEASURED + 2026-09-01
  "src/__tests__/gate-family-meta.test.ts :: NEEDLE_MIN_LENGTH=16", //      registry needle floor: MEASURED + 2026-09-02
  "src/__tests__/gate-family-meta.test.ts :: EMISSION_FLOOR=40", //         emission-walk floor: MEASURED + 2026-09-02
];

describe("164.3.1-12 — META-ARM bare-measurement audit over the family's thresholds (SC-9)", () => {
  it("every threshold carries a measurement token and a date within the window, and the found set is exactly KNOWN_THRESHOLD_SITES", () => {
    const sites: ThresholdSite[] = [];
    for (const rel of THRESHOLD_BEARING_FILES) sites.push(...findThresholdSites(rel, read(rel)));

    process.stdout.write(
      `META bare-measurement: ${sites.length} threshold site(s) over ${THRESHOLD_BEARING_FILES.length} file(s)\n` +
        sites.map((s) => `  ${s.justified ? "ok  " : "BARE"} ${s.file} :: ${s.label} (line ${s.line}) — ${s.evidence}\n`).join(""),
    );

    const keys = sites.map((s) => `${s.file} :: ${s.label}`);
    expect(new Set(keys).size, "two threshold sites share a key — labels must be unique per file").toBe(keys.length);

    const bare = sites.filter((s) => !s.justified);
    expect(
      bare.map((s) => `${s.file} :: ${s.label} (line ${s.line}) — ${s.evidence}`),
      `a threshold in this family has NO measurement beside it. Record the measurement — the command, the date, the sample size and coverage, and both separation directions — within ${JUSTIFICATION_WINDOW} lines above the value (D-10/SC-9). Do not widen the window`,
    ).toEqual([]);

    const known = new Set(KNOWN_THRESHOLD_SITES);
    const found = new Set(keys);
    expect(
      keys.filter((k) => !known.has(k)),
      "a threshold site not in KNOWN_THRESHOLD_SITES — a new floor appeared in the family. Register it here WITH its measurement recorded beside it in the file; a threshold nobody registered is a threshold nobody reviewed",
    ).toEqual([]);
    expect(
      KNOWN_THRESHOLD_SITES.filter((k) => !found.has(k)),
      "a registered threshold site was not found — the floor was removed or renamed, or the scan stopped seeing it. Establish which before editing this list",
    ).toEqual([]);
  });
});
