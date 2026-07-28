import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { statusClasses, STATUS_LABEL, type LeaveStatus } from "@/lib/leave";

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-bold tracking-tight">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "success" | "destructive" | "warning";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning-foreground",
  }[tone];
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-extrabold tracking-tight", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        statusClasses(status),
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
