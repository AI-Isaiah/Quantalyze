import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// The signature panels branch on useBreakpoint (mobile vs desktop viewBox). Pin it
// to desktop so the render is deterministic and jsdom never touches matchMedia.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { BasisProvider } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";
import { AllocatorSection } from "./BatchDPanels";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";

/**
 * Test-the-wiring (crit-7, CLAUDE.md Rule 9): the H-1 `BaseLeverageNote` is rendered on
 * FOUR panels but only the PeerPercentilePanel call site was asserted
 * (FactsheetView.leverage.test.tsx). This file pins the other three — Allocator, event
 * Signatures, Cross-signatures — so removing `<BaseLeverageNote>` from any of them turns
 * the corresponding test RED (the verbatim label vanishes). Each asserts the note is
 * ABSENT at L=1 (inserted-only, byte-identical baseline) and PRESENT with the exact
 * per-panel label at L=2.
 *
 * These sections gate on an `ingestSource: "api"` payload (eventSignatures /
 * benchEventSignatures / allocatorPortfolios are api-arm-only), so the fixture is a real
 * `buildFactsheetPayload` api payload. Its `markets: ["crypto"]` gives periodsPerYear=365
 * and it is non-composite, so leverage is eligible on the default cash basis → the note
 * fires exactly at L≠1.
 */
function makeApiPayload(): FactsheetPayload {
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
      name: "Test Strategy",
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

// Drive the leverage context from inside the provider (mirrors the peer test harness).
function LeverageSetter({ value }: { value: number }) {
  const { setLeverage } = useLeverage();
  useEffect(() => {
    setLeverage(value);
  }, [value, setLeverage]);
  return null;
}

function renderSectionAtLeverage(node: React.ReactElement, leverage: number) {
  return render(
    <FactsheetProvider payload={makeApiPayload()} persist={false}>
      <BasisProvider>
        <LeverageProvider>
          <LeverageSetter value={leverage} />
          {node}
        </LeverageProvider>
      </BasisProvider>
    </FactsheetProvider>,
  );
}

describe("BaseLeverageNote wiring — H-1 'base 1×' note on the server-side panels", () => {
  const cases: Array<{ name: string; node: React.ReactElement; label: string }> = [
    {
      name: "AllocatorSection",
      node: <AllocatorSection />,
      label: "Allocator analysis shown at base 1× leverage",
    },
    {
      name: "SignaturesSection",
      node: <SignaturesSection />,
      label: "Event signatures shown at base 1× leverage",
    },
    {
      name: "CrossSignaturesSection",
      node: <CrossSignaturesSection />,
      label: "Cross-signature trajectories shown at base 1× leverage",
    },
  ];

  for (const { name, node, label } of cases) {
    it(`${name}: no base-1× note at L=1; the verbatim note renders at L=2`, () => {
      const atL1 = renderSectionAtLeverage(node, 1);
      // The panel itself renders (api fixture) but NO leverage note at L=1 — inserted,
      // never reserved, so the L=1 render is byte-identical to pre-leverage.
      expect(atL1.container.querySelector("[data-leverage-note]")).toBeNull();

      const atL2 = renderSectionAtLeverage(node, 2);
      const note = atL2.container.querySelector("[data-leverage-note]");
      expect(note).not.toBeNull();
      // Verbatim per-panel label — removing <BaseLeverageNote> from THIS panel turns
      // this assertion RED (test-the-wiring, not just the helper).
      expect(note?.textContent).toBe(label);
      expect(atL2.getByText(label)).toBeTruthy();
    });
  }
});
