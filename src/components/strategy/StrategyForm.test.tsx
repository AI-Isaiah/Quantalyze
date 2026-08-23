import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StrategyForm } from "./StrategyForm";
import type { Strategy } from "@/lib/types";

/**
 * H-0405 (audit-2026-05-07) — StrategyForm must not leak raw Postgres error
 * text into the user-facing banner.
 *
 * The strategies insert/update used to pipe `error.message` straight into
 * setError. A SQLSTATE 42501 RLS / SECURITY DEFINER trigger RAISE (e.g. the
 * cross-tenant api_key_id guard from migration 028/029) embeds two UUIDs and
 * the migration name in that message — a privilege-escalation hint and
 * internal-schema disclosure shown verbatim to the end user. The fix routes
 * every DB error through toUserFacingStrategyError(), which returns one of two
 * intent-specific messages and never echoes the raw text.
 *
 * WHY this matters (Rule 9): the banner is the only consumer of the error
 * state, so the test pins the redaction at the rendered-UI boundary — the exact
 * place the leak was visible. We assert the safe copy renders AND the sensitive
 * tokens (UUIDs, migration name, column names) do NOT.
 */

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Controls what `.from("strategies").update(...).eq(...)` resolves to.
let strategiesUpdateResult: { error: { code?: string; message?: string } | null } = {
  error: null,
};
// 160-03: captures the payload passed to `.from("api_keys").insert(...)`.
// The branch is deliberately KEPT (and deliberately resolves as a SUCCESS) even
// though no production path should reach it any more: a reintroduced browser
// insert must be observable as a recorded payload, not masked by an
// "unexpected from(api_keys)" throw that a future test could mistake for an
// unrelated mock gap. The specs assert this stays null.
let apiKeysInsertArg: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-a" } }, error: null }),
    },
    from: (table: string) => {
      if (table === "discovery_categories") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "strategies") {
        return {
          update: () => ({
            eq: () => Promise.resolve(strategiesUpdateResult),
          }),
        };
      }
      if (table === "api_keys") {
        return {
          insert: (payload: Record<string, unknown>) => {
            apiKeysInsertArg = payload;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

const EDIT_STRATEGY = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Momentum Alpha",
  description: "desc",
  category_id: "cat-1",
  strategy_types: ["systematic"],
  subtypes: [],
  markets: ["crypto"],
  supported_exchanges: ["binance"],
  leverage_range: null,
  aum: null,
  max_capacity: null,
  api_key_id: "key-1",
} as unknown as Strategy;

beforeEach(() => {
  routerPushMock.mockClear();
  routerRefreshMock.mockClear();
  strategiesUpdateResult = { error: null };
  apiKeysInsertArg = null;
  // jsdom lacks HTMLDialogElement methods the <Modal> uses on mount.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  vi.clearAllMocks();
  // 160-03: several specs install a `vi.spyOn(globalThis, "fetch")`.
  // `clearAllMocks` only resets call history — it leaves the spy INSTALLED, so
  // a later spec inherits the previous one's canned Response. Restoring is what
  // makes each connect-flow spec assert its own fetch mock rather than a
  // neighbour's (the project's documented CI-only-vitest-skew class).
  vi.restoreAllMocks();
});

function submitEditForm() {
  render(<StrategyForm mode="edit" strategy={EDIT_STRATEGY} />);
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
}

describe("StrategyForm — H-0405 error redaction", () => {
  it("redacts a 42501 cross-tenant trigger message to a safe banner (no UUIDs / migration name)", async () => {
    strategiesUpdateResult = {
      error: {
        code: "42501",
        message:
          "api_key_id 11111111-1111-1111-1111-111111111111 does not belong to user 22222222-2222-2222-2222-222222222222 (cross-tenant linkage blocked by migration 028/029)",
      },
    };
    submitEditForm();

    expect(
      await screen.findByText("You can only link API keys you own."),
    ).toBeInTheDocument();
    // The raw leak must be gone from the rendered UI.
    expect(screen.queryByText(/cross-tenant linkage blocked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/migration 028/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11111111-1111-1111/)).not.toBeInTheDocument();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("redacts any other raw DB error to a generic message (no column/constraint text)", async () => {
    strategiesUpdateResult = {
      error: {
        code: "23502",
        message: 'null value in column "name" violates not-null constraint',
      },
    };
    submitEditForm();

    expect(
      await screen.findByText("Couldn't save your strategy. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not-null constraint/)).not.toBeInTheDocument();
    expect(screen.queryByText(/violates/)).not.toBeInTheDocument();
  });

  it("navigates on success and shows no error banner (happy path preserved)", async () => {
    strategiesUpdateResult = { error: null };
    submitEditForm();

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/strategies"));
    expect(
      screen.queryByText("Couldn't save your strategy. Please try again."),
    ).not.toBeInTheDocument();
  });

  // 160-03 / RANK-03 — the H-0405 same-class connect-key case that used to live
  // here ("redacts a raw api_keys insert error from the connect-key banner") is
  // RETIRED, not dropped: it drove `.from("api_keys").insert(...)` to a 42501
  // and asserted this component redacted it. That writer no longer exists in
  // the browser. Its coverage moved in two directions and BOTH halves are
  // pinned:
  //   - server half: the persist arm scrubs the raw PostgREST message at the
  //     console AND Sentry sinks and answers a curated envelope —
  //     `src/app/api/keys/validate-and-encrypt/route.test.ts` (160-02).
  //   - client half: "surfaces the route's curated persist-failure copy, not
  //     raw Postgres text" in the 160-03 describe block at the foot of this file.
  // The `toUserFacingStrategyError` redaction for the strategies insert/update
  // — the ORIGINAL H-0405 finding — is untouched and still covered above.
});

/**
 * F4 (Phase 122): the legacy StrategyForm connect-key modal must NOT auto-offer
 * sfox — the modal renders a hardcoded API Secret field + generic copy, which
 * structurally cannot serve token-only sfox. The wizard ApiKeyForm owns the
 * correct sfox flow; this legacy surface excludes it.
 *
 * 160-03: F4's OTHER half — "the insert must carry the canonical lowercase
 * exchange + a lowercase-derived label" — no longer has an insert to assert
 * against. The same chokepoint is now asserted on the REQUEST BODY (which is
 * what the value actually flows into) by "POSTs persist:true with the canonical
 * exchange + default label" in the 160-03 describe block below, and enforced a
 * second time server-side by the route's own `exchangeNormalized` binding.
 */
describe("StrategyForm — F4 sfox exclusion on the legacy connect surface", () => {
  it("flag ON: the connect-key modal does NOT offer sfox (legacy surface excludes it)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { StrategyForm: Fresh } = await import("./StrategyForm");

    render(<Fresh mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: /connect api key/i }));

    const optionValues = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    // Revert-proof: with the flag ON, EXCHANGES includes sfox; the filter must
    // still keep it out of THIS legacy modal's dropdown.
    expect(optionValues).not.toContain("sfox");
    // The ccxt offer is intact.
    expect(optionValues).toEqual(
      expect.arrayContaining(["binance", "okx", "bybit", "deribit"]),
    );
    vi.unstubAllEnvs();
  });
});

/**
 * 160-03 / RANK-03 — StrategyForm is the SECOND of three browser sites that
 * used to compose the `api_keys` INSERT itself. A browser-composed row can
 * claim any `exchange`, and the venue is what picks the annualization factor
 * downstream (√365 crypto vs √252 traditional), so the row is now written
 * SERVER-side by `/api/keys/validate-and-encrypt` in `persist: true` mode,
 * which stamps `exchange` AND `attested_venue` from the single venue binding
 * it actually authenticated against (160-02).
 *
 * WHY these tests matter (Rule 9): plan 160-05 REVOKEs the `authenticated`
 * INSERT grant on `api_keys`. Any client insert chain surviving in this file
 * becomes a hard 42501 at that merge — the connect flow simply dies. The
 * negative assertion (`apiKeysInsertArg` stays null) is therefore not
 * decoration: it is the pre-condition the REVOKE greps for. The supabase mock
 * deliberately KEEPS its `api_keys.insert` branch so a reintroduced insert is
 * observable rather than an "unexpected from()" throw.
 */
describe("StrategyForm — 160-03 server-side persist (no client api_keys INSERT)", () => {
  function openConnectModalAndSubmit() {
    render(<StrategyForm mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: /connect api key/i }));
    fireEvent.change(screen.getByPlaceholderText(/your read-only api key/i), {
      target: { value: "kkkkkkkk" },
    });
    fireEvent.change(screen.getByPlaceholderText(/your api secret/i), {
      target: { value: "ssssssss" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Key" }));
  }

  function validateBody(fetchSpy: { mock: { calls: unknown[][] } }) {
    const call = (fetchSpy.mock.calls as [string, RequestInit][]).find(
      (c) => c[0] === "/api/keys/validate-and-encrypt",
    );
    expect(call).toBeTruthy();
    return JSON.parse(call![1].body as string) as Record<string, unknown>;
  }

  it("POSTs persist:true with the canonical exchange + default label, and issues NO api_keys insert", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          api_key_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
          valid: true,
          read_only: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    openConnectModalAndSubmit();

    // The connect succeeded end-to-end — the success copy is the only proof the
    // component treated the persist response as a completed save.
    expect(
      await screen.findByText("Read-only API key verified and connected."),
    ).toBeInTheDocument();

    const body = validateBody(fetchSpy);
    // The discriminator is a STRICT boolean server-side: `body.persist === true`.
    // Sending "true"/1 would silently fall through to the legacy arm and mint
    // ZERO rows while this component reported success.
    expect(body.persist).toBe(true);
    // Default select value is "binance" (lowercase). The label is the
    // component's pre-existing default template, now carried in the request
    // body because the SERVER composes the row.
    expect(body.exchange).toBe("binance");
    expect(body.label).toBe("binance key");

    // ⭐ The load-bearing negative: zero browser-composed inserts.
    expect(apiKeysInsertArg).toBeNull();
  });

  it("fails LOUDLY when a 2xx carries no api_key_id — never reports a key as connected", async () => {
    // The legacy arm's shape (ciphertext, no id). If a stale/misrouted response
    // reaches the persist call site, the key was NOT saved: reporting success
    // would leave the user believing a key exists that will never sync.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ valid: true, read_only: true, api_key_encrypted: "ct" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    openConnectModalAndSubmit();

    expect(
      await screen.findByText(
        "Your key was verified but not saved. Please try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Read-only API key verified and connected."),
    ).not.toBeInTheDocument();
    expect(apiKeysInsertArg).toBeNull();
  });

  it("surfaces the route's curated persist-failure copy, not raw Postgres text (H-0405 class)", async () => {
    // The persist arm answers an INSERT fault with a CURATED envelope and
    // scrubs the raw PostgREST message at both log sinks (160-02, route.ts).
    // The redaction that used to live in this component moved WITH the writer;
    // this test pins the client half — the curated sentence is what the banner
    // shows, and the flow does not fall through to "connected".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Your key was verified but couldn't be saved. Please try again.",
          code: "UNKNOWN",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );

    openConnectModalAndSubmit();

    expect(
      await screen.findByText(
        "Your key was verified but couldn't be saved. Please try again.",
      ),
    ).toBeInTheDocument();
    // No SQLSTATE / constraint / RLS text anywhere in the rendered UI.
    expect(screen.queryByText(/row-level security/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/42501|23514/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Read-only API key verified and connected."),
    ).not.toBeInTheDocument();
    expect(apiKeysInsertArg).toBeNull();
  });
});
