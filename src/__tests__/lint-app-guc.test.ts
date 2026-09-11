/**
 * Red/green proof for the app-GUC reader gate (Phase 164.7, criterion 1, D-05).
 *
 * ⛔ FOUNDER RULE, MACHINE-CHECKED HERE: a gate that cannot fire is worse than
 * no gate — and this phase's whole subject is gates that cannot fire. Every
 * finding kind the script ships is exercised below, either against a COMMITTED
 * fixture (via `selfTest()`) or, for the two kinds no single file can exhibit,
 * against a temp corpus built at runtime.
 *
 * ⛔ NO ASSERTION HERE MAY BE SELF-REFERENTIAL (`[VAC-SELFREF-01]`). An
 * assertion whose subject is a constant defined two lines above cannot fail.
 * So every pin reads either the SCRIPT's exports, the FIXTURE files on disk, or
 * the real migrations tree — never a copy of the answer typed into this file.
 * The one deliberate exception is `EXPECTED_KIND_IDS`, which is the literal the
 * export is COMPARED AGAINST; that is the point of an exact-set pin.
 *
 * ⚠️ DATED 2026-09-07 — THE INTERIM IS OVER, and this is what replaced it. The
 * last describe block used to pin `scanCorpus()` on the real tree at 12 findings
 * across 5 files (per-file 1/5/4/1/1), MEASURED at plan 164.7-01's Task 1 run,
 * as the evidence the gate SEES the tree before anything is annotated. Plan
 * 164.7-05 annotated those five files and filled `LINEAGE_ALLOWLIST` in the same
 * commit, so the census arm is now `0 findings, 5 annotated files BY NAME` —
 * and the twelve sites did not go anywhere: the five allowlist `occurrences`
 * SUM TO 12, re-measured here against `countReads()` of each real file. That
 * sum is what makes "0 findings" mean "accounted for" rather than "no longer
 * looked at". ⛔ Do NOT restore the 12-finding pin: it was the interim, not the
 * goal, and the two anti-vacuity arms below are what keep the exemption honest.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DETECT_RE,
  FINDING_KINDS,
  FIXTURE_ALLOWLIST,
  FIXTURE_DIR,
  LINEAGE_ALLOWLIST,
  countReads,
  parseLineageHeader,
  relPath,
  scanCorpus,
  selfTest,
} from "../../scripts/lint-app-guc.mjs";

const ROOT = process.cwd();
const FIX_DIR = join(ROOT, FIXTURE_DIR);

/** The exact set of finding kinds this gate is allowed to ship. */
const EXPECTED_KIND_IDS = [
  "unannotated-reader",
  "header-malformed",
  "header-count-mismatch",
  "header-not-allowlisted",
  "successor-invalid",
  "allowlist-stale",
] as const;

/**
 * A real migration with ZERO app-GUC reads. Used as the anti-vacuity arm's
 * CALIBRATION CONTROL: the arm asserts that zero FIRST, so "0 findings" at the
 * start of the arm is a measured property of the file rather than an artefact
 * of a scanner that reads nothing.
 */
const CONTROL_MIGRATION = "supabase/migrations/20260411144407_compute_jobs_queue.sql";

type Kind = {
  id: string;
  title: string;
  scope: string;
  redFixtures?: string[];
  selfTestFixture?: boolean;
};

type Finding = { kind: string; file: string; line: number; message: string };

const kinds = FINDING_KINDS as Kind[];
const kindsOf = (fs: Finding[]) => fs.map((f) => f.kind);
const declaredReds = (k: Kind) => k.redFixtures ?? [`${k.id}.red.sql`];

function tempDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `app-guc-${tag}-`));
}

describe("lint-app-guc: the shipped finding kinds", () => {
  it("ships exactly the registered kinds, no more and no fewer", () => {
    expect(kinds.map((k) => k.id).sort()).toEqual([...EXPECTED_KIND_IDS].sort());
  });

  it("every kind carries a non-empty title and scope — a rule nobody can read is a rule nobody maintains", () => {
    for (const k of kinds) {
      expect(k.title.length, k.id).toBeGreaterThan(10);
      expect(k.scope.length, k.id).toBeGreaterThan(40);
    }
  });

  it("shares ONE definition of an app-GUC read with the cron-drift prober", () => {
    // Not a copy of the regex typed here — the identity is asserted against the
    // OTHER file's source text, so drifting either copy reds this test.
    const cronDrift = readFileSync(join(ROOT, "scripts/prod-prober/arms/cron-drift.mjs"), "utf8");
    expect(cronDrift).toContain(DETECT_RE.source);
  });

  it("LINEAGE_ALLOWLIST holds exactly the five annotated files, and every entry is complete", () => {
    // ⚠️ SUPERSEDES the dated `toEqual([])` pin of plan 164.7-01. That one was
    // honest for the interval it named — nothing was exempt yet, so the 12
    // findings WERE the whole tree. Plan 164.7-05 filled the list; asserting
    // emptiness now would assert the phase had not happened.
    expect(LINEAGE_ALLOWLIST.map((e) => e.file)).toEqual([
      "supabase/migrations/20260407164606_perfect_match.sql",
      "supabase/migrations/20260408113029_cron_heartbeat.sql",
      "supabase/migrations/20260408215026_schedule_match_cron_hourly.sql",
      "supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql",
      "supabase/migrations/20260825140000_ledger_refresh_composite_arm.sql",
    ]);
    for (const e of LINEAGE_ALLOWLIST) {
      expect(Number.isInteger(e.occurrences), `${e.file}: occurrences must be an integer`).toBe(true);
      expect(e.occurrences, `${e.file}: an exemption for zero reads is not an exemption`).toBeGreaterThan(0);
      expect(typeof e.successor, `${e.file}: successor must be a string`).toBe("string");
      expect(e.reason.length, `${e.file}: a reason a reviewer cannot read is not a reason`).toBeGreaterThan(40);
    }
  });
});

/**
 * ⭐ THE SECOND PIN on the widened detector (plan 164.8.5-07, 164.7-REVIEW
 * WR-07). The FIRST pin is the five committed single-spelling red fixtures the
 * script's own `--self-test` drives; this block is an independent statement of
 * the same six facts that does not depend on the fixture files existing.
 *
 * ⛔ The MUTANT arms below are what stop this block being a tautology. A list
 * of strings the regex matches is satisfied by a regex that matches
 * everything; a mutant that must FAIL to match is not. Each mutant is asserted
 * to actually DIFFER from the original source first — a "mutant" that is a
 * copy of the original tests nothing at all, which is the vacuity this whole
 * phase exists to eliminate.
 */
describe("lint-app-guc: DETECT_RE spelling calibration", () => {
  const SPELLINGS: Record<string, string> = {
    plain: "current_setting('app.x')",
    "doubled quote": "current_setting(''app.x'')",
    "E-string": "current_setting(E'app.x')",
    "dollar-quoted": "current_setting($q$app.x$q$)",
    "unicode string": "current_setting(U&'app.x')",
    "block comment": "current_setting/*c*/('app.x')",
  };

  it("matches all SIX spellings Postgres accepts for the same call", () => {
    for (const [name, sql] of Object.entries(SPELLINGS)) {
      expect(new RegExp(DETECT_RE.source, "i").test(sql), `${name}: ${sql}`).toBe(true);
    }
  });

  it("does NOT match a non-app GUC, nor an indirected read — the gate is not a `current_setting` grep", () => {
    // `quantalyze.*` GUCs ARE settable on this platform and are used by the
    // sanitize guards; flagging them would make the gate fire on the repo's own
    // working mechanism. `v_guc_needle` is plan 164.7-03's deliberate
    // concatenation, the one remaining blind spot, and it must stay a miss or
    // that migration would match this lint inside its own verification block.
    for (const sql of [
      "current_setting('quantalyze.x')",
      "current_setting('quantalyze.sanitize_in_progress', TRUE)",
      "current_setting(v_guc_needle)",
      "current_setting('app_x')",
      "current_setting('application_name')",
    ]) {
      expect(new RegExp(DETECT_RE.source, "i").test(sql), sql).toBe(false);
    }
  });

  it("MUTANT [EU]→[E]: narrowing the class blinds it to the unicode spelling and nothing else", () => {
    const mutated = DETECT_RE.source.replace("[EU]", "[E]");
    expect(mutated, "the mutant must actually differ, or this arm tests nothing").not.toBe(
      DETECT_RE.source,
    );
    const mutant = new RegExp(mutated, "i");
    expect(mutant.test(SPELLINGS["unicode string"]), "the mutant must MISS U&''").toBe(false);
    expect(mutant.test(SPELLINGS["E-string"]), "the mutant must still see E''").toBe(true);
  });

  it("MUTANT [EU]→[U]: narrowing the class the other way blinds it to the E-string spelling", () => {
    const mutated = DETECT_RE.source.replace("[EU]", "[U]");
    expect(mutated, "the mutant must actually differ, or this arm tests nothing").not.toBe(
      DETECT_RE.source,
    );
    const mutant = new RegExp(mutated, "i");
    expect(mutant.test(SPELLINGS["E-string"]), "the mutant must MISS E''").toBe(false);
    expect(mutant.test(SPELLINGS["unicode string"]), "the mutant must still see U&''").toBe(true);
  });

  it("MUTANT: dropping the second alternation blinds it to the dollar-quoted spelling", () => {
    const mutated = DETECT_RE.source.split("|current_setting")[0];
    expect(mutated).not.toBe(DETECT_RE.source);
    const mutant = new RegExp(mutated, "i");
    expect(mutant.test(SPELLINGS["dollar-quoted"])).toBe(false);
    expect(mutant.test(SPELLINGS.plain)).toBe(true);
  });

  it("MUTANT: dropping the block-comment group blinds it to a comment between name and paren", () => {
    const mutated = DETECT_RE.source.replace("(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)?", "");
    expect(mutated).not.toBe(DETECT_RE.source);
    const mutant = new RegExp(mutated, "i");
    expect(mutant.test(SPELLINGS["block comment"])).toBe(false);
    expect(mutant.test(SPELLINGS.plain)).toBe(true);
  });

  it("MUTANT: `'{1,2}`→`'` blinds it to the doubled-quote spelling ([APPGUC-DETECT-DOUBLEQUOTE-01])", () => {
    const mutated = DETECT_RE.source.replace("'{1,2}", "'");
    expect(mutated).not.toBe(DETECT_RE.source);
    const mutant = new RegExp(mutated, "i");
    expect(mutant.test(SPELLINGS["doubled quote"]), "the mutant must MISS ''app.").toBe(false);
    expect(mutant.test(SPELLINGS.plain), "the mutant must still see 'app.").toBe(true);
  });

  it("each widened spelling has its OWN red fixture, so a neuter can be attributed to ONE alternation", () => {
    const reds = declaredReds(kinds.find((k) => k.id === "unannotated-reader")!);
    for (const name of [
      "spelling-doubled-quote.red.sql",
      "spelling-e-string.red.sql",
      "spelling-dollar-tag.red.sql",
      "spelling-unicode.red.sql",
      "spelling-block-comment.red.sql",
    ]) {
      expect(reds, `${name} must be declared by unannotated-reader`).toContain(name);
      // And each fixture must hold exactly ONE site — a two-site fixture would
      // keep firing after its own spelling was neutered.
      const src = readFileSync(join(FIX_DIR, name), "utf8");
      expect(countReads(src).length, `${name} must be a SINGLE-site fixture`).toBe(1);
    }
  });
});

describe("lint-app-guc: the fixture set, read off disk", () => {
  const listing = readdirSync(FIX_DIR).sort();

  it("has a red fixture on disk for every kind that declares one", () => {
    const covered = kinds.filter((k) => k.selfTestFixture !== false);
    expect(covered.length).toBeGreaterThan(0);
    for (const k of covered) {
      for (const name of declaredReds(k)) {
        expect(listing, `${k.id} declares ${name}`).toContain(name);
      }
    }
  });

  it("has NO red fixture on disk that no kind declares", () => {
    const declared = new Set(
      kinds.filter((k) => k.selfTestFixture !== false).flatMap(declaredReds),
    );
    const onDisk = listing.filter((f) => f.endsWith(".red.sql"));
    expect(onDisk.length).toBeGreaterThan(0);
    for (const name of onDisk) expect([...declared]).toContain(name);
  });

  it("has the green pair, and the successor named by the annotated green exists", () => {
    const greens = listing.filter((f) => f.endsWith(".green.sql"));
    expect(greens.length).toBeGreaterThanOrEqual(2);
    const header = parseLineageHeader(readFileSync(join(FIX_DIR, "lineage.green.sql"), "utf8"));
    expect(header, "the annotated green fixture must carry a parseable header").toBeTruthy();
    expect((header as { malformed?: string }).malformed).toBeUndefined();
    expect(greens).toContain((header as { successor: string }).successor);
  });

  it("every FIXTURE_ALLOWLIST entry agrees with its file's own header", () => {
    // Two independent edits must say the same thing — that is the exemption's
    // whole design, so the fixture allowlist is held to it too.
    for (const entry of FIXTURE_ALLOWLIST as { file: string; occurrences: number; successor: string }[]) {
      const header = parseLineageHeader(readFileSync(join(ROOT, entry.file), "utf8")) as {
        occurrences: number;
        successor: string;
      };
      expect(header, entry.file).toBeTruthy();
      expect(header.occurrences, entry.file).toBe(entry.occurrences);
      expect(header.successor, entry.file).toBe(entry.successor);
    }
  });

  it("the self-test passes over the committed fixtures", () => {
    expect(selfTest()).toBe(0);
  });
});

describe("lint-app-guc: parseLineageHeader (header-malformed, vitest-covered by declaration)", () => {
  it("is declared vitest-covered rather than silently skipped by the self-test", () => {
    const k = kinds.find((x) => x.id === "header-malformed")!;
    expect(k.selfTestFixture).toBe(false);
  });

  it("accepts a well-formed header", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 3; successor: none; reason: x\nSELECT 1;",
    ) as { date: string; occurrences: number; successor: string; reason: string };
    expect(h.date).toBe("2026-09-07");
    expect(h.occurrences).toBe(3);
    expect(h.successor).toBe("none");
    expect(h.reason).toBe("x");
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-9-7; occurrences: 1; successor: none; reason: x",
    ) as { malformed: string };
    expect(h.malformed).toContain("2026-9-7");
  });

  it("rejects a date that is not a real calendar date", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-02-30; occurrences: 1; successor: none; reason: x",
    ) as { malformed: string };
    expect(h.malformed).toContain("real calendar date");
  });

  it("rejects a non-integer occurrence count", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: many; successor: none; reason: x",
    ) as { malformed: string };
    expect(h.malformed).toContain("occurrences");
  });

  it("rejects a missing field", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none",
    ) as { malformed: string };
    expect(h.malformed).toContain("reason");
  });

  it("parses an INDENTED marker — line-start after optional whitespace", () => {
    const h = parseLineageHeader(
      "SELECT 1;\n  -- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 0; successor: none; reason: indented\n",
    ) as { line: number; occurrences: number };
    expect(h.line).toBe(2);
    expect(h.occurrences).toBe(0);
  });

  it("returns null when there is no marker at all", () => {
    expect(parseLineageHeader("SELECT 1;\n")).toBeNull();
  });

  it("ignores a marker buried past the masthead", () => {
    const buried = `${"-- filler\n".repeat(60)}-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: too late`;
    expect(parseLineageHeader(buried)).toBeNull();
  });
});

describe("lint-app-guc: ANTI-VACUITY — one appended read is one more finding", () => {
  it("walks a real migration from clean, to flagged, to annotated, to un-pinned", () => {
    const dir = tempDir("vac");
    const src = readFileSync(join(ROOT, CONTROL_MIGRATION), "utf8");

    // CALIBRATION CONTROL, asserted FIRST: this real migration has zero reads,
    // so a later "0 findings" is a property of the file, not of a dead scanner.
    expect(countReads(src).length, `${CONTROL_MIGRATION} must be a zero-read control`).toBe(0);

    const target = join(dir, "20260411144407_compute_jobs_queue.sql");
    const rel = relPath(target);
    writeFileSync(target, src);

    let r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.measureFails).toEqual([]);
    expect(r.findings, "an unmodified zero-read migration is clean").toEqual([]);
    expect(r.filesScanned).toBe(1);

    // ONE appended read → exactly ONE more finding.
    const READER = "\nDO $$ BEGIN PERFORM current_setting('app.ledger_refresh_enabled', TRUE); END $$;\n";
    writeFileSync(target, src + READER);
    r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(kindsOf(r.findings)).toEqual(["unannotated-reader"]);
    expect(r.findings[0].file).toBe(rel);

    // A header that parses AND a matching allowlist entry → clean.
    const HEADER =
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: temp-copy arm\n";
    writeFileSync(target, HEADER + src + READER);
    const entry = { file: rel, occurrences: 1, successor: "none", reason: "temp" };
    r = scanCorpus({ migrationsDir: dir, allowlist: [entry] });
    expect(r.findings, "header + agreeing allowlist entry is the only exemption").toEqual([]);

    // The entry disagreeing with the header → the exemption is not the one reviewed.
    r = scanCorpus({ migrationsDir: dir, allowlist: [{ ...entry, occurrences: 2 }] });
    expect(kindsOf(r.findings)).toEqual(["header-not-allowlisted"]);

    // The entry gone → a header ALONE exempts nothing (threat T-164.7-01).
    r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(kindsOf(r.findings)).toEqual(["header-not-allowlisted"]);

    // And the count ratchet bites in BOTH directions on the annotated file: a
    // second read makes the pinned 1 wrong, and so does removing the only one.
    writeFileSync(target, HEADER + src + READER + READER);
    r = scanCorpus({ migrationsDir: dir, allowlist: [entry] });
    expect(kindsOf(r.findings)).toEqual(["header-count-mismatch"]);
    writeFileSync(target, HEADER + src);
    r = scanCorpus({ migrationsDir: dir, allowlist: [entry] });
    expect(kindsOf(r.findings)).toEqual(["header-count-mismatch"]);
  });
});

describe("lint-app-guc: allowlist-stale (vitest-covered by declaration)", () => {
  it("is declared vitest-covered rather than silently skipped by the self-test", () => {
    const k = kinds.find((x) => x.id === "allowlist-stale")!;
    expect(k.selfTestFixture).toBe(false);
  });

  it("fires for an entry whose file is not in the corpus carrying a valid header", () => {
    const dir = tempDir("stale");
    const src = readFileSync(join(ROOT, CONTROL_MIGRATION), "utf8");
    writeFileSync(join(dir, "20260411144407_compute_jobs_queue.sql"), src);

    const r = scanCorpus({
      migrationsDir: dir,
      allowlist: [
        { file: relPath(join(dir, "absent.sql")), occurrences: 0, successor: "none", reason: "x" },
      ],
    });
    expect(kindsOf(r.findings)).toEqual(["allowlist-stale"]);
    expect(r.findings[0].message).toContain("absent.sql");
  });
});

describe("lint-app-guc: MEASURE_FAIL never shares a code path with 'measured zero'", () => {
  it("MEASURE_FAILs on an empty corpus instead of reporting a clean tree", () => {
    const r = scanCorpus({ migrationsDir: tempDir("empty"), allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].reason).toContain("zero files");
  });

  it("MEASURE_FAILs on a corpus entry that cannot be read", () => {
    const dir = tempDir("unreadable");
    // git cannot carry an unreadable blob (see unreadable-marker.txt), so the
    // condition is BUILT here: a directory wearing a .sql name.
    mkdirSync(join(dir, "x.sql"));
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].file).toContain("x.sql");
  });
});

describe("lint-app-guc: the MEASURED ANNOTATED census on the real tree", () => {
  /**
   * ⚠️ DATED 2026-09-07, plan 164.7-05. The five files below are annotated, and
   * these are the counts their HEADERS pin — but nothing here is read back from
   * a header or from the allowlist as its own oracle. Every count is
   * re-measured with `countReads()` over the real file's bytes, so this map is
   * a THIRD independent statement of the same number, beside the header and the
   * allowlist entry that must already agree with each other.
   *
   * ⛔ These are exactly the twelve sites the plan-164.7-01 interim census
   * reported (1 / 5 / 4 / 1 / 1). Zero findings does not mean zero reads.
   */
  const EXPECTED_CENSUS: Record<string, number> = {
    "supabase/migrations/20260407164606_perfect_match.sql": 1,
    "supabase/migrations/20260408113029_cron_heartbeat.sql": 5,
    "supabase/migrations/20260408215026_schedule_match_cron_hourly.sql": 4,
    "supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql": 1,
    "supabase/migrations/20260825140000_ledger_refresh_composite_arm.sql": 1,
  };

  const result = scanCorpus({});
  const findings = result.findings as Finding[];

  it("scans a non-empty corpus with no measurement failures", () => {
    expect(result.measureFails).toEqual([]);
    expect(result.filesScanned).toBeGreaterThan(200);
  });

  // ── (g) the census arm this plan REPLACED the 12/5 interim with ────────────
  it("reports ZERO findings, exactly the five annotated files BY NAME, and every allowlist count equals the file's measured count", () => {
    expect(
      findings.map((f) => `${f.file}:${f.line} ${f.kind}`),
      "the annotated tree must be clean — and it must be clean by ANNOTATION, never by loosening the rule",
    ).toEqual([]);
    expect(result.annotated).toEqual(Object.keys(EXPECTED_CENSUS).sort());

    // ⛔ THE ANTI-VACUITY HALF. "0 findings" is also what a dead scanner
    // reports. Re-measure each annotated file's reads off disk and require the
    // allowlist entry to equal it — so a sixth read appended anywhere in these
    // five, or one removed, breaks this arm even if the gate itself were
    // neutered into silence.
    const measured: Record<string, number> = {};
    for (const entry of LINEAGE_ALLOWLIST) {
      const reads = countReads(readFileSync(join(ROOT, entry.file), "utf8")).length;
      measured[entry.file] = reads;
      expect(entry.occurrences, `${entry.file}: allowlist count vs countReads() of the real file`).toBe(reads);
    }
    expect(measured).toEqual(EXPECTED_CENSUS);
    expect(
      Object.values(measured).reduce((a, b) => a + b, 0),
      "the five exempted files still hold the SAME twelve sites the interim census reported",
    ).toBe(12);
  });

  // ── (h) remove one allowlist entry in memory → exactly one finding ─────────
  it("a header ALONE exempts nothing: dropping one allowlist entry fires exactly one header-not-allowlisted", () => {
    const dropped = "supabase/migrations/20260408113029_cron_heartbeat.sql";
    const r = scanCorpus({ allowlist: LINEAGE_ALLOWLIST.filter((e) => e.file !== dropped) });
    expect(kindsOf(r.findings as Finding[])).toEqual(["header-not-allowlisted"]);
    expect((r.findings as Finding[])[0].file).toBe(dropped);
  });

  // ── (i) append one read to a copy of an annotated file → count mismatch ────
  it("one MORE app-GUC read in an already-annotated file fires exactly one header-count-mismatch", () => {
    // The copy is scanned with the REAL allowlist entry, re-pointed at the temp
    // path and otherwise unchanged (same occurrences, same successor), so the
    // ONLY thing wrong with the corpus is the extra read. The named successor
    // is copied in beside it, or `successor-invalid` would fire as well and
    // this arm would isolate nothing.
    const dir = tempDir("annotated-plus-one");
    const entry = LINEAGE_ALLOWLIST.find((e) =>
      e.file.endsWith("20260825130000_ledger_refresh_fanout_dormant.sql"),
    )!;
    const base = "20260825130000_ledger_refresh_fanout_dormant.sql";
    const target = join(dir, base);
    writeFileSync(target, readFileSync(join(ROOT, entry.file), "utf8"));
    writeFileSync(
      join(dir, entry.successor),
      readFileSync(join(ROOT, "supabase/migrations", entry.successor), "utf8"),
    );
    const tempEntry = { ...entry, file: relPath(target) };

    // Control FIRST: the untouched copy under the real entry is clean, so a
    // finding below is caused by the appended read and not by the copying.
    expect(scanCorpus({ migrationsDir: dir, allowlist: [tempEntry] }).findings).toEqual([]);

    writeFileSync(
      target,
      readFileSync(target, "utf8") +
        "\nDO $$ BEGIN PERFORM current_setting('app.ledger_refresh_enabled', TRUE); END $$;\n",
    );
    const r = scanCorpus({ migrationsDir: dir, allowlist: [tempEntry] });
    expect(kindsOf(r.findings as Finding[])).toEqual(["header-count-mismatch"]);
    expect((r.findings as Finding[])[0].message).toContain("A NEW read was added");
  });

  it("counts the COMMENTED site too (D-05) — the secret-hygiene comment in cron_heartbeat", () => {
    // The one site the RUNTIME never sees and the GATE must. With the file now
    // annotated there is no finding to read the line off, so the line is
    // re-derived from the bytes: the read whose own line begins with `--`.
    // ⛔ NOT pinned to a literal line number any more — plan 164.7-05's header
    // shifted it, and a hard-coded number would have to be re-typed by whoever
    // next touches the masthead, which is how a pin becomes a chore and then a
    // lie. A masking scanner reports 4 here and looks almost right.
    const src = readFileSync(
      join(ROOT, "supabase/migrations/20260408113029_cron_heartbeat.sql"),
      "utf8",
    );
    const lines = src.split("\n");
    const reads = countReads(src);
    expect(reads.length, "the file's five sites (D-05 counts the comment)").toBe(5);
    const commented = reads.filter((r) => lines[r.line - 1].trimStart().startsWith("--"));
    expect(commented.length, "exactly one of the five is inside a `--` comment").toBe(1);
    expect(lines[commented[0].line - 1]).toContain("current_setting");
  });
});
