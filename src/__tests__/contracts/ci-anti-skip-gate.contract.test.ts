import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("still runs psql with -X, like the sibling invocations in the same job", () => {
    expect(SCRIPT).toContain('psql "$TEST_SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$f"');
  });

  it("does not re-introduce the empty-corpus 'exit 0' anywhere in the step", () => {
    expect(SCRIPT).not.toMatch(/^\s*exit 0\s*$/m);
  });
});
