import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadManagerIdentity } from "./manager-identity";

/**
 * Tests for the shared loadManagerIdentity helper. Mocks the admin
 * Supabase client chain (.from().select().eq().maybeSingle()) and asserts
 * that the happy path returns a normalized ManagerIdentity, that errors
 * log and return null, and that missing rows return null.
 */

type MockChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

interface Mocks {
  chain: MockChain;
  client: SupabaseClient;
}

function buildMockClient(response: {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}): Mocks {
  const chain: MockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(response),
  };
  const client = {
    from: vi.fn().mockReturnValue(chain),
  } as unknown as SupabaseClient;
  return { chain, client };
}

describe("loadManagerIdentity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a normalized ManagerIdentity on the happy path", async () => {
    const { client, chain } = buildMockClient({
      data: {
        display_name: "Dr. Alice Chen",
        company: "Stellar Quant",
        bio: "PhD stat-phys, 12y crypto",
        years_trading: 12,
        aum_range: "$10M–$50M",
        linkedin: "https://linkedin.com/in/alice",
      },
      error: null,
    });

    const result = await loadManagerIdentity(client, "user-uuid");

    expect(result).toEqual({
      display_name: "Dr. Alice Chen",
      company: "Stellar Quant",
      bio: "PhD stat-phys, 12y crypto",
      years_trading: 12,
      aum_range: "$10M–$50M",
      linkedin: "https://linkedin.com/in/alice",
    });
    // The helper must issue the exact column list — drift here is the bug
    // migration 017 REVOKE was meant to catch.
    expect(chain.select).toHaveBeenCalledWith(
      "display_name, company, bio, years_trading, aum_range, linkedin",
    );
    expect(chain.eq).toHaveBeenCalledWith("id", "user-uuid");
  });

  it("returns null on a database error (and logs it)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = buildMockClient({
      data: null,
      error: { message: "permission denied for column bio" },
    });

    const result = await loadManagerIdentity(client, "user-uuid");

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns null when the row is missing (maybeSingle → null)", async () => {
    const { client } = buildMockClient({ data: null, error: null });

    const result = await loadManagerIdentity(client, "nonexistent");

    expect(result).toBeNull();
  });

  it("fills missing fields with null rather than leaving them undefined", async () => {
    const { client } = buildMockClient({
      data: {
        display_name: "Helios Research",
        // company, bio, years_trading, aum_range, linkedin all omitted
      },
      error: null,
    });

    const result = await loadManagerIdentity(client, "user-uuid");

    expect(result).toEqual({
      display_name: "Helios Research",
      company: null,
      bio: null,
      years_trading: null,
      aum_range: null,
      linkedin: null,
    });
  });
});
