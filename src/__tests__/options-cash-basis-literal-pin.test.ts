import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OPTIONS_ACTIVITY_FLAG, OPTIONS_CASH_BASIS_FLAG } from "@/lib/options-cash-basis-flag";

/**
 * Phase 185 (DERIBITFLOWTIME) plan 04, SC-3 and D-04 - the one stored key two
 * languages share.
 *
 * A Deribit allocator book values open options at cash today, so a key-mode
 * derive whose ledger has option activity writes `options_cash_basis: true`
 * into the key's `key_inputs` payload (`job_worker.py`,
 * `_run_key_mode_compose_epilogue`). The TypeScript reader looks the flag up
 * under `OPTIONS_CASH_BASIS_FLAG`. If the two ever disagree the write still
 * succeeds, the reader finds nothing, and the allocator book silently loses its
 * caveat: an honesty claim lost with no error.
 *
 * Both files are read RAW from disk. Each read is asserted non-empty AND to
 * carry its own anchor, so a moved or emptied file fails here instead of letting
 * two `undefined`s compare equal. The expected key is also written out once
 * below as an independent literal: neither side can drift together with the
 * other and stay green.
 */

const PINNED_KEY = "options_cash_basis";

const root = process.cwd();
const workerPath = join(root, "analytics-service", "services", "job_worker.py");
const readerPath = join(root, "src", "lib", "options-cash-basis-flag.ts");
const queriesPath = join(root, "src", "lib", "queries.ts");
const builderPath = join(root, "src", "lib", "factsheet", "allocator-portfolio-payload.ts");

function read(path: string): string {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("185 SC-3 - the options_cash_basis key is the same literal in the writer and the reader", () => {
  it("reads both files non-empty, each carrying its own anchor", () => {
    const worker = read(workerPath);
    const reader = read(readerPath);
    expect(worker.length).toBeGreaterThan(0);
    expect(reader.length).toBeGreaterThan(0);
    expect(worker).toContain("run_derive_broker_dailies_job");
    expect(reader).toContain("isOptionsCashBasis");
  });

  it("the derive writes the flag under the pinned key", () => {
    const match = /if _options_cash_basis_caveat is True:\s*\n\s*_key_inputs_payload\["([^"]+)"\]\s*=\s*True/.exec(
      read(workerPath),
    );
    expect(
      match,
      'no `if _options_cash_basis_caveat is True: _key_inputs_payload["..."] = True` in job_worker.py',
    ).not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the reader's exported key literal is the pinned key", () => {
    const match = /export\s+const\s+OPTIONS_CASH_BASIS_FLAG\s*=\s*"([^"]*)"/.exec(read(readerPath));
    expect(match, 'no `export const OPTIONS_CASH_BASIS_FLAG = "..."` in options-cash-basis-flag.ts').not.toBeNull();
    expect(match![1]).toBe(PINNED_KEY);
  });

  it("the imported constant equals the independent literal", () => {
    expect(OPTIONS_CASH_BASIS_FLAG).toBe(PINNED_KEY);
  });
});

// Plan 185-05: the two TS hops that carry the stored flag to the rendered sentence.
// A reader that looks the key up under a retyped literal, or a builder that parses the
// meta with a loose truthiness check, loses or invents the caveat with no error.
describe("185 SC-3 - the reader hops use the shared key and the strict parse", () => {
  it("the dashboard read looks the flag up through the exported constant, parsed strictly", () => {
    const queries = read(queriesPath);
    expect(queries).toContain("readMarksStart");
    expect(queries).toMatch(/isOptionsCashBasis\(\s*payload\?\.\[OPTIONS_CASH_BASIS_FLAG\]\s*\)/);
  });

  it("the allocator builder parses the meta field with the strict reader", () => {
    const builder = read(builderPath);
    expect(builder).toContain("buildAllocatorPortfolioFactsheetPayload");
    expect(builder).toMatch(/isOptionsCashBasis\(meta\.optionsCashBasis\)/);
  });
});

// 185 WR-03 / D-13: the second stored key. The writer stamps `options_activity` on every Deribit
// key-mode row; the reader raises the caveat for a drawn Deribit key whose row lacks a boolean
// under it. A retyped literal on either side makes every Deribit key look unclassified (a false
// caveat on every book) or classified-by-nothing (the fail-open gap back), with no error.
describe("185 WR-03 - the options_activity key is the same literal in the writer and the reader", () => {
  const PINNED_ACTIVITY_KEY = "options_activity";

  it("the derive stamps the key under the pinned literal, from the activity bool", () => {
    const match = /if _options_activity is not None:\s*\n\s*_key_inputs_payload\["([^"]+)"\]\s*=\s*_options_activity/.exec(
      read(workerPath),
    );
    expect(
      match,
      'no `if _options_activity is not None: _key_inputs_payload["..."] = _options_activity` in job_worker.py',
    ).not.toBeNull();
    expect(match![1]).toBe(PINNED_ACTIVITY_KEY);
  });

  it("the reader's exported key literal is the pinned key", () => {
    const match = /export\s+const\s+OPTIONS_ACTIVITY_FLAG\s*=\s*"([^"]*)"/.exec(read(readerPath));
    expect(match, 'no `export const OPTIONS_ACTIVITY_FLAG = "..."` in options-cash-basis-flag.ts').not.toBeNull();
    expect(match![1]).toBe(PINNED_ACTIVITY_KEY);
    expect(OPTIONS_ACTIVITY_FLAG).toBe(PINNED_ACTIVITY_KEY);
  });

  it("the dashboard read looks the stamp up through the exported constant, as a boolean", () => {
    expect(read(queriesPath)).toMatch(/typeof payload\?\.\[OPTIONS_ACTIVITY_FLAG\]\s*===\s*"boolean"/);
  });
});
