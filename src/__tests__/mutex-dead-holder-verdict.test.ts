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
const VERDICT_SCRIPT_REL = "scripts/mutex-dead-holder-verdict.sh";
const VERDICT_INVOCATION = `run: bash ${VERDICT_SCRIPT_REL}`;
/**
 * ⛔ THE WORKSPACE-ROOTED SPELLING IS NOT A STYLE CHOICE — it is REQUIRED in any
 * job that sets `defaults.run.working-directory`, and MEASURED 2026-09-21 when
 * the `python` job (working-directory: analytics-service) shipped the bare
 * spelling and every run of it exited **127, "No such file or directory"**. That
 * is a FAILED verdict step on a healthy job — the precise inversion of a gate
 * whose whole purpose is to redden only on a real dead holder.
 *
 * ⚠️ THIS FILE IS WHY IT SHIPPED. The assertion below used to pin the run: line
 * to one literal string and the extractor above called itself "intentionally
 * naive about job boundaries" because "a step body never needs to know which job
 * it lives in". Both were true when written and the second stopped being true
 * the moment a verdict step landed in a job with a working directory: the test
 * asserted SPELLING and the defect was RESOLVABILITY, so it stayed green over a
 * step that could not run. Job identity is now load-bearing here.
 */
const VERDICT_INVOCATION_ROOTED = `run: bash "\${GITHUB_WORKSPACE}/${VERDICT_SCRIPT_REL}"`;

/**
 * Map a step's position in the file to the job that owns it, and say whether
 * that job pins a `defaults.run.working-directory`. Deliberately textual, to
 * match the rest of this file and to keep working on a YAML shape the parser
 * would normalise away.
 */
function jobsWithWorkingDirectory(src: string): Array<{ start: number; end: number; name: string }> {
  const lines = src.split("\n");
  const jobs: Array<{ start: number; end: number; name: string }> = [];
  const starts: Array<{ line: number; name: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(lines[i]);
    if (m) starts.push({ line: i, name: m[1] });
  }
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].line;
    const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
    const body = lines.slice(start, end);
    // Only a real `defaults: run: working-directory:` counts — not a mention of
    // the phrase inside a comment, of which this corpus has several.
    const hasWd = body.some((l) => /^\s{6,}working-directory:\s*\S/.test(l) && !/^\s*#/.test(l));
    if (hasWd) jobs.push({ start, end, name: starts[i].name });
  }
  return jobs;
}
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
  // 2026-09-25, Phase 164.4.2.1 D-07: the floor went 5 -> 4 because a holder
  // LEFT — `test-db-drift` no longer takes the shared-test-db key, so its
  // release step and dead-holder annotation went with it. The floor follows
  // the measured corpus; this is not a relaxation.
  // ─────────────────────────────────────────────────────────────────────
  it("Test 2: at least 4 dead-holder annotations exist across the three files (anti-vacuity floor)", () => {
    let total = 0;
    for (const rel of TARGET_FILES) {
      const src = readText(rel);
      const matches = src.match(new RegExp(DEAD_HOLDER_ANNOTATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      total += matches ? matches.length : 0;
    }
    expect(
      total,
      `aggregate dead-holder annotation count across the three files is ${total} — expected at least 4. ` +
        `A corpus that shrank to zero would make Test 1 pass vacuously.`,
    ).toBeGreaterThanOrEqual(4);
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
          const trimmed = runLine?.trim();
          expect(
            trimmed === VERDICT_INVOCATION || trimmed === VERDICT_INVOCATION_ROOTED,
            `${rel}: a "${VERDICT_STEP_NAME}" step's run: line is neither the bare invocation ` +
              `"${VERDICT_INVOCATION}" nor the workspace-rooted "${VERDICT_INVOCATION_ROOTED}" ` +
              `(no wrapper, pipe, or flag). Body:\n${step.body}`,
          ).toBe(true);
        }
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3b: THE ARM THAT WOULD HAVE CAUGHT THE 127.
  // A bare relative path resolves against the job's working directory, not the
  // repository root. In a job that pins `defaults.run.working-directory`, the
  // bare spelling cannot find the script and the step exits 127 on EVERY run —
  // a permanently failed gate that reports nothing about a dead holder. Pinning
  // the run: line to a literal string cannot see this; owning-job identity can.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 3b: a verdict step inside a working-directory job is workspace-rooted", () => {
    for (const rel of TARGET_FILES) {
      it(`${rel} — no verdict step can exit 127 on a bare relative path`, () => {
        const src = readText(rel);
        const lines = src.split("\n");
        const wdJobs = jobsWithWorkingDirectory(src);
        let checked = 0;
        for (let i = 0; i < lines.length; i++) {
          if (!new RegExp(`^\\s*-\\s*name:\\s*${VERDICT_STEP_NAME}\\s*$`).test(lines[i])) continue;
          // the run: line belongs to this step — the next one before any further `- name:`
          let runIdx = -1;
          for (let j = i + 1; j < lines.length; j++) {
            if (/^\s*-\s*name:/.test(lines[j])) break;
            if (/^\s*run:/.test(lines[j])) { runIdx = j; break; }
          }
          expect(runIdx, `${rel}: verdict step at line ${i + 1} has no run: line`).toBeGreaterThan(-1);
          const owner = wdJobs.find((j) => runIdx >= j.start && runIdx < j.end);
          if (!owner) continue; // job pins no working directory; the bare form resolves
          checked++;
          expect(
            lines[runIdx].trim(),
            `${rel}: the "${VERDICT_STEP_NAME}" step in job "${owner.name}" uses a BARE relative ` +
              `script path, but that job pins defaults.run.working-directory — the path resolves ` +
              `against the working directory, not the repo root, so this step exits 127 ` +
              `("No such file or directory") on EVERY run instead of ever reporting a dead holder. ` +
              `Use the workspace-rooted form.`,
          ).toBe(VERDICT_INVOCATION_ROOTED);
        }
        // Anti-vacuity: ci.yml MUST exercise this arm — the `python` job is the
        // measured case. A zero here means the scan stopped finding the steps,
        // not that the corpus got safer.
        if (rel.endsWith("ci.yml")) {
          expect(
            checked,
            "ci.yml: no verdict step was found inside a working-directory job — this arm " +
              "measured NOTHING. The `python` job is the known case; if it moved, re-aim the scan.",
          ).toBeGreaterThan(0);
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
  // Test 6: THE PAIRING IS NOTHING WITHOUT THE MARKER. Tests 1-4 pin the
  // step NAMES, the `if:`, the annotation and the never-redden invariant —
  // every one of which survives the deletion of ONE line: the release step's
  // `: > "${RUNNER_TEMP}/<marker>"` write. Delete it and every gate stays
  // green while the verdict step goes PERMANENTLY green, because the verdict
  // script reads a marker file and nothing else.
  //
  // ⛔ BOTH SIDES ARE DERIVED. The marker's name is read out of
  // scripts/mutex-dead-holder-verdict.sh's own MARKER_PATH assignment and
  // out of each release step's own write line — never spelled here. A
  // hard-coded name would go stale on a rename and would itself be the
  // "hand-copied literal wearing a claim that it is not a paraphrase" this
  // test exists to make impossible.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 6: every dead-holder release step WRITES the marker, at the path the verdict script READS", () => {
    const VERDICT_SH = "scripts/mutex-dead-holder-verdict.sh";
    /** The marker basename the verdict script computes, derived from its source. */
    const verdictMarkerName = (() => {
      const src = readText(VERDICT_SH);
      const lines = src.split("\n").filter((l) => /^\s*MARKER_PATH=/.test(l));
      expect(
        lines.length,
        `${VERDICT_SH}: expected exactly ONE MARKER_PATH assignment, found ${lines.length}. ` +
          `This test derives the marker name from that line; two of them means the script no ` +
          `longer has one answer to "which file do I read".`,
      ).toBe(1);
      const m = /\}\/([A-Za-z0-9._-]+)"\s*$/.exec(lines[0]);
      expect(
        m,
        `${VERDICT_SH}: could not derive a marker basename from its MARKER_PATH line:\n${lines[0]}`,
      ).not.toBeNull();
      return m![1];
    })();

    it(`the verdict script's marker name parsed as a non-empty basename`, () => {
      // Anti-vacuity: an empty name would make every comparison below trivially
      // agree with an empty capture on the ci.yml side.
      expect(verdictMarkerName.length).toBeGreaterThan(0);
    });

    for (const rel of TARGET_FILES) {
      it(`${rel} — each dead-holder release step writes exactly one marker, named "${verdictMarkerName}"`, () => {
        const steps = extractSteps(readText(rel)).filter(
          (s) => s.name === RELEASE_STEP_NAME && s.body.includes(DEAD_HOLDER_ANNOTATION),
        );
        expect(
          steps.length,
          `${rel}: no "${RELEASE_STEP_NAME}" step carries the dead-holder annotation — Test 1 would ` +
            `pair 0 with 0 and this test would assert nothing.`,
        ).toBeGreaterThan(0);
        for (const step of steps) {
          const writes = step.body
            .split("\n")
            .map((l) => /^\s*: > "\$\{RUNNER_TEMP\}\/([A-Za-z0-9._-]+)"\s*$/.exec(l))
            .filter((m): m is RegExpExecArray => m !== null);
          expect(
            writes.length,
            `${rel}: a "${RELEASE_STEP_NAME}" step carrying "${DEAD_HOLDER_ANNOTATION}" contains ` +
              `${writes.length} marker-write line(s); expected exactly 1. With ZERO, the annotation ` +
              `still prints and every other arm of this file still passes, while ` +
              `"${VERDICT_STEP_NAME}" reads a file nobody writes and goes green forever — the ` +
              `detection survives and the CONSEQUENCE silently does not.\n${step.body}`,
          ).toBe(1);
          expect(
            writes[0][1],
            `${rel}: the release step writes its dead-holder marker as "${writes[0][1]}" while ` +
              `${VERDICT_SH} reads "${verdictMarkerName}". Both files stay individually sensible ` +
              `and the verdict can never fire again. Rename both in the same commit.`,
          ).toBe(verdictMarkerName);
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
