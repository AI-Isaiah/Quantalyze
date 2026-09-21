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
 * ⚠️ It deliberately does NOT pin the per-kind tally (9 / 6 / 3). That is a
 * MEASUREMENT of the current tree, it is expected to shrink, and restating it
 * here would make a correct shrink red — the exact "prose beside a constant"
 * defect `CLAUDE.md` records four times over.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
