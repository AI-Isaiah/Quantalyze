import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { MandateForm } from "@/components/mandate/MandateForm";
import { createClient } from "@/lib/supabase/server";
import { getOwnPreferences } from "@/lib/preferences";

export default async function PreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const initial = await getOwnPreferences(supabase, user.id);

  return (
    <>
      <PageHeader
        title="My Allocation Settings"
        description="Tell us about your mandate. Changes save automatically."
      />
      <MandateForm initial={initial} />
    </>
  );
}
