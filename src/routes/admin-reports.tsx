import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAVE_TYPES, leaveTypeLabel, fmtDate, type LeaveType } from "@/lib/leave";
import { FileText, Download, BarChart2, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/admin-reports")({
  head: () => ({
    meta: [
      { title: "Reports — CSC Leave Management" },
      { name: "description", content: "College-wide leave analytics and exports." },
    ],
  }),
  component: () => (
    <Guarded roles={["admin", "principal"]}>
      <AdminReportsPage />
    </Guarded>
  ),
});

// ── Types ──────────────────────────────────────────────────────────────────────
type ReportLeave = {
  id: string; teacher_id: string; leave_type: string; from_date: string;
  to_date: string; session: string; total_days: number; paid_days: number;
  unpaid_days: number; status: string; reason: string;
};
type PeopleMap = Record<string, { full_name: string; department_name: string | null; department_id: string | null } | undefined>;

// ── Report module definitions ─────────────────────────────────────────────────
const REPORT_MODULES = [
  {
    key: "teacher",
    label: "Teacher Report",
    description: "Leave records per teacher",
    icon: "👨‍🏫",
    build: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher:        people[l.teacher_id]?.full_name ?? "—",
        Department:     people[l.teacher_id]?.department_name ?? "—",
        "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
        "From":         fmtDate(l.from_date),
        "To":           fmtDate(l.to_date),
        Session:        l.session,
        "Total Days":   l.total_days,
        "Paid Days":    l.paid_days,
        "Pay Cut Days": l.unpaid_days,
        Status:         l.status,
        Reason:         l.reason ?? "",
      })),
  },
  {
    key: "department",
    label: "Department Report",
    description: "Department-level leave summary",
    icon: "🏢",
    build: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, { total: number; unpaid: number; count: number }> = {};
      for (const l of leaves) {
        const dept = people[l.teacher_id]?.department_name ?? "Unknown";
        if (!map[dept]) map[dept] = { total: 0, unpaid: 0, count: 0 };
        map[dept].total  += Number(l.total_days);
        map[dept].unpaid += Number(l.unpaid_days);
        map[dept].count  += 1;
      }
      return Object.entries(map).map(([dept, v]) => ({
        Department:        dept,
        "Leave Requests":  v.count,
        "Total Days":      v.total,
        "Pay Cut Days":    v.unpaid,
      }));
    },
  },
  {
    key: "history",
    label: "Leave History",
    description: "Full audit trail of all leave requests",
    icon: "📋",
    build: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher:        people[l.teacher_id]?.full_name ?? "—",
        Department:     people[l.teacher_id]?.department_name ?? "—",
        "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
        "From":         fmtDate(l.from_date),
        "To":           fmtDate(l.to_date),
        Session:        l.session,
        "Total Days":   l.total_days,
        "Paid Days":    l.paid_days,
        "Pay Cut Days": l.unpaid_days,
        Status:         l.status,
        Reason:         l.reason ?? "",
      })),
  },
  {
    key: "attendance",
    label: "Attendance Report",
    description: "Monthly leave days per teacher",
    icon: "📅",
    build: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, Record<string, number>> = {};
      for (const l of leaves) {
        const name  = people[l.teacher_id]?.full_name ?? "—";
        const month = l.from_date.slice(0, 7);
        if (!map[name]) map[name] = {};
        map[name][month] = (map[name][month] ?? 0) + Number(l.total_days);
      }
      return Object.entries(map).flatMap(([name, months]) =>
        Object.entries(months).map(([month, days]) => ({
          Teacher:                name,
          Month:                  month,
          "Leave Days":           days,
          "Working Days (approx)": 26,
          "Attendance %":         (((26 - days) / 26) * 100).toFixed(1) + "%",
        })),
      );
    },
  },
  {
    key: "payroll",
    label: "Payroll Report",
    description: "Teachers with salary deductions",
    icon: "💰",
    build: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves
        .filter((l) => Number(l.unpaid_days) > 0)
        .map((l) => ({
          Teacher:        people[l.teacher_id]?.full_name ?? "—",
          Department:     people[l.teacher_id]?.department_name ?? "—",
          "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
          "From":         fmtDate(l.from_date),
          "To":           fmtDate(l.to_date),
          "Pay Cut Days": l.unpaid_days,
          Status:         l.status,
        })),
  },
] as const;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function AdminReportsPage() {
  const currentYear = new Date().getFullYear();
  const [activeModule, setActiveModule] = useState<string>("teacher");
  const [filterYear,   setFilterYear]   = useState<string>(String(currentYear));
  const [filterDept,   setFilterDept]   = useState<string>("all");
  const [filterMonth,  setFilterMonth]  = useState<string>("all");
  const [filterType,   setFilterType]   = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [exporting, setExporting] = useState(false);

  // Departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments-list"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Raw leave data
  const { data: reportData, isLoading } = useQuery({
    queryKey: ["admin-report-data", filterYear],
    queryFn: async () => {
      const { data: leaves, error } = await supabase
        .from("leave_requests")
        .select("id, teacher_id, leave_type, from_date, to_date, session, total_days, paid_days, unpaid_days, status, reason")
        .gte("from_date", `${filterYear}-01-01`)
        .lte("from_date", `${filterYear}-12-31`)
        .order("from_date");
      if (error) throw error;

      const ids = [...new Set((leaves ?? []).map((l) => l.teacher_id))];
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name, department_id, departments(name)").in("id", ids)
        : { data: [] };

      // Also exclude admin/principal from people map
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id").in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      const people: PeopleMap = {};
      for (const p of profiles ?? []) {
        if (!excludedIds.has(p.id)) {
          people[p.id] = {
            full_name: p.full_name,
            department_name: (p.departments as { name: string } | null)?.name ?? null,
            department_id: p.department_id ?? null,
          };
        }
      }
      return { leaves: (leaves ?? []).filter((l) => !excludedIds.has(l.teacher_id)) as ReportLeave[], people };
    },
  });

  const allLeaves  = reportData?.leaves ?? [];
  const people     = reportData?.people ?? {};

  // Apply filters
  const filteredLeaves = useMemo(() => allLeaves.filter((l) => {
    if (filterDept !== "all" && people[l.teacher_id]?.department_id !== filterDept) return false;
    if (filterMonth !== "all" && !l.from_date.startsWith(`${filterYear}-${filterMonth}`)) return false;
    if (filterType !== "all" && l.leave_type !== filterType) return false;
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    return true;
  }), [allLeaves, people, filterDept, filterMonth, filterType, filterStatus, filterYear]);

  // Build rows for the active module using filtered data
  const rows = useMemo(() => {
    const mod = REPORT_MODULES.find((m) => m.key === activeModule);
    if (!mod) return [];
    return mod.build(filteredLeaves, people) as Record<string, unknown>[];
  }, [activeModule, filteredLeaves, people]);

  // Bar chart using filtered data
  const byType = LEAVE_TYPES.map((t) => ({
    ...t,
    count: filteredLeaves.filter((l) => l.leave_type === t.value && ["approved","hod_approved"].includes(l.status)).reduce((s, l) => s + Number(l.total_days), 0),
  }));
  const maxCount = Math.max(1, ...byType.map((t) => t.count));

  // ── CSV export ──
  function exportCSV() {
    if (rows.length === 0) return toast.error("No data to export");
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${activeModule}-report-${filterYear}${filterDept !== "all" ? `-${departments.find((d) => d.id === filterDept)?.name ?? "dept"}` : ""}${filterMonth !== "all" ? `-${MONTH_NAMES[Number(filterMonth)-1]}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} rows to CSV`);
  }

  // ── PDF export ──
  async function exportPDF() {
    if (rows.length === 0) return toast.error("No data to export");
    setExporting(true);
    try {
      const mod     = REPORT_MODULES.find((m) => m.key === activeModule)!;
      const headers = Object.keys(rows[0]);
      const deptLabel   = filterDept !== "all" ? departments.find((d) => d.id === filterDept)?.name ?? "" : "All Departments";
      const monthLabel  = filterMonth !== "all" ? MONTH_NAMES[Number(filterMonth)-1] : "All Months";
      const subtitle    = `${deptLabel} · ${monthLabel} · ${filterYear}`;

      const tableRows = rows.map((r) =>
        `<tr>${headers.map((h) => `<td>${r[h] ?? ""}</td>`).join("")}</tr>`
      ).join("");

      const html = `<html><head><title>${mod.label}</title>
        <style>
          body{font-family:sans-serif;margin:24px;color:#111}
          h1{font-size:18px;margin-bottom:2px}
          .sub{color:#666;font-size:12px;margin-bottom:16px}
          table{border-collapse:collapse;width:100%;font-size:11px}
          th{background:#3730a3;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
          td{border:1px solid #e5e7eb;padding:5px 8px}
          tr:nth-child(even){background:#f9fafb}
          .meta{font-size:11px;color:#888;margin-top:12px}
          @media print{button{display:none}}
        </style></head><body>
        <h1>${mod.label} — Chandrabhan Sharma College</h1>
        <p class="sub">${subtitle} · ${rows.length} records</p>
        <table>
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p class="meta">Generated on ${new Date().toLocaleDateString("en-IN", { day:"2-digit",month:"short",year:"numeric" })}</p>
        <br/><button onclick="window.print()">🖨 Print / Save as PDF</button>
        </body></html>`;

      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } finally {
      setExporting(false);
    }
  }

  const activeModInfo = REPORT_MODULES.find((m) => m.key === activeModule)!;

  return (
    <AppShell title="Reports" subtitle="College-wide leave analytics and exports">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">

        {/* ── Left: module picker ── */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Report type</p>
          <ul className="space-y-1">
            {REPORT_MODULES.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  onClick={() => setActiveModule(m.key)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    activeModule === m.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60 text-foreground"
                  }`}
                >
                  <span className="text-base">{m.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">{m.label}</span>
                    <span className="block text-xs text-muted-foreground truncate">{m.description}</span>
                  </span>
                  {activeModule === m.key && <ChevronRight className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>

          {/* Leave type breakdown */}
          <div className="rounded-xl border border-border p-4 mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Approved leave days</p>
            <ul className="space-y-2.5">
              {byType.map((t) => (
                <li key={t.value}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">{t.label}</span>
                    <span className="font-bold text-primary">{t.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Right: filters + preview + export ── */}
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {/* Year */}
              <div className="space-y-1 col-span-1">
                <label className="text-xs text-muted-foreground">Year</label>
                <Select value={filterYear} onValueChange={setFilterYear}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Month */}
              <div className="space-y-1 col-span-1">
                <label className="text-xs text-muted-foreground">Month</label>
                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All months</SelectItem>
                    {MONTH_NAMES.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Department */}
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <label className="text-xs text-muted-foreground">Department</label>
                <Select value={filterDept} onValueChange={setFilterDept}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Leave type */}
              <div className="space-y-1 col-span-1">
                <label className="text-xs text-muted-foreground">Leave type</label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {LEAVE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status */}
              <div className="space-y-1 col-span-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="hod_approved">HOD Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="pending_principal">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Active filter summary */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="secondary" className="text-xs">{filterYear}</Badge>
              {filterMonth !== "all" && <Badge variant="secondary" className="text-xs">{MONTH_NAMES[Number(filterMonth)-1]}</Badge>}
              {filterDept !== "all" && <Badge variant="secondary" className="text-xs">{departments.find((d) => d.id === filterDept)?.name}</Badge>}
              {filterType !== "all" && <Badge variant="secondary" className="text-xs">{LEAVE_TYPES.find((t) => t.value === filterType)?.label}</Badge>}
              {filterStatus !== "all" && <Badge variant="secondary" className="text-xs capitalize">{filterStatus.replace(/_/g," ")}</Badge>}
              <span className="text-xs text-muted-foreground self-center">→ {filteredLeaves.length} records · {rows.length} rows in export</span>
            </div>
          </div>

          {/* Data preview */}
          <SectionCard
            title={activeModInfo.label}
            subtitle={`${activeModInfo.description} · ${rows.length} row(s)`}
          >
            {isLoading ? (
              <p className="text-sm text-muted-foreground animate-pulse py-4 text-center">Loading…</p>
            ) : rows.length === 0 ? (
              <Empty>No data matches the current filters.</Empty>
            ) : (
              <>
                {/* Mobile card preview */}
                <ul className="sm:hidden space-y-2 mb-4">
                  {rows.slice(0, 5).map((r, i) => {
                    const keys = Object.keys(r);
                    return (
                      <li key={i} className="rounded-lg border border-border p-3 text-xs space-y-0.5">
                        {keys.slice(0, 4).map((k) => (
                          <p key={k}><span className="text-muted-foreground">{k}:</span> <span className="font-medium">{String(r[k] ?? "—")}</span></p>
                        ))}
                      </li>
                    );
                  })}
                  {rows.length > 5 && <p className="text-xs text-muted-foreground text-center">+{rows.length - 5} more rows in export</p>}
                </ul>

                {/* Desktop table preview */}
                <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        {Object.keys(rows[0]).map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((r, i) => (
                        <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          {Object.values(r).map((v, j) => (
                            <td key={j} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">{String(v ?? "—")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 20 && (
                    <p className="py-2 text-center text-xs text-muted-foreground">Preview shows 20 of {rows.length} rows · full data in export</p>
                  )}
                </div>
              </>
            )}

            {/* Export buttons */}
            <div className="flex flex-wrap gap-3 mt-4">
              <Button variant="outline" className="gap-2 flex-1 sm:flex-none" onClick={exportPDF} disabled={exporting || rows.length === 0}>
                <FileText className="size-4 text-red-600" />
                {exporting ? "Preparing…" : "Export PDF"}
              </Button>
              <Button className="gap-2 flex-1 sm:flex-none" onClick={exportCSV} disabled={rows.length === 0}>
                <BarChart2 className="size-4" />
                Export CSV
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
