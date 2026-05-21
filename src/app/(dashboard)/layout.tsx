import { redirect } from "next/navigation";
import { DashboardChrome } from "@/components/layout/DashboardChrome";
import { getPopulatedCategorySlugs } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { isProfileApproved } from "@/lib/approval";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Universal signup-approval gate (task #14, 2026-05-21). MUST run BEFORE
  // any other dashboard work so a pending profile never sees discovery,
  // strategies, allocations, or any chrome that teases features they
  // cannot yet reach. The gate is keyed to profile.{allocator,manager}_status
  // (existing schema, default 'newbie') flipping to 'verified' when an
  // admin approves — see /api/admin/{allocator,manager}-approve. The
  // /pending-approval page (under (auth) layout) renders the "your
  // application is being reviewed" message; that page also short-
  // circuits to /onboarding for verified users so this redirect is the
  // only entry point that needs to exist on the gating side.
  //
  // Admin override is in isProfileApproved (is_admin=true short-circuits)
  // so admins can still reach the admin approval queue itself. Without
  // that override, the first admin signup ever would lock the operator
  // out of the very screen they need to unblock everyone else.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isAdmin = false;
  let isAllocator = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, allocator_status, manager_status, is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!isProfileApproved(profile)) {
      redirect("/pending-approval");
    }
    isAdmin = profile?.is_admin === true;
    isAllocator = profile?.role === "allocator" || profile?.role === "both";
  } else {
    // No session reaches the dashboard tree because every page already
    // calls supabase.auth.getUser() + redirect("/login") in its server
    // body. Leaving this branch as a no-op keeps the layout's behaviour
    // identical to before the gate landed when the session is absent —
    // the page-level redirect is what fires, not the gate.
  }

  // isAdminUser() runs a SECOND auth check against the admin claim set
  // (matches the canonical admin gate used by every admin route). Keep
  // the call so the chrome flag stays consistent even if a future
  // profile.is_admin drift slips in between profile + claim sources.
  if (user) {
    try {
      isAdmin = await isAdminUser(supabase, user);
    } catch {
      // Fall back to profile.is_admin set above.
    }
  }

  let populatedSlugs: string[] | undefined;
  try {
    const result = await getPopulatedCategorySlugs();
    if (result.length > 0) populatedSlugs = result;
  } catch {
    // undefined falls back to showing all categories in Sidebar
  }

  return (
    <DashboardChrome
      populatedSlugs={populatedSlugs}
      isAdmin={isAdmin}
      isAllocator={isAllocator}
    >
      {children}
    </DashboardChrome>
  );
}
