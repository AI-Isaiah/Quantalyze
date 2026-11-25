/**
 * Phase 240 / RLIM-02 — cross-LANGUAGE agreement between the edge CSV limits
 * (src/lib/ratelimit.ts) and the CSV-scoped upstream tier
 * (analytics-service/routers/process_key.py `_PROCESS_KEY_CSV_LIMIT`).
 *
 * The defect this closes: the edge number was justified in prose against an
 * upstream cap that stopped being the one in force, and nothing could notice.
 * One side retuned alone is exactly the drift this file turns red.
 *
 * The 3x relation is the founder-accepted derivation: Upstash's sliding window
 * can admit up to two edge buckets' worth inside one exact 60 s span, plus one
 * more for latency between the edge check and the upstream hit. It is a
 * reading of the documented algorithm, not a measurement, and is not claimed
 * to be airtight.
 *
 * ⚠️ ZERO module mocks. The two source files are read as text, the expected
 * numbers are hand-typed here, and neither side's expectations are read out of
 * the other's implementation. Every parse asserts a match BEFORE comparing, so
 * a regex that matches nothing fails instead of passing vacuously.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RATELIMIT_TS = readFileSync(
  resolve(process.cwd(), "src/lib/ratelimit.ts"),
  "utf8",
);
const PROCESS_KEY_PY = readFileSync(
  resolve(process.cwd(), "analytics-service/routers/process_key.py"),
  "utf8",
);

// Hand-typed expectations (never derived from the files under test).
const EXPECTED_EDGE_REQUESTS = 20;
const EXPECTED_EDGE_WINDOW_SECONDS = 60;
const EXPECTED_UPSTREAM_PER_MINUTE = 60;
const EXPECTED_UPSTREAM_UNIT = "minute";
const REQUIRED_HEADROOM = 3;

// The two phrases the docblock must never carry again (typed here as the
// literals to forbid).
const STALE_UPSTREAM_CAP_PHRASE = "30/hour cap";
const SHARED_BUCKET_PHRASE = "rides the same dedicated bucket";

function edgeLimiter(name: string): { requests: number; windowSeconds: number } {
  const m = new RegExp(
    `export const ${name} = makeLimiter\\((\\d+), "(\\d+) s"\\);`,
  ).exec(RATELIMIT_TS);
  expect(m, `${name} makeLimiter call not found in src/lib/ratelimit.ts`).not.toBeNull();
  return { requests: Number(m![1]), windowSeconds: Number(m![2]) };
}

function upstreamCsvLimit(): { count: number; unit: string } {
  const m = /^_PROCESS_KEY_CSV_LIMIT\s*=\s*"(\d+)\/(\w+)"/m.exec(PROCESS_KEY_PY);
  expect(
    m,
    "_PROCESS_KEY_CSV_LIMIT literal not found in routers/process_key.py",
  ).not.toBeNull();
  return { count: Number(m![1]), unit: m![2] };
}

/** The contiguous `//` comment lines directly above `export const csvValidateLimiter`. */
function csvValidateDocblock(): string {
  const lines = RATELIMIT_TS.split("\n");
  const at = lines.findIndex((l) =>
    l.startsWith("export const csvValidateLimiter"),
  );
  expect(at, "csvValidateLimiter declaration not found").toBeGreaterThan(0);
  const block: string[] = [];
  for (let i = at - 1; i >= 0 && lines[i].trimStart().startsWith("//"); i--) {
    block.unshift(lines[i]);
  }
  expect(block.length, "no comment block above csvValidateLimiter").toBeGreaterThan(0);
  return block.join("\n");
}

describe("RLIM-02 edge and upstream CSV limits agree across languages", () => {
  it("csvValidateLimiter is 20 per 60 s at the edge", () => {
    expect(edgeLimiter("csvValidateLimiter")).toEqual({
      requests: EXPECTED_EDGE_REQUESTS,
      windowSeconds: EXPECTED_EDGE_WINDOW_SECONDS,
    });
  });

  it("csvFinalizeLimiter is 20 per 60 s at the edge", () => {
    expect(edgeLimiter("csvFinalizeLimiter")).toEqual({
      requests: EXPECTED_EDGE_REQUESTS,
      windowSeconds: EXPECTED_EDGE_WINDOW_SECONDS,
    });
  });

  it("_PROCESS_KEY_CSV_LIMIT is 60/minute upstream", () => {
    expect(upstreamCsvLimit()).toEqual({
      count: EXPECTED_UPSTREAM_PER_MINUTE,
      unit: EXPECTED_UPSTREAM_UNIT,
    });
  });

  it("the relation: both edge windows are 60 s, upstream is per minute, and upstream carries at least 3x the edge cap", () => {
    const validate = edgeLimiter("csvValidateLimiter");
    const finalize = edgeLimiter("csvFinalizeLimiter");
    const upstream = upstreamCsvLimit();

    // The relation compares a per-60 s edge number to a per-minute upstream
    // number, which is only meaningful while the units agree.
    expect(validate.windowSeconds).toBe(60);
    expect(finalize.windowSeconds).toBe(60);
    expect(upstream.unit).toBe("minute");
    expect(upstream.count).toBeGreaterThanOrEqual(
      REQUIRED_HEADROOM * validate.requests,
    );
  });

  it("the docblock above csvValidateLimiter cites the real upstream cap and neither stale claim", () => {
    const block = csvValidateDocblock();
    expect(block).toContain("_PROCESS_KEY_CSV_LIMIT");
    expect(block).not.toContain(STALE_UPSTREAM_CAP_PHRASE);
    expect(block).not.toContain(SHARED_BUCKET_PHRASE);
  });
});
