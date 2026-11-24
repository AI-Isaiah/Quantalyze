/**
 * Phase 225 plan 06 (CONN-03, MT5D-08). The TS half of the broker-server
 * identity rule, replayed against the case table the Python twin reads too
 * (`analytics-service/tests/fixtures/venue_server_identity.json`). The
 * expectations in that file are hand-typed; nothing here derives one from the
 * code under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_VENUE_SERVER_LENGTH,
  normaliseVenueServer,
  pickSameAccountHolder,
  sameVenueServer,
} from "./venue-identity";

type PickCase = {
  name: string;
  rows: Array<{ id: string; venue_server: string | null }>;
  server: string | null;
  mode: "fence" | "after_index_refusal";
  expect: string | null;
};

const spec = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "analytics-service/tests/fixtures/venue_server_identity.json",
    ),
    "utf8",
  ),
) as {
  normalise: Array<{ in: unknown; out: string | null }>;
  same: Array<{ a: string | null; b: string | null; same: boolean }>;
  pick: PickCase[];
};

describe("the shared fixture is not vacuous", () => {
  it("holds cases in every array", () => {
    expect(spec.normalise.length).toBeGreaterThan(0);
    expect(spec.same.length).toBeGreaterThan(0);
    expect(spec.pick.length).toBeGreaterThan(0);
  });
});

describe("normaliseVenueServer (the fixture's cases)", () => {
  it.each(spec.normalise)("$in normalises to $out", ({ in: raw, out }) => {
    expect(normaliseVenueServer(raw)).toBe(out);
  });

  it("counts code points like the database's char_length, not UTF-16 units", () => {
    expect(MAX_VENUE_SERVER_LENGTH).toBe(128);
    expect(normaliseVenueServer("\u{1F600}".repeat(128))).toBe("\u{1F600}".repeat(128));
    expect(normaliseVenueServer("\u{1F600}".repeat(129))).toBeNull();
  });
});

describe("sameVenueServer (the fixture's cases)", () => {
  it.each(spec.same)("$a vs $b is same=$same", ({ a, b, same }) => {
    expect(sameVenueServer(a, b)).toBe(same);
  });
});

describe("pickSameAccountHolder (the fixture's cases)", () => {
  it.each(spec.pick)("$name", ({ rows, server, mode, expect: want }) => {
    expect(pickSameAccountHolder(rows, server, mode)?.id ?? null).toBe(want);
  });

  it.each(spec.pick)("$name (rows reversed)", ({ rows, server, mode, expect: want }) => {
    expect(pickSameAccountHolder([...rows].reverse(), server, mode)?.id ?? null).toBe(want);
  });
});
