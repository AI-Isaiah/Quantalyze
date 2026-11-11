/**
 * Phase 200 / D-09, D-10, D-11 — the edit page's name block.
 *
 * Pinned here: the Rename control exists ONLY for `private` and `draft`
 * (D-10: the route's private/draft gate is not widened, and a published or
 * pending name is never renameable from the UI), the D-10 reason sentence
 * shows otherwise, and the preview states both names the public surfaces
 * compute. Every copy string is typed as a literal, never imported.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StrategyNameBlock } from "./StrategyNameBlock";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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

const LOCKED_SENTENCE =
  "Names can change only while a strategy is private or a draft. An admin reviews the name before publication.";
const STRATEGY_ID = "88888888-8888-4888-8888-888888888888";
// Phase 201 D-09: both legs are the same string, the name every viewer who can see the strategy reads.
const PREVIEW = { factsheet: "Helios alpha sleeve", discovery: "Helios alpha sleeve" };

function renderBlock(status: Parameters<typeof StrategyNameBlock>[0]["status"]) {
  return render(
    <StrategyNameBlock
      strategyId={STRATEGY_ID}
      name="Helios alpha sleeve"
      status={status}
      preview={PREVIEW}
    />,
  );
}

describe("StrategyNameBlock — D-10 status gate", () => {
  it.each(["private", "draft"] as const)(
    "status %s shows a Rename… button that opens the dialog, and no locked sentence",
    (status) => {
      renderBlock(status);

      expect(screen.queryByText(LOCKED_SENTENCE)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Rename…" }));
      expect(screen.getByText("Rename strategy")).toBeInTheDocument();
    },
  );

  it.each(["published", "pending_review", "archived"] as const)(
    "status %s shows the name, NO Rename button and the D-10 sentence",
    (status) => {
      renderBlock(status);

      expect(screen.getByTestId("strategy-name")).toHaveTextContent(
        "Helios alpha sleeve",
      );
      expect(
        screen.queryByRole("button", { name: "Rename…" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(LOCKED_SENTENCE)).toBeInTheDocument();
    },
  );
});

describe("StrategyNameBlock — D-11 public-name preview", () => {
  it("published: states what the public factsheet and discovery show", () => {
    renderBlock("published");

    expect(screen.getByTestId("preview-factsheet")).toHaveTextContent(
      "The public factsheet shows Helios alpha sleeve.",
    );
    expect(screen.getByTestId("preview-discovery")).toHaveTextContent(
      "Discovery shows other signed-in viewers Helios alpha sleeve.",
    );
  });

  it.each(["private", "draft", "pending_review"] as const)(
    "status %s: states what a shared link and discovery-once-published show",
    (status) => {
      renderBlock(status);

      expect(screen.getByTestId("preview-factsheet")).toHaveTextContent(
        "A shared factsheet link shows Helios alpha sleeve.",
      );
      expect(screen.getByTestId("preview-discovery")).toHaveTextContent(
        "Discovery shows it as Helios alpha sleeve once published.",
      );
    },
  );

  it("the dialog hint says the saved name is what the factsheet shows, and never quotes the current name (WR-05)", () => {
    renderBlock("draft");

    fireEvent.click(screen.getByRole("button", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    const hint = within(dialog).getByText(
      "The name you save is what a shared factsheet link shows. Discovery shows it as Helios alpha sleeve once published.",
    );
    // the old name sits in the block's own preview, but never in the dialog,
    // where the manager is typing the new one
    expect(hint).toBeInTheDocument();
    expect(within(dialog).queryByText(/shows Helios alpha sleeve/)).not.toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/Helios alpha sleeve\./);
    expect(document.body.textContent).not.toMatch(/keep showing the codename/);
    expect(document.body.textContent).not.toMatch(/Only you see this name/);
  });
});
