/**
 * Red/green proof that the live-db-fixture-drift census is a BLOCKING, HERMETIC gate
 * (Phase 164.9, plan 03, ROADMAP criterion 13 / `[164.9-CREDENTIALED-TESTS-RED-AND-UNGATED]`).
 *
 * ⛔ FOUNDER RULE, MACHINE-CHECKED HERE, same idiom as `drift-check-scripts.test.ts` (VAC-04 /
 * VAC-08): a control that cannot fail is worse than no control. This file spawns the REAL
 * `scripts/live-db-fixture-drift-census.mjs` and asserts on its exit code and on counts parsed
 * out of its own stdout — never a restated number.
 *
 * ⛔ HERMETIC BY CONSTRUCTION, AND DELIBERATELY SO. `src/lib/test-helpers/live-db.ts`'s live-DB
 * gate symbol gates ~284 tests behind two live-DB credential environment variables, and the
 * `frontend-test` job in `.github/workflows/ci.yml` is explicitly forbidden from setting them —
 * doing so would un-skip that whole class and invalidate the coverage ratchet's denominator
 * (measured with those tests skipped). This file must never name either variable, in code OR in
 * prose, so a naive credential-count grep over this file — the mechanism
 * `.github/workflows/ci.yml` would use to police the prohibition — reads zero: the census this
 * file drives is entirely static and needs no database, so it can live inside the existing
 * shards without ever touching the boundary those shards exist to protect.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CENSUS_SCRIPT = "scripts/live-db-fixture-drift-census.mjs";
const BASELINE_FILE = "scripts/live-db-fixture-drift-baseline.txt";
// ⛔ RATCHETED 40 → 48 on 2026-09-21 (Phase 164.9 review round). MEASURED: this census
// walks 51 files, so a floor of 40 left ELEVEN files of silent narrowing headroom — the
// same stale-low shape the review round found in the lane corpus, in a second place.
//
// ⛔ THIS IS NOT `CORPUS_FLOOR` FROM `scripts/live-db-lane-corpus.mjs`, AND THE TWO MUST NOT
// BE UNIFIED. They guard DIFFERENT corpora and were measured on the same day at different
// sizes: the fixture-drift census walks 51 files, the live-DB LANE corpus walks 49. A review
// round recommended raising one "to match" the other on the assumption they were two spellings
// of one number; they are not. Merging them would make an honest change to either corpus red
// for a reason that has nothing to do with it.
const CORPUS_FLOOR = 48;

function runCensus(args: string[] = []) {
  const res = spawnSync("node", [CENSUS_SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

describe("live-db-fixture-drift census — blocking gate", () => {
  it("self-test exits 0 and reports a derived rule count", () => {
    const { status, out } = runCensus(["--self-test"]);
    expect(status, out).toBe(0);
    const m = /self-test OK \((\d+) rules, red\+green each\.\)/.exec(out);
    expect(m, `expected a derived rule count in: ${out}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it("the corpus scan exits 0 against the committed allowlist", () => {
    const { status, out } = runCensus();
    expect(status, out).toBe(0);
  });

  it(`anti-vacuity floor: the reported corpus size is at least ${CORPUS_FLOOR} (separate from the allowlist check)`, () => {
    // Deliberately does NOT assert on `status` — the summary line (and the corpus size it
    // carries) prints whether the run found zero findings or several. This test's ONLY job is
    // proving the corpus itself did not collapse; coupling it to exit status would make it
    // fail for the SAME reason as "the corpus scan exits 0" whenever a finding exists, which is
    // not what this floor is for.
    const { out } = runCensus();
    const m = /corpus (\d+) file\(s\)/.exec(out);
    expect(m, `expected a corpus size in: ${out}`).not.toBeNull();
    const corpusSize = Number(m![1]);
    expect(
      corpusSize,
      `corpus collapsed to ${corpusSize} (floor ${CORPUS_FLOOR}) — "the corpus scan exits 0" ` +
        "would otherwise pass for the wrong reason (nothing left to scan reads the same as " +
        "nothing left to find).",
    ).toBeGreaterThanOrEqual(CORPUS_FLOOR);
  });

  it("ratchet (stale-low direction): the allowlist's non-comment entries never exceed its own ENTRY_COUNT", () => {
    const text = readFileSync(resolve(process.cwd(), BASELINE_FILE), "utf8");
    const lines = text.split("\n");
    const declaredMatch = lines
      .map((l) => /ENTRY_COUNT:\s*(\d+)/.exec(l.trim()))
      .find((m) => m !== null);
    expect(declaredMatch, "no `# ENTRY_COUNT: N` line found in the allowlist").not.toBeNull();
    const declared = Number(declaredMatch![1]);

    const nonCommentEntries = lines.filter((raw) => {
      const t = raw.trim();
      return t !== "" && !t.startsWith("#");
    });

    expect(
      nonCommentEntries.length,
      `RATCHET STALE: allowlist carries ${nonCommentEntries.length} non-comment entries but its ` +
        `own ENTRY_COUNT still says ${declared}. The ledger shrinks only — move the count in the ` +
        "same commit as any entry removal.",
    ).toBeLessThanOrEqual(declared);

    // The census's own load-time check enforces the OTHER direction (declared !== actual fails
    // the run outright); this test only needs to prove the ledger never silently GREW past its
    // own declared count without the count moving too, per the ratchet-storage pattern this repo
    // already uses (src/__tests__/mutation-runner-floors.test.ts, contracts/ci-anti-skip-gate).
    expect(nonCommentEntries.length).toBe(declared);
  });
});
