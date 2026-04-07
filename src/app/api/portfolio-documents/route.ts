import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership } from "@/lib/queries";
import { DOC_TYPES } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

export const GET = withAuth(async (req: NextRequest, user: User) => {
  const portfolioId = new URL(req.url).searchParams.get("portfolio_id");
  if (!portfolioId) {
    return NextResponse.json({ error: "Missing portfolio_id" }, { status: 400 });
  }

  if (!(await assertPortfolioOwnership(portfolioId, user.id))) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("relationship_documents")
    .select("id, title, doc_type, file_url, file_path, file_name, strategy_id, created_at, portfolio_id")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ documents: data ?? [] });
});

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { portfolio_id, title, doc_type, file_path, strategy_id } = body as {
    portfolio_id?: string;
    title?: string;
    doc_type?: string;
    file_path?: string;
    strategy_id?: string | null;
  };

  if (!portfolio_id || !title || !doc_type || !file_path) {
    return NextResponse.json(
      { error: "Missing required fields: portfolio_id, title, doc_type, file_path" },
      { status: 400 },
    );
  }
  if (!DOC_TYPES.includes(doc_type as (typeof DOC_TYPES)[number])) {
    return NextResponse.json(
      { error: `Invalid doc_type. Must be one of: ${DOC_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  if (!(await assertPortfolioOwnership(portfolio_id, user.id))) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: publicUrl } = supabase.storage
    .from("portfolio-documents")
    .getPublicUrl(file_path);

  const { data, error } = await supabase
    .from("relationship_documents")
    .insert({
      portfolio_id,
      strategy_id: strategy_id || null,
      title,
      doc_type,
      file_path,
      file_url: publicUrl.publicUrl,
      file_name: title,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ document: data });
});
