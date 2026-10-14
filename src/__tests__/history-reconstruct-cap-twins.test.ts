/**
 * Phase 167.1.2.1 RECONMARKER, plan 07 Task 3 (D-09): the attempt cap has three
 * copies, and this test keeps the TypeScript one equal to the SQL one.
 *
 * The copies: `v_reconstruct_attempt_cap` in `enqueue_refresh_allocator_equity_for_all`
 * (the fan-out stops enqueueing there), `HISTORY_RECONSTRUCT_ATTEMPT_CAP` in
 * `analytics-service/services/equity_reconstruction.py`, and the one in
 * `src/lib/constants.ts` that the "history could not be rebuilt" note reads. A
 * comment does not keep three numbers equal; a test does. The Python half is
 * `analytics-service/tests/test_history_reconstruct_cap_twins.py`.
 *
 * Two pins, each of which can fail:
 *   1. TS == the integer read from the NEWEST migration that declares the SQL
 *      constant (read as text from the real tree, never typed here), so a later
 *      migration that moves the SQL cap reddens this test.
 *   2. Both == 5, hand-typed (D-09). The founder's number is typed on purpose, or
 *      the SQL and TS sides could move together and nothing would notice.
 *
 * No migration declaring the constant is a loud failure, never a vacuous pass.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_RECONSTRUCT_ATTEMPT_CAP } from "@/lib/constants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// D-09, hand-typed: the founder's decision. NOT derived from either side.
const D09_CAP = 5;

const DECL_RE = /v_reconstruct_attempt_cap\s+CONSTANT\s+integer\s*:=\s*(\d+)\s*;/i;

function sqlCap(): { file: string; value: number } {
  const declaring: { file: string; value: number }[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // A declaration quoted in a comment is not a declaration.
    const code = text
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const m = DECL_RE.exec(code);
    if (m) declaring.push({ file, value: Number(m[1]) });
  }
  expect(
    declaring.length,
    `no migration under ${MIGRATIONS_DIR} declares v_reconstruct_attempt_cap, so the SQL cap cannot be read and the TS cap is unpinned`,
  ).toBeGreaterThan(0);
  return declaring[declaring.length - 1];
}

describe("D-09 attempt cap twins (SQL, Python, TS)", () => {
  it("the TS cap equals v_reconstruct_attempt_cap in the newest migration that declares it", () => {
    const { file, value } = sqlCap();
    expect(
      HISTORY_RECONSTRUCT_ATTEMPT_CAP,
      `src/lib/constants.ts says ${HISTORY_RECONSTRUCT_ATTEMPT_CAP} but ${file} declares ${value}: the fan-out stops enqueueing at the SQL value, so the "history could not be rebuilt" note would appear at a different attempt than the one that ends the retries`,
    ).toBe(value);
  });

  it("the cap is the founder's five, on the SQL and the TS side", () => {
    const { file, value } = sqlCap();
    expect(value, `${file}: D-09 fixed the cap at ${D09_CAP}; change D-09 first, then all three copies`).toBe(D09_CAP);
    expect(HISTORY_RECONSTRUCT_ATTEMPT_CAP).toBe(D09_CAP);
  });
});
