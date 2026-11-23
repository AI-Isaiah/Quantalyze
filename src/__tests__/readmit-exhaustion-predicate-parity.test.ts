import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 227 JOBLEDGER plan 04 (HEAL-03): the detector and the sweep must agree on who is
 * stranded.
 *
 * `public.record_reconcile_readmit_exhaustions()` writes a durable row for every strategy
 * the reconcile sweep WOULD readmit if it were not for its attempt ceiling. It does that by
 * carrying the sweep's own candidate predicate with ONE comparison inverted: the sweep keeps
 * strategies below the ceiling (`) < 3`), the detector keeps strategies at or above it
 * (`) >= 3`). If the two predicates drift apart, the page either fires for strategies the
 * sweep would still heal, or stays silent for strategies it has given up on. The SQL gate
 * measures the detector against the lane's sweep; this test pins the two TEXTS together so a
 * change to one side alone cannot ship.
 *
 * WHICH SIDE IS THE REFERENCE (DEC-04-E). The sweep's command is NOT edited by a migration
 * in this repository: registration is a marker-guarded runbook step (the Phase 164.7 rule), so
 * a future sweep change arrives as a runbook plus a re-capture of
 * scripts/prod-prober/cron-manifest.json, never as a migration. The PROD-captured manifest is
 * therefore the sweep's current text, and it is the side compared against, not
 * 20260819150000.
 *
 * WHAT IS COMPARED. The span from `WHERE s.status <> 'archived'` up to the first following
 * `ORDER BY`, with every whitespace run collapsed to one space. The detector's snapshot
 * (supabase/schema/functions/record_reconcile_readmit_exhaustions.sql, regenerated from the
 * migration by `npm run schema:functions`) is read, so the migration and its snapshot cannot
 * disagree either.
 */

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, "scripts", "prod-prober", "cron-manifest.json");
const SNAPSHOT_PATH = join(
  ROOT,
  "supabase",
  "schema",
  "functions",
  "record_reconcile_readmit_exhaustions.sql",
);
const SWEEP_JOBNAME = "reconcile_dropped_enqueue_sweep";
const WHERE_START = "WHERE s.status <> 'archived'";
const SWEEP_CEILING = ") < 3";
const DETECTOR_CEILING = ") >= 3";

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * The candidate-predicate span of one text, whitespace-collapsed. Throws a message naming
 * WHICH side could not be located, so a failure is diagnosed rather than guessed at.
 */
function extractWhereSpan(text: string, label: string): string {
  const start = text.indexOf(WHERE_START);
  if (start === -1) {
    throw new Error(
      `${label}: cannot locate the span start (${WHERE_START}), so the candidate predicate cannot be compared`,
    );
  }
  const end = text.indexOf("ORDER BY", start);
  if (end === -1) {
    throw new Error(
      `${label}: cannot locate the ORDER BY that ends the candidate predicate after ${WHERE_START}`,
    );
  }
  return collapse(text.slice(start, end));
}

/** The reconcile sweep's command out of a parsed manifest, or a message naming the miss. */
function sweepCommandFromManifest(manifest: unknown): string {
  const jobs = (manifest as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error(`cron manifest ${MANIFEST_PATH}: has no jobs array`);
  }
  const job = jobs.find(
    (j: { jobname?: unknown }) => j?.jobname === SWEEP_JOBNAME,
  ) as { command?: unknown } | undefined;
  if (!job) {
    throw new Error(
      `cron manifest: the job ${SWEEP_JOBNAME} is missing, so the detector has no sweep predicate to be compared with`,
    );
  }
  if (typeof job.command !== "string" || job.command.length === 0) {
    throw new Error(`cron manifest: the job ${SWEEP_JOBNAME} carries no command text`);
  }
  return job.command;
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function loadManifestSpan(): string {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`cron manifest ${MANIFEST_PATH} is missing`);
  }
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  return extractWhereSpan(
    sweepCommandFromManifest(manifest),
    `cron manifest job ${SWEEP_JOBNAME}`,
  );
}

function loadSnapshotSpan(): string {
  if (!existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `detector snapshot ${SNAPSHOT_PATH} is missing; run npm run schema:functions after adding the migration`,
    );
  }
  return extractWhereSpan(
    readFileSync(SNAPSHOT_PATH, "utf8"),
    "detector snapshot record_reconcile_readmit_exhaustions.sql",
  );
}

describe("readmit exhaustion detector predicate parity (HEAL-03)", () => {
  it("the sweep's PROD-captured predicate carries exactly one ceiling comparison", () => {
    const span = loadManifestSpan();
    expect(
      countOf(span, SWEEP_CEILING),
      `the sweep's WHERE span must contain exactly one "${SWEEP_CEILING}"; the detector inverts that one comparison, so zero means the ceiling moved and many means the inversion is ambiguous`,
    ).toBe(1);
  });

  it("the detector's predicate is the sweep's with only the ceiling comparison inverted", () => {
    const sweepSpan = loadManifestSpan();
    const detectorSpan = loadSnapshotSpan();
    expect(
      countOf(detectorSpan, DETECTOR_CEILING),
      `the detector's WHERE span must contain exactly one "${DETECTOR_CEILING}"`,
    ).toBe(1);
    expect(detectorSpan).toBe(
      sweepSpan.replace(SWEEP_CEILING, DETECTOR_CEILING),
    );
  });

  it("names which side is missing or unreadable instead of passing", () => {
    expect(() => sweepCommandFromManifest({ jobs: [] })).toThrow(
      new RegExp(`${SWEEP_JOBNAME} is missing`),
    );
    expect(() => sweepCommandFromManifest({})).toThrow(/no jobs array/);
    expect(() => extractWhereSpan("SELECT 1", "snapshot X")).toThrow(
      /snapshot X: cannot locate the span start/,
    );
    expect(() =>
      extractWhereSpan(`${WHERE_START} AND true`, "snapshot Y"),
    ).toThrow(/snapshot Y: cannot locate the ORDER BY/);
  });

  it("collapses whitespace so layout never decides the comparison", () => {
    const a = extractWhereSpan(`${WHERE_START}\n  AND   x = 1\nORDER BY y`, "a");
    const b = extractWhereSpan(`${WHERE_START} AND x = 1 ORDER BY z`, "b");
    expect(a).toBe(b);
  });
});
