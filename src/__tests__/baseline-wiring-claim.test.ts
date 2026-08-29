/**
 * WR-04 / gap G1 — `BASELINE.md`'s claim about its consumer must match the
 * consumer.
 *
 * ⛔ THE DEFECT. `supabase/schema/BASELINE.md` opened with, in the present
 * tense: *"It **is** the schema source for the VAC-07 local-stack lane."* The
 * lane reads a different path — `scripts/local-stack/run.sh:50` sets
 * `BASELINE_FILE="${LANE_DIR}/baseline.sql"`, i.e.
 * `scripts/local-stack/baseline.sql`, which `.gitignore:138` ignores and which
 * does not exist in a checkout. MEASURED 2026-08-29: `bash
 * scripts/local-stack/run.sh up` exits 1 with `FATAL: no schema baseline`. A
 * grep across `scripts/`, `.github/`, `package.json` and `src/` for
 * `supabase/schema/baseline.sql` found only the document making the claim.
 *
 * A claim never compared to the thing, inside the phase built to catch exactly
 * that — and it would read as "wired" to the next person.
 *
 * ⭐ WHAT THIS FILE IS. Correcting the sentence fixes it once. This makes the
 * two agree by machine, in EITHER direction: while the lane does not read the
 * committed baseline, the document must say so; the moment Phase 164.5
 * repoints `run.sh`, this test fails until the document is updated to match.
 * The prose cannot drift ahead of the wiring or behind it.
 *
 * ⚠️ Deliberately NOT fixed here: the wiring itself. VAC-07 is a dated founder
 * deferral (`.planning/phases/164.3-…/164.3-07-DEFERRED.md`), and repointing
 * `run.sh` would change plan 04's shipped behaviour without plan 04's gates
 * being re-run. 164.5 owns the repoint, the `.gitignore` removal and the
 * staleness gate as one change.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const RUN_SH = join(REPO_ROOT, "scripts", "local-stack", "run.sh");
const BASELINE_MD = join(REPO_ROOT, "supabase", "schema", "BASELINE.md");
const BASELINE_SQL = join(REPO_ROOT, "supabase", "schema", "baseline.sql");
const GITIGNORE = join(REPO_ROOT, ".gitignore");

/** The committed path, as the lane would have to name it to read it. */
const COMMITTED_PATH = "supabase/schema/baseline.sql";

/** Does the lane's BASELINE_FILE resolve to the committed artifact? */
function laneReadsCommittedBaseline(): boolean {
  const lines = readFileSync(RUN_SH, "utf8").split("\n");
  const assignments = lines.filter((l) => /^\s*BASELINE_FILE=/.test(l));
  // Zero assignments would mean the variable vanished — not "unwired", but a
  // question this test can no longer answer. Fail rather than guess.
  expect(
    assignments.length,
    "scripts/local-stack/run.sh no longer assigns BASELINE_FILE at all, so this test cannot tell " +
      "whether the lane reads the committed baseline. Re-point it at the real assignment.",
  ).toBeGreaterThan(0);
  return assignments.some((l) => l.includes(COMMITTED_PATH));
}

describe("WR-04 — BASELINE.md and the lane agree about who reads what", () => {
  it("the document's wiring claim matches the lane, in whichever state the lane is in", () => {
    const doc = readFileSync(BASELINE_MD, "utf8");
    const wired = laneReadsCommittedBaseline();

    if (wired) {
      expect(
        doc,
        `scripts/local-stack/run.sh now reads ${COMMITTED_PATH}, but BASELINE.md still carries its ` +
          `"NOT WIRED YET — this file currently has NO consumer" section. Delete that section and ` +
          `state the wiring, or the document now understates what exists.`,
      ).not.toContain("NOT WIRED YET");
    } else {
      expect(
        doc,
        `scripts/local-stack/run.sh does NOT read ${COMMITTED_PATH} — it points at the gitignored ` +
          `lane-local path and dies FATAL — so BASELINE.md must say so. It must not claim, in the ` +
          `present tense, to be the lane's schema source. Phase 164.5 owns the repoint.`,
      ).toContain("NOT WIRED YET");
      expect(doc).toContain("NO consumer");
      // The two facts are one fact: the lane path is invisible BECAUSE it is
      // gitignored. If the ignore line goes, the story changes.
      expect(
        readFileSync(GITIGNORE, "utf8"),
        "BASELINE.md explains the unwired state by pointing at the .gitignore entry for the " +
          "lane-local baseline path. That entry is gone, so the explanation is now stale.",
      ).toContain("scripts/local-stack/baseline.sql");
    }
  });

  it("the sha256 BASELINE.md records is the sha256 of the file it records", () => {
    // The document invites this comparison and nothing performed it. Until
    // 164.5's staleness gate exists, this at least keeps the recorded hash
    // honest about the committed bytes.
    const recorded = /\|\s*sha256\s*\|\s*`([0-9a-f]{64})`\s*\|/.exec(readFileSync(BASELINE_MD, "utf8"));
    expect(recorded, "BASELINE.md no longer records a sha256 in its provenance table").not.toBeNull();

    const actual = createHash("sha256").update(readFileSync(BASELINE_SQL)).digest("hex");
    expect(
      actual,
      `supabase/schema/baseline.sql does not hash to the value BASELINE.md records. Either the ` +
        `dump was regenerated without updating the provenance table, or the file was edited by hand. ` +
        `⚠️ This is NOT the staleness gate — it says nothing about whether PROD has moved on. That ` +
        `is Phase 164.5 / WINDOWS 29.`,
    ).toBe(recorded?.[1]);
  });
});
