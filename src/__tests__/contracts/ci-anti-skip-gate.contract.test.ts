import { afterAll, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 161.1-REVIEW F10 — the pin for the anti-SKIP CI gate.
 *
 * ci.yml's "Run SQL self-tests" step is the guard that guards the other guards:
 * it is what makes a supabase/tests file that prints `SKIP:` and exits 0 fail
 * the job instead of counting as a pass. Until this file existed, NOTHING
 * pinned it. Zero hits across src/__tests__ for `ARMS EXECUTED`,
 * `sentinels_declared` or the step's log path; reverting the whole block left
 * vitest and pytest fully green. The auditor's phrasing was exact: "I cannot
 * name an input that fails if the anti-SKIP gate is deleted." This file is that
 * input.
 *
 * ⛔ It is deliberately NOT a set of grep assertions over the YAML. A grep pin
 * goes green the moment someone keeps the strings and guts the logic — the
 * defanging case, which is the likelier one. So this test EXTRACTS the step's
 * shell script out of ci.yml and RUNS it against the real 67-file corpus with a
 * stub `psql` on PATH, and asserts on exit codes. Deleting the step makes
 * extraction throw; weakening any branch makes a scenario stop failing.
 *
 * The stub is enough because every property under test is shell logic — which
 * markers are matched, which conditions exit non-zero. No database is involved
 * in the decision the gate makes.
 */

const ROOT = process.cwd();
const STEP_NAME = "Run SQL self-tests against test Supabase project";
const CI_YML = join(ROOT, ".github/workflows/ci.yml");

/** Pull a step's `run: |` body out of the workflow, dedented. */
function extractRunScript(yml: string, stepName: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start === -1) {
    throw new Error(
      `ci.yml has no step named "${stepName}". The anti-SKIP gate is what makes a ` +
        `supabase/tests file that prints a skip and exits 0 fail the job. If it was ` +
        `renamed, update STEP_NAME here; if it was deleted, the SQL suite can go ` +
        `silently vacuous again and this test is the only thing that says so.`,
    );
  }
  const runIdx = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  if (runIdx === -1) throw new Error(`step "${stepName}" has no "run: |" body`);
  const indent = lines[runIdx].length - lines[runIdx].trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(runIdx + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return `${body.join("\n")}\n`;
}

const YML = readFileSync(CI_YML, "utf8");
const SCRIPT = extractRunScript(YML, STEP_NAME);

// A `psql` that prints what a real run would print, driven by env so each
// scenario can inject exactly one defect.
const PSQL_STUB = `#!/bin/bash
f=""; c=""; prev=""
for a in "$@"; do
  if [ "$prev" = "-f" ]; then f="$a"; fi
  if [ "$prev" = "-c" ]; then c="$c$a"; fi
  prev="$a"
done
if [ -n "$c" ]; then
  case "$c" in
    *ANTISKIP*)
      if [ "\${STUB_DARK:-0}" != "1" ]; then echo "NOTICE:  ANTISKIP-NOTICE-CHANNEL-OK"; fi
      echo "DO"; exit 0;;
  esac
  exit 0
fi
b="$(basename "$f")"
# One arbitrary extra output line, for a scenario that needs a NOTICE the
# corpus file does not itself dictate (the runtime-composed partial label).
if [ -n "\${STUB_EXTRA:-}" ]; then echo "\${STUB_EXTRA}"; fi
if [ "\${STUB_SKIP_BASENAME:-}" = "$b" ]; then
  m="$(grep -aoE "RAISE NOTICE 'SKIP: [^'%]{0,60}" "$f" | sed "s/^.*RAISE NOTICE '//" | head -1)"
  echo "psql:$f:1: \${STUB_LABEL:-NOTICE}:  \${m}"
  exit 0
fi
if [ "\${STUB_NO_SENTINEL:-}" != "$b" ]; then
  s="$(grep -aoE "ALL [0-9]+ ARMS EXECUTED[^']*" "$f" | head -1)"
  if [ -n "$s" ]; then echo "psql:$f:1: NOTICE:  \${s}"; fi
fi
exit 0
`;

const workdir = mkdtempSync(join(tmpdir(), "antiskip-"));
const bindir = join(workdir, "bin");
mkdirSync(bindir);
writeFileSync(join(bindir, "psql"), PSQL_STUB);
chmodSync(join(bindir, "psql"), 0o755);
const scriptPath = join(workdir, "step.sh");
writeFileSync(scriptPath, SCRIPT);

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

function runGate(env: Record<string, string> = {}, cwd: string = ROOT) {
  const runnerTemp = mkdtempSync(join(tmpdir(), "antiskip-rt-"));
  const res = spawnSync("bash", [scriptPath], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bindir}:${process.env.PATH ?? ""}`,
      TEST_SUPABASE_DB_URL: "postgresql://stub",
      RUNNER_TEMP: runnerTemp,
      ...env,
    },
  });
  rmSync(runnerTemp, { recursive: true, force: true });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/**
 * A one-file corpus whose skip labels carry glob metacharacters (F15).
 *
 * The gate splits its marker lists with an UNQUOTED expansion under
 * `shopt -s nullglob`, so before the fix a marker containing `*` matched no
 * file and was deleted from the word list entirely — the loop body never ran
 * for it. Returned path is the cwd the gate runs in; caller removes it.
 */
function makeGlobMarkerCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "antiskip-glob-"));
  mkdirSync(join(dir, "supabase/tests"), { recursive: true });
  writeFileSync(
    join(dir, "supabase/tests/test_glob_marker.sql"),
    [
      "DO $$",
      "BEGIN",
      "  IF true THEN",
      "    RAISE NOTICE 'SKIP: cron job * not scheduled here';",
      "    RETURN;",
      "  END IF;",
      "END $$;",
      "DO $$",
      "BEGIN",
      "  IF true THEN",
      "    RAISE NOTICE 'SKIP Part 2: cron * absent';",
      "    RETURN;",
      "  END IF;",
      "END $$;",
      "",
    ].join("\n"),
  );
  return dir;
}

const GLOB_CORPUS_FILE = "supabase/tests/test_glob_marker.sql";

/**
 * A throwaway one-file corpus. Returned path is the cwd the gate runs in.
 *
 * Used by the sentinel-annotation cases below. Their subject is a defect in ONE
 * file's completion notice, and the real corpus deliberately contains no such
 * file — so the defect has to be constructed rather than borrowed.
 */
function makeSentinelCorpus(basename: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "antiskip-sent-"));
  mkdirSync(join(dir, "supabase/tests"), { recursive: true });
  writeFileSync(join(dir, `supabase/tests/${basename}`), body);
  return dir;
}

/** N arms' worth of real, reachable assertion sites. */
function armBodies(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `DO $$\nBEGIN\n  IF false THEN RAISE EXCEPTION 'arm ${i + 1} failed'; END IF;\nEND $$;`,
  ).join("\n");
}

describe("anti-SKIP CI gate (ci.yml sql-tests) — F10 pin", () => {
  it("passes a run where every file executes and prints its sentinel", () => {
    const { code, out } = runGate();
    expect(out).toContain("SQL self-tests passed");
    expect(code).toBe(0);
  }, 90_000);

  it("FAILS when a file prints a whole-file SKIP marker and exits 0, naming the file", () => {
    const target = "test_allocator_equity_derived_rls.sql";
    const { code, out } = runGate({ STUB_SKIP_BASENAME: target });
    expect(code).not.toBe(0);
    expect(out).toContain(`::error file=supabase/tests/${target}::printed a whole-file SKIP`);
  }, 90_000);

  it("still FAILS that skip when the server label is not English (F14 locale net)", () => {
    // The original gate anchored on psql's C-locale `NOTICE:` label, so a
    // localized server made it match nothing and report a FALSE PASS. The
    // locale-proof net reads the marker out of the .sql file instead.
    const target = "test_allocator_equity_derived_rls.sql";
    const { code, out } = runGate({ STUB_SKIP_BASENAME: target, STUB_LABEL: "HINWEIS" });
    expect(code).not.toBe(0);
    expect(out).toContain("printed a whole-file SKIP");
    // Guard the guard: prove the label really was foreign, so this case cannot
    // silently degrade into a duplicate of the test above.
    expect(out).toContain("HINWEIS:");
  }, 90_000);

  it("still FAILS a whole-file skip whose marker contains a glob metacharacter (F15)", () => {
    // The marker carries a `*` and the server label is foreign, so NET 2 cannot
    // rescue this: NET 1 is the only net left, which is precisely the situation
    // the unquoted-expansion bug turned off. Without `set -f` around the split,
    // nullglob deletes the marker from the word list and the gate prints NO skip
    // error at all — a localized server plus one `*` was a silent false pass.
    //
    // ⚠️ Exit code is NOT the discriminator here: this synthetic corpus declares
    // no completion sentinels, so the SENTINEL_FLOOR/ARMS_FLOOR checks fail the
    // step either way. Asserting on the skip error specifically is what makes
    // this test able to fail.
    const dir = makeGlobMarkerCorpus();
    try {
      const { out } = runGate(
        { STUB_SKIP_BASENAME: "test_glob_marker.sql", STUB_LABEL: "HINWEIS" },
        dir,
      );
      expect(out).toContain(`::error file=${GLOB_CORPUS_FILE}::printed a whole-file SKIP`);
      expect(out).toContain("SKIP: cron job * not scheduled here");
      // Guard the guard: prove NET 2 really was blind, so this can never decay
      // into a duplicate of the plain skip test above.
      expect(out).not.toMatch(/NOTICE: +SKIP:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("still NAMES an UNPOLICED partial skip whose label contains a glob metacharacter (F15)", () => {
    // Same defect in the sibling loop. Here it costs a warning rather than a
    // failure, but an unnamed partial skip is exactly the withheld coverage this
    // block exists to surface, so it must not vanish silently either.
    const dir = makeGlobMarkerCorpus();
    try {
      const { out } = runGate(
        { STUB_EXTRA: `psql:${GLOB_CORPUS_FILE}:11: HINWEIS:  SKIP Part 2: cron * absent` },
        dir,
      );
      expect(out).toContain("UNPOLICED partial skip(s): [SKIP Part 2: cron * absent]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("FAILS when NOTICE output is suppressed, instead of finding nothing and passing (F14)", () => {
    const { code, out } = runGate({ STUB_DARK: "1" });
    expect(code).not.toBe(0);
    expect(out).toContain("never reached this log");
  }, 90_000);

  it("FAILS on an empty corpus instead of exiting 0 before the loop (F11)", () => {
    const empty = mkdtempSync(join(tmpdir(), "antiskip-empty-"));
    mkdirSync(join(empty, "supabase/tests"), { recursive: true });
    const { code, out } = runGate({}, empty);
    rmSync(empty, { recursive: true, force: true });
    expect(code).not.toBe(0);
    expect(out).toContain("corpus is EMPTY");
  }, 90_000);

  it("FAILS when a file declares a completion sentinel but never prints it", () => {
    const target = "test_ledger_refresh_staleness.sql";
    const { code, out } = runGate({ STUB_NO_SENTINEL: target });
    expect(code).not.toBe(0);
    expect(out).toContain("never printed it");
  }, 90_000);

  it("propagates a real assertion failure (psql non-zero) unchanged", () => {
    // Pin the pre-existing behaviour so a future edit to the skip logic cannot
    // swallow the ordinary RAISE EXCEPTION path on its way past.
    expect(SCRIPT).toContain('if [ "$status" -ne 0 ]; then');
    expect(SCRIPT).toContain('exit "$status"');
  });

  it("keeps the arm-count floors that make a deleted arm visible (F12)", () => {
    // These two integers are the only expectation held OUTSIDE the .sql files,
    // so they are what catches "delete an arm, edit the file's own count down".
    // Raising them is normal. Lowering them must be a visible edit here — which
    // is exactly what this assertion forces into the diff.
    const sentinelFloor = /SENTINEL_FLOOR=(\d+)/.exec(SCRIPT);
    const armsFloor = /ARMS_FLOOR=(\d+)/.exec(SCRIPT);
    expect(sentinelFloor, "SENTINEL_FLOOR removed from the sql-tests step").not.toBeNull();
    expect(armsFloor, "ARMS_FLOOR removed from the sql-tests step").not.toBeNull();
    expect(Number(sentinelFloor![1])).toBeGreaterThanOrEqual(4);
    expect(Number(armsFloor![1])).toBeGreaterThanOrEqual(35);
    expect(SCRIPT).toContain('if [ "$sentinels_declared" -lt "$SENTINEL_FLOOR" ]; then');
    expect(SCRIPT).toContain('if [ "$arms_declared" -lt "$ARMS_FLOOR" ]; then');
  });

  /**
   * 161.1-RT E2 — the count↔roster coherence check, and its reach.
   *
   * A red team reproduced the floors' arithmetic exactly and then walked past
   * them three ways without editing ci.yml. The reachable half of that was the
   * coherence check's COVERAGE: it recognised one annotation shape, `(A-J)`,
   * which only the three ledger files use, so 26 of 54 arms — including every
   * arm pinning this phase's headline fix — had no expectation on them but
   * their own file's editable integer. The gate now accepts an explicit roster
   * too and REQUIRES one. These cases pin both halves.
   */
  it("FAILS a sentinel that declares a count but names no arms (E2: opt-in closed)", () => {
    // Before this, a file could decline the coherence check simply by not
    // annotating — the same opt-in defect F12 named one level down. `ALL 16 ARMS
    // EXECUTED:` in test_sync_status_marked_refresh_protected.sql was exactly
    // this shape, and it carries the whole of the CR-01 coverage.
    //
    // ⚠️ Exit code is NOT the discriminator: a one-file corpus is under both
    // floors regardless, so the step fails either way. Assert the error.
    const dir = makeSentinelCorpus(
      "test_bare_count.sql",
      `${armBodies(3)}\nDO $$\nBEGIN\n  RAISE NOTICE 'ALL 3 ARMS EXECUTED and passed';\nEND $$;\n`,
    );
    try {
      const { out } = runGate({}, dir);
      expect(out).toContain("::error file=supabase/tests/test_bare_count.sql::");
      expect(out).toContain("NAMES NONE OF THEM");
      // Guard the guard: the arm-count/RAISE-EXCEPTION check must NOT be what
      // fired, or this case would pass while the annotation rule was gone.
      expect(out).not.toContain("non-comment RAISE EXCEPTION");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("FAILS an explicit roster whose entries do not add up to the declared count (E2)", () => {
    // The roster form is what let the three unannotated files be covered without
    // relabelling their arms A..P. It has to be counted, not merely present.
    const dir = makeSentinelCorpus(
      "test_short_roster.sql",
      `${armBodies(4)}\nDO $$\nBEGIN\n  RAISE NOTICE 'ALL 4 ARMS EXECUTED (A, B, C) and passed';\nEND $$;\n`,
    );
    try {
      const { out } = runGate({}, dir);
      expect(out).toContain("declares 4 arms but names (A, B, C), which is 3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("still FAILS a letter range that contradicts the count (F12 regression)", () => {
    // The range form predates the roster and must not be swallowed by it: read
    // as a roster, `(A-H)` is ONE token, so a naive generalisation would report
    // "which is 1" for every ledger file and redden the real corpus. The range
    // branch is tried first; this case is what proves it still runs.
    const dir = makeSentinelCorpus(
      "test_bad_range.sql",
      `${armBodies(9)}\nDO $$\nBEGIN\n  RAISE NOTICE 'ALL 9 ARMS EXECUTED (A-H) and passed';\nEND $$;\n`,
    );
    try {
      const { out } = runGate({}, dir);
      expect(out).toContain("declares 9 arms but names (A-H), which is 8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("FAILS a padding file that declares arms it has no way to fail (E3)", () => {
    // The red team's cheapest evasion: a new supabase/tests file whose entire
    // content is one `RAISE NOTICE 'ALL 99 ARMS EXECUTED'` lifts arms_declared
    // past any floor and retires the ratchet, without touching ci.yml. An arm
    // that cannot RAISE cannot fail, so declaring more arms than there are
    // assertion sites is refused. The roster here is COMPLETE (99 entries), so
    // the annotation rule is satisfied and this case cannot pass by accident on
    // the wrong error.
    const roster = Array.from({ length: 99 }, (_, i) => String(i + 1)).join(", ");
    const dir = makeSentinelCorpus(
      "test_zz_pad.sql",
      `DO $$\nBEGIN\n  RAISE NOTICE 'ALL 99 ARMS EXECUTED (${roster})';\nEND $$;\n`,
    );
    try {
      const { out } = runGate({}, dir);
      expect(out).toContain("declares 99 arms but contains only 0 non-comment RAISE EXCEPTION");
      // Guard the guard: prove the roster really did satisfy the annotation rule.
      expect(out).not.toContain("NAMES NONE OF THEM");
      expect(out).not.toContain("which is");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("keeps ci.yml's per-file arm derivation re-derivable from the corpus (E1/E3)", () => {
    // The floors are two integers, and a comment above them spells out which
    // files contribute which counts so the next reader can re-derive the total
    // instead of trusting it. That comment is prose: on 2026-08-25 the recorded
    // derivation `(9 + 9 + 8 + 9)` matched no real set of files and nobody
    // noticed, which is the same self-consistent-and-invisible failure the
    // floors exist to catch, one level up. This test is what stops it recurring
    // — and it is also the only thing in the repo that notices a NEW
    // sentinel-bearing file, so a padding file cannot be added without the
    // derivation and the floors moving in the same diff.
    //
    // Rejected in ci.yml as a per-file manifest inside the workflow (too
    // stale-prone to stay honest in a comment); held HERE instead, where a stale
    // expectation fails loudly on the next run rather than rotting.
    const table = [...SCRIPT.matchAll(/^#\s+(test_[A-Za-z0-9_]+\.sql)\s+(\d+)\s*$/gm)].map(
      (m) => [m[1], Number(m[2])] as const,
    );
    expect(table.length, "ci.yml's ARMS_FLOOR derivation table is gone or reformatted").toBeGreaterThan(0);

    const testsDir = join(ROOT, "supabase/tests");
    const actual = new Map<string, number>();
    for (const name of readdirSync(testsDir)) {
      if (!name.startsWith("test_") || !name.endsWith(".sql")) continue;
      const src = readFileSync(join(testsDir, name), "utf8");
      const line = src
        .split("\n")
        .find((l) => /RAISE NOTICE '[^']*ALL \d+ ARMS EXECUTED/.test(l));
      if (!line) continue;
      actual.set(name, Number(/ALL (\d+) ARMS EXECUTED/.exec(line)![1]));
    }

    expect(
      [...actual.keys()].sort(),
      "the set of files declaring an 'ALL N ARMS EXECUTED' sentinel no longer matches ci.yml's " +
        "derivation table. A file gained or lost its sentinel, was renamed, or a new one appeared " +
        "(which is how the floors get retired by inflation) — update the table AND the floors.",
    ).toEqual(table.map(([f]) => f).sort());

    for (const [file, declared] of table) {
      expect(
        actual.get(file),
        `ci.yml's derivation credits ${file} with ${declared} arms; the file declares ` +
          `${actual.get(file) ?? "none"}. A derivation the next reader cannot re-derive is the ` +
          `exact defect the floors exist to remove, one level up — update the table AND ARMS_FLOOR.`,
      ).toBe(declared);
    }

    const sentinelFloor = Number(/SENTINEL_FLOOR=(\d+)/.exec(SCRIPT)![1]);
    const armsFloor = Number(/ARMS_FLOOR=(\d+)/.exec(SCRIPT)![1]);
    expect(sentinelFloor, "SENTINEL_FLOOR disagrees with its own derivation table").toBe(table.length);
    expect(armsFloor, "ARMS_FLOOR disagrees with the sum of its own derivation table").toBe(
      table.reduce((n, [, c]) => n + c, 0),
    );
  });

  it("does not claim the floors stop a .sql-only edit — that sentence was false", () => {
    // 161.1-RT. The block used to promise that lowering a floor "can no longer be
    // done inside a .sql file where nobody sees it". Three evasions needed no
    // ci.yml edit at all, so the promise was false, and an overstated gate is
    // worse than a modest one: it is what stops the next person building real
    // coverage. The corrected claim is narrow — the DECLARED TOTAL cannot be
    // reduced from inside a .sql file — and the residue is enumerated. This pin
    // is a string check on purpose: the defect being guarded is a WORDING one,
    // and nothing else in this file can see it.
    expect(SCRIPT).not.toContain("it can no longer be done inside a .sql file");
    expect(SCRIPT).toContain("THE DECLARED TOTAL CANNOT BE REDUCED FROM INSIDE A .sql");
    expect(SCRIPT).toContain("DECLARED IS NOT EXECUTED");
    // The run log is the protection on this repo (branch protection is OFF), so
    // the limit has to be printed, not just committed.
    expect(SCRIPT).toContain("the arm counts summed above are DECLARED, not executed");
  });

  it("still runs psql with -X, like the sibling invocations in the same job", () => {
    expect(SCRIPT).toContain('psql "$TEST_SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$f"');
  });

  it("does not re-introduce the empty-corpus 'exit 0' anywhere in the step", () => {
    expect(SCRIPT).not.toMatch(/^\s*exit 0\s*$/m);
  });
});
