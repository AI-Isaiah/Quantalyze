"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProfileForm } from "./ProfileForm";
import { DeleteAccountButton } from "./DeleteAccountButton";
import { OrganizationTab } from "@/components/org/OrganizationTab";
import { MandateForm } from "@/components/mandate/MandateForm";
import type { Profile } from "@/lib/types";
import type { AllocatorPreferences } from "@/lib/preferences";

const ALL_TABS = [
  { key: "personal", label: "Personal Info" },
  { key: "mandate", label: "Mandate", allocatorOnly: true },
  { key: "organizations", label: "Organizations" },
  { key: "account", label: "Account" },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

const VALID_TAB_KEYS = ALL_TABS.map((t) => t.key) as readonly TabKey[];

function parseTabParam(raw: string | null, isAllocator: boolean): TabKey {
  if (!raw) return "personal";
  if (!(VALID_TAB_KEYS as readonly string[]).includes(raw)) return "personal";
  if (raw === "mandate" && !isAllocator) return "personal";
  return raw as TabKey;
}

interface Props {
  profile: Profile;
  initialPreferences?: AllocatorPreferences | null;
  isAllocator?: boolean;
}

export function ProfileTabs({ profile, initialPreferences = null, isAllocator = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialTab = parseTabParam(searchParams.get("tab"), isAllocator);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  // Sync active tab → URL param (shallow; preserves back/forward and sharable links).
  useEffect(() => {
    const current = searchParams.get("tab");
    const next = activeTab === "personal" ? null : activeTab;
    if (current === next) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("tab", next);
    else params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [activeTab, searchParams, router, pathname]);

  const tabs = ALL_TABS.filter((t) => !("allocatorOnly" in t && t.allocatorOnly) || isAllocator);

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "personal" && <ProfileForm profile={profile} />}
      {activeTab === "mandate" && isAllocator && (
        <MandateForm initial={initialPreferences} />
      )}
      {activeTab === "organizations" && <OrganizationTab />}
      {activeTab === "account" && (
        <div className="max-w-xl">
          <DeleteAccountButton />
        </div>
      )}
    </div>
  );
}
