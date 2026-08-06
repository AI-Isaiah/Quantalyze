/**
 * Phase 150 / OWN-05 — the owner rename dialog.
 *
 * Two things are pinned here that a "it submits and it works" suite would miss:
 *
 *   1. VALIDATION IS INLINE AND THE CTA STAYS CLICKABLE. The no-disabled-buttons
 *      direction says a blocked action is either ABSENT or clickable-with-a-
 *      remedy. A greyed `Save name` would be neither, and a validation arm that
 *      still issued the request would put the product rule on the server only.
 *      Both halves are asserted: the CTA is not disabled AND no fetch happened.
 *
 *   2. THE CLIENT DOES NOT PRE-TRUNCATE. Plan 04's route REJECTS an over-long
 *      name (400 `name too long`) rather than silently capping it, deliberately
 *      diverging from the alias route. A client-side `.slice(0, 80)` would hide
 *      that contract and re-introduce the fail-quiet, so the source pin forbids
 *      it and the behavioural case asserts the inline message instead.
 *
 * ORACLE INDEPENDENCE — every copy string is typed here as a literal, never
 * imported from the component (150-UI-SPEC Copywriting Contract is byte-binding).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RenameStrategyDialog } from "./RenameStrategyDialog";
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

// --- Literal oracles --------------------------------------------------------

const TITLE = "Rename strategy";
const FIELD_LABEL = "Name";
const HELPER =
  "Only you see this name. Public surfaces keep showing the codename.";
const CTA_SAVE = "Save name";
const CTA_CANCEL = "Cancel";
const ERR_EMPTY = "Enter a name.";
const ERR_TOO_LONG = "Keep it under 80 characters.";

const STRATEGY_ID = "88888888-8888-4888-8888-888888888888";
const CURRENT_NAME = "Alpha Centauri";

let fetchMock: FetchMock;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderDialog(
  overrides: Partial<Parameters<typeof RenameStrategyDialog>[0]> = {},
) {
  const onClose = vi.fn();
  const utils = render(
    <RenameStrategyDialog
      open
      onClose={onClose}
      strategyId={STRATEGY_ID}
      currentName={CURRENT_NAME}
      {...overrides}
    />,
  );
  return { ...utils, onClose };
}

const nameInput = () => screen.getByLabelText(FIELD_LABEL) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: CTA_SAVE });

beforeEach(() => {
  mockRefresh.mockReset();
  fetchMock = installFetchMock();
  fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, name: "x" }));
});

afterEach(() => {
  restoreFetchMock();
});

// ---------------------------------------------------------------------------

describe("RenameStrategyDialog — the form", () => {
  it("renders the title, a prefilled Name field and the D-18 helper line", () => {
    renderDialog();

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(nameInput()).toHaveValue(CURRENT_NAME);
    expect(screen.getByText(HELPER)).toBeInTheDocument();
  });

  it("Cancel closes without writing", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: CTA_CANCEL }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("RenameStrategyDialog — inline validation, clickable CTA, zero requests", () => {
  it("empty after trim → inline `Enter a name.`, field focused, CTA still clickable, NO fetch", async () => {
    renderDialog();

    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(ERR_EMPTY)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    // A blocked action stays clickable with an inline remedy — never greyed.
    expect(saveButton()).not.toBeDisabled();
    expect(document.activeElement).toBe(nameInput());
  });

  it("81 characters → inline `Keep it under 80 characters.`, NO fetch, nothing truncated", async () => {
    renderDialog();

    const tooLong = "a".repeat(81);
    fireEvent.change(nameInput(), { target: { value: tooLong } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(ERR_TOO_LONG)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveButton()).not.toBeDisabled();
    // The input keeps every character the user typed: the route REJECTS an
    // over-long name, so quietly capping it here would hide the contract.
    expect(nameInput()).toHaveValue(tooLong);
  });

  it("exactly 80 characters is accepted — the boundary is inclusive, matching the route", async () => {
    renderDialog();

    const atCap = "b".repeat(80);
    fireEvent.change(nameInput(), { target: { value: atCap } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ name: atCap });
  });

  it("a name that is legal only AFTER trimming is sent trimmed, not rejected", async () => {
    renderDialog();

    fireEvent.change(nameInput(), { target: { value: "  Helios sleeve  " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ name: "Helios sleeve" });
  });
});

describe("RenameStrategyDialog — the write", () => {
  it("a valid submit PATCHes the name route, closes and refreshes", async () => {
    const { onClose } = renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/strategies/${STRATEGY_ID}/name`,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Helios alpha sleeve",
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("a server failure renders the canonical envelope, keeps the dialog open and preserves the input", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "internal error" }));
    const { onClose } = renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    expect(await screen.findByTestId("error-envelope")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue("Helios alpha sleeve");
  });

  it("the route's own 400 arms surface INLINE at the field, not as a terminal envelope", async () => {
    // Client and server validation can disagree on exotic whitespace, so the
    // server's two documented 400s must still land where the user is looking.
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "name too long" }));
    renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(ERR_TOO_LONG)).toBeInTheDocument();
    expect(screen.queryByTestId("error-envelope")).toBeNull();
  });
});

describe("RenameStrategyDialog — source pins", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src/components/strategy/RenameStrategyDialog.tsx"),
    "utf8",
  );

  it("writes through the route only — no client-direct database client (T-150-28)", () => {
    expect(SRC).not.toContain("supabase");
  });

  it("never pre-truncates the owner's name (the route rejects; a client cap would hide that)", () => {
    expect(SRC).not.toContain(".slice(");
    expect(SRC).not.toContain("maxLength");
  });

  it("uses the shared Field primitive so the error is wired to the control", () => {
    expect(SRC).toContain("Field");
  });
});
