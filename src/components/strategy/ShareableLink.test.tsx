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

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { ShareableLink, ShareMintError } from "./ShareableLink";

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

// `OwnerUnpublishedPanel` loads through `next/dynamic`, which in Next 16.4.2 is
// a react-loadable singleton, so the first mount in this file pays the whole
// `FactsheetView` import. Under CPU load that exceeded `findByRole`'s 1 s
// default on CI (TODOS `170.6.2-SHAREABLELINK-D05-RED`). Warming it once at file
// level covers every describe, including ones added later. Never raise a global
// timeout instead (D-11).
beforeAll(async () => {
  await import("@/app/factsheet/[id]/v2/FactsheetView");
}, 30_000);

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

    // Phase 208 (D-10): the published lane now opens a Public link dialog on
    // this failure, so a bare `getByRole("button")` would see several buttons.
    // Name the row button instead.
    const row = await screen.findByRole("button", {
      name: /Copy failed — copy the URL manually/,
    });
    // Belt-and-suspenders: success copy must NOT be visible.
    expect(row.textContent).not.toMatch(/Link copied!/);
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

    // Named query: the published lane's dialog adds its own buttons (D-10).
    expect(
      await screen.findByRole("button", {
        name: /Copy failed — copy the URL manually/,
      }),
    ).toBeTruthy();
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
 * Phase 208 (SC-3, SC-4; D-05..D-07, D-13) — a share-mint failure is logged with
 * the strategy id, says what actually happened, and is announced.
 *
 * WHY: every mint failure used to read "Couldn't create the link — try again",
 * so a signed-out owner, or one who lost the strategy, retried for ever while
 * the catch discarded the error and support saw nothing.
 */
describe("ShareableLink — share failures say what happened (Phase 208, D-05..D-07, D-13)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let writeText: Mock<(s: string) => Promise<void>>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeText = vi.fn<(s: string) => Promise<void>>().mockResolvedValue(undefined);
    setClipboard({ writeText });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function loggedErr(): unknown {
    const call = warnSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "[ShareableLink] share mint failed",
    );
    expect(call, "the mint catch must log").toBeDefined();
    return (call as unknown[])[1];
  }

  it("a 404 mint says the owner can't share here, logs { strategyId, err } with the status, and announces it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toContain(
        "You can't share this strategy here",
      ),
    );
    const text = screen.getByRole("button").textContent ?? "";
    expect(text).not.toMatch(/Link copied!/);
    expect(text).not.toMatch(/try again/i);
    expect(text).not.toMatch(/retry/i);
    expect(writeText).not.toHaveBeenCalled();

    const logged = loggedErr() as { strategyId: string; err: unknown };
    expect(logged.strategyId).toBe(STRATEGY_ID);
    expect(logged.err).toBeInstanceOf(ShareMintError);
    expect((logged.err as ShareMintError).status).toBe(404);
    // The message carries a status only: the minted URL is a capability and
    // this error is logged (T-208-06).
    expect((logged.err as ShareMintError).message).toBe("share mint failed: 404");

    expect(screen.getByRole("status").textContent).toBe(
      "You can't share this strategy here",
    );
  });

  const SIGNED_OUT = "Signed out — sign in again to share";
  const FORBIDDEN = "You can't share this strategy here";
  const TRY_AGAIN = "Couldn't create the link — try again";

  async function clickAndSettle(): Promise<string> {
    render(<ShareableLink strategyId={STRATEGY_ID} published={false} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).not.toMatch(
        /Get private link|Creating link/,
      ),
    );
    return screen.getByRole("button").textContent ?? "";
  }

  it("a 401 mint reads signed out, never 'try again', and the region carries the same text", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const text = await clickAndSettle();
    expect(text).toContain(SIGNED_OUT);
    expect(text).not.toMatch(/try again/i);
    expect(text).not.toMatch(/retry/i);
    expect(screen.getByRole("status").textContent).toBe(SIGNED_OUT);
    expect(((loggedErr() as { err: ShareMintError }).err).status).toBe(401);
  });

  it("D-13: a fetch redirected to /login (the proxy's answer to a signed-out POST) is a 401, not 'try again'", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: "https://example.test/login",
      json: async () => {
        throw new Error("html");
      },
    });
    const text = await clickAndSettle();
    expect(text).toContain(SIGNED_OUT);
    expect(text).not.toMatch(/try again/i);
    const err = (loggedErr() as { err: ShareMintError }).err;
    expect(err).toBeInstanceOf(ShareMintError);
    expect(err.status).toBe(401);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("a redirect to a path other than /login is not read as signed out", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: "https://example.test/elsewhere",
      json: async () => {
        throw new Error("html");
      },
    });
    const text = await clickAndSettle();
    expect(text).toContain(TRY_AGAIN);
    expect(text).not.toContain(SIGNED_OUT);
  });

  it("a 403 mint reads the shared non-revealing string, never 'try again'", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const text = await clickAndSettle();
    expect(text).toContain(FORBIDDEN);
    expect(text).not.toMatch(/try again/i);
    expect(text).not.toMatch(/retry/i);
    expect(screen.getByRole("status").textContent).toBe(FORBIDDEN);
  });

  it.each([
    ["a 500", { ok: false, status: 500, json: async () => ({}) }],
    ["a 429", { ok: false, status: 429, json: async () => ({}) }],
    ["a 503", { ok: false, status: 503, json: async () => ({}) }],
    [
      "a 200 whose body is unparseable",
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      },
    ],
    ["a 200 with no url", { ok: true, status: 200, json: async () => ({}) }],
    ["a rejected fetch", new TypeError("Failed to fetch")],
  ])("%s keeps the retryable label, logs once and writes nothing to the clipboard", async (_name, outcome) => {
    if (outcome instanceof Error) fetchMock.mockRejectedValue(outcome);
    else fetchMock.mockResolvedValue(outcome);
    const text = await clickAndSettle();
    expect(text).toContain(TRY_AGAIN);
    expect(screen.getByRole("status").textContent).toBe(TRY_AGAIN);
    const logs = warnSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === "[ShareableLink] share mint failed",
    );
    expect(logs).toHaveLength(1);
    expect((logs[0][1] as { strategyId: string }).strategyId).toBe(STRATEGY_ID);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("the row region announces the copy failure too (published lane, both clipboard paths refuse)", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => false);
    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    fireEvent.click(screen.getByRole("button"));
    const row = await screen.findByRole("button", {
      name: /Copy failed — copy the URL manually/,
    });
    // The row's region is the row button's next sibling. Phase 208 (D-10): the
    // published lane's dialog carries a status region of its own, so
    // `getByRole("status")` would find two.
    const region = row.nextElementSibling;
    expect(region?.getAttribute("role")).toBe("status");
    await waitFor(() =>
      expect(region?.textContent).toBe("Copy failed — copy the URL manually"),
    );
  });

  it("the region is mounted and empty before any click, and success is not announced", async () => {
    render(<ShareableLink strategyId={STRATEGY_ID} published />);
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toMatch(/Link copied!/),
    );
    expect(screen.getByRole("status").textContent).toBe("");
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
      // The button lives in the lazily loaded panel: on a cold module graph
      // this await, and no global setting, carries the budget (D-11).
      await screen.findByRole(
        "button",
        { name: "Copy share link" },
        { timeout: 5000 },
      ),
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
    // Lazy panel button: this await carries the budget, not a global (D-11).
    await screen.findByRole(
      "button",
      { name: "Copy share link" },
      { timeout: 5000 },
    );

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
    // Lazy panel button: this await carries the budget, not a global (D-11).
    await screen.findByRole(
      "button",
      { name: "Revoke link" },
      { timeout: 5000 },
    );
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
    // Lazy panel button: this await carries the budget, not a global (D-11).
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Revoke link" },
        { timeout: 5000 },
      ),
    );
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
    // Lazy panel button: this await carries the budget, not a global (D-11).
    await screen.findByRole(
      "button",
      { name: "Revoke link" },
      { timeout: 5000 },
    );
    expect(screen.queryByLabelText(FIELD)).toBeNull();
  }, 20_000);
});

/**
 * Phase 208 plan 03 (D-05, D-08, D-09, D-15) — the copy-failed dialog has its
 * own Copy link button, and the URL it shows is already on screen.
 *
 * WHY: the dialog's only copy control used to be the panel's mint-and-copy,
 * which minted AGAIN over the network and then awaited a bare `writeText`; on a
 * phone the tap's user activation has expired by then, so it failed a second
 * time. The button here copies the URL that is already shown, straight from the
 * tap, through the same bounded helper the row uses.
 */
describe("ShareableLink — the copy-failed dialog copies the URL on screen (Phase 208, D-05, D-08, D-09, D-15)", () => {
  const MINTED_URL = "https://quantalyze.xyz/factsheet-share/tok-en-on-screen";
  const FIELD = "Private link URL";
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: MINTED_URL }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount() {
    return render(<ShareableLink strategyId={STRATEGY_ID} published={false} size="sm" />);
  }

  /** Row click that fails both copy paths, so the dialog opens with the URL. */
  async function openDialogAfterRowFailure(): Promise<HTMLInputElement> {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => false);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));
    const field = (await screen.findByLabelText(FIELD)) as HTMLInputElement;
    // The dialog opens and the field takes focus from passive effects (see the
    // comment in the "never left invisible" describe above): await both.
    await waitFor(() => {
      expect(field.closest("dialog")?.open).toBe(true);
      expect(document.activeElement).toBe(field);
    });
    return field;
  }

  /** Serialize every logged argument; an Error contributes its message. */
  function loggedText(): string {
    return JSON.stringify(warnSpy.mock.calls, (_k, v) =>
      v instanceof Error ? v.message : v,
    );
  }

  it("the dialog Copy link copies the URL on screen with no second mint, then reads Copied", async () => {
    await openDialogAfterRowFailure();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(MINTED_URL);
    // The URL is already on screen: copying it must not touch the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failed dialog copy reads Copy failed, refocuses and reselects the field, and the dialog region announces it", async () => {
    const field = await openDialogAfterRowFailure();
    const copyBtn = await screen.findByRole("button", { name: "Copy link" });
    // A real tap moves focus to the button first.
    copyBtn.focus();
    expect(document.activeElement).toBe(copyBtn);

    fireEvent.click(copyBtn);

    await screen.findByRole("button", { name: "Copy failed" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(MINTED_URL.length);
    const dialog = field.closest("dialog") as HTMLDialogElement;
    expect(within(dialog).getByRole("status").textContent).toBe("Copy failed");
  });

  it("D-09: iOS ignores focus() outside a gesture, so a failed dialog copy still reselects with an explicit setSelectionRange", async () => {
    await openDialogAfterRowFailure();
    const copyBtn = await screen.findByRole("button", { name: "Copy link" });
    // iOS Safari drops `focus()` here: no focus event, so the field's onFocus
    // never runs and only an explicit range call can reselect the URL.
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "setSelectionRange");
    selectSpy.mockClear();

    fireEvent.click(copyBtn);

    await screen.findByRole("button", { name: "Copy failed" });
    expect(selectSpy).toHaveBeenCalledWith(0, MINTED_URL.length);
  });

  it("D-09: opening the dialog selects the whole URL with an explicit setSelectionRange even when focus() is ignored", async () => {
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "setSelectionRange");
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => false);
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));

    const field = (await screen.findByLabelText(FIELD)) as HTMLInputElement;
    await waitFor(() => expect(field.closest("dialog")?.open).toBe(true));
    await waitFor(() =>
      expect(selectSpy).toHaveBeenCalledWith(0, MINTED_URL.length),
    );
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(MINTED_URL.length);
  });

  it("D-05: both copy catches log { strategyId, err } and no logged argument carries the URL", async () => {
    const blocked = new Error("blocked");
    const unsupported = new Error("execCommand unsupported");
    setClipboard({ writeText: vi.fn().mockRejectedValue(blocked) });
    setExecCommand(() => {
      throw unsupported;
    });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));
    await screen.findByLabelText(FIELD);

    const clip = warnSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "[ShareableLink] clipboard write failed",
    );
    expect(clip).toBeTruthy();
    expect(clip?.[1]).toEqual({ strategyId: STRATEGY_ID, err: blocked });
    expect((clip?.[1] as { err: unknown }).err).toBe(blocked);
    const exec = warnSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "[ShareableLink] execCommand copy failed",
    );
    expect(exec).toBeTruthy();
    expect((exec?.[1] as { strategyId: string; err: unknown }).strategyId).toBe(STRATEGY_ID);
    expect((exec?.[1] as { err: unknown }).err).toBe(unsupported);
    // The minted URL is a capability and console.warn feeds Sentry breadcrumbs.
    expect(loggedText()).not.toContain(MINTED_URL);
    expect(loggedText()).not.toContain("tok-en-on-screen");
  });

  it("D-05: an execCommand that returns false is still logged, with err null", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => false);
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));
    await screen.findByLabelText(FIELD);

    const exec = warnSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "[ShareableLink] execCommand copy failed",
    );
    expect(exec).toBeTruthy();
    expect(exec?.[1]).toEqual({ strategyId: STRATEGY_ID, err: null });
    expect(loggedText()).not.toContain("tok-en-on-screen");
  });

  it("D-15: the fallback's temporary input lives in the body for the row and inside the open dialog for the dialog button", async () => {
    const hosts: Array<{ parent: Element | null; inOpenDialog: boolean }> = [];
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => {
      // The temporary input is the one that is not read-only and holds the URL.
      const temp = Array.from(document.querySelectorAll("input")).find(
        (i) => !i.readOnly && i.value === MINTED_URL,
      );
      hosts.push({
        parent: temp?.parentElement ?? null,
        inOpenDialog: temp?.closest("dialog[open]") != null,
      });
      return false;
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));
    await screen.findByLabelText(FIELD);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].parent).toBe(document.body);
    expect(hosts[0].inOpenDialog).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await screen.findByRole("button", { name: "Copy failed" });

    expect(hosts).toHaveLength(2);
    // WebKit fails `execCommand("copy")` for an input in the inert body while a
    // modal dialog is open (RESEARCH Pitfall 2); inside the dialog it succeeds.
    expect(hosts[1].inOpenDialog).toBe(true);
    // And it is always removed again.
    expect(
      Array.from(document.querySelectorAll("input")).filter((i) => !i.readOnly),
    ).toHaveLength(0);
  });

  const PUBLIC_URL = `https://example.test/factsheet/${STRATEGY_ID}`;

  it("D-10: a published strategy whose two copies both fail opens a Public link dialog holding the public URL, with no owner panel and no fetch", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => false);
    render(<ShareableLink strategyId={STRATEGY_ID} published />);

    fireEvent.click(screen.getByRole("button"));

    const field = (await screen.findByLabelText("Public link URL")) as HTMLInputElement;
    expect(field.value).toBe(PUBLIC_URL);
    // Await the open dialog: queries for ABSENT controls inside a closed
    // <dialog> would pass for the wrong reason.
    await waitFor(() => expect(field.closest("dialog")?.open).toBe(true));
    expect(await screen.findByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByText("Public link")).toBeTruthy();
    expect(screen.queryByText("Private link")).toBeNull();
    expect(
      screen.getByText(
        "This browser would not copy the link for you. Use Copy link, or select the link and copy it yourself.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create share link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy share link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke link" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Copy failed — copy the URL manually/ }),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the published lane stays synchronous: writeText runs inside the click, before any await", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<ShareableLink strategyId={STRATEGY_ID} published />);

    fireEvent.click(screen.getByRole("button"));

    // No `await` between the click and this assertion: a microtask in front of
    // the clipboard call is where Safari drops transient user activation.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PUBLIC_URL);
  });

  it("D-08: a dialog copy whose clipboard never settles ends as Copy failed after the 3 s bound, button enabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    setExecCommand(() => false);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Get private link" }));
    const field = (await screen.findByLabelText(FIELD)) as HTMLInputElement;
    await waitFor(() => expect(field.closest("dialog")?.open).toBe(true));
    const copyBtn = await screen.findByRole("button", { name: "Copy link" });
    setClipboard({ writeText: vi.fn().mockReturnValue(new Promise<void>(() => {})) });

    fireEvent.click(copyBtn);

    const working = screen.getByRole("button", { name: "Copying link…" }) as HTMLButtonElement;
    expect(working.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    const failed = screen.getByRole("button", { name: "Copy failed" }) as HTMLButtonElement;
    expect(failed.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Copying link…" })).toBeNull();
  });
});
