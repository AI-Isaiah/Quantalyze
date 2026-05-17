import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadDeletionRequestForAction } from "./_shared";

/**
 * audit-2026-05-07 Cluster-K C-0030 — direct unit coverage for the
 * 7-check preamble shared by /approve + /reject. Two regressions this
 * file guards against:
 *
 *   (a) verb-specific 409 phrasing diverges between approve/reject
 *       silently — operator UX breakage that no end-to-end route test
 *       catches because the two routes are exercised independently.
 *
 *   (b) someone re-orders the preamble so the terminal-state guard fires
 *       BEFORE the self-action guard — an admin's own completed/rejected
 *       row would then leak detail to that admin via a 409 instead of
 *       the canonical 403. The docstring in _shared.ts CALLS THIS
 *       ORDERING OUT — this test pins it.
 */

const ADMIN_ID = "00000000-0000-0000-0000-0000000000aa";
const TARGET_USER_ID = "00000000-0000-0000-0000-0000000000bb";
const REQUEST_ID = "11111111-1111-1111-1111-111111111111";

type MaybeSingleResult = {
  data:
    | null
    | {
        id: string;
        user_id: string;
        requested_at: string;
        completed_at: string | null;
        rejected_at: string | null;
      };
  error: { message: string } | null;
};

function makeAdminStub(result: MaybeSingleResult): SupabaseClient {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("loadDeletionRequestForAction — 7-check preamble (C-0030)", () => {
  it("returns 400 when requestId is missing (check 1)", async () => {
    const admin = makeAdminStub({ data: null, error: null });

    const out = await loadDeletionRequestForAction(
      admin,
      undefined,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(400);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/missing deletion-request id/i);
  });

  it("returns 500 when the lookup fails (check 2)", async () => {
    const admin = makeAdminStub({
      data: null,
      error: { message: "db down" },
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "reject",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(500);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/failed to load deletion request/i);
  });

  it("returns 404 when the row is not found (check 3)", async () => {
    const admin = makeAdminStub({ data: null, error: null });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(404);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 403 self-action message with the verb mirrored — approve (check 4)", async () => {
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: ADMIN_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: null,
        rejected_at: null,
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(403);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/cannot approve their own deletion request/i);
    expect(body.error).toMatch(/another admin must act/i);
  });

  it("returns 403 self-action message with the verb mirrored — reject (check 4)", async () => {
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: ADMIN_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: null,
        rejected_at: null,
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "reject",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(403);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/cannot reject their own deletion request/i);
  });

  it("self-guard fires BEFORE the already-completed guard (ordering invariant)", async () => {
    // Row belongs to the acting admin AND is already completed. Either
    // guard could fire — the docstring pins self-action FIRST. This test
    // fails if anyone re-orders the checks.
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: ADMIN_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: "2026-05-02T00:00:00Z",
        rejected_at: null,
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(403);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/cannot approve their own/i);
  });

  it("self-guard fires BEFORE the already-rejected guard (ordering invariant)", async () => {
    // Row belongs to the acting admin AND is already rejected. Self
    // guard must still win.
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: ADMIN_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: null,
        rejected_at: "2026-05-02T00:00:00Z",
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "reject",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(403);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toMatch(/cannot reject their own/i);
  });

  it("returns 409 already-completed with the approve-specific phrasing (check 5)", async () => {
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: TARGET_USER_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: "2026-05-02T00:00:00Z",
        rejected_at: null,
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(409);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toBe("Deletion request is already completed");
  });

  it("returns 409 already-completed with the reject-specific phrasing (check 5)", async () => {
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: TARGET_USER_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: "2026-05-02T00:00:00Z",
        rejected_at: null,
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "reject",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(409);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toBe(
      "Deletion request is already completed — cannot reject",
    );
  });

  it("returns 409 already-rejected with the approve-specific phrasing (check 6)", async () => {
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: TARGET_USER_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: null,
        rejected_at: "2026-05-02T00:00:00Z",
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(409);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toBe(
      "Deletion request was rejected — cannot approve",
    );
  });

  it("returns 409 already-rejected with the reject-specific phrasing (check 6)", async () => {
    const admin = makeAdminStub({
      data: {
        id: REQUEST_ID,
        user_id: TARGET_USER_ID,
        requested_at: "2026-05-01T00:00:00Z",
        completed_at: null,
        rejected_at: "2026-05-02T00:00:00Z",
      },
      error: null,
    });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "reject",
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.res.status).toBe(409);
    const body = (await out.res.json()) as { error: string };
    expect(body.error).toBe("Deletion request is already rejected");
  });

  it("returns ok:true with the row when all 7 checks pass (check 7)", async () => {
    const row = {
      id: REQUEST_ID,
      user_id: TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };
    const admin = makeAdminStub({ data: row, error: null });

    const out = await loadDeletionRequestForAction(
      admin,
      REQUEST_ID,
      ADMIN_ID,
      "approve",
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row).toEqual(row);
  });
});
