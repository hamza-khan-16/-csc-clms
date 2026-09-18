import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { statusClasses, STATUS_LABEL, type LeaveStatus } from "@/lib/leave";
import { CheckCircle2, Clock, XCircle, ChevronRight } from "lucide-react";

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
    <section className={cn("surface p-5 sm:p-6", className)}>
      {(title || action) && (
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-bold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export const StatCard = memo(function StatCard({
  label,
  value,
  hint,
  tone = "default",
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "success" | "destructive" | "warning";
  onClick?: () => void;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
  }[tone];
  return (
    <div
      className={cn("surface p-4", onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-extrabold tracking-tight", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
});

export function StatCardSkeleton() {
  return (
    <div className="surface p-4 space-y-2">
      <div className="h-3 w-24 rounded bg-muted animate-pulse" />
      <div className="h-8 w-16 rounded bg-muted animate-pulse" />
      <div className="h-2.5 w-32 rounded bg-muted animate-pulse" />
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border p-4 space-y-2 animate-pulse">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

const STATUS_ICON: Record<LeaveStatus, React.ReactNode> = {
  approved:          <CheckCircle2 className="size-3 shrink-0" />,
  hod_approved:      <CheckCircle2 className="size-3 shrink-0" />,
  rejected:          <XCircle      className="size-3 shrink-0" />,
  hod_recommended:   <ChevronRight className="size-3 shrink-0" />,  // HOD forwarded it
  pending_principal: <ChevronRight className="size-3 shrink-0" />,  // now with principal
  pending_hod:       <Clock        className="size-3 shrink-0" />,  // still waiting for HOD
  cancelled:         <XCircle      className="size-3 shrink-0" />,
};

export function StatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        statusClasses(status),
      )}
    >
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Empty({ children, illustration = "inbox" }: { children: ReactNode; illustration?: "inbox" | "calendar" | "check" | "search" }) {
  const svgs: Record<string, ReactNode> = {
    inbox: (
      <svg viewBox="0 0 80 60" className="mx-auto mb-3 w-20 opacity-25" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="14" width="64" height="40" rx="4" stroke="currentColor" strokeWidth="2"/>
        <path d="M8 28h18l5 8h18l5-8H72" stroke="currentColor" strokeWidth="2"/>
        <path d="M28 8l12 12 12-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    calendar: (
      <svg viewBox="0 0 80 60" className="mx-auto mb-3 w-20 opacity-25" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="10" width="64" height="46" rx="4" stroke="currentColor" strokeWidth="2"/>
        <path d="M8 22h64" stroke="currentColor" strokeWidth="2"/>
        <path d="M24 6v8M56 6v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="28" cy="35" r="3" fill="currentColor" opacity=".5"/>
        <circle cx="40" cy="35" r="3" fill="currentColor" opacity=".5"/>
        <circle cx="52" cy="35" r="3" fill="currentColor" opacity=".5"/>
      </svg>
    ),
    check: (
      <svg viewBox="0 0 80 60" className="mx-auto mb-3 w-20 opacity-25" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="30" r="22" stroke="currentColor" strokeWidth="2"/>
        <path d="M27 30l9 9 17-18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    search: (
      <svg viewBox="0 0 80 60" className="mx-auto mb-3 w-20 opacity-25" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="34" cy="28" r="16" stroke="currentColor" strokeWidth="2"/>
        <path d="M46 40l16 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M28 28h12M34 22v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5"/>
      </svg>
    ),
  };
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      {svgs[illustration]}
      <p>{children}</p>
    </div>
  );
}

// Reusable accessible pagination component used across the app
export function Pagination({
  page,
  totalPages,
  onPage,
  totalItems,
  pageSize,
  className = "",
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  totalItems: number;
  pageSize: number;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  // Show at most 5 page numbers, centred around current page
  const pages: number[] = [];
  const range = 2;
  for (let i = Math.max(1, page - range); i <= Math.min(totalPages, page + range); i++) {
    pages.push(i);
  }

  return (
    <nav
      aria-label="Pagination"
      className={`flex items-center justify-between pt-3 border-t border-border ${className}`}
    >
      <p className="text-xs text-muted-foreground">
        Showing {from}–{to} of {totalItems}
      </p>
      <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
        <button
          className="h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium disabled:opacity-40 hover:bg-muted transition-colors"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label="Previous page"
        >
          ← Prev
        </button>
        {pages[0] > 1 && (
          <>
            <button className="h-8 w-8 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted transition-colors" onClick={() => onPage(1)} aria-label="Page 1">1</button>
            {pages[0] > 2 && <span className="px-1 text-xs text-muted-foreground">…</span>}
          </>
        )}
        {pages.map((pg) => (
          <button
            key={pg}
            className={`h-8 w-8 rounded-lg border text-xs font-medium transition-colors ${pg === page ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
            onClick={() => onPage(pg)}
            aria-label={`Page ${pg}`}
            aria-current={pg === page ? "page" : undefined}
          >
            {pg}
          </button>
        ))}
        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && <span className="px-1 text-xs text-muted-foreground">…</span>}
            <button className="h-8 w-8 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted transition-colors" onClick={() => onPage(totalPages)} aria-label={`Page ${totalPages}`}>{totalPages}</button>
          </>
        )}
        <button
          className="h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium disabled:opacity-40 hover:bg-muted transition-colors"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </nav>
  );
}
