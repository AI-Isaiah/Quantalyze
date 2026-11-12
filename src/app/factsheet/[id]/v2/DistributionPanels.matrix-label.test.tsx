/** @vitest-environment jsdom */
/**
 * Phase 201.1 D-05 / U-09 — the correlation matrix prints the strategy's row label whole
 * ("My allocation", 13 characters) and inside the svg at every breakpoint.
 *
 * Why this gate exists: raising the payload cap alone clipped the mobile row label by 4.81px
 * (a 124.8px end-anchored label at x = 120 starts at -4.8px); widening the mobile LABEL_W
 * alone leaves the ellipsis. The label's box is computed here from the RENDERED attributes
 * (x, fontSize, text length, Geist Mono's 0.6em advance), never from the component's own
 * constants, so a change to LABEL_W or the cap is judged from the outside.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
import { useBreakpoint } from "@/hooks/useBreakpoint";

import { FactsheetProvider } from "./factsheet-context";
import { CorrelationsMatrixPanel } from "./DistributionPanels";

const MONO_ADVANCE_EM = 0.6;
/** The label must start at least this far inside the svg's left edge. */
const MIN_INSET_PX = 3;

function payloadFor(name: string): FactsheetPayload {
  const dailyReturns = Array.from({ length: 400 }).map((_, i) => {
    const dayOfYear = i % 360;
    const year = 2023 + Math.floor(i / 360);
    const month = String((Math.floor(dayOfYear / 28) % 12) + 1).padStart(2, "0");
    const day = String((dayOfYear % 28) + 1).padStart(2, "0");
    return { date: `${year}-${month}-${day}`, value: Math.sin(i / 9) * 0.006 };
  });
  const payload = buildFactsheetPayload(
    {
      id: "test-strategy",
      name,
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-06-27T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

/** The row-label <text> whose content starts with `prefix`, as rendered attributes. */
function rowLabelBox(name: string, bp: "mobile" | "desktop", prefix: string) {
  vi.mocked(useBreakpoint).mockReturnValue(bp);
  const { container } = render(
    <FactsheetProvider payload={payloadFor(name)}>
      <CorrelationsMatrixPanel />
    </FactsheetProvider>,
  );
  const texts = Array.from(container.querySelectorAll("svg text")).filter(t =>
    (t.textContent ?? "").startsWith(prefix),
  );
  // One column header and one row label carry the strategy label; the row label is end-anchored.
  const row = texts.find(t => t.getAttribute("text-anchor") === "end");
  if (!row) throw new Error(`no end-anchored row label starting with "${prefix}"`);
  const text = row.textContent ?? "";
  const x = Number(row.getAttribute("x"));
  const fontSize = Number(row.getAttribute("font-size"));
  const left = x - text.length * MONO_ADVANCE_EM * fontSize;
  return { text, left };
}

beforeEach(() => {
  vi.mocked(useBreakpoint).mockReturnValue("desktop");
});

describe("[201.1 D-05] correlation matrix row label — whole and inside the svg", () => {
  for (const bp of ["mobile", "desktop"] as const) {
    it(`My allocation prints whole and starts >= ${MIN_INSET_PX}px inside the svg at ${bp}`, () => {
      const { text, left } = rowLabelBox("My allocation", bp, "My alloc");
      expect(text).toBe("My allocation");
      expect(left).toBeGreaterThanOrEqual(MIN_INSET_PX);
    });

    it(`a 14-character name is 13 glyphs (12 characters and an ellipsis) and inside the svg at ${bp}`, () => {
      const { text, left } = rowLabelBox("My allocation!", bp, "My alloc");
      expect(text).toBe("My allocatio…");
      expect([...text].length).toBe(13);
      expect(left).toBeGreaterThanOrEqual(MIN_INSET_PX);
    });
  }
});
