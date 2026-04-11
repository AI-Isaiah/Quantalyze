import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for `withAdminAuth` — the CSRF + admin gate + body guard
 * wrapper used by every /api/admin/* mutation route. The new body
 * guard (Step 3.5 of the /review pass) rejects non-object JSON
 * payloads with a clean 400 instead of letting the handler crash on
 * `const { id } = body` against a primitive.
 *
 * Mocks: server-side Supabase client (auth.getUser), isAdminUser gate,
 * admin client factory, and assertSameOrigin from csrf.ts. Each test
 * invokes the wrapped handler with a fresh Request and asserts on the
 * returned NextResponse.
 */

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  isAdminUserMock,
  createAdminClientMock,
  assertSameOriginMock,
} = vi.hoisted(() => {
  return {
    getUserMock: vi.fn<() => Promise<{ data: { user: unknown } }>>(),
    isAdminUserMock: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    createAdminClientMock: vi.fn(() => ({ __admin: true })),
    assertSameOriginMock: vi.fn<(...args: unknown[]) => Response | null>(
      () => null,
    ),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: (client: unknown, user: unknown) =>
    isAdminUserMock(client, user),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

import { withAdminAuth } from "./withAdminAuth";

function makeRequest(body: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
  };
  if (body === "INVALID_JSON") {
    init.body = "{not json";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:3000/api/admin/test", init);
}

const adminUser = { id: "user-1", email: "admin@example.com" };

describe("withAdminAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: adminUser } });
    isAdminUserMock.mockResolvedValue(true);
    assertSameOriginMock.mockReturnValue(null);
  });

  describe("CSRF + admin gates", () => {
    it("rejects when assertSameOrigin returns a response", async () => {
      const csrfDenied = new Response("csrf", { status: 403 });
      assertSameOriginMock.mockReturnValueOnce(csrfDenied);

      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest({ id: "abc" }));

      expect(res).toBe(csrfDenied);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects when user is not an admin", async () => {
      isAdminUserMock.mockResolvedValueOnce(false);

      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest({ id: "abc" }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("body guard", () => {
    it("rejects null body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest(null));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object",
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects array body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest([1, 2, 3]));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object",
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects string body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest("just a string"));

      expect(res.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects number body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest(42));

      expect(res.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects invalid JSON with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest("INVALID_JSON"));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request body" });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("handler dispatch", () => {
    it("invokes the handler with the body and an admin client on happy path", async () => {
      const responseBody = { ok: true };
      const handler = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 }),
        );

      const wrapped = withAdminAuth(handler as never);
      const body = { id: "00000000-0000-0000-0000-000000000001" };
      const res = await wrapped(makeRequest(body));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(responseBody);
      expect(handler).toHaveBeenCalledTimes(1);
      const [bodyArg, adminArg] = handler.mock.calls[0];
      expect(bodyArg).toEqual(body);
      expect(adminArg).toEqual({ __admin: true });
      expect(createAdminClientMock).toHaveBeenCalled();
    });
  });
});
