import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LEAVE_TYPES, leaveTypeLabel, fmtDate, type LeaveType } from "@/lib/leave";
import {
  FileText, BarChart2, ChevronDown,
  User, Building2, ClipboardList, CalendarDays, Wallet, IndianRupee,
} from "lucide-react";

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
type PersonInfo = {
  full_name: string;
  department_name: string | null;
  department_id: string | null;
  monthly_salary: number;
};
type PeopleMap = Record<string, PersonInfo | undefined>;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Dynamic year list: current year + previous 10 ────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 11 }, (_, i) => CURRENT_YEAR - i);

// ── Salary helpers ────────────────────────────────────────────────────────────
const perDay = (monthly: number) => monthly / 30;
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));

// ── Report module definitions ─────────────────────────────────────────────────
const REPORT_MODULES: {
  key: string;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  build: (leaves: ReportLeave[], people: PeopleMap) => Record<string, unknown>[];
}[] = [
  {
    key: "teacher",
    label: "Teacher Report",
    description: "Leave records per teacher",
    Icon: User,
    build: (leaves, people) =>
      leaves.map((l) => ({
        Teacher:        people[l.teacher_id]?.full_name ?? "—",
        Department:     people[l.teacher_id]?.department_name ?? "—",
        "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
        From:           fmtDate(l.from_date),
        To:             fmtDate(l.to_date),
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
    Icon: Building2,
    build: (leaves, people) => {
      const map: Record<string, { total: number; unpaid: number; count: number }> = {};
      for (const l of leaves) {
        const dept = people[l.teacher_id]?.department_name ?? "Unknown";
        if (!map[dept]) map[dept] = { total: 0, unpaid: 0, count: 0 };
        map[dept].total  += Number(l.total_days);
        map[dept].unpaid += Number(l.unpaid_days);
        map[dept].count  += 1;
      }
      return Object.entries(map).map(([dept, v]) => ({
        Department:       dept,
        "Leave Requests": v.count,
        "Total Days":     v.total,
        "Pay Cut Days":   v.unpaid,
      }));
    },
  },
  {
    key: "history",
    label: "Leave History",
    description: "Full audit trail of all leave requests",
    Icon: ClipboardList,
    build: (leaves, people) =>
      leaves.map((l) => ({
        Teacher:        people[l.teacher_id]?.full_name ?? "—",
        Department:     people[l.teacher_id]?.department_name ?? "—",
        "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
        From:           fmtDate(l.from_date),
        To:             fmtDate(l.to_date),
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
    Icon: CalendarDays,
    build: (leaves, people) => {
      const map: Record<string, Record<string, number>> = {};
      for (const l of leaves) {
        const name  = people[l.teacher_id]?.full_name ?? "—";
        const month = l.from_date.slice(0, 7);
        if (!map[name]) map[name] = {};
        map[name][month] = (map[name][month] ?? 0) + Number(l.total_days);
      }
      return Object.entries(map).flatMap(([name, months]) =>
        Object.entries(months).map(([month, days]) => ({
          Teacher:          name,
          Month:            month,
          "Leave Days":     days,
          "Working Days":   26,
          "Attendance %":   (((26 - days) / 26) * 100).toFixed(1) + "%",
        }))
      );
    },
  },
  {
    key: "payroll",
    label: "Payroll Report",
    description: "Monthly salary and deductions per teacher",
    Icon: Wallet,
    build: (leaves, people) => {
      // Group approved leaves by teacher
      const approved = leaves.filter((l) => ["approved","hod_approved"].includes(l.status));
      const teacherIds = [...new Set(Object.keys(people))];

      return teacherIds
        .filter((id) => people[id])
        .map((id) => {
          const p          = people[id]!;
          const myLeaves   = approved.filter((l) => l.teacher_id === id);
          const totalDays  = myLeaves.reduce((s, l) => s + Number(l.total_days),  0);
          const paidDays   = myLeaves.reduce((s, l) => s + Number(l.paid_days),   0);
          const unpaidDays = myLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0);
          const monthlySal = p.monthly_salary;
          const deduction  = perDay(monthlySal) * unpaidDays;
          const payable    = monthlySal - deduction;

          return {
            Teacher:               p.full_name,
            Department:            p.department_name ?? "—",
            "Monthly Salary":      fmt(monthlySal),
            "Leave Days (total)":  totalDays,
            "Paid Leave Days":     paidDays,
            "Unpaid Leave Days":   unpaidDays,
            "Deduction Amount":    fmt(deduction),
            "Net Salary Payable":  fmt(payable),
          };
        })
        .filter((r) => true); // show all teachers, even those with 0 leaves
    },
  },
  {
    key: "salary",
    label: "Salary Statement",
    description: "Detailed month-by-month salary calculation",
    Icon: IndianRupee,
    build: (leaves, people) => {
      // Group approved leaves by teacher × month
      const approved = leaves.filter((l) => ["approved","hod_approved"].includes(l.status));

      const rows: Record<string, unknown>[] = [];

      for (const [id, p] of Object.entries(people)) {
        if (!p) continue;
        const monthlySal = p.monthly_salary;

        // Collect months this teacher had leave in
        const monthMap: Record<string, { total: number; unpaid: number }> = {};
        for (const l of approved.filter((l) => l.teacher_id === id)) {
          const month = l.from_date.slice(0, 7);
          if (!monthMap[month]) monthMap[month] = { total: 0, unpaid: 0 };
          monthMap[month].total  += Number(l.total_days);
          monthMap[month].unpaid += Number(l.unpaid_days);
        }

        if (Object.keys(monthMap).length === 0) {
          // Teacher had no leave — show one row with full salary
          rows.push({
            Teacher:              p.full_name,
            Department:           p.department_name ?? "—",
            Month:                "—",
            "Monthly Salary":     fmt(monthlySal),
            "Leave Days":         0,
            "Unpaid Leave Days":  0,
            "Deduction":          fmt(0),
            "Net Payable":        fmt(monthlySal),
          });
        } else {
          for (const [month, v] of Object.entries(monthMap)) {
            const deduction = perDay(monthlySal) * v.unpaid;
            rows.push({
              Teacher:              p.full_name,
              Department:           p.department_name ?? "—",
              Month:                month,
              "Monthly Salary":     fmt(monthlySal),
              "Leave Days":         v.total,
              "Unpaid Leave Days":  v.unpaid,
              "Deduction":          fmt(deduction),
              "Net Payable":        fmt(monthlySal - deduction),
            });
          }
        }
      }

      return rows.sort((a, b) =>
        String(a.Teacher).localeCompare(String(b.Teacher)) ||
        String(a.Month).localeCompare(String(b.Month))
      );
    },
  },
];

function AdminReportsPage() {
  const { role } = useAuth();
  const isPrincipal = role === "principal";

  const [activeModule, setActiveModule] = useState("teacher");
  const [filterYear,   setFilterYear]   = useState(String(CURRENT_YEAR));
  const [filterDept,   setFilterDept]   = useState("all");
  const [filterMonth,  setFilterMonth]  = useState("all");
  const [filterType,   setFilterType]   = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [exporting,    setExporting]    = useState(false);
  const [moduleOpen,   setModuleOpen]   = useState(false);

  // Principal: which department group tab is active
  const [principalDeptTab, setPrincipalDeptTab] = useState<"commerce_arts" | "science_tech">("commerce_arts");

  const COMMERCE_ARTS_KEYWORDS = ["commerce", "arts", "economics", "history", "english", "sociology", "philosophy", "political", "geography", "hindi", "marathi"];
  const SCIENCE_TECH_KEYWORDS  = ["science", "technology", "physics", "chemistry", "biology", "maths", "mathematics", "computer", "it", "information", "botany", "zoology", "microbiology"];

  function getDeptGroup(deptName: string): "commerce_arts" | "science_tech" | "other" {
    const n = (deptName ?? "").toLowerCase();
    if (SCIENCE_TECH_KEYWORDS.some((k) => n.includes(k))) return "science_tech";
    if (COMMERCE_ARTS_KEYWORDS.some((k) => n.includes(k))) return "commerce_arts";
    return "other";
  }

  // Departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments-list"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Raw leave + salary data
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

      // Fetch ALL teaching staff (not just those with leaves) for payroll/salary reports
      const { data: excludedRoles } = await supabase
        .from("user_roles").select("user_id").in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      const { data: allProfiles } = await supabase
        .from("profiles")
        .select("id, full_name, department_id, monthly_salary, departments(name)")
        .eq("approved", true);

      const people: PeopleMap = {};
      for (const p of allProfiles ?? []) {
        if (!excludedIds.has(p.id)) {
          people[p.id] = {
            full_name:       p.full_name,
            department_name: (p.departments as { name: string } | null)?.name ?? null,
            department_id:   p.department_id ?? null,
            monthly_salary:  Number(p.monthly_salary ?? 0),
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

  // Apply filters
  const filteredLeaves = useMemo(() => allLeaves.filter((l) => {
    if (filterDept   !== "all" && people[l.teacher_id]?.department_id !== filterDept) return false;
    if (filterMonth  !== "all" && !l.from_date.startsWith(`${filterYear}-${filterMonth}`)) return false;
    if (filterType   !== "all" && l.leave_type !== filterType) return false;
    if (filterStatus !== "all" && l.status     !== filterStatus) return false;
    return true;
  }), [allLeaves, people, filterDept, filterMonth, filterType, filterStatus, filterYear]);

  // For principal: further filter by dept group tab
  const principalFilteredLeaves = useMemo(() => {
    if (!isPrincipal) return filteredLeaves;
    return filteredLeaves.filter((l) => {
      const deptName = people[l.teacher_id]?.department_name ?? "";
      const grp = getDeptGroup(deptName);
      return grp === principalDeptTab || grp === "other";
    });
  }, [filteredLeaves, isPrincipal, principalDeptTab, people]);

  const effectiveLeaves = isPrincipal ? principalFilteredLeaves : filteredLeaves;

  // Filter people by department too (for payroll/salary modules)
  const filteredPeople = useMemo(() => {
    if (filterDept === "all") return people;
    const out: PeopleMap = {};
    for (const [id, p] of Object.entries(people)) {
      if (p?.department_id === filterDept) out[id] = p;
    }
    return out;
  }, [people, filterDept]);

  // Build export rows
  const rows = useMemo(() => {
    const mod = REPORT_MODULES.find((m) => m.key === activeModule);
    if (!mod) return [];
    const peopleForMod = (activeModule === "payroll" || activeModule === "salary")
      ? filteredPeople
      : people;
    return mod.build(effectiveLeaves, peopleForMod);
  }, [activeModule, effectiveLeaves, people, filteredPeople]);

  // Leave type breakdown bar chart
  const byType = LEAVE_TYPES.map((t) => ({
    ...t,
    count: filteredLeaves
      .filter((l) => l.leave_type === t.value && ["approved","hod_approved"].includes(l.status))
      .reduce((s, l) => s + Number(l.total_days), 0),
  }));
  const maxCount = Math.max(1, ...byType.map((t) => t.count));

  const activeModInfo = REPORT_MODULES.find((m) => m.key === activeModule)!;
  const deptLabel  = filterDept  !== "all" ? (departments.find((d) => d.id === filterDept)?.name ?? "") : "All Depts";
  const monthLabel = filterMonth !== "all" ? MONTH_NAMES[Number(filterMonth) - 1] : "All Months";

  // ── Excel export ─────────────────────────────────────────────────────────────
  function exportExcel() {
    if (rows.length === 0) return toast.error("No data to export");
    const mod      = activeModInfo;
    const subtitle = `${deptLabel} · ${monthLabel} · ${filterYear}`;
    const headers  = Object.keys(rows[0]);
    const body     = rows.map((r) => headers.map((h) => r[h] ?? ""));
    const wb = XLSX.utils.book_new();
    // Meta sheet
    const metaWs = XLSX.utils.aoa_to_sheet([
      [`${mod.label} — CSC Leave Management`],
      [subtitle],
      [`Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`],
      [`Total records: ${rows.length}`],
    ]);
    metaWs["!cols"] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, metaWs, "Info");
    // Data sheet
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    // Auto column width: max of header length and data length
    ws["!cols"] = headers.map((h, i) => ({
      wch: Math.min(
        55,
        Math.max(h.length + 2, ...rows.map((r) => String(r[h] ?? "").length)),
      ),
    }));
    // Freeze header row
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, mod.label.slice(0, 31));
    const filename = `${mod.label.replace(/[^a-zA-Z0-9 _-]/g, "_")}_${filterYear}${filterDept !== "all" ? `_${deptLabel}` : ""}${filterMonth !== "all" ? `_${monthLabel}` : ""}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.success(`Excel exported — ${rows.length} rows`);
  }

  // ── PDF export ── uses jsPDF autoTable for professional output ───────────────
  function exportPDF() {
    if (rows.length === 0) return toast.error("No data to export");
    setExporting(true);
    try {
      const mod      = activeModInfo;
      const subtitle = `${deptLabel}  ·  ${monthLabel}  ·  ${filterYear}`;
      const headers  = Object.keys(rows[0]);
      const body     = rows.map((r) => headers.map((h) => String(r[h] ?? "—")));
      const isWide   = headers.length > 6;
      const doc      = new jsPDF({ orientation: isWide ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pageW    = doc.internal.pageSize.getWidth();

      // Header bar
      doc.setFillColor(55, 48, 163);
      doc.rect(0, 0, pageW, 26, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(255, 255, 255);
      doc.text(`${mod.label}`, 14, 10);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      doc.text(`CSC Leave Management  ·  ${subtitle}`, 14, 17);
      doc.setFontSize(7.5);
      doc.text(`${rows.length} record(s)  ·  Generated ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`, 14, 23);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        head: [headers],
        body,
        startY: 30,
        margin: { left: 12, right: 12 },
        styles: {
          fontSize: 8,
          cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 },
          valign: "middle",
          lineColor: [210, 215, 225],
          lineWidth: 0.2,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [55, 48, 163],
          textColor: [255, 255, 255],
          fontSize: 8.5,
          fontStyle: "bold",
          halign: "left",
          minCellHeight: 10,
        },
        alternateRowStyles: { fillColor: [248, 249, 255] },
        didParseCell: (data) => {
          // Highlight pay-cut / unpaid cells in red
          if (data.section === "body") {
            const h = headers[data.column.index] ?? "";
            const v = String(data.cell.raw ?? "");
            if ((h.toLowerCase().includes("unpaid") || h.toLowerCase().includes("pay-cut")) && v !== "0" && v !== "—") {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = "bold";
            }
          }
        },
        didDrawPage: (data) => {
          const pg    = (doc as any).internal.getCurrentPageInfo().pageNumber;
          const total = (doc as any).internal.getNumberOfPages();
          doc.setFontSize(7); doc.setTextColor(150, 150, 150);
          doc.text(
            `${mod.label}  ·  ${subtitle}  ·  Page ${pg} of ${total}`,
            12,
            doc.internal.pageSize.getHeight() - 6,
          );
          doc.setTextColor(0, 0, 0);
        },
      });

      const filename = `${mod.label.replace(/[^a-zA-Z0-9 _-]/g, "_")}_${filterYear}${filterDept !== "all" ? `_${deptLabel}` : ""}${filterMonth !== "all" ? `_${monthLabel}` : ""}.pdf`;
      doc.save(filename);
      toast.success(`PDF exported — ${rows.length} rows`);
    } finally { setExporting(false); }
  }

  return (
    <AppShell title="Reports" subtitle="College-wide leave analytics and exports">
      <div className="space-y-4">

        {/* ── Principal: Department group tabs (above everything) ─────────── */}
        {isPrincipal && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex">
              {([
                { id: "commerce_arts" as const,  label: "Commerce & Arts",     emoji: "📚" },
                { id: "science_tech"  as const,  label: "Science & Technology", emoji: "🔬" },
              ]).map(({ id, label, emoji }) => (
                <button
                  key={id}
                  onClick={() => setPrincipalDeptTab(id)}
                  className={`flex-1 flex items-center justify-center gap-2.5 px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${
                    principalDeptTab === id
                      ? "border-primary bg-primary/8 text-primary"
                      : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <span className="text-base leading-none">{emoji}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="px-4 py-2 bg-muted/20 text-xs text-muted-foreground">
              Showing reports for <strong className="text-foreground">
                {principalDeptTab === "commerce_arts" ? "Commerce & Arts" : "Science & Technology"}
              </strong> departments
            </div>
          </div>
        )}

        {/* ── Mobile: horizontal tab strip ───────────────────────────────── */}
        <div className="lg:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {REPORT_MODULES.map((m) => {
              const Icon = m.Icon;
              return (
                <button
                  key={m.key}
                  onClick={() => setActiveModule(m.key)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    activeModule === m.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">

          {/* ── Desktop left sidebar ────────────────────────────────────────── */}
          <div className="hidden lg:block space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Report type</p>
            <ul className="space-y-1">
              {REPORT_MODULES.map((m) => {
                const Icon = m.Icon;
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => setActiveModule(m.key)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        activeModule === m.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate">{m.label}</span>
                        <span className="block text-xs text-muted-foreground truncate">{m.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Leave breakdown chart */}
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Approved leave days</p>
              <ul className="space-y-2.5">
                {byType.map((t) => (
                  <li key={t.value}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted-foreground truncate mr-2">{t.label}</span>
                      <span className="font-bold text-primary shrink-0">{t.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Right panel ─────────────────────────────────────────────────── */}
          <div className="space-y-4 min-w-0">

            {/* Filter bar */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</p>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">

                {/* Year — dynamic: current year selected, previous 10 available */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Year</label>
                  <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}{y === CURRENT_YEAR ? " (current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Month */}
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

                {/* Department */}
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

                {/* Leave type */}
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

                {/* Status */}
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

              {/* Active filter badges */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Badge variant="secondary" className="text-xs">{filterYear}</Badge>
                {filterMonth  !== "all" && <Badge variant="secondary" className="text-xs">{monthLabel}</Badge>}
                {filterDept   !== "all" && <Badge variant="secondary" className="text-xs truncate max-w-[140px]">{deptLabel}</Badge>}
                {filterType   !== "all" && <Badge variant="secondary" className="text-xs">{LEAVE_TYPES.find((t) => t.value === filterType)?.label}</Badge>}
                {filterStatus !== "all" && <Badge variant="secondary" className="text-xs capitalize">{filterStatus.replace(/_/g, " ")}</Badge>}
                <span className="text-xs text-muted-foreground">
                  → <strong>{filteredLeaves.length}</strong> leave records · <strong>{rows.length}</strong> export rows
                </span>
              </div>
            </div>

            {/* Mobile: collapsible leave breakdown */}
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
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Data preview */}
            <SectionCard
              title={activeModInfo.label}
              subtitle={`${activeModInfo.description} · ${rows.length} row(s)`}
            >
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : rows.length === 0 ? (
                <Empty>No data matches the current filters.</Empty>
              ) : (
                <>
                  {/* Mobile: stacked cards */}
                  <div className="sm:hidden space-y-2 mb-4">
                    {rows.slice(0, 8).map((r, i) => {
                      const keys      = Object.keys(r);
                      const primary   = keys.slice(0, 2);
                      const secondary = keys.slice(2, 6);
                      return (
                        <div key={i} className={`rounded-lg border border-border p-3 space-y-1.5 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            {primary.map((k) => <span key={k} className="text-sm font-semibold">{String(r[k] ?? "—")}</span>)}
                          </div>
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
                        Preview: 25 of {rows.length} rows — all rows in download
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Export buttons */}
              <div className="flex flex-col sm:flex-row gap-3 mt-4 pt-4 border-t border-border">
                <Button variant="outline" className="gap-2 flex-1" onClick={exportPDF} disabled={exporting || rows.length === 0}>
                  <FileText className="size-4 text-red-600 shrink-0" />
                  {exporting ? "Preparing…" : "Download PDF"}
                </Button>
                <Button variant="outline" className="gap-2 flex-1" onClick={exportExcel} disabled={rows.length === 0}>
                  <BarChart2 className="size-4 text-emerald-600 shrink-0" />
                  Download Excel
                </Button>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
