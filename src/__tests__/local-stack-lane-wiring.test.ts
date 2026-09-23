/**
 * Phase 164.5 / VAC-07 — THE ANTI-TOMBSTONE PIN FOR THE LOCAL-STACK LANE.
 *
 * ⛔ WHY THIS FILE EXISTS. `LOCAL_STACK_LANE_FILES` are deliberately EXCLUDED from
 * `vitest.config.ts`'s jsdom project: they need a booted Supabase CLI stack
 * (PostgREST + GoTrue over HTTP) that the sharded `frontend-test` job has not got, so
 * leaving them in would redden every shard. The price of that exclusion is exact and
 * dangerous — a lane file with NO CI job that boots the lane runs NOWHERE, while
 * still reading as covered to every signal a reviewer looks at.
 *
 * That is not hypothetical. `src/__tests__/csv-finalize-rpc.test.ts` carries this
 * repository's tombstone for it: six live-DB cases, skip-gated on a flag that is
 * false in every CI shard by explicit instruction, over a function a migration had
 * DROPped. They never failed and they never ran, for months.
 * *"Coverage that cannot execute is worse than absent coverage."*
 *
 * This file runs in the ORDINARY shards — it reads files and asserts, it needs no
 * stack — and fails if any link in the chain is broken:
 *
 *   lane file exists  →  it is in LOCAL_STACK_LANE_FILES
 *                     →  vitest.config.ts EXCLUDES that list from the shards
 *                     →  vitest.local-stack.config.ts INCLUDES it
 *                     →  package.json's `test:local-stack` runs that config
 *                     →  ci.yml's `frontend-local-stack` job boots the lane and runs it
 *                     →  that job is in the `frontend` aggregator's `needs:` list
 *                     →  AND in its result loop (either alone leaves it advisory)
 *
 * It also asserts the lane files carry NO skip gate, because a lane job that runs a
 * silently-skipping spec reproduces the tombstone with all the wiring intact.
 *
 * And (Phase 164.4.2) that the lane's boot path REFUSES a baseline dump older than
 * supabase/migrations/ — a lane wired end to end onto a stale schema is green for
 * a catalogue that is not PROD's.
 */

// @vitest-environment node

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_STACK_LANE_FILES } from "../../vitest.local-stack-files";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(REPO_ROOT + rel, "utf8");

const CI = read(".github/workflows/ci.yml");
const LANE_JOB = "frontend-local-stack";
const RUN_SH = "scripts/local-stack/run.sh";

/** Non-blank, non-comment lines, trimmed — what bash will actually EXECUTE. */
const liveLines = (block: string) =>
  block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

/**
 * A top-level bash function's body, from `name() {` to its first column-0 `}`.
 * ⛔ A missing anchor FAILS by name: `indexOf` returns -1 and `slice(-1)` is the
 * last character, so a renamed function would otherwise leave every assertion
 * below running over an empty subject — and passing.
 */
function bashFunctionBody(src: string, name: string): string {
  const start = src.indexOf(`\n${name}() {\n`);
  expect(start, `${RUN_SH} no longer defines ${name}()`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start);
  expect(end, `could not find the end of ${name}() in ${RUN_SH}`).toBeGreaterThan(
    start,
  );
  return src.slice(start, end);
}

/**
 * The `frontend:` aggregator block, sliced out so "appears in the needs: list" is
 * asserted against the NEEDS LIST rather than anywhere in a 4,900-line file — the
 * job's own definition would otherwise satisfy a naive whole-file grep.
 */
function aggregatorBlock(): string {
  const start = CI.indexOf("\n  frontend:\n");
  expect(
    start,
    "the `frontend:` aggregator job is gone from ci.yml — branch protection gates on it",
  ).toBeGreaterThan(-1);
  const end = CI.indexOf("\n  sql-tests:\n", start);
  expect(end, "could not find the end of the `frontend:` block").toBeGreaterThan(
    start,
  );
  return CI.slice(start, end);
}

/**
 * The `frontend-local-stack:` job block, sliced out for the same reason
 * `aggregatorBlock()` slices the aggregator: a bare whole-file `toContain` is
 * satisfied by a YAML COMMENT anywhere in the 5,000-line file, so a job stripped
 * back to a checkout-only no-op — which still reports `success` — would leave every
 * one of these pins green. MEASURED 2026-09-08: commenting out all three `run:`
 * lines left the three whole-file assertions TRUE.
 */
function laneJobBlock(): string {
  const start = CI.indexOf(`\n  ${LANE_JOB}:\n`);
  expect(
    start,
    `the ${LANE_JOB} job is gone from ci.yml — the lane files are excluded from the shards, so without it they run NOWHERE`,
  ).toBeGreaterThan(-1);
  const end = CI.indexOf("\n  frontend-policy:\n", start);
  expect(
    end,
    `could not find the end of the ${LANE_JOB} block`,
  ).toBeGreaterThan(start);
  return CI.slice(start, end);
}

describe("VAC-07 — the local-stack lane is wired end to end (this pin runs in the ordinary shards)", () => {
  it("the lane list is non-empty and every file in it exists", () => {
    expect(
      LOCAL_STACK_LANE_FILES.length,
      "LOCAL_STACK_LANE_FILES is empty — either the lane was dismantled without removing its CI job, or a file was dropped from the list and now runs in no project at all",
    ).toBeGreaterThan(0);
    for (const f of LOCAL_STACK_LANE_FILES) {
      expect(existsSync(REPO_ROOT + f), `${f} is listed but does not exist`).toBe(
        true,
      );
    }
  });

  it("vitest.config.ts EXCLUDES the lane list from the sharded jsdom project", () => {
    const cfg = read("vitest.config.ts");
    expect(
      cfg,
      "vitest.config.ts no longer imports LOCAL_STACK_LANE_FILES — if the exclusion was removed the lane files would run in every shard, where no Supabase stack exists, and redden them",
    ).toContain('from "./vitest.local-stack-files"');
    expect(
      cfg,
      "the jsdom project's exclude no longer spreads LOCAL_STACK_LANE_FILES",
    ).toContain("...LOCAL_STACK_LANE_FILES");
  });

  it("vitest.local-stack.config.ts runs EXACTLY the lane list, and cannot pass on an empty corpus", () => {
    const cfg = read("vitest.local-stack.config.ts");
    expect(cfg).toContain('from "./vitest.local-stack-files"');
    expect(
      cfg,
      "the lane config's include is no longer LOCAL_STACK_LANE_FILES, so the two lists can now disagree",
    ).toContain("include: LOCAL_STACK_LANE_FILES");
    expect(
      cfg,
      "passWithNoTests must stay false — a lane invocation that collected nothing and exited 0 is the silent green this whole arrangement exists to prevent",
    ).toContain("passWithNoTests: false");
    // The lane config is a standalone ROOT config and inherits none of
    // vitest.config.ts's fences. `fileParallelism: false` shares one worker across
    // lane files, so without these a `process.env.X =` in one file reaches the next.
    // ⛔ [WR-A, iteration 2] LINE-EXACT AND NON-COMMENT, never a whole-file
    // `toContain`. MEASURED 2026-09-08: with all three fences commented out —
    // the lane genuinely losing them, `setup 157ms` -> `setup 0ms` — a
    // whole-file toContain stayed 7/7 GREEN, because the commented-out text is
    // still text in the file. That is the WR-01 defect verbatim, thirty lines
    // above the code that fixes WR-01 correctly. Same idiom as the WR-03 pin.
    const cfgLines = cfg.split("\n").map((l) => l.trim());
    for (const fence of [
      'setupFiles: ["src/test-setup.ts"],',
      "unstubGlobals: true,",
      "unstubEnvs: true,",
    ]) {
      expect(
        cfgLines.filter((l) => l === fence).length,
        `the lane config no longer restates \`${fence}\` on a live (non-comment) line — it is a root config, so it inherits nothing, and the env-restore fence is simply absent. A commented-out fence is not a fence.`,
      ).toBe(1);
    }
  });

  it("package.json's test:local-stack script names the lane config", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(
      pkg.scripts["test:local-stack"],
      "the npm script the CI job invokes is gone or no longer points at the lane config",
    ).toContain("vitest.local-stack.config.ts");
  });

  it(`ci.yml defines the ${LANE_JOB} job, and it BOOTS the lane and RUNS it`, () => {
    // Scoped to the job's OWN block, and to lines that are not comments: the
    // literals must be EXECUTED by this job, not merely mentioned near it.
    const executed = laneJobBlock()
      .split("\n")
      .filter((l) => !/^\s*#/.test(l));
    const why: Record<string, string> = {
      "bash scripts/local-stack/run.sh up": `the ${LANE_JOB} job no longer boots the Supabase stack; the spec would fail loud rather than skip, but the gate would be permanently red for the wrong reason`,
      "npm run test:local-stack": `the ${LANE_JOB} job no longer invokes the lane's own npm script`,
      "bash scripts/local-stack/run.sh --assert-teardown": `the ${LANE_JOB} job no longer tears its stack down — 13 orphaned containers per run`,
    };
    for (const [cmd, reason] of Object.entries(why)) {
      expect(
        executed.some((l) => l.includes(cmd)),
        `${reason} (a comment mentioning \`${cmd}\` does not run it)`,
      ).toBe(true);
    }
  });

  it(`the frontend aggregator lists ${LANE_JOB} in BOTH needs: and its result loop`, () => {
    const block = aggregatorBlock();
    expect(
      block,
      `${LANE_JOB} is missing from the frontend aggregator's needs: list — a job in only one of the two lists is a check that cannot block a merge`,
    ).toContain(`\n      - ${LANE_JOB}\n`);
    expect(
      block,
      `${LANE_JOB} is missing from the frontend aggregator's result loop — needs: alone marks the aggregator 'skipped' rather than 'failed', and a skipped check satisfies classic branch protection`,
    ).toContain(
      `"${LANE_JOB}=\${{ needs.${LANE_JOB}.result }}"`,
    );
  });

  it("no lane file is skip-gated — a skipping spec inside a working lane job is the tombstone with the wiring intact", () => {
    // ⚠️ THE TOKENS ARE BUILT, NOT WRITTEN. `src/__tests__/contracts/
    // spec-disabling.invariant.test.ts` scans ALL of `src/` for these literals and
    // treats any occurrence as a silently-disabled spec — so spelling them out here,
    // in the very file whose job is to FORBID them, turns that contract RED.
    // MEASURED 2026-09-07: a literal array reported three offending sites in this
    // file. Composing them also removes a drift risk, since a new `describe.todo`
    // needs no edit to be covered.
    const gates = ["it", "test", "describe"].flatMap((fn) =>
      ["skip", "skipIf", "todo"].map((mode) => `${fn}.${mode}(`),
    );
    for (const f of LOCAL_STACK_LANE_FILES) {
      const src = read(f);
      for (const gate of gates) {
        expect(
          src.includes(gate),
          `${f} contains \`${gate}\`. Lane specs must FAIL when their substrate is absent, never skip: a skipped live-DB case is indistinguishable from a passing one in CI output, which is exactly how csv-finalize-rpc.test.ts's six cases survived a DROPped function.`,
        ).toBe(false);
      }
    }
  });

  // ⭐ Phase 164.4.2 plan 03. The lane loads a DUMP, and a migration can land
  // after it was taken. MEASURED (164.4.2 CONTEXT Area A): two migrations sat
  // after the dump while this lane was green, because nothing in the boot path
  // compared the two. The claim pinned here is deliberately narrow — the boot
  // path REFUSES a dump older than supabase/migrations/ before psql reads it.
  // It says nothing about whether the dump's CONTENT is right; that is
  // baseline-content-drift-check's question, not this one.
  it("the lane's boot path measures baseline CURRENCY before psql loads the dump, and the call it makes refuses a stale dump", () => {
    const lane = read(RUN_SH);

    // (1) load_baseline() guards on the gate, the guard ABORTS, and it runs
    // before the psql load. A guard that only logged would be a gate that
    // measures nothing — so the guarded block must contain an `exit`.
    const body = liveLines(bashFunctionBody(lane, "load_baseline"));
    const guard = body.findIndex((l) =>
      /^if\s+!\s+check_baseline_currency\s*;\s*then$/.test(l),
    );
    const load = body.findIndex((l) => l.includes('-f "$BASELINE_FILE"'));
    expect(
      guard,
      "load_baseline() no longer guards on check_baseline_currency — the lane would boot a dump older than the migrations and every spec on it would go green against a catalogue that is not PROD's",
    ).toBeGreaterThan(-1);
    expect(load, "load_baseline() no longer loads $BASELINE_FILE with psql -f").toBeGreaterThan(-1);
    expect(
      guard < load,
      "the currency guard runs AFTER the psql load — by then the stale schema is already in the database",
    ).toBe(true);
    const fi = body.indexOf("fi", guard);
    expect(fi, "the currency guard's `if` has no closing `fi`").toBeGreaterThan(guard);
    expect(
      body.slice(guard + 1, fi).some((l) => /^exit\s+[1-9]/.test(l)),
      "the currency guard's block does not exit non-zero — a lane that logs 'stale' and loads anyway is the gate-that-measures-nothing class",
    ).toBe(true);

    // (2) The `--check-currency` seam dispatches the SAME function, so driving
    // the seam below drives the call load_baseline() makes — not a copy of it.
    const at = lane.indexOf('\ncase "${1:-}" in\n');
    expect(at, `${RUN_SH}'s top-level dispatcher is gone`).toBeGreaterThan(-1);
    const seam = liveLines(lane.slice(at)).find((l) => l.startsWith("--check-currency)"));
    expect(seam, "the --check-currency seam is no longer dispatched").toBeDefined();
    expect(
      seam,
      "--check-currency no longer runs check_baseline_currency, so it can pass while load_baseline() refuses (or the reverse)",
    ).toContain("check_baseline_currency");

    // (3) BEHAVIOUR, both directions, through the lane's own FRESHNESS_TS_CMD
    // pass-through. A check proven in one direction is half a check: the stale
    // stub must REFUSE with the gate's own phrase, and the fresh stub must pass.
    const dir = mkdtempSync(join(tmpdir(), "lane-currency-"));
    try {
      const stub = (name: string, baselineEpoch: number, migrationsEpoch: number) => {
        const p = join(dir, `${name}.sh`);
        writeFileSync(
          p,
          `#!/usr/bin/env bash\ncase "$1" in *baseline.sql) echo ${baselineEpoch} ;; *) echo ${migrationsEpoch} ;; esac\n`,
        );
        chmodSync(p, 0o755);
        // The gate splits FRESHNESS_TS_CMD on whitespace, so a spaced tmpdir
        // would silently run a different binary.
        expect(/\s/.test(p), `stub path contains whitespace: ${p}`).toBe(false);
        return p;
      };
      const ask = (freshnessCmd: string) =>
        spawnSync("bash", [RUN_SH, "--check-currency"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: { ...process.env, FRESHNESS_TS_CMD: freshnessCmd },
        });

      const stale = ask(stub("stale", 1_000_000_000, 2_000_000_000));
      expect(
        stale.status,
        `the lane did not refuse a baseline OLDER than the migrations (exit ${stale.status}):\n${stale.stdout}${stale.stderr}`,
      ).toBe(1);
      expect(stale.stdout + stale.stderr).toContain("the baseline dump is STALE");

      const fresh = ask(stub("fresh", 2_000_000_000, 1_000_000_000));
      expect(
        fresh.status,
        `the lane refused a baseline NEWER than the migrations (exit ${fresh.status}):\n${fresh.stdout}${fresh.stderr}`,
      ).toBe(0);
      expect(fresh.stdout).toContain("defects=0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
