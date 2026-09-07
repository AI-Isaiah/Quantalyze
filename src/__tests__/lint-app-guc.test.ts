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
 * ⚠️ DATED 2026-09-07 — THE CENSUS ARM IS AN INTERIM. The last describe block
 * pins `scanCorpus()` on the real tree at 12 findings across 5 files. That is
 * the number MEASURED at plan 164.7-01's Task 1 run, and it is the evidence the
 * gate SEES the tree before anything is annotated. Plan 164.7-05 annotates
 * those five files and fills LINEAGE_ALLOWLIST; when it does, this arm is
 * rewritten to `0 findings, 5 annotated files by name`. Until then the corpus
 * step in CI is RED by design. Do NOT "fix" the count by loosening the rule.
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

  it("LINEAGE_ALLOWLIST is EMPTY at this commit — plan 164.7-05 fills it", () => {
    // Dated pin, 2026-09-07. This is what makes the interim RED honest: nothing
    // is exempt yet, so the 12 findings below are the whole tree.
    expect(LINEAGE_ALLOWLIST).toEqual([]);
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

describe("lint-app-guc: the MEASURED interim census on the real tree", () => {
  /**
   * ⚠️ DATED 2026-09-07, measured at plan 164.7-01 Task 1 on this tree — every
   * number below was read off that run's output, not derived from the plan.
   * Plan 164.7-05 rewrites this block to `0 findings, 5 annotated files by
   * name`. Until then the count IS the evidence that the gate sees the tree.
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

  it("reports exactly 12 findings across exactly the 5 measured files", () => {
    expect(findings.length).toBe(12);
    expect([...new Set(findings.map((f) => f.file))].sort()).toEqual(
      Object.keys(EXPECTED_CENSUS).sort(),
    );
  });

  it("reports the per-file counts 1 / 5 / 4 / 1 / 1", () => {
    const perFile: Record<string, number> = {};
    for (const f of findings) perFile[f.file] = (perFile[f.file] ?? 0) + 1;
    expect(perFile).toEqual(EXPECTED_CENSUS);
  });

  it("reports all 12 as unannotated-reader — nothing is annotated yet", () => {
    expect([...new Set(kindsOf(findings))]).toEqual(["unannotated-reader"]);
    expect(result.annotated).toEqual([]);
  });

  it("counts the COMMENTED site too (D-05) — cron_heartbeat line 113", () => {
    // The one site the RUNTIME never sees and the GATE must. Pinned by line,
    // because a masking scanner would report 11 findings and 5 files and look
    // almost right.
    const heartbeat = findings.filter((f) => f.file.endsWith("20260408113029_cron_heartbeat.sql"));
    expect(heartbeat.map((f) => f.line)).toContain(113);
  });
});
