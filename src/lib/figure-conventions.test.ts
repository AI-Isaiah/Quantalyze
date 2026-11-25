/**
 * Phase 236 plan 01 (FIG-01, F-5): the cross-language pin of the convention constant set.
 *
 * WHY: "365, ddof 1 everywhere" is only one convention if both languages hold the SAME
 * numbers. Each language keeps one named constant set; this pin reads the Python module as
 * text (the figure-gate.test.ts pattern) and fails NAMING the constant when either side is
 * changed alone. Exactly-once is part of the rule: a duplicate definition is a second place
 * the number can drift, so it fails too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_DAYS_PER_YEAR,
  CVAR_MIN_OBS,
  PERIODS_PER_YEAR_CRYPTO,
  PERIODS_PER_YEAR_TRADITIONAL,
  SD_DDOF,
} from "./figure-conventions";

const py = readFileSync(resolve(process.cwd(), "analytics-service/services/figure_conventions.py"), "utf8");
const read = (name: string): number => {
  const hits = [...py.matchAll(new RegExp(`^${name} = (\\d+)\\s*$`, "gm"))];
  expect(hits, `${name} must be defined exactly once in figure_conventions.py`).toHaveLength(1);
  return Number(hits[0][1]);
};

describe("one convention: TS constants equal the Python constants (text-read pin)", () => {
  it.each([
    ["CALENDAR_DAYS_PER_YEAR", CALENDAR_DAYS_PER_YEAR],
    ["SD_DDOF", SD_DDOF],
    ["PERIODS_PER_YEAR_CRYPTO", PERIODS_PER_YEAR_CRYPTO],
    ["PERIODS_PER_YEAR_TRADITIONAL", PERIODS_PER_YEAR_TRADITIONAL],
    ["CVAR_MIN_OBS", CVAR_MIN_OBS],
  ] as const)("%s agrees across languages", (name, tsValue) => {
    expect(read(name), `${name} differs between figure_conventions.py and figure-conventions.ts`).toBe(tsValue);
  });

  it("F-5 values: 365-day year, sample sd, 365 crypto / 252 traditional clock", () => {
    expect(CALENDAR_DAYS_PER_YEAR).toBe(365);
    expect(SD_DDOF).toBe(1);
    expect(PERIODS_PER_YEAR_CRYPTO).toBe(365);
    expect(PERIODS_PER_YEAR_TRADITIONAL).toBe(252);
  });

  it("F-6 / Q2: the CVaR floor is 60 observations of the total record", () => {
    expect(CVAR_MIN_OBS).toBe(60);
  });
});
