import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  pickSelfEditableFields,
  validateSelfEditableInput,
  getOwnPreferences,
} from "@/lib/preferences";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prefs = await getOwnPreferences(supabase, user.id);
    return NextResponse.json({ preferences: prefs });
  } catch (err) {
    console.error("[api/preferences] GET error:", err);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkLimit(userActionLimiter, `preferences:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Whitelist to only the 3 self-editable fields. Anything else is silently dropped.
  const fields = pickSelfEditableFields(body);
  const validationError = validateSelfEditableInput(fields);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Upsert (insert if no row, update if exists). Allocator can only edit their own row.
  const { error } = await supabase
    .from("allocator_preferences")
    .upsert(
      {
        user_id: user.id,
        ...fields,
        edited_by_user_id: null, // Self-edit
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[api/preferences] upsert error:", error);
    // Surface the schema-not-applied case explicitly so the founder knows what to do
    if (error.code === "PGRST205") {
      return NextResponse.json(
        { error: "Preferences are not available yet. Migration 011 needs to be applied to the database." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  // Mark on profile so we can show "preferences set" indicators.
  // The preferences_updated_at column is added by migration 011 — silently
  // skip the profile update if the column doesn't exist yet.
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ preferences_updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (profileErr && profileErr.code !== "42703") {
    console.error("[api/preferences] profile update error:", profileErr);
  }

  return NextResponse.json({ success: true });
}
