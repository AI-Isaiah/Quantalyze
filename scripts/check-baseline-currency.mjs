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
 *
 * ── `--replay-set` (Phase 164.4.2 DECISION F, founder 2026-09-23) ───────────
 *
 * The DEFAULT mode above is the restore path's refusal and is unchanged, byte
 * for byte. `--replay-set` is the LOCAL-STACK LANE's use of this gate, where a
 * migration newer than the dump is the NORMAL case: the lane loads the dump and
 * then replays, in filename order, exactly the migrations the dump does not
 * carry. This mode's job is "bound and name", never "refuse a newer migration":
 *
 *   - WHICH migrations the dump carries is read from a committed marker,
 *     `supabase/schema/baseline-carried-migrations.txt`, bound to the dump by a
 *     `baseline-sha256:` line — never inferred from commit dates.
 *   - the replay set is every top-level `*.sql` in MIGRATIONS_DIR the marker does
 *     not list, sorted by filename (the order the CLI applies them in).
 *   - the `baseline-currency:` line prints on EVERY run; the set itself
 *     (`baseline-replay:`) prints ONLY when it was determined (defects=0), and so
 *     do the handover files. An undeterminable set is never printed as a set.
 *
 * Env (all optional; defaults are the repo paths):
 *   CARRIED_MARKER, BASELINE_FILE, MIGRATIONS_DIR   — the three inputs
 *   REPLAY_SET_FILE                                  — out: replay basenames, one per line
 *   CARRIED_SET_FILE                                 — out: carried basenames, one per line
 *   REFDATA_ALLOWLIST_IN + REFDATA_ALLOWLIST_OUT     — out: the reference-data allowlist
 *        minus every line whose FIRST TAB FIELD is a replay basename, so an allowlisted
 *        statement in a replayed migration runs once, in the replay, not twice.
 *
 *     node scripts/check-baseline-currency.mjs --replay-set
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
 * How many `ok()` calls the sections below are declared to run: 11 across the
 * eight default-mode sections, plus 25 across the fourteen `--replay-set`
 * sections (Phase 164.4.2 plan 06; +5 in R10 by review 164.4.2 WR-04).
 * ⛔ Raise it only together with the arm that adds one; lowering it to make a
 * run green is deleting a proof.
 */
export const EXPECTED_ASSERTIONS = 36;

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

  // ── --replay-set (DECISION F). Pure-function arms over in-memory facts. ──
  const SHA = "a".repeat(64);
  const A = "20260101000000_a.sql";
  const B = "20260102000000_b.sql";
  const C = "20260103000000_c.sql";
  const D = "20260104000000_d.sql";
  const files = (...names) => names.map((name) => ({ name, isDir: false }));
  const marker = (entries, { sha = SHA, withSha = true } = {}) =>
    ["# carried-migrations marker (self-test)", ...(withSha ? [`baseline-sha256: ${sha}`] : []), ...entries].join("\n") + "\n";
  const replayRun = (over) => judgeReplaySet({ markerText: marker([A, B]), baselineSha: SHA, migrations: files(A, B), ...over });
  const kindsOf = (r) => r.defects.map((d) => d.kind);
  const seenKinds = new Set();
  const see = (r) => {
    for (const k of kindsOf(r)) seenKinds.add(k);
    return r;
  };

  console.log("=== SELF-TEST R1/14: marker current for the directory -> K=0, zero defects, directories ignored");
  const r1 = see(replayRun({ migrations: [...files(A, B), { name: "down", isDir: true }] }));
  ok(r1.defects.length === 0 && r1.replay.length === 0, "a marker listing every migration yields zero defects and an EMPTY replay set");
  ok(r1.markerSha === "match" && r1.carried.join(",") === [A, B].join(","), "the sha binding matches and the carried set is the marker's list");

  console.log("=== SELF-TEST R2/14: two migrations newer than the dump -> K=2, named, sorted by filename");
  const r2 = see(replayRun({ migrations: files(D, A, C, B), migrationTexts: { [C]: "SELECT 1;\n", [D]: "SELECT 1;\n" } }));
  ok(r2.defects.length === 0 && r2.replay.join(",") === [C, D].join(","), `replay set is exactly [${C}, ${D}] in filename order`);

  console.log("=== SELF-TEST R3/14: marker absent or unreadable -> marker-unreadable, never an empty carried set");
  const r3 = see(replayRun({ markerText: null }));
  ok(kindsOf(r3).includes("marker-unreadable"), "an unreadable marker is refused by name, not read as 'nothing carried'");

  console.log("=== SELF-TEST R4/14: marker without a baseline-sha256 line -> marker-sha-absent");
  const r4 = see(replayRun({ markerText: marker([A, B], { withSha: false }) }));
  ok(kindsOf(r4).includes("marker-sha-absent"), "a list bound to no dump is refused");

  console.log("=== SELF-TEST R5/14: marker sha differs from sha256(baseline.sql) -> marker-sha-mismatch naming BOTH prefixes");
  const r5 = see(replayRun({ baselineSha: "b".repeat(64) }));
  const d5 = r5.defects.find((d) => d.kind === "marker-sha-mismatch");
  ok(Boolean(d5) && r5.markerSha === "MISMATCH", "a dump regenerated without its marker is refused");
  ok(Boolean(d5) && d5.detail.includes("a".repeat(12)) && d5.detail.includes("b".repeat(12)), "the message names the marker's sha prefix AND the dump's");

  console.log("=== SELF-TEST R6/14: marker with zero basenames -> marker-empty");
  const r6 = see(replayRun({ markerText: marker([]) }));
  ok(kindsOf(r6).includes("marker-empty"), "an empty carried list is refused — it would replay the whole chain onto the dump");

  console.log("=== SELF-TEST R7/14: malformed and repeated marker lines -> marker-malformed-entry / marker-duplicate-entry");
  const r7a = see(replayRun({ markerText: marker([A, B, "not a migration line"]) }));
  ok(
    r7a.defects.some((d) => d.kind === "marker-malformed-entry" && d.detail.includes("not a migration line")),
    "a line that is neither comment, sha line nor strict basename is refused and quoted",
  );
  const r7b = see(replayRun({ markerText: marker([A, B, A]) }));
  ok(
    r7b.defects.some((d) => d.kind === "marker-duplicate-entry" && d.detail.includes(A)),
    "a repeated basename is refused by name",
  );

  console.log("=== SELF-TEST R8/14: marker names a migration this checkout lacks -> dump-ahead-of-checkout");
  const r8 = see(replayRun({ migrations: files(A) }));
  ok(
    r8.defects.some((d) => d.kind === "dump-ahead-of-checkout" && d.detail.includes(B) && d.detail.includes("base branch")),
    "the missing basename is named and the reader is told to bring in the base branch",
  );

  console.log("=== SELF-TEST R9/14: unreadable dir / unclassifiable file -> migrations-dir-unreadable / migration-unclassifiable");
  const r9a = see(replayRun({ migrations: null }));
  ok(kindsOf(r9a).includes("migrations-dir-unreadable"), "'could not list' is refused, never read as 'nothing to replay'");
  const r9b = see(replayRun({ migrations: files(A, B, "README.md") }));
  ok(
    r9b.defects.some((d) => d.kind === "migration-unclassifiable" && d.detail.includes("README.md")),
    "a top-level FILE that is not a strict migration basename is refused by name",
  );

  console.log("=== SELF-TEST R10/14: a replayed file with a backslash-led line -> replay-meta-command naming file and line");
  const r10 = see(
    replayRun({ migrations: files(A, B, C), migrationTexts: { [C]: "SELECT 1;\n  \\! echo exfiltrate\n" } }),
  );
  ok(
    r10.defects.some((d) => d.kind === "replay-meta-command" && d.detail.includes(C) && d.detail.includes("line 2")),
    "a psql meta-command in a file the lane would hand to psql is refused before psql opens it",
  );
  // Review 164.4.2 WR-04: psql honours a backslash command ANYWHERE on a line
  // outside quotes, not only at its start, and an unreadable replay file is
  // not an empty one.
  const r10b = see(replayRun({ migrations: files(A, B, C), migrationTexts: { [C]: "SELECT 1; \\! echo exfiltrate\n" } }));
  ok(
    r10b.defects.some((d) => d.kind === "replay-meta-command" && d.detail.includes("line 1")),
    "a MID-LINE `SELECT 1; \\! cmd` is refused too — psql reads it as a meta-command",
  );
  const r10c = see(
    replayRun({ migrations: files(A, B, C), migrationTexts: { [C]: "BEGIN;\nSELECT 1 \\i other.sql\nCOMMIT; \\o /tmp/x\n" } }),
  );
  ok(
    r10c.defects.filter((d) => d.kind === "replay-meta-command").map((d) => d.detail.match(/line (\d+)/)?.[1]).join(",") === "2,3",
    "`\\i` and `\\o` after code on lines 2 and 3 are each refused, by line",
  );
  const r10d = see(
    replayRun({
      migrations: files(A, B, C),
      migrationTexts: {
        [C]:
          "-- a comment may say \\! freely\n/* so may \\o a block */\nSELECT '\\d', E'\\n', \"a\\b\";\n" +
          "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $fn$ SELECT '^\\d+$' $fn$;\n",
      },
    }),
  );
  ok(
    r10d.defects.length === 0 && r10d.replay.join(",") === C,
    `CONTROL: backslashes inside comments, literals, identifiers and dollar bodies are NOT meta-commands (got ${JSON.stringify(r10d.defects.map((d) => d.detail))})`,
  );
  const r10e = see(replayRun({ migrations: files(A, B, C), migrationTexts: { [C]: "SELECT $x$ never closed\n" } }));
  ok(
    r10e.defects.some((d) => d.kind === "replay-meta-command" && /cannot be proven/.test(d.detail)),
    "a file whose quoting never closes cannot be proven free of meta-commands, and is refused",
  );
  const r10f = see(replayRun({ migrations: files(A, B, C), migrationTexts: {} }));
  ok(
    r10f.defects.some((d) => d.kind === "replay-file-unreadable" && d.detail.includes(C)),
    "a replay file whose text could not be read is refused by name — never scanned as empty",
  );

  console.log("=== SELF-TEST R11/14: ANY defect -> the pure result carries no set at all");
  ok(
    [r3, r4, r5, r6, r7a, r7b, r8, r9a, r9b, r10, r10b, r10c, r10e, r10f].every((r) => r.defects.length > 0 && r.replay.length === 0 && r.carried.length === 0),
    "an undeterminable set is never returned as a set — every defect arm above returns replay=[] and carried=[]",
  );

  console.log("=== SELF-TEST R12/14: REFDATA_ALLOWLIST_IN unreadable -> refdata-allowlist-unreadable");
  const r12 = see(replayRun({ refdataAllowlistUnreadable: true }));
  ok(kindsOf(r12).includes("refdata-allowlist-unreadable"), "no unfiltered or empty allowlist copy is ever handed over");

  console.log("=== SELF-TEST R13/14: the allowlist filter drops exactly the replayed files' lines");
  const allow = [
    "# header",
    "",
    `${A}\tpublic.t\t1\t# carried; its comment quotes ${C} on purpose`,
    `${C}\tpublic.t\t1\t# a replayed migration's line`,
    "",
  ].join("\n");
  const f13 = filterRefdataAllowlist(allow, [C]);
  ok(f13.excluded.join(",") === C && !f13.text.includes(`${C}\tpublic.t`), "the line whose FIRST field is the replay basename is dropped and named");
  ok(
    f13.text === ["# header", "", `${A}\tpublic.t\t1\t# carried; its comment quotes ${C} on purpose`, ""].join("\n"),
    "comment, blank and carried lines are kept byte-identical — a replay basename in a carried line's comment field does not drop it",
  );
  const f13k0 = filterRefdataAllowlist(allow, []);
  ok(f13k0.text === allow && f13k0.excluded.length === 0, "with K=0 the output is the input, byte for byte, excluded=0");

  console.log("=== SELF-TEST R14/14: every kind judgeReplaySet() can emit is named in REPLAY_DEFECTS");
  ok(
    seenKinds.size === REPLAY_DEFECTS.length && [...seenKinds].every((k) => REPLAY_DEFECTS.includes(k)),
    `REPLAY_DEFECTS names exactly the ${seenKinds.size} kind(s) observed: ${[...seenKinds].sort().join(", ")}`,
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
    `=== SELF-TEST PASSED: ${asserted}/${EXPECTED_ASSERTIONS} declared assertions across 8 default-mode + 14 replay-set sections, ` +
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

// ── --replay-set (DECISION F) ────────────────────────────────────────────────

/** Every defect kind `judgeReplaySet()` can emit. Separate from `DEFECTS`, which
 * is the default mode's list and the restore path's contract. */
export const REPLAY_DEFECTS = [
  "marker-unreadable",
  "marker-sha-absent",
  "marker-sha-mismatch",
  "marker-empty",
  "marker-malformed-entry",
  "marker-duplicate-entry",
  "dump-ahead-of-checkout",
  "migrations-dir-unreadable",
  "migration-unclassifiable",
  "replay-meta-command",
  "replay-file-unreadable",
  "refdata-allowlist-unreadable",
];

/** A migration basename the lane will hand to psql: digits, underscore, lower snake, .sql. */
export const MIGRATION_BASENAME_RE = /^[0-9]+_[a-z0-9_]+\.sql$/;
const SHA_LINE_RE = /^baseline-sha256:[ \t]*(\S*)[ \t]*$/;

/**
 * PURE: the 1-based line numbers on which psql would read a backslash as a
 * meta-command — any backslash outside a `--` comment, a (nested) block
 * comment, a '…' or E'…' literal, a "…" identifier and a $tag$…$tag$ body,
 * which is psql's own lexer's view (a meta-command may start mid-line).
 * Returns `{error, line}` when a comment, literal or body never closes: where
 * psql would then see a command is unknowable, and the caller refuses it.
 *
 * @returns {{lines: number[]} | {error: string, line: number}}
 */
export function psqlMetaCommandLines(src) {
  const n = src.length;
  const lines = new Set();
  let line = 1;
  const advance = (from, to) => {
    for (let k = from; k < to; k++) if (src[k] === "\n") line++;
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const start = line;
    if (c === "-" && src[i + 1] === "-") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = n;
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === "/" && src[j + 1] === "*") (depth++, (j += 2));
        else if (src[j] === "*" && src[j + 1] === "/") (depth--, (j += 2));
        else j++;
      }
      if (depth > 0) return { error: "an unterminated block comment", line: start };
      advance(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      // E'…' honours backslash escapes; '…' and "…" do not (standard_conforming_strings).
      const escaped = c === "'" && /[Ee]/.test(src[i - 1] ?? "") && !/[A-Za-z0-9_$]/.test(src[i - 2] ?? "");
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (escaped && src[j] === "\\") j += 2;
        else if (src[j] === c && src[j + 1] === c) j += 2;
        else if (src[j] === c) {
          closed = true;
          j++;
          break;
        } else j++;
      }
      if (!closed) return { error: `an unterminated ${c === "'" ? "string literal" : "quoted identifier"}`, line: start };
      advance(i, j);
      i = j;
      continue;
    }
    if (c === "$" && !/[A-Za-z0-9_]/.test(src[i - 1] ?? "")) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 80));
      if (m) {
        const close = src.indexOf(m[0], i + m[0].length);
        if (close === -1) return { error: `an unterminated ${m[0]} dollar-quoted body`, line: start };
        const j = close + m[0].length;
        advance(i, j);
        i = j;
        continue;
      }
    }
    if (c === "\\") lines.add(line);
    if (c === "\n") line++;
    i++;
  }
  return { lines: [...lines].sort((a, b) => a - b) };
}

/** Parse the marker's text into its sha line and its basename entries. */
function parseMarker(text) {
  const shas = [];
  const entries = [];
  const malformed = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    if (/^[\t ]*(#|$)/.test(raw)) continue;
    const sha = SHA_LINE_RE.exec(raw);
    if (sha) shas.push(sha[1]);
    else if (MIGRATION_BASENAME_RE.test(raw)) entries.push(raw);
    else malformed.push({ lineNo: i + 1, raw });
  }
  return { shas, entries, malformed };
}

/**
 * PURE: given already-read facts, determine the replay set or name why it
 * cannot be determined. No I/O, so `--self-test` drives the real decision.
 *
 * @param {{
 *   markerText: string|null,      // null = the marker could not be read
 *   baselineSha: string|null,     // sha256 hex of baseline.sql; null = unreadable
 *   migrations: Array<{name: string, isDir: boolean}>|null, // top-level entries; null = unreadable dir
 *   migrationTexts?: Record<string, string>, // file name -> contents (replay files at least)
 *   refdataAllowlistUnreadable?: boolean,
 *   markerLabel?: string, baselineLabel?: string, migrationsLabel?: string,
 * }} facts
 * @returns {{carried: string[], replay: string[], markerSha: "match"|"MISMATCH"|"ABSENT",
 *            defects: Array<{kind: string, detail: string}>}}
 */
export function judgeReplaySet({
  markerText,
  baselineSha,
  migrations,
  migrationTexts = {},
  refdataAllowlistUnreadable = false,
  markerLabel = "the carried-migrations marker",
  baselineLabel = "the baseline file",
  migrationsLabel = "the migrations directory",
}) {
  const defects = [];
  const push = (kind, detail) => defects.push({ kind, detail });

  if (refdataAllowlistUnreadable) {
    push(
      "refdata-allowlist-unreadable",
      `REFDATA_ALLOWLIST_IN could not be read. The lane never falls back to an unfiltered or empty ` +
        `copy: an unfiltered one would run a replayed migration's reference rows twice.`,
    );
  }
  if (migrations === null) {
    push(
      "migrations-dir-unreadable",
      `${migrationsLabel} could not be listed, so which migrations are newer than the dump is unknown. ` +
        `"Could not list" is not "nothing to replay".`,
    );
  }
  if (markerText === null || markerText === undefined) {
    push(
      "marker-unreadable",
      `${markerLabel} could not be read. Without it the carried set is unknown, and an unknown set is ` +
        `never read as empty — that would replay all 270-odd migrations onto a dump that already carries them.`,
    );
    return { carried: [], replay: [], markerSha: "ABSENT", defects };
  }

  const parsed = parseMarker(markerText);
  let markerSha = "ABSENT";
  if (parsed.shas.length === 0 || !parsed.shas[0]) {
    push(
      "marker-sha-absent",
      `${markerLabel} has no \`baseline-sha256: <hex>\` line, so nothing binds its list to the dump.`,
    );
  } else if (parsed.shas[0] !== String(baselineSha ?? "")) {
    markerSha = "MISMATCH";
    push(
      "marker-sha-mismatch",
      `${markerLabel} is bound to baseline sha256 ${parsed.shas[0].slice(0, 12)}… but ${baselineLabel} ` +
        `hashes to ${String(baselineSha || "UNREADABLE").slice(0, 12)}…. The dump was regenerated without ` +
        `regenerating the marker (or the reverse) — regenerate both in ONE commit (BASELINE.md, Regenerating).`,
    );
  } else {
    markerSha = "match";
  }
  for (const extra of parsed.shas.slice(1)) {
    push("marker-malformed-entry", `${markerLabel} carries a SECOND baseline-sha256 line ('${extra}'); one dump, one binding.`);
  }
  for (const m of parsed.malformed) {
    push(
      "marker-malformed-entry",
      `${markerLabel} line ${m.lineNo} is neither a comment, the baseline-sha256 line, nor a strict ` +
        `migration basename: '${m.raw.slice(0, 120)}'`,
    );
  }
  if (parsed.entries.length === 0) {
    push(
      "marker-empty",
      `${markerLabel} lists no migration at all. Read literally, that would replay the whole chain onto a ` +
        `dump that already carries it — the chain does not even replay from empty (REPLAY-SPIKE.md).`,
    );
  }
  const seen = new Set();
  for (const e of parsed.entries) {
    if (seen.has(e)) push("marker-duplicate-entry", `${markerLabel} lists ${e} more than once.`);
    seen.add(e);
  }

  const carried = [...seen].sort();
  let replay = [];
  if (migrations !== null) {
    const onDisk = new Set();
    for (const m of migrations) {
      if (m.isDir) continue; // e.g. `down/` — not part of the forward chain
      if (!MIGRATION_BASENAME_RE.test(m.name)) {
        push(
          "migration-unclassifiable",
          `${migrationsLabel} holds '${m.name}', which is not a strict migration basename ` +
            `(${MIGRATION_BASENAME_RE}). It can be neither carried nor replayed, so the set is not determinable.`,
        );
        continue;
      }
      onDisk.add(m.name);
    }
    for (const c of carried) {
      if (!onDisk.has(c)) {
        push(
          "dump-ahead-of-checkout",
          `${markerLabel} says the dump carries ${c}, but ${migrationsLabel} has no such file: the dump is ` +
            `AHEAD of this checkout, so the lane would test this code against a schema its own migrations ` +
            `do not produce. Bring in the base branch (merge or rebase onto it) and re-run.`,
        );
      }
    }
    replay = [...onDisk].filter((n) => !seen.has(n)).sort();
    // psql meta-commands are CLIENT-side: the server cannot refuse them, and
    // `db push` — the shape being mirrored — never interprets one. Refuse any
    // backslash psql would read as a meta-command in a file the lane is about
    // to hand to psql — ANYWHERE on a line, not only at its start (review
    // 164.4.2 WR-04: `SELECT 1; \! cmd` is a meta-command too).
    for (const r of replay) {
      if (typeof migrationTexts[r] !== "string") {
        push(
          "replay-file-unreadable",
          `${r} is in the replay set but its text could not be read, so it cannot be scanned for psql ` +
            `meta-commands. An unreadable file is not an empty one.`,
        );
        continue;
      }
      const lines = migrationTexts[r].split("\n");
      const scan = psqlMetaCommandLines(migrationTexts[r]);
      if (scan.error) {
        push(
          "replay-meta-command",
          `${r} cannot be proven free of psql meta-commands: ${scan.error} at line ${scan.line}, so where ` +
            `psql would treat a backslash as a command is unknowable.`,
        );
        continue;
      }
      for (const lineNo of scan.lines) {
        push(
          "replay-meta-command",
          `${r} line ${lineNo} carries a backslash outside any comment, literal or dollar body — a psql ` +
            `meta-command, which would run on the runner, not in the database: '${lines[lineNo - 1].trim().slice(0, 80)}'`,
        );
      }
    }
  }

  // ⛔ An undeterminable set is never RETURNED as a set, so no caller can print
  // or hand over a partial one by mistake.
  if (defects.length > 0) return { carried: [], replay: [], markerSha, defects };
  return { carried, replay, markerSha, defects };
}

/**
 * PURE: the reference-data allowlist minus every line whose FIRST TAB FIELD is
 * a replay basename. Comment and blank lines (the extractor's own skip rule,
 * `/^[\t ]*(#|$)/`) are kept verbatim, and so is every carried line — even one
 * whose comment field happens to QUOTE a replay basename, which a substring
 * filter would wrongly drop. With an empty replay set the output is the input,
 * byte for byte.
 *
 * @returns {{text: string, excluded: string[]}} excluded = first fields dropped, in file order
 */
export function filterRefdataAllowlist(text, replay) {
  const replaySet = new Set(replay);
  const excluded = [];
  const kept = [];
  for (const raw of String(text).split("\n")) {
    if (!/^[\t ]*(#|$)/.test(raw) && replaySet.has(raw.split("\t")[0])) {
      excluded.push(raw.split("\t")[0]);
      continue;
    }
    kept.push(raw);
  }
  return { text: kept.join("\n"), excluded };
}

function readOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function sha256OrNull(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function replayMain() {
  const markerFile = process.env.CARRIED_MARKER || "supabase/schema/baseline-carried-migrations.txt";
  const baselineFile = process.env.BASELINE_FILE || "supabase/schema/baseline.sql";
  const migrationsDir = process.env.MIGRATIONS_DIR || "supabase/migrations";
  const allowIn = process.env.REFDATA_ALLOWLIST_IN || "";
  const allowOut = process.env.REFDATA_ALLOWLIST_OUT || "";
  if (Boolean(allowIn) !== Boolean(allowOut)) {
    console.error(
      "::error::REFDATA_ALLOWLIST_IN and REFDATA_ALLOWLIST_OUT must be set together — one without the other would hand the lane no filtered allowlist.",
    );
    return 1;
  }

  let migrations = null;
  try {
    migrations = readdirSync(migrationsDir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
    }));
  } catch {
    migrations = null;
  }
  const migrationTexts = {};
  for (const m of migrations ?? []) {
    if (!m.isDir && MIGRATION_BASENAME_RE.test(m.name)) {
      const t = readOrNull(join(migrationsDir, m.name));
      if (t !== null) migrationTexts[m.name] = t;
    }
  }
  const allowText = allowIn ? readOrNull(allowIn) : null;

  const { carried, replay, markerSha, defects } = judgeReplaySet({
    markerText: readOrNull(markerFile),
    baselineSha: sha256OrNull(baselineFile),
    migrations,
    migrationTexts,
    refdataAllowlistUnreadable: Boolean(allowIn) && allowText === null,
    markerLabel: markerFile,
    baselineLabel: baselineFile,
    migrationsLabel: migrationsDir,
  });

  // Never let "clean" and "did not run" look alike: this line prints on every exit.
  console.log(
    `baseline-currency: carried=${carried.length} replay=${replay.length} marker-sha=${markerSha} ` +
      `defects=${defects.length}`,
  );
  if (defects.length > 0) {
    for (const d of defects) console.error(`::error::${d.kind} — ${d.detail}`);
    console.error(`${defects.length} defect(s) — the replay set is UNDETERMINED; no set is printed and no handover file is written.`);
    return 1;
  }

  console.log(
    replay.length === 0
      ? "baseline-replay: 0 migration(s) newer than the dump (none)"
      : `baseline-replay: ${replay.length} migration(s) newer than the dump: ${replay.join(" ")}`,
  );
  const lines = (xs) => (xs.length === 0 ? "" : `${xs.join("\n")}\n`);
  if (process.env.REPLAY_SET_FILE) writeFileSync(process.env.REPLAY_SET_FILE, lines(replay));
  if (process.env.CARRIED_SET_FILE) writeFileSync(process.env.CARRIED_SET_FILE, lines(carried));
  if (allowIn) {
    const { text, excluded } = filterRefdataAllowlist(allowText, replay);
    writeFileSync(allowOut, text);
    console.log(
      `baseline-replay: excluded ${excluded.length} reference-data allowlist line(s) naming replayed migrations: ` +
        (excluded.length === 0 ? "(none)" : [...new Set(excluded)].join(" ")),
    );
  }
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  if (argv.length === 1 && argv[0] === "--replay-set") return replayMain();
  // ⛔ A typo'd flag must not silently fall through to a green corpus run.
  const unknown = argv.filter((a) => a !== "--self-test");
  if (unknown.length > 0) {
    console.error(
      `::error::unknown argument(s): ${unknown.join(" ")} — this gate takes only --self-test, or --replay-set on its own`,
    );
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
