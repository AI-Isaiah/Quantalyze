import { createClient } from "@/lib/supabase/server";
import { getDecks } from "@/lib/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { DeckCard } from "@/components/deck/DeckCard";
import { redirect } from "next/navigation";

export default async function DecksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const decks = await getDecks();

  return (
    <>
      <PageHeader
        title="Decks"
        description="Curated strategy bundles for diversified allocation."
      />

      {decks.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-text-muted">No decks available yet. Check back soon.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}
        </div>
      )}
    </>
  );
}
