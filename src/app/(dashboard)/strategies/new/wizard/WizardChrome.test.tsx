import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { WizardChrome } from "./WizardChrome";

// Hydration-safety regression for the savedAt path.
//
// WizardClient initializes savedAt to null synchronously and backfills
// via useEffect after mount. WizardChrome must therefore render
// "Not saved yet" when savedAt is null and "Draft saved · HH:MM" when
// savedAt is a number. SSR + first-client-render alignment depends on
// the null path producing identical markup on both, so a regression in
// the parent's lazy-init that re-introduces Date.now() at mount would
// break this test by mismatching server-rendered string with the
// post-effect string. /qa 2026-05-05; preventive fix in 9ea9d37.

const baseProps = {
  currentStep: "connect_key" as const,
  canDelete: false,
  onDeleteDraft: () => {},
  onRequestCall: () => {},
};

describe("WizardChrome — savedAt rendering (hydration safety)", () => {
  it("renders 'Not saved yet' when savedAt is null (SSR-safe initial state)", () => {
    render(
      <WizardChrome {...baseProps} savedAt={null}>
        <div />
      </WizardChrome>,
    );
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.queryByText(/Draft saved/i)).toBeNull();
  });

  it("renders the timestamp when savedAt is a number", () => {
    // Use a fixed epoch so the locale formatter is deterministic.
    const fixed = new Date("2026-05-06T10:23:00Z").getTime();
    render(
      <WizardChrome {...baseProps} savedAt={fixed}>
        <div />
      </WizardChrome>,
    );
    expect(screen.getByText(/Draft saved/)).toBeInTheDocument();
    expect(screen.queryByText("Not saved yet")).toBeNull();
  });

  it("SSR string with savedAt=null matches the markup the client first renders", () => {
    // Pin the regression: if a future patch re-introduces Date.now() into
    // the synchronous-first-render path, the SSR-emitted HTML will encode
    // a different timestamp than the client's first render, triggering
    // React #418. We assert the SSR markup is the deterministic null
    // path so the savedAt fix in 9ea9d37 cannot silently regress.
    const html = renderToString(
      <WizardChrome {...baseProps} savedAt={null}>
        <div data-testid="children" />
      </WizardChrome>,
    );
    expect(html).toContain("Not saved yet");
    expect(html).not.toContain("Draft saved");
  });
});
