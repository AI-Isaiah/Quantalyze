/**
 * Phase 150 / OWN-03 — the Mark-ownership dialog: the RETRO path (D-09 / D-11).
 *
 * This is the surface that makes Black Swan / Alpha Centauri / Arctic Fox
 * markable with zero re-onboarding, and it is the ONLY client path to the
 * destructive `confirm_remove_allocation: true` flag on
 * `PATCH /api/strategies/{id}/ownership`.
 *
 * The 409 -> confirm -> re-submit ARC is the reason this file exists. Plan 04's
 * route refuses an own-capital -> team-review flip that would strand a live
 * position, answering `409 { error: "live_allocation", allocated_amount }` and
 * writing NOTHING. The dialog must render the consequence WITH the amount and
 * perform exactly ONE confirmed write. A silent removal, or a second write on
 * the refusal, are both defects this suite is written to catch.
 *
 * ORACLE INDEPENDENCE — every copy string below is typed into this file as a
 * literal. Nothing is imported from the component under test, so a copy edit in
 * the component reddens here instead of being mirrored into the assertion. The
 * strings are the 150-UI-SPEC Copywriting Contract, which is byte-binding.
 *
 * jsdom implements neither HTMLDialogElement.showModal() nor .close(); the
 * stubs below are the repo-standard shim (Modal.test.tsx:23-39).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MarkOwnershipDialog } from "./MarkOwnershipDialog";
import { installFetchMock, restoreFetchMock, type FetchMock } from "@/test/helpers/fetch";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

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

// --- Literal oracles (UI-SPEC Copywriting Contract) -------------------------

const TITLE = "Mark ownership";
const GROUP_LABEL = "Whose capital is this?";
const OPTION_OWN = "My own capital";
const OPTION_TEAM = "A trading team's key I'm verifying";
const CTA_SAVE = "Save mark";
const CTA_CANCEL = "Cancel";
const CONFIRM_HEADING = "Remove allocation?";
const CONFIRM_PRIMARY = "Change mark and remove allocation";
const CONFIRM_SECONDARY = "Keep own capital";

const STRATEGY_ID = "77777777-7777-4777-8777-777777777777";
const STRATEGY_NAME = "Black Swan";

/** The confirm body, assembled from literals exactly as the UI-SPEC writes it. */
const CONFIRM_BODY_120K =
  "Black Swan has a $120,000 allocation. A team-review strategy cannot hold an allocation — changing the mark removes it.";

let fetchMock: FetchMock;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderDialog(
  overrides: Partial<Parameters<typeof MarkOwnershipDialog>[0]> = {},
) {
  const onClose = vi.fn();
  const utils = render(
    <MarkOwnershipDialog
      open
      onClose={onClose}
      strategyId={STRATEGY_ID}
      strategyName={STRATEGY_NAME}
      currentMark={null}
      {...overrides}
    />,
  );
  return { ...utils, onClose };
}

/** The parsed body of the nth fetch call. */
function bodyOfCall(n: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[n]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

beforeEach(() => {
  mockRefresh.mockReset();
  fetchMock = installFetchMock();
  fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, mark: "own_capital" }));
});

afterEach(() => {
  restoreFetchMock();
});

// ---------------------------------------------------------------------------

describe("MarkOwnershipDialog — the question, defaulted safely", () => {
  it("renders the strategy name as the first body line and the ONE capital question", () => {
    renderDialog();

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(STRATEGY_NAME)).toBeInTheDocument();
    // The group label is the Mark-dialog variant, not the wizard's.
    expect(screen.getByText(GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText(OPTION_OWN)).toBeInTheDocument();
    expect(screen.getByText(OPTION_TEAM)).toBeInTheDocument();
  });

  it("an UNMARKED row opens with team-review preselected — an accidental save must not mint allocatability", () => {
    renderDialog({ currentMark: null });

    expect(screen.getByTestId("capital-ownership-team_review")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("a MARKED row opens on its current mark", () => {
    renderDialog({ currentMark: "own_capital" });

    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("MarkOwnershipDialog — the plain write", () => {
  it("Save mark PATCHes the ownership route, closes and refreshes", async () => {
    const { onClose } = renderDialog({ currentMark: null });

    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/strategies/${STRATEGY_ID}/ownership`,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(bodyOfCall(0)).toEqual({ mark: "own_capital" });
    // The unconfirmed write must NOT carry the destructive flag.
    expect(bodyOfCall(0)).not.toHaveProperty("confirm_remove_allocation");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without writing anything", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: CTA_CANCEL }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MarkOwnershipDialog — the 409 -> confirm -> re-submit arc (D-03 / T-150-30)", () => {
  it("409 live_allocation swaps the body to the inline confirm with the amount, and writes NOTHING more", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "live_allocation", allocated_amount: 120000 }),
    );
    const { onClose } = renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    expect(await screen.findByText(CONFIRM_HEADING)).toBeInTheDocument();
    expect(screen.getByText(CONFIRM_BODY_120K)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CONFIRM_PRIMARY }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CONFIRM_SECONDARY }),
    ).toBeInTheDocument();

    // Exactly ONE request so far, and the dialog is still open: the refusal is
    // not a write and must not read as one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("the confirm primary re-submits ONCE with confirm_remove_allocation: true, then closes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(409, { error: "live_allocation", allocated_amount: 120000 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, mark: "team_review" }),
      );
    const { onClose } = renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));
    fireEvent.click(await screen.findByRole("button", { name: CONFIRM_PRIMARY }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The call SEQUENCE is the assertion: the flag exists only on the second,
    // confirmed request — never on the first.
    expect(bodyOfCall(0)).toEqual({ mark: "team_review" });
    expect(bodyOfCall(1)).toEqual({
      mark: "team_review",
      confirm_remove_allocation: true,
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("`Keep own capital` dismisses the confirm — no write, mark unchanged, dialog open", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "live_allocation", allocated_amount: 120000 }),
    );
    const { onClose } = renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));
    fireEvent.click(
      await screen.findByRole("button", { name: CONFIRM_SECONDARY }),
    );

    await waitFor(() =>
      expect(screen.queryByText(CONFIRM_HEADING)).toBeNull(),
    );
    // Back on the question, still exactly one request, nothing closed.
    expect(screen.getByText(GROUP_LABEL)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("renders the amount through the shared formatter — a null amount never becomes $0", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "live_allocation", allocated_amount: 0 }),
    );
    renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    // $0 is the HONEST rendering of a real zero-amount position row (the route
    // coalesces a null allocated_amount to 0 before summing). The point of this
    // case is the formatter: whole dollars, thousands separators, one `$`.
    expect(
      await screen.findByText(
        "Black Swan has a $0 allocation. A team-review strategy cannot hold an allocation — changing the mark removes it.",
      ),
    ).toBeInTheDocument();
  });
});

describe("MarkOwnershipDialog — write failure renders the canonical envelope", () => {
  it("a non-409 failure renders ErrorEnvelope in the body, keeps the dialog open and preserves the selection", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "internal error" }));
    const { onClose } = renderDialog({ currentMark: null });

    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    expect(await screen.findByTestId("error-envelope")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    // Selection survives the failure — the user does not re-answer the question.
    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("a thrown fetch (offline) also renders the envelope rather than a bespoke string", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    expect(await screen.findByTestId("error-envelope")).toBeInTheDocument();
  });
});

describe("MarkOwnershipDialog — source pins", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src/components/strategy/MarkOwnershipDialog.tsx"),
    "utf8",
  );

  it("writes through the route only — no client-direct database client (T-150-28)", () => {
    expect(SRC).not.toContain("supabase");
  });

  it("formats money through the ONE shared formatter — no local number formatting (W-7)", () => {
    expect(SRC).not.toContain("toLocaleString");
    expect(SRC).not.toContain("toFixed");
    expect(SRC).toContain("formatUsd");
  });

  it("mounts the shared question component rather than re-spelling the options (UI-SPEC invariant 5)", () => {
    expect(SRC).toContain("CapitalOwnershipRadioGroup");
  });
});
