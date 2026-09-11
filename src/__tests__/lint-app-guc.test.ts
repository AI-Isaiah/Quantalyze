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
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DETECT_RE,
  FINDING_KINDS,
  FIXTURE_ALLOWLIST,
  FIXTURE_DIR,
  LINEAGE_ALLOWLIST,
  countReads,
  main,
  parseLineageHeader,
  relPath,
  scanCorpus,
  scanPaths,
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
    expect(cronDrift, "the prober must carry this exact source somewhere").toContain(DETECT_RE.source);

    // ⛔ CONTAINMENT IS NOT IDENTITY, MEASURED 2026-09-11 (plan 164.8.5-07,
    // Task 3 row 4). `toContain` alone catches a copy that DIVERGES and is
    // BLIND to one that SHRINKS TO A PREFIX: deleting the trailing
    // dollar-quoted alternation from `DETECT_RE` left the remaining source a
    // perfectly good substring of the prober's untouched regex, and this test
    // stayed GREEN while the two files had genuinely stopped agreeing. The
    // comment above claimed "drifting either copy reds this test" and, in that
    // direction, it did not.
    //
    // So the source is EXTRACTED from the prober and compared for EQUALITY.
    // Now a narrowing on either side reds, which is what the claim says.
    const literal = /^\s*\/(current_setting[^\n]*?)\/i\.test\($/m.exec(cronDrift);
    expect(
      literal,
      "cron-drift must carry the app-guc regex as ONE single-line literal this test can extract",
    ).toBeTruthy();
    expect(literal![1], "the two copies must be BYTE-IDENTICAL, not merely overlapping").toBe(
      DETECT_RE.source,
    );
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

// ───────────────────────────────────────────────────────────────────────────
// Plan 164.8.5-07 — the arms no single committed fixture can isolate.
//
// Each block below ships a CALIBRATION: the same corpus without the defect must
// be clean. Without it, "a finding fired" is satisfied by a scanner that finds
// something wrong with every temp corpus it is handed, and the arm would be
// asserting the harness rather than the rule.
// ───────────────────────────────────────────────────────────────────────────

/** A minimal annotated migration: header + exactly one app-GUC read. */
function annotated(successor: string, occurrences = 1): string {
  return (
    `-- APP-GUC-LINEAGE: retired 2026-09-10; occurrences: ${occurrences}; successor: ${successor}; ` +
    "reason: temp-corpus arm for the successor check\n" +
    "DO $$ BEGIN PERFORM current_setting('app.ledger_refresh_enabled', TRUE); END $$;\n"
  );
}

/** Scans ONE file with an allowlist entry that AGREES with its header, so the
 *  only thing that can fire is the successor arm under test. */
function scanOne(abs: string, successor: string, occurrences = 1) {
  return scanPaths([abs], {
    allowlist: [{ file: relPath(abs), occurrences, successor, reason: "temp-corpus arm" }],
  }) as { findings: Finding[]; measureFails: { file: string; reason: string }[] };
}

describe("lint-app-guc: successor-invalid — every arm, each with its OWN red surface (WR-06 / threat T-164.7-02)", () => {
  it("CALIBRATION: a sibling .sql successor that exists and reads nothing is clean", () => {
    const dir = tempDir("succ-ok");
    writeFileSync(join(dir, "later.sql"), "SELECT 1;\n");
    const target = join(dir, "a.sql");
    writeFileSync(target, annotated("later.sql"));
    const r = scanOne(target, "later.sql");
    expect(r.measureFails).toEqual([]);
    expect(kindsOf(r.findings), "the control must be clean or no arm below is attributable").toEqual([]);
  });

  it("arm 1a TYPE: a successor that is not a .sql file is refused — T-164.7-02 closure evidence", () => {
    // ⭐ BOTH strings 164.7-REVIEW WR-06 MEASURED PASSING are asserted here.
    // `notes.txt` is additionally a committed self-test fixture; the traversal
    // `.md` string is the second half of the closure evidence and fails on TYPE
    // before the separator is ever considered.
    //
    // ⛔ THE TARGET HOLDS ZERO APP-GUC READS, DELIBERATELY. That is what makes
    // it the WR-06 defect: a content-clean non-SQL file is what the OLD check
    // passed. A target carrying a read would be refused by the CONTENT arm
    // instead, and the red would not be attributable to the TYPE arm —
    // MEASURED on the committed fixture, where exactly that draft left the
    // self-test GREEN with the type arm deleted.
    const dir = tempDir("succ-type");
    writeFileSync(join(dir, "notes.txt"), "plain text, no SQL, and nothing for the detector\n");
    for (const bad of ["notes.txt", "../out/escaped.md"]) {
      const target = join(dir, "a.sql");
      writeFileSync(target, annotated(bad));
      const r = scanOne(target, bad);
      expect(kindsOf(r.findings), bad).toEqual(["successor-invalid"]);
      expect(r.findings[0].message, bad).toContain("not a .sql file");
    }
  });

  it("arm 1b SEPARATOR: a `.sql` successor carrying a path separator is refused as not a SIBLING", () => {
    // ⛔ The name MUST end in `.sql`. `../out/escaped.md` also fails arm 1a on
    // type, so a red on THAT string could not be attributed to the separator
    // arm — and an unattributable red is the defect this phase exists to
    // remove. `../out/escaped.sql` can only be refused by 1b.
    const dir = tempDir("succ-sep");
    const target = join(dir, "a.sql");
    writeFileSync(target, annotated("../out/escaped.sql"));
    const r = scanOne(target, "../out/escaped.sql");
    expect(kindsOf(r.findings)).toEqual(["successor-invalid"]);
    expect(r.findings[0].message).toContain("not a SIBLING");
    expect(r.findings[0].message, "it must NOT be refused on type").not.toContain("not a .sql file");
  });

  it("arm 2 isFile: a DIRECTORY wearing the successor's name is refused", () => {
    const dir = tempDir("succ-dir");
    mkdirSync(join(dir, "later.sql"));
    const target = join(dir, "a.sql");
    writeFileSync(target, annotated("later.sql"));
    const r = scanOne(target, "later.sql");
    expect(kindsOf(r.findings)).toEqual(["successor-invalid"]);
    expect(r.findings[0].message).toContain("not a regular file");
  });

  it("arm 3 TIMESTAMP: a lineage cannot point backwards, and the right way round is clean", () => {
    const dir = tempDir("succ-time");
    const LATER = "20260907130000_x.sql";
    const EARLIER = "20260907120000_y.sql";

    // Backwards: the later migration claims the earlier one as its successor.
    writeFileSync(join(dir, EARLIER), "SELECT 1;\n");
    const back = join(dir, LATER);
    writeFileSync(back, annotated(EARLIER));
    const r = scanOne(back, EARLIER);
    expect(kindsOf(r.findings)).toEqual(["successor-invalid"]);
    expect(r.findings[0].message).toContain("cannot point backwards");

    // CALIBRATION, the same two names the other way round: clean.
    const dir2 = tempDir("succ-time-ok");
    writeFileSync(join(dir2, LATER), "SELECT 1;\n");
    const fwd = join(dir2, EARLIER);
    writeFileSync(fwd, annotated(LATER));
    expect(kindsOf(scanOne(fwd, LATER).findings)).toEqual([]);
  });

  it("arm 3 does NOT judge fixture names — it is conditional on BOTH names being migrations", () => {
    // `lineage.green.sql -> successor-target.green.sql` carries no timestamp
    // prefix and must not be compared as if it did; that is why this arm is
    // conditional rather than universal.
    const dir = tempDir("succ-nots");
    writeFileSync(join(dir, "aaa.sql"), "SELECT 1;\n");
    const target = join(dir, "zzz.sql");
    writeFileSync(target, annotated("aaa.sql"));
    expect(kindsOf(scanOne(target, "aaa.sql").findings)).toEqual([]);
  });

  it("arm 4 UNREADABLE: a sibling .sql successor that exists but cannot be read is refused", () => {
    // Same shape as the isFile arm: `existsSync` and `isFile()` both say yes,
    // and the file is STILL not evidence that the mechanism moved — the gate
    // could not read it, and "could not read" is never "reads zero". Until
    // this arm the catch around `readFileSync(successorAbs)` had no surface of
    // any kind.
    //
    // ⛔ The condition is BUILT with chmod 000 and then PROBED rather than
    // assumed: a process running as root reads a 000 file anyway, so under
    // root this arm would report a green it never measured. A platform that
    // cannot produce the condition SKIPS with a NAMED reason — the same idiom
    // the symlink arm below already uses for `symlinkSync`.
    const dir = tempDir("succ-unreadable");
    const succ = join(dir, "later.sql");
    writeFileSync(succ, "SELECT 1;\n");
    let unreadable = false;
    try {
      chmodSync(succ, 0o000);
      readFileSync(succ, "utf8");
    } catch {
      unreadable = true;
    }
    if (!unreadable) {
      console.warn(
        "SKIPPED (named): chmod 000 left the successor readable here (root?) — the unreadable-successor arm was NOT measured on this platform.",
      );
      expect(unreadable, "unreadable-successor arm unmeasured on this platform").toBe(false);
      return;
    }
    const target = join(dir, "a.sql");
    writeFileSync(target, annotated("later.sql"));
    const r = scanOne(target, "later.sql");
    chmodSync(succ, 0o644);
    expect(r.measureFails).toEqual([]);
    expect(kindsOf(r.findings)).toEqual(["successor-invalid"]);
    expect(r.findings[0].message).toContain("cannot be read");
    // One defect, one finding: an unreadable successor must NOT also be
    // reported as one that "still contains" reads, or the two arms become
    // inseparable and neither is attributable.
    expect(r.findings[0].message, "the CONTENT arm must not fire as well").not.toContain(
      "still contains",
    );
  });

  it("arm 5 CONTENT: a sibling .sql successor that ITSELF still reads an app GUC is refused", () => {
    // ⛔ THE ARM CARRYING THE ORIGINAL SEMANTIC OF THE WHOLE CHECK — "the
    // successor must itself contain ZERO app-GUC reads, else the lineage
    // points at another copy of the same defect" — and until this test it had
    // NO red surface of any kind. MEASURED 2026-09-11: neutering
    // `if (successorReads !== null && successorReads !== 0)` to `if (false)`
    // (edit verified present in the file) left `--self-test` at exit 0, the
    // corpus at exit 0 and this suite at 53 passed. Nothing moved. The
    // docstring nonetheless claimed each arm "can be disabled alone and
    // exactly one red surface goes clean".
    //
    // THE FAILURE IT MUST CATCH: annotate a migration with
    // `successor: <a sibling .sql that itself still reads an app GUC>`. The
    // lineage now points at another copy of the defect and every gate in the
    // repo is green.
    //
    // CALIBRATION is the first test in this block: the same corpus with
    // `later.sql` holding `SELECT 1;` is clean, so the red below is caused by
    // the successor's CONTENT and by nothing about the harness.
    const dir = tempDir("succ-content");
    writeFileSync(
      join(dir, "later.sql"),
      "DO $$ BEGIN PERFORM current_setting('app.x', TRUE); END $$;\n",
    );
    const target = join(dir, "a.sql");
    writeFileSync(target, annotated("later.sql"));
    const r = scanOne(target, "later.sql");
    expect(r.measureFails).toEqual([]);
    expect(kindsOf(r.findings)).toEqual(["successor-invalid"]);
    expect(r.findings[0].message).toContain("still contains 1");
    // Attribution: it must be refused on CONTENT, not on type, sibling-ness,
    // existence or regular-file-ness — every one of which is a different arm.
    for (const otherArm of [
      "not a .sql file",
      "not a SIBLING",
      "does not exist beside",
      "not a regular file",
      "cannot point backwards",
      "cannot be read",
    ]) {
      expect(r.findings[0].message, `must not be refused on: ${otherArm}`).not.toContain(otherArm);
    }
  });
});

describe("lint-app-guc: IN-01 — `--files` mode says its allowlist enforcement is OFF", () => {
  function captureLog(fn: () => void): string[] {
    const lines: string[] = [];
    const real = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      fn();
    } finally {
      console.log = real;
    }
    return lines;
  }

  const BANNER = "allowlist enforcement OFF";

  it("prints the banner in --files mode", () => {
    const lines = captureLog(() => main(["--files", join(FIX_DIR, "lineage.green.sql")]));
    expect(lines.some((l) => l.includes(BANNER)), lines.join("\n")).toBe(true);
  });

  it("CALIBRATION: corpus mode does NOT print it — the gate's own invocation is unaffected", () => {
    const lines = captureLog(() => main([]));
    expect(lines.some((l) => l.includes(BANNER)), lines.join("\n")).toBe(false);
    // And the corpus mode still reports, so the calibration is not just a
    // silent run: a mode that printed nothing would also pass the line above.
    expect(lines.some((l) => l.includes("app-guc: findings"))).toBe(true);
  });
});

describe("lint-app-guc: IN-02 — the corpus walk follows case and symlinked directories", () => {
  it("scans a `.SQL` file — the extension test is case-insensitive", () => {
    const dir = tempDir("case");
    writeFileSync(
      join(dir, "A.SQL"),
      "DO $$ BEGIN PERFORM current_setting('app.x', TRUE); END $$;\n",
    );
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.measureFails, "a case-sensitive walk would find zero files and MEASURE_FAIL").toEqual([]);
    expect(r.filesScanned).toBe(1);
    expect(kindsOf(r.findings as Finding[])).toEqual(["unannotated-reader"]);
  });

  it("descends into a SYMLINKED directory — readdir's isDirectory() is false for a link", () => {
    const dir = tempDir("symlink");
    const real = join(dir, "real");
    mkdirSync(real);
    writeFileSync(
      join(real, "b.sql"),
      "DO $$ BEGIN PERFORM current_setting('app.x', TRUE); END $$;\n",
    );
    const hidden = join(dir, "hidden");
    mkdirSync(hidden);
    writeFileSync(
      join(hidden, "c.sql"),
      "DO $$ BEGIN PERFORM current_setting('app.x', TRUE); END $$;\n",
    );
    // The link is created OUTSIDE the try below on purpose: a platform that
    // cannot make one must SKIP with a named reason, never silently pass.
    let linked = true;
    try {
      symlinkSync(hidden, join(dir, "linked"), "dir");
    } catch {
      linked = false;
    }
    if (!linked) {
      console.warn("SKIPPED (named): this platform refused symlinkSync — the symlink arm was not measured here.");
      expect(linked, "symlink arm unmeasured on this platform").toBe(false);
      return;
    }
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.measureFails).toEqual([]);
    // real/b.sql + hidden/c.sql + linked/c.sql (the same file, reached twice).
    expect(r.filesScanned, "the symlinked subtree must be walked, not skipped").toBe(3);
    expect((r.findings as Finding[]).some((f) => f.file.includes("linked/c.sql"))).toBe(true);
  });
});

/**
 * ⛔ THE WALK CAN FAIL, AND A FAILED WALK MUST NOT READ AS AN EMPTY ONE
 * (closed 2026-09-11).
 *
 * The symlink widening above shipped with an empty `catch { linkedDir = false; }`
 * whose comment justified the swallow for a DANGLING link. It also swallowed
 * EACCES, ELOOP, ENAMETOOLONG and a target on an unmounted volume, and
 * MEASURED on this tree: a dangling link contributed zero entries and zero
 * errors — indistinguishable from an empty directory, which is the very defect
 * the widening's own docstring claims to be fixing.
 *
 * THE CALIBRATION for this whole block is the "descends into a SYMLINKED
 * directory" arm above: a CONTAINED, non-cyclic link is still walked, and the
 * same real subtree reached by two different paths is still counted twice
 * (3 files for 2 real ones). That is what stops the containment and cycle
 * guards below from being a walk that simply refuses everything.
 */
describe("lint-app-guc: a walk that could not enter a subtree MEASURE_FAILs by name", () => {
  /** Builds the corpus, or SKIPS with a named reason if the platform refuses links. */
  function withLink(dir: string, target: string, name: string): boolean {
    try {
      symlinkSync(target, join(dir, name), "dir");
      return true;
    } catch {
      console.warn(
        `SKIPPED (named): this platform refused symlinkSync for ${name} — this arm was NOT measured here.`,
      );
      return false;
    }
  }

  it("a DANGLING link (unmounted volume, ENOENT) is a MEASURE_FAIL, never a skipped subtree", () => {
    // THE SCENARIO: `supabase/migrations/vendor -> /mnt/shared/migrations` on a
    // runner without that mount. Before this, statSync threw, the subtree was
    // skipped, `requireNonEmpty` was satisfied by the other 292 files, and the
    // gate reported `findings 0, exit 0` for a corpus it had never read.
    const dir = tempDir("walk-dangling");
    writeFileSync(join(dir, "ok.sql"), "SELECT 1;\n");

    // CALIBRATION FIRST: the same corpus with NO link at all is clean, so the
    // red below is caused by the link and not by the harness.
    const control = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(control.measureFails).toEqual([]);
    expect(control.ok, "the control corpus must be clean").toBe(true);
    expect(control.filesScanned).toBe(1);

    if (!withLink(dir, "/mnt/shared/migrations-that-are-not-mounted", "vendor")) return;
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok, "a corpus with an unwalkable subtree is NOT a clean one").toBe(false);
    expect(r.findings, "a walk failure is a MEASURE_FAIL, never a finding").toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].file).toContain("vendor");
    expect(r.measureFails[0].reason).toContain("cannot stat the symlink");
  });

  it("a link resolving OUTSIDE the corpus root is refused — the walk cannot leave the corpus", () => {
    // MEASURED before the fix: `ln -s .. migrations/loop` pulled 66,034 files
    // in and walked out of the repo entirely, terminating only when
    // ENAMETOOLONG hit the same swallowing catch. Unbounded work AND an escape
    // from the root the gate claims to measure.
    const outer = tempDir("walk-escape");
    const dir = join(outer, "sub");
    mkdirSync(dir);
    writeFileSync(join(dir, "ok.sql"), "SELECT 1;\n");
    writeFileSync(join(outer, "not-in-the-corpus.sql"), "SELECT 1;\n");

    if (!withLink(dir, "..", "loop")) return;
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].reason).toContain("OUTSIDE the corpus root");
    // BOUNDED, and the escape did not happen: the file one level up must NOT
    // have been dragged in. A refusal that still scanned it would be a message
    // rather than a guard.
    expect(r.filesScanned, "the walk must stay inside the root it was given").toBe(1);
    expect(
      r.measureFails[0].reason,
      "it must be refused on CONTAINMENT, distinctly from the stat and cycle arms",
    ).not.toContain("cannot stat the symlink");
  });

  it("a link resolving onto a directory already on the descent path is refused as a CYCLE", () => {
    const dir = tempDir("walk-cycle");
    writeFileSync(join(dir, "ok.sql"), "SELECT 1;\n");
    if (!withLink(dir, ".", "self")) return;
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].reason).toContain("already on the descent path");
    expect(r.filesScanned, "the cycle must not multiply the corpus").toBe(1);
    // Pairwise-distinct fingerprints: three refusals, three messages, so a
    // neuter of any one arm is attributable to that arm.
    for (const otherArm of ["cannot stat the symlink", "OUTSIDE the corpus root"]) {
      expect(r.measureFails[0].reason, `must not be refused on: ${otherArm}`).not.toContain(otherArm);
    }
  });

  it("a directory that RESOLVES but cannot be READ is a MEASURE_FAIL, not an uncaught throw that loses the whole corpus", () => {
    // ⛔ THE ONE BARE CALL IN A BLOCK BUILT OUT OF WRAPPED ONES. `descend`
    // wraps `realpathSync` and the symlink arm wraps `statSync`; `readdirSync`
    // was not wrapped, so a directory that resolves fine and merely cannot be
    // LISTED — mode 0111, EACCES, EIO on a network mount, EMFILE — threw
    // straight out of `sqlFilesUnder` → `scanCorpus` → `main`. MEASURED
    // 2026-09-11 with `chmod 111` on a subdirectory: `THREW: EACCES`, and with
    // it no MEASURE_FAIL, no `app-guc:` summary and no `report()` at all.
    //
    // ⚠️ NOT A FALSE GREEN — uncaught means exit 1 means red CI. What it cost
    // was the block's own design: the operator got a stack trace instead of the
    // sentence naming what was not measured, and ONE unreadable directory lost
    // every sibling the walk could have read.
    const dir = tempDir("walk-unreadable");
    writeFileSync(join(dir, "ok.sql"), "SELECT 1;\n");
    const locked = join(dir, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "hidden.sql"), "SELECT 2;\n");

    // CALIBRATION FIRST, while the directory is still readable: two files, no
    // failures. The red below is caused by the mode change and by nothing else.
    const control = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(control.measureFails).toEqual([]);
    expect(control.ok, "the control corpus must be clean").toBe(true);
    expect(control.filesScanned).toBe(2);

    chmodSync(locked, 0o111); // resolves and can be entered, but NOT listed
    try {
      if (scanCorpus({ migrationsDir: dir, allowlist: [] }).measureFails.length === 0) {
        // Running as root (some CI images) defeats the permission bit outright.
        console.warn("SKIPPED (named): this environment can read a 0111 directory — this arm was NOT measured here.");
        return;
      }
      const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
      expect(r.ok, "a corpus with an unreadable subtree is NOT a clean one").toBe(false);
      expect(r.findings, "a walk failure is a MEASURE_FAIL, never a finding").toEqual([]);
      expect(r.measureFails.length).toBe(1);
      expect(r.measureFails[0].file).toContain("locked");
      expect(r.measureFails[0].reason).toContain("cannot READ the directory");
      // ⭐ AND THE WALK CONTINUES. The sibling the walk CAN read is still
      // scanned — one unreadable directory must not cost the corpus.
      expect(r.filesScanned, "the readable sibling survives the refusal").toBe(1);
      // Pairwise-distinct fingerprints: this refusal is attributable to THIS
      // arm and to none of the three symlink arms beside it.
      for (const otherArm of ["cannot stat the symlink", "OUTSIDE the corpus root", "already on the descent path", "cannot resolve the corpus root"]) {
        expect(r.measureFails[0].reason, `must not be refused on: ${otherArm}`).not.toContain(otherArm);
      }
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("a walk failure SURVIVES the empty-corpus early return — both reasons are reported", () => {
    // A directory whose ONLY entry is an unwalkable link yields zero files AND
    // one walk failure. `requireNonEmpty` returns early; the seeded failure
    // must not be dropped on the way out, or the emptier reason would hide the
    // more specific one.
    const dir = tempDir("walk-empty");
    if (!withLink(dir, "/mnt/shared/migrations-that-are-not-mounted", "vendor")) return;
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.filesScanned).toBe(0);
    expect(r.measureFails.map((m) => m.reason).join(" | ")).toContain("cannot stat the symlink");
    expect(r.measureFails.map((m) => m.reason).join(" | ")).toContain("zero files");
  });

  it("the REAL corpus walks clean — this tightening flags nothing that exists (0 symlinks)", () => {
    const r = scanCorpus({});
    expect(r.measureFails).toEqual([]);
    expect(r.filesScanned).toBeGreaterThan(200);
  });
});

describe("lint-app-guc: IN-03 — two lineage markers is header-malformed, not 'first one wins'", () => {
  it("reports the COUNT and both line numbers when a file carries two markers", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: the reviewed one\n" +
        "SELECT 1;\n" +
        "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 9; successor: none; reason: the contradicting one\n",
    ) as { line: number; malformed: string };
    expect(h.malformed).toContain("2 lineage markers");
    expect(h.malformed).toContain("lines 1, 3");
    expect(h.line, "the finding is reported at the FIRST marker").toBe(1);
  });

  it("CALIBRATION: ONE marker parses exactly as before", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: the only one\n",
    ) as { occurrences: number; malformed?: string };
    expect(h.malformed).toBeUndefined();
    expect(h.occurrences).toBe(1);
  });

  it("a second marker BEYOND the masthead window does not count — the window is the rule", () => {
    const h = parseLineageHeader(
      "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: the only one\n" +
        "-- filler\n".repeat(60) +
        "-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 9; successor: none; reason: too late\n",
    ) as { occurrences: number; malformed?: string };
    expect(h.malformed).toBeUndefined();
    expect(h.occurrences).toBe(1);
  });
});

describe("lint-app-guc: [APPGUC-UTF16-01] — an undecodable migration MEASURE_FAILs by name", () => {
  const READER = "DO $$ BEGIN PERFORM current_setting('app.x', TRUE); END $$;\n";

  it("a UTF-16LE file (BOM FF FE) is a MEASURE_FAIL naming BOM, and never a clean count", () => {
    const dir = tempDir("utf16");
    const target = join(dir, "a.sql");
    // The BOM is written as EXPLICIT BYTES rather than as a U+FEFF character in
    // this source: an invisible character in a test file is a fact nobody can
    // review, and `readFileSync(…, "utf8")` would have decoded this whole file
    // into mojibake and reported it clean — which is the defect under test.
    writeFileSync(target, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(READER, "utf16le")]));
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.findings, "an undecodable file must produce NO findings, not zero-that-looks-clean").toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].file).toContain("a.sql");
    expect(r.measureFails[0].reason).toContain("BOM");
  });

  it("a UTF-8 file with a NUL byte and NO BOM is a MEASURE_FAIL naming NUL", () => {
    // ⛔ A SEPARATE test from the BOM one on purpose: the two predicates are
    // two controls, and one test covering both could be satisfied by either.
    const dir = tempDir("nul");
    const target = join(dir, "a.sql");
    writeFileSync(target, Buffer.concat([Buffer.from("-- note\0hidden\n"), Buffer.from(READER)]));
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.measureFails.length).toBe(1);
    expect(r.measureFails[0].reason).toContain("NUL");
    expect(r.measureFails[0].reason, "the BOM predicate must not claim this one").not.toContain("BOM");
  });

  it("CALIBRATION: the same content as clean UTF-8 is measured, and fires one unannotated-reader", () => {
    const dir = tempDir("clean");
    writeFileSync(join(dir, "a.sql"), READER);
    const r = scanCorpus({ migrationsDir: dir, allowlist: [] });
    expect(r.measureFails).toEqual([]);
    expect(kindsOf(r.findings as Finding[])).toEqual(["unannotated-reader"]);
  });

  it("the REAL corpus carries no BOM and no NUL — this tightening flags nothing that exists", () => {
    const r = scanCorpus({});
    expect(r.measureFails).toEqual([]);
    expect(r.filesScanned).toBeGreaterThan(200);
  });
});
