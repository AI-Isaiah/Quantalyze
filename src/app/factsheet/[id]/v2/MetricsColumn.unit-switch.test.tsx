/** @vitest-environment jsdom */
/**
 * Phase 256 OKXUNITSWITCH plan 05 (SC-3, UI-SPEC C) — the headline KPI block of a switched strategy
 * states its rule: the figures are whole-record USD, the coin part converted at the stored daily
 * close.
 *
 * WHY it exists. A switched strategy's headline series is USD by construction, so every figure on
 * the rail is a correct USD figure; without a sentence naming the switch, a reader who has seen
 * "In USD to <day>, in BTC from <day>" in the masthead cannot tell which unit the KPIs are in. The
 * note must also NOT turn into a withhold: it sits above the figures, and every figure still
 * renders. A USD strategy's rail carries no note at all.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { formatCloseDay } from "@/lib/factsheet/returns-unit";
import { parseUnitSwitch, unitSwitchKpiNote, type UnitSwitchView } from "@/lib/factsheet/unit-segments";
import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn, type MetricsPart } from "./MetricsColumn";
import { censusPayloadA } from "./test-fixtures/census-payloads";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));
vi.setConfig({ testTimeout: 60_000 });

Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, get: () => 1024 });
Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, get: () => 768 });

const NOTE = '[data-testid="metrics-unit-switch-note"]';

function sw(coin: string, last: string, first: string): UnitSwitchView {
  return parseUnitSwitch({ coin, last_usd_day: last, first_coin_return_day: first }) as UnitSwitchView;
}

function mount(payload: FactsheetPayload, part: MetricsPart) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <article id="factsheet-main">
        <MetricsColumn part={part} />
      </article>
    </FactsheetProvider>,
  );
}

describe("MetricsColumn — the unit-switch KPI note", () => {
  it.each<MetricsPart>(["main", "all"])("part=%s: the note renders directly under the heading, before the first figure", (part) => {
    const unitSwitch = sw("BTC", "2026-11-14", "2026-11-15");
    const { container } = mount({ ...censusPayloadA(), unitSwitch } as FactsheetPayload, part);
    const note = container.querySelector(NOTE) as HTMLElement;
    expect(note, "the KPI note did not render").not.toBeNull();
    expect(note.className).toBe("mt-2 text-fixed-11 text-text-muted");
    expect(note.textContent).toBe(unitSwitchKpiNote(unitSwitch));
    expect((note.textContent ?? "").replace(/ /g, " ")).toBe(
      "In USD to Nov 14, 2026, in BTC from Nov 15, 2026. These figures cover the whole record in USD, with the BTC part converted at the stored daily BTC close.",
    );
    // Before the first figure: nothing of the panel's Kpm table precedes it, and the table follows it.
    const panel = note.closest("section") ?? note.parentElement!;
    const table = panel.querySelector("table") as HTMLElement;
    expect(table, "the Main metrics table did not render").not.toBeNull();
    expect(note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not a withhold: every figure the USD strategy shows is still shown", () => {
    const plain = mount(censusPayloadA(), "main").container;
    const plainRows = Array.from(plain.querySelectorAll("tr")).map((tr) => tr.textContent);
    const switched = mount({ ...censusPayloadA(), unitSwitch: sw("BTC", "2026-11-14", "2026-11-15") } as FactsheetPayload, "main").container;
    const switchedRows = Array.from(switched.querySelectorAll("tr")).map((tr) => tr.textContent);
    expect(switchedRows).toEqual(plainRows);
    expect(switchedRows.length).toBeGreaterThan(5);
  });

  it("the note follows the unit and the days (a second fixture, no literal)", () => {
    const { container } = mount({ ...censusPayloadA(), unitSwitch: sw("ETH", "2026-10-02", "2026-10-03") } as FactsheetPayload, "main");
    const text = (container.querySelector(NOTE) as HTMLElement).textContent ?? "";
    expect(text).toContain(formatCloseDay("2026-10-02"));
    expect(text).toContain("with the ETH part converted at the stored daily ETH close");
    expect(text).not.toContain("BTC");
  });

  it("without a unitSwitch the note is absent and the rail is unchanged", () => {
    const { container } = mount(censusPayloadA(), "main");
    expect(container.querySelector(NOTE)).toBeNull();
    expect(container.textContent).not.toContain("converted at the stored daily");
  });

  it("the detailed half does not carry the note (it belongs to the Main metrics heading)", () => {
    const { container } = mount({ ...censusPayloadA(), unitSwitch: sw("BTC", "2026-11-14", "2026-11-15") } as FactsheetPayload, "detailed");
    expect(container.querySelector(NOTE)).toBeNull();
  });
});
