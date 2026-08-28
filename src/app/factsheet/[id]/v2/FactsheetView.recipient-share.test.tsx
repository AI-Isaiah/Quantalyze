import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 164 (SHARE-01 / SHARE-04) — RECIPIENT mode on the factsheet body.
 *
 * WHY these assertions matter, not just what they check:
 *
 *   1. THE COPY-LINK CONTROL IS THE BUG SURFACE. `ShareLinkButton` rebuilds the
 *      URL from `window.location` as `<origin><pathname>?share=1`. On the token
 *      route that pathname is `/factsheet-share/<token>`, so a recipient who
 *      clicked it would copy a URL with `?share=1` bolted onto a token path —
 *      or, worse, forward the token itself believing they were sharing a
 *      "public" link. Neither is a link the next person can safely be handed.
 *      A recipient must not see the control AT ALL, which is why this asserts
 *      the absence of a node rather than a disabled state.
 *   2. ABSENCE IS THE DEFAULT AND THE DEFAULT MUST NOT MOVE. Every existing
 *      FactsheetBody call site (the id page, AllocationDashboardV2,
 *      ScenarioFactsheetChart) passes no `recipientShare`. If the flag ever
 *      defaulted true, the PUBLISHED `?share=1` lane would silently lose its
 *      Copy-Link button — D-09 says that lane stays byte-identical.
 *   3. THE NOTICE IS A DISCLOSURE. A recipient looking at an unpublished
 *      strategy inside Quantalyze chrome would otherwise reasonably assume the
 *      platform vouches for it. The copy has to say it is private AND that
 *      Quantalyze has not reviewed it.
 *
 * Copy literals are typed HERE, never imported from FactsheetView.tsx — an
 * imported constant makes the oracle self-referential and a copy rewrite could
 * never fail this file. Harness (localStorage / dialog / navigation stubs) is
 * the one from FactsheetView.owner-notice.test.tsx, for the same reasons.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

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

const COPY_LINK_LABEL = "Copy share link";
const COMPARE_LABEL = "Compare strategies";
const NOTICE_HEADING = "Shared privately";
const OWNER_NOTICE_HEADING = "Unpublished — only you can see this";

const CREATE_LINK_LABEL = "Create share link";
const REVOKE_LABEL = "Revoke link";

function renderBody(
  props: {
    recipientShare?: boolean;
    viewerNotice?: "owner_unpublished" | "shared_privately";
    ownerShare?: { hasActiveShare: boolean };
  } = {},
) {
  return render(
    <FactsheetProvider payload={populatedPayload} persist={false}>
      <FactsheetBody
        payload={populatedPayload}
        hideAllocatorSection
        hideFooter
        {...props}
      />
    </FactsheetProvider>,
  );
}

describe("recipientShare suppresses every URL-handing-out affordance", () => {
  it("renders NO Copy-Link control", () => {
    const { container } = renderBody({ recipientShare: true });
    expect(container.textContent).not.toContain(COPY_LINK_LABEL);
  });

  it("renders NO Compare-strategies link (share mode hides outbound navigation)", () => {
    const { container } = renderBody({ recipientShare: true });
    expect(container.textContent).not.toContain(COMPARE_LABEL);
  });

  it("suppresses BOTH Copy-Link branches and the REVOKE control even when owner share state is present (SHARE-04)", () => {
    // Phase 164 plan 04, task 3 — the COMPOSITION check, and the only one that
    // can fail. The three assertions above pass trivially on a recipient mount
    // because `ownerShare` is absent there, so nothing owner-shaped could
    // render anyway. This arm forces the collision: owner share state AND
    // recipient mode on the same mount.
    //
    // Why that state is worth defending against rather than dismissing as
    // impossible: `recipientShare` and `ownerShare` are two independent props
    // on one component, and the thing standing between them is a single `&&`
    // in the ControlBar. A recipient who could see a Revoke button would be
    // offered a control over ANOTHER TENANT'S capability — the far worse
    // sibling of the rebuild-and-reshare hazard the Copy-Link assertions cover
    // (T-164-16). "The page never passes both" is a claim about a caller; this
    // is a claim about the component.
    const { container } = renderBody({
      recipientShare: true,
      viewerNotice: "shared_privately",
      ownerShare: { hasActiveShare: true },
    });

    expect(container.textContent).not.toContain(COPY_LINK_LABEL);
    expect(container.textContent).not.toContain(CREATE_LINK_LABEL);
    expect(container.textContent).not.toContain(REVOKE_LABEL);
  });

  it("still renders the factsheet itself — suppression is of chrome, not of content", () => {
    // Without this the two assertions above would pass on a blank render, which
    // is the opposite of the feature: the recipient is supposed to SEE the
    // strategy.
    const { container } = renderBody({ recipientShare: true });
    expect(container.querySelector("#factsheet-main")).not.toBeNull();
    expect(container.textContent).toContain("Reset view");
  });
});

describe("absence is the default — the published ?share=1 lane is untouched (D-09)", () => {
  it("WITHOUT the prop, the Copy-Link and Compare controls render exactly as before", () => {
    const { container } = renderBody();
    expect(container.textContent).toContain(COPY_LINK_LABEL);
    expect(container.textContent).toContain(COMPARE_LABEL);
  });

  it("an EXPLICIT false behaves identically to omitting the prop", () => {
    // The distinction matters because `FactsheetBody` destructures with a
    // default; an inverted default would show up here and nowhere else.
    const { container } = renderBody({ recipientShare: false });
    expect(container.textContent).toContain(COPY_LINK_LABEL);
    expect(container.textContent).toContain(COMPARE_LABEL);
  });
});

describe('viewerNotice="shared_privately" — the recipient disclosure', () => {
  it("renders the shared-privately notice above the document content", () => {
    const { container } = renderBody({
      recipientShare: true,
      viewerNotice: "shared_privately",
    });
    const notice = container.querySelector('section[role="note"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain(NOTICE_HEADING);
    // Both halves of the disclosure, pinned as prose: private, AND not vouched
    // for by Quantalyze. Losing either one changes what the recipient believes.
    expect(notice!.textContent).toContain("private link");
    expect(notice!.textContent).toContain("not published on Quantalyze");
    expect(notice!.textContent).toContain("has not been reviewed by Quantalyze");
  });

  it("is the article's FIRST child — viewer context precedes any number", () => {
    const { container } = renderBody({
      recipientShare: true,
      viewerNotice: "shared_privately",
    });
    const article = container.querySelector("#factsheet-main");
    expect(article).not.toBeNull();
    expect(article!.firstElementChild?.getAttribute("role")).toBe("note");
    expect(article!.firstElementChild?.textContent).toContain(NOTICE_HEADING);
  });

  it("never renders the OWNER notice — a recipient is not the owner", () => {
    // The owner banner says "only you can see this", which is false for a
    // recipient and would also imply the link they are holding does not work.
    const { container } = renderBody({
      recipientShare: true,
      viewerNotice: "shared_privately",
    });
    expect(container.textContent).not.toContain(OWNER_NOTICE_HEADING);
  });

  it("renders ZERO notice nodes when viewerNotice is absent (the PUBLIC factsheet)", () => {
    const { container } = renderBody();
    expect(container.textContent).not.toContain(NOTICE_HEADING);
    expect(container.textContent).not.toContain(OWNER_NOTICE_HEADING);
  });

  it("the OWNER notice still renders on its own lane — the union widening broke nothing", () => {
    const { container } = renderBody({ viewerNotice: "owner_unpublished" });
    expect(container.textContent).toContain(OWNER_NOTICE_HEADING);
    expect(container.textContent).not.toContain(NOTICE_HEADING);
  });
});
