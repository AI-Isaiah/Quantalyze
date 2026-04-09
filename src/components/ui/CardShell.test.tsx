import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardShell } from "./CardShell";

describe("<CardShell>", () => {
  it("renders the title and accessible region", () => {
    render(
      <CardShell status="ready" title="Strategy breakdown">
        <p>Body</p>
      </CardShell>,
    );
    expect(
      screen.getByRole("region", { name: "Strategy breakdown" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("renders a skeleton in the loading state", () => {
    const { container } = render(
      <CardShell status="loading" title="Loading card" />,
    );
    // Skeleton bars use bg-page; verify they exist
    const skeletons = container.querySelectorAll(".bg-page");
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it("renders unavailable copy in the unavailable state", () => {
    render(<CardShell status="unavailable" title="Big number" />);
    expect(screen.getByText(/Data unavailable/i)).toBeInTheDocument();
  });

  it("renders the stale dot + label in the stale state", () => {
    render(
      <CardShell
        status="stale"
        title="Sharpe"
        staleHint="Last computed: 2 hours ago"
      >
        1.42
      </CardShell>,
    );
    expect(screen.getByRole("status")).toHaveAttribute(
      "title",
      "Last computed: 2 hours ago",
    );
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("1.42")).toBeInTheDocument();
  });

  it("does not render header when title is omitted", () => {
    const { container } = render(
      <CardShell status="ready">
        <span data-testid="body">x</span>
      </CardShell>,
    );
    expect(container.querySelector("header")).toBeNull();
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
});
