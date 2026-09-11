#!/usr/bin/env node
/**
 * The static app-GUC reader gate over `supabase/migrations/**` (Phase 164.7,
 * ROADMAP criterion 1, CONTEXT decision D-05).
 *
 * ── WHAT IT SCANS ──────────────────────────────────────────────────────────
 * Every `*.sql` file under `supabase/migrations`, RECURSIVELY (so
 * `supabase/migrations/down/` is in scope too), read as RAW TEXT.
 *
 * ── WHY RAW TEXT, COMMENTS AND STRING LITERALS INCLUDED (D-05) ─────────────
 * Criterion 1's gate is a grep, and a grep does not know a comment from a
 * statement. So neither may this gate. Two measured consequences on this tree:
 *
 *   • `20260408113029_cron_heartbeat.sql:113` reads an app GUC inside a `--`
 *     comment. The RUNTIME never sees it; the GATE does. It is a site, and its
 *     disposition is a lineage annotation, not a code fix.
 *   • `20260408113029:167,:170` and `20260408215026:70,:73` sit inside a
 *     `$cron$ … $cron$` string literal that `cron.schedule()` stores verbatim.
 *     A masker that blanks string contents would call those four "not there",
 *     while a FRESH apply would still write a GUC-reading cron command. Masking
 *     is exactly the wrong instrument for this class.
 *
 * ── WHY A SIBLING OF `scripts/lint-sql-gates.mjs`, NOT AN EIGHTH RULE ──────
 * Quoted from 164.7-RESEARCH § Q3, accepted as measured: `lint-sql-gates.mjs`
 * has `CORPUS_DIR = supabase/tests` and runs every rule on `maskSql()` output,
 * which blanks `--` comments, block comments AND the contents of string
 * literals — after masking, an app-GUC read is invisible, and D-05 requires the
 * gate to COUNT comments. Its vitest also pins the rule set and the vacuity
 * MECHANISM multiset; a rule that is not a vacuity mechanism does not belong in
 * that registry. Same CONTRACT (hermetic, fixture-paired, self-test first,
 * `--files` / `--self-test` / bare), different corpus and different rules.
 *
 * ── THE EXEMPTION, AND WHY IT TAKES TWO EDITS IN TWO FILES ─────────────────
 * A file is exempt only when BOTH hold:
 *
 *   1. it carries a dated lineage header naming an EXACT occurrence count, and
 *   2. `LINEAGE_ALLOWLIST` below pins the same file with the same count and the
 *      same successor.
 *
 * The count is what stops the exemption absorbing new readers: one MORE read in
 * an annotated file fails, and one FEWER fails too, so the ratchet only
 * tightens (the idiom `lint-sql-gates.mjs`'s ALLOWLIST already uses). The
 * allowlist is what stops a NEW migration exempting ITSELF by carrying a fresh
 * header — that is finding `header-not-allowlisted` (threat T-164.7-01).
 *
 * PATTERNS' block-marker alternative (`-- LINEAGE …` / `-- END LINEAGE` around
 * each site) is REJECTED: a block that wraps executable code exempts executable
 * code, and nothing in the block form can tell the two apart — that is "an
 * exemption any comment satisfies", this milestone's named defect.
 *
 * ── FINDING KINDS ─────────────────────────────────────────────────────────
 *   unannotated-reader     an app-GUC read in a file with no (or a broken)
 *                          lineage header                       [red fixture]
 *   header-malformed       a lineage header that will not parse; the reads are
 *                          STILL reported unannotated       [vitest-covered]
 *   header-count-mismatch  header count ≠ measured count, either way
 *                                                                [red fixture]
 *   header-not-allowlisted valid header, but LINEAGE_ALLOWLIST does not pin
 *                          this file with this count/successor   [red fixture]
 *   successor-invalid      named successor is absent, or still reads an app GUC
 *                                                                [red fixture]
 *   allowlist-stale        an allowlist entry whose file no longer carries a
 *                          valid header                     [vitest-covered]
 *
 * ── USAGE (CI pastes these lines VERBATIM — mode identity) ─────────────────
 *   node scripts/lint-app-guc.mjs                  # the real corpus + allowlist
 *   node scripts/lint-app-guc.mjs --files a.sql b.sql   # ad-hoc, no allowlist
 *   node scripts/lint-app-guc.mjs --self-test      # the engine's own fixtures
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, basename } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repo-relative, so the header, the CI step and the findings all name one path. */
export const MIGRATIONS_DIR = "supabase/migrations";
export const FIXTURE_DIR = "scripts/lint-app-guc-fixtures";

/** A lineage header must sit in the file's masthead, not be buried mid-file. */
export const HEADER_SCAN_LINES = 40;

/**
 * The detection regex. THE SAME SOURCE as the `app-guc` rule in
 * `scripts/prod-prober/arms/cron-drift.mjs` `hygieneViolations()`, so this repo
 * has ONE definition of what an app-GUC read looks like. `src/__tests__` pins
 * that identity by substring, so drifting either copy reds the suite.
 *
 * ── THE SIX SPELLINGS IT DETECTS (WIDENED 2026-09-11, plan 164.8.5-07) ──────
 * Postgres accepts the same call written six ways, and the pre-widening regex
 * saw exactly ONE of them — so the other five were a documented way to write a
 * new app-GUC reader that the gate waves through (164.7-REVIEW WR-07, and
 * `[APPGUC-DETECT-DOUBLEQUOTE-01]` for the second row, which was booked).
 *
 *   plain            current_setting('app.x')
 *   doubled quote    current_setting(''app.x'')     inside an outer literal
 *   E-string         current_setting(E'app.x')
 *   unicode string   current_setting(U&'app.x')
 *   dollar-quoted    current_setting($q$app.x$q$)   any tag, including $$
 *   block comment    current_setting/*c*\/('app.x') between name and paren
 *
 * Each of the five widened spellings carries its OWN red fixture under
 * `FINDING_KINDS[unannotated-reader].redFixtures`, so `--self-test` can prove
 * each alternation individually rather than as a bundle.
 *
 * ⛔ MEASURED BEFORE AND AFTER (RESEARCH Q6, reproduced 2026-09-11 at this
 * commit): 292 migration files, 12 matches under the old source and 12 under
 * this one, ZERO per-file diffs. The widening therefore moves no allowlist
 * count. If a future widening DOES move one, the finding is real — fix the
 * regex or the prose it matched, never the count (decision D4).
 *
 * ⚠️ KNOWN BLIND SPOT, booked as a criterion-1 limit and NOT fixed in this
 * phase: a read assembled by SQL string concatenation — e.g.
 * `'current_' || 'setting(''app.' || …` — is invisible to this regex. Phase
 * 164.7 plan 03's `v_guc_needle` inside its `DO $verify$` block relies on that
 * DELIBERATELY, because a verification block that spelled the call out would
 * make its own migration self-matching under this very lint. A future reader
 * must NOT "fix" that by inlining the literal. Concatenation is the one
 * spelling that remains.
 */
export const DETECT_RE =
  /current_setting\s*(?:\/\*[\s\S]*?\*\/\s*)?\(\s*(?:[EU]&?)?'{1,2}app\.|current_setting\s*\(\s*\$[A-Za-z_]*\$app\./i;

/** `-- APP-GUC-LINEAGE: …`, line-start anchored after optional indentation. */
export const LINEAGE_MARKER_RE = /^\s*--\s*APP-GUC-LINEAGE:\s*(.*)$/;

/**
 * The finding registry. `src/__tests__/lint-app-guc.test.ts` pins this id set
 * EXACTLY: adding an entry reds the suite until its fixture exists, removing
 * one reds it immediately.
 *
 * `selfTestFixture: false` means the kind is proven by the vitest instead of by
 * a committed red fixture, and the self-test skips it BY DECLARATION rather
 * than silently. Task 2 of plan 164.7-01 sets those flags.
 */
export const FINDING_KINDS = [
  {
    id: "unannotated-reader",
    title: "app-GUC read with no lineage annotation",
    // TWO red fixtures, because D-05's whole claim is that an executable read
    // and a commented read are the same finding to this gate.
    //
    // ⭐ PLUS ONE FIXTURE PER WIDENED SPELLING (2026-09-11, plan 164.8.5-07).
    // Each of the five files below carries exactly ONE of the spellings
    // `DETECT_RE` was widened to see, and nothing else. That is what lets the
    // neuter matrix disable ONE alternation of the detector and watch ONE
    // fixture stop firing: a single combined fixture would still match on the
    // other four spellings and would prove nothing about the alternation that
    // was removed — a batch control wearing one fixture's clothing (D3).
    redFixtures: [
      "unannotated-reader.red.sql",
      "unannotated-comment.red.sql",
      "spelling-doubled-quote.red.sql",
      "spelling-e-string.red.sql",
      "spelling-dollar-tag.red.sql",
      "spelling-unicode.red.sql",
      "spelling-block-comment.red.sql",
    ],
    scope:
      "One finding per DETECT_RE match, in RAW text, in a file that carries no lineage " +
      "header or whose header will not parse. This is the finding the phase exists to " +
      "drive to zero — by annotating or removing readers, never by loosening the rule.",
  },
  {
    id: "header-malformed",
    title: "lineage header present but unparseable",
    // NO red fixture is POSSIBLE: a malformed header also leaves the file's
    // reads unannotated, so any fixture for it fires two kinds and isolates
    // neither. Proven in src/__tests__/lint-app-guc.test.ts by feeding bad
    // payloads straight to parseLineageHeader(). Declared, not skipped.
    selfTestFixture: false,
    scope:
      "The `-- APP-GUC-LINEAGE:` marker is there but a field is missing, the date is not " +
      "a real YYYY-MM-DD, or the count is not an integer. The file's reads are STILL " +
      "reported as unannotated, so a broken header exempts nothing.",
  },
  {
    id: "header-count-mismatch",
    title: "lineage header count disagrees with the measured count",
    scope:
      "MORE reads than the header pins is a new reader smuggled into an annotated file; " +
      "FEWER is a stale annotation. Both are findings — the ratchet only tightens.",
  },
  {
    id: "header-not-allowlisted",
    title: "lineage header on a file the script does not pin",
    scope:
      "A header exempts nothing unless LINEAGE_ALLOWLIST pins the same file with the same " +
      "occurrences and the same successor. Without this, a NEW migration could exempt " +
      "itself by carrying a fresh header (threat T-164.7-01).",
  },
  {
    id: "successor-invalid",
    title: "named successor is absent or still reads an app GUC",
    scope:
      "`successor: <file>` claims the mechanism moved somewhere. The successor must exist " +
      "beside the annotated file and must itself contain ZERO app-GUC reads, else the " +
      "lineage points at another copy of the same defect.",
  },
  {
    id: "allowlist-stale",
    title: "allowlist entry for a file that no longer carries a valid header",
    // A CORPUS-mode condition — it fires after the whole pass, so no single
    // file exhibits it. The vitest drives scanCorpus() over a temp corpus with
    // a temp allowlist. Declared, not skipped.
    selfTestFixture: false,
    scope:
      "An exemption for a file that no longer needs one is an error, not a courtesy — same " +
      "rule as lint-sql-gates' allowlist. Delete the entry so the gate bites the file again.",
  },
];

/**
 * The exemptions. It was EMPTY at plan 164.7-01 BY DESIGN — that plan shipped
 * the machine and the corpus scan was RED with the measured interim census
 * (12 findings across 5 files, per-file 1/5/4/1/1). ⭐ FILLED 2026-09-07 by
 * plan 164.7-05, in the SAME commit as the five files' headers, which is the
 * whole point: an exemption granted from inside the file it excuses is not an
 * exemption, it is a self-signed permission slip.
 *
 * An entry is `{ file, occurrences, successor, reason }`, where `file` is the
 * repo-relative path, `occurrences` and `successor` must equal what the file's
 * own header says, and `reason` is prose for the reviewer.
 *
 * ⛔ The five `occurrences` below SUM TO 12 — the same 12 the interim census
 * reported. Nothing was repaired away and nothing was loosened: every one of
 * the twelve sites is still there and still counted, and each is now accounted
 * for by a dated header carrying the evidence that it has no live consumer.
 * `src/__tests__/lint-app-guc.test.ts` pins that sum and re-measures each count
 * against `countReads()` of the real file, so adding a sixth read to any of
 * these five — or removing one — fails.
 */
export const LINEAGE_ALLOWLIST = [
  {
    file: `${MIGRATIONS_DIR}/20260407164606_perfect_match.sql`,
    occurrences: 1,
    successor: "none",
    reason:
      "D-04 (ROADMAP criterion 2 SCOPE AMENDMENT, 2026-09-07): the read is inside a one-shot DO " +
      "block that ran at apply on 2026-04-07 and can never run again. `successor: none` is not a " +
      "gap — there is no live value to move, so migrating it would re-point code that will never " +
      "execute and deleting it would make the repo stop describing what applied to PROD.",
  },
  {
    file: `${MIGRATIONS_DIR}/20260408113029_cron_heartbeat.sql`,
    occurrences: 5,
    successor: "20260907120000_analytics_service_settings_and_vault_tick.sql",
    reason:
      "Two one-shot preflight reads, two inside the $cron$ command literal this migration wrote " +
      "(superseded by 20260408215026, same jobname, then hand-repaired on PROD onto Vault on " +
      "2026-09-01), and ONE inside a `--` comment — which the gate counts, because a grep cannot " +
      "tell a comment from a statement (D-05). A fresh apply would still write the GUC-reading " +
      "command: a latent-on-rebuild defect, not an ongoing outage.",
  },
  {
    file: `${MIGRATIONS_DIR}/20260408215026_schedule_match_cron_hourly.sql`,
    occurrences: 4,
    successor: "20260907120000_analytics_service_settings_and_vault_tick.sql",
    reason:
      "Same two kinds as its predecessor, which it supersedes (same jobname, daily -> hourly). It " +
      "is itself superseded on PROD by the 2026-09-01 hand repair captured in " +
      "scripts/prod-prober/cron-manifest.json jobid 1; repointing that LIVE row at the successor's " +
      "public.match_engine_cron_tick() is Phase 164.5 item 7, outside this phase's fence.",
  },
  {
    file: `${MIGRATIONS_DIR}/20260825130000_ledger_refresh_fanout_dormant.sql`,
    occurrences: 1,
    successor: "20260907130000_ledger_refresh_switch_to_system_flags.sql",
    reason:
      "Phase 161.1's Lock B activation check. The successor re-bases it on a fail-CLOSED read of " +
      "public.system_flags because the setting cannot be set on this platform at all (both ALTER " +
      "forms return 42501, measured on PROD 2026-09-05). This file stays byte-identical in its " +
      "executable text: it is the record of what applied on 2026-08-25.",
  },
  {
    file: `${MIGRATIONS_DIR}/20260825140000_ledger_refresh_composite_arm.sql`,
    occurrences: 1,
    successor: "20260907130000_ledger_refresh_switch_to_system_flags.sql",
    reason:
      "The composite arm's Lock B, identical in mechanism to the single-key arm above and moved by " +
      "the same successor in the same commit — the two bodies are re-based together because a " +
      "half-moved switch is a switch with two answers.",
  },
];

/**
 * The allowlist the SELF-TEST runs its fixtures under. Each fixture is scanned
 * with this list filtered to that one file, so no fixture can be reddened (or
 * rescued) by another fixture's entry. `header-not-allowlisted.red.sql` is
 * DELIBERATELY absent — that absence is what makes it red.
 */
export const FIXTURE_ALLOWLIST = [
  {
    file: `${FIXTURE_DIR}/lineage.green.sql`,
    occurrences: 2,
    successor: "successor-target.green.sql",
    reason: "The worked green pair: one executable read plus one commented read, both annotated.",
  },
  {
    file: `${FIXTURE_DIR}/header-count-mismatch.red.sql`,
    occurrences: 1,
    successor: "none",
    reason:
      "Pins exactly what that fixture's header claims, so the ONLY thing wrong with the file " +
      "is its measured count. Without this entry the fixture would fire header-not-allowlisted " +
      "as well and would isolate nothing.",
  },
  {
    file: `${FIXTURE_DIR}/successor-invalid.red.sql`,
    occurrences: 1,
    successor: "does-not-exist.sql",
    reason:
      "Agrees with that fixture's header on both fields, so the paperwork is complete and the " +
      "only defect left is the successor that is not there.",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Text mechanics
// ───────────────────────────────────────────────────────────────────────────

/** Maps a character offset to a 1-based line number. */
function lineIndexer(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Every DETECT_RE match in RAW text, with its line. Scanned over the WHOLE
 * source rather than line by line, so a call split across a newline
 * (`current_setting(\n  'app.x')`) is counted — `\s` spans newlines.
 */
export function countReads(text) {
  const src = String(text ?? "");
  const re = new RegExp(DETECT_RE.source, "gi");
  const lineAt = lineIndexer(src);
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ index: m.index, line: lineAt(m.index), text: m[0] });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function isRealDate(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Parses the one-line lineage header:
 *
 *   -- APP-GUC-LINEAGE: retired YYYY-MM-DD; occurrences: N; successor: <file|none>; reason: <text>
 *
 * Returns `null` when there is no marker at all, `{ line, malformed }` when the
 * marker is there but the payload will not parse, and the parsed fields
 * otherwise. The header line is prose about an "app-GUC read" and must never
 * spell the call out, or it would match DETECT_RE and count as a site itself.
 */
export function parseLineageHeader(text) {
  const lines = String(text ?? "").split("\n");
  const limit = Math.min(lines.length, HEADER_SCAN_LINES);
  for (let i = 0; i < limit; i++) {
    const m = LINEAGE_MARKER_RE.exec(lines[i]);
    if (!m) continue;
    const line = i + 1;
    const payload = m[1].trim();
    const bad = (why) => ({ line, raw: payload, malformed: why });

    const dm = /(?:^|;)\s*retired\s+([^;]+?)\s*(?:;|$)/.exec(payload);
    if (!dm) return bad("missing `retired <YYYY-MM-DD>`");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dm[1]))
      return bad(`retired date "${dm[1]}" is not in YYYY-MM-DD form`);
    if (!isRealDate(dm[1])) return bad(`retired date "${dm[1]}" is not a real calendar date`);

    const om = /(?:^|;)\s*occurrences:\s*([^;]+?)\s*(?:;|$)/.exec(payload);
    if (!om) return bad("missing `occurrences: <N>`");
    if (!/^\d+$/.test(om[1]))
      return bad(`occurrences "${om[1]}" is not a non-negative integer`);

    const sm = /(?:^|;)\s*successor:\s*([^;]+?)\s*(?:;|$)/.exec(payload);
    if (!sm) return bad("missing `successor: <migration filename or none>`");

    const rm = /(?:^|;)\s*reason:\s*(.+)$/.exec(payload);
    if (!rm || !rm[1].trim()) return bad("missing `reason: <free text>`");

    return {
      line,
      raw: payload,
      date: dm[1],
      occurrences: Number(om[1]),
      successor: sm[1].trim(),
      reason: rm[1].trim(),
    };
  }
  return null;
}

/** Repo-relative path, so findings, the allowlist and CI annotations agree. */
export function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split("\\").join("/");
}

// ───────────────────────────────────────────────────────────────────────────
// The scan
// ───────────────────────────────────────────────────────────────────────────

/**
 * Scans ONE file. `opts.allowlist` is `null` for "no exemption enforcement"
 * (`--files` mode) or an array of entries to enforce.
 *
 * Order, deliberately: an ABSENT or BROKEN header means every read is
 * unannotated; a VALID header means the reads are accounted for and the
 * remaining checks interrogate the ANNOTATION instead.
 */
export function scanFile(absPath, opts = {}) {
  const { allowlist = null } = opts;
  const file = relPath(absPath);
  const findings = [];
  const push = (kind, line, message) => findings.push({ kind, file, line, message });

  let text;
  try {
    text = readFileSync(absPath, "utf8");
  } catch (err) {
    // ⛔ "could not measure" must never share a code path with "measured zero".
    return {
      file,
      header: null,
      reads: 0,
      findings: [],
      measureFail: {
        file,
        reason:
          `cannot read ${file} (${err.code ?? err.message}). An unreadable migration is not ` +
          "a clean one — this is a MEASURE_FAIL, not zero findings.",
      },
    };
  }

  const reads = countReads(text);
  const header = parseLineageHeader(text);

  if (header === null || header.malformed) {
    if (header && header.malformed) {
      push(
        "header-malformed",
        header.line,
        `lineage header will not parse: ${header.malformed}. A broken header exempts nothing, ` +
          `so this file's ${reads.length} app-GUC read(s) are reported below as unannotated.`,
      );
    }
    for (const r of reads) {
      push(
        "unannotated-reader",
        r.line,
        "reads an app.* GUC. Setting those needs ALTER DATABASE … SET on a placeholder GUC, " +
          "which returns 42501 on Supabase — so this read resolves to NULL wherever it runs. " +
          "Move it to a mechanism this platform grants, or annotate the file with a dated " +
          "`-- APP-GUC-LINEAGE:` header AND a matching LINEAGE_ALLOWLIST entry.",
      );
    }
    return { file, header, reads: reads.length, findings, measureFail: null };
  }

  if (header.occurrences !== reads.length) {
    push(
      "header-count-mismatch",
      header.line,
      `lineage header pins occurrences: ${header.occurrences} but ${reads.length} app-GUC ` +
        `read(s) are present. ` +
        (reads.length > header.occurrences
          ? "A NEW read was added to an annotated file — fix it, do not raise the count."
          : "The annotation is STALE — lower the count to lock in the repair (this ratchet only tightens)."),
    );
  }

  if (allowlist) {
    const entry = allowlist.find((e) => e.file === file);
    if (!entry) {
      push(
        "header-not-allowlisted",
        header.line,
        `carries a lineage header but LINEAGE_ALLOWLIST does not pin ${file}. A header alone ` +
          "exempts nothing — otherwise a new migration could exempt itself. Add an entry with " +
          "the same occurrences and successor, in the same commit, where a reviewer sees it.",
      );
    } else if (entry.occurrences !== header.occurrences || entry.successor !== header.successor) {
      push(
        "header-not-allowlisted",
        header.line,
        `the LINEAGE_ALLOWLIST entry for ${file} disagrees with its header: entry pins ` +
          `occurrences ${entry.occurrences} / successor "${entry.successor}", the header says ` +
          `occurrences ${header.occurrences} / successor "${header.successor}". Two independent ` +
          "edits must agree, or the exemption is not the one that was reviewed.",
      );
    }
  }

  if (header.successor !== "none") {
    // The successor is resolved as a SIBLING of the annotated file. For every
    // real migration that directory IS `supabase/migrations`, which is what the
    // plan specifies; resolving relative to the file is also what lets the
    // fixture pair be self-contained inside FIXTURE_DIR.
    const successorAbs = join(dirname(absPath), header.successor);
    if (!existsSync(successorAbs)) {
      push(
        "successor-invalid",
        header.line,
        `names successor "${header.successor}", which does not exist beside this file. A lineage ` +
          "header that points nowhere is an exemption with no forwarding address.",
      );
    } else {
      let successorReads = null;
      try {
        successorReads = countReads(readFileSync(successorAbs, "utf8")).length;
      } catch (err) {
        push(
          "successor-invalid",
          header.line,
          `names successor "${header.successor}", which cannot be read (${err.code ?? err.message}).`,
        );
      }
      if (successorReads !== null && successorReads !== 0) {
        push(
          "successor-invalid",
          header.line,
          `names successor "${header.successor}", but that file still contains ${successorReads} ` +
            "app-GUC read(s) — the lineage points at another copy of the same defect.",
        );
      }
    }
  }

  return { file, header, reads: reads.length, findings, measureFail: null };
}

/**
 * Scans a list of paths. `requireNonEmpty` turns an empty list into a
 * MEASURE_FAIL rather than a clean pass — an empty corpus proves nothing.
 */
export function scanPaths(paths, opts = {}) {
  const { allowlist = null, requireNonEmpty = false } = opts;
  const findings = [];
  const measureFails = [];
  const annotated = [];

  if (requireNonEmpty && paths.length === 0) {
    measureFails.push({
      file: "(corpus)",
      reason:
        "zero files to scan. An empty corpus proves nothing about the migrations; most likely " +
        "the directory drifted. This is not a pass.",
    });
    return { ok: false, findings, measureFails, filesScanned: 0, annotated };
  }

  for (const p of paths) {
    const res = scanFile(resolve(p), { allowlist });
    if (res.measureFail) {
      measureFails.push(res.measureFail);
      continue;
    }
    findings.push(...res.findings);
    if (res.header && !res.header.malformed) annotated.push(res.file);
  }

  if (allowlist) {
    const seen = new Set(annotated);
    for (const entry of allowlist) {
      if (seen.has(entry.file)) continue;
      findings.push({
        kind: "allowlist-stale",
        file: entry.file,
        line: 1,
        message:
          `LINEAGE_ALLOWLIST pins ${entry.file}, but that file was not scanned carrying a valid ` +
          "lineage header (it moved, was deleted, or the header was removed). Delete the entry " +
          "rather than leaving an exemption quietly disarmed.",
      });
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return {
    ok: findings.length === 0 && measureFails.length === 0,
    findings,
    measureFails,
    filesScanned: paths.length,
    annotated: [...annotated].sort(),
  };
}

/** Every `*.sql` under a directory, recursively, sorted. */
function sqlFilesUnder(absDir) {
  if (!existsSync(absDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = join(dir, ent.name);
      // The `.sql` test comes FIRST, deliberately. A DIRECTORY named `x.sql` is
      // a corpus entry that cannot be read, and it is collected so scanFile
      // MEASURE_FAILs on it. Skipping it silently would let an unreadable
      // corpus entry read as a clean one (threat T-164.7-04).
      if (ent.name.endsWith(".sql")) out.push(p);
      else if (ent.isDirectory()) walk(p);
    }
  };
  walk(absDir);
  return out.sort();
}

/**
 * The real corpus. `opts.migrationsDir` (absolute) and `opts.allowlist` exist so
 * the vitest can drive a temp corpus without shelling out or mutating the repo.
 */
export function scanCorpus(opts = {}) {
  const { allowlist = LINEAGE_ALLOWLIST, migrationsDir = null } = opts;
  const dir = migrationsDir ? resolve(migrationsDir) : join(REPO_ROOT, MIGRATIONS_DIR);
  return scanPaths(sqlFilesUnder(dir), { allowlist, requireNonEmpty: true });
}

// ───────────────────────────────────────────────────────────────────────────
// Reporting, self-test, CLI
// ───────────────────────────────────────────────────────────────────────────

/**
 * MEASURE_FAILs deliberately use a `::error::` line with NO `file=` field, so
 * counting findings by `::error file=` can never be inflated by a measurement
 * failure.
 */
function report(result) {
  for (const mf of result.measureFails) {
    console.error(`::error::MEASURE_FAIL — ${mf.file}: ${mf.reason}`);
  }
  for (const f of result.findings) {
    console.error(`::error file=${f.file},line=${f.line}::${f.kind} — ${f.message}`);
  }
  // The summary ALWAYS prints, at zero as well, so "clean" and "did not run"
  // never look the same in a CI log.
  console.log(`app-guc: files scanned ${result.filesScanned}`);
  console.log(
    `app-guc: annotated (lineage) ${result.annotated.length} — ` +
      (result.annotated.length ? result.annotated.join(", ") : "(none)"),
  );
  console.log(`app-guc: findings ${result.findings.length}`);
  if (!result.ok) {
    console.error(
      "::error::lint-app-guc FAILED. Every line above is a place where a migration reads an " +
        "app.* GUC that Supabase will not let anyone set (42501). Move the reader to a mechanism " +
        "the platform grants, or annotate it — header AND allowlist entry, both count-pinned.",
    );
  }
  return result.ok ? 0 : 1;
}

/** Round-trips every finding kind through its committed fixture(s). */
export function selfTest() {
  let bad = 0;
  const dir = join(REPO_ROOT, FIXTURE_DIR);
  const declared = new Set();

  if (!existsSync(dir)) {
    console.error(`SELF-TEST FAIL: fixture directory ${FIXTURE_DIR} does not exist.`);
    return 1;
  }

  const only = (p) => FIXTURE_ALLOWLIST.filter((e) => e.file === relPath(p));

  for (const kind of FINDING_KINDS) {
    if (kind.selfTestFixture === false) continue;
    for (const name of kind.redFixtures ?? [`${kind.id}.red.sql`]) {
      declared.add(name);
      const p = join(dir, name);
      if (!existsSync(p)) {
        console.error(`SELF-TEST FAIL: ${kind.id} has no red fixture at ${FIXTURE_DIR}/${name}`);
        bad = 1;
        continue;
      }
      const res = scanPaths([p], { allowlist: only(p) });
      if (res.measureFails.length) {
        console.error(`SELF-TEST FAIL: ${name}: ${res.measureFails[0].reason}`);
        bad = 1;
        continue;
      }
      const fired = new Set(res.findings.map((f) => f.kind));
      if (!fired.has(kind.id)) {
        console.error(
          `SELF-TEST FAIL: ${kind.id} did not fire on its own red fixture ${name} — the rule cannot fail.`,
        );
        bad = 1;
      }
      if (fired.size !== 1) {
        console.error(
          `SELF-TEST FAIL: red fixture ${name} fired {${[...fired].join(", ")}} — a red fixture must isolate ONE kind.`,
        );
        bad = 1;
      }
    }
  }

  const reds = readdirSync(dir).filter((f) => f.endsWith(".red.sql")).sort();
  for (const name of reds) {
    if (!declared.has(name)) {
      console.error(
        `SELF-TEST FAIL: ${FIXTURE_DIR}/${name} is not declared by any finding kind's redFixtures — ` +
          "an undeclared fixture proves nothing because nothing asserts what it must fire.",
      );
      bad = 1;
    }
  }

  const greens = readdirSync(dir).filter((f) => f.endsWith(".green.sql")).sort();
  if (greens.length === 0) {
    console.error("SELF-TEST FAIL: no *.green.sql fixture — red arms alone cannot show a clean pass.");
    bad = 1;
  }
  for (const name of greens) {
    const p = join(dir, name);
    const res = scanPaths([p], { allowlist: only(p) });
    if (res.measureFails.length) {
      console.error(`SELF-TEST FAIL: green fixture ${name}: ${res.measureFails[0].reason}`);
      bad = 1;
      continue;
    }
    if (res.findings.length !== 0) {
      console.error(
        `SELF-TEST FAIL: green fixture ${name} fired {${[...new Set(res.findings.map((f) => f.kind))].join(", ")}}.`,
      );
      bad = 1;
    }
  }

  if (bad === 0) {
    const covered = FINDING_KINDS.filter((k) => k.selfTestFixture !== false).length;
    console.log(
      `lint-app-guc self-test OK: ${covered} finding kinds, red+green each ` +
        `(${reds.length} red, ${greens.length} green fixtures; ` +
        `${FINDING_KINDS.length - covered} kind(s) vitest-covered by declaration).`,
    );
  }
  return bad;
}

export function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  if (argv[0] === "--files") {
    const paths = argv.slice(1);
    if (paths.length === 0) {
      console.error("lint-app-guc: --files needs at least one path.");
      return 1;
    }
    return report(scanPaths(paths, { allowlist: null }));
  }
  if (argv.length > 0) {
    console.error(`lint-app-guc: unknown argument "${argv[0]}". See the header for usage.`);
    return 1;
  }
  return report(scanCorpus({}));
}

/**
 * Realpath-safe main-module guard — the `[VAC04-C2]` lesson: comparing
 * `import.meta.url` to `file://${process.argv[1]}` no-ops on symlinked or
 * space-bearing paths, silently turning the CLI into a library. Same idiom as
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
