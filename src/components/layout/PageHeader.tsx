import { type ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional small inline node rendered under the title (badges, pills, etc.). */
  meta?: ReactNode;
}

export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="font-display text-[32px] tracking-tight text-text-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-base text-text-secondary">{description}</p>
        )}
        {meta && <div className="mt-2 flex items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
