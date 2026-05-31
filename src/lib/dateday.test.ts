import { afterAll, beforeAll, describe, it, expect } from "vitest";

import {
  assertMonotonic,
  diffDays,
  isMonotonicByDay,
  isoDayFromDate,
  localMidnight,
  localMidnightFromIsoString,
  localMidnightToday,
  parseIsoDay,
  sortByDayAscending,
  today,
  utcEpoch,
  utcEpochFromIsoString,
  type IsoDay,
} from "./dateday";

const DAY_MS = 86_400_000;

describe("parseIsoDay — strict calendar-day validation (H-1231 rollover guard)", () => {
  it("accepts a valid YYYY-MM-DD and returns it branded + normalized", () => {
    expect(parseIsoDay("2024-01-01")).toBe("2024-01-01");
    expect(parseIsoDay("2024-12-31")).toBe("2024-12-31");
  });

  it("zero-pads single-digit month/day so the brand is canonical", () => {
    // The picker's input + the chart's data are always zero-padded, but the
    // normalizer must not hand back a ragged string that breaks lexicographic
    // ordering downstream.
    expect(parseIsoDay("2024-1-1")).toBe("2024-01-01");
  });

  it("rejects an out-of-range MONTH (2024-13-01) instead of rolling to Jan 2025 (H-1231)", () => {
    expect(parseIsoDay("2024-13-01")).toBeNull();
  });

  it("rejects a non-existent calendar day (2024-02-31) instead of rolling to Mar 2 (H-1231)", () => {
    expect(parseIsoDay("2024-02-31")).toBeNull();
    expect(parseIsoDay("2024-04-31")).toBeNull(); // April has 30 days
  });

  it("accepts a real leap day (2024-02-29) and rejects a non-leap one (2023-02-29)", () => {
    expect(parseIsoDay("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDay("2023-02-29")).toBeNull();
  });

  it("returns null for empty / whitespace / garbage", () => {
    expect(parseIsoDay("")).toBeNull();
    expect(parseIsoDay("   ")).toBeNull();
    expect(parseIsoDay("not-a-date")).toBeNull();
    expect(parseIsoDay("2024-01")).toBeNull();
  });
});

describe("localMidnight / utcEpoch — the two distinct conversions (H-1224)", () => {
  const day = "2024-03-15" as IsoDay;

  it("localMidnight builds a LOCAL-time Date whose local fields echo the day", () => {
    const d = localMidnight(day);
    // Read with LOCAL accessors — round-trips regardless of the runner's TZ
    // because both construction and read are local. This is the property the
    // CustomRangePicker grid relies on.
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2); // March = index 2
    expect(d.getDate()).toBe(15);
  });

  it("utcEpoch returns exactly Date.UTC(y, m-1, d) — timezone-stable", () => {
    expect(utcEpoch(day)).toBe(Date.UTC(2024, 2, 15));
  });
});

describe("isoDayFromDate — LOCAL-field serialization", () => {
  it("round-trips localMidnight in ANY timezone (the off-by-one guard)", () => {
    for (const s of ["2024-01-01", "2024-06-30", "2024-12-31", "2023-02-28"]) {
      const day = s as IsoDay;
      expect(isoDayFromDate(localMidnight(day))).toBe(day);
    }
  });

});

describe("off-by-one regression guard (H-1224 / NEW-C23-01) — pinned WEST of UTC", () => {
  // The whole module exists to keep the picker's first data day selectable for
  // users west of UTC. That guarantee is INVISIBLE under UTC (offset 0), which
  // is exactly why CI — running in UTC — never caught NEW-C23-01. So pin a
  // fixed west-of-UTC zone here: Node re-reads `process.env.TZ` on each Date
  // construction, so these assertions run against a real UTC-5 offset and FAIL
  // if anyone reverts localMidnight/isoDayFromDate to getUTC*/Date.UTC accessors
  // (the exact production bug). Restored in afterAll so no other suite leaks EST.
  const originalTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it("actually runs west of UTC (fail-loud if the TZ override is a no-op)", () => {
    // Guards against this test silently going inert (the flaw it was written to
    // fix): if the runtime ignored the TZ override, offset would be 0 and the
    // drift assertions below would vacuously pass — so assert the zone first.
    expect(new Date(Date.UTC(2024, 0, 1)).getTimezoneOffset()).toBeGreaterThan(0);
  });

  it("a picker bound built via localMidnight stays on the requested day; a UTC-epoch bound drifts a day earlier (the bug)", () => {
    const day = "2024-01-01" as IsoDay;
    // The FIX: build the bound locally + read it locally → no drift, the first
    // data day stays selectable.
    expect(isoDayFromDate(localMidnight(day))).toBe("2024-01-01");
    expect(isoDayFromDate(localMidnightFromIsoString(String(day))!)).toBe("2024-01-01");
    // The BUG (H-1224): build the bound from a UTC-midnight epoch (the old
    // parseISO convention) and read it with the picker's local accessors — west
    // of UTC it resolves to the PREVIOUS day, making the first data day
    // unselectable. This assertion now executes unconditionally.
    expect(isoDayFromDate(new Date(utcEpoch(day)))).toBe("2023-12-31");
  });

  it("today()/isoDayFromDate use local fields, so a round-trip never drifts even west of UTC", () => {
    for (const s of ["2024-01-01", "2024-07-15", "2024-12-31"]) {
      expect(isoDayFromDate(localMidnight(s as IsoDay))).toBe(s);
    }
  });
});

describe("today / localMidnightToday", () => {
  it("today() equals isoDayFromDate(now) and is a well-formed day", () => {
    expect(today()).toBe(isoDayFromDate(new Date()));
    expect(parseIsoDay(today())).toBe(today());
  });

  it("localMidnightToday() carries no wall-clock time (NEW-C23-02)", () => {
    const d = localMidnightToday();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(isoDayFromDate(d)).toBe(today());
  });
});

describe("diffDays — calendar-day count, DST- and time-of-day-immune", () => {
  it("counts whole calendar days (b - a)", () => {
    expect(diffDays("2024-01-01" as IsoDay, "2024-01-01" as IsoDay)).toBe(0);
    expect(diffDays("2024-01-01" as IsoDay, "2024-01-02" as IsoDay)).toBe(1);
    expect(diffDays("2024-01-01" as IsoDay, "2024-01-31" as IsoDay)).toBe(30);
  });

  it("is negative when b precedes a", () => {
    expect(diffDays("2024-01-31" as IsoDay, "2024-01-01" as IsoDay)).toBe(-30);
  });

  it("returns an exact integer count spanning the US spring-forward dates (anchored at UTC, never fractional)", () => {
    // diffDays resolves both ends via Date.UTC, which never observes DST, so the
    // count is always a whole number of calendar days — here across the 2024
    // US spring-forward (Mar 10). This pins the integer-count contract; it does
    // NOT claim to distinguish a DST-observing implementation (a naive local
    // subtraction would also round 47h/24h → 2), which is why the assertion is
    // about the exact value, not about DST behaviour.
    expect(diffDays("2024-03-09" as IsoDay, "2024-03-11" as IsoDay)).toBe(2);
  });

  it("matches the picker's inclusive dayCount: diffDays + 1 = 180 for a 180-day window", () => {
    // CustomRangePicker shows "180 days" for 2024-01-01 .. 2024-06-28.
    expect(diffDays("2024-01-01" as IsoDay, "2024-06-28" as IsoDay) + 1).toBe(180);
  });
});

describe("utcEpochFromIsoString — lenient data-plane parse (EquityChart.parseISO byte-compat)", () => {
  it("returns Date.UTC for a valid YYYY-MM-DD", () => {
    expect(utcEpochFromIsoString("2024-03-15")).toBe(Date.UTC(2024, 2, 15));
  });

  it("preserves the historical rollover TOLERANCE (2024-13-01 → Jan 2025 epoch, NOT null)", () => {
    // The chart trusts its producer and never rejected rollovers — only the
    // strict UI parser (parseIsoDay) does. Byte-compat requires this stays
    // lenient so existing chart data renders identically.
    expect(utcEpochFromIsoString("2024-13-01")).toBe(Date.UTC(2024, 12, 1));
  });

  it("returns NaN for truly malformed input (callers guard on Number.isFinite)", () => {
    expect(Number.isFinite(utcEpochFromIsoString("not-a-date"))).toBe(false);
    expect(Number.isFinite(utcEpochFromIsoString(""))).toBe(false);
  });

  it("differs from a UTC-midnight epoch by the day offset for the next day", () => {
    expect(
      utcEpochFromIsoString("2024-03-16") - utcEpochFromIsoString("2024-03-15"),
    ).toBe(DAY_MS);
  });
});

describe("localMidnightFromIsoString — lenient local parse (EquityChart.localDateFromISO byte-compat)", () => {
  it("builds a local-midnight Date whose local fields echo a valid day", () => {
    const d = localMidnightFromIsoString("2024-03-15")!;
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  it("preserves the historical rollover TOLERANCE (2024-13-01 → Jan 2025 local, NOT null)", () => {
    // localDateFromISO never rejected rollovers (only the strict UI parser does);
    // byte-compat requires this stays lenient so the chart's picker `min` is
    // unchanged for any input the producer emits.
    const d = localMidnightFromIsoString("2024-13-01")!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(0); // January
  });

  it("returns null for non-ISO input (the caller supplies its own fallback)", () => {
    expect(localMidnightFromIsoString("not-a-date")).toBeNull();
    expect(localMidnightFromIsoString("")).toBeNull();
  });

  it("round-trips a valid day through isoDayFromDate in any timezone", () => {
    expect(isoDayFromDate(localMidnightFromIsoString("2024-06-30")!)).toBe("2024-06-30");
  });
});

describe("sortByDayAscending / isMonotonicByDay / assertMonotonic", () => {
  const mk = (...days: string[]) => days.map((date) => ({ date }));

  it("sortByDayAscending returns a sorted COPY without mutating the input", () => {
    const input = mk("2024-03-01", "2024-01-01", "2024-02-01");
    const out = sortByDayAscending(input);
    expect(out.map((p) => p.date)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    // input untouched.
    expect(input.map((p) => p.date)).toEqual(["2024-03-01", "2024-01-01", "2024-02-01"]);
  });

  it("isMonotonicByDay is true for non-decreasing (duplicates allowed), false on any drop", () => {
    expect(isMonotonicByDay(mk("2024-01-01", "2024-01-01", "2024-01-02"))).toBe(true);
    expect(isMonotonicByDay(mk("2024-01-02", "2024-01-01"))).toBe(false);
    expect(isMonotonicByDay(mk())).toBe(true);
  });

  it("assertMonotonic returns the series on success and throws at the first violation", () => {
    const ok = mk("2024-01-01", "2024-01-02", "2024-01-03");
    expect(assertMonotonic(ok)).toBe(ok);
    expect(() => assertMonotonic(mk("2024-01-02", "2024-01-01"))).toThrow(
      /monotonic-date violation at index 1/,
    );
  });

  it("assertMonotonic(strict=false) tolerates equal adjacent days but still rejects a drop", () => {
    expect(() => assertMonotonic(mk("2024-01-01", "2024-01-01"), false)).not.toThrow();
    expect(() => assertMonotonic(mk("2024-01-01", "2024-01-01"), true)).toThrow();
    expect(() => assertMonotonic(mk("2024-01-02", "2024-01-01"), false)).toThrow();
  });
});
