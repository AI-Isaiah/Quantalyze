/**
 * Phase 208 / Plan 05 / D-16 - REAL-CHAIN proof for POST /api/allocator/scenario/share.
 *
 * WHY THIS FILE EXISTS. The scenario share url is built on the origin of
 * `Origin ?? Referer`, and this route never calls the origin gate itself: its
 * POST is the allocator wrapper, which composes the auth wrapper, which runs
 * the same-origin check on every non-GET/HEAD/OPTIONS request before the
 * handler. The sibling `route.test.ts` mocks the allocator wrapper away, and
 * every wrapper test under `src/lib/api` mocks the csrf module or the auth
 * wrapper, so without this file a regression that dropped the gate would leave
 * the url built on an unvalidated header with every test green.
 *
 * The csrf module, the auth wrapper and the allocator wrapper are therefore
 * deliberately NOT mocked here. Only the collaborators below them are stubbed
 * (supabase client, rate limiter, Sentry, audit). The approval gate is stubbed
 * globally by `src/test-setup.ts` and resolves "approved".
 *
 * Arms (i) and (ii) prove a forged and a header-less POST get 403 before any
 * database call. Arm (iii) proves a preview host the allow-list admits gets 200
 * and a link on that host, so (i) and (ii) cannot pass against an always-403
 * stub. Pattern: `src/app/api/preferences/route.csrf-integration.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { __resetAllowedHostsForTest } from "@/lib/csrf";

vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  createClientCalls: 0,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  fromCalls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    STATE.createClientCalls += 1;
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: "00000000-0000-0000-0000-000000000aaa" } },
          error: null,
        }),
      },
      from: (table: string) => {
        STATE.fromCalls.push(table);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === "profiles"
                  ? { data: { role: "allocator" }, error: null }
                  : {
                      data: {
                        id: "scen-1",
                        draft: { addedStrategies: [{ id: "strat-1" }] },
                      },
                      error: null,
                    },
            }),
          }),
        };
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        STATE.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: "share-1", error: null });
      },
    };
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: async () => ({ success: true }),
  isRateLimitMisconfigured: () => false,
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("@/lib/audit", () => ({ logAuditEvent: vi.fn() }));

const SCENARIO_ID = "11111111-1111-1111-1111-111111111111";
const PREVIEW_HOST = "quantalyze-preview-208.vercel.test";
const PREVIEW_ORIGIN = `https://${PREVIEW_HOST}`;

function mkPost(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/allocator/scenario/share", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ scenario_id: SCENARIO_ID }),
  });
}

let originalVercelUrl: string | undefined;
let originalAppUrl: string | undefined;

beforeEach(() => {
  STATE.createClientCalls = 0;
  STATE.rpcCalls = [];
  STATE.fromCalls = [];
  originalVercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
  originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  // No other file may see the preview host in the allow-list.
  if (originalVercelUrl === undefined) delete process.env.NEXT_PUBLIC_VERCEL_URL;
  else process.env.NEXT_PUBLIC_VERCEL_URL = originalVercelUrl;
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  __resetAllowedHostsForTest();
});

describe("POST /api/allocator/scenario/share - real same-origin chain (D-16)", () => {
  it("(i) a forged cross-origin POST is 403 before any database call", async () => {
    const { POST } = await import("./route");
    const res = await POST(mkPost({ origin: "https://evil.example.com" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Origin not allowed");
    expect(STATE.createClientCalls).toBe(0);
    expect(STATE.fromCalls).toHaveLength(0);
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("(ii) a POST with neither Origin nor Referer is 403 before any database call", async () => {
    const { POST } = await import("./route");
    const res = await POST(mkPost({}));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Missing Origin or Referer header");
    expect(STATE.createClientCalls).toBe(0);
    expect(STATE.fromCalls).toHaveLength(0);
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("(iii) an allow-listed preview host is admitted and the link comes back on that host", async () => {
    process.env.NEXT_PUBLIC_VERCEL_URL = PREVIEW_HOST;
    process.env.NEXT_PUBLIC_APP_URL = "https://share.example.com";
    __resetAllowedHostsForTest();
    const { POST } = await import("./route");
    const res = await POST(mkPost({ origin: PREVIEW_ORIGIN }));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url.startsWith(`${PREVIEW_ORIGIN}/scenario-share/`)).toBe(true);
    expect(url).not.toContain("share.example.com");
    expect(
      STATE.rpcCalls.filter((c) => c.fn === "create_scenario_share"),
    ).toHaveLength(1);
  });
});
