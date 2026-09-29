import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 167.1.2 C2 review round 2, R2-WR-01: the reader's verdict on a shared
 * account, asserted against ONE table the Python derive also reads.
 *
 * WHY. `equityHistoryReadiness` reads a duplicate behind a NOT-working holder
 * as ordinary, so it shows the book "ready". That is correct only while the
 * derive counts that account once, through its working member. The two sides
 * were tied by a doc comment alone ("Ship the two together"), and no test ran
 * across the language boundary. The truth table lives in
 * analytics-service/tests/fixtures/shared_account_resolution.json; the Python
 * half (analytics-service/tests/test_holder_matrix_parity.py) asserts what the
 * derive counts per cell, this file asserts what the reader shows. Either side
 * drifting reddens CI.
 *
 * The series handed to the reader is the one the derive leaves: present when
 * the derive composes a trustworthy curve, `null` otherwise, with the reason
 * the producer passes for that case. Only `equityHistoryReadiness` is called;
 * the producer around it (`derivePhase07Fields`) is not this test's subject.
 * The fixture is loaded in place, never copied (the cross-package idiom of
 * tests/lib/composite/window-overlap-convention-parity.test.ts).
 */

// queries.ts pulls in @/lib/audit, which imports "server-only" — that throws
// under vitest+jsdom. Mock it the same way the sibling queries tests do.
vi.mock("server-only", () => ({}));

import {
  equityHistoryReadiness,
  type EquityHistoryKey,
  type MissingSeriesReason,
} from "../queries";

type State = {
  is_active: boolean;
  sync_status: string | null;
  disconnected_at: string | null;
};

type Cell = {
  kind: "duplicate" | "composite_member";
  holder: string;
  marked: string;
  derive: {
    outcome: "refuse" | "compose";
    counted: string[];
    trustworthy: boolean | null;
  };
  reader: { state: "ready" | "rebuilding"; reason: string | null };
};

type Table = {
  exchange: string;
  states: Record<string, State>;
  cells: Cell[];
};

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/shared_account_resolution.json",
);
const TABLE: Table = JSON.parse(readFileSync(FIXTURE, "utf8"));

const SERIES = {
  curve: [{ date: "2026-06-03", value: 170_000 }],
  returns: [{ date: "2026-06-03", value: 0 }],
};

function keysFor(cell: Cell): EquityHistoryKey[] {
  const base = { exchange: TABLE.exchange };
  return [
    {
      ...base,
      ...TABLE.states.working,
      id: "key-O",
      venue_account_id: "venue-own",
      account_share_kind: null,
      account_shared_with_api_key_id: null,
    },
    {
      ...base,
      ...TABLE.states[cell.holder],
      id: "key-H",
      venue_account_id: "venue-shared",
      account_share_kind: null,
      account_shared_with_api_key_id: null,
    },
    {
      ...base,
      ...TABLE.states[cell.marked],
      id: "key-M",
      venue_account_id: null,
      account_share_kind: cell.kind,
      account_shared_with_api_key_id: "key-H",
    },
  ];
}

/** What the derive leaves for the reader: a series only on a trustworthy compose. */
function readerInputs(cell: Cell): [typeof SERIES | null, MissingSeriesReason] {
  if (cell.derive.outcome === "refuse") return [null, "awaiting_derivation"];
  if (cell.derive.trustworthy) return [SERIES, "awaiting_derivation"];
  return [null, "derivation_rejected"];
}

const cellId = (cell: Cell) => `${cell.kind} H=${cell.holder} M=${cell.marked}`;

describe("holder matrix parity — the TS reader against the shared table", () => {
  it("the table covers 2 kinds x every holder state x every marked state, once each", () => {
    const states = Object.keys(TABLE.states);
    const seen = new Set(TABLE.cells.map((c) => `${c.kind}|${c.holder}|${c.marked}`));
    expect(TABLE.cells).toHaveLength(2 * states.length * states.length);
    expect(seen.size).toBe(TABLE.cells.length);
  });

  it.each(TABLE.cells.map((cell) => [cellId(cell), cell] as const))(
    "%s",
    (_id, cell) => {
      const [series, missing] = readerInputs(cell);
      expect(equityHistoryReadiness(keysFor(cell), series, missing)).toEqual(cell.reader);
    },
  );

  it("the reader says duplicate_account exactly where the derive refuses", () => {
    for (const cell of TABLE.cells) {
      const [series, missing] = readerInputs(cell);
      const verdict = equityHistoryReadiness(keysFor(cell), series, missing);
      expect(
        { cell: cellId(cell), duplicate: verdict.reason === "duplicate_account" },
      ).toEqual({ cell: cellId(cell), duplicate: cell.derive.outcome === "refuse" });
    }
  });

  it("a ready verdict never sits over a shared account the derive counts twice", () => {
    for (const cell of TABLE.cells) {
      const [series, missing] = readerInputs(cell);
      const verdict = equityHistoryReadiness(keysFor(cell), series, missing);
      if (verdict.state !== "ready") continue;
      const shared = cell.derive.counted.filter((name) => name === "H" || name === "M");
      expect({ cell: cellId(cell), sharedCounted: shared.length <= 1 }).toEqual({
        cell: cellId(cell),
        sharedCounted: true,
      });
    }
  });
});
