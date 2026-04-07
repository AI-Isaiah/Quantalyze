import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { DocumentUpload } from "@/components/portfolio/DocumentUpload";
import { DocumentList } from "@/components/portfolio/DocumentList";
import { getPortfolioDetail, getPortfolioStrategies } from "@/lib/queries";

export default async function PortfolioDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolio = await getPortfolioDetail(id);
  if (!portfolio) redirect("/portfolios");

  const [portfolioStrategies, { data: docRows }] = await Promise.all([
    getPortfolioStrategies(id),
    supabase
      .from("relationship_documents")
      .select("id, file_url, file_type, file_name, created_at, portfolio_id")
      .eq("portfolio_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const strategies = portfolioStrategies
    .map((ps) => {
      const s = (ps as { strategies?: { id: string; name: string } | null }).strategies;
      return s ? { id: s.id, name: s.name } : null;
    })
    .filter((s): s is { id: string; name: string } => s !== null);
  const strategyNames: Record<string, string> = Object.fromEntries(
    strategies.map((s) => [s.id, s.name]),
  );

  const documents = (docRows ?? []).map((d) => ({
    id: d.id,
    title: d.file_name ?? "Untitled",
    doc_type: d.file_type,
    file_url: d.file_url,
    file_name: d.file_name,
    created_at: d.created_at,
    portfolio_id: d.portfolio_id,
  }));

  return (
    <>
      <PageHeader
        title="Documents"
        description={`Files and records for ${portfolio.name}`}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
        <DocumentUpload portfolioId={id} userId={user.id} strategies={strategies} />
        <DocumentList documents={documents} strategyNames={strategyNames} />
      </div>
    </>
  );
}
