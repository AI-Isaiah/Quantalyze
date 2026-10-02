/**
 * Phase 150 / Plan 150-02 / OWN-03 — the ONE capital question.
 *
 * UI-SPEC invariant 5: this component is mounted by BOTH the wizard
 * MetadataStep and the Mark-ownership dialog. Only the group `label` differs;
 * the two option labels and the helper line are module constants, so copy
 * drift between the two mounts is impossible by construction.
 *
 * Every copy string below is a LITERAL typed into this test — never imported
 * from the component. Importing the constant to assert itself would pass for
 * any body and would not notice a copy change on a money-consequence line
 * ("A team's key can never join your allocation" is the D-03 invariant stated
 * to the user).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CapitalOwnershipRadioGroup } from "./CapitalOwnershipRadioGroup";

const WIZARD_LABEL = "Whose capital is in this key?";
const DIALOG_LABEL = "Whose capital is this?";
const OPTION_OWN = "My own capital";
const OPTION_TEAM = "A trading team's key I'm verifying";
const HELPER =
  "Own-capital strategies can be allocated from the Holdings tab. A team's key can never join your allocation.";

describe("CapitalOwnershipRadioGroup — structure and semantics", () => {
  it("renders a fieldset with the label as its legend and an inner radiogroup", () => {
    const { container } = render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="team_review"
        onChange={vi.fn()}
      />,
    );

    const fieldset = container.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    const legend = container.querySelector("legend");
    expect(legend).not.toBeNull();
    expect(legend).toHaveTextContent(WIZARD_LABEL);

    const group = screen.getByRole("radiogroup");
    expect(group).toBeInTheDocument();
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  it("takes the group label from the prop — the dialog mount differs only here", () => {
    render(
      <CapitalOwnershipRadioGroup
        label={DIALOG_LABEL}
        value="own_capital"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(DIALOG_LABEL)).toBeInTheDocument();
    // The option copy is single-sourced: identical at both mounts.
    expect(screen.getByText(OPTION_OWN)).toBeInTheDocument();
    expect(screen.getByText(OPTION_TEAM)).toBeInTheDocument();
    expect(screen.getByText(HELPER)).toBeInTheDocument();
  });

  it("renders the two option labels and the helper line as binding copy", () => {
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="team_review"
        onChange={vi.fn()}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveTextContent(OPTION_OWN);
    expect(radios[1]).toHaveTextContent(OPTION_TEAM);
    expect(screen.getByText(HELPER)).toBeInTheDocument();
  });

  it("options are real buttons of type=button — never a form-submitting control", () => {
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="team_review"
        onChange={vi.fn()}
      />,
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.tagName).toBe("BUTTON");
      expect(radio).toHaveAttribute("type", "button");
    }
  });
});

describe("CapitalOwnershipRadioGroup — value tracking", () => {
  it("aria-checked follows the value prop: team_review", () => {
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="team_review"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("capital-ownership-team_review"),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("aria-checked follows the value prop: own_capital", () => {
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="own_capital"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByTestId("capital-ownership-team_review"),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("exactly one option is checked at a time", () => {
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="own_capital"
        onChange={vi.fn()}
      />,
    );
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
  });
});

describe("CapitalOwnershipRadioGroup — onChange", () => {
  it("clicking 'My own capital' emits own_capital", () => {
    const onChange = vi.fn();
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="team_review"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("own_capital");
  });

  it("clicking the team option emits team_review", () => {
    const onChange = vi.fn();
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="own_capital"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("team_review");
  });

  it("is fully controlled — a click does not move the selection on its own", () => {
    const onChange = vi.fn();
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="team_review"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    // The parent owns the value; without a re-render the checked option is
    // unchanged. A component that flipped itself would desync from the value
    // the wizard actually submits.
    expect(
      screen.getByTestId("capital-ownership-team_review"),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("has no clear/reset arm — the group is two-state and can never be unset", () => {
    const onChange = vi.fn();
    render(
      <CapitalOwnershipRadioGroup
        label={WIZARD_LABEL}
        value="own_capital"
        onChange={onChange}
      />,
    );
    // Clicking the ALREADY-selected option must not emit null/undefined
    // (the segmented-radio idiom elsewhere in the repo has click-to-clear;
    // that is wrong here — a mark is never absent once asked).
    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    for (const call of onChange.mock.calls) {
      expect(call[0]).toBe("own_capital");
    }
  });
});

describe("CapitalOwnershipRadioGroup — source pins", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/strategy/CapitalOwnershipRadioGroup.tsx"),
    "utf8",
  );

  it("invents no roving-tabindex keyboard model (each option is a tab stop)", () => {
    expect(source).not.toContain("tabIndex");
  });

  it("is a pure form control — no data fetching of any kind", () => {
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("supabase");
  });
});
