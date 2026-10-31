import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 167.1.2.1.1 WRITERRESIDUALS, SC-1 (decision D-04): the reader's verdict
 * on the REFUSAL row the allocator equity derive now persists, asserted against
 * ONE table the Python writer and the SQL census mirror also read.
 *
 * WHY. A derive refusal used to delete the (allocator_id, 'equity_curve') row,
 * and the reader then said the history is "recomputed daily" for a book the
 * derive refuses every day. The refusal now persists its token in the same row
 * (version 2, is_trustworthy false, curve [], returns []), and
 * `untrustworthyRebuildReason` maps each token onto a line the owner already
 * has. No new copy exists for any of them. The truth table lives in
 * analytics-service/tests/fixtures/derive_refusal_rows.json; the Python half
 * (analytics-service/tests/test_derive_refusal_rows.py) asserts the payload the
 * worker builds, this file asserts what the reader shows, and
 * src/__tests__/accounttruth-census.test.ts asserts the census CASE. Either side
 * drifting reddens CI. The fixture is loaded in place, never copied (the
 * cross-package idiom of holder-matrix-parity.test.ts).
 */

// queries.ts pulls in @/lib/audit, which imports "server-only" — that throws
// under vitest+jsdom. Mock it the same way the sibling queries tests do.
vi.mock("server-only", () => ({}));

import { derivePhase07Fields } from "../queries";

type RefusalRow = {
  token: string;
  extra_reasons: string[];
  reader_reason: string;
  payload: Record<string, unknown>;
};

type Table = {
  composed_at: string;
  refusals: RefusalRow[];
  blocking: { token: string; reader_reason: string }[];
  precedence: { degrade_reasons: string[]; reader_reason: string }[];
};

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/derive_refusal_rows.json",
);
const TABLE: Table = JSON.parse(readFileSync(FIXTURE, "utf8"));

/** The reader's whole verdict on one stored row, with no keys in the way. */
const readRow = (payload: unknown) =>
  derivePhase07Fields([], [], {
    payload,
    computed_at: TABLE.composed_at,
  });

describe("derive refusal rows: the reader names a line it already has", () => {
  it.each(TABLE.refusals.map((r) => [r.token, r] as const))(
    "%s -> its fixture reader_reason, and never a curve",
    (_token, row) => {
      const result = readRow(row.payload);
      expect(result.equityHistoryState).toBe("rebuilding");
      expect(result.equityHistoryRebuildReason).toBe(row.reader_reason);
      expect(result.equityDailyPoints).toEqual([]);
      expect(result.equityDailyReturns).toEqual([]);
      expect(result.equityCurveSource).toBe("legacy");
      expect(result.derivedCurveComputedAt).toBeNull();
    },
  );
});

/** An untrustworthy v2 row carrying exactly these tokens (the writer's own shape). */
const untrusted = (degrade_reasons: string[]) => ({
  ...TABLE.refusals[0].payload,
  degrade_reasons,
});

describe("every blocking DegradeReason keeps its line, and a wait token is a wait only alone", () => {
  it.each(TABLE.blocking.map((b) => [b.token, b] as const))(
    "%s -> its fixture reader_reason",
    (_token, row) => {
      expect(readRow(untrusted([row.token])).equityHistoryRebuildReason).toBe(row.reader_reason);
    },
  );

  it.each(TABLE.precedence.map((p) => [p.degrade_reasons.join(" + "), p] as const))(
    "%s -> its fixture reader_reason, whatever the array order",
    (_name, row) => {
      const want = row.reader_reason;
      expect(readRow(untrusted(row.degrade_reasons)).equityHistoryRebuildReason).toBe(want);
      // The writer sorts the tokens, so array order must never decide.
      expect(readRow(untrusted([...row.degrade_reasons].reverse())).equityHistoryRebuildReason).toBe(
        want,
      );
    },
  );
});

describe("a refusal row can never render as a curve: each guard holds on its own", () => {
  const refusal = TABLE.refusals[0].payload;
  const onePoint = [{ date: "2026-03-10", equity_usd: 100 }];
  const oneReturn = [{ date: "2026-03-10", r: 0.01 }];
  const noSeries = (payload: unknown) => {
    const result = readRow(payload);
    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityDailyPoints).toEqual([]);
    expect(result.equityDailyReturns).toEqual([]);
    expect(result.equityCurveSource).toBe("legacy");
    expect(result.derivedCurveComputedAt).toBeNull();
  };

  it("is_trustworthy false alone blocks it, even with a well-formed curve and returns", () => {
    noSeries({ ...refusal, curve: onePoint, returns: oneReturn });
  });

  it("an empty curve alone blocks it, even with is_trustworthy true", () => {
    noSeries({ ...refusal, is_trustworthy: true, returns: oneReturn });
  });

  it("version 2 alone is not enough: the flipped row with an empty curve still reads as rejected", () => {
    const result = readRow({ ...refusal, is_trustworthy: true });
    expect(result.equityDailyPoints).toEqual([]);
    expect(result.equityHistoryRebuildReason).toBe("derivation_rejected");
  });
});
