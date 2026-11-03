/**
 * Phase 190 plan 05 (SC-6) — the snapshot key is ONE literal in two languages.
 *
 * WHY (Rule 9). Plan 09 writes the last-success snapshot in Python
 * (`LAST_SUCCESS_SNAPSHOT_KEY` in `analytics-service/services/job_worker.py`) and
 * plan 03 reads it in TypeScript (`LAST_SUCCESS_SNAPSHOT_KEY` in
 * `stored-analytics-result.ts`). A key renamed on either side alone would silently
 * turn every derive-window factsheet back into the queued placeholder, with no
 * error anywhere: the reader would simply never find the writer's snapshot. No
 * other test spans both languages, so this one reads the committed Python file
 * from disk, as `marksource-okx-census-sql.test.ts` reads its SQL files.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAST_SUCCESS_SNAPSHOT_KEY } from "./stored-analytics-result";

const JOB_WORKER = join(process.cwd(), "analytics-service", "services", "job_worker.py");

describe("LAST_SUCCESS_SNAPSHOT_KEY parity (phase 190)", () => {
  it("the Python writer and the TypeScript reader use the same literal", () => {
    const text = readFileSync(JOB_WORKER, "utf8");
    // Anchored on a whole line, so a docstring that mentions the symbol is not a match.
    const matches = [...text.matchAll(/^LAST_SUCCESS_SNAPSHOT_KEY\s*:\s*Final\[str\]\s*=\s*"([^"]*)"\s*$/gm)];
    expect(
      matches.length,
      "exactly one LAST_SUCCESS_SNAPSHOT_KEY assignment must exist in job_worker.py",
    ).toBe(1);
    expect(matches[0][1]).toBe(LAST_SUCCESS_SNAPSHOT_KEY);
  });
});
