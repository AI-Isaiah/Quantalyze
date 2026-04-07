import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { PreferenceForm } from "@/components/preferences/PreferenceForm";
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
        title="Preferences"
        description="Tell us about your mandate so we can send better strategy recommendations."
      />
      <PreferenceForm initial={initial} />
    </>
  );
}
