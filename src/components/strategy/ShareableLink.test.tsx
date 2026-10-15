/**
 * Audit-2026-05-07 #43 — ShareableLink regression tests.
 *
 * The component used to set `copied=true` even when both clipboard paths
 * silently failed: `navigator.clipboard.writeText` rejected, the
 * execCommand fallback returned false, and the success badge fired anyway.
 * The fix tracks `fallbackSucceeded` and renders a `copyFailed` state
 * (red badge + "Copy failed — copy the URL manually") when both paths fail.
 *
 * Branches verified:
 *   1. clipboard.writeText resolves          → "Link copied!"
 *   2. clipboard rejects, execCommand=true   → "Link copied!"  (fallback OK)
 *   3. clipboard rejects, execCommand=false  → "Copy failed"   (regression branch)
 *   4. clipboard rejects, execCommand throws → "Copy failed"   (regression branch)
 *   5. The temporary <input> created for execCommand is removed from the DOM
 *      after the fallback runs (cleanup in finally).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Phase 164 (SHARE-04) — every arm above now passes `published`, which became a
 * REQUIRED prop. They were always the published branch; the prop only makes the
 * fact explicit, and the URL they assert is byte-unchanged.
 *
 * The block at the bottom of this file covers the branch that did not exist
 * before: an UNPUBLISHED strategy mints a revocable link instead of handing out
 * a public URL that 404s. It extends the SAME honest-failure discipline audit
 * #43 established here — a mint failure must be exactly as visible as a
 * clipboard failure, and neither may reach the success badge.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ShareableLink } from "./ShareableLink";

// Phase 164.6.6.3.1 D-05: the "Manage private link" Modal mounts the REAL
// OwnerUnpublishedPanel (row and panel must share one state), which lives in
// FactsheetView.tsx. Its module pulls in sentry capture and next/navigation,
// stubbed as FactsheetView.share-affordance.test.tsx stubs them.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// jsdom (older builds) lacks the native dialog methods Modal calls; same
// polyfill as FactsheetView.share-affordance.test.tsx.
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

const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";

const ORIGINAL_CLIPBOARD = navigator.clipboard;
const ORIGINAL_EXEC = document.execCommand;

function setClipboard(impl: { writeText: (s: string) => Promise<void> } | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function setExecCommand(impl: () => boolean): void {
  Object.defineProperty(document, "execCommand", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, origin: "https://example.test" },
    configurable: true,
  });
});

afterEach(() => {
  setClipboard(ORIGINAL_CLIPBOARD as unknown as { writeText: (s: string) => Promise<void> });
  Object.defineProperty(document, "execCommand", {
    value: ORIGINAL_EXEC,
    configurable: true,
    writable: true,
  });
  vi.useRealTimers();
});

describe("ShareableLink — Audit #43 copyFailed regression", () => {
  it("writes the factsheet URL to navigator.clipboard and shows 'Link copied!' on success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `https://example.test/factsheet/${STRATEGY_ID}`,
      );
    });
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
  });

  it("falls back to execCommand and shows 'Link copied!' when clipboard.writeText rejects but the fallback returns true", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
  });

  it("renders 'Copy failed — copy the URL manually' when both clipboard paths fail (regression: Audit #43)", async () => {
    // The exact pre-fix bug: writeText rejects AND execCommand returns false.
    // Old behaviour: success badge anyway. New behaviour: failure badge.
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    setExecCommand(vi.fn().mockReturnValue(false));

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Copy failed — copy the URL manually/,
      ),
    );
    // Belt-and-suspenders: success copy must NOT be visible.
    expect(screen.getByRole("button").textContent).not.toMatch(/Link copied!/);
  });

  it("renders 'Copy failed' when clipboard rejects and execCommand throws", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    setExecCommand(() => {
      throw new Error("execCommand unsupported");
    });

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Copy failed — copy the URL manually/,
      ),
    );
  });

  it("removes the temporary <input> from document.body after the execCommand fallback runs", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    setExecCommand(vi.fn().mockReturnValue(true));

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    const inputsBefore = document.body.querySelectorAll("input").length;
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    // The fallback creates a transient <input> that must be cleaned up
    // in the finally block — leaking these would pollute every page that
    // hosts ShareableLink with a random selected input element.
    expect(document.body.querySelectorAll("input").length).toBe(inputsBefore);
  });
});

/**
 * Phase 164 (SHARE-04) — one predicate, two mechanisms.
 *
 * The claim under test is not "the component can mint". It is that the SAME
 * component, given the SAME click, produces a URL whose disclosure properties
 * match the strategy's actual visibility — a public URL for a public document,
 * a revocable capability for a private one — and that it never claims success
 * for a link it did not obtain.
 */
describe("ShareableLink — the share predicate (SHARE-04)", () => {
  const MINTED_URL = "https://quantalyze.xyz/factsheet-share/tok-en-abc";

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("published=true copies the public factsheet URL and never touches the mint route", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://example.test/factsheet/${STRATEGY_ID}`,
      ),
    );
    // The load-bearing negative: a published strategy's id is already public,
    // so wrapping it in a capability token would be revocation theatre over
    // public data (D-09). If a future refactor "unifies" the lanes onto the
    // token, this is the assertion that notices.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("published=false MINTS and copies the returned url — an unpublished row is no longer affordance-less", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: MINTED_URL }),
    });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    // The label states what the click will do; "Share Factsheet" would be false
    // for a strategy that has no public factsheet.
    expect(screen.getByRole("button").textContent).toMatch(/Get private link/);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINTED_URL));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/strategies/${STRATEGY_ID}/share`,
    );
    // Never the public id URL — that is the exact link that 404s for the
    // recipient, which is the defect this phase exists to remove.
    expect(writeText).not.toHaveBeenCalledWith(
      `https://example.test/factsheet/${STRATEGY_ID}`,
    );
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
  });

  it("a failed mint surfaces the failure and NEVER flashes 'Link copied!'", async () => {
    // Audit #43's discipline, extended to the new failure source. The clipboard
    // here is perfectly healthy — the point is that a broken MINT must be just
    // as visible as a broken clipboard, because to the user both mean the same
    // thing: no working link.
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    expect(screen.getByRole("button").textContent).not.toMatch(/Link copied!/);
    expect(
      writeText,
      "nothing may be written to the clipboard when nothing was minted",
    ).not.toHaveBeenCalled();
  });

  it("a 200 with no url in the body is a failure, not a copy of `undefined`", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
  });
});

/**
 * Phase 170-05 / N-STRAT — ShareableLink size.
 *
 * WHY: the private-link control on /strategies has to be a small bordered
 * secondary peer of StrategyActions, never the accent button, and the
 * discovery detail page (no size prop) has to stay on the md arm.
 * `sm` has no min-height of its own, so a coarse pointer still needs 44px.
 */
describe("ShareableLink — size (170-05)", () => {
  const MD_BUTTON =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none bg-white text-text-primary border border-border hover:bg-page min-h-[44px] px-4 py-2.5 text-body";
  const SM_BUTTON =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none bg-white text-text-primary border border-border hover:bg-page px-3 py-1.5 text-caption pointer-coarse:min-h-[44px]";

  function iconClass(button: HTMLElement): string {
    return button.querySelector("svg")?.getAttribute("class") ?? "";
  }

  function expectSm(button: HTMLElement): void {
    expect(button.className).toBe(SM_BUTTON);
    expect(button.className).not.toContain("bg-accent");
    expect(iconClass(button)).toContain("h-3.5 w-3.5 mr-1.5");
    expect(iconClass(button)).not.toContain("h-4");
  }

  it("with no size prop the button and icon stay on the md arm", () => {
    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    const button = screen.getByRole("button");
    expect(button.className).toBe(MD_BUTTON);
    expect(iconClass(button)).toBe("h-4 w-4 mr-1.5");
    expect(button.className).not.toContain("pointer-coarse:min-h-[44px]");
    expect(button.className).not.toContain("bg-accent");
  });

  it("size sm is a bordered secondary button with a coarse 44px floor and a smaller icon", () => {
    render(
      <ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />,
    );
    expectSm(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toMatch(/Get private link/);
  });

  it("keeps the sm classes while minting", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(
      <ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Creating link/),
    );
    expectSm(screen.getByRole("button"));
    vi.unstubAllGlobals();
  });

  it("keeps the sm classes on copy success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://quantalyze.xyz/factsheet-share/tok" }),
    }));
    render(
      <ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    expectSm(screen.getByRole("button"));
    expect(iconClass(screen.getByRole("button"))).toContain("text-positive");
    vi.unstubAllGlobals();
  });

  it("keeps the sm classes when the copy fails", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(vi.fn().mockReturnValue(false));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://quantalyze.xyz/factsheet-share/tok" }),
    }));
    render(
      <ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />,
    );
    fireEvent.click(screen.getByRole("button"));
    // The Private link dialog now opens beside the row button (it shows the
    // minted URL), so the row button is named rather than the only button.
    const rowButton = await screen.findByRole("button", {
      name: /Copy failed — copy the URL manually/,
    });
    expectSm(rowButton);
    expect(iconClass(rowButton)).toContain("text-negative");
    vi.unstubAllGlobals();
  });

  it("keeps the sm classes when the mint fails", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    render(
      <ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    expectSm(screen.getByRole("button"));
    expect(iconClass(screen.getByRole("button"))).toContain("text-negative");
    vi.unstubAllGlobals();
  });
});

/**
 * Phase 164.6.6.3.1 D-05 (item 6f) — a row with a CONFIRMED live private link
 * reads "Manage private link" and manages it in a Modal that reuses the
 * factsheet's OwnerUnpublishedPanel.
 *
 * The labels are typed HERE, never imported, so a copy rewrite can fail this
 * file. "Opening the Modal makes no fetch" is the load-bearing negative: the
 * Modal states the link is live and offers copy and revoke, it does not print
 * the URL, so it must not mint-or-reuse on open.
 */
describe("ShareableLink — Manage private link (164.6.6.3.1 D-05)", () => {
  const MANAGE = "Manage private link";
  const GET = "Get private link";
  const MODAL_TITLE = "Private link";
  const MINTED_URL = "https://quantalyze.xyz/factsheet-share/tok-en-abc";

  let fetchMock: ReturnType<typeof vi.fn>;

  // The Modal mounts OwnerUnpublishedPanel through `next/dynamic`, so the first
  // test to open it would otherwise pay the cold import of FactsheetView.tsx
  // inside findBy's 1 s budget, and under CPU load that import alone exceeds
  // it. Load the module once here, under its own timeout, so each test's
  // dynamic import resolves from the module cache.
  beforeAll(async () => {
    await import("@/app/factsheet/[id]/v2/FactsheetView");
  }, 30_000);

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("D-05: a confirmed live link reads Manage private link and opens the Private link Modal without a fetch", async () => {
    render(
      <ShareableLink
        strategyId={STRATEGY_ID}
        published={false}
        hasActiveShare
        size="sm"
      />,
    );

    const manage = screen.getByRole("button", { name: MANAGE });
    expect(manage.getAttribute("aria-haspopup")).toBe("dialog");

    fireEvent.click(manage);

    expect(await screen.findByText(MODAL_TITLE)).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Copy share link" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke link" })).toBeTruthy();
    expect(
      fetchMock,
      "opening the Modal must not mint-or-reuse: it prints no URL",
    ).not.toHaveBeenCalled();
  });

  it("a published row ignores hasActiveShare", () => {
    render(
      <ShareableLink
        strategyId={STRATEGY_ID}
        published
        hasActiveShare
        size="sm"
      />,
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toMatch(/Share Factsheet/);
    expect(button.getAttribute("aria-haspopup")).toBeNull();
  });

  it("absent hasActiveShare stays Get private link, with no popup and no dialog", () => {
    const { container } = render(
      <ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />,
    );
    const button = screen.getByRole("button", { name: GET });
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("the Close button closes the Modal through the native close", async () => {
    const closeSpy = vi.spyOn(HTMLDialogElement.prototype, "close");
    render(
      <ShareableLink
        strategyId={STRATEGY_ID}
        published={false}
        hasActiveShare
        size="sm"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MANAGE }));
    await screen.findByRole("button", { name: "Copy share link" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Copy share link" })).toBeNull();
    expect(screen.getByRole("button", { name: MANAGE })).toBeTruthy();
  });

  /** Open the Modal from a live row and return the revoke trigger's click path. */
  async function openLive(): Promise<void> {
    render(
      <ShareableLink
        strategyId={STRATEGY_ID}
        published={false}
        hasActiveShare
        size="sm"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: MANAGE }));
    await screen.findByRole("button", { name: "Revoke link" });
  }

  function confirmRevoke(): void {
    fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  }

  it.each([200, 404])(
    "a revoke %i closes the Modal through the native close and the row reads Get private link",
    async (status) => {
      const closeSpy = vi.spyOn(HTMLDialogElement.prototype, "close");
      fetchMock.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({}),
      });
      await openLive();

      confirmRevoke();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: GET })).toBeTruthy(),
      );
      // AWAIT the close; never assert it synchronously here. The row label and
      // `panelOpen=false` land in ONE commit, but Modal calls `dialog.close()`
      // from a passive useEffect. This update starts after `await fetch`, so it
      // is not a sync lane, and React flushes its passive effects in a LATER
      // Scheduler task. On a CPU-starved worker the Scheduler yields before
      // that task, waitFor sees the label first, and a synchronous assert reads
      // 0 calls (CI run 38587166468). The contract is that close runs once and
      // leaves the dialog closed. A component that never closes still fails
      // here, on the waitFor timeout.
      await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
      expect(document.querySelector("dialog")?.open).toBe(false);
      expect(screen.queryByRole("button", { name: "Revoke link" })).toBeNull();
    },
  );

  it("a revoke 500 keeps the Modal open with its alert, and the row still reads Manage private link", async () => {
    const closeSpy = vi.spyOn(HTMLDialogElement.prototype, "close");
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await openLive();

    confirmRevoke();

    expect(
      await screen.findByText("Couldn't revoke this link. Try again."),
    ).toBeTruthy();
    expect(screen.getByText(MODAL_TITLE)).toBeTruthy();
    expect(screen.getByRole("button", { name: MANAGE })).toBeTruthy();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("a successful row mint flips the row to Manage private link once the copy feedback clears", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: MINTED_URL }),
    });
    render(<ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />);

    fireEvent.click(screen.getByRole("button", { name: GET }));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    // "Link copied!" clears after 2 s; the idle label must then read Manage,
    // never "Get private link" over a link the mint just confirmed.
    await waitFor(
      () => expect(screen.getByRole("button", { name: MANAGE })).toBeTruthy(),
      { timeout: 4000 },
    );
  });

  it("a failed mint never claims a live link", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />);

    fireEvent.click(screen.getByRole("button", { name: GET }));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    // The failure copy clears after 4 s.
    await waitFor(
      () => expect(screen.getByRole("button", { name: GET })).toBeTruthy(),
      { timeout: 6000 },
    );
    expect(screen.queryByRole("button", { name: MANAGE })).toBeNull();
  }, 10_000);
});

/**
 * Phase 170.6.1 plan 06 round 2 — a successful private-link mint must leave a
 * VISIBLE outcome, whatever the clipboard does.
 *
 * THE DEFECT: the mint (the part that creates a live capability URL) succeeded
 * and the only thing told to the user was a 2-second clipboard flash. If
 * `writeText` rejected, or never settled (a pending permission prompt), the
 * button simply went back to "Get private link" / "Manage private link": no
 * message, and no URL anywhere. The unpublished lane's "Copy failed — copy the
 * URL manually" pointed at a URL that was never shown, and the Private link
 * dialog (the published-style "Manage" panel) only offers a second Copy button
 * and Revoke: it prints no URL.
 *
 * THE FIX UNDER TEST: when the copy did not land, the Private link dialog opens
 * with the URL in a read-only, pre-selected field, and the clipboard wait is
 * bounded so a hung `writeText` cannot hold the UI silent. A clean copy keeps
 * today's flash and opens nothing.
 */
describe("ShareableLink — a minted private link is never left invisible (170.6.1-06 round 2)", () => {
  const MINTED_URL = "https://quantalyze.xyz/factsheet-share/tok-en-visible";
  const FIELD = "Private link URL";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // The dialog mounts the panel through `next/dynamic`; warm the module once
    // so no test pays the cold import inside a waitFor budget.
    await import("@/app/factsheet/[id]/v2/FactsheetView");
  }, 30_000);

  beforeEach(() => {
    fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/share/revoke")) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ url: MINTED_URL }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount() {
    return render(<ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />);
  }

  function clickGet() {
    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));
  }

  /** The URL field, read-only, as a screen reader finds it. */
  async function findField(): Promise<HTMLInputElement> {
    return (await screen.findByLabelText(FIELD)) as HTMLInputElement;
  }

  it("clipboard rejects and the fallback fails: the Private link dialog opens and shows the minted URL, selectable", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(vi.fn().mockReturnValue(false));
    mount();

    clickGet();

    const field = await findField();
    expect(field.value).toBe(MINTED_URL);
    expect(field.readOnly).toBe(true);
    expect(screen.getByText("Private link")).toBeTruthy();
    // Selectable AND ready to copy: the whole URL is already selected and the
    // field holds focus, so one Ctrl/Cmd-C finishes the job the clipboard API
    // refused.
    //
    // AWAIT the focus; never assert it synchronously after findField. The
    // field lands in the DOM in the commit, but `showModal` (Modal) and the
    // focus+select (ShareableLink) both run from passive useEffects, by design:
    // the field's effect must run after showModal, which moves focus to Close.
    // This update starts after `await fetch`, so it is not a sync lane, and on a
    // CPU-starved worker the Scheduler yields before the passive-effect task.
    // findField resolves on the DOM insertion alone and the assert read <body>
    // with the dialog not yet open (CI runs 38744823426, 38758942630). Same
    // class as the close assert in the revoke test above. A component that
    // never focuses the field still fails here, on the waitFor timeout.
    await waitFor(() => {
      expect(field.closest("dialog")?.open).toBe(true);
      expect(document.activeElement).toBe(field);
    });
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(MINTED_URL.length);
    // The row's own copy message is still honest, and now has a URL to point at.
    expect(
      screen.getByRole("button", { name: /Copy failed — copy the URL manually/ }),
    ).toBeTruthy();
  });

  it("clipboard NEVER settles: after the bound the dialog opens with the URL instead of leaving the UI silent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setClipboard({ writeText: vi.fn().mockReturnValue(new Promise<void>(() => {})) });
    setExecCommand(vi.fn().mockReturnValue(false));
    mount();

    clickGet();
    // The mint resolves; the clipboard is now hanging. Nothing is shown yet,
    // and nothing may claim a copy that has not happened.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(screen.queryByRole("button", { name: /Link copied!/ })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect((await findField()).value).toBe(MINTED_URL);
    expect(screen.queryByRole("button", { name: /Link copied!/ })).toBeNull();
  });

  it("clipboard hangs but the synchronous fallback copies: 'Link copied!' and no dialog", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setClipboard({ writeText: vi.fn().mockReturnValue(new Promise<void>(() => {})) });
    setExecCommand(vi.fn().mockReturnValue(true));
    mount();

    clickGet();
    // Just past the 3 s bound, inside the 2 s "Link copied!" flash.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByRole("button", { name: /Link copied!/ })).toBeTruthy();
    expect(screen.queryByLabelText(FIELD)).toBeNull();
  });

  it("a clean copy keeps today's flash and opens nothing", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    mount();

    clickGet();

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("a failed mint opens no dialog: there is no URL to show", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    mount();

    clickGet();

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(
        /Couldn't create the link — try again/,
      ),
    );
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("the URL stays reachable through 'Manage private link' after the dialog is closed, and is gone once the link is revoked", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(vi.fn().mockReturnValue(false));
    mount();
    clickGet();
    await findField();

    // Close through the native close (the v0.131.5.3 rule: await it).
    //
    // FIND the Close button; never get it synchronously after findField. The
    // field is in the DOM at commit, but `showModal` runs from Modal's passive
    // useEffect, and until it runs the <dialog> has no `open` attribute, so
    // jsdom's default stylesheet hides it and every role inside it is
    // inaccessible. This update starts after `await fetch`, so it is not a sync
    // lane; on a CPU-starved worker the Scheduler yields before the
    // passive-effect task and getByRole found no "Close" (CI run 38766733041).
    // findByRole resolves once the dialog is open; a component that never
    // opens it still fails, on the findByRole timeout.
    const closeSpy = vi.spyOn(HTMLDialogElement.prototype, "close");
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText(FIELD)).toBeNull();

    // The row now reads Manage (the mint confirmed a live link) and reopens the
    // dialog with the same URL.
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Manage private link" })).toBeTruthy(),
      { timeout: 6000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage private link" }));
    expect((await findField()).value).toBe(MINTED_URL);

    // Revoke it: the link is dead, so the URL must not survive in the row.
    fireEvent.click(await screen.findByRole("button", { name: "Revoke link" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Get private link" })).toBeTruthy(),
    );
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(2));

    // A later mint that copies cleanly must not resurrect the revoked URL.
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    clickGet();
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Manage private link" })).toBeTruthy(),
      { timeout: 4000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage private link" }));
    await screen.findByRole("button", { name: "Revoke link" });
    expect(screen.queryByLabelText(FIELD)).toBeNull();
  }, 20_000);
});
