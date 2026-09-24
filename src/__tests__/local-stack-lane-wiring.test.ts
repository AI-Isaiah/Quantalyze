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
 * And (Phase 164.4.2) that the lane's boot path DETERMINES WHICH migrations the dump
 * does not carry before psql reads it, replays exactly those, and refuses when the
 * set cannot be determined — a lane wired end to end onto a schema missing real
 * migrations is green for a catalogue that is not PROD's. (Plan 03 pinned a REFUSAL
 * of any newer migration; DECISION F, plan 06, replaced it with "bound and name".)
 */

// @vitest-environment node

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

// ── Phase 164.4.2 plan 11 (DECISION G): the non-public objects module, driven with
// synthetic migrations, carried sets and catalogues — no Docker.
const NONPUBLIC_MODULE = REPO_ROOT + "scripts/local-stack/nonpublic-objects.mjs";
/** The catalogue's meta rows as the superuser read prints them on a lane with pg_cron. */
const NONPUBLIC_META = ["meta|superuser|t", "meta|database|postgres", "meta|pg_cron|1"];
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
/** One `cron|…` catalogue row, free-text fields hex-encoded as the catalogue SQL encodes them. */
const cronRow = (
  name: string,
  schedule: string,
  command: string,
  o: { active?: string; username?: string; database?: string } = {},
) =>
  ["cron", hex(name), hex(schedule), o.active ?? "t", o.username ?? "postgres", o.database ?? "postgres", hex(command)].join("|");

/**
 * A throwaway lane: migrations `files`, the carried subset, and a catalogue (null =
 * an EMPTY file). Runs --emit then --check (as the loading role `postgres`).
 */
function nonpublicGate(files: Record<string, string>, carried: string[], catalogue: string[] | null) {
  const dir = mkdtempSync(join(tmpdir(), "nonpublic-"));
  try {
    const mig = join(dir, "migrations");
    mkdirSync(mig);
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(mig, name), sql);
    writeFileSync(join(dir, "carried.txt"), carried.map((c) => `${c}\n`).join(""));
    writeFileSync(join(dir, "cat.txt"), catalogue === null ? "" : catalogue.join("\n") + "\n");
    const run = (mode: string[]) => {
      const r = spawnSync(
        process.execPath,
        [NONPUBLIC_MODULE, ...mode, "--migrations", mig, "--carried", join(dir, "carried.txt")],
        { encoding: "utf8" },
      );
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };
    const emitted = run(["--emit", "--out-dir", join(dir, "out")]);
    const readOut = (f: string) =>
      existsSync(join(dir, "out", f)) ? readFileSync(join(dir, "out", f), "utf8") : null;
    return {
      emitted,
      emittedSql: readOut("nonpublic-auth-triggers.sql"),
      emittedCron: readOut("nonpublic-cron.sql"),
      ...run(["--check", "--catalogue", join(dir, "cat.txt"), "--cron-owner", "postgres"]),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  // ⭐ Phase 164.4.2 plan 03, RE-ARGUED by plan 06 (DECISION F, founder
  // 2026-09-23). The lane loads a DUMP, and a migration can land after it was
  // taken. MEASURED (164.4.2 CONTEXT Area A): two migrations sat after the dump
  // while this lane was green, because nothing in the boot path compared the two.
  // Plan 03 pinned a REFUSAL of any dump older than supabase/migrations/; D-F
  // replaced that with "bound and name": the boot path determines, before psql
  // reads the dump, exactly which migrations the committed marker says the dump
  // does NOT carry, replays those, and refuses only when the set cannot be
  // determined. It says nothing about whether the dump's CONTENT is right; that
  // is baseline-content-drift-check's question, not this one.
  it("the lane's boot path determines the replay set before psql loads the dump, and replays exactly the migrations the marker does not carry", () => {
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

    // (3) BEHAVIOUR, through the lane's own LANE_MIGRATIONS_DIR /
    // LANE_CARRIED_MARKER / LANE_REFDATA_ALLOWLIST seams, in a throwaway
    // directory — no Docker. ⛔ RETIRED here, not inverted silently: plan 03's
    // stale-epoch stub (FRESHNESS_TS_CMD reporting a dump older than the
    // migrations -> exit 1) no longer describes the lane. Under D-F a migration
    // newer than the dump is the NORMAL case and must boot; the refusal now
    // belongs to an UNDETERMINABLE set, and each shape of that is pinned below.
    const dir = mkdtempSync(join(tmpdir(), "lane-replay-"));
    try {
      const A = "20260101000000_lane_pin_a.sql";
      const B = "20260102000000_lane_pin_b.sql";
      const C = "20260103000000_lane_pin_c.sql";
      const dumpSha = createHash("sha256")
        .update(readFileSync(REPO_ROOT + "supabase/schema/baseline.sql"))
        .digest("hex");
      const migrationsDir = (name: string, files: string[]) => {
        const d = join(dir, name);
        mkdirSync(d);
        for (const f of files) writeFileSync(join(d, f), "SELECT 1;\n");
        return d;
      };
      const markerFile = (name: string, entries: string[], sha = dumpSha) => {
        const p = join(dir, `${name}.txt`);
        writeFileSync(p, ["# lane pin marker", `baseline-sha256: ${sha}`, ...entries].join("\n") + "\n");
        return p;
      };
      const ask = (env: Record<string, string>) => {
        const r = spawnSync("bash", [RUN_SH, "--check-currency"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: { ...process.env, ...env },
        });
        return { status: r.status, out: `${r.stdout}${r.stderr}` };
      };
      const replayLines = (out: string) => out.split("\n").filter((l) => l.startsWith("baseline-replay:"));

      // (3a) marker current for the directory -> exit 0, K=0, printed as such.
      const current = ask({
        LANE_MIGRATIONS_DIR: migrationsDir("current", [A, B]),
        LANE_CARRIED_MARKER: markerFile("current", [A, B]),
      });
      expect(current.status, `a marker current for its directory was refused:\n${current.out}`).toBe(0);
      expect(current.out).toContain("carried=2 replay=0 marker-sha=match defects=0");
      expect(
        current.out,
        "K=0 must be PRINTED as an empty set — a lane that replays silently is indistinguishable from one that never looked",
      ).toContain("baseline-replay: 0 migration(s) newer than the dump (none)");
      expect(current.out).toMatch(/baseline-replay: excluded 0 reference-data allowlist line\(s\) naming replayed migrations: \(none\)/);

      // (3b) one migration newer than the dump -> exit 0, named exactly.
      const newer = ask({
        LANE_MIGRATIONS_DIR: migrationsDir("newer", [A, B, C]),
        LANE_CARRIED_MARKER: markerFile("newer", [A, B]),
      });
      expect(
        newer.status,
        `a migration newer than the dump was REFUSED — under D-F it is the normal case and must be replayed:\n${newer.out}`,
      ).toBe(0);
      expect(replayLines(newer.out)[0]).toBe(`baseline-replay: 1 migration(s) newer than the dump: ${C}`);

      // (3c) marker bound to a different dump -> exit 1, marker-sha-mismatch, no set printed.
      const mismatch = ask({
        LANE_MIGRATIONS_DIR: migrationsDir("mismatch", [A, B]),
        LANE_CARRIED_MARKER: markerFile("mismatch", [A, B], "0".repeat(64)),
      });
      expect(mismatch.status, `a marker bound to another dump booted:\n${mismatch.out}`).toBe(1);
      expect(mismatch.out).toContain("marker-sha-mismatch");
      expect(replayLines(mismatch.out), "an undeterminable set must never be printed as a set").toEqual([]);

      // (3d) marker absent -> exit 1, marker-unreadable (never "nothing carried").
      const absent = ask({
        LANE_MIGRATIONS_DIR: migrationsDir("absent", [A, B]),
        LANE_CARRIED_MARKER: join(dir, "no-such-marker.txt"),
      });
      expect(absent.status, `an absent marker booted:\n${absent.out}`).toBe(1);
      expect(absent.out).toContain("marker-unreadable");

      // (3e) the dump carries a migration this checkout lacks -> exit 1, dump-ahead-of-checkout.
      const ahead = ask({
        LANE_MIGRATIONS_DIR: migrationsDir("ahead", [A]),
        LANE_CARRIED_MARKER: markerFile("ahead", [A, B]),
      });
      expect(ahead.status, `a dump ahead of the checkout booted:\n${ahead.out}`).toBe(1);
      expect(ahead.out).toContain("dump-ahead-of-checkout");
      expect(ahead.out).toContain(B);

      // (3f) a replayed migration's reference-data allowlist line is removed from
      // what the extractor reads, and named — so it runs once, in the replay.
      const allow = join(dir, "allow.txt");
      writeFileSync(
        allow,
        readFileSync(REPO_ROOT + "scripts/restore-test-refdata-allowlist.txt", "utf8") +
          `${C}\tpublic.compute_job_kinds\t1\t# lane pin only\n`,
      );
      const refdata = ask({
        LANE_MIGRATIONS_DIR: migrationsDir("refdata", [A, B, C]),
        LANE_CARRIED_MARKER: markerFile("refdata", [A, B]),
        LANE_REFDATA_ALLOWLIST: allow,
      });
      expect(refdata.status, `the refdata arm was refused:\n${refdata.out}`).toBe(0);
      expect(replayLines(refdata.out)).toContain(
        `baseline-replay: excluded 1 reference-data allowlist line(s) naming replayed migrations: ${C}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ⭐ Phase 164.4.2 plan 06 (DECISION F). The ORDER and SHAPE of the boot path:
  // the gate, the reference-data filter, the extraction and the replay read ONE
  // list and ONE migrations directory, and a replayed file is applied as authored.
  it("load_baseline() replays after the dump and the reference data, the extractor reads the filtered allowlist and the lane's migrations dir, and each replayed file applies with no wrapper before its ledger row", () => {
    const lane = read(RUN_SH);

    // Order: dump load -> reference data (carried migrations only) -> replay.
    const body = liveLines(bashFunctionBody(lane, "load_baseline"));
    const load = body.findIndex((l) => l.includes('-f "$BASELINE_FILE"'));
    const refdata = body.findIndex((l) => /^load_reference_data\b/.test(l));
    const replay = body.findIndex((l) => /^replay_migrations\b/.test(l));
    expect(load, "load_baseline() no longer loads $BASELINE_FILE with psql -f").toBeGreaterThan(-1);
    expect(refdata, "load_baseline() no longer calls load_reference_data").toBeGreaterThan(load);
    expect(
      replay,
      "load_baseline() does not call replay_migrations AFTER the dump and the reference data — a migration newer than the dump would never reach the lane (or would run before the tables and rows it builds on exist)",
    ).toBeGreaterThan(refdata);

    // The extractor call: the gate-written FILTERED allowlist, and the SAME
    // migrations directory the gate classified and the replay applies from.
    const assign = liveLines(lane).find((l) => l.startsWith("MIGRATIONS_DIR="));
    expect(
      assign,
      "MIGRATIONS_DIR is no longer resolved from LANE_MIGRATIONS_DIR — the gate, the extractor and the replay could then read different directories",
    ).toMatch(/^MIGRATIONS_DIR="\$\{LANE_MIGRATIONS_DIR:-/);
    const extract = liveLines(bashFunctionBody(lane, "load_reference_data")).find((l) =>
      l.includes("extract-reference-inserts.mjs"),
    );
    expect(extract, "load_reference_data no longer runs the extractor").toBeDefined();
    expect(
      extract,
      "the extractor is not handed the gate-written FILTERED allowlist — an allowlisted statement in a replayed migration would run twice (a plain VALUES insert: duplicate key, FATAL boot)",
    ).toContain('--allowlist "$REFDATA_ALLOWLIST_FILTERED"');
    expect(extract).not.toContain("restore-test-refdata-allowlist.txt");
    expect(
      extract,
      "the extractor is not handed --migrations \"$MIGRATIONS_DIR\" — it would resolve allowlist entries against its repo default and refuse (or silently mis-read) every entry only the lane's directory holds",
    ).toContain('--migrations "$MIGRATIONS_DIR"');
    expect(extract).not.toMatch(/--migrations\s+\S*supabase\/migrations/);

    // The replay: no whole-file transaction flag (long or short spelling) and no
    // lane-added BEGIN on any psql call, and the ledger row is written by a psql
    // call AFTER the one that applies the file. ⛔ The earlier draft of plan 06
    // asserted the OPPOSITE (one --single-transaction call carrying both); that
    // assertion is RETIRED, not inverted silently — a file's own COMMIT; ended
    // the wrapper early, and a top-level CREATE INDEX CONCURRENTLY errored in it.
    const replayBody = liveLines(bashFunctionBody(lane, "replay_migrations"));
    for (const l of replayBody.filter((x) => x.includes('"$psql"'))) {
      expect(l, `a replay psql call carries a whole-file transaction flag: ${l}`).not.toMatch(
        /--single-transaction|\s-1(\s|$)/,
      );
    }
    expect(
      replayBody.some((l) => /\bBEGIN\b/.test(l)),
      "replay_migrations adds a BEGIN of its own — a replayed file's own transaction control must govern it",
    ).toBe(false);
    const apply = replayBody.findIndex((l) => l.includes('"$psql"') && l.includes('-f "${MIGRATIONS_DIR}/${base}"'));
    const ledger = replayBody.findIndex((l) =>
      /INSERT INTO supabase_migrations\.schema_migrations .*replayed on the local-stack lane/.test(l),
    );
    expect(apply, "replay_migrations no longer applies ${MIGRATIONS_DIR}/${base} with psql -f").toBeGreaterThan(-1);
    expect(
      ledger,
      "the replayed file's ledger row is not written AFTER (and separately from) the psql call that applies it — the ledger could then name a migration that never applied",
    ).toBeGreaterThan(apply);
  });

  // ⭐ Phase 164.4.2, the fix for plan 08's checkpoint RED (CI run 35886515179). The
  // Supabase image gives schema `public` default ACLs that grant ALL to anon,
  // authenticated and service_role. The dump sets its own defaults LAST and its
  // GRANTs only add, so without a reset every object it creates is WIDER than on
  // PROD. MEASURED on the lane with the reset missing: 35 of 76 corpus files RED,
  // 377 privileges beyond what the dump declares. The reset must run inside
  // load_baseline(), after the currency gate and BEFORE psql reads the dump, and the
  // ACL-fidelity gate must run after the dump and before anything can change an ACL.
  it("load_baseline() resets public's default ACLs before the dump loads, derives them from the catalogue, and proves ACL fidelity right after the load", () => {
    const lane = read(RUN_SH);
    const body = liveLines(bashFunctionBody(lane, "load_baseline"));
    const guard = body.findIndex((l) => /^if\s+!\s+check_baseline_currency\s*;\s*then$/.test(l));
    const reset = body.findIndex((l) => /^reset_public_default_acls\s+"\$psql"\s+"\$db_url"$/.test(l));
    const load = body.findIndex((l) => l.includes('-f "$BASELINE_FILE"'));
    const fidelity = body.findIndex((l) => /^check_acl_fidelity\s+"\$psql"\s+"\$db_url"$/.test(l));
    const refdata = body.findIndex((l) => /^load_reference_data\b/.test(l));
    expect(
      reset,
      "load_baseline() no longer calls reset_public_default_acls — every object the dump creates would inherit the image's ALL grants (authenticated could TRUNCATE public.system_settings, which PROD does not grant)",
    ).toBeGreaterThan(-1);
    expect(reset, "the default-ACL reset runs before the currency gate").toBeGreaterThan(guard);
    expect(
      reset < load,
      "the default-ACL reset runs AFTER psql loads the dump — by then every object already inherited the image's grants, and the dump's GRANT lines cannot take them back",
    ).toBe(true);
    expect(fidelity, "load_baseline() no longer runs check_acl_fidelity after the dump").toBeGreaterThan(load);
    expect(
      fidelity < refdata,
      "check_acl_fidelity must run before reference data and the replay: after a replayed migration's own GRANT/REVOKE, the dump is no longer the fixed point it compares against",
    ).toBe(true);

    // Both FATAL on failure — a reset or a gate that only logs measures nothing.
    const resetBody = liveLines(bashFunctionBody(lane, "reset_public_default_acls"));
    expect(
      resetBody.some((l) => l.includes('-f "${LANE_DIR}/reset-public-default-acl.sql"')),
      "reset_public_default_acls no longer runs scripts/local-stack/reset-public-default-acl.sql",
    ).toBe(true);
    expect(resetBody.filter((l) => /^exit\s+[1-9]/.test(l)).length).toBeGreaterThanOrEqual(3);
    const gateBody = liveLines(bashFunctionBody(lane, "check_acl_fidelity"));
    expect(gateBody.some((l) => l.includes("acl-fidelity.mjs") && l.includes('--dump "$BASELINE_FILE"'))).toBe(true);
    expect(gateBody.filter((l) => /^exit\s+[1-9]/.test(l)).length).toBeGreaterThanOrEqual(2);

    // The reset DERIVES the grantor roles, object types and grantees from the
    // catalogue: no role is named in executable SQL, and a surviving row RAISES.
    const sqlLive = read("scripts/local-stack/reset-public-default-acl.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sqlLive).toMatch(/FROM pg_default_acl d\s+WHERE d\.defaclnamespace = 'public'::regnamespace/);
    expect(sqlLive).toContain("aclexplode(r.defaclacl)");
    expect(sqlLive, "the reset names a role literally instead of reading it from pg_default_acl").not.toMatch(
      /\b(supabase_admin|anon|authenticated|service_role)\b|FOR ROLE "?postgres/,
    );
    expect(sqlLive).toMatch(/IF v_left <> 0 THEN\s+RAISE EXCEPTION/);
  });

  // ── Phase 164.4.2 plan 08 checkpoint RED (2026-09-23): the lane's Postgres IMAGE.
  // MEASURED: CI run 35914559318's `sql-tests` lost its backend (SIGSEGV) inside
  // test_api_keys_exchange_not_user_writable.sql. The image was never chosen — it
  // floated with the CLI version (2.84.2 on a developer box -> 17.6.1.095, 2.98.2 on
  // CI -> 17.6.1.106), so the box was green on a different Postgres than CI ran.
  // 17.6.1.104 and .106 ship supautils 3.2.0, whose ExecutorStart hint hook crashes
  // the backend when a `postgres` session that SET ROLE to a hint role is refused
  // EXECUTE on a function (fixed upstream in supautils 3.2.2, first shipped in
  // 17.6.1.113). WHY THIS MATTERS: that is the corpus's own idiom for proving a
  // REVOKE holds, so a floating image turns a privilege gate into a crashed run.
  it("the lane PINS its Postgres image, proves the pin took, and proves a function EXECUTE denial does not kill the backend before anything loads", () => {
    const lane = read(RUN_SH);
    const pin = lane.match(/^LANE_PG_VERSION="(\d+\.\d+\.\d+\.\d+)"$/m);
    expect(
      pin,
      `${RUN_SH} carries no LANE_PG_VERSION pin — the image floats with the CLI version, and CI and a developer box boot different Postgres builds`,
    ).not.toBeNull();

    // The CLI splices the file's bytes straight into the image tag, so the write must
    // carry NO trailing newline — `printf '%s'`, never `echo`.
    const gen = liveLines(bashFunctionBody(lane, "generate_stack_config"));
    expect(
      gen.some((l) => l === `printf '%s' "$LANE_PG_VERSION" >"\${STACK_DIR}/supabase/.temp/postgres-version"`),
      "generate_stack_config no longer writes the pin to the lane workdir's .temp/postgres-version (the file the CLI reads the db image tag from)",
    ).toBe(true);

    const up = liveLines(bashFunctionBody(lane, "cmd_up"));
    const start = up.indexOf("sb start");
    const assertImage = up.indexOf("assert_lane_pg_image");
    const probe = up.indexOf("probe_function_denial_survives");
    const schema = up.findIndex((l) => l === "load_baseline");
    expect(assertImage, "cmd_up no longer asserts the running image equals the pin").toBeGreaterThan(start);
    expect(probe, "cmd_up no longer runs the function-denial probe").toBeGreaterThan(assertImage);
    expect(
      probe < schema,
      "the function-denial probe must run BEFORE the schema loads, so --no-schema boots are covered and a crashing image fails at boot rather than mid-corpus",
    ).toBe(true);

    // Both FATAL — an assertion that only logs measures nothing.
    const imageBody = liveLines(bashFunctionBody(lane, "assert_lane_pg_image"));
    expect(imageBody.some((l) => l.includes('"$DOCKER_BIN" ps') && l.includes("supabase_db_${PROJECT_ID}"))).toBe(true);
    expect(imageBody.filter((l) => /^exit\s+[1-9]/.test(l)).length).toBeGreaterThanOrEqual(2);
    const probeBody = liveLines(bashFunctionBody(lane, "probe_function_denial_survives"));
    expect(
      probeBody.some((l) => l.includes('-f "${LANE_DIR}/function-denial-probe.sql"')),
      "probe_function_denial_survives no longer runs scripts/local-stack/function-denial-probe.sql",
    ).toBe(true);
    expect(probeBody.filter((l) => /^exit\s+[1-9]/.test(l)).length).toBeGreaterThanOrEqual(1);

    // The probe is the crash's exact shape: a `postgres` session, SET ROLE to a hint
    // role, EXECUTE refused. It must catch ONLY 42501, and raise when the call SUCCEEDS
    // (a probe that cannot fail measures nothing), and leave nothing behind.
    const probeSql = read("scripts/local-stack/function-denial-probe.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(probeSql).toMatch(/REVOKE ALL ON FUNCTION public\.lane_function_denial_probe\(\) FROM PUBLIC, anon, authenticated;/);
    expect(probeSql).toMatch(/SET LOCAL ROLE authenticated;/);
    expect(probeSql).toMatch(/EXCEPTION WHEN insufficient_privilege THEN/);
    expect(probeSql).not.toMatch(/WHEN OTHERS/);
    expect(probeSql).toMatch(/PERFORM public\.lane_function_denial_probe\(\);\s+RAISE EXCEPTION/);
    expect(probeSql.trim().endsWith("ROLLBACK;"), "the probe must roll back its function").toBe(true);
  });

  // The fidelity gate itself, driven with a synthetic dump and catalogue (no Docker):
  // an exact match is OK, the CI run's exact defect (authenticated TRUNCATE on
  // system_settings, which the dump does not grant) is DRIFT, and a GRANT shape it
  // cannot parse is MEASURE_FAIL rather than skipped.
  it("acl-fidelity.mjs passes an exact match, names the extra TRUNCATE as DRIFT, and refuses a dump line it cannot parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "acl-fidelity-"));
    try {
      const dump = [
        'GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."system_settings" TO "authenticated";',
        'GRANT ALL ON TABLE "public"."system_settings" TO "service_role";',
        'REVOKE ALL ON FUNCTION "public"."f"("p_a" "uuid") FROM PUBLIC;',
        'GRANT ALL ON FUNCTION "public"."f"("p_a" "uuid") TO "service_role";',
        'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";',
      ].join("\n");
      const tablePrivs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
      const good = [
        "excluded-extension-members|0",
        "obj|rel|r|system_settings|postgres",
        ...tablePrivs.map((p) => `acl|rel|system_settings|postgres|${p}:false`),
        ...["SELECT", "INSERT", "DELETE", "MAINTAIN", "UPDATE"].map((p) => `acl|rel|system_settings|authenticated|${p}:false`),
        ...tablePrivs.map((p) => `acl|rel|system_settings|service_role|${p}:false`),
        "obj|fn|-|public.f(p_a uuid)|postgres",
        "acl|fn|public.f(p_a uuid)|postgres|EXECUTE:false",
        "acl|fn|public.f(p_a uuid)|service_role|EXECUTE:false",
        "defacl|postgres|f|anon|EXECUTE:false",
      ];
      const run = (dumpText: string, cat: string[]) => {
        writeFileSync(join(dir, "dump.sql"), dumpText);
        writeFileSync(join(dir, "cat.txt"), cat.join("\n") + "\n");
        return spawnSync(
          process.execPath,
          [REPO_ROOT + "scripts/local-stack/acl-fidelity.mjs", "--dump", join(dir, "dump.sql"), "--catalogue", join(dir, "cat.txt")],
          { encoding: "utf8" },
        );
      };
      const ok = run(dump, good);
      expect(ok.status, ok.stdout + ok.stderr).toBe(0);
      expect(ok.stdout).toMatch(/^acl-fidelity: .* drift=0 verdict OK$/m);
      // Review 164.4.2 IN-06: the verdict line itself names what is NOT compared —
      // column grants (counted) and type ACLs — so an OK is never read as "every
      // privilege on public matched".
      expect(ok.stdout).toMatch(/^acl-fidelity: .*column-grants-not-compared=\d+ type-acls=not-compared .* verdict OK$/m);

      const drift = run(dump, [...good, "acl|rel|system_settings|authenticated|TRUNCATE:false"]);
      expect(drift.status, drift.stdout + drift.stderr).toBe(1);
      expect(drift.stdout).toContain("EXTRA    system_settings|authenticated|TRUNCATE");
      expect(drift.stdout).toMatch(/drift=1 verdict DRIFT$/m);

      const anonFn = run(dump, [...good, "acl|fn|public.f(p_a uuid)|anon|EXECUTE:false"]);
      expect(anonFn.status, "an anon EXECUTE the dump revoked (via PUBLIC) is not DRIFT").toBe(1);

      const unparsed = run(dump + '\nGRANT ALL ON TABLE "public"."x" TO "anon" WITH GRANT OPTION;', good);
      expect(unparsed.status, unparsed.stdout + unparsed.stderr).toBe(2);
      expect(unparsed.stdout).toMatch(/verdict MEASURE_FAIL$/m);

      const empty = run(dump, ["excluded-extension-members|0"]);
      expect(empty.status, "an empty catalogue passed the fidelity gate").toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ⭐ Phase 164.4.2 plan 11 (DECISION G). The non-public objects gate, driven with
  // synthetic migrations, carried sets and catalogues (no Docker). ⛔ ONE `it(` PER
  // ARM, each with its OWN migrations directory: a neuter of one branch of the gate
  // must turn exactly its own arm red, never an earlier assertion in a shared block.
  describe("nonpublic-objects.mjs — the auth.users trigger class (D-G)", () => {
    const gate = nonpublicGate;
    const TRIGGER_SQL =
      "CREATE TRIGGER on_signup\n  AFTER INSERT ON auth.users\n  FOR EACH ROW EXECUTE FUNCTION handle_signup();\n";
    const META = NONPUBLIC_META;
    const TRIGGER_ROW = "trigger|users|on_signup|5|O|public.handle_signup()";
    const A = "20260101000000_a.sql";
    const B = "20260102000000_b.sql";

    it("OK on an exact match, and --emit writes the declaring statement's own bytes", () => {
      const r = gate({ [A]: TRIGGER_SQL }, [A], [...META, TRIGGER_ROW]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/^nonpublic-fidelity: auth-users-triggers=1\/1 cron-jobs=0\/0 drift=0 verdict OK$/m);
      expect(r.emitted.out).toContain(`auth-triggers=1 (on_signup<-${A})`);
      expect(r.emittedSql, "the emitted SQL is not the migration's own bytes").toBe(
        `SET search_path TO public;\n${TRIGGER_SQL.trimEnd()}\n`,
      );
    });

    it("DRIFT naming MISSING when the lane lacks a declared trigger", () => {
      const r = gate({ [A]: TRIGGER_SQL }, [A], META);
      expect(r.status, `the gate passed a lane with NO auth.users trigger:\n${r.out}`).toBe(1);
      expect(r.out).toContain("MISSING  auth.users trigger on_signup");
    });

    it("DRIFT naming EXTRA for a trigger no carried migration declares", () => {
      const r = gate({ [A]: TRIGGER_SQL }, [A], [...META, TRIGGER_ROW, "trigger|users|undeclared|5|O|public.x()"]);
      expect(r.status, `an undeclared auth.users trigger passed the gate:\n${r.out}`).toBe(1);
      expect(r.out).toContain("EXTRA    auth.users trigger undeclared");
    });

    it("a DROP TRIGGER in a later carried file removes the trigger from the fold", () => {
      const r = gate(
        { [A]: TRIGGER_SQL, [B]: "DROP TRIGGER IF EXISTS on_signup ON auth.users;\n" },
        [A, B],
        META,
      );
      expect(r.status, `a dropped trigger is still expected on the lane:\n${r.out}`).toBe(0);
      expect(r.out).toMatch(/auth-users-triggers=0\/0 cron-jobs=0\/0 drift=0 verdict OK$/m);
    });

    it("a trigger declared only in a file NOT in the carried set is not expected", () => {
      const r = gate({ [A]: "SELECT 1;\n", [B]: TRIGGER_SQL }, [A], META);
      expect(
        r.status,
        `a non-carried migration's trigger became expected — the replay would register it a second time:\n${r.out}`,
      ).toBe(0);
      expect(r.out).toMatch(/auth-users-triggers=0\/0 cron-jobs=0\/0 drift=0 verdict OK$/m);
    });

    it("MEASURE_FAIL on a trigger carrying a WHEN clause (a shape it cannot prove safe)", () => {
      const when =
        "CREATE TRIGGER on_signup AFTER INSERT ON auth.users FOR EACH ROW WHEN (NEW.email IS NOT NULL) EXECUTE FUNCTION handle_signup();\n";
      const r = gate({ [A]: when }, [A], [...META, TRIGGER_ROW]);
      expect(r.status, `a WHEN-clause trigger was folded instead of refused:\n${r.out}`).toBe(2);
      expect(r.out).toMatch(/verdict MEASURE_FAIL$/m);
      expect(r.out).toContain(`${A} statement 1`);
    });

    it("MEASURE_FAIL on a catalogue read by a non-superuser (meta|superuser|f)", () => {
      const r = gate(
        { [A]: TRIGGER_SQL },
        [A],
        [...META.filter((l) => !l.startsWith("meta|superuser|")), "meta|superuser|f", TRIGGER_ROW],
      );
      expect(r.status, `a non-superuser catalogue was trusted:\n${r.out}`).toBe(2);
      expect(r.out).toContain("NON-superuser");
    });

    it("MEASURE_FAIL on an empty catalogue, never 'nothing there'", () => {
      const r = gate({ [A]: TRIGGER_SQL }, [A], null);
      expect(r.status, `an empty catalogue compared instead of refusing:\n${r.out}`).toBe(2);
      expect(r.out).toContain("the catalogue is EMPTY");
    });
  });

  // ⭐ Phase 164.4.2 plan 11 (DECISION G) — the WIRING. The module above is only a
  // gate if load_baseline() runs it, in the right place, through the right roles.
  it("load_baseline() loads the non-public objects after reference data and gates them before the replay, through the superuser for the trigger and the catalogue and the loading role for cron", () => {
    const lane = read(RUN_SH);
    const body = liveLines(bashFunctionBody(lane, "load_baseline"));
    const at = (fn: string) => body.findIndex((l) => new RegExp(`^${fn}\\s+"\\$psql"\\s+"\\$db_url"$`).test(l));
    const acl = at("check_acl_fidelity");
    const refdata = at("load_reference_data");
    const load = at("load_nonpublic_objects");
    const gate = at("check_nonpublic_fidelity");
    const replay = at("replay_migrations");
    expect(
      load,
      "load_baseline() no longer calls load_nonpublic_objects — the lane has no auth.users trigger and no cron.job row, and 8 corpus files fail (3 auth-trigger, 5 cron)",
    ).toBeGreaterThan(-1);
    expect(
      gate,
      "load_baseline() no longer calls check_nonpublic_fidelity — a lane missing (or carrying extra) non-public objects would boot green",
    ).toBeGreaterThan(-1);
    expect(acl, "load_baseline() no longer calls check_acl_fidelity").toBeGreaterThan(-1);
    expect(refdata, "load_baseline() no longer calls load_reference_data").toBeGreaterThan(-1);
    expect(replay, "load_baseline() no longer calls replay_migrations").toBeGreaterThan(-1);
    expect(acl < refdata, "check_acl_fidelity no longer runs before load_reference_data").toBe(true);
    expect(
      refdata < load,
      "the non-public objects load BEFORE reference data — the trigger would create the teaser sentinel's profile first, with different values, and the allowlisted profile row would silently no-op",
    ).toBe(true);
    expect(load < gate, "check_nonpublic_fidelity runs before load_nonpublic_objects — it would compare a lane that has not been loaded yet").toBe(true);
    expect(
      gate < replay,
      "check_nonpublic_fidelity runs AFTER replay_migrations — a replayed migration may legitimately change these objects, so the gate would compare against a moved fixed point",
    ).toBe(true);

    // load_nonpublic_objects: the carried set and the lane's migrations dir, the
    // trigger through the superuser DSN, cron through the loading DSN, all FATAL.
    const loadBody = liveLines(bashFunctionBody(lane, "load_nonpublic_objects"));
    const extract = loadBody.find((l) => l.includes("nonpublic-objects.mjs") && l.includes("--emit"));
    expect(extract, "load_nonpublic_objects no longer runs the extractor's --emit").toBeDefined();
    expect(
      extract,
      "the extractor is not handed the gate's CARRIED set — a replayed migration's cron job or trigger would be registered twice",
    ).toContain('--carried "$CARRIED_SET_FILE"');
    expect(
      extract,
      "the extractor is not handed --migrations \"$MIGRATIONS_DIR\" — it could fold a different directory than the replay applies",
    ).toContain('--migrations "$MIGRATIONS_DIR"');
    const trig = loadBody.find((l) => l.includes("nonpublic-auth-triggers.sql"));
    expect(trig, "load_nonpublic_objects no longer applies nonpublic-auth-triggers.sql").toBeDefined();
    expect(trig, "the auth.users trigger is not applied through the superuser DSN").toContain('"$admin_url"');
    const cronApply = loadBody.find((l) => l.includes("nonpublic-cron.sql"));
    expect(cronApply, "load_nonpublic_objects no longer applies nonpublic-cron.sql").toBeDefined();
    expect(
      cronApply,
      "the cron jobs are not registered through the LOADING DSN — as the superuser they would be invisible to the corpus's postgres connection (pg_cron RLS) and would run with superuser rights",
    ).toContain('"$db_url"');
    expect(cronApply).not.toContain("admin_url");
    const ifs = (b: string[]) => b.filter((l) => /^if\s/.test(l)).length;
    const exits = (b: string[]) => b.filter((l) => /^exit\s+[1-9]/.test(l)).length;
    expect(ifs(loadBody), "load_nonpublic_objects has lost its failure guards").toBeGreaterThanOrEqual(5);
    expect(
      exits(loadBody),
      "load_nonpublic_objects has a failure path that does not exit non-zero — a load that only logs is a lane that boots without the objects",
    ).toBeGreaterThanOrEqual(ifs(loadBody));

    // check_nonpublic_fidelity: the catalogue through the superuser DSN, the
    // loading role as --cron-owner, all FATAL.
    const gateBody = liveLines(bashFunctionBody(lane, "check_nonpublic_fidelity"));
    const catRead = gateBody.find((l) => l.includes("nonpublic-catalogue.sql"));
    expect(catRead, "check_nonpublic_fidelity no longer reads nonpublic-catalogue.sql").toBeDefined();
    expect(
      catRead,
      "the catalogue is not read through the superuser DSN — pg_cron's RLS would hide every job registered under another role",
    ).toContain('"$admin_url"');
    const check = gateBody.find((l) => l.includes("nonpublic-objects.mjs") && l.includes("--check"));
    expect(check, "check_nonpublic_fidelity no longer runs the module's --check").toBeDefined();
    expect(check, "the gate no longer names the role the cron jobs must belong to").toContain('--cron-owner "$owner"');
    expect(check).toContain('--carried "$CARRIED_SET_FILE"');
    expect(exits(gateBody), "check_nonpublic_fidelity has a failure path that does not exit non-zero").toBeGreaterThanOrEqual(ifs(gateBody));

    // The catalogue READS everything and names nothing. The names it must not carry
    // are DERIVED from the migrations, so this cannot go stale with the corpus.
    const sqlLive = read("scripts/local-stack/nonpublic-catalogue.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sqlLive, "the catalogue no longer reads cron.job").toMatch(/\bFROM cron\.job\b/);
    expect(sqlLive, "the catalogue no longer excludes internal triggers").toContain("NOT t.tgisinternal");
    const migText = readdirSync(REPO_ROOT + "supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .map((f) => read(`supabase/migrations/${f}`))
      .join("\n");
    const declaredNames = new Set([
      ...[...migText.matchAll(/cron\s*\.\s*schedule\s*\(\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...migText.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+(?:BEFORE|AFTER)\s[^;]*?\bON\s+auth\.users\b/gi)].map((m) => m[1]),
    ]);
    expect(declaredNames.size, "derived no job or trigger name from supabase/migrations — this pin would check nothing").toBeGreaterThan(10);
    for (const name of declaredNames) {
      expect(sqlLive.includes(name), `nonpublic-catalogue.sql names \`${name}\` literally — the catalogue must read everything and let the module judge`).toBe(false);
    }
  });

  // ⭐ Phase 164.4.2 plan 11 (DECISION G), the cron class. Every `cron.schedule` /
  // `cron.unschedule` of the CARRIED migrations, folded in filename order, and the
  // lane's cron.job compared BYTE-EXACT (test_retention_crons_safe.sql reads the
  // command verbatim), registered as the loading role.
  describe("nonpublic-objects.mjs — the pg_cron class (D-G)", () => {
    const gate = nonpublicGate;
    const META = NONPUBLIC_META;
    const A = "20260101000000_a.sql";
    const B = "20260102000000_b.sql";
    const JOB = "DO $$\nBEGIN\n  PERFORM cron.schedule('d_job', '*/5 * * * *', $cron$SELECT 1$cron$);\nEND $$;\n";

    it("folds in filename order: a later schedule supersedes by name, unschedule removes, an unschedule of a never-scheduled name is a named no-op", () => {
      const r = gate(
        {
          [A]:
            "DO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN\n" +
            "    PERFORM cron.schedule('j_one', '*/5 * * * *', $cron$SELECT 1$cron$);\n" +
            "    PERFORM cron.schedule('j_two', '0 * * * *', $cron$SELECT 2$cron$);\n  END IF;\nEND $$;\n",
          [B]:
            "DO $$\nBEGIN\n  PERFORM cron.unschedule('j_two');\n  PERFORM cron.unschedule('never_scheduled');\n" +
            "  PERFORM cron.schedule('j_one', '*/10 * * * *', $cron$SELECT 11$cron$);\nEND $$;\n",
        },
        [A, B],
        [...META, cronRow("j_one", "*/10 * * * *", "SELECT 11")],
      );
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/cron-jobs=1\/1 drift=0 verdict OK$/m);
      expect(r.emitted.out).toContain("schedule-calls=3 unschedule-calls=2 cron-jobs=1 (j_one)");
      expect(r.emitted.out).toContain("no-op-unschedules=1 never-scheduled=1 (never_scheduled)");
      expect(r.emittedCron, "the emitted registration is not the last declaring call's own literal bytes").toBe(
        "SELECT cron.schedule('j_one', '*/10 * * * *', $cron$SELECT 11$cron$);\n",
      );
    });

    it("extracts every command byte-exact: $tag$ body, '' unescaped, the nested same-tag $$ inside DO $$, and a comment between arguments", () => {
      const r = gate(
        {
          [A]:
            "SELECT cron.schedule('k_dollar', '1 * * * *', $cron$ SELECT 'x' $cron$);\n" +
            "SELECT cron.schedule('k_quote', '2 * * * *', 'SELECT ''quoted'' AS q');\n" +
            "SELECT cron.schedule('k_comment' /* between */, -- and a line comment\n  '3 * * * *', $body$SELECT 3$body$);\n" +
            "DO $$\nBEGIN\n  PERFORM cron.schedule(\n    'k_nested',\n    '4 * * * *',  -- daily\n" +
            "    $$DELETE FROM t WHERE sent_at < now() - INTERVAL '90 days';$$\n  );\nEND $$;\n",
        },
        [A],
        [
          ...META,
          cronRow("k_dollar", "1 * * * *", " SELECT 'x' "),
          cronRow("k_quote", "2 * * * *", "SELECT 'quoted' AS q"),
          cronRow("k_comment", "3 * * * *", "SELECT 3"),
          cronRow("k_nested", "4 * * * *", "DELETE FROM t WHERE sent_at < now() - INTERVAL '90 days';"),
        ],
      );
      expect(r.status, `a command was not extracted byte-exact:\n${r.out}`).toBe(0);
      expect(r.out).toMatch(/cron-jobs=4\/4 drift=0 verdict OK$/m);
    });

    for (const [label, sql] of [
      ["an identifier argument", "SELECT cron.schedule(v_name, '1 * * * *', 'SELECT 1');\n"],
      ["a || concatenation", "SELECT cron.schedule('a', '1 * * * *', 'SELECT ' || '1');\n"],
      ["a format( call", "SELECT cron.schedule('a', '1 * * * *', format('SELECT %s', 1));\n"],
      [
        "a variable",
        "DO $$\nDECLARE v_cmd text := 'SELECT 1';\nBEGIN\n  PERFORM cron.schedule('a', '1 * * * *', v_cmd);\nEND $$;\n",
      ],
      ["an unclosed argument list", "SELECT cron.schedule('a', '1 * * * *', 'SELECT 1'\n"],
      ["the wrong arity", "SELECT cron.schedule('a', 'SELECT 1');\n"],
      ["a cron.alter_job call site", "SELECT cron.alter_job(1, schedule := '1 * * * *');\n"],
      ["a cron.schedule_in_database call site", "SELECT cron.schedule_in_database('a', '1 * * * *', 'SELECT 1', 'postgres');\n"],
      [
        "a cron call inside a single-quoted string an EXECUTE could run",
        "DO $$\nBEGIN\n  EXECUTE 'SELECT cron.schedule(''a'', ''1 * * * *'', ''SELECT 1'')';\nEND $$;\n",
      ],
      [
        "a cron call inside another call's arguments",
        "SELECT cron.schedule('a', '1 * * * *', $c$SELECT cron.schedule('b', '2 * * * *', 'SELECT 2')$c$);\n",
      ],
      // Review 164.4.2 WR-06: a function body is DEFINED by the migration, never
      // run by it, so a cron call there registered nothing on PROD. Folding it
      // would put a job on the lane PROD never had, and --check rebuilds its
      // expectation from the same fold, so it could not see the error.
      [
        "a cron call inside a CREATE FUNCTION body (defined, never run, at migration time)",
        "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$\nBEGIN\n  PERFORM cron.schedule('a', '1 * * * *', 'SELECT 1');\nEND $fn$;\n",
      ],
      // Round-2 review IN-02: the dollar-body scan returns OUTERMOST bodies only,
      // so a function body NESTED in a DO block read as the DO block and its
      // call was folded, though it is defined and never run. A dollar body
      // nested in a DO block is refused whatever it holds: a string there runs
      // only if something EXECUTEs it.
      [
        "a cron call inside a function body nested in a DO block (defined, never run, at migration time)",
        "DO $$\nBEGIN\n  CREATE FUNCTION g() RETURNS void LANGUAGE plpgsql AS $f$\n  BEGIN\n    PERFORM cron.schedule('a', '1 * * * *', 'SELECT 1');\n  END $f$;\nEND $$;\n",
      ],
      [
        "a cron call inside a dollar-quoted string nested in a DO block",
        "DO $$\nBEGIN\n  EXECUTE $q$SELECT cron.schedule('a', '1 * * * *', 'SELECT 1')$q$;\nEND $$;\n",
      ],
    ] as const) {
      it(`MEASURE_FAIL, naming the file, on ${label}`, () => {
        const r = gate({ [A]: sql }, [A], META);
        expect(r.emitted.status, `--emit accepted ${label}:\n${r.emitted.out}`).toBe(2);
        expect(r.emitted.out).toContain(A);
        expect(r.status, `--check accepted ${label}:\n${r.out}`).toBe(2);
        expect(r.out).toMatch(/verdict MEASURE_FAIL$/m);
      });
    }

    it("a cron call inside a DO LANGUAGE plpgsql body is folded like a DO $$ body (the WR-06 refusal is scoped to NON-DO bodies)", () => {
      const r = gate(
        { [A]: "DO LANGUAGE plpgsql $$\nBEGIN\n  PERFORM cron.schedule('d_job', '*/5 * * * *', $cron$SELECT 1$cron$);\nEND $$;\n" },
        [A],
        [...META, cronRow("d_job", "*/5 * * * *", "SELECT 1")],
      );
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/cron-jobs=1\/1 drift=0 verdict OK$/m);
    });

    it("MEASURE_FAIL when jobs are declared and the lane has no pg_cron", () => {
      const r = gate({ [A]: JOB }, [A], ["meta|superuser|t", "meta|database|postgres", "meta|pg_cron|0"]);
      expect(r.status, `declared jobs compared against a lane without pg_cron:\n${r.out}`).toBe(2);
      expect(r.out).toContain("pg_cron");
    });

    for (const [label, rows, finding] of [
      ["a missing job", [] as string[], "MISSING  cron job d_job"],
      [
        "an extra job",
        [cronRow("d_job", "*/5 * * * *", "SELECT 1"), cronRow("undeclared", "* * * * *", "SELECT 1")],
        "EXTRA    cron job undeclared",
      ],
      ["a changed schedule", [cronRow("d_job", "*/6 * * * *", "SELECT 1")], "DIFFERS  cron job d_job: schedule"],
      ["a command differing by one byte", [cronRow("d_job", "*/5 * * * *", "SELECT 2")], "DIFFERS  cron job d_job: command"],
      ["active false", [cronRow("d_job", "*/5 * * * *", "SELECT 1", { active: "f" })], "DIFFERS  cron job d_job: active"],
      [
        "a username other than the loading role",
        [cronRow("d_job", "*/5 * * * *", "SELECT 1", { username: "supabase_admin" })],
        "DIFFERS  cron job d_job: username",
      ],
      [
        "a job in another database",
        [cronRow("d_job", "*/5 * * * *", "SELECT 1", { database: "other" })],
        "DIFFERS  cron job d_job: database",
      ],
      [
        "a double registration",
        [cronRow("d_job", "*/5 * * * *", "SELECT 1"), cronRow("d_job", "*/5 * * * *", "SELECT 1")],
        "DUPLICATE cron job d_job",
      ],
    ] as const) {
      it(`DRIFT on ${label}`, () => {
        const r = gate({ [A]: JOB }, [A], [...META, ...rows]);
        expect(r.status, `the gate passed ${label}:\n${r.out}`).toBe(1);
        expect(r.out).toContain(finding);
        expect(r.out, "a command's TEXT reached the output — the CI log is public").not.toContain("SELECT 2");
      });
    }

    it("a job declared only in a file NOT in the carried set is not expected", () => {
      const r = gate({ [A]: "SELECT 1;\n", [B]: JOB }, [A], META);
      expect(r.status, `a non-carried migration's job became expected:\n${r.out}`).toBe(0);
      expect(r.out).toMatch(/cron-jobs=0\/0 drift=0 verdict OK$/m);
    });
  });

  // ⭐ Phase 164.4.2 plan 03. The guard above compares `git log -1 --format=%ct`
  // for two paths. On the default SHALLOW checkout both answers are the one
  // fetched commit's time, they compare equal, and the guard passes having
  // measured nothing — so the arm above would stay green over a CI that no
  // longer measures anything. This pins the CI half: both lane-booting jobs
  // fetch full history, and frontend-local-stack asks the seam before booting.
  // ⚠️ 2026-09-23 (plan 06, DECISION F): the lane's gate now reads the committed
  // marker, the dump's sha256 and the migrations directory ON DISK, so the
  // shallow-clone vacuity above no longer applies to it. The fetch-depth half
  // is kept, not deleted: it costs nothing, and the named seam step still does.
  // ⛔ CORRECTED 2026-09-23 (plan 08, D-F): the fetch-depth half is now RE-SUBJECTED,
  // not kept. MEASURED per job: no step in `frontend-local-stack`,
  // `frontend-live-db-lane` or `sql-tests` runs `git`, and none of the scripts or
  // lane spec files they run spawns it, so all three dropped `fetch-depth: 0` (the
  // epoch guard was its only stated consumer). What keeps a shallow clone SAFE there
  // is that the lane's gate reads no git history, so that is what the history half
  // now pins. The seam half covers all three jobs, since each now names its own
  // replay set before its boot.
  it("the lane's currency gate reads no git history (so a shallow clone cannot vacate it), and all three lane-booting CI jobs run the currency seam before the boot", () => {
    // (1) History. The lane calls the gate in --replay-set mode, and that mode's
    // body never reaches the epoch reader — the only git consumer in the gate. If
    // either half moves, a shallow-cloned lane job would compare two identical
    // commit times again and pass vacuously.
    const lane = read(RUN_SH);
    const gateCall = liveLines(bashFunctionBody(lane, "check_baseline_currency")).filter((l) =>
      l.includes("check-baseline-currency.mjs"),
    );
    expect(
      gateCall,
      "check_baseline_currency() no longer calls the gate exactly once in --replay-set mode — the default mode reads `git log`, which a shallow-cloned lane job cannot answer",
    ).toEqual([expect.stringMatching(/check-baseline-currency\.mjs" --replay-set$/)]);
    const gate = read("scripts/check-baseline-currency.mjs");
    const replayStart = gate.indexOf("\nfunction replayMain() {\n");
    expect(replayStart, "replayMain() is gone from check-baseline-currency.mjs").toBeGreaterThan(-1);
    const replayEnd = gate.indexOf("\n}\n", replayStart);
    expect(replayEnd, "could not find the end of replayMain()").toBeGreaterThan(replayStart);
    const replayBody = gate.slice(replayStart, replayEnd);
    for (const needle of ["readEpoch", "FRESHNESS_TS_CMD", "git", "child_process", "execFileSync"]) {
      expect(
        replayBody.includes(needle),
        `replayMain() mentions \`${needle}\` — the lane's gate may read git history again, and the lane jobs check out SHALLOW (plan 08 dropped fetch-depth: 0 on the measurement that nothing needed it)`,
      ).toBe(false);
    }

    // (2) Seam before boot, in EVERY lane-booting job, matched by the `run:` line.
    const jobBlock = (job: string, nextJob: string) => {
      const start = CI.indexOf(`\n  ${job}:\n`);
      expect(start, `the ${job} job is gone from ci.yml`).toBeGreaterThan(-1);
      const end = CI.indexOf(`\n  ${nextJob}:\n`, start);
      expect(end, `could not find the end of the ${job} block`).toBeGreaterThan(start);
      return liveLines(CI.slice(start, end));
    };
    for (const [job, next] of [
      [LANE_JOB, "frontend-live-db-lane"],
      ["frontend-live-db-lane", "frontend-policy"],
      ["sql-tests", "secret-scan"],
    ] as const) {
      const lines = jobBlock(job, next);
      const seam = lines.findIndex(
        (l) => l === "run: bash scripts/local-stack/run.sh --check-currency",
      );
      const boot = lines.findIndex((l) => l === "run: bash scripts/local-stack/run.sh up");
      expect(
        seam,
        `${job} no longer runs the lane's --check-currency seam as its own step — its log loses the named replay set, and a guard dropped from load_baseline() would boot quietly`,
      ).toBeGreaterThan(-1);
      expect(boot, `${job} no longer boots the lane with run.sh up`).toBeGreaterThan(-1);
      expect(seam < boot, `${job} runs the currency seam AFTER the boot`).toBe(true);
    }
  });
});

// ── Review 164.4.2 WR-08: ONE parse-based loopback-DSN check. ────────────────
// The `*@127.0.0.1:*` glob accepted `?host=` / `hostaddr=` overrides (libpq honours
// them, re-pointing the connection) and `@127.0.0.1:` smuggled into the userinfo.
// capability-probe.mjs's `refuseNonLocalDsn` parses the URL and refuses both; every
// DSN gate on the lane now calls that one rule instead of carrying its own glob.
describe("the lane's loopback-DSN gates all use capability-probe's parse-based rule (WR-08)", () => {
  const PROBE = REPO_ROOT + "scripts/local-stack/capability-probe.mjs";
  const refuse = (dsn: string | undefined) => {
    const env = { ...process.env };
    delete env.LOOPBACK_DSN;
    if (dsn !== undefined) env.LOOPBACK_DSN = dsn;
    const r = spawnSync(process.execPath, [PROBE, "--refuse-nonlocal-dsn"], { encoding: "utf8", env });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it("accepts a loopback DSN and refuses the shapes the glob let through, never echoing the DSN", () => {
    const local = refuse("postgresql://postgres@127.0.0.1:54322/postgres");
    expect(local.status, local.out).toBe(0);
    // Round-2 review WR-03: the DSNs carry no password (the pre-push credential
    // scan refuses one), so the no-echo check keys on a userinfo MARKER that is
    // not credential-shaped. An assertion on a string no input contains could
    // never fail.
    const MARKER = "nonecho_marker_user";
    for (const dsn of [
      `postgresql://${MARKER}@127.0.0.1:54322/postgres?host=db.example.invalid`,
      `postgresql://${MARKER}@127.0.0.1:54322/postgres?hostaddr=192.0.2.1`,
      `postgresql://${MARKER}@127.0.0.1:1@db.example.invalid:5432/postgres`,
      // Round-2 WR-02: libpq splits at the FIRST '@' and connects to the first
      // host of the comma list, db.example.invalid; a URL parser sees 127.0.0.1.
      `postgresql://${MARKER}@db.example.invalid,@127.0.0.1:54322/postgres`,
    ]) {
      const r = refuse(dsn);
      expect(r.status, `${dsn} was accepted:\n${r.out}`).toBe(1);
      expect(r.out, "AIM: the refusal was printed, so the no-echo checks below read real output").toContain("refusing a non-local database");
      expect(r.out).not.toContain(MARKER);
      expect(r.out).not.toContain("example.invalid");
    }
    const unset = refuse(undefined);
    expect(unset.status, "an unset LOOPBACK_DSN must be refused, never read as local").toBe(1);
  });

  it("run.sh's load_baseline and probe_function_denial_survives, and sql-tests' corpus step, call it and carry no loopback glob", () => {
    const lane = read(RUN_SH);
    const start = CI.indexOf("\n  sql-tests:\n");
    expect(start, "the sql-tests job is gone from ci.yml").toBeGreaterThan(-1);
    const end = CI.indexOf("\n  secret-scan:\n", start);
    expect(end, "could not find the end of the sql-tests block").toBeGreaterThan(start);
    for (const [where, body] of [
      ["load_baseline", liveLines(bashFunctionBody(lane, "load_baseline"))],
      ["probe_function_denial_survives", liveLines(bashFunctionBody(lane, "probe_function_denial_survives"))],
      ["sql-tests", liveLines(CI.slice(start, end))],
    ] as const) {
      expect(
        body.some((l) => l.includes("*@127.0.0.1:*")),
        `${where} still carries the '*@127.0.0.1:*' glob, which accepts ?host=/hostaddr= overrides`,
      ).toBe(false);
      expect(
        body.some((l) => l.includes("capability-probe.mjs") && l.includes("--refuse-nonlocal-dsn")),
        `${where} does not call capability-probe.mjs --refuse-nonlocal-dsn`,
      ).toBe(true);
    }
  });
});

// ── Review 164.4.2 WR-09: the image-pin check, EXECUTED against a stubbed docker. ──
// `case "$image" in */postgres:"$LANE_PG_VERSION")` lets `*` match a newline, so a
// `docker ps` answer of TWO containers passed whenever the LAST line was the pin.
describe("assert_lane_pg_image accepts exactly one line naming the pinned image (WR-09)", () => {
  const lane = read(RUN_SH);
  const pin = lane.match(/^LANE_PG_VERSION="(\d+\.\d+\.\d+\.\d+)"$/m)?.[1] ?? "";
  const body = bashFunctionBody(lane, "assert_lane_pg_image");
  const drive = (dockerOut: string) => {
    const dir = mkdtempSync(join(tmpdir(), "pg-image-"));
    try {
      const stub = join(dir, "docker");
      writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%b' "$STUB_OUT"\n`);
      chmodSync(stub, 0o755);
      const script = join(dir, "h.sh");
      writeFileSync(
        script,
        `set -u\nlog() { echo "$*"; }\nPROJECT_ID=lane\nLANE_PG_VERSION="${pin}"\nDOCKER_BIN="${stub}"\n${body}\n}\nassert_lane_pg_image\n`,
      );
      const r = spawnSync("bash", [script], { encoding: "utf8", env: { ...process.env, STUB_OUT: dockerOut } });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("CONTROL: the pinned image on one line passes", () => {
    expect(pin, "AIM: LANE_PG_VERSION was read from run.sh").not.toBe("");
    const r = drive(`public.ecr.aws/supabase/postgres:${pin}\n`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("postgres image pinned");
  });

  it("two lines, the LAST naming the pin, FAIL — never a match across a newline", () => {
    const r = drive(`evil.example.invalid/postgres:16.0\npublic.ecr.aws/supabase/postgres:${pin}\n`);
    expect(r.status, r.out).toBe(1);
    // Round-2 review IN-03: the anchored regex alone also rejects two lines, so
    // `status 1` could not tell which guard fired. The line-count guard this
    // test is named for must be the one that refused.
    expect(r.out).toContain("named more than one lane db container");
  });

  it("a tag that only starts with the pin, or a different pin, FAILS", () => {
    expect(drive(`public.ecr.aws/supabase/postgres:${pin}-rc1\n`).status).toBe(1);
    expect(drive("public.ecr.aws/supabase/postgres:17.6.1.106\n").status).toBe(1);
  });
});

// ── Review 164.4.2 IN-01: the default-ACL reset never re-quotes a regrole. ──────
// `regrole::text` is already a quoted identifier when a role name needs quoting, so
// `%I` or quote_ident over it names a role that does not exist. MEASURED on a
// scripts/pg-lane cluster with roles "Grantor-X" / "Grantee Y": the double-quoting
// form raised 42704 `role ""Grantee Y"" does not exist`; the %s form removed both
// default-ACL rows. That run needs a cluster; this pin keeps the fixed shape.
it("reset-public-default-acl.sql splices regrole::text with %s, never %I or quote_ident (IN-01)", () => {
  const sql = read("scripts/local-stack/reset-public-default-acl.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  expect(sql, "AIM: the reset still builds its REVOKE with format()").toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public/);
  expect(sql).not.toMatch(/FOR ROLE %I/);
  expect(sql).not.toMatch(/quote_ident\([^)]*regrole::text\)/);
});

// ── sql-corpus-report.mjs, EXECUTED in a scratch tree with a stubbed psql. ──────
// Review 164.4.2 IN-05: a green report must say out loud what it did NOT check,
// so it is never read as a green `sql-tests`. And the WR-08 class: its loopback
// check is the same parse-based rule as every other lane DSN gate.
describe("sql-corpus-report.mjs (IN-05, and the WR-08 loopback rule)", () => {
  const drive = (dsn: string) => {
    const root = mkdtempSync(join(tmpdir(), "corpus-report-"));
    try {
      const lane = join(root, "scripts", "local-stack");
      mkdirSync(lane, { recursive: true });
      for (const f of ["sql-corpus-report.mjs", "capability-probe.mjs"]) {
        writeFileSync(join(lane, f), read(`scripts/local-stack/${f}`));
      }
      writeFileSync(join(lane, ".stack-env"), `DB_URL="${dsn}"\n`);
      mkdirSync(join(root, "supabase", "tests"), { recursive: true });
      writeFileSync(join(root, "supabase", "tests", "test_ok.sql"), "SELECT 1;\n");
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "psql"), "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(join(bin, "psql"), 0o755);
      const r = spawnSync(process.execPath, [join(lane, "sql-corpus-report.mjs")], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("a green run prints that sentinels and arm rosters were NOT checked, beside its verdict", () => {
    const r = drive("postgresql://postgres@127.0.0.1:54322/postgres");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/^sql-corpus: files=1 pass=1 fail=0 /m);
    expect(r.out).toMatch(/^not-checked: .*completion sentinels.*arm rosters.* NOT a green sql-tests/m);
  });

  it("refuses a loopback-looking DSN whose ?host= re-points libpq (the parse-based rule, not a regex)", () => {
    // Round-2 review WR-03: a non-credential userinfo MARKER, so the no-echo
    // check can fail (the DSN carries no password for it to key on).
    const MARKER = "nonecho_marker_user";
    const r = drive(`postgresql://${MARKER}@127.0.0.1:54322/postgres?host=db.example.invalid`);
    expect(r.status, r.out).toBe(2);
    expect(r.out, "the refusal names the query string it refused").toContain("query string");
    expect(r.out).not.toContain(MARKER);
    expect(r.out).not.toContain("example.invalid");
  });
});
