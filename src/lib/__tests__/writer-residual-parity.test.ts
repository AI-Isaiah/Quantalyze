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

import { derivePhase07Fields, readFailingKeyExits, FAILING_KEY_EXITED_FLAG } from "../queries";

type CellKey = {
  id: string;
  exchange: string;
  sync_status: string | null;
  venue_account_id: string | null;
  account_share_kind?: string | null;
  account_shared_with_api_key_id?: string | null;
  // Phase 186: the Python runner seeds these; the reader never sees them.
  read_incomplete?: boolean;
  inputs?: boolean;
};

type FailingKeyExit = {
  api_key_id: string;
  reason: "sync_failing" | "read_incomplete";
  day: string | null;
};

type Cell = {
  id: string;
  sc: string;
  keys: CellKey[];
  derive: {
    blocking_tokens: string[];
    trustworthy: boolean;
    failing_key_exits?: FailingKeyExit[];
  };
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
  flags: cell.derive.failing_key_exits?.length ? [FAILING_KEY_EXITED_FLAG] : [],
  degrade_reasons: cell.derive.blocking_tokens,
  ...(cell.derive.failing_key_exits?.length
    ? { failing_key_exits: cell.derive.failing_key_exits }
    : {}),
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

/**
 * Phase 186 (SC-4, D-03): the reader names exactly the exits the writer records.
 * The Python twin asserts the payload's `failing_key_exits` equals the cell's;
 * this half feeds that list to `readFailingKeyExits` and asserts one named entry
 * per expected exit, so a writer that records an exit the reader drops (or the
 * reverse) reddens CI on one side.
 */
describe("writer residual parity: the reader names the exits the writer records", () => {
  const withExits = TABLE.cells.filter((c) => c.derive.failing_key_exits?.length);
  const withoutExits = TABLE.cells.filter((c) => !c.derive.failing_key_exits?.length);

  it("the table holds an exit with a dated day and one with day null (a fixture that lost either would pass on nothing)", () => {
    const exits = withExits.flatMap((c) => c.derive.failing_key_exits ?? []);
    expect(exits.some((e) => e.day !== null)).toBe(true);
    expect(exits.some((e) => e.day === null)).toBe(true);
    expect(exits.some((e) => e.reason === "sync_failing")).toBe(true);
    expect(exits.some((e) => e.reason === "read_incomplete")).toBe(true);
    expect(withoutExits.length).toBeGreaterThanOrEqual(1);
  });

  it.each(withExits.map((cell) => [cell.id, cell] as const))(
    "%s -> one named entry per recorded exit, same key, reason and day",
    (_id, cell) => {
      const payload = payloadFor(cell);
      expect(payload.flags).toContain(FAILING_KEY_EXITED_FLAG);
      const named = readFailingKeyExits(payload.flags, payload, apiKeys(cell));
      const want = cell.derive.failing_key_exits ?? [];
      expect(named.map((n) => ({ api_key_id: n.apiKeyId, reason: n.reason, day: n.day }))).toEqual(
        [...want].sort((a, b) => a.api_key_id.localeCompare(b.api_key_id)),
      );
    },
  );

  it.each(withoutExits.map((cell) => [cell.id, cell] as const))(
    "%s -> no failing_key_exited flag and nothing named",
    (_id, cell) => {
      const payload = payloadFor(cell);
      expect(payload.flags).not.toContain(FAILING_KEY_EXITED_FLAG);
      expect(readFailingKeyExits(payload.flags, payload, apiKeys(cell))).toEqual([]);
    },
  );
});
