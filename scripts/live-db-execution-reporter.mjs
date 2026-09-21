/**
 * THE LIVE-DB LANE'S EXECUTION ARTIFACT
 * (Phase 164.9 TESTISOLATION, ledger round arising from plan 08 + its fix round,
 * for `[164.9-LIVEDB-LANE-EXECUTION-CENSUS]`).
 *
 * A vitest reporter that writes ONE machine-readable record of what the lane
 * actually did: which modules ran, how many arms passed / failed / skipped, and
 * for every FAILED arm the module, the full arm name and the measured failure
 * text. `scripts/live-db-execution-ledger.mjs` consumes that artifact and
 * compares the failing set against the committed execution ledger.
 *
 * ── WHY A CUSTOM REPORTER AND NOT `--reporter=json` ────────────────────────
 * MEASURED 2026-09-21 on this corpus: vitest's built-in `json` reporter carries
 * only the FORMATTED assertion line, and for the six `wizard-rpcs-live-db` arms
 * that line reads `expected { code: '42501', details: null, …(2) } to be null` —
 * the serializer has ELIDED the two fields that say which failure this is. The
 * discriminator between "PostgreSQL withheld EXECUTE" and "the function body's
 * own role gate answered" lives in the elided `message` field, and the ledger's
 * kind routing turns on exactly that distinction. A reporter that reads the
 * error object directly does not lose it.
 *
 * ⭐ IT ALSO RECORDS WHAT NEVER RAN. A module that throws at import yields ZERO
 *    test cases, so before this it contributed no arm and no failure while still
 *    counting toward `counts.files` — an invisible hole the consuming gate read
 *    as a clean corpus. `moduleFailures` / `counts.moduleErrors` carry it, and
 *    the gate refuses on a non-zero count.
 *
 * ⛔ THIS REPORTER CHANGES NOTHING ABOUT WHAT RUNS. It observes the run at its
 *    end and writes a file. It selects no test, skips no test, and cannot change
 *    an arm's outcome — which is the property that lets the ledger gate claim
 *    every test still EXECUTES.
 *
 * ⚠️ THE ARTIFACT IS GITIGNORED AND MUST STAY THAT WAY. It carries verbatim
 *    failure text, which can include fixture values. The LEDGER carries verdicts
 *    only; this file is the raw measurement it is derived from, and the two have
 *    different disclosure postures on purpose. Absolute paths are stripped here
 *    anyway, so a pasted artifact does not leak a home directory or a username.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the artifact lands when the config does not say otherwise. */
export const DEFAULT_ARTIFACT = ".live-db-lane-execution.json";

/**
 * THE FRESHNESS NONCE. The gate sets this in the spawned lane's environment and
 * refuses an artifact that does not carry it back.
 *
 * ⛔ WHY. `existsSync` is not freshness. The artifact is written ONLY from
 * `onTestRunEnd`, so any vitest failure BEFORE run end (a config that fails to
 * load exits 1 with `Startup Error` and writes nothing) leaves the PREVIOUS
 * run's artifact on disk — and the gate would read it and re-issue its verdict,
 * including a fresh "the failing set is EXACTLY the ledger" for a run in which
 * vitest never started. CI is protected from that only by fresh checkouts, which
 * is an accident and not a control.
 */
export const RUN_ID_ENV = "LIVE_DB_LANE_RUN_ID";

/**
 * Remove absolute paths so the artifact never carries a home directory or a
 * username. Applied to every string that reaches the file.
 *
 * @param {unknown} value
 * @returns {string}
 */
function scrub(value) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : String(value);
  // Both the plain and the file:// spelling of the checkout root appear in
  // vitest stacks; replace the longer form first so the shorter cannot win.
  return text
    .split(`file://${REPO_ROOT}/`)
    .join("<repo>/")
    .split(`${REPO_ROOT}/`)
    .join("<repo>/");
}

/**
 * The lane's execution artifact, written once at run end.
 */
export default class LiveDbExecutionReporter {
  /**
   * @param {{ outputFile?: string }} [options]
   */
  constructor(options = {}) {
    this.outputFile = resolve(REPO_ROOT, options.outputFile || DEFAULT_ARTIFACT);
  }

  /**
   * @param {ReadonlyArray<any>} testModules
   * @param {ReadonlyArray<any>} unhandledErrors
   * @param {string} [reason]
   */
  onTestRunEnd(testModules, unhandledErrors, reason) {
    const modules = [];
    const failures = [];
    const moduleFailures = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let total = 0;

    for (const testModule of testModules) {
      const file = scrub(testModule.moduleId);
      modules.push(file);

      // ── A MODULE THAT NEVER COLLECTED, RECORDED RATHER THAN LOST ──────────
      // ⛔ MEASURED 2026-09-21 under vitest 4.1.10 with a two-file corpus, one
      // throwing at import: the throwing module yields ZERO test cases, so it
      // contributes zero arms and zero failures while STILL being pushed into
      // `modules` — `counts.files` stays at full corpus size. The artifact then
      // reads `reason: "failed", unhandledErrorCount: 0, failed: 0, failures: []`
      // and EVERY guard in the gate's `evaluate` is satisfied by it: the corpus
      // count is unchanged, the vacuity arms see non-zero totals from the files
      // that DID load, collection errors are module-attached rather than
      // unhandled, and "failed" is on the accepted-reason list. The gate would
      // print "no arm outside the ledger failed" — false, in the one job built
      // to make that sentence trustworthy.
      //
      // The information was HERE and was being discarded. It is emitted now, and
      // the gate REFUSES on a non-zero count: the module's arms never ran, so
      // they can never be ledgered and no verdict about the failing set is
      // supportable.
      const tests = [...testModule.children.allTests()];
      const moduleState = typeof testModule.state === "function" ? testModule.state() : undefined;
      const moduleErrors = typeof testModule.errors === "function" ? testModule.errors() || [] : [];
      if (moduleErrors.length > 0 || (moduleState === "failed" && tests.length === 0)) {
        moduleFailures.push({
          file,
          state: scrub(moduleState || "unknown"),
          collectedTests: tests.length,
          // ⛔ SCRUBBED. Error text carries absolute paths and this repository is
          // PUBLIC; the artifact is gitignored but it is also pasted into logs.
          errors: moduleErrors.map((error) => ({
            name: scrub((error && error.name) || "Error"),
            message: scrub(error && error.message),
          })),
        });
      }

      for (const testCase of tests) {
        total += 1;
        const result = testCase.result();
        if (result.state === "passed") passed += 1;
        else if (result.state === "skipped") skipped += 1;
        else if (result.state === "failed") {
          failed += 1;
          const error = (result.errors && result.errors[0]) || {};
          failures.push({
            file,
            fullName: testCase.fullName,
            errorName: scrub(error.name || "Error"),
            message: scrub(error.message),
            // `actual`/`expected`/`diff` are where a serialized PostgREST error
            // object lands. The kind routing reads them; see the header.
            actual: scrub(error.actual),
            expected: scrub(error.expected),
            diff: scrub(error.diff),
          });
        }
      }
    }

    modules.sort();
    moduleFailures.sort((a, b) => a.file.localeCompare(b.file));
    failures.sort((a, b) =>
      a.file === b.file
        ? a.fullName.localeCompare(b.fullName)
        : a.file.localeCompare(b.file),
    );

    const artifact = {
      schema: 2,
      // Echoed back from the environment the gate spawned this run with, so the
      // gate can tell THIS run's artifact from a stale one left by a run that
      // died before `onTestRunEnd`. Empty when the lane was run by hand.
      runId: scrub(process.env[RUN_ID_ENV] || ""),
      reason: reason || "unknown",
      unhandledErrorCount: (unhandledErrors || []).length,
      counts: {
        files: modules.length,
        total,
        passed,
        failed,
        skipped,
        moduleErrors: moduleFailures.length,
      },
      modules,
      moduleFailures,
      failures,
    };

    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
}
