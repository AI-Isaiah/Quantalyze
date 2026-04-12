import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_CONTENT_BYTES = 100 * 1024; // 100 KB

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const portfolioId = request.nextUrl.searchParams.get("portfolio_id");
  if (!portfolioId) {
    return NextResponse.json(
      { error: "Missing portfolio_id" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("user_notes")
    .select("content, updated_at")
    .eq("user_id", user.id)
    .eq("portfolio_id", portfolioId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = "JSON object requested, multiple (or no) rows returned"
    // i.e. .single() found 0 rows — that's a legitimate not-found, not a DB error.
    console.error("[notes] DB error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ content: data.content, updated_at: data.updated_at });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { content, portfolio_id } = body;
  if (typeof content !== "string" || typeof portfolio_id !== "string") {
    return NextResponse.json(
      { error: "content and portfolio_id are required" },
      { status: 400 },
    );
  }

  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "Content exceeds 100 KB limit" },
      { status: 400 },
    );
  }

  // Ownership check: portfolio must belong to user
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolio_id)
    .eq("user_id", user.id)
    .single();

  if (!portfolio) {
    return NextResponse.json(
      { error: "Portfolio not found or not owned by user" },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("user_notes")
    .upsert(
      {
        user_id: user.id,
        portfolio_id: portfolio_id,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,portfolio_id" },
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

  return NextResponse.json({ updated_at: data?.updated_at });
}
