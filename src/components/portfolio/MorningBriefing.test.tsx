import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MorningBriefing } from "./MorningBriefing";

describe("<MorningBriefing>", () => {
  it("returns null when narrative is missing", () => {
    const { container } = render(<MorningBriefing narrative={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when narrative is empty string", () => {
    const { container } = render(<MorningBriefing narrative="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the card variant by default", () => {
    render(
      <MorningBriefing narrative="Your portfolio returned +2.3% MTD." />,
    );
    expect(screen.getByText("Morning Briefing")).toBeInTheDocument();
    expect(
      screen.getByText("Your portfolio returned +2.3% MTD."),
    ).toBeInTheDocument();
  });

  it("renders the dek variant without a header", () => {
    render(
      <MorningBriefing
        narrative="Your portfolio returned +2.3% MTD."
        variant="dek"
      />,
    );
    expect(screen.queryByText("Morning Briefing")).toBeNull();
    expect(
      screen.getByText("Your portfolio returned +2.3% MTD."),
    ).toBeInTheDocument();
  });
});
