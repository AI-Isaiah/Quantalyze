import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 167.1.2.1.1 WRITERRESIDUALS plan 02 (decision D-03): the reader's verdict
 * on the book the allocator equity derive can no longer vouch for, asserted
 * against ONE table the Python derive also reads.
 *
 * WHY. The derive raises a blocking token (`failing_key_series_ended`,
 * `account_identity_pending`) and `untrustworthyRebuildReason` /
 * `equityHistoryReadiness` map it onto a line the owner already sees. If the two
 * halves drift, a diluted book reads "ready" or a healthy one reads "rebuilding"
 * and each suite stays green on its own side. The table lives in
 * analytics-service/tests/fixtures/writer_residual_resolution.json; the Python half
 * (analytics-service/tests/test_writer_residual_parity.py) runs the derive over
 * every cell and asserts the blocking tokens, this file feeds the SAME tokens and
 * key list to the reader and asserts what it shows. The fixture is loaded in place,
 * never copied (the idiom of holder-matrix-parity.test.ts).
 */

// queries.ts pulls in @/lib/audit, which imports "server-only", which throws
// under vitest+jsdom. Mock it the same way the sibling queries tests do.
vi.mock("server-only", () => ({}));

import { derivePhase07Fields } from "../queries";

type CellKey = {
  id: string;
  exchange: string;
  sync_status: string | null;
  venue_account_id: string | null;
  account_share_kind?: string | null;
  account_shared_with_api_key_id?: string | null;
};

type Cell = {
  id: string;
  sc: string;
  keys: CellKey[];
  derive: { blocking_tokens: string[]; trustworthy: boolean };
  reader: { state: "ready" | "rebuilding"; reason: string | null };
};

type Table = { cells: Cell[] };

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/writer_residual_resolution.json",
);
const TABLE: Table = JSON.parse(readFileSync(FIXTURE, "utf8"));

const apiKeys = (cell: Cell) =>
  cell.keys.map((key) => ({
    id: key.id,
    is_active: true,
    exchange: key.exchange,
    sync_status: key.sync_status,
    last_sync_at: null,
    disconnected_at: null,
    venue_account_id: key.venue_account_id,
    account_share_kind: key.account_share_kind ?? null,
    account_shared_with_api_key_id: key.account_shared_with_api_key_id ?? null,
  }));

/** The row the derive leaves for this cell: a trustworthy v2 curve, or an untrustworthy one naming its tokens. */
const payloadFor = (cell: Cell) => ({
  version: 2,
  is_trustworthy: cell.derive.trustworthy,
  curve: cell.derive.trustworthy ? [{ date: "2026-06-05", equity_usd: 100_000 }] : [],
  returns: cell.derive.trustworthy ? [{ date: "2026-06-05", r: 0 }] : [],
  flags: [],
  degrade_reasons: cell.derive.blocking_tokens,
});

describe("writer residual parity: the reader against the shared table", () => {
  it("the cells are unique", () => {
    const ids = TABLE.cells.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TABLE.cells.map((cell) => [cell.id, cell] as const))(
    "%s -> the reader shows the cell's verdict",
    (_id, cell) => {
      const result = derivePhase07Fields(apiKeys(cell), [], {
        payload: payloadFor(cell),
        computed_at: "2026-06-05T00:00:00+00:00",
      });
      expect({
        state: result.equityHistoryState,
        reason: result.equityHistoryRebuildReason,
      }).toEqual(cell.reader);
    },
  );
});
