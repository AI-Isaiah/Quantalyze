/**
 * The live-DB execution ledger — contract test.
 * (Phase 164.9 TESTISOLATION, the ledger round arising from plan 08 and its fix
 * round, for `[164.9-LIVEDB-LANE-EXECUTION-CENSUS]`.)
 *
 * WHY THIS FILE EXISTS. The ledger's own gate —
 * `scripts/live-db-execution-ledger.mjs` — only runs inside
 * `frontend-live-db-lane`, which needs a booted Supabase stack and therefore
 * Docker. That is the right place to compare the ledger against a RUN, and the
 * wrong place to be the ONLY thing standing between the repository and a
 * malformed, uncounted or specimen-bearing ledger: a developer without Docker,
 * and every non-lane CI job, would see none of it.
 *
 * So the structural invariants are asserted HERE, in the ordinary sharded suite,
 * with no stack and no network:
 *
 *   1. the gate can still FAIL — its own `--self-test` is executed, red and
 *      green cases included, rather than trusted;
 *   2. the header's `ENTRY_COUNT` literal AGREES with the entry list. A list with
 *      no recorded cardinality can be emptied without a single red, and a
 *      cardinality nobody re-derives is a claim nobody compares to the thing;
 *   3. every entry is well-formed, carries the single campaign destination, and
 *      uses a kind and a signature class from the declared vocabulary;
 *   4. ⛔ NO ENTRY CARRIES A SPECIMEN. This repository is PUBLIC and the ledger is
 *      TRACKED. A line records a verdict — module, kind, signature class, arm —
 *      and never a failure message, a host, a DSN, an absolute path or a
 *      username. This is the assertion that keeps that true.
 *
 * ⚠️ It deliberately does NOT pin the per-kind tally (9 / 6 / 3), nor an exact
 * total. That is a MEASUREMENT of the current tree, it is expected to shrink,
 * and restating it here would make a correct shrink red — the exact "prose
 * beside a constant" defect `CLAUDE.md` records four times over.
 *
 * ⭐ A CEILING IS NOT A PIN, AND THE REASONING ABOVE DOES NOT RULE ONE OUT. The
 * argument against a pin is that the ledger may legitimately get SMALLER; a
 * ceiling is silent about every value below it and only speaks when the ledger
 * GROWS, which is the one direction the ledger is forbidden to move. So
 * `ENTRY_CEILING` lives in the gate (the upper bound) and its STALENESS is
 * checked here (arm 5 below): a ledger that correctly shrank while the ceiling
 * stayed put has quietly re-opened room to grow back, and that is the one thing
 * a bound-only-from-above control cannot notice about itself. Two layers, the
 * repo's `FILES_FLOOR` / `mutation-runner-floors.test.ts` idiom inverted.
 *
 * ⛔ CORRECTED 2026-09-21 (review round 2) — SAY WHAT THIS ACTUALLY ENFORCES,
 * because the two paragraphs above together overclaim. Arm 5's staleness check
 * is `toBe(entries)`, not an inequality, so combined with the upper bound the
 * ceiling must EQUAL the entry count: this file DOES transitively pin the exact
 * total, which is the thing the paragraph above says it deliberately does not
 * do. Both statements cannot be true, and the code is the one that runs.
 *
 * ⭐ THE HONEST CLAIM, and it is still worth having: growing the ledger is NOT
 * prevented — no in-repo constant can stop a determined edit — it is made
 * IMPOSSIBLE TO DO SILENTLY. A growth now takes three coordinated edits in one
 * commit (the ledger line, `# ENTRY_COUNT`, and `ENTRY_CEILING`), each of which
 * is a named line in a diff a reviewer reads. Before the ceiling existed it took
 * one. ⛔ Do not describe this as "the ledger cannot grow"; describe it as "the
 * ledger cannot grow by accident, and cannot grow without saying so".
 *
 * ⚠️ `ARM_FLOOR` gets no staleness arm here on purpose: re-deriving the collected
 * arm count needs a BOOTED STACK and a real run, which this file has by
 * construction not got. It is bounded from below in the gate and re-pinned
 * whenever the lane is re-measured.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENTRY_CEILING } from "../../scripts/live-db-execution-ledger.mjs";
import { CORPUS_FLOOR, liveDbLaneCorpus } from "../../scripts/live-db-lane-corpus.mjs";

const REPO_ROOT = join(__dirname, "..", "..");
const LEDGER = join(REPO_ROOT, "scripts", "live-db-execution-ledger.txt");
const GATE = join(REPO_ROOT, "scripts", "live-db-execution-ledger.mjs");

const DESTINATION = "[164.9-LIVEDB-LANE-EXECUTION-CENSUS]";

/** The kinds the ledger's header declares, and nothing else. */
const KINDS = new Set([
  "K1-baseline-privilege-state-absent",
  "K2-function-body-role-gate",
  "K3-migration-or-invariant-decision",
]);

/** Signature classes are `C<n>-<lowercase-hyphenated>`, optionally SQLSTATE-suffixed. */
const SIGNATURE_RE = /^C\d-[a-z0-9-]+$/;

function readEntries(): string[][] {
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => line.split("\t"));
}

describe("live-DB execution ledger — contract", () => {
  it("the gate proves it can go RED before anything trusts it going green", () => {
    const result = spawnSync("node", [GATE, "--self-test"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(
      result.status,
      `live-db-execution-ledger --self-test FAILED:\n${result.stdout}\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toContain("red and green both observed");
  });

  it("the header's ENTRY_COUNT literal agrees with the entry list", () => {
    const text = readFileSync(LEDGER, "utf8");
    const declared = text.match(/^# ENTRY_COUNT = (\d+)$/m);
    expect(
      declared,
      "the ledger carries no `# ENTRY_COUNT = N` line — an uncounted list can be emptied silently",
    ).not.toBeNull();
    expect(Number(declared![1])).toBe(readEntries().length);
  });

  it("every entry is well-formed and routes to the one campaign destination", () => {
    const entries = readEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const fields of entries) {
      expect(fields.length, `entry has ${fields.length} TAB fields, expected 5`).toBe(5);
      const [module, kind, signature, arm, destination] = fields;
      expect(module).toMatch(/^src\/.+\.test\.tsx?$/);
      expect(KINDS.has(kind), `unknown kind: ${kind}`).toBe(true);
      expect(signature).toMatch(SIGNATURE_RE);
      expect(arm.trim().length).toBeGreaterThan(0);
      expect(destination).toBe(`# ${DESTINATION}`);
    }
  });

  it("⛔ the ledger is at or under ENTRY_CEILING, and the ceiling is not STALE", () => {
    const entries = readEntries().length;
    // Lower bound on the ceiling: the shrink-only rule, checked here too so a
    // developer without Docker sees it. The gate enforces the same thing against
    // a RUN; this arm enforces it against the FILE.
    expect(
      entries,
      `the ledger carries ${entries} entr(y/ies) against ENTRY_CEILING = ${ENTRY_CEILING}. ` +
        "⛔ This ledger is SHRINK-ONLY: a new failing arm is FIXED, not ledgered.",
    ).toBeLessThanOrEqual(ENTRY_CEILING);
    // ⛔ RATCHET STALE — the direction the gate cannot see. A ceiling left above
    // a ledger that correctly shrank has silently handed back room to grow.
    expect(
      ENTRY_CEILING,
      `RATCHET STALE: the ledger is down to ${entries} entr(y/ies) but ENTRY_CEILING is still ` +
        `${ENTRY_CEILING}, which re-opens ${ENTRY_CEILING - entries} slot(s) the ledger already gave up. ` +
        "Lower ENTRY_CEILING in scripts/live-db-execution-ledger.mjs to match, in the commit that shrank it.",
    ).toBe(entries);
  });

  it("⛔ the derived corpus is at or above CORPUS_FLOOR, and the floor is not STALE", () => {
    const corpusSize = liveDbLaneCorpus().length;
    // The lane's `include` and the gate's `corpusSize` come from this ONE
    // derivation, so dropping a file's gate-symbol reference narrows BOTH sides
    // at once and the gate's CORPUS MISMATCH arm compares the narrowed run to the
    // narrowed expectation and finds them equal. How far the floor sits below the
    // measured corpus IS the size of that blind spot.
    expect(
      corpusSize,
      `the derived live-DB corpus collapsed to ${corpusSize}, under CORPUS_FLOOR = ${CORPUS_FLOOR}`,
    ).toBeGreaterThanOrEqual(CORPUS_FLOOR);
    // ⛔ RATCHET STALE. The floor must track the corpus within the slack band, or
    // the headroom the floor is supposed to bound quietly grows back.
    const RATCHET_SLACK = 3;
    expect(
      corpusSize - CORPUS_FLOOR,
      `RATCHET STALE: the corpus is ${corpusSize} files but CORPUS_FLOOR is ${CORPUS_FLOOR}, leaving ` +
        `${corpusSize - CORPUS_FLOOR} files of silent narrowing headroom (max ${RATCHET_SLACK}). ` +
        "Raise CORPUS_FLOOR in scripts/live-db-lane-corpus.mjs.",
    ).toBeLessThanOrEqual(RATCHET_SLACK);
  });

  it("⛔ no entry carries a specimen — this repository is PUBLIC and this file is TRACKED", () => {
    for (const fields of readEntries()) {
      // Field 1 is a repo-relative module path, asserted above; the specimen scan
      // runs over the fields a human wrote prose into.
      const payload = fields.slice(1).join(" ");
      expect(payload, "an absolute POSIX path reached the ledger").not.toMatch(/(^|\s)\/(Users|home|var|tmp)\//);
      expect(payload, "a Windows-style absolute path reached the ledger").not.toMatch(/[A-Za-z]:\\/);
      expect(payload, "a URL reached the ledger").not.toMatch(/\bhttps?:\/\//);
      expect(payload, "a database connection string reached the ledger").not.toMatch(
        /\b(postgres(ql)?|redis|amqp):\/\//,
      );
      expect(payload, "a JWT-shaped literal reached the ledger").not.toMatch(/\beyJ[A-Za-z0-9_-]{6,}/);
      expect(payload, "a long opaque token reached the ledger").not.toMatch(/\b[A-Za-z0-9_-]{40,}\b/);
    }
  });
});
