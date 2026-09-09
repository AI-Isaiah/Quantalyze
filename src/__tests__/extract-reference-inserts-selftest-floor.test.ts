/**
 * The reference-data extractor's SELF-TEST CORPUS RATCHET — layer 2.
 *
 * ⛔ WHY THIS FILE EXISTS (164.8.1 review, finding 1). `selfTest()` printed
 * `extract-reference-inserts self-test OK: ${SELF_TEST_KINDS.length} kinds,
 * red+green each.` and that length was compared to NOTHING. MEASURED
 * 2026-09-09 at HEAD before the fix: deleting the `c1-dollar-body` kind — the
 * leg that falsifies RESEARCH assumption A4, i.e. the ONE arm proving `maskSql`
 * splits DO bodies at inner `;` and that `dollarBodyRanges()` is the correct
 * independent scan — still printed `OK: 15 kinds` and exited 0, green in both
 * the `sql-gate-lint` job and the restore workflow. A corpus that can shrink to
 * nothing without a single red is not a control.
 *
 * TWO FLOORS, TWO LAYERS — the rule CLAUDE.md states for
 * `scripts/mutation-runner/run.mjs`, and the shape
 * `src/__tests__/mutation-runner-floors.test.ts` already implements:
 *
 *   - layer 1, the SCRIPT: `selfTest()` refuses when the corpus is BELOW
 *     `SELF_TEST_KINDS_FLOOR`, so a deletion reddens CI with no vitest
 *     involved. By construction a floor set below the corpus is invisible to
 *     it — the script can never notice its own staleness;
 *   - layer 2, HERE: the stale-LOW direction (`RATCHET STALE: …`, the same
 *     wording `FILES_FLOOR` uses), plus the load-bearing kind IDs pinned BY
 *     NAME so a delete-one-add-one — which nets zero on the count — still
 *     reddens.
 *
 * The IDs below are re-stated deliberately rather than derived from the array
 * under test: a list read out of the subject agrees with the subject by
 * construction and proves nothing about which refusals still exist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SELF_TEST_KINDS,
  SELF_TEST_KINDS_FLOOR,
} from "../../scripts/extract-reference-inserts.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "extract-reference-inserts.mjs");

/**
 * Every refusal kind the extractor shipped on 2026-09-09, MEASURED from
 * `node scripts/extract-reference-inserts.mjs --self-test` → `OK: 19 kinds`.
 * Each entry is a distinct way the extractor refuses; losing any of them means
 * a shape it used to refuse becomes replayable into shared TEST silently.
 */
const REQUIRED_KINDS = [
  "audit-count-drift",
  "audit-unlisted",
  "bad-schema",
  "c1-dollar-body",
  "c2-insert-select",
  "c2-nonliteral-tuple",
  "count-mismatch-high",
  "count-mismatch-low",
  "dollar-tag-in-span",
  "malformed-line",
  "no-consumer",
  "txn-control",
  "unknown-migration",
  "unterminated-quote",
  "unterminated-statement",
  "zero-span",
];

describe("SELF_TEST_KINDS_FLOOR — the extractor's self-test corpus is ratcheted", () => {
  it("is a positive integer — a floor of 0 could never fire", () => {
    expect(Number.isInteger(SELF_TEST_KINDS_FLOOR)).toBe(true);
    expect(SELF_TEST_KINDS_FLOOR).toBeGreaterThan(0);
  });

  it("matches the measured corpus exactly — drift in EITHER direction fails", () => {
    const n = SELF_TEST_KINDS.length;
    expect(
      n,
      n < SELF_TEST_KINDS_FLOOR
        ? `REGRESSION: the extractor declares ${n} self-test kind(s), below the pinned floor of ${SELF_TEST_KINDS_FLOOR}. A refusal kind was deleted — restore it. The floor comes down only in review, with the reason.`
        : `RATCHET STALE: the extractor declares ${n} self-test kind(s) but SELF_TEST_KINDS_FLOOR is still ${SELF_TEST_KINDS_FLOOR}. Raise SELF_TEST_KINDS_FLOOR in scripts/extract-reference-inserts.mjs to ${n}, from a MEASURED \`--self-test\` run.`,
    ).toBe(SELF_TEST_KINDS_FLOOR);
  });

  it("the SCRIPT gates on the floor itself — layer 1 exists, so a deletion reddens CI without vitest", () => {
    // Asserted on the source: the floor comparison must live in the self-test's
    // own failure path, not only in this file. A ratchet whose only reader is
    // the test suite is absent from the two workflows that run the script.
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toMatch(/if \(SELF_TEST_KINDS\.length < SELF_TEST_KINDS_FLOOR\)/);
    expect(src).toContain("SELF_TEST_KINDS_FLOOR regression:");
  });
});

describe("the load-bearing refusal kinds are present BY NAME", () => {
  it("⛔ c1-dollar-body — RESEARCH A4's falsifier — exists", () => {
    // Singled out because it is the only arm that can tell a working
    // `insideBody()` guard from a removed one: without it, an INSERT inside a
    // dollar-quoted DO body becomes replayable and every other leg stays green.
    const kind = SELF_TEST_KINDS.find((k) => k.id === "c1-dollar-body");
    expect(
      kind,
      "`c1-dollar-body` is gone. It is the leg that proves maskSql splits DO bodies at inner `;` and that dollarBodyRanges() is the independent scan that excludes them (limitation 3 in the script header). Deleting it makes a body INSERT replayable with CI green.",
    ).toBeDefined();
    expect(kind?.expect).toBe("inside a dollar-quoted body");
  });

  it("every kind measured on 2026-09-09 is still declared — delete-one-add-one nets zero on the COUNT and fails here", () => {
    const ids = SELF_TEST_KINDS.map((k) => k.id);
    const missing = REQUIRED_KINDS.filter((id) => !ids.includes(id));
    expect(
      missing,
      `refusal kind(s) removed from the extractor's self-test corpus: ${missing.join(", ")}. Each one is a shape the extractor refuses; without its leg, nothing proves the refusal still fires.`,
    ).toEqual([]);
  });

  it("the ids are unique — a duplicate would inflate the count while covering one shape", () => {
    const ids = SELF_TEST_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no kind can pass vacuously — an empty `expect` matches every stderr", () => {
    // `selfTest()` distinguishes "fired for the right reason" from "fired at
    // all" solely by `red.stderr.includes(kind.expect)`. `"".includes` is true
    // of everything, so an empty string would turn a leg into a leg that cannot
    // fail — the shape this repository refuses everywhere else.
    for (const k of SELF_TEST_KINDS) {
      expect(typeof k.expect, `${k.id}: \`expect\` must be a string`).toBe("string");
      expect(k.expect.length, `${k.id}: an empty \`expect\` makes the red leg unfalsifiable`).toBeGreaterThan(3);
      expect(k.why.length, `${k.id}: a kind must say why it exists`).toBeGreaterThan(0);
    }
  });
});
