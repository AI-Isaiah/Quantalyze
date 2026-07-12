import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ComposedChart, Line, XAxis, YAxis } from "recharts";

import type { AsofGap } from "@/lib/portfolio-exposure";
import {
  HALF_DAY_MS,
  asofToUtcMs,
  toGapBands,
  gapXDomain,
  renderGapAreas,
  makeDateTickFormatter,
} from "./chart-gaps";

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

describe("chart-gaps — asofToUtcMs (UTC-pure, TZ-independent)", () => {
  it('parses "2026-01-04" via Date.UTC, never a local new Date(string)', () => {
    expect(asofToUtcMs("2026-01-04")).toBe(Date.UTC(2026, 0, 4));
  });

  it("is midnight-UTC stable regardless of host offset", () => {
    // A local `new Date("2026-01-04")` would drift by the host TZ offset; UTC
    // arithmetic pins midnight-UTC exactly.
    expect(asofToUtcMs("2026-12-31") % 86_400_000).toBe(0);
  });
});

describe("chart-gaps — toGapBands (±12h pad, unpadded midpoint)", () => {
  it("pads each edge by HALF_DAY_MS and mid-points the UNPADDED edges", () => {
    const gap: AsofGap = { start: "2026-01-04", end: "2026-01-09", kind: "gap", days: 6 };
    const [band] = toGapBands([gap]);
    expect(band.x1).toBe(utc("2026-01-04") - HALF_DAY_MS);
    expect(band.x2).toBe(utc("2026-01-09") + HALF_DAY_MS);
    expect(band.midMs).toBe((utc("2026-01-04") + utc("2026-01-09")) / 2);
    expect(band.days).toBe(6);
    expect(band.start).toBe("2026-01-04");
    expect(band.end).toBe("2026-01-09");
  });

  it("gives a 1-day gap a full 24h-wide band (±12h pad)", () => {
    const gap: AsofGap = { start: "2026-03-10", end: "2026-03-10", kind: "gap", days: 1 };
    const [band] = toGapBands([gap]);
    expect(band.x2 - band.x1).toBe(2 * HALF_DAY_MS);
    expect(band.midMs).toBe(utc("2026-03-10"));
  });
});

describe("chart-gaps — gapXDomain (F-2 boundary inclusion)", () => {
  it("extends the domain to a leading gap band edge beyond the first point", () => {
    const points = [utc("2026-01-10"), utc("2026-01-11"), utc("2026-01-12")];
    const bands = toGapBands([{ start: "2026-01-01", end: "2026-01-09", kind: "gap", days: 9 }]);
    const domain = gapXDomain(points, bands);
    expect(domain[0]).toBe(bands[0].x1); // == utc(01-01) − 12h
    expect(domain[0]).toBe(utc("2026-01-01") - HALF_DAY_MS);
    expect(domain[1]).toBe(utc("2026-01-12"));
  });

  it("no gaps → domain is exactly [firstPoint, lastPoint]", () => {
    const points = [utc("2026-05-01"), utc("2026-05-02"), utc("2026-05-03")];
    expect(gapXDomain(points, [])).toEqual([utc("2026-05-01"), utc("2026-05-03")]);
  });
});

describe("chart-gaps — renderGapAreas (factsheet-parity hatch + label rule)", () => {
  function renderBands(gaps: AsofGap[], patternId: string) {
    const bands = toGapBands(gaps);
    const points = [utc("2026-01-01"), utc("2026-01-31")];
    const { container } = render(
      <ComposedChart width={400} height={200} data={points.map((asofMs) => ({ asofMs, v: 1 }))}>
        <XAxis dataKey="asofMs" type="number" domain={gapXDomain(points, bands)} />
        <YAxis />
        {/* a cartesian series is required for recharts to build the axis scale
            (and thus render ReferenceArea shapes) under jsdom */}
        <Line dataKey="v" />
        {renderGapAreas(bands, patternId)}
      </ComposedChart>,
    );
    return container;
  }

  it("emits one <title> per band with the EXACT factsheet copy", () => {
    const c = renderBands(
      [{ start: "2026-01-04", end: "2026-01-09", kind: "gap", days: 6 }],
      "gap-test-a",
    );
    const titles = Array.from(c.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("No data 2026-01-04 → 2026-01-09 (6 days)");
  });

  it("renders the '{days}d — no data' label for a ≥5-day gap", () => {
    const c = renderBands(
      [{ start: "2026-01-04", end: "2026-01-09", kind: "gap", days: 6 }],
      "gap-test-b",
    );
    expect(c.textContent).toContain("6d — no data");
  });

  it("OMITS the label for a <5-day gap but keeps the <title>", () => {
    const c = renderBands(
      [{ start: "2026-01-04", end: "2026-01-07", kind: "gap", days: 4 }],
      "gap-test-c",
    );
    expect(c.textContent).not.toContain("4d — no data");
    const titles = Array.from(c.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("No data 2026-01-04 → 2026-01-07 (4 days)");
  });

  it("byte-matches the factsheet hatch <pattern> attributes", () => {
    const c = renderBands(
      [{ start: "2026-01-04", end: "2026-01-09", kind: "gap", days: 6 }],
      "gap-unique-id",
    );
    const pattern = c.querySelector("pattern");
    expect(pattern).not.toBeNull();
    expect(pattern!.getAttribute("id")).toBe("gap-unique-id");
    expect(pattern!.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    expect(pattern!.getAttribute("width")).toBe("6");
    expect(pattern!.getAttribute("height")).toBe("6");
    expect(pattern!.getAttribute("patternTransform")).toBe("rotate(45)");
    const line = pattern!.querySelector("line");
    expect(line!.getAttribute("stroke")).toBe("var(--color-text-muted)");
    expect(line!.getAttribute("stroke-opacity")).toBe("0.15");
    expect(line!.getAttribute("stroke-width")).toBe("3");
  });
});

describe("chart-gaps — makeDateTickFormatter (year-aware)", () => {
  it("same-year domain → MM-DD", () => {
    const fmt = makeDateTickFormatter([utc("2026-01-01"), utc("2026-12-31")]);
    expect(fmt(utc("2026-01-15"))).toBe("01-15");
  });

  it("multi-year domain → YY-MM-DD", () => {
    const fmt = makeDateTickFormatter([utc("2025-11-03"), utc("2026-02-01")]);
    expect(fmt(utc("2025-11-03"))).toBe("25-11-03");
  });
});
