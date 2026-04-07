import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  pickSelfEditableFields,
  validateSelfEditableInput,
  getOwnPreferences,
} from "@/lib/preferences";

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
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  // Mark on profile so we can show "preferences set" indicators
  await supabase
    .from("profiles")
    .update({ preferences_updated_at: new Date().toISOString() })
    .eq("id", user.id);

  return NextResponse.json({ success: true });
}
