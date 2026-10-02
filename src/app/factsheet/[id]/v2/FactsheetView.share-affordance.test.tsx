import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody, OwnerUnpublishedPanel } from "./FactsheetView";

/**
 * Phase 164 (SHARE-04 / SHARE-01) — the share affordance stops lying.
 *
 * WHY these assertions matter, not just what they check:
 *
 *   1. TWO MECHANISMS, AND THE PUBLISHED ONE IS FROZEN (ruling D-09). Before
 *      this phase `ShareLinkButton` built `<origin><pathname>?share=1`
 *      unconditionally, so an owner of an UNPUBLISHED strategy copied a link
 *      that 404s for its recipient — and the button said "Link copied", which
 *      is why nobody caught it from the UI. The fix is a branch. The published
 *      arm must therefore be pinned in BOTH directions: it still produces the
 *      query-param URL, and it never touches the mint route. A regression that
 *      "unified" the two lanes onto the token would satisfy a naive
 *      "did-we-copy-something" test and silently replace a working public URL
 *      with a capability whose revocation promises nothing.
 *
 *   2. NO SUCCESS FLASH FOR A LINK THAT CANNOT WORK (T-164-15). This is the
 *      whole SHARE-04 sentence. The mint happens over the network BEFORE the
 *      clipboard write, so there are two independent ways to fail, and both
 *      must land in the same visible failure state. `copied` is allowed on
 *      exactly one path.
 *
 *   3. THE NOTICE IS A DISCLOSURE WHOSE TRUTH VALUE CHANGED. "Anyone else who
 *      opens this link sees a 404" becomes FALSE the moment a share token
 *      exists. Asserting the ABSENCE of that sentence in the live-link state is
 *      the point of the pair — a test that only checked the new sentence was
 *      present would pass with both sentences rendered, i.e. with the platform
 *      contradicting itself on one screen.
 *
 * Copy literals and URL shapes are typed HERE, never imported from
 * FactsheetView.tsx — an imported constant makes the oracle self-referential and
 * a copy rewrite could never fail this file. Harness (localStorage / dialog /
 * next-navigation stubs) is the one from FactsheetView.owner-notice.test.tsx,
 * for the same reasons.
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

const STRATEGY_ID = "77777777-7777-4777-8777-777777777777";

const populatedPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
  strategyId: STRATEGY_ID,
});

// --- Copy + URL literals, typed by hand -------------------------------------

const LABEL_COPY = "Copy share link";
const LABEL_CREATE = "Create share link";
const LABEL_COPIED = "Link copied";
const LABEL_FAILED = "Couldn't copy the link — try again";
const LABEL_REVOKE = "Revoke link";
const CONFIRM_SENTENCE =
  "Revoke this share link? Anyone with the link will lose access.";
const KEEP_LINK = "Keep link";
const REVOKE_FAILED = "Couldn't revoke this link. Try again.";

/** The one sentence that becomes FALSE once a share token exists. */
const FOUR_OH_FOUR_CLAIM =
  "Anyone else who opens this link sees a 404 until Quantalyze review publishes it.";
/** The sentence that is true only in the live-link state. */
const LIVE_LINK_CLAIM =
  "A private share link is live: anyone holding that link can view this factsheet until you revoke it.";

const MINTED_URL = "https://quantalyze.xyz/factsheet-share/abc123token";
const MINT_PATH = `/api/strategies/${STRATEGY_ID}/share`;
const REVOKE_PATH = `/api/strategies/${STRATEGY_ID}/share/revoke`;

// --- Clipboard + fetch doubles ----------------------------------------------

let writeText: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

/** Install a clipboard whose write RESOLVES (the happy transport). */
function givenClipboardWorks() {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/** Install a clipboard whose write REJECTS (permission denied / non-HTTPS). */
function givenClipboardDenied() {
  writeText = vi.fn(() => Promise.reject(new Error("denied")));
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/** Remove the clipboard API entirely — the arm optional chaining would hide. */
function givenNoClipboardApi() {
  writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  givenClipboardWorks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Mount helper -----------------------------------------------------------

function renderBody(
  props: {
    ownerShare?: { hasActiveShare: boolean };
    viewerNotice?: "owner_unpublished" | "shared_privately";
    recipientShare?: boolean;
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

function shareButton(container: HTMLElement): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    [LABEL_COPY, LABEL_CREATE, LABEL_COPIED, LABEL_FAILED].includes(
      b.textContent ?? "",
    ),
  );
  expect(btn, "the share control must be on screen").toBeDefined();
  return btn as HTMLButtonElement;
}

// ---------------------------------------------------------------------------

describe("D-09 — the PUBLISHED lane is byte-identical: query-param URL, no mint", () => {
  it("copies <origin><pathname>?share=1 and NEVER calls the mint route", async () => {
    const { container } = renderBody();

    const btn = shareButton(container);
    expect(btn.textContent).toBe(LABEL_COPY);
    fireEvent.click(btn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const written = writeText.mock.calls[0][0] as string;

    // The exact shape the pre-phase-164 handler produced. `window.location` is
    // the ENVIRONMENT, not the module under test, so reading it here is not a
    // self-referential oracle — the load-bearing claims are the `?share=1`
    // suffix and the absence of anything token-shaped.
    expect(written).toBe(
      `${window.location.origin}${window.location.pathname}?share=1`,
    );
    expect(written).toMatch(/\?share=1$/);
    expect(
      written,
      "a published strategy must NOT be handed a capability token — D-09",
    ).not.toContain("/factsheet-share/");

    // The strongest half of the pin: the published lane does not talk to the
    // mint route at all. A "unify the lanes onto the token" regression fails
    // here even if it kept the label and the flash intact.
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_COPIED));
  });

  it("a clipboard denial leaves the label alone and flashes NO success (FINDING-9, unchanged)", async () => {
    givenClipboardDenied();
    const { container } = renderBody();

    fireEvent.click(shareButton(container));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(container.textContent).not.toContain(LABEL_COPIED);
    expect(shareButton(container).textContent).toBe(LABEL_COPY);
  });
});

describe("SHARE-01 — the UNPUBLISHED owner lane mints-or-reuses, then copies", () => {
  it("with NO live link the control offers to CREATE one, and mints then copies the returned url", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });

    const btn = shareButton(container);
    expect(
      btn.textContent,
      "no live link yet — the affordance is to create one, not to copy one",
    ).toBe(LABEL_CREATE);

    fireEvent.click(btn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(MINT_PATH);
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST");
    // The url written is the one the ROUTE returned — never a locally rebuilt
    // one. This is the assertion that fails if someone "optimises" the mint
    // away and falls back to the id URL for an unpublished strategy.
    expect(writeText.mock.calls[0][0]).toBe(MINTED_URL);

    await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_COPIED));
  });

  it("with a live link the label is COPY (re-minting returns the same url — mint-or-REUSE)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });

    expect(shareButton(container).textContent).toBe(LABEL_COPY);
    fireEvent.click(shareButton(container));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINTED_URL));
  });

  it("after a successful mint the notice flips to the live-link sentence in the same tick", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });

    expect(container.textContent).toContain(FOUR_OH_FOUR_CLAIM);

    fireEvent.click(shareButton(container));

    // The page must not keep telling the owner that recipients get a 404 while
    // a link it just minted is live.
    await waitFor(() => expect(container.textContent).toContain(LIVE_LINK_CLAIM));
    expect(container.textContent).not.toContain(FOUR_OH_FOUR_CLAIM);
  });
});

describe("T-164-15 — NO success flash for a link that cannot work", () => {
  it("a non-2xx mint surfaces the failure state and never says Link copied", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(shareButton(container));

    await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_FAILED));
    expect(writeText, "nothing may be copied when nothing was minted").not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(LABEL_COPIED);
  });

  it("a 200 whose body carries NO url is a failure, not a copy of `undefined`", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(shareButton(container));

    await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_FAILED));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("a successful mint whose CLIPBOARD write is denied still fails visibly", async () => {
    // Two independent failure sources, one honest outcome. The mint SUCCEEDED
    // here, so the link is genuinely live — the notice flips — but nothing
    // reached the clipboard, so the button must not claim it did.
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    givenClipboardDenied();
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(shareButton(container));

    await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_FAILED));
    expect(container.textContent).not.toContain(LABEL_COPIED);
    // …and the live-link disclosure is still correct: a row exists.
    expect(container.textContent).toContain(LIVE_LINK_CLAIM);
  });

  it("an ABSENT clipboard API fails — `await undefined` must not read as success", async () => {
    // The specific bug this guards: `await navigator.clipboard?.writeText(url)`
    // resolves to `undefined` when the API is missing, so an optional-chained
    // await would flash "Link copied" having copied nothing at all.
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    givenNoClipboardApi();
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(shareButton(container));

    await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_FAILED));
    expect(container.textContent).not.toContain(LABEL_COPIED);
  });
});

describe("D-03 / SHARE-03 — revoke lives on the factsheet, with an INLINE confirm", () => {
  it("renders ONLY when a link is live", () => {
    const withLink = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });
    expect(withLink.container.textContent).toContain(LABEL_REVOKE);

    const withoutLink = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });
    expect(
      withoutLink.container.textContent,
      "nothing to revoke ⇒ no control; an inert Revoke button is a lie about state",
    ).not.toContain(LABEL_REVOKE);
  });

  it("click shows the inline confirm — never a browser dialog", () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });

    const trigger = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === LABEL_REVOKE,
    )!;
    fireEvent.click(trigger);

    expect(container.textContent).toContain(CONFIRM_SENTENCE);
    expect(container.textContent).toContain(KEEP_LINK);
    expect(
      confirmSpy,
      "window.confirm blocks the tab and cannot be styled or announced — never use it",
    ).not.toHaveBeenCalled();
  });

  it("`Keep link` dismisses the confirm and revokes nothing", () => {
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === LABEL_REVOKE,
      )!,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === KEEP_LINK,
      )!,
    );

    expect(container.textContent).not.toContain(CONFIRM_SENTENCE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(LABEL_REVOKE);
  });

  it("a 200 revoke flips the UI to revoked and re-offers CREATE", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { revoked: true }));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === LABEL_REVOKE,
      )!,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Revoke",
      )!,
    );

    await waitFor(() =>
      expect(container.textContent).not.toContain(LABEL_REVOKE),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(REVOKE_PATH);
    // The next mint click starts a fresh link, so the affordance goes back to
    // "create".
    expect(shareButton(container).textContent).toBe(LABEL_CREATE);
    // …and the disclosure returns to its conservative sentence.
    expect(container.textContent).toContain(FOUR_OH_FOUR_CLAIM);
    expect(container.textContent).not.toContain(LIVE_LINK_CLAIM);
  });

  it("a 404 CONVERGES to revoked — 'already gone' is not 'revoke failed'", async () => {
    // The route 404s when there is no active share to revoke: a double-revoke
    // across two tabs, a stale live flag, an already-expired share. The link IS
    // gone, so the end state matches a 200. Showing an error the owner cannot
    // act on would be the platform reporting its own convergence as a fault.
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === LABEL_REVOKE,
      )!,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Revoke",
      )!,
    );

    await waitFor(() =>
      expect(container.textContent).not.toContain(LABEL_REVOKE),
    );
    expect(container.textContent).not.toContain(REVOKE_FAILED);
    expect(container.textContent).toContain(FOUR_OH_FOUR_CLAIM);
  });

  it("a 500 revoke is an HONEST failure — the link stays live and the controls stay put", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === LABEL_REVOKE,
      )!,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Revoke",
      )!,
    );

    await waitFor(() => expect(container.textContent).toContain(REVOKE_FAILED));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(REVOKE_FAILED);
    // Still live: the Revoke control and the live-link sentence both remain.
    expect(container.textContent).toContain(LABEL_REVOKE);
    expect(container.textContent).toContain(LIVE_LINK_CLAIM);
  });
});

describe("SHARE-04 — the owner notice states only TRUE sentences", () => {
  it("with NO live link it keeps the 404 claim and mentions the private-link option", () => {
    const { container } = renderBody({
      ownerShare: { hasActiveShare: false },
      viewerNotice: "owner_unpublished",
    });
    const note = container.querySelector('section[role="note"]')!;

    expect(note.textContent).toContain("Unpublished — only you can see this");
    expect(note.textContent).toContain(FOUR_OH_FOUR_CLAIM);
    expect(note.textContent).not.toContain(LIVE_LINK_CLAIM);
  });

  it("with a LIVE link the 404 claim is ABSENT and the live-link sentence is present", () => {
    const { container } = renderBody({
      ownerShare: { hasActiveShare: true },
      viewerNotice: "owner_unpublished",
    });
    const note = container.querySelector('section[role="note"]')!;

    // Absence is the load-bearing half. Both sentences rendered together would
    // be the platform contradicting itself on one screen.
    expect(note.textContent).not.toContain(FOUR_OH_FOUR_CLAIM);
    expect(note.textContent).not.toContain("only you can see this");
    expect(note.textContent).toContain(LIVE_LINK_CLAIM);
    expect(note.textContent).toContain("not published");
  });
});

describe("absence is the default — no ownerShare means no owner controls at all", () => {
  it("the default mount renders the published control and NO revoke control", () => {
    const { container } = renderBody();
    expect(container.textContent).toContain(LABEL_COPY);
    expect(container.textContent).not.toContain(LABEL_CREATE);
    expect(container.textContent).not.toContain(LABEL_REVOKE);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION — the pending factsheet promised a share link it could not mint
// ---------------------------------------------------------------------------
//
// FOUND IN BROWSER UAT 2026-08-28, not by any test in this phase. `page.tsx`'s
// pending-state early return (the "still computing" placeholder) rendered
// `OwnerUnpublishedNotice` ALONE. That notice ends with "You can create a
// private share link to let someone view it without publishing" — and the page
// had zero clickable elements. Same SHARE-04 dishonesty class the describe
// block above closes, reappearing on the one render path the class review
// never walked, and on the path the placeholder's own comment calls the moment
// "an owner is MOST likely to share the URL".
//
// ⛔ WHY BOTH HALVES. Arm 1 pins the COMPONENT's intent: a notice that promises
// a capability ships the control for it. Arm 2 pins the WIRING, because a green
// arm 1 says nothing about whether `page.tsx` actually mounts the panel — the
// bug was never in the notice, it was in what the pending return chose to
// render. Testing the fix's helper is not testing the call site (the measured
// lesson from the high-tackle plan).
//
// ⚠️ HONEST LIMIT, MEASURED WHILE DEMONSTRATING THESE ARMS RED. They pin DOM
// PRESENCE, not visibility: mutating the controls' wrapper to `className=
// "hidden"` left all three arms GREEN, because jsdom does no layout. The arms
// go red on the shape the bug actually had — the panel reduced to the bare
// notice (arms 1-2), and `page.tsx` rendering that bare notice (arm 3), both
// OBSERVED red. A control that renders but is styled invisible would slip
// past; that is a visual-regression job, not this file's.
describe("REGRESSION — a notice that promises a share link ships the control", () => {
  it("the panel renders the promise sentence AND a control that can act on it", () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    const { container } = render(
      <OwnerUnpublishedPanel strategyId={STRATEGY_ID} />,
    );

    // The promise is on screen...
    expect(container.textContent).toContain(
      "You can create a private share link to let someone view it without publishing.",
    );
    // ...and so is the thing that keeps it. This is the assertion the pending
    // page failed: prose without an affordance.
    const btn = shareButton(container);
    expect(btn.textContent).toBe(LABEL_CREATE);
  });

  it("minting flips the notice AND surfaces revoke — one state, so neither claim can go stale", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }));
    const { container } = render(
      <OwnerUnpublishedPanel strategyId={STRATEGY_ID} />,
    );

    fireEvent.click(shareButton(container));

    await waitFor(() => {
      expect(container.textContent).toContain(LIVE_LINK_CLAIM);
    });
    // The live-link sentence promises revocation ("until you revoke it"). If
    // the controls did not hang off the SAME state as the notice, fixing the
    // missing mint button would have manufactured this second false claim.
    expect(container.textContent).not.toContain(FOUR_OH_FOUR_CLAIM);
    const revoke = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "") === LABEL_REVOKE,
    );
    expect(
      revoke,
      "the notice says 'until you revoke it' — the revoke control must exist",
    ).toBeDefined();
  });

  it("page.tsx mounts the PANEL, never the bare notice", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Same convention as page.share-affordance.test.tsx's drift pin: resolve
    // from __dirname, not import.meta.url — this directory is `[id]`, and the
    // brackets come back percent-encoded through a file:// URL.
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");

    // Positive control: without this the negative below passes on a file that
    // renders no owner notice at all (or on a read that silently returned "").
    expect(
      src,
      "page.tsx must render the owner panel — it is the only sanctioned owner-notice renderer here",
    ).toContain("<OwnerUnpublishedPanel");
    // The regression itself: the bare notice carries the promise with no
    // control, so page.tsx must never render it directly on any lane.
    expect(
      src,
      "page.tsx renders <OwnerUnpublishedNotice> directly — that notice promises a share link it ships no control for (browser UAT 2026-08-28). Render OwnerUnpublishedPanel instead.",
    ).not.toContain("<OwnerUnpublishedNotice");
  });
});
