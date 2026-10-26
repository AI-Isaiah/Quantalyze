import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKS_SINCE_FLAG, MARKS_TRAILING_SINCE_FLAG } from "@/lib/nav-marks-start";

/**
 * Phase 167.2.1.1.1 NAVMTM plan 10, D-12 and L2 - the one published key two
 * languages share.
 *
 * The Python compute writes the day recorded equity begins into
 * `strategy_analytics.data_quality_flags` under the key `marks_since`
 * (`analytics_runner.py` on the strategy compute, `job_worker.py` in the derive's
 * pre-stamp of the same flags). The TypeScript reader (`parseMarksStart`, called
 * with `MARKS_SINCE_FLAG` from `fetch-and-build-payload.ts`) looks the day up
 * under that same key. If the two ever disagree the write still succeeds, the
 * reader finds nothing, and every factsheet silently stops naming where
 * recorded equity begins: an honesty claim lost with no error.
 *
 * All three files are read RAW from disk. Each read is asserted non-empty AND to
 * carry its own anchor, so a moved or emptied file fails here instead of letting
 * two `undefined`s compare equal. The expected key is also written out once
 * below as an independent literal: no side can drift together with another and
 * stay green.
 */

const PINNED_KEY = "marks_since";

const root = process.cwd();
const runnerPath = join(root, "analytics-service", "services", "analytics_runner.py");
const workerPath = join(root, "analytics-service", "services", "job_worker.py");
const readerPath = join(root, "src", "lib", "nav-marks-start.ts");

function read(path: string): string {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("D-12 - the marks_since key is the same literal in the writer and the reader", () => {
  it("reads all three files non-empty, each carrying its own anchor", () => {
    const runner = read(runnerPath);
    const worker = read(workerPath);
    const reader = read(readerPath);
    expect(runner.length).toBeGreaterThan(0);
    expect(worker.length).toBeGreaterThan(0);
    expect(reader.length).toBeGreaterThan(0);
    expect(runner).toContain("run_csv_strategy_analytics");
    expect(worker).toContain("run_derive_broker_dailies_job");
    expect(reader).toContain("parseMarksStart");
  });

  it("the strategy compute writes the published flag under the pinned key", () => {
    const match = /data_quality_flags\["([^"]+)"\]\s*=\s*_navmtm\.marks_since\b/.exec(read(runnerPath));
    expect(match, 'no `data_quality_flags["..."] = _navmtm.marks_since` in analytics_runner.py').not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the derive pre-stamps the same flag under the pinned key", () => {
    const match = /_prestamp_flags\["([^"]+)"\]\s*=\s*_applied_marks\.marks_since\b/.exec(read(workerPath));
    expect(match, 'no `_prestamp_flags["..."] = _applied_marks.marks_since` in job_worker.py').not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the reader's exported key literal is the pinned key", () => {
    const match = /export\s+const\s+MARKS_SINCE_FLAG\s*=\s*"([^"]*)"/.exec(read(readerPath));
    expect(match, 'no `export const MARKS_SINCE_FLAG = "..."` in nav-marks-start.ts').not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the imported constant equals the independent literal", () => {
    expect(MARKS_SINCE_FLAG).toBe(PINNED_KEY);
  });
});

// SFH-2 N1: the sibling key. The strategy compute and the derive's pre-stamp
// write `marks_trailing_since` (the first day without a mark once marks stop
// updating); the reader looks it up under the same literal.
const PINNED_TRAILING_KEY = "marks_trailing_since";

describe("SFH-2 N1 - the marks_trailing_since key is the same literal in the writer and the reader", () => {
  it("the strategy compute writes the published flag under the pinned key", () => {
    const match = /data_quality_flags\["([^"]+)"\]\s*=\s*_navmtm\.marks_trailing_since\b/.exec(read(runnerPath));
    expect(match, 'no `data_quality_flags["..."] = _navmtm.marks_trailing_since` in analytics_runner.py').not.toBeNull();
    expect(match![1]).toBe(PINNED_TRAILING_KEY);
  });

  it("the derive pre-stamps the same flag under the pinned key", () => {
    const match = /_prestamp_flags\["([^"]+)"\]\s*=\s*_marks_trailing_since\b/.exec(read(workerPath));
    expect(match, 'no `_prestamp_flags["..."] = _marks_trailing_since` in job_worker.py').not.toBeNull();
    expect(match![1]).toBe(PINNED_TRAILING_KEY);
  });

  it("the reader's exported key literal is the pinned key", () => {
    const match = /export\s+const\s+MARKS_TRAILING_SINCE_FLAG\s*=\s*"([^"]*)"/.exec(read(readerPath));
    expect(match, 'no `export const MARKS_TRAILING_SINCE_FLAG = "..."` in nav-marks-start.ts').not.toBeNull();
    expect(match![1]).toBe(PINNED_TRAILING_KEY);
  });

  it("the imported constant equals the independent literal", () => {
    expect(MARKS_TRAILING_SINCE_FLAG).toBe(PINNED_TRAILING_KEY);
  });
});
