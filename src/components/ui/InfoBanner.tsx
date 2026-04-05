import { type ReactNode } from "react";

interface InfoBannerProps {
  children: ReactNode;
  className?: string;
}

export function InfoBanner({ children, className = "" }: InfoBannerProps) {
  return (
    <div
      className={`rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-text-secondary ${className}`}
    >
      {children}
    </div>
  );
}
