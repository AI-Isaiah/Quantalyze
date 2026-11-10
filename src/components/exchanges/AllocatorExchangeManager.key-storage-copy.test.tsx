import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AllocatorExchangeManager } from "./AllocatorExchangeManager";

/**
 * Phase 200 MANAGERKEYS plan 02 (D-14) — both places the allocator exchange manager
 * describes key storage render the ONE shared sentence and a link to
 * /security#key-handling, and neither names a mechanism. The sentence is typed here as a
 * literal (oracle independence: a drift in the shared constant fails this test instead of
 * passing against itself). The companion census, `key-storage-census.test.ts`, pins the
 * absence of the old restatements in source; this test pins what is rendered in their place.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: vi.fn(), from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }) }),
}));

const SENTENCE =
  "We store your read-only API key encrypted, under a data key of its own, and only our analytics service can decrypt it.";

describe("AllocatorExchangeManager — key storage copy (200-02, D-14)", () => {
  it("renders the shared sentence with a /security#key-handling link at both copy sites, no mechanism name", () => {
    const { container } = render(<AllocatorExchangeManager hasHoldings={false} initialKeys={[]} />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text.split(SENTENCE).length - 1, "the shared sentence appears at both sites").toBe(2);
    const links = Array.from(container.querySelectorAll("a")).filter(
      (a) => a.getAttribute("href") === "/security#key-handling",
    );
    expect(links.map((a) => a.textContent)).toEqual(["How we store keys", "How we store keys"]);
    expect(text).not.toMatch(/per-user|KEK|AES|Vault/);
    // Form guidance stays beside the form and carries no encryption claim (D-15).
    expect(text).toContain("Keys are validated against the exchange. Trading and withdrawal keys are rejected.");
    expect(text).toContain("confirms it's read-only.");
  });
});
