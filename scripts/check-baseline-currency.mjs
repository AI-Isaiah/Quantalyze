#!/usr/bin/env node
/**
 * BASELINE CURRENCY gate — is the committed schema dump at least as fresh as
 * the migrations that have landed since it was last regenerated?
 *
 * ⚠️ WHY THIS EXISTS, measured at Phase 164.4.2 SUBSETSPLIT (CONTEXT.md Area A):
 * `scripts/check-baseline-staleness.mjs` — despite its name — verifies only
 * that `supabase/schema/baseline.sql`'s sha256 matches the row
 * `supabase/schema/BASELINE.md` records. That is INTEGRITY (did the bytes on
 * disk change without updating provenance?), never CURRENCY (did a migration
 * land after the dump was last regenerated?). The only place CURRENCY was
 * implemented anywhere in this repo was `refuse_stale_baseline()` inside
 * `scripts/restore-test-from-baseline.sh`, reachable only from the restore
 * path. The ephemeral local-stack path that builds throwaway test databases
 * from this same baseline (`scripts/local-stack/run.sh`) called NEITHER
 * check — so a schema missing real migrations could boot green and every
 * downstream test would say nothing about the gap.
 *
 * THE RULE: baseline's last-changed epoch must be >= migrations dir's
 * last-changed epoch. Equal is fresh enough — a dump regenerated in the same
 * commit as the last migration is current. Less than is STALE.
 *
 * ⛔ Forbidden closure (CONTEXT.md Area A): do NOT rename or re-scope
 * `check-baseline-staleness.mjs` to claim this behaviour — it stays an
 * INTEGRITY gate, unchanged. This is a SEPARATE, NAMED gate, and
 * `refuse_stale_baseline()` is re-pointed at it (164.4.2 plan 02, task 2) so
 * there is exactly ONE currency implementation reachable from both callers,
 * with a name that matches what it measures.
 *
 * An unreadable timestamp is refused BY NAME before any numeric comparison
 * runs — a shallow clone or a missing path prints nothing, and nothing is
 * not an epoch. Treating "could not measure" as "measured fresh" would let a
 * CI runner with a shallow checkout pass this gate vacuously.
 *
 * `--self-test` drives `judge()` directly over every named defect kind,
 * proving the refusal fires rather than assuming it.
 *
 * The EXACT commands CI runs, and the exact commands a developer runs locally:
 *
 *     node scripts/check-baseline-currency.mjs --self-test
 *     node scripts/check-baseline-currency.mjs
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFECTS = ["baseline-stale", "baseline-epoch-unreadable", "migrations-epoch-unreadable"];

const EPOCH_RE = /^[0-9]+$/;

/**
 * PURE: given two already-read timestamp strings (and, for messaging only,
 * the two path labels), name every defect. No I/O, so the self-test drives
 * the REAL decision logic rather than a parallel copy of it.
 *
 * Mirrors `scripts/restore-test-from-baseline.sh`'s own `refuse_stale_baseline`
 * guards exactly: baseline is checked BEFORE migrations, and an unreadable
 * epoch on either side returns immediately — a numeric comparison against an
 * unreadable value would be a comparison against nothing.
 *
 * @param {{baselineEpoch: string, migrationsEpoch: string,
 *          baselineFile?: string, migrationsDir?: string}} facts
 *   `baselineFile`/`migrationsDir` are labels used only in message text; they
 *   default to generic descriptors so a caller that only has the two epochs
 *   still gets correct decision logic.
 */
export function judge({
  baselineEpoch,
  migrationsEpoch,
  baselineFile = "the baseline file",
  migrationsDir = "the migrations directory",
}) {
  const defects = [];
  const b = String(baselineEpoch ?? "").trim();
  const m = String(migrationsEpoch ?? "").trim();

  // ⛔ FIRST, and it RETURNS: an unreadable epoch is never fresh, and a
  // comparison against it would be a comparison against nothing. Mirrors
  // bash's `case "$b_ts" in ''|*[!0-9]*)` guard, which fires before `$m_ts`
  // is even inspected.
  if (!EPOCH_RE.test(b)) {
    defects.push({
      kind: "baseline-epoch-unreadable",
      detail:
        `FRESHNESS_TS_CMD printed no epoch for ${baselineFile} (got '${b}'). ` +
        `An unreadable timestamp is not a fresh one.`,
    });
    return defects;
  }
  if (!EPOCH_RE.test(m)) {
    defects.push({
      kind: "migrations-epoch-unreadable",
      detail:
        `FRESHNESS_TS_CMD printed no epoch for ${migrationsDir} (got '${m}'). ` +
        `An unreadable timestamp is not a fresh one.`,
    });
    return defects;
  }

  const bEpoch = Number(b);
  const mEpoch = Number(m);
  // Equal is fresh enough — the comparator uses `-lt`, not `-le`, matching
  // the pre-existing bash behaviour this gate replaces (restore-test-from-
  // baseline.sh's `refuse_stale_baseline`).
  if (bEpoch < mEpoch) {
    defects.push({
      kind: "baseline-stale",
      detail:
        `the baseline dump is STALE: ${baselineFile} last changed at epoch ${bEpoch}, ` +
        `${migrationsDir} at epoch ${mEpoch}. A migration landed after the last dump ` +
        `regeneration, so this dump does not describe PROD. Regenerate the baseline first.`,
    });
  }

  return defects;
}

/**
 * How many `ok()` calls the eight sections below are declared to run.
 * ⛔ Raise it only together with the arm that adds one; lowering it to make a
 * run green is deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 11;

function selfTest() {
  let pass = true;
  let asserted = 0;
  const ok = (cond, msg) => {
    asserted += 1;
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    if (!cond) pass = false;
    return cond;
  };

  console.log("=== SELF-TEST 1/8: baseline epoch > migrations epoch -> clean");
  ok(
    judge({ baselineEpoch: "2000000000", migrationsEpoch: "1000000000" }).length === 0,
    "no defects when the baseline is newer than the migrations dir",
  );

  console.log("=== SELF-TEST 2/8: baseline epoch == migrations epoch -> clean (the comparator uses -lt, not -le)");
  ok(
    judge({ baselineEpoch: "1500000000", migrationsEpoch: "1500000000" }).length === 0,
    "equal epochs are fresh enough",
  );

  console.log("=== SELF-TEST 3/8: baseline epoch < migrations epoch -> baseline-stale, phrase and both epochs present");
  const d3 = judge({
    baselineEpoch: "1000000000",
    migrationsEpoch: "2000000000",
    baselineFile: "BF",
    migrationsDir: "MD",
  });
  ok(d3.length === 1 && d3[0].kind === "baseline-stale", "baseline-stale fires when the baseline is behind");
  ok(
    d3[0].detail.includes("the baseline dump is STALE"),
    "the message carries the load-bearing phrase the restore script's self-test arm 5 greps for",
  );
  ok(
    d3[0].detail.includes("1000000000") && d3[0].detail.includes("2000000000"),
    "the message names BOTH epochs, so a reader can tell which side is behind",
  );

  console.log("=== SELF-TEST 4/8: baseline timestamp empty -> baseline-epoch-unreadable");
  ok(
    judge({ baselineEpoch: "", migrationsEpoch: "1000000000" }).some((d) => d.kind === "baseline-epoch-unreadable"),
    "an empty baseline epoch is refused by name — an unreadable timestamp is not a fresh one",
  );

  console.log("=== SELF-TEST 5/8: baseline timestamp non-numeric -> same defect kind");
  ok(
    judge({ baselineEpoch: "not-a-number", migrationsEpoch: "1000000000" }).some(
      (d) => d.kind === "baseline-epoch-unreadable",
    ),
    "a non-numeric baseline epoch is the SAME kind as an empty one",
  );

  console.log("=== SELF-TEST 6/8: migrations timestamp empty or non-numeric -> migrations-epoch-unreadable");
  ok(
    judge({ baselineEpoch: "1000000000", migrationsEpoch: "" }).some(
      (d) => d.kind === "migrations-epoch-unreadable",
    ),
    "an empty migrations epoch is refused by name",
  );
  ok(
    judge({ baselineEpoch: "1000000000", migrationsEpoch: "not-a-number" }).some(
      (d) => d.kind === "migrations-epoch-unreadable",
    ),
    "a non-numeric migrations epoch is refused by name",
  );

  console.log("=== SELF-TEST 7/8: an unreadable baseline is checked BEFORE migrations (bash's own order)");
  const d7 = judge({ baselineEpoch: "", migrationsEpoch: "" });
  ok(
    d7.length === 1 && d7[0].kind === "baseline-epoch-unreadable",
    "when BOTH epochs are unreadable, only baseline-epoch-unreadable fires — a comparison against two unreadable values would be a comparison against nothing, twice",
  );

  console.log("=== SELF-TEST 8/8: every kind judge() can emit is named in DEFECTS");
  const emitted = new Set(
    [
      ...judge({ baselineEpoch: "1000000000", migrationsEpoch: "2000000000" }),
      ...judge({ baselineEpoch: "", migrationsEpoch: "1000000000" }),
      ...judge({ baselineEpoch: "1000000000", migrationsEpoch: "" }),
    ].map((d) => d.kind),
  );
  ok(
    emitted.size === DEFECTS.length && [...emitted].every((k) => DEFECTS.includes(k)),
    `DEFECTS names exactly the ${emitted.size} kind(s) observed: ${[...emitted].sort().join(", ")}`,
  );

  console.log("");
  if (asserted !== EXPECTED_ASSERTIONS) {
    console.error(
      `=== SELF-TEST FAILED: ${asserted} assertion(s) ran, but this self-test declares ` +
        `${EXPECTED_ASSERTIONS}. An arm was deleted, skipped, or added without updating ` +
        `EXPECTED_ASSERTIONS. A shrinking self-test that still says PASSED is the defect. ===`,
    );
    return 1;
  }
  if (!pass) {
    console.error(`=== SELF-TEST FAILED: ${asserted} assertion(s) run, at least one did not hold ===`);
    return 1;
  }
  console.log(
    `=== SELF-TEST PASSED: ${asserted}/${EXPECTED_ASSERTIONS} declared assertions across 8 sections, ` +
      `every defect kind fired on its own input ===`,
  );
  return 0;
}

/**
 * Invoke `FRESHNESS_TS_CMD <path>` through an argv ARRAY, never a shell
 * string — splits the command on whitespace, uses element 0 as the binary
 * and the remainder plus `path` as the argv tail. Reproduces what bash's
 * unquoted `$FRESHNESS_TS_CMD "$path"` expansion does today, with no shell
 * in the middle. A non-zero exit or a throw is an UNREADABLE epoch — its own
 * defect kind via `judge()`, never a fresh one.
 */
function readEpoch(freshnessCmd, path) {
  const parts = String(freshnessCmd).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const [bin, ...rest] = parts;
  try {
    const out = execFileSync(bin, [...rest, path], { encoding: "utf8" });
    return (out.split("\n")[0] ?? "").trim();
  } catch {
    return "";
  }
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  // ⛔ A typo'd flag must not silently fall through to a green corpus run.
  const unknown = argv.filter((a) => a !== "--self-test");
  if (unknown.length > 0) {
    console.error(`::error::unknown argument(s): ${unknown.join(" ")} — this gate takes only --self-test`);
    return 1;
  }

  // Same env seams and same defaults as scripts/restore-test-from-baseline.sh's
  // `refuse_stale_baseline` assignment block — kept identical so relocating the
  // caller onto this gate (164.4.2 plan 02, task 2) does not change what either
  // side decides.
  const baselineFile = process.env.BASELINE_FILE || "supabase/schema/baseline.sql";
  const migrationsDir = process.env.MIGRATIONS_DIR || "supabase/migrations";
  const freshnessCmd = process.env.FRESHNESS_TS_CMD || "git log -1 --format=%ct --";

  const baselineEpoch = readEpoch(freshnessCmd, baselineFile);
  const migrationsEpoch = readEpoch(freshnessCmd, migrationsDir);

  const defects = judge({ baselineEpoch, migrationsEpoch, baselineFile, migrationsDir });

  // Never let "clean" and "did not run" look alike: this line prints on
  // every exit, defects=0 included.
  console.log(
    `baseline-currency: baseline=${baselineEpoch || "UNREADABLE"} migrations=${migrationsEpoch || "UNREADABLE"} ` +
      `defects=${defects.length}`,
  );
  if (defects.length === 0) {
    console.log(`✅ No defects — ${baselineFile} is at least as fresh as ${migrationsDir}`);
    return 0;
  }
  for (const d of defects) console.error(`::error::${d.kind} — ${d.detail}`);
  console.error(`${defects.length} defect(s)`);
  return 1;
}

/**
 * Realpath-safe main-module guard — the `[VAC04-C2]` lesson: comparing
 * `import.meta.url` to `file://${process.argv[1]}` no-ops on symlinked or
 * space-bearing paths, silently turning the CLI into a library. Same idiom as
 * `scripts/check-baseline-staleness.mjs`, `scripts/lint-app-guc.mjs` and
 * `scripts/check-banned-packages.mjs`.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
