/**
 * Phase 149 / 149-02 Task 3 — Badge status domain (Delta 3).
 *
 * The file's first spec. `Badge` carries TWO status domains in one shared map:
 * strategy statuses and contact_request statuses. `private` — a real, LIVE
 * strategy status — was missing from both maps, so it fell through to
 * `?? statusMap.draft` / `?? label` and rendered as a DRAFT-inked badge reading
 * the raw lowercase string "private". That defect is on two shipping surfaces
 * today: `(dashboard)/strategies/page.tsx:177`. (`StrategyHeader.tsx:24` also
 * spells it, but that component is NOT mounted anywhere — see the header at the
 * top of StrategyHeader.tsx; counting it as a live caller overstates coverage.)
 *
 * DESIGN.md semantic-color gate: a private strategy is not an error and not a
 * success — it is a neutral, owner-chosen state, so it takes the same muted ink
 * `archived` uses, never red/amber.
 *
 * The unknown-status case below pins that the FALLBACK CONTRACT survives: only
 * `private` leaves it. And the contact_request case pins that adding to the
 * shared map did not disturb the other domain.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge — strategy status domain", () => {
  it("private → 'Private' with muted ink, NOT the draft fallback", () => {
    render(<Badge type="status" label="private" />);

    const badge = screen.getByText("Private");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-badge-other/10");
    expect(badge.className).toContain("text-text-muted");
    // The defect: falling through to `statusMap.draft` paints draft ink.
    expect(badge.className).not.toContain("text-badge-other");
    // Neutral owner-chosen state — never an alarm color (DESIGN.md).
    expect(badge.className).not.toMatch(/text-negative|text-warning/);
  });

  it("draft → 'Draft' with draft ink (regression pin)", () => {
    render(<Badge type="status" label="draft" />);

    const badge = screen.getByText("Draft");
    expect(badge.className).toContain("text-badge-other");
  });

  it("published → 'Published' with positive ink", () => {
    render(<Badge type="status" label="published" />);

    const badge = screen.getByText("Published");
    expect(badge.className).toContain("text-positive");
  });

  it("archived → 'Archived' with the same muted ink private now shares", () => {
    render(<Badge type="status" label="archived" />);

    const badge = screen.getByText("Archived");
    expect(badge.className).toContain("bg-badge-other/10");
    expect(badge.className).toContain("text-text-muted");
  });

  it("an unknown status keeps draft styling but reads 'Unknown status', never the raw key", () => {
    render(<Badge type="status" label="bogus_status" />);

    const badge = screen.getByText("Unknown status");
    expect(badge.className).toContain("text-badge-other");
    expect(screen.queryByText("bogus_status")).toBeNull();
  });

  it("a prototype key reads 'Unknown status', not a function's text", () => {
    render(<Badge type="status" label="constructor" />);

    expect(screen.getByText("Unknown status")).toBeInTheDocument();
  });

  it("pending_review → 'Pending review' in sentence case", () => {
    render(<Badge type="status" label="pending_review" />);

    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.queryByText("Pending Review")).toBeNull();
  });

  it("intro_made → 'Intro made' in sentence case", () => {
    render(<Badge type="status" label="intro_made" />);

    expect(screen.getByText("Intro made")).toBeInTheDocument();
    expect(screen.queryByText("Intro Made")).toBeNull();
  });
});

describe("Badge — contact_request status domain (untouched)", () => {
  it("pending → 'Pending' with the market-neutral tokens", () => {
    render(<Badge type="status" label="pending" />);

    const badge = screen.getByText("Pending");
    expect(badge.className).toContain("text-badge-market-neutral");
  });

  it("declined → 'Declined' with negative tokens", () => {
    render(<Badge type="status" label="declined" />);

    const badge = screen.getByText("Declined");
    expect(badge.className).toContain("text-negative");
  });
});
