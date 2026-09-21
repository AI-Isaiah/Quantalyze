/**
 * Source-shape pairing gate for [164.9-MUTEX-HOLDER-DIED-UNSERIALIZED]
 * (Phase 164.9 plan 02, ROADMAP criterion 12).
 *
 * The dead-holder DETECTION (the "died BEFORE this release step" annotation
 * inside each "Release shared-test-db mutex (best effort)" step) is only
 * half the fix — the other half is that every site carrying that detection
 * has a PAIRED "Verdict — shared-test-db mutex holder died mid-job" step
 * that turns it into a real job verdict. This file is the machine-enforced
 * version of that pairing: a sixth DB-touching job that copies the release
 * step without also adding its verdict step fails this file.
 *
 * ⛔ Both sides of the pairing comparison in Test 1 are DERIVED from the
 * workflow files on disk, never hard-coded — a hard-coded pair count would
 * go stale the moment a sixth site is added, which is exactly the case this
 * gate exists to catch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const readText = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");

const WORKFLOW_DIR = ".github/workflows";
// The three files this plan touches — named explicitly, matching the plan's
// own "for each of the three workflow files" framing (not a dynamic glob:
// the corpus this gate polices is exactly these three, per the ROADMAP/
// CONTEXT record of where the shared-test-db mutex's holders live).
const TARGET_FILES = [
  `${WORKFLOW_DIR}/ci.yml`,
  `${WORKFLOW_DIR}/supabase-migrate.yml`,
  `${WORKFLOW_DIR}/test-restore-from-baseline.yml`,
];

const RELEASE_STEP_NAME = "Release shared-test-db mutex (best effort)";
const VERDICT_STEP_NAME = "Verdict — shared-test-db mutex holder died mid-job";
const DEAD_HOLDER_ANNOTATION = "died BEFORE this release step";
const VERDICT_INVOCATION = "run: bash scripts/mutex-dead-holder-verdict.sh";
const NEVER_REDDEN_INVARIANT = "must never redden a job whose real work passed";

/**
 * Split a workflow file's raw text into its top-level steps, keyed by
 * `- name: <step name>` lines. Each step's `body` runs from its own
 * `- name:` line up to (but not including) the NEXT `- name:` line, or EOF.
 * This is intentionally naive about job boundaries — a step body never
 * needs to know which job it lives in for anything asserted below, and a
 * step is never split across a job boundary in this corpus (every step
 * belongs to exactly one job's `steps:` list).
 */
function extractSteps(src: string): Array<{ name: string; body: string }> {
  const lines = src.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*name:\s*/.test(lines[i])) starts.push(i);
  }
  const steps: Array<{ name: string; body: string }> = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const name = lines[start].replace(/^\s*-\s*name:\s*/, "").trim();
    steps.push({ name, body: lines.slice(start, end).join("\n") });
  }
  return steps;
}

describe("mutex-dead-holder-verdict source-shape gate", () => {
  // ─────────────────────────────────────────────────────────────────────
  // Test 1: per-file pairing. The count of "Release ... (best effort)"
  // steps that carry the dead-holder annotation MUST equal the count of
  // "Verdict ..." steps, asserted PER FILE — a missing verdict in one file
  // cannot be masked by a surplus in another.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 1: every dead-holder release step is paired with a verdict step, per file", () => {
    for (const rel of TARGET_FILES) {
      it(`${rel} — release-with-annotation count equals verdict count`, () => {
        const steps = extractSteps(readText(rel));
        const releaseWithAnnotation = steps.filter(
          (s) => s.name === RELEASE_STEP_NAME && s.body.includes(DEAD_HOLDER_ANNOTATION),
        );
        const verdicts = steps.filter((s) => s.name === VERDICT_STEP_NAME);
        expect(
          verdicts.length,
          `${rel}: ${releaseWithAnnotation.length} dead-holder release step(s) but ` +
            `${verdicts.length} verdict step(s) — every site carrying the annotation ` +
            `needs a paired "${VERDICT_STEP_NAME}" step directly after it.`,
        ).toBe(releaseWithAnnotation.length);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: anti-vacuity floor. A corpus that shrank to zero release sites
  // would satisfy Test 1 trivially (0 == 0); this floor makes sure the
  // corpus this gate polices is not empty.
  // ─────────────────────────────────────────────────────────────────────
  it("Test 2: at least 5 dead-holder annotations exist across the three files (anti-vacuity floor)", () => {
    let total = 0;
    for (const rel of TARGET_FILES) {
      const src = readText(rel);
      const matches = src.match(new RegExp(DEAD_HOLDER_ANNOTATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      total += matches ? matches.length : 0;
    }
    expect(
      total,
      `aggregate dead-holder annotation count across the three files is ${total} — expected at least 5. ` +
        `A corpus that shrank to zero would make Test 1 pass vacuously.`,
    ).toBeGreaterThanOrEqual(5);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: every verdict step carries `if: always()` and invokes the
  // verdict script bare — no wrapper, pipe, or flag.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 3: every verdict step is if: always() and invokes the script bare", () => {
    for (const rel of TARGET_FILES) {
      it(`${rel} — verdict step(s) carry if: always() and a bare invocation`, () => {
        const steps = extractSteps(readText(rel)).filter((s) => s.name === VERDICT_STEP_NAME);
        for (const step of steps) {
          expect(
            /^\s*if:\s*always\(\)\s*$/m.test(step.body),
            `${rel}: a "${VERDICT_STEP_NAME}" step does not carry "if: always()":\n${step.body}`,
          ).toBe(true);
          const runLine = step.body
            .split("\n")
            .find((l) => /^\s*run:/.test(l));
          expect(
            runLine?.trim(),
            `${rel}: a "${VERDICT_STEP_NAME}" step's run: line is not the bare invocation ` +
              `"${VERDICT_INVOCATION}" (no wrapper, pipe, or flag). Body:\n${step.body}`,
          ).toBe(VERDICT_INVOCATION);
        }
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 4: the existing best-effort release step's never-redden invariant
  // survives — its comment still states the invariant, and no `exit 1`
  // appears inside any release step body.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 4: the release step's never-redden invariant is untouched", () => {
    for (const rel of TARGET_FILES) {
      it(`${rel} — release step(s) still state the invariant and never exit 1`, () => {
        const steps = extractSteps(readText(rel)).filter((s) => s.name === RELEASE_STEP_NAME);
        expect(
          steps.length,
          `${rel}: no "${RELEASE_STEP_NAME}" step found — the invariant has nothing to check.`,
        ).toBeGreaterThan(0);
        for (const step of steps) {
          // The invariant sentence wraps across multiple `# `-prefixed
          // comment lines in source. Join comment continuation lines into
          // one space-separated string before searching — this searches
          // the SAME bytes, just without the line-wrap and comment-marker
          // noise that would otherwise split the sentence across a "\n".
          const normalized = step.body.replace(/\n\s*#\s*/g, " ").replace(/\s+/g, " ");
          expect(
            normalized.includes(NEVER_REDDEN_INVARIANT),
            `${rel}: a "${RELEASE_STEP_NAME}" step no longer states "${NEVER_REDDEN_INVARIANT}".`,
          ).toBe(true);
          expect(
            /(^|[^0-9a-zA-Z])exit 1\b/.test(step.body),
            `${rel}: a "${RELEASE_STEP_NAME}" step body contains "exit 1" — this step must ` +
              `never exit non-zero, by design.\n${step.body}`,
          ).toBe(false);
        }
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 5: the verdict script's own self-test proves both directions and
  // reports a derived check count.
  // ─────────────────────────────────────────────────────────────────────
  it("Test 5: scripts/mutex-dead-holder-verdict.sh --self-test exits 0 and reports a check count", () => {
    const res = spawnSync("bash", ["scripts/mutex-dead-holder-verdict.sh", "--self-test"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(res.status, `self-test stdout+stderr:\n${res.stdout}\n${res.stderr}`).toBe(0);
    const m = /self-test OK \((\d+) checks\)/.exec(res.stdout ?? "");
    expect(m, `the self-test must SAY how many checks it ran. stdout:\n${res.stdout}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  });
});
