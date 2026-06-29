import { type ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional small inline node rendered under the title (badges, pills, etc.). */
  meta?: ReactNode;
  /**
   * Phase 51 NAV-02 — optional curated back-path crumbs. When passed, a
   * <Breadcrumb> renders ABOVE the <h1> (the app-wide "where am I / how do I get
   * back" affordance). Curated items only (never segment auto-derivation — avoids
   * raw-UUID/token crumbs on [id]/[token] routes). Omitting it renders the header
   * exactly as before — additive, no regression for existing call sites.
   */
  breadcrumb?: BreadcrumbItem[];
}

export function PageHeader({ title, description, actions, meta, breadcrumb }: PageHeaderProps) {
  return (
    <>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="font-display text-fixed-32 tracking-tight text-text-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-base text-text-secondary">{description}</p>
        )}
        {meta && <div className="mt-2 flex items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </>
  );
}
