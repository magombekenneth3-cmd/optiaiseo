import { ReactNode } from "react";

interface PageHeaderProps {
  /** Page's primary h1 — always present */
  title: string;
  /** Secondary descriptor shown below the title */
  description?: string;
  /** Optional right-side action (button / link) */
  action?: ReactNode;
}

/**
 * Standard dashboard page header.
 * Renders a consistent h1 + description + optional right action.
 * All dashboard pages should use this instead of hand-rolled header markup.
 */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {action && (
        <div className="shrink-0 self-start sm:self-auto">{action}</div>
      )}
    </div>
  );
}
