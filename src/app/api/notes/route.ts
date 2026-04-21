import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import {
  checkScopeOwnership,
  type ScopeKind,
} from "@/lib/notes/ownership";

/**
 * /api/notes — multi-scope user notes (Phase 08 Plan 01).
 *
 * Body shape (PATCH): { scope_kind, scope_ref, content }
 * Query shape (GET):  ?scope_kind=<kind>&scope_ref=<ref>
 *
 * scope_kinds: portfolio | holding | bridge_outcome | strategy
 * scope_ref:   UUID text (portfolio/bridge_outcome/strategy) or
 *              `{venue}:{symbol}:{holding_type}` (holding)
 *
 * Ownership is enforced per-scope at the app layer (D-09) — the four
 * scopes have distinct validity predicates that don't collapse into a
 * single DB expression. RLS on user_notes still enforces owner-only at
 * the DB layer as defense-in-depth.
 *
 * Audit emission (Finding #8): entity_id is a scope-appropriate UUID,
 * not a synthetic composite — audit_log.entity_id is UUID-typed. The
 * holding scope uses the caller's user_id because no single row
 * aggregates a holding-scope note.
 */

const MAX_CONTENT_BYTES = 100 * 1024; // 100 KB

const ALLOWED_KINDS = [
  "portfolio",
  "holding",
  "bridge_outcome",
  "strategy",
] as const;

const BodySchema = z.object({
  scope_kind: z.enum(ALLOWED_KINDS),
  scope_ref: z.string().min(1).max(512),
  content: z.string(),
});

/**
 * Resolve the audit entity_id per scope. Finding #8 pins this mapping:
 * holding has no single aggregate row → caller's user_id; all other
 * scopes use scope_ref (which is already a UUID).
 */
function resolveEntityId(
  scope_kind: ScopeKind,
  scope_ref: string,
  userId: string,
): string {
  return scope_kind === "holding" ? userId : scope_ref;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope_kind = request.nextUrl.searchParams.get("scope_kind");
  const scope_ref = request.nextUrl.searchParams.get("scope_ref");
  if (
    !scope_kind ||
    !scope_ref ||
    !(ALLOWED_KINDS as readonly string[]).includes(scope_kind)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid scope_kind/scope_ref" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("user_notes")
    .select("content, updated_at")
    .eq("user_id", user.id)
    .eq("scope_kind", scope_kind)
    .eq("scope_ref", scope_ref)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = 0 rows via .single() — legitimate not-found, not a DB error.
    console.error("[notes] DB error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    content: data.content,
    updated_at: data.updated_at,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { scope_kind, scope_ref, content } = parsed.data;

  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "Content exceeds 100 KB limit" },
      { status: 400 },
    );
  }

  const own = await checkScopeOwnership(
    supabase,
    user.id,
    scope_kind,
    scope_ref,
  );
  if (!own.ok) {
    // Generic 403 per D-09 — do not leak the ownership reason to the client.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("user_notes")
    .upsert(
      {
        user_id: user.id,
        scope_kind,
        scope_ref,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,scope_kind,scope_ref" },
    )
    .select("updated_at")
    .single();

  if (error) {
    console.error("user_notes upsert failed:", error);
    return NextResponse.json(
      { error: "Failed to save note" },
      { status: 500 },
    );
  }

  // Finding #8 entity_id resolution + D-20 privacy invariant
  // (metadata carries scope_kind, scope_ref, content_length — NOT content).
  logAuditEvent(supabase, {
    action: `user_note.${scope_kind}.update` as const,
    entity_type: "user_note",
    entity_id: resolveEntityId(scope_kind, scope_ref, user.id),
    metadata: {
      scope_kind,
      scope_ref,
      content_length: content.length,
    },
  });

  return NextResponse.json({ updated_at: data?.updated_at });
}
