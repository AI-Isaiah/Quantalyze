import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TINY_BASE_DAYS_FLAG, TINY_BASE_PERCENT, TINY_BASE_WINDOW_DAYS } from "@/lib/tiny-base-flag";

/**
 * Phase 188 (TINYBASE) plan 06, D-02 and D-03 - the stored key and the threshold,
 * one literal in two languages.
 *
 * A day measured against a near-empty account is left out of the returns, and the
 * Python worker names it in `tiny_base_days` (`job_worker.py` writes it into the
 * key's `key_inputs` payload and into the strategy's pre-stamped
 * `data_quality_flags`; `analytics_runner.py` carries it into the published flags).
 * The TypeScript readers look the list up under `TINY_BASE_DAYS_FLAG` and print the
 * threshold from `TINY_BASE_PERCENT` and `TINY_BASE_WINDOW_DAYS`. If the two sides
 * ever disagree the write still succeeds and the reader finds nothing, so the note
 * that discloses a left-out day silently disappears, or it prints a threshold the
 * rule does not apply. Either is a false or a missing disclosure with no error.
 *
 * Every Python file is read RAW from disk. Each read is asserted non-empty AND to
 * carry its own anchor, so a moved or emptied file fails here instead of letting two
 * `undefined`s compare equal. The expected values are also written out once below
 * as independent literals: neither side can drift together with the other and stay
 * green.
 */

const PINNED_KEY = "tiny_base_days";
const PINNED_PERCENT = 5;
const PINNED_WINDOW_DAYS = 30;

const root = process.cwd();
const workerPath = join(root, "analytics-service", "services", "job_worker.py");
const runnerPath = join(root, "analytics-service", "services", "analytics_runner.py");
const rulePath = join(root, "analytics-service", "services", "tiny_base.py");
const readerPath = join(root, "src", "lib", "tiny-base-flag.ts");

function read(path: string): string {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("188 D-02 - every file the pin reads is present and carries its own anchor", () => {
  it("reads all four files non-empty, each carrying its own anchor", () => {
    const worker = read(workerPath);
    const runner = read(runnerPath);
    const rule = read(rulePath);
    const reader = read(readerPath);
    for (const text of [worker, runner, rule, reader]) expect(text.length).toBeGreaterThan(0);
    expect(worker).toContain("run_derive_broker_dailies_job");
    expect(runner).toContain("class DataQualityFlags");
    expect(rule).toContain("def tiny_base_day_list");
    expect(reader).toContain("TINY_BASE_WINDOW_DAYS");
  });
});

describe("188 D-02 - the tiny_base_days key is the same literal in the writer, the runner and the reader", () => {
  it("the key-mode derive stores the list under the pinned key, from the listed days", () => {
    const match = /_key_inputs_payload\["([^"]+)"\]\s*=\s*_tiny_listed\b/.exec(read(workerPath));
    expect(
      match,
      'no `_key_inputs_payload["..."] = _tiny_listed` in job_worker.py (the key-mode write moved or was renamed)',
    ).not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the strategy pre-stamp stores the list under the pinned key, from the listed days", () => {
    const match = /_prestamp_flags\["([^"]+)"\]\s*=\s*_tiny_listed_days\b/.exec(read(workerPath));
    expect(
      match,
      'no `_prestamp_flags["..."] = _tiny_listed_days` in job_worker.py (the strategy write moved or was renamed)',
    ).not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the runner transports the list under the pinned key (its day-list tuple)", () => {
    const match = /^_NAVMTM_DAY_LIST_KEYS\s*=\s*\(([^)]*)\)/m.exec(read(runnerPath));
    expect(match, "no `_NAVMTM_DAY_LIST_KEYS = (...)` line in analytics_runner.py").not.toBeNull();
    const keys = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toContain(PINNED_KEY);
  });

  it("the runner declares the list on the published flags under the pinned key", () => {
    expect(read(runnerPath)).toMatch(new RegExp(`^    ${PINNED_KEY}: list\\[str\\]$`, "m"));
  });

  it("the reader's exported key literal is the pinned key", () => {
    const match = /export\s+const\s+TINY_BASE_DAYS_FLAG\s*=\s*"([^"]*)"/.exec(read(readerPath));
    expect(match, 'no `export const TINY_BASE_DAYS_FLAG = "..."` in tiny-base-flag.ts').not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the imported constant equals the independent literal", () => {
    expect(TINY_BASE_DAYS_FLAG).toBe(PINNED_KEY);
  });
});

describe("188 D-03 - the threshold is the same number in the rule's one home and the reader", () => {
  it("the rule's fraction, parsed from the raw Python source, is the pinned percent over 100", () => {
    const match = /^TINY_BASE_FRACTION:\s*Final\[float\]\s*=\s*([0-9.]+)\s*$/m.exec(read(rulePath));
    expect(match, "no `TINY_BASE_FRACTION: Final[float] = <number>` line in tiny_base.py").not.toBeNull();
    expect(Number(match![1]) * 100).toBeCloseTo(PINNED_PERCENT, 9);
  });

  it("the rule's window, parsed from the raw Python source, is the pinned number of days", () => {
    const match = /^TINY_BASE_WINDOW_DAYS:\s*Final\[int\]\s*=\s*([0-9]+)\s*$/m.exec(read(rulePath));
    expect(match, "no `TINY_BASE_WINDOW_DAYS: Final[int] = <number>` line in tiny_base.py").not.toBeNull();
    expect(Number(match![1])).toBe(PINNED_WINDOW_DAYS);
  });

  it("the reader's percent equals the Python fraction times 100, parsed from the raw source", () => {
    const match = /^TINY_BASE_FRACTION:\s*Final\[float\]\s*=\s*([0-9.]+)\s*$/m.exec(read(rulePath));
    expect(match).not.toBeNull();
    expect(TINY_BASE_PERCENT).toBeCloseTo(Number(match![1]) * 100, 9);
  });

  it("the reader's exported literals are the pinned threshold", () => {
    const reader = read(readerPath);
    const percent = /export\s+const\s+TINY_BASE_PERCENT\s*=\s*([0-9.]+)\s*;/.exec(reader);
    const window = /export\s+const\s+TINY_BASE_WINDOW_DAYS\s*=\s*([0-9]+)\s*;/.exec(reader);
    expect(percent, "no `export const TINY_BASE_PERCENT = <number>;` in tiny-base-flag.ts").not.toBeNull();
    expect(window, "no `export const TINY_BASE_WINDOW_DAYS = <number>;` in tiny-base-flag.ts").not.toBeNull();
    expect(Number(percent![1])).toBe(PINNED_PERCENT);
    expect(Number(window![1])).toBe(PINNED_WINDOW_DAYS);
  });

  it("the imported constants equal the independent literals", () => {
    expect(TINY_BASE_PERCENT).toBe(PINNED_PERCENT);
    expect(TINY_BASE_WINDOW_DAYS).toBe(PINNED_WINDOW_DAYS);
  });
});
