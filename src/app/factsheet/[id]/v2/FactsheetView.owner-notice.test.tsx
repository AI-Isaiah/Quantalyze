import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 148 (OWN-02) — the owner-lane "Unpublished" banner.
 *
 * WHY these assertions matter (not just what they check):
 *
 *   1. The banner is a DISCLOSURE, not decoration. An owner who opens their own
 *      unpublished factsheet and does not see it will share the URL; the
 *      recipient's 404 then reads as a platform bug. So the copy is pinned
 *      VERBATIM (both literals typed here, never imported from the component —
 *      an imported constant would make the oracle self-referential and a copy
 *      rewrite could never fail this file).
 *   2. DOM ORDER is load-bearing. The notice is viewer context ("who can see
 *      this"), not document content — it must sit ABOVE the masthead so it is
 *      the first thing read, before any number. `topSlot` renders BELOW the
 *      masthead and is therefore the wrong seam (UI-SPEC:97).
 *   3. ABSENCE is the security-relevant half. `viewerNotice` is additive and
 *      default-off; every existing FactsheetBody call site (page.tsx,
 *      AllocationDashboardV2, ScenarioFactsheetChart) passes nothing. If the
 *      default ever rendered a node, PUBLISHED factsheets would be branded
 *      "unpublished". Zero nodes — not a hidden node — is the contract, which
 *      is also what keeps the PERMANENT GUARD-02 byte-identity gate green.
 *   4. The token assertions encode two deliberate UI-SPEC overrides against the
 *      sibling NotEnoughDataPanel primitive: the body is `text-caption` (12px),
 *      NOT `text-micro` (10-11px is too small for a load-bearing disclosure —
 *      UI-SPEC:66), and the banner has NO `print:hidden` — a draft handed to an
 *      LP on paper must carry its unpublished status (UI-SPEC:108).
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even at persist={false}, the hook still
 * registers). Stub block copied verbatim from FactsheetBody.scenario-mode.test.tsx.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
// Phase 140.5-01 / SEAMPROSE-04 — installed PER TEST, not at module scope.
// `vitest.config.ts` sets `unstubGlobals: true`, which restores stubbed globals
// before every test, so a stub applied once at import time is gone by the time
// the first test runs. Re-applying it here also removes a real leak: a stub set
// at module scope is never undone, so it reaches every later file in the same
// worker (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Healthy full-resolution returns series (~300 points → the body is fully
// populated) — same fixture shape as the GUARD-02 file.
function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const populatedPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
});

// Copy literals — typed here, NEVER imported from FactsheetView.tsx (oracle
// independence: an imported constant cannot detect a copy rewrite).
const BANNER_HEADING = "Unpublished — only you can see this";
const BANNER_BODY =
  "This factsheet is visible only from the account that uploaded the strategy. " +
  "Anyone else who opens this link sees a 404 until Quantalyze review publishes it.";

// Mirrors the GUARD-02 mount harness, incl. its `omitProp` trick — the
// absent-vs-explicit-undefined distinction the additive prop must satisfy.
// `hideHeader` defaults to FALSE here (unlike GUARD-02) because the DOM-order
// proof needs the real masthead present to order against.
function renderBody(
  viewerNotice: "owner_unpublished" | undefined,
  { omitProp = false, hideHeader = false }: { omitProp?: boolean; hideHeader?: boolean } = {},
) {
  return render(
    <FactsheetProvider payload={populatedPayload} persist={false}>
      <FactsheetBody
        payload={populatedPayload}
        hideHeader={hideHeader}
        hideAllocatorSection
        hideFooter={false}
        {...(omitProp ? {} : { viewerNotice })}
      />
    </FactsheetProvider>,
  );
}

describe("FactsheetBody — owner-lane visibility notice (OWN-02)", () => {
  it('viewerNotice="owner_unpublished" renders the role=note banner with the verbatim UI-SPEC copy', () => {
    const { container } = renderBody("owner_unpublished");

    const note = container.querySelector('[role="note"]');
    expect(note).not.toBeNull();
    expect(note!.getAttribute("aria-label")).toBe("Visibility notice");
    // Sentence-case in the DOM; the uppercase is a CSS transform, so the
    // accessible/text content stays the authored sentence.
    expect(note!.textContent).toContain(BANNER_HEADING);
    // The consequence clause ("sees a 404") is the whole point of the body copy —
    // without it owners share the link and the recipient's 404 reads as a bug.
    expect(note!.textContent).toContain(BANNER_BODY);
  });

  it("renders the banner ABOVE the masthead inside article#factsheet-main (viewer context precedes document content)", () => {
    const { container } = renderBody("owner_unpublished", { hideHeader: false });

    const article = container.querySelector("article#factsheet-main");
    expect(article).not.toBeNull();

    const note = article!.querySelector('[role="note"]');
    const masthead = article!.querySelector("header");
    expect(note).not.toBeNull();
    expect(masthead).not.toBeNull();

    // The banner must be the FIRST child of the article — not merely somewhere
    // before the masthead — so no document chrome precedes the disclosure.
    expect(article!.firstElementChild).toBe(note);
    // DOCUMENT_POSITION_FOLLOWING: the masthead follows the note in document order.
    // Fails loudly if a future change routes the banner through `topSlot`, which
    // renders BELOW the masthead.
    expect(
      note!.compareDocumentPosition(masthead!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders ZERO nodes when viewerNotice is absent OR explicitly undefined (published-lane byte-identity)", () => {
    // Absent prop — exactly what page.tsx / AllocationDashboardV2 /
    // ScenarioFactsheetChart pass today.
    const absent = renderBody(undefined, { omitProp: true });
    expect(absent.container.querySelector('[role="note"]')).toBeNull();
    expect(absent.container.textContent).not.toContain(BANNER_HEADING);

    // Explicit undefined — same render, proving the default is a no-op and not
    // an "explicitly passed" special case.
    const explicitUndefined = renderBody(undefined);
    expect(explicitUndefined.container.querySelector('[role="note"]')).toBeNull();
    expect(explicitUndefined.container.textContent).not.toContain(BANNER_HEADING);
  });

  it("carries the UI-SPEC token treatment: data-panel shape, mb-6, caption body, and NO print:hidden", () => {
    const { container } = renderBody("owner_unpublished");
    const note = container.querySelector('[role="note"]') as HTMLElement;
    expect(note).not.toBeNull();

    const cls = note.className;
    // Data-panel primitive (NOT a card): hairline border, subtle surface.
    expect(cls).toContain("border-border");
    expect(cls).toContain("bg-surface-subtle");
    // 24px gap before the masthead (UI-SPEC:97).
    expect(cls).toContain("mb-6");
    // The banner PRINTS — a draft handed to an LP on paper must carry its status.
    expect(cls).not.toContain("print:hidden");

    // First heading of the article, so h2 (the masthead h1 follows it).
    const heading = note.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toContain(BANNER_HEADING);
    expect(heading!.className).toContain("text-caption");
    expect(heading!.className).toContain("font-semibold");
    expect(heading!.className).toContain("uppercase");
    expect(heading!.className).toContain("tracking-[0.18em]");

    // Body is text-caption (12px), NOT the sibling panel's text-micro (10-11px).
    const body = note.querySelector("p");
    expect(body).not.toBeNull();
    expect(body!.className).toContain("text-caption");
    expect(body!.className).toContain("text-text-muted");
    expect(body!.className).not.toContain("text-micro");

    // No dismiss control — a document states its own status; a dismissed banner
    // lets an owner screenshot/print a draft that reads as published.
    expect(note.querySelector("button")).toBeNull();
  });
});
