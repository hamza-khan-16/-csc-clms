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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LEAVE_TYPES, leaveTypeLabel, fmtDate, type LeaveType } from "@/lib/leave";
import { FileText, BarChart2, ChevronDown } from "lucide-react";

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

// ── Report modules ─────────────────────────────────────────────────────────────
const REPORT_MODULES = [
  {
    key: "teacher", label: "Teacher Report", description: "Leave records per teacher", icon: "👨‍🏫",
    build: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher: people[l.teacher_id]?.full_name ?? "—",
        Department: people[l.teacher_id]?.department_name ?? "—",
        "Leave Type": leaveTypeLabel(l.leave_type as LeaveType),
        From: fmtDate(l.from_date), To: fmtDate(l.to_date),
        Session: l.session, "Total Days": l.total_days,
        "Paid Days": l.paid_days, "Pay Cut Days": l.unpaid_days,
        Status: l.status, Reason: l.reason ?? "",
      })),
  },
  {
    key: "department", label: "Department Report", description: "Department-level summary", icon: "🏢",
    build: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, { total: number; unpaid: number; count: number }> = {};
      for (const l of leaves) {
        const dept = people[l.teacher_id]?.department_name ?? "Unknown";
        if (!map[dept]) map[dept] = { total: 0, unpaid: 0, count: 0 };
        map[dept].total += Number(l.total_days);
        map[dept].unpaid += Number(l.unpaid_days);
        map[dept].count += 1;
      }
      return Object.entries(map).map(([dept, v]) => ({
        Department: dept, "Leave Requests": v.count, "Total Days": v.total, "Pay Cut Days": v.unpaid,
      }));
    },
  },
  {
    key: "history", label: "Leave History", description: "Full audit trail", icon: "📋",
    build: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher: people[l.teacher_id]?.full_name ?? "—",
        Department: people[l.teacher_id]?.department_name ?? "—",
        "Leave Type": leaveTypeLabel(l.leave_type as LeaveType),
        From: fmtDate(l.from_date), To: fmtDate(l.to_date),
        Session: l.session, "Total Days": l.total_days,
        "Paid Days": l.paid_days, "Pay Cut Days": l.unpaid_days,
        Status: l.status, Reason: l.reason ?? "",
      })),
  },
  {
    key: "attendance", label: "Attendance Report", description: "Monthly leave per teacher", icon: "📅",
    build: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, Record<string, number>> = {};
      for (const l of leaves) {
        const name = people[l.teacher_id]?.full_name ?? "—";
        const month = l.from_date.slice(0, 7);
        if (!map[name]) map[name] = {};
        map[name][month] = (map[name][month] ?? 0) + Number(l.total_days);
      }
      return Object.entries(map).flatMap(([name, months]) =>
        Object.entries(months).map(([month, days]) => ({
          Teacher: name, Month: month, "Leave Days": days,
          "Working Days": 26,
          "Attendance %": (((26 - days) / 26) * 100).toFixed(1) + "%",
        }))
      );
    },
  },
  {
    key: "payroll", label: "Payroll Report", description: "Salary deduction records", icon: "💰",
    build: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves
        .filter((l) => Number(l.unpaid_days) > 0)
        .map((l) => ({
          Teacher: people[l.teacher_id]?.full_name ?? "—",
          Department: people[l.teacher_id]?.department_name ?? "—",
          "Leave Type": leaveTypeLabel(l.leave_type as LeaveType),
          From: fmtDate(l.from_date), To: fmtDate(l.to_date),
          "Pay Cut Days": l.unpaid_days, Status: l.status,
        })),
  },
] as const;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function AdminReportsPage() {
  const currentYear = new Date().getFullYear();
  const [activeModule, setActiveModule] = useState("teacher");
  const [filterYear,   setFilterYear]   = useState(String(currentYear));
  const [filterDept,   setFilterDept]   = useState("all");
  const [filterMonth,  setFilterMonth]  = useState("all");
  const [filterType,   setFilterType]   = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [exporting,    setExporting]    = useState(false);
  // Mobile: collapse the module picker
  const [moduleOpen, setModuleOpen] = useState(false);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-list"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").order("name");
      return data ?? [];
    },
  });

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
      return {
        leaves: (leaves ?? []).filter((l) => !excludedIds.has(l.teacher_id)) as ReportLeave[],
        people,
      };
    },
  });

  const allLeaves = reportData?.leaves ?? [];
  const people    = reportData?.people ?? {};

  const filteredLeaves = useMemo(() => allLeaves.filter((l) => {
    if (filterDept !== "all" && people[l.teacher_id]?.department_id !== filterDept) return false;
    if (filterMonth !== "all" && !l.from_date.startsWith(`${filterYear}-${filterMonth}`)) return false;
    if (filterType !== "all" && l.leave_type !== filterType) return false;
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    return true;
  }), [allLeaves, people, filterDept, filterMonth, filterType, filterStatus, filterYear]);

  const rows = useMemo(() => {
    const mod = REPORT_MODULES.find((m) => m.key === activeModule);
    if (!mod) return [];
    return mod.build(filteredLeaves, people) as Record<string, unknown>[];
  }, [activeModule, filteredLeaves, people]);

  const byType = LEAVE_TYPES.map((t) => ({
    ...t,
    count: filteredLeaves
      .filter((l) => l.leave_type === t.value && ["approved","hod_approved"].includes(l.status))
      .reduce((s, l) => s + Number(l.total_days), 0),
  }));
  const maxCount = Math.max(1, ...byType.map((t) => t.count));

  const activeModInfo = REPORT_MODULES.find((m) => m.key === activeModule)!;
  const deptLabel  = filterDept !== "all" ? (departments.find((d) => d.id === filterDept)?.name ?? "") : "All Depts";
  const monthLabel = filterMonth !== "all" ? MONTH_NAMES[Number(filterMonth) - 1] : "All Months";

  function exportCSV() {
    if (rows.length === 0) return toast.error("No data to export");
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g,'""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${activeModule}-${filterYear}${filterDept !== "all" ? `-${deptLabel}` : ""}${filterMonth !== "all" ? `-${monthLabel}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} rows`);
  }

  async function exportPDF() {
    if (rows.length === 0) return toast.error("No data to export");
    setExporting(true);
    try {
      const mod     = REPORT_MODULES.find((m) => m.key === activeModule)!;
      const headers = Object.keys(rows[0]);
      const subtitle = `${deptLabel} · ${monthLabel} · ${filterYear}`;
      const tableRows = rows.map((r) =>
        `<tr>${headers.map((h) => `<td>${r[h] ?? ""}</td>`).join("")}</tr>`
      ).join("");
      const html = `<html><head><title>${mod.label}</title>
        <style>
          body{font-family:sans-serif;margin:20px;color:#111;font-size:12px}
          h1{font-size:16px;margin:0 0 2px}
          .sub{color:#666;font-size:11px;margin:0 0 14px}
          table{border-collapse:collapse;width:100%}
          th{background:#3730a3;color:#fff;padding:5px 8px;text-align:left;font-size:11px;white-space:nowrap}
          td{border:1px solid #e5e7eb;padding:4px 8px;font-size:11px}
          tr:nth-child(even) td{background:#f9fafb}
          .foot{font-size:10px;color:#999;margin-top:10px}
          @media print{.no-print{display:none}}
        </style></head><body>
        <h1>${mod.label} — Chandrabhan Sharma College</h1>
        <p class="sub">${subtitle} · ${rows.length} records</p>
        <table>
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p class="foot">Generated ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</p>
        <br class="no-print"/><button class="no-print" onclick="window.print()" style="margin-top:10px;padding:6px 16px;background:#3730a3;color:#fff;border:none;border-radius:4px;cursor:pointer">🖨 Print / Save as PDF</button>
        </body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } finally { setExporting(false); }
  }

  return (
    <AppShell title="Reports" subtitle="College-wide leave analytics and exports">
      <div className="space-y-4">

        {/* ── Module picker — horizontal scrollable tabs on mobile, sidebar on lg ── */}
        <div className="lg:hidden">
          {/* Mobile: horizontal scrolling tab strip */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {REPORT_MODULES.map((m) => (
              <button
                key={m.key}
                onClick={() => setActiveModule(m.key)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeModule === m.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">

          {/* ── Left sidebar — desktop only ── */}
          <div className="hidden lg:block space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Report type</p>
            <ul className="space-y-1">
              {REPORT_MODULES.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => setActiveModule(m.key)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      activeModule === m.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"
                    }`}
                  >
                    <span className="text-base">{m.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{m.label}</span>
                      <span className="block text-xs text-muted-foreground truncate">{m.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Leave breakdown — desktop sidebar */}
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Approved leave days
              </p>
              <ul className="space-y-2.5">
                {byType.map((t) => (
                  <li key={t.value}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted-foreground truncate mr-2">{t.label}</span>
                      <span className="font-bold text-primary shrink-0">{t.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(t.count / maxCount) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Right: filters + data ── */}
          <div className="space-y-4 min-w-0">

            {/* Filter bar */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</p>

              {/* Filter grid — 2 cols on mobile, 3 on sm, 5 on lg */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Year</label>
                  <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Month</label>
                  <Select value={filterMonth} onValueChange={setFilterMonth}>
                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All months</SelectItem>
                      {MONTH_NAMES.map((m, i) => (
                        <SelectItem key={i} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <label className="text-xs text-muted-foreground">Department</label>
                  <Select value={filterDept} onValueChange={setFilterDept}>
                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Leave type</label>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {LEAVE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Status</label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
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

              {/* Active filter badges + record count */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Badge variant="secondary" className="text-xs">{filterYear}</Badge>
                {filterMonth !== "all" && <Badge variant="secondary" className="text-xs">{monthLabel}</Badge>}
                {filterDept !== "all" && <Badge variant="secondary" className="text-xs truncate max-w-[140px]">{deptLabel}</Badge>}
                {filterType !== "all" && <Badge variant="secondary" className="text-xs">{LEAVE_TYPES.find((t) => t.value === filterType)?.label}</Badge>}
                {filterStatus !== "all" && <Badge variant="secondary" className="text-xs capitalize">{filterStatus.replace(/_/g, " ")}</Badge>}
                <span className="text-xs text-muted-foreground">
                  → <strong>{filteredLeaves.length}</strong> records · <strong>{rows.length}</strong> rows
                </span>
              </div>
            </div>

            {/* Leave breakdown — mobile only, collapsible */}
            <div className="lg:hidden rounded-xl border border-border overflow-hidden">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
                onClick={() => setModuleOpen((v) => !v)}
              >
                <span>Approved leave days breakdown</span>
                <ChevronDown className={`size-4 text-muted-foreground transition-transform ${moduleOpen ? "rotate-180" : ""}`} />
              </button>
              {moduleOpen && (
                <ul className="px-4 pb-4 space-y-2.5 border-t border-border pt-3">
                  {byType.map((t) => (
                    <li key={t.value}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-muted-foreground">{t.label}</span>
                        <span className="font-bold text-primary">{t.count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Data preview */}
            <SectionCard
              title={`${activeModInfo.icon} ${activeModInfo.label}`}
              subtitle={`${activeModInfo.description} · ${rows.length} row(s)`}
            >
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : rows.length === 0 ? (
                <Empty>No data matches the current filters.</Empty>
              ) : (
                <>
                  {/* Mobile: stacked record cards */}
                  <div className="sm:hidden space-y-2 mb-4">
                    {rows.slice(0, 8).map((r, i) => {
                      const keys = Object.keys(r);
                      const primary   = keys.slice(0, 2);
                      const secondary = keys.slice(2, 6);
                      return (
                        <div key={i} className={`rounded-lg border border-border p-3 space-y-1.5 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          {/* Primary fields — prominent */}
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            {primary.map((k) => (
                              <span key={k} className="text-sm font-semibold">{String(r[k] ?? "—")}</span>
                            ))}
                          </div>
                          {/* Secondary fields — compact grid */}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                            {secondary.map((k) => (
                              <p key={k} className="text-xs">
                                <span className="text-muted-foreground">{k}: </span>
                                <span className="font-medium">{String(r[k] ?? "—")}</span>
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {rows.length > 8 && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        Showing 8 of {rows.length} rows — full data in the download
                      </p>
                    )}
                  </div>

                  {/* Desktop: scrollable table */}
                  <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/60">
                          {Object.keys(rows[0]).map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 25).map((r, i) => (
                          <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                            {Object.values(r).map((v, j) => (
                              <td key={j} className="px-3 py-2 whitespace-nowrap max-w-[180px] truncate">{String(v ?? "—")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 25 && (
                      <p className="py-2 text-center text-xs text-muted-foreground border-t border-border">
                        Preview: 25 of {rows.length} rows — all rows included in download
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Export buttons */}
              <div className="flex flex-col sm:flex-row gap-3 mt-4 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  className="gap-2 flex-1"
                  onClick={exportPDF}
                  disabled={exporting || rows.length === 0}
                >
                  <FileText className="size-4 text-red-600 shrink-0" />
                  {exporting ? "Preparing…" : "Download PDF"}
                </Button>
                <Button
                  className="gap-2 flex-1"
                  onClick={exportCSV}
                  disabled={rows.length === 0}
                >
                  <BarChart2 className="size-4 shrink-0" />
                  Download CSV
                </Button>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
