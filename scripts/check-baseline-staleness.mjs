#!/usr/bin/env node
/**
 * BASELINE staleness gate — the CO-EDIT rule for the committed PROD schema dump.
 *
 * ⚠️ WHY THIS EXISTS, measured 2026-09-07 (Phase 164.5, criterion 2):
 * `supabase/schema/baseline.sql` is a 700KB committed `supabase db dump` of the
 * production catalogue, and `supabase/schema/BASELINE.md` records its sha256 in
 * a provenance table. A grep of `.github/workflows/` for the baseline returned
 * **ZERO** references. So a PR could edit the dump by one byte and leave the
 * provenance table — the only record of where those bytes came from — behind,
 * and every check would stay green. `BASELINE.md` says so about itself: "There
 * is **no staleness check on this file yet** … a snapshot with no drift gate is
 * exactly the artifact that diverges quietly and then gets trusted."
 *
 * THE RULE: the sha256 `BASELINE.md` records must equal the sha256 of the bytes
 * `baseline.sql` actually carries. The two move together or the gate fails.
 *
 * ⚠️ STATED OVERLAP, not a silent duplicate.
 * `src/__tests__/baseline-wiring-claim.test.ts`'s second `it` already asserts
 * this same equality, and it STAYS. The two answer one question at different
 * sampling rates: the vitest fires on a full-suite run, this gate fires on every
 * PR touching `supabase/schema/**`, including fork PRs, where the suite may not
 * run at all. The measured gap was CI PLACEMENT, not a missing assertion. So
 * this gate does not re-invent the extraction — `RECORDED_SHA_RE` below is the
 * same regex spelling the vitest uses, and `createHash("sha256")` over
 * `readFileSync` is the same hash. They cannot disagree by construction.
 *
 * ⛔ THIS REPOSITORY IS PUBLIC and `baseline.sql` is a pg_dump. This gate prints
 * HASHES and a BYTE COUNT only — never a line, a name or a fragment of the dump,
 * in any mode.
 *
 * ⛔ A hash that could not be READ is never a pass (phase decision D-02). An
 * absent or unparseable provenance row is its own named defect, and an
 * unreadable/empty `baseline.sql` is another — "could not measure" and "measured
 * zero problems" do not share a code path here.
 *
 * `--self-test` proves every named defect kind fires against synthetic inputs. A
 * gate whose red path has never been observed is the defect this repository's
 * 164.3 phase exists to remove.
 *
 * The EXACT commands CI runs, and the exact commands a developer runs locally:
 *
 *     node scripts/check-baseline-staleness.mjs --self-test
 *     node scripts/check-baseline-staleness.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFECTS = ["baseline-sha-mismatch", "baseline-sha-absent", "baseline-sql-unreadable"];

/**
 * The provenance-table row reader. ⛔ ONE SPELLING: copied from
 * `src/__tests__/baseline-wiring-claim.test.ts` so the vitest and this gate read
 * the same row the same way. Change it in one place and you have two answers.
 */
export const RECORDED_SHA_RE = /\|\s*sha256\s*\|\s*`([0-9a-f]{64})`\s*\|/;

/**
 * IN-03: the same spelling, globally, so the row can be COUNTED as well as read.
 *
 * `RECORDED_SHA_RE` takes the FIRST match. `BASELINE.md` is a provenance
 * document and every long-lived doc here accretes dated SUPERSEDED lineage — a
 * historical sha row added ABOVE the current one would silently move the
 * comparison onto a superseded hash. Rather than teach this gate a second,
 * cleverer row spelling (which would fork the ONE SPELLING contract above), it
 * counts: two or more rows is an AMBIGUOUS provenance table, which is a hash
 * that could not be READ, i.e. `baseline-sha-absent`.
 */
export const RECORDED_SHA_RE_ALL = new RegExp(RECORDED_SHA_RE.source, "g");

/**
 * PURE: given the facts, name every defect. No I/O, so the self-test drives the
 * REAL decision logic rather than a parallel copy of it.
 *
 * @param {{recordedSha: string|null, actualSha: string|null, actualBytes: number,
 *          recordedShaCount?: number}} facts
 *   `recordedSha` is null when BASELINE.md carries no parseable sha256 row.
 *   `actualSha` is null when baseline.sql could not be read at all.
 *   `recordedShaCount` is how many sha256 rows the provenance table carries
 *   (IN-03). It defaults to what `recordedSha` implies, so a caller that only
 *   knows the first row still gets the historical behaviour.
 */
export function judge({ recordedSha, actualSha, actualBytes, recordedShaCount = recordedSha ? 1 : 0 }) {
  const defects = [];

  // ⛔ FIRST, and it RETURNS: if the dump could not be measured, every downstream
  // comparison is a comparison against nothing. Reporting "matches" here — or
  // even reporting a mismatch — would be an answer to a question that was never
  // asked. "Could not measure" gets its own code path and its own kind.
  if (!actualSha || actualBytes === 0) {
    defects.push({
      kind: "baseline-sql-unreadable",
      detail:
        (actualSha
          ? // ⛔ The file EXISTS and hashes — to nothing. sha256("") is a real,
            // stable, meaningless hex string, and reporting it beside the
            // recorded row would read as a measurement of the dump.
            `supabase/schema/baseline.sql is present but EMPTY (bytes=0). Its sha256 is the ` +
            `sha256 of no bytes, which measures nothing about the production catalogue.`
          : `supabase/schema/baseline.sql could not be read at all, so no sha256 exists to compare.`) +
        ` This gate reports that it could not measure; it never reports a pass.`,
    });
    return defects;
  }

  if (!recordedSha) {
    defects.push({
      kind: "baseline-sha-absent",
      detail:
        `supabase/schema/BASELINE.md carries no parseable sha256 row in its provenance table, so ` +
        `there is nothing to compare the dump against. The dump hashes to ${actualSha}. ` +
        `A hash that could not be READ is never a pass — restore the row rather than deleting it.`,
    });
    return defects;
  }

  // IN-03: a SECOND sha256 row makes "the recorded hash" ambiguous, and the
  // reader above resolves that ambiguity by position alone — first wins. A
  // superseded lineage row pasted above the current one would therefore be
  // compared against silently. Ambiguous is not READ, so it is never a pass.
  if (recordedShaCount > 1) {
    defects.push({
      kind: "baseline-sha-absent",
      detail:
        `supabase/schema/BASELINE.md carries ${recordedShaCount} sha256 rows in its provenance ` +
        `table, so "the recorded hash" is AMBIGUOUS — this gate reads the FIRST one by position, ` +
        `which a dated SUPERSEDED row pasted above the current one would silently become. The ` +
        `dump hashes to ${actualSha}. Leave exactly ONE sha256 row; record lineage in prose.`,
    });
    return defects;
  }

  if (recordedSha !== actualSha) {
    defects.push({
      kind: "baseline-sha-mismatch",
      detail:
        `supabase/schema/baseline.sql does not hash to the value supabase/schema/BASELINE.md ` +
        `records. BASELINE.md records ${recordedSha}; the committed ${actualBytes}-byte dump ` +
        `hashes to ${actualSha}. Either the dump was regenerated without updating the provenance ` +
        `table, or it was edited by hand. The two move together or neither moves.`,
    });
  }

  return defects;
}

/**
 * IN-02: how many `ok()` calls the nine sections below are declared to run.
 * ⛔ Raise it only together with the arm that adds one; lowering it to make a
 * run green is deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 12;

function selfTest() {
  let pass = true;
  let asserted = 0;
  const ok = (cond, msg) => {
    asserted += 1;
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    if (!cond) pass = false;
    return cond;
  };
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const clean = { recordedSha: A, actualSha: A, actualBytes: 701524 };

  console.log("=== SELF-TEST 1/9: recorded hash equals the file's hash → clean");
  ok(judge(clean).length === 0, "no defects when BASELINE.md and baseline.sql agree");

  console.log("=== SELF-TEST 2/9: the dump moved, the provenance row did not (the CO-EDIT defect)");
  const d2 = judge({ ...clean, actualSha: B });
  ok(
    d2.some((d) => d.kind === "baseline-sha-mismatch"),
    "baseline-sha-mismatch fires on a one-byte edit with no BASELINE.md update",
  );
  ok(
    d2.some((d) => d.kind === "baseline-sha-mismatch" && d.detail.includes(A) && d.detail.includes(B)),
    "the mismatch detail prints BOTH hashes so the reader can tell which side moved",
  );

  console.log("=== SELF-TEST 3/9: BASELINE.md carries no parseable sha256 row (D-02)");
  ok(
    judge({ ...clean, recordedSha: null }).some((d) => d.kind === "baseline-sha-absent"),
    "baseline-sha-absent fires — a hash that could not be READ is never a pass",
  );

  console.log("=== SELF-TEST 4/9: an absent row and a wrong row are DISTINGUISHABLE");
  // Mutation arms 1 and 3 rest entirely on this: two different red states must
  // not collapse into one indistinguishable "exit 1".
  const kAbsent = judge({ ...clean, recordedSha: null }).map((d) => d.kind);
  const kMismatch = judge({ ...clean, actualSha: B }).map((d) => d.kind);
  ok(
    kAbsent.length > 0 && kMismatch.length > 0 && kAbsent.join() !== kMismatch.join(),
    `absent (${kAbsent.join()}) and mismatch (${kMismatch.join()}) name different kinds`,
  );

  console.log("=== SELF-TEST 5/9: baseline.sql unreadable → its own kind, never a pass");
  ok(
    judge({ ...clean, actualSha: null }).some((d) => d.kind === "baseline-sql-unreadable"),
    "baseline-sql-unreadable fires when the dump could not be read",
  );

  console.log("=== SELF-TEST 6/9: baseline.sql present but EMPTY → same kind, still not a pass");
  const d6 = judge({ ...clean, actualBytes: 0 });
  ok(
    d6.some((d) => d.kind === "baseline-sql-unreadable"),
    "a zero-byte dump is 'could not measure', not 'measured zero problems'",
  );
  // MEASURED 2026-09-07 (arm 4): an empty file hashes to sha256("") — a real hex
  // string. The first wording said "could not be computed" while the summary line
  // printed that hash in the `actual=` slot, which reads as a measurement of the
  // dump. The two unmeasurable states must say which one they are.
  ok(
    d6[0].detail.includes("EMPTY") &&
      !judge({ ...clean, actualSha: null }).some((d) => d.detail.includes("EMPTY")),
    "the EMPTY wording and the could-not-read wording are different sentences",
  );

  console.log("=== SELF-TEST 7/9: an unmeasurable dump is never reported clean");
  ok(judge({ recordedSha: A, actualSha: null, actualBytes: 0 }).length > 0, "no silent green when nothing was measured");

  console.log("=== SELF-TEST 8/9: TWO sha256 rows → ambiguous, never compared against the first (IN-03)");
  const d8 = judge({ ...clean, recordedShaCount: 2 });
  ok(
    d8.some((d) => d.kind === "baseline-sha-absent"),
    "baseline-sha-absent fires when the provenance table carries more than one sha256 row",
  );
  // ⛔ The ambiguous state must be a DIFFERENT SENTENCE from the absent one, and
  // it must not read as clean just because the FIRST row happens to match — that
  // is exactly the superseded-lineage row this arm exists for.
  ok(
    d8.some((d) => d.detail.includes("AMBIGUOUS")) && judge(clean).length === 0,
    "the AMBIGUOUS wording is its own sentence, and ONE matching row is still clean",
  );

  console.log("=== SELF-TEST 9/9: every kind judge() can emit is named in DEFECTS");
  const emitted = new Set(
    [
      ...judge({ ...clean, actualSha: B }),
      ...judge({ ...clean, recordedSha: null }),
      ...judge({ ...clean, actualSha: null }),
      ...judge({ ...clean, actualBytes: 0 }),
      ...judge({ ...clean, recordedShaCount: 2 }),
    ].map((d) => d.kind),
  );
  ok(
    emitted.size === DEFECTS.length && [...emitted].every((k) => DEFECTS.includes(k)),
    `DEFECTS names exactly the ${emitted.size} kind(s) observed: ${[...emitted].sort().join(", ")}`,
  );

  console.log("");
  // IN-02: the closing line used to print `${asserted}/${asserted}`, which is
  // true of a run that asserted ten things and of one that asserted one. The
  // count is PINNED instead — the `pass -ne total` shape
  // `scripts/prod-body-drift-check.sh` uses — so an arm deleted or skipped is
  // its own named failure rather than a smaller, still-green number.
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
    `=== SELF-TEST PASSED: ${asserted}/${EXPECTED_ASSERTIONS} declared assertions across 9 sections, ` +
      `every defect kind fired on its own input ===`,
  );
  return 0;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_MD_REL = "supabase/schema/BASELINE.md";
const BASELINE_SQL_REL = "supabase/schema/baseline.sql";

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  // ⛔ A typo'd flag must not silently fall through to a green corpus run.
  const unknown = argv.filter((a) => a !== "--self-test");
  if (unknown.length > 0) {
    console.error(`::error::unknown argument(s): ${unknown.join(" ")} — this gate takes only --self-test`);
    return 1;
  }

  let md;
  try {
    md = readFileSync(join(REPO_ROOT, BASELINE_MD_REL), "utf8");
  } catch (e) {
    // ⛔ A gate that cannot read cannot report a pass.
    console.error(`MEASURE_FAIL: could not read ${BASELINE_MD_REL} — ${e.message}`);
    return 1;
  }
  const recordedSha = RECORDED_SHA_RE.exec(md)?.[1] ?? null;
  // IN-03: a fresh matcher per run — a `g` regex carries `lastIndex` state.
  const recordedShaCount = md.match(new RegExp(RECORDED_SHA_RE_ALL.source, "g"))?.length ?? 0;

  let bytes = null;
  try {
    bytes = readFileSync(join(REPO_ROOT, BASELINE_SQL_REL));
  } catch (e) {
    console.error(`${BASELINE_SQL_REL} could not be read — ${e.message}`);
  }
  const actualBytes = bytes ? bytes.length : 0;
  const actualSha = bytes ? createHash("sha256").update(bytes).digest("hex") : null;

  const defects = judge({ recordedSha, actualSha, actualBytes, recordedShaCount });
  // Never let "clean" and "did not run" look alike: this line prints at zero too.
  // ⛔ An empty file hashes to sha256("") — a real hex string that measures
  // NOTHING. Printing it in the `actual=` slot would present a non-measurement
  // as a measurement, so say UNMEASURABLE and let the byte count carry the why.
  const actualDisplay = !actualSha ? "UNREADABLE" : actualBytes === 0 ? "UNMEASURABLE(empty file)" : actualSha;
  console.log(
    `baseline=${BASELINE_SQL_REL} bytes=${actualBytes} recorded=${recordedSha ?? "ABSENT"} ` +
      `recorded-rows=${recordedShaCount} ` +
      `actual=${actualDisplay} defects=${defects.length}`,
  );
  if (defects.length === 0) {
    console.log(`✅ No defects — ${BASELINE_SQL_REL} matches the sha256 recorded in ${BASELINE_MD_REL}`);
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
 * `scripts/lint-app-guc.mjs` and `scripts/check-banned-packages.mjs`.
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
