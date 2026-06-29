/**
 * Phase 50 / Plan 50-01 / UI-01 — Button refresh LOCK test.
 *
 * LOCK: Button.tsx already exists and renders; these assertions are RED NOW
 * (the source still ships text-sm/text-xs/text-base + bare `focus:ring`) and
 * become the GREEN gate for the Wave-1 Plan 02 token+focus-visible refresh.
 * They pin the post-refresh contract so the refresh cannot silently regress
 * the fluid type tiers or the keyboard-only focus ring (axe cannot catch a
 * missing keyboard ring — 50-RESEARCH.md Pitfall 4).
 *
 * Behaviour contract (50-UI-SPEC.md §Button + §Typography migration map):
 *   - size="md" → text-body (NOT bare text-sm)
 *   - size="sm" → text-caption
 *   - base ring is focus-visible:ring (NOT bare focus:ring)
 *   - public prop API unchanged: every variant×size renders without throwing.
 *
 * className/variant assertion pattern borrowed from CardShell.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
const SIZES = ["sm", "md", "lg"] as const;

describe("<Button> token + focus-visible lock", () => {
  it("size=md uses the fluid text-body tier, not bare text-sm", () => {
    render(<Button size="md">Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.className).toMatch(/\btext-body\b/);
    expect(btn.className).not.toMatch(/\btext-sm\b/);
  });

  it("size=sm uses the fluid text-caption tier", () => {
    render(<Button size="sm">Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.className).toMatch(/\btext-caption\b/);
    expect(btn.className).not.toMatch(/\btext-xs\b/);
  });

  it("ring is keyboard-only (focus-visible:ring), never a bare focus:ring", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.className).toMatch(/focus-visible:ring/);
    // A bare `focus:ring` (not the `-visible` variant) would fire on mouse
    // click too — the refresh must remove it. Negative lookbehind excludes
    // the legitimate `focus-visible:` token.
    expect(btn.className).not.toMatch(/(?<!-visible)\bfocus:ring/);
  });

  it("renders every variant×size combination without throwing (public API unchanged)", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        expect(() =>
          render(
            <Button variant={variant} size={size}>
              {variant}-{size}
            </Button>,
          ),
        ).not.toThrow();
      }
    }
  });
});
