/**
 * RequestIntroButton — the allocator's primary next step on the factsheet
 * (Phase 196 D-02, ROUTE-04).
 *
 * WHY these arms exist: the button is the one accent-filled call to action an
 * allocator sees, and the states a reviewer cannot see in a diff are exactly
 * the ones that lose a lead or double-bill a manager's inbox: a disabled
 * "checking" label that reads "..." tells a screen reader nothing, a
 * double click that posts twice sends the manager two introduction requests
 * for one allocator and one strategy, and a failed send that closes the modal
 * leaves the allocator believing the request went out. Each arm below fails
 * if its behaviour is removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RequestIntroButton } from "./RequestIntroButton";

const STRATEGY_ID = "strategy-1";

// The existing-request check: auth.getUser resolves a user, then the
// contact_requests select chain resolves `existingRow`.
let existingRow: { id: string; status: string } | null = null;
let getUserGate: Promise<void> = Promise.resolve();
let existingError: { message: string } | null = null;
let getUserThrows: Error | null = null;
const captureToSentry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry }));

// 194.2: the attest step mounts AccreditedInvestorGate, which reads the app router.
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        await getUserGate;
        if (getUserThrows) throw getUserThrows;
        return { data: { user: { id: "allocator-1" } } };
      },
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: existingRow, error: existingError }),
      };
      return chain;
    },
  }),
}));

// jsdom ships HTMLDialogElement without showModal/close; the Modal primitive
// calls both. Mirror the open attribute so role queries see the dialog.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
    (this as unknown as { open: boolean }).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    (this as unknown as { open: boolean }).open = false;
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  existingRow = null;
  existingError = null;
  getUserThrows = null;
  captureToSentry.mockReset();
  refresh.mockReset();
  getUserGate = Promise.resolve();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

async function openModal() {
  const trigger = await screen.findByRole("button", { name: "Request intro" });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  return screen.findByRole("dialog");
}

describe("RequestIntroButton — checking state", () => {
  it("reads Request intro, disabled and aria-busy while the existing-request check runs, never an ellipsis", async () => {
    let release!: () => void;
    getUserGate = new Promise<void>((r) => {
      release = r;
    });
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);

    const button = screen.getByRole("button", { name: "Request intro" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.textContent).not.toContain("...");

    release();
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-busy", "false");
  });
});

describe("RequestIntroButton — send flow", () => {
  it("opens a dialog titled Request an introduction with Send request and Close without sending", async () => {
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    const dialog = await openModal();

    expect(
      screen.getByRole("heading", { name: "Request an introduction" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveAttribute("open");
    expect(
      screen.getByRole("button", { name: "Send request" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close without sending" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("Close without sending closes the dialog and sends nothing", async () => {
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    const dialog = await openModal();

    fireEvent.click(
      screen.getByRole("button", { name: "Close without sending" }),
    );

    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Send request posts once to /api/intro with the strategy id and then shows the pending badge", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/intro");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      strategy_id: STRATEGY_ID,
    });
  });
});

const NOT_SENT = "Your request was not sent. Check your connection and try again.";

describe("RequestIntroButton — one request per click burst", () => {
  it("two synchronous clicks on Send request call fetch exactly once", async () => {
    // Held open so the first request is still in flight when the second
    // click lands; resolving it afterwards keeps the test free of dangling work.
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();

    const send = screen.getByRole("button", { name: "Send request" });
    // Both clicks land inside ONE act(): React batches the setUiState("loading")
    // so the button is not yet disabled when the second click arrives. Two
    // separate fireEvent calls would flush the re-render in between and the
    // disabled attribute alone would pass this arm, proving nothing about the ref.
    act(() => {
      send.click();
      send.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse(200, { ok: true }));
    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("RequestIntroButton — duplicate and failure outcomes", () => {
  it("a 409 from /api/intro shows the pending badge, not an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "Already requested" }));
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(screen.queryByText("Already requested")).toBeNull();
    expect(screen.queryByText(NOT_SENT)).toBeNull();
  });

  it("a network failure keeps the dialog open, says the request was not sent and re-enables Send request", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    const dialog = await openModal();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText(NOT_SENT)).toBeInTheDocument();
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  it("a retry after a failed send posts again (the in-flight guard is released)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText(NOT_SENT);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a non-ok response with a JSON error string shows that string", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: "Account not approved" }));
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Account not approved")).toBeInTheDocument();
    expect(screen.queryByText(NOT_SENT)).toBeNull();
  });

  it("a non-ok response with no JSON body shows the not-sent sentence", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500));
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText(NOT_SENT)).toBeInTheDocument();
  });
});

describe("RequestIntroButton — the existing-request check fails (SF-03)", () => {
  it("a thrown read leaves the button enabled and idle, and is reported", async () => {
    getUserThrows = new Error("auth blip");
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);

    const button = screen.getByRole("button", { name: "Request intro" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(captureToSentry).toHaveBeenCalledWith(
      getUserThrows,
      expect.objectContaining({ tags: { area: "request-intro-existing-check" } }),
    );
  });

  it("a returned contact_requests read error does the same, never reading as no request silently", async () => {
    existingError = { message: "permission denied" };
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);

    const button = screen.getByRole("button", { name: "Request intro" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(captureToSentry).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("permission denied") }),
      expect.objectContaining({ tags: { area: "request-intro-existing-check" } }),
    );
  });

  it("a clean read reports nothing", async () => {
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await openModal();
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});

describe("RequestIntroButton — existing request", () => {
  it("renders the status badge and message and no trigger when a request already exists", async () => {
    existingRow = { id: "req-1", status: "intro_made" };
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);

    expect(await screen.findByText("Introduction in progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request intro" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * 194.2 D-03 / D-04 / D-07 — the attest step inside the request.
 *
 * WHY: an approved allocator who never attested saw no actions and no hint on the factsheet
 * (196 round-2 M6), and once /api/intro enforces the attestation a stale page's Send request
 * would dead-end on a refusal. The attest step is a body swap inside the ONE modal, and what the
 * user typed must survive it: losing a written message to a legal checkbox is the failure here.
 * Every expected string is hand-typed.
 */
describe("RequestIntroButton — attest step (194.2)", () => {
  const ATTEST_TITLE = "Attest to request introductions";
  const REQUIRED = { error: "Accredited-investor attestation required", code: "attestation_required" };
  const MSG = "Looking for a market-neutral sleeve";

  /** Routes by URL; `introAnswers` is consumed one per /api/intro POST. */
  function route(introAnswers: Response[], attestation: Response = jsonResponse(200, { ok: true })) {
    const queue = [...introAnswers];
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/attestation" ? attestation : queue.shift() ?? jsonResponse(200, { success: true }),
    );
  }
  const introCalls = () =>
    fetchMock.mock.calls.filter(([u]) => u === "/api/intro").map(([, init]) =>
      JSON.parse((init as RequestInit).body as string),
    );
  async function clickRequestIntro() {
    const trigger = await screen.findByRole("button", { name: "Request intro" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
  }
  function confirmAttest() {
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and request intro" }));
  }

  it("needsAttestation: the click opens the attest step, posts nothing, and shows the in-modal lead", async () => {
    render(<RequestIntroButton strategyId={STRATEGY_ID} needsAttestation />);
    await clickRequestIntro();

    expect(await screen.findByRole("heading", { name: ATTEST_TITLE })).toBeInTheDocument();
    expect(
      screen.getByText(/Before requesting an introduction, please confirm the following:/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proactive confirm opens the request form with focus on the message textarea, and still sends nothing to /api/intro", async () => {
    route([]);
    render(<RequestIntroButton strategyId={STRATEGY_ID} needsAttestation />);
    await clickRequestIntro();
    await screen.findByRole("heading", { name: ATTEST_TITLE });

    confirmAttest();

    expect(await screen.findByRole("heading", { name: "Request an introduction" })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("What are you looking for? (optional)");
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(introCalls()).toHaveLength(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: ATTEST_TITLE })).toBeNull();
  });

  it("proactive dismiss closes the dialog and records and sends nothing", async () => {
    render(<RequestIntroButton strategyId={STRATEGY_ID} needsAttestation />);
    await clickRequestIntro();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close without confirming" }));

    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed attest POST keeps the attest step open with the mapped copy", async () => {
    route([], jsonResponse(429, { error: "Rate limit exceeded" }));
    render(<RequestIntroButton strategyId={STRATEGY_ID} needsAttestation />);
    await clickRequestIntro();
    await screen.findByRole("heading", { name: ATTEST_TITLE });
    confirmAttest();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a minute.",
    );
    expect(screen.getByRole("heading", { name: ATTEST_TITLE })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Rate limit exceeded");
  });

  it("reactive: a 403 attestation_required swaps the open modal to the attest step with no error line, then confirm re-submits with the typed message and mandate", async () => {
    route([jsonResponse(403, REQUIRED), jsonResponse(200, { success: true })]);
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await clickRequestIntro();
    fireEvent.change(screen.getByPlaceholderText("What are you looking for? (optional)"), {
      target: { value: MSG },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add mandate context/ }));
    fireEvent.change(screen.getByPlaceholderText(/Mandate details/), {
      target: { value: "Two-year horizon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("heading", { name: ATTEST_TITLE })).toBeInTheDocument();
    // one dialog at a time: the request form is gone while the attest step shows
    expect(screen.queryByRole("heading", { name: "Request an introduction" })).toBeNull();
    expect(screen.queryByText(REQUIRED.error)).toBeNull();

    confirmAttest();

    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    const posts = introCalls();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({
      strategy_id: STRATEGY_ID,
      message: MSG,
      mandate_context: { freeform: "Two-year horizon" },
    });
  });

  it("reactive dismiss returns to the form with the typed fields intact, no error line, and nothing re-sent", async () => {
    route([jsonResponse(403, REQUIRED)]);
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await clickRequestIntro();
    fireEvent.change(screen.getByPlaceholderText("What are you looking for? (optional)"), {
      target: { value: MSG },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByRole("heading", { name: ATTEST_TITLE });

    fireEvent.click(screen.getByRole("button", { name: "Close without confirming" }));

    expect(await screen.findByRole("heading", { name: "Request an introduction" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What are you looking for? (optional)")).toHaveValue(MSG);
    expect(screen.queryByText(NOT_SENT)).toBeNull();
    expect(screen.queryByText(REQUIRED.error)).toBeNull();
    expect(introCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/attestation")).toBe(false);
  });

  it("reactive: a failed re-submit lands in the form's error line with the typed message intact", async () => {
    route([jsonResponse(403, REQUIRED), jsonResponse(500, { error: "Failed to create request" })]);
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await clickRequestIntro();
    fireEvent.change(screen.getByPlaceholderText("What are you looking for? (optional)"), {
      target: { value: MSG },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByRole("heading", { name: ATTEST_TITLE });
    confirmAttest();

    expect(await screen.findByText("Failed to create request")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What are you looking for? (optional)")).toHaveValue(MSG);
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  it("a 500 attestation_check_failed shows the check-failed sentence in the form's error line, not raw JSON", async () => {
    route([
      jsonResponse(500, { error: "Could not check attestation", code: "attestation_check_failed" }),
    ]);
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await clickRequestIntro();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(
      await screen.findByText("We could not check your attestation. Try again in a minute."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Could not check attestation")).toBeNull();
    expect(screen.queryByRole("heading", { name: ATTEST_TITLE })).toBeNull();
  });

  it("an attested viewer (no needsAttestation) never sees the attest step on click", async () => {
    render(<RequestIntroButton strategyId={STRATEGY_ID} />);
    await clickRequestIntro();
    expect(await screen.findByRole("heading", { name: "Request an introduction" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ATTEST_TITLE })).toBeNull();
  });
});
