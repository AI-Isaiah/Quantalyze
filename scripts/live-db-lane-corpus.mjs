#!/usr/bin/env node
/**
 * THE LIVE-DB LANE'S CORPUS, DERIVED AT RUN TIME
 * (Phase 164.9 plan 08, ROADMAP criterion 13 / `[164.9-CREDENTIALED-TESTS-RED-AND-UNGATED]`).
 *
 * Prints, one per line, every TEST file whose source references the live-DB gate
 * symbol `HAS_LIVE_DB`, then a final `corpus: N file(s)` line. This is what
 * `vitest.livedb.config.ts` includes, and what the `frontend-live-db-lane` job
 * in `.github/workflows/ci.yml` preflights before it boots anything.
 *
 * ── WHY DERIVED RATHER THAN LISTED ──────────────────────────────────────────
 * A static list goes stale silently and in the ONE direction that reads as
 * success: a new `it.skipIf(!HAS_LIVE_DB)` spec that nobody adds to the list
 * runs NOWHERE, while the lane still exits 0 on the files it does know about.
 * That is `src/__tests__/csv-finalize-rpc.test.ts`'s tombstone — six live-DB
 * cases that skipped silently in every CI shard for months — reproduced with a
 * different mechanism. Deriving from the gate symbol means a newly gated spec is
 * picked up by the next run, with nobody remembering anything.
 *
 * ⛔ AND IT IS NOT A FILENAME GLOB. MEASURED: only a handful of the ~50 gated
 * files follow any naming convention, so a glob would miss most of the corpus
 * while looking exhaustive.
 *
 * ⛔ AND IT IS NOT A TEXT SEARCH. This repo has a MEASURED grep-blind file —
 * `src/lib/wizardErrors.test.ts` carries a deliberate NUL byte that makes `grep`
 * skip it silently and still report success. So the walk goes through node's own
 * filesystem API and a `String.prototype.includes` scan over decoded text, which
 * does not share that blind spot. No shell glob, no `grep`, no `find`: this
 * process spawns nothing at all.
 *
 * ── ONE DERIVATION, TWO CONSUMERS ───────────────────────────────────────────
 * `walkCorpus` and `LIVE_DB_GATE_SYMBOL` are IMPORTED from
 * `scripts/live-db-fixture-drift-census.mjs` rather than re-implemented here, so
 * the population this lane RUNS and the population that census MEASURES are the
 * same population by construction. Two independent walks that agree today are
 * two walks that can disagree tomorrow, and the disagreement would be invisible:
 * each tool would keep reporting a complete-looking answer about its own half.
 *
 * ── WHAT THIS ADDS ON TOP OF THE CENSUS WALK ────────────────────────────────
 * The census corpus includes non-spec sources that merely NAME the gate symbol
 * (the helper that declares it, for one). A vitest `include` list must hold test
 * files only, so this filters to `*.test.ts` / `*.test.tsx`.
 *
 * ⛔ AN EMPTY CORPUS IS A HARD FAILURE, never a quiet pass. A lane that ran
 * nothing and exited 0 is the precise silent-green this phase exists to end, so
 * an empty result exits 1 with a named error. "Could not measure" and "measured
 * zero" are different answers.
 *
 * ── USAGE (CI pastes the first form VERBATIM — mode identity) ───────────────
 *   node scripts/live-db-lane-corpus.mjs              # the real corpus
 *   node scripts/live-db-lane-corpus.mjs --root <dir> # ad-hoc / test-only root
 *
 * Exported for `vitest.livedb.config.ts`, which calls `liveDbLaneCorpus()` at
 * config-evaluation time instead of shelling out to this file.
 */
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIVE_DB_GATE_SYMBOL,
  walkCorpus,
} from "./live-db-fixture-drift-census.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = "src";

/** A vitest `include` entry must be a spec file, not merely a gate-symbol mention. */
const SPEC_SUFFIX = /\.test\.tsx?$/;

/**
 * THE CORPUS RATCHET FLOOR. MEASURED 49 on 2026-09-21; pinned a few under, the
 * repo's ratchet convention, so a real collapse reddens and ordinary churn does
 * not.
 *
 * ⛔ WHY A FLOOR IS THE ONLY CONTROL HERE, and why it must be TIGHT. The lane's
 * vitest `include` and the execution gate's `corpusSize` both come from THIS ONE
 * derivation. So deleting the `HAS_LIVE_DB` reference in a failing spec drops
 * that file from BOTH sides at once: the gate's CORPUS MISMATCH arm compares the
 * narrowed run to the narrowed expectation, finds them equal, and the file's
 * ledgered arms then read as STALE — a second road to a false "the failing set
 * is EXACTLY the ledger". A single shared derivation cannot detect its own
 * narrowing by comparison, so the only thing bounding it is how far this number
 * sits below the measured corpus.
 *
 * ⛔ IT ONLY RISES. The stale-low direction — a floor left far below a grown
 * corpus, re-opening the headroom — is caught one layer up by
 * `src/__tests__/live-db-execution-ledger.contract.test.ts`, which re-derives
 * the corpus and fails when this number has been allowed to drift behind it.
 * That is the repo's two-layer floor idiom: the runner gates the lower bound,
 * the vitest ratchet gates the staleness.
 *
 * RAISED 46 -> 47 on 2026-09-25 (Phase 167.2.1 plan 01): the corpus MEASURED 50
 * after `src/__tests__/factsheet-buildable-live-db.test.ts` joined it, and the
 * contract test's stale-low arm went RED at 4 files of headroom. Pinned 3 under
 * the measured corpus, the same distance as the 2026-09-21 pin.
 */
export const CORPUS_FLOOR = 47;

/**
 * Every test file under `root` whose source references the live-DB gate symbol,
 * as repo-relative POSIX-ish paths, sorted so two runs on the same tree produce
 * byte-identical output.
 *
 * @param {string} [root] repo-relative directory to walk (default `src`).
 * @returns {string[]}
 */
export function liveDbLaneCorpus(root = DEFAULT_ROOT) {
  const rootAbs = resolve(REPO_ROOT, root);
  return walkCorpus(rootAbs)
    .map((abs) => relative(REPO_ROOT, abs).split("\\").join("/"))
    .filter((rel) => SPEC_SUFFIX.test(rel))
    .sort();
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      const next = argv[i + 1];
      if (!next) return { error: "--root requires a directory argument" };
      root = next;
      i += 1;
    } else {
      return { error: `unknown argument '${argv[i]}'` };
    }
  }
  return { root };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) {
    console.error(`live-db-lane-corpus: ${opts.error}`);
    return 1;
  }
  const files = liveDbLaneCorpus(opts.root);
  for (const f of files) console.log(f);
  console.log(`corpus: ${files.length} file(s)`);
  if (files.length === 0) {
    console.error(
      `live-db-lane-corpus: EMPTY CORPUS under '${opts.root}' — no test file references ` +
        `${LIVE_DB_GATE_SYMBOL}. This is a MEASURE_FAIL, not a clean run: a lane with nothing ` +
        `in it must never report a green pass. Either the gate symbol was renamed (fix the one ` +
        `declaration both this tool and the fixture-drift census import) or the walk root is wrong.`,
    );
    return 1;
  }
  // A non-empty but COLLAPSED corpus is the narrowing hazard the floor exists
  // for; "smaller than it has ever been" is not a clean run either.
  if (opts.root === DEFAULT_ROOT && files.length < CORPUS_FLOOR) {
    console.error(
      `live-db-lane-corpus: CORPUS COLLAPSED to ${files.length} file(s), below the pinned floor of ` +
        `${CORPUS_FLOOR}. This is a MEASURE_FAIL. The lane's include list and the execution gate's ` +
        `corpus size come from this one derivation, so a narrowing here is invisible to the gate's own ` +
        `comparison — see CORPUS_FLOOR. Do NOT lower the floor; find the files that stopped referencing ` +
        `the gate symbol.`,
    );
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main(process.argv.slice(2)));
}
