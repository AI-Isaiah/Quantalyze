import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface WarningBannerProps {
  children: ReactNode;
  className?: string;
}

export function WarningBanner({ children, className }: WarningBannerProps) {
  return (
    <div
      className={cn("rounded-lg border border-badge-market-neutral/30 bg-badge-market-neutral/5 px-4 py-3 text-sm text-text-secondary", className)}
    >
      {children}
    </div>
  );
}
