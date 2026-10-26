import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ADR-0008 truth pins (Phase 167.1.2.2.2, SC-6).
 *
 * WHY THIS FILE EXISTS. ADR-0008 told every reader that a pg_cron trigger called
 * `/cron-sync`. None ever did, and four live strategy keys went unsynced for up to
 * 156 days with nobody asking, because the one document that answers "what runs
 * on what schedule" said the question was already answered. A document that is
 * wrong in a comfortable direction does not get re-checked, so the correction is
 * pinned: the false sentences may stay (the ADR keeps its decision history as
 * lineage) but only beside a dated `CORRECTED` note that says what is true.
 *
 * WHAT IT DOES NOT DO. It never reads the planning tree: that tree is stripped
 * from the filtered PR branch, so a test that read it would be red on `main` for
 * no defect in the ADR. The path check below only looks at the top-level source
 * directories it names, so planning paths the ADR cites are not existence-checked.
 *
 * EDIT FORM. Never delete a decision. Add the correction beside the sentence it
 * corrects, in the same paragraph or the paragraph that immediately follows it.
 */

const ROOT = process.cwd();
const ADR_PATH = join(ROOT, "docs", "architecture", "adr-0008-cron-architecture.md");

function readAdr(): string {
  return readFileSync(ADR_PATH, "utf8");
}

/**
 * `text.indexOf(anchor)`, but a miss THROWS by name instead of returning -1. A raw -1
 * fed to `slice` counts from the END, so a renamed heading would degrade the slice into
 * a one-character tail (or near the whole document) and every assertion over it would
 * pass vacuously. Restated per-file, matching the self-containment convention of the
 * other gate-proof files (see the narrowing-call rule in test-restore-workflow-wiring).
 */
function anchorIndex(text: string, anchor: string): number {
  const at = text.indexOf(anchor);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the ADR. Fix the anchor or the ADR; do not default it.`,
    );
  }
  return at;
}

/** Blank-line-delimited paragraphs; blockquote markers and wraps collapsed to single spaces. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.replace(/^\s*>\s?/, ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p.length > 0);
}

const CORRECTED_RE = /CORRECTED \d{4}-\d{2}-\d{2}/;

/**
 * The dated notes inside a paragraph, one string per `CORRECTED <date>` marker, each
 * running to the next marker or the end of the paragraph. Two notes that share a
 * paragraph must not vouch for each other: a keyword check runs against ONE note.
 */
function notesOf(paragraph: string): string[] {
  const notes: string[] = [];
  const re = /CORRECTED \d{4}-\d{2}-\d{2}/g;
  const starts: number[] = [];
  for (let m = re.exec(paragraph); m; m = re.exec(paragraph)) starts.push(m.index);
  starts.forEach((at, i) => notes.push(paragraph.slice(at, starts[i + 1] ?? paragraph.length)));
  return notes;
}

/**
 * Each false statement, and what the dated note beside it must say to count as
 * the correction (a note that merely exists, saying something else, is not one).
 */
const FALSE_STATEMENTS: ReadonlyArray<{
  needle: string;
  why: string;
  noteMustMention: readonly RegExp[];
}> = [
  {
    needle: "Postgres GUC",
    why: "mechanism 3's key is read from Vault and its URL from public.system_settings; the app-GUC pattern was retired",
    noteMustMention: [/Vault/, /system_settings/],
  },
  {
    needle: "DB GUCs",
    why: "decision 2 says secrets live in DB GUCs; they live in Vault",
    noteMustMention: [/Vault/],
  },
  {
    needle: "Triggered by Mechanism 3",
    why: "nothing called /api/cron-sync until this phase",
    noteMustMention: [/cron-sync-trades/, /cron_sync_tick/],
  },
  {
    needle: "8 registered pg_cron jobs",
    why: "the live job count is the committed manifest, not a frozen figure",
    noteMustMention: [/scripts\/prod-prober\/cron-manifest\.json/],
  },
  {
    needle: "lines 297-688",
    why: "a line range for cron_sync rotted; cite the symbol",
    noteMustMention: [/`cron_sync`/, /symbol/],
  },
  {
    // Found by the path-resolves pin below, not by the research list: the Evidence
    // section cites a source file that Phase 106 deleted. It may stay as lineage.
    needle: "supabase/functions/compute-trigger/index.ts",
    why: "the file was removed in v0.42.1.0 (Phase 106); the evidence line cites a path that does not exist",
    noteMustMention: [/removed|deleted/, /v0\.42\.1\.0/],
  },
];

describe("ADR-0008 reads (guard the guard)", () => {
  it("is present, non-empty, and still carries the sections the pins below slice", () => {
    expect(existsSync(ADR_PATH)).toBe(true);
    const adr = readAdr();
    expect(adr.length).toBeGreaterThan(2000);
    for (const heading of ["## Status", "## Decision", "### Job inventory", "## Evidence"]) {
      expect(adr, `missing heading ${heading}`).toContain(heading);
    }
  });
});

describe("ADR-0008 job inventory names the daily trade-sync tick", () => {
  it("has a table row for cron-sync-trades at 10 0 * * * calling /api/cron-sync", () => {
    const adr = readAdr();
    const inventory = adr.slice(anchorIndex(adr, "### Job inventory"));
    const row = inventory
      .split("\n")
      .find((l) => l.startsWith("|") && l.includes("cron-sync-trades"));
    expect(row, "no inventory row mentions cron-sync-trades").toBeDefined();
    expect(row).toContain("10 0 * * *");
    expect(row).toContain("/api/cron-sync");
    expect(row).toMatch(/pg_cron/);
  });

  it("records the NAVMTM move beside the row: a dated note naming D-03 (the slot) and D-02 (every eligible strategy)", () => {
    // WHY. The schedule lives in PROD cron.job and the committed manifest, not in
    // code, so the only record of WHY the tick moved from 04:30Z to just after
    // 00:00Z is this note. A bare schedule edit would leave the ADR giving a
    // time with no reason and no pointer to the decision that changed it.
    const note = paragraphs(readAdr()).find(
      (p) =>
        /CHANGED \d{4}-\d{2}-\d{2}/.test(p) &&
        p.includes("cron-sync-trades") &&
        p.includes("D-03") &&
        p.includes("D-02"),
    );
    expect(note, "no dated CHANGED note names cron-sync-trades with D-03 and D-02").toBeDefined();
    expect(note).toMatch(/every eligible strategy/);
  });

  it("states the D-13 exclusions beside the row: what the tick does NOT read, and why", () => {
    const adr = readAdr();
    const note = paragraphs(adr)
      .flatMap(notesOf)
      .find((n) => n.includes("cron-sync-trades") && /eligible strategy/.test(n));
    expect(note, "no single dated note names cron-sync-trades with its eligibility rule").toBeDefined();
    // Each excluded class, with its reason attached rather than listed bare.
    expect(note).toMatch(/Disconnected keys:.*credentials remain/);
    expect(note).toMatch(/allocator-only keys:.*no strategy to store trades for/);
    expect(note).toMatch(/Revoked\s+allocator-only keys:.*never\s+deactivated/);
  });
});

describe("ADR-0008 false statements stand only beside a dated correction", () => {
  const paras = paragraphs(readAdr());

  it.each(FALSE_STATEMENTS)(
    "$needle: every paragraph holding it is, or is followed by, a dated note that says what is true",
    ({ needle, why, noteMustMention }) => {
      const hits = paras
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.includes(needle));
      // Absent is fine (the sentence may be rewritten away); present needs a fence.
      for (const { p, i } of hits) {
        const notes = [p, paras[i + 1] ?? ""].flatMap(notesOf);
        expect(
          notes.length,
          `"${needle}" stands with no CORRECTED <date> note in its paragraph or the next (${why})`,
        ).toBeGreaterThan(0);
        // ONE note must carry every required fact, so a neighbouring note cannot vouch for it.
        const sufficient = notes.some((n) => noteMustMention.every((must) => must.test(n)));
        expect(
          sufficient,
          `no single dated note beside "${needle}" mentions ${noteMustMention.join(" and ")} (${why})`,
        ).toBe(true);
      }
    },
  );

  it("the fence is real: no CORRECTED note is an empty marker (each says more than the marker)", () => {
    for (const p of paras.filter((c) => CORRECTED_RE.test(c))) {
      const stripped = p.replace(/CORRECTED \d{4}-\d{2}-\d{2}/g, "").replace(/[^A-Za-z]/g, "");
      expect(stripped.length, `bare CORRECTED marker: ${p.slice(0, 80)}`).toBeGreaterThan(80);
    }
  });
});

describe("ADR-0008 status", () => {
  it("names a current status and a dated note, not only 'Proposed'", () => {
    const adr = readAdr();
    const status = adr.slice(anchorIndex(adr, "## Status"), anchorIndex(adr, "## Context"));
    expect(status).toMatch(/\d{4}-\d{2}-\d{2}/);
    // The original line stays as lineage, so 'Proposed' may remain; it must not stand alone.
    expect(status).toMatch(/Accepted|Superseded|Amended|Implemented/);
    expect(status).toMatch(CORRECTED_RE);
  });
});

describe("ADR-0008 citations resolve", () => {
  it("cites the cron_sync route by a symbol that exists in the analytics router", () => {
    const adr = readAdr();
    const evidence = adr.slice(anchorIndex(adr, "## Evidence"));
    // The original line (with its rotted line range) stays as lineage, so there may
    // be two "Python cron" entries; one of them must cite the symbol and no range.
    const lines = evidence.split("\n");
    const entries: string[] = [];
    lines.forEach((l, i) => {
      if (!l.startsWith("- Python cron")) return;
      // An entry runs until the next bullet.
      let text = l;
      for (let j = i + 1; j < lines.length && !lines[j].startsWith("- "); j++) {
        text += ` ${lines[j].trim()}`;
      }
      entries.push(text);
    });
    expect(entries.length, "Python cron evidence missing").toBeGreaterThan(0);
    const bySymbol = entries.filter(
      (e) => e.includes("`cron_sync`") && !/lines? \d+-\d+/.test(e),
    );
    expect(bySymbol.length, "no Python cron entry cites cron_sync by symbol alone").toBeGreaterThan(0);
    const router = readFileSync(join(ROOT, "analytics-service", "routers", "cron.py"), "utf8");
    expect(router).toMatch(/^async def cron_sync\(/m);
  });

  it("every repo path the ADR cites in backticks resolves on disk (source directories only)", () => {
    const adr = readAdr();
    const cited = new Set<string>();
    for (const m of adr.matchAll(
      /`((?:docs|src|supabase|scripts|analytics-service)\/[A-Za-z0-9_./-]+?\.[A-Za-z]{1,4})`/g,
    )) {
      cited.add(m[1]);
    }
    expect(cited.size).toBeGreaterThan(5);
    // A path that is a fenced false statement above may be absent: it is lineage.
    const fenced = new Set(FALSE_STATEMENTS.map((f) => f.needle));
    const missing = [...cited].filter((p) => !fenced.has(p) && !existsSync(join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it("the tick it names is defined by exactly one migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) =>
      f.endsWith("_cron_sync_tick.sql"),
    );
    expect(migrations.length).toBe(1);
  });
});
