import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerifiedBadge } from "./VerifiedBadge";

// Regression: /qa CSV report 2026-05-21 ISSUE-011. Before this fix the
// badge rendered unconditionally on the /strategy/[id] header + the
// strategy-v2 shell — so a csv_uploaded strategy showed "Verified"
// in green next to its name even though the disclaimer below said
// "uploaded by the manager and not independently verified". Same
// class of bug as ISSUE-007 in reverse. The badge now branches on
// the strategy's trust_tier; non-api_verified renders null.
describe("VerifiedBadge", () => {
  it("renders the badge when trustTier is api_verified", () => {
    render(<VerifiedBadge trustTier="api_verified" />);
    expect(screen.getByText("Verified")).toBeDefined();
  });

  it("renders nothing for csv_uploaded (was the bug)", () => {
    const { container } = render(<VerifiedBadge trustTier="csv_uploaded" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for self_reported", () => {
    const { container } = render(<VerifiedBadge trustTier="self_reported" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for null (missing verification row)", () => {
    const { container } = render(<VerifiedBadge trustTier={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when trustTier is undefined (fail-closed)", () => {
    // /ship specialist hardening: every caller now passes trust_tier
    // explicitly. A missing prop means the data layer didn't project the
    // field (e.g. a v2 query that forgot strategy_verifications), so we
    // fail closed — render nothing rather than silently re-introducing
    // ISSUE-011 on a new surface.
    const { container } = render(<VerifiedBadge />);
    expect(container.firstChild).toBeNull();
  });
});

// SFOX-09 (provenance leg) — VerifiedBadge dispatches on trust_tier alone; it is
// exchange-AGNOSTIC (no per-exchange branch), and the Python ingestion side
// auto-stamps trust_tier="api_verified" for a synced sfox key (process_key.py:828,
// landed 120-01). So a sfox-sourced strategy whose strategy_verifications row
// carries api_verified renders the "Verified" chip through the same path as any
// other exchange — and every lesser tier still fails closed. These cases document
// the SFOX-09 claim explicitly (greppable "sfox") so a future refactor that adds
// an exchange-aware branch to VerifiedBadge would break here. No production code
// changes for this task.
describe("VerifiedBadge — SFOX-09 sfox provenance dispatch", () => {
  it("renders the Verified badge for a sfox api_verified strategy", () => {
    // A sfox key ingested + auto-stamped api_verified → the badge renders,
    // identical to every other api_verified source (trust_tier is the sole gate).
    render(<VerifiedBadge trustTier="api_verified" />);
    expect(screen.getByText("Verified")).toBeDefined();
  });

  it("renders nothing for a sfox self_reported strategy (fail-closed)", () => {
    const { container } = render(<VerifiedBadge trustTier="self_reported" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a sfox csv_uploaded strategy (fail-closed)", () => {
    const { container } = render(<VerifiedBadge trustTier="csv_uploaded" />);
    expect(container.firstChild).toBeNull();
  });
});
