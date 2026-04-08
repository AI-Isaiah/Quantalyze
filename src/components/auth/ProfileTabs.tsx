"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ProfileForm } from "./ProfileForm";
import { DeleteAccountButton } from "./DeleteAccountButton";
import { OrganizationTab } from "@/components/org/OrganizationTab";
import type { Profile } from "@/lib/types";

const TABS = [
  { key: "personal", label: "Personal Info" },
  { key: "organizations", label: "Organizations" },
  { key: "account", label: "Account" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ProfileTabs({ profile }: { profile: Profile }) {
  const [activeTab, setActiveTab] = useState<TabKey>("personal");

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((tab) => (
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
      {activeTab === "organizations" && <OrganizationTab />}
      {activeTab === "account" && (
        <div className="max-w-xl">
          <DeleteAccountButton />
        </div>
      )}
    </div>
  );
}
