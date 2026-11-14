/**
 * Phase 213 plan 06 (decision (b), SC-2) — a "No strategy yet" row can be
 * disconnected, never deleted.
 *
 * Mounts the REAL `StrategyTable` through the REAL `StrategiesSection`, so the
 * click that matters (the row's own Disconnect control) is the one under test,
 * not a probe of the props. The two reads the confirm makes are the page's own
 * fetch (`/api/keys/[id]/memberships`) and the browser Supabase client's RPC.
 *
 * THE LINE THIS FILE HOLDS. The confirm offers exactly two buttons, Cancel and
 * Disconnect, for every role: no Delete key button and no cascade box. A third
 * button, or a delete RPC, turns a reversible action into a destroyed key, so
 * both are asserted absent rather than assumed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { StrategiesSection } from "./StrategiesSection";

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));
vi.mock("@/app/(dashboard)/allocations/components/ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: () => null,
}));

const captureMock = vi.fn();
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, options: unknown) => captureMock(err, options),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
  }),
}));

const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Feed = { strategy_id: string | null; name: string | null; status: string | null; kind: "single" | "composite" };
const ALPHA: Feed = { strategy_id: S1, name: "Alpha Single", status: "draft", kind: "single" };

const ROWS = [
  { id: K1, exchange: "deribit", exchangeLabel: "Deribit", keyLabel: "Main", finishSetupEligible: true, syncStatus: "connected" },
  { id: K2, exchange: "bybit", exchangeLabel: "Bybit", keyLabel: "Old key", finishSetupEligible: false, syncStatus: "revoked" },
] as const;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let memberships: (keyId: string) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
  routerRefreshMock.mockReset();
  rpcMock.mockReset();
  captureMock.mockReset();
  rpcMock.mockResolvedValue({ error: null });
  memberships = () => json(200, { memberships: [], feeds: [ALPHA] });
  fetchMock = vi.fn(async (url: string) => {
    const m = /\/api\/keys\/([^/]+)\/memberships/.exec(String(url));
    if (m) return memberships(decodeURIComponent(m[1]));
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The page's own `PageHeader` h1 is not part of this host; a stand-in heading is the
// focus fallback's target, rendered WITHOUT a tabindex like the real one.
function tree(rows: readonly (typeof ROWS)[number][], extra: { allocatorFurniture?: boolean } = {}) {
  return (
    <>
      <h1>Strategies</h1>
      <StrategiesSection
        strategies={[]}
        origin={{ key: "strategies" }}
        placeholderKeys={rows.map((r) => ({ ...r }))}
        {...extra}
      />
    </>
  );
}

function mount(rows: readonly (typeof ROWS)[number][] = ROWS, extra: { allocatorFurniture?: boolean } = {}) {
  return render(tree(rows, extra));
}

async function clickRowDisconnect(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

const dialog = () => screen.getByRole("dialog");
const confirmDisconnect = () => within(dialog()).getByRole("button", { name: "Disconnect" });

describe("StrategiesSection — Disconnect from a No strategy yet row (213-06, decision (b))", () => {
  it("TRACER: the row's Disconnect opens a confirm that disconnects that exact key through the RPC and refreshes the page", async () => {
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");

    // Title carries the row's own text; the confirm waits for the feeds read, then lets go.
    expect(within(dialog()).getByRole("heading", { name: "Disconnect Deribit · Main?" })).toBeInTheDocument();
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds: Alpha Single.");

    // Exactly two actions. The Modal's own header "Close" is chrome, not an action.
    const names = within(dialog())
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.filter((n) => n !== "Close")).toEqual(["Cancel", "Disconnect"]);
    expect(within(dialog()).queryByRole("checkbox")).toBeNull();

    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    // The FIRST row's id: the click resolved the row, not the list's first or last key.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("disconnect_allocator_api_key", { p_api_key_id: K1 });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    // The key is disconnected, never deleted.
    expect(rpcMock).not.toHaveBeenCalledWith("delete_allocator_api_key", expect.anything());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the second row's Disconnect targets the second key", async () => {
    mount();
    await clickRowDisconnect("Disconnect Bybit · Old key");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    expect(rpcMock).toHaveBeenCalledWith("disconnect_allocator_api_key", { p_api_key_id: K2 });
  });

  it("Cancel closes the confirm without calling the RPC or refreshing", async () => {
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});

// UI-SPEC 1.4, pinned as literals so a reworded string reddens here.
const ALLOCATOR_BODY =
  "We'll stop syncing this key. Your historical holdings stay available for audit and are reflected in past performance.";
const MANAGER_BODY =
  "We'll stop using this key. It stays on your account, marked disconnected, and you can connect this exchange account again.";
const FEEDS_UNCHECKED = "Could not check which strategies this key feeds.";
const DISCONNECT_FAILED = "Could not disconnect this key. Please try again.";

describe("StrategiesSection — the Disconnect confirm's states (213-06, UI-SPEC 1.4)", () => {
  it("CONFIRM-HELD-WHILE-READING: Disconnect stays disabled until the feeds read answers", async () => {
    let release: (r: Response) => void = () => {};
    memberships = () => new Promise<Response>((resolve) => (release = resolve));
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() =>
      expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Checking which strategies this key feeds…"),
    );
    expect(confirmDisconnect()).toBeDisabled();
    await act(async () => {
      release(json(200, { memberships: [], feeds: [ALPHA] }));
    });
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds: Alpha Single.");
  });

  it("DISCONNECT-WARNS-ONLY: an unreadable feeds read warns, offers Retry, and does not hold Disconnect", async () => {
    memberships = () => json(500, { error: "rate" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent(FEEDS_UNCHECKED));
    expect(screen.getByTestId("allocator-delete-feeds").className).toContain("text-warning");
    expect(confirmDisconnect()).not.toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    expect(rpcMock).toHaveBeenCalledWith("disconnect_allocator_api_key", { p_api_key_id: K1 });
  });

  it("CONFIRM-RETRY: Retry re-reads, shows the checking note meanwhile, then names the strategies and removes itself", async () => {
    let calls = 0;
    let release: (r: Response) => void = () => {};
    memberships = () => {
      calls += 1;
      return calls === 1 ? json(500, { error: "rate" }) : new Promise<Response>((resolve) => (release = resolve));
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent(FEEDS_UNCHECKED));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Retry" }));
    });
    // The re-read is open: the stale warning is gone and Disconnect is held again.
    expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Checking which strategies this key feeds…");
    expect(confirmDisconnect()).toBeDisabled();
    await act(async () => {
      release(json(200, { memberships: [], feeds: [ALPHA] }));
    });
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds: Alpha Single."));
    expect(within(dialog()).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(confirmDisconnect()).not.toBeDisabled();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/memberships"))).toHaveLength(2);
  });

  it("CONFIRM-STALE-ANSWER-DROPPED: a late answer for a closed confirm does not name its strategies on the next key", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    memberships = (id) =>
      id === K1
        ? new Promise<Response>((resolve) => (releaseFirst = resolve))
        : json(200, { memberships: [], feeds: [] });
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    });
    await clickRowDisconnect("Disconnect Bybit · Old key");
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds no strategy."));
    await act(async () => {
      releaseFirst(json(200, { memberships: [], feeds: [ALPHA] }));
    });
    expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds no strategy.");
    expect(screen.getByTestId("allocator-delete-feeds").textContent).not.toContain("Alpha Single");
  });

  it("an RPC error shows the alert line and keeps the confirm open, without refreshing or closing", async () => {
    rpcMock.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(DISCONNECT_FAILED);
    expect(routerRefreshMock).not.toHaveBeenCalled();
    // Released after the failure so the owner can try again.
    expect(confirmDisconnect()).not.toBeDisabled();
  });

  it("IN-FLIGHT: the label reads Disconnecting…, the buttons are locked, and Esc and the close button are ignored", async () => {
    let finish: (v: { error: null }) => void = () => {};
    rpcMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    const inflight = within(dialog()).getByRole("button", { name: "Disconnecting…" });
    expect(inflight).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    // A second click while in flight must not send a second request.
    await act(async () => {
      fireEvent.click(inflight);
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    // Esc (the native dialog's close event) and the header close are ignored.
    await act(async () => {
      fireEvent(dialog(), new Event("close"));
      fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      finish({ error: null });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  // A browser Esc fires `cancel`, then closes the <dialog> in the DOM and fires `close` unless
  // `cancel` was default-prevented. jsdom does none of that, so this does it (WR-01).
  function pressEscape() {
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog(), cancel);
    if (!cancel.defaultPrevented) {
      dialog().removeAttribute("open");
      fireEvent(dialog(), new Event("close"));
    }
    return cancel;
  }

  it("WR-01 ESC-CANCEL-PREVENTED: the native cancel event is default-prevented while the request is in flight, and not otherwise", async () => {
    let finish: (v: { error: null }) => void = () => {};
    rpcMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    // Idle: Esc is allowed to close the confirm.
    const idle = new Event("cancel", { cancelable: true });
    fireEvent(dialog(), idle);
    expect(idle.defaultPrevented).toBe(false);
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    const inflight = new Event("cancel", { cancelable: true });
    fireEvent(dialog(), inflight);
    expect(inflight.defaultPrevented).toBe(true);
    await act(async () => {
      finish({ error: null });
    });
  });

  it("WR-01 ERROR-AFTER-ESC: an Esc during the request keeps the dialog open, so the failure's alert is visible and Disconnect can be tried again", async () => {
    let finish: (v: { error: { code: string; message: string } }) => void = () => {};
    rpcMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    await act(async () => {
      pressEscape();
    });
    await act(async () => {
      finish({ error: { code: "XX000", message: "boom" } });
    });
    // `dialog()` throws on a closed <dialog> (inaccessible), so reaching the alert proves it is open.
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(DISCONNECT_FAILED);
    expect(confirmDisconnect()).not.toBeDisabled();
  });

  it("SFH-M1 REJECTION: a thrown rejection resets loading and shows the same error line, and is captured", async () => {
    const netFault = new TypeError("Failed to fetch");
    rpcMock.mockRejectedValue(netFault);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(DISCONNECT_FAILED);
    expect(confirmDisconnect()).not.toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).not.toBeDisabled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledWith(
      netFault,
      expect.objectContaining({ tags: expect.objectContaining({ component: "DisconnectKeyConfirm" }) }),
    );
  });

  it("SFH-M1 RPC-ERROR-CAPTURED: a returned RPC error is logged and captured, not only shown", async () => {
    const rpcError = { code: "XX000", message: "boom" };
    rpcMock.mockResolvedValue({ error: rpcError });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
    expect(captureMock).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({ tags: expect.objectContaining({ component: "DisconnectKeyConfirm" }) }),
    );
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("disconnect_allocator_api_key failed"), rpcError);
  });

  it("ROLE BODIES: allocator furniture gets the source confirm's sentence, a manager-only page gets the manager sentence", async () => {
    const view = mount(ROWS, { allocatorFurniture: true });
    await clickRowDisconnect("Disconnect Deribit · Main");
    expect(within(dialog()).getByText(ALLOCATOR_BODY)).toBeInTheDocument();
    expect(within(dialog()).queryByText(MANAGER_BODY)).toBeNull();
    view.unmount();

    mount(ROWS, { allocatorFurniture: false });
    await clickRowDisconnect("Disconnect Deribit · Main");
    expect(within(dialog()).getByText(MANAGER_BODY)).toBeInTheDocument();
    expect(within(dialog()).queryByText(ALLOCATOR_BODY)).toBeNull();
  });

  it("NEVER DELETES: no role is offered Delete key or a cascade box, and no delete RPC is called", async () => {
    for (const allocatorFurniture of [true, false]) {
      const view = mount(ROWS, { allocatorFurniture });
      await clickRowDisconnect("Disconnect Deribit · Main");
      await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
      expect(within(dialog()).queryByRole("button", { name: /delete/i })).toBeNull();
      expect(within(dialog()).queryByRole("checkbox")).toBeNull();
      await act(async () => {
        fireEvent.click(confirmDisconnect());
      });
      view.unmount();
    }
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual([
      "disconnect_allocator_api_key",
      "disconnect_allocator_api_key",
    ]);
  });
});

const ANNOUNCE_MAIN = "Deribit · Main is disconnected. You can connect this account again.";

describe("StrategiesSection — after a successful Disconnect (213-06, UI-SPEC 1.5)", () => {
  async function disconnectFirstRow() {
    await clickRowDisconnect("Disconnect Deribit · Main");
    await waitFor(() => expect(confirmDisconnect()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmDisconnect());
    });
  }

  it("ANNOUNCES politely, and focus lands on the remaining row's Disconnect control, also after the refreshed list drops the row", async () => {
    const view = mount();
    // The region exists before any message arrives (a region mounted with its text is missed).
    expect(screen.getByRole("status")).toHaveTextContent("");
    await disconnectFirstRow();

    const region = screen.getByRole("status");
    expect(region).toHaveTextContent(ANNOUNCE_MAIN);
    expect(region.getAttribute("aria-live")).toBe("polite");
    const remaining = screen.getByRole("button", { name: "Disconnect Bybit · Old key" });
    expect(document.activeElement).toBe(remaining);

    // router.refresh() lands: the disconnected row is gone and focus has not moved.
    view.rerender(tree([ROWS[1]]));
    expect(screen.queryByRole("button", { name: "Disconnect Deribit · Main" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Disconnect Bybit · Old key" }));
  });

  it("FOCUS FALLBACK: with no row left, focus goes to the page heading (tabindex -1 set when absent), never body", async () => {
    mount([ROWS[0]]);
    const h1 = screen.getByRole("heading", { level: 1, name: "Strategies" });
    expect(h1.hasAttribute("tabindex")).toBe(false);
    await disconnectFirstRow();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("status")).toHaveTextContent(ANNOUNCE_MAIN);
  });

  it("a failed Disconnect announces nothing and keeps the confirm open", async () => {
    rpcMock.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    mount();
    await disconnectFirstRow();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(DISCONNECT_FAILED);
  });
});
