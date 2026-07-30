import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate, leaveTypeLabel, LEAVE_TYPES, type LeaveType } from "@/lib/leave";
import { FileSpreadsheet, FileText } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Leave Reports — CSC Leave Management" },
      { name: "description", content: "Yearly leave usage and monthly schedule for HODs." },
      { property: "og:title", content: "Leave Reports — CSC Leave Management" },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <ReportsPage />
    </Guarded>
  ),
});

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WEEKDAYS = [1,2,3,4,5,6]; // Mon–Sat

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWorkingDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() !== 0) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getWeeksInMonth(workingDays: Date[]): Date[][] {
  if (workingDays.length === 0) return [];
  const weeks: Date[][] = [];
  let week: Date[] = [];
  let currentWeek = getISOWeek(workingDays[0]);
  for (const d of workingDays) {
    const w = getISOWeek(d);
    if (w !== currentWeek && week.length > 0) {
      weeks.push(week);
      week = [];
      currentWeek = w;
    }
    week.push(d);
  }
  if (week.length > 0) weeks.push(week);
  return weeks;
}

function getISOWeek(d: Date): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// ── Data fetcher ──────────────────────────────────────────────────────────────
async function fetchMonthlySchedule(deptId: string, year: number, month: number) {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("department_id", deptId)
    .eq("approved", true)
    .order("full_name");

  const teacherIds = (profiles ?? []).map((p) => p.id);
  const fallback = ["00000000-0000-0000-0000-000000000000"];
  const ids = teacherIds.length ? teacherIds : fallback;

  const { data: userRoles } = await supabase.from("user_roles").select("user_id, role").in("user_id", ids);
  const roleMap: Record<string, string> = {};
  for (const r of userRoles ?? []) roleMap[r.user_id] = r.role;

  const teachers = (profiles ?? []).map((p) => ({ ...p, role: roleMap[p.id] ?? "teacher" }));

  const { data: fixedLectures } = await supabase
    .from("lectures")
    .select("id, teacher_id, day_of_week, start_time, end_time, subject, class_name")
    .in("teacher_id", ids)
    .is("lecture_date", null);

  const { data: datedLectures } = await supabase
    .from("lectures")
    .select("id, teacher_id, day_of_week, start_time, end_time, subject, class_name, lecture_date")
    .in("teacher_id", ids)
    .gte("lecture_date", from)
    .lte("lecture_date", to);

  const { data: leaves } = await supabase
    .from("leave_requests")
    .select("id, teacher_id, from_date, to_date, leave_type, total_days")
    .in("teacher_id", ids)
    .in("status", ["approved", "hod_approved"])
    .lte("from_date", to)
    .gte("to_date", from);

  const leaveIds = (leaves ?? []).map((l) => l.id);
  const { data: proxies } = leaveIds.length
    ? await supabase
        .from("proxy_assignments")
        .select("id, leave_request_id, proxy_teacher_id, proxy_date, subject, class_name, start_time, end_time")
        .in("leave_request_id", leaveIds)
        .in("status", ["accepted", "pending"])
        .gte("proxy_date", from)
        .lte("proxy_date", to)
    : { data: [] };

  return { teachers, fixedLectures: fixedLectures ?? [], datedLectures: datedLectures ?? [], leaves: leaves ?? [], proxies: proxies ?? [] };
}

// ── Per-day cell: returns list of lecture names/subjects ──────────────────────
function getLecturesForDay(
  teacherId: string,
  dateStr: string,
  dow: number,
  fixedLectures: any[],
  datedLectures: any[],
  proxies: any[],
  leaves: any[],
): { subjects: string[]; isLeave: boolean; proxyCount: number } {
  const onLeave = leaves.some((l) => l.teacher_id === teacherId && l.from_date <= dateStr && l.to_date >= dateStr);
  const proxyDuties = proxies.filter((p) => p.proxy_teacher_id === teacherId && p.proxy_date === dateStr);

  if (onLeave) return { subjects: [], isLeave: true, proxyCount: proxyDuties.length };

  const fixedSubjects = fixedLectures
    .filter((l) => l.teacher_id === teacherId && l.day_of_week === dow)
    .map((l) => l.subject);
  const datedSubjects = datedLectures
    .filter((l) => l.teacher_id === teacherId && l.lecture_date === dateStr)
    .map((l) => l.subject);
  const proxySubjects = proxyDuties.map((p) => `P:${p.subject}`);

  return {
    subjects: [...fixedSubjects, ...datedSubjects, ...proxySubjects],
    isLeave: false,
    proxyCount: proxyDuties.length,
  };
}

// ── Count lectures in a date range ────────────────────────────────────────────
function countLecturesInDays(
  teacherId: string,
  days: Date[],
  fixedLectures: any[],
  datedLectures: any[],
  proxies: any[],
  leaves: any[],
): number {
  let count = 0;
  for (const day of days) {
    const dateStr = day.toISOString().slice(0, 10);
    const dow = day.getDay();
    const { subjects } = getLecturesForDay(teacherId, dateStr, dow, fixedLectures, datedLectures, proxies, leaves);
    count += subjects.length;
  }
  return count;
}

function countLeaveDaysInRange(teacherLeaves: any[], days: Date[]): number {
  let n = 0;
  for (const day of days) {
    const dateStr = day.toISOString().slice(0, 10);
    if (teacherLeaves.some((l) => l.from_date <= dateStr && l.to_date >= dateStr)) n++;
  }
  return n;
}

// ── Build table rows ──────────────────────────────────────────────────────────
function buildTableRows(teachers: any[], workingDays: Date[], fixedLectures: any[], datedLectures: any[], proxies: any[], leaves: any[]) {
  const weeks = getWeeksInMonth(workingDays);

  return teachers.map((t) => {
    const teacherLeaves = leaves.filter((l) => l.teacher_id === t.id);

    // Per-day: subjects list
    const dayData = workingDays.map((day) => {
      const dateStr = day.toISOString().slice(0, 10);
      const dow = day.getDay();
      return getLecturesForDay(t.id, dateStr, dow, fixedLectures, datedLectures, proxies, leaves);
    });

    // Weekly counts
    const weeklyLectureCounts = weeks.map((weekDays) =>
      countLecturesInDays(t.id, weekDays, fixedLectures, datedLectures, proxies, leaves)
    );

    const totalLectures = weeklyLectureCounts.reduce((a, b) => a + b, 0);
    const totalLeaveDays = countLeaveDaysInRange(teacherLeaves, workingDays);
    const totalProxyDuties = proxies.filter((p) => p.proxy_teacher_id === t.id).length;

    return { id: t.id, name: t.full_name, role: t.role, dayData, weeklyLectureCounts, totalLectures, totalLeaveDays, totalProxyDuties };
  });
}

// ── Excel helpers ─────────────────────────────────────────────────────────────
function fmtExcelTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportExcel(
  month: number,
  year: number,
  deptName: string,
  rows: ReturnType<typeof buildTableRows>,
  workingDays: Date[],
  fixedLectures: any[],
  datedLectures: any[],
  proxies: any[],
) {
  const weeks = getWeeksInMonth(workingDays);
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Monthly Schedule ─────────────────────────────────────────────
  const dayHeaders = workingDays.map((d) => `${d.getDate()} ${DAY_NAMES[d.getDay()]}`);
  const weekHeaders = weeks.map((_, i) => `Week ${i + 1}`);
  const headers = ["Teacher", "Role", ...dayHeaders, ...weekHeaders, "Total Lectures", "Leave Days", "Proxy Duties"];

  // For each day cell, include subject + timing for each lecture
  const body = rows.map((r) => [
    r.name,
    r.role === "hod" ? "HOD" : "Teacher",
    ...workingDays.map((day, idx) => {
      const d = r.dayData[idx];
      if (d.isLeave) return "LEAVE";
      if (d.subjects.length === 0) return "—";
      // Build "Subject (HH:MM–HH:MM)" entries for each lecture on this day
      const dateStr = day.toISOString().slice(0, 10);
      const dow = day.getDay();
      const entries: string[] = [];
      const fixed = fixedLectures.filter((l) => l.teacher_id === r.id && l.day_of_week === dow);
      const dated = datedLectures.filter((l) => l.teacher_id === r.id && l.lecture_date === dateStr);
      const proxyDuties = proxies.filter((p) => p.proxy_teacher_id === r.id && p.proxy_date === dateStr);
      for (const l of [...fixed, ...dated]) {
        entries.push(`${l.subject} (${fmtExcelTime(l.start_time)}–${fmtExcelTime(l.end_time)})`);
      }
      for (const p of proxyDuties) {
        entries.push(`P:${p.subject} (${fmtExcelTime(p.start_time)}–${fmtExcelTime(p.end_time)})`);
      }
      return entries.join("\n") || d.subjects.join(", ");
    }),
    ...r.weeklyLectureCounts,
    r.totalLectures,
    r.totalLeaveDays,
    r.totalProxyDuties,
  ]);

  const legend = ["Legend: Subject (Time) = lecture taken  |  LEAVE = on leave  |  P:Subject = proxy duty  |  — = no lectures"];

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...body, [], legend]);
  ws1["!cols"] = [
    { wch: 26 },
    { wch: 10 },
    ...workingDays.map(() => ({ wch: 20 })),
    ...weeks.map(() => ({ wch: 8 })),
    { wch: 15 },
    { wch: 12 },
    { wch: 13 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, `${MONTH_NAMES[month].slice(0, 10)} ${year}`);

  // ── Sheet 2: Weekly Timetable (fixed lectures with timings) ──────────────
  const timingHeaders = ["Teacher", "Role", "Day", "Start Time", "End Time", "Subject", "Class"];
  const timingBody: any[][] = [];
  for (const r of rows) {
    const teacherFixed = fixedLectures
      .filter((l) => l.teacher_id === r.id)
      .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
    for (const l of teacherFixed) {
      timingBody.push([
        r.name,
        r.role === "hod" ? "HOD" : "Teacher",
        DAY_NAMES[l.day_of_week] || "",
        fmtExcelTime(l.start_time),
        fmtExcelTime(l.end_time),
        l.subject,
        l.class_name,
      ]);
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet([timingHeaders, ...timingBody]);
  ws2["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Lecture Timings");

  // ── Sheet 3: Proxy Duties this month ─────────────────────────────────────
  if (proxies.length > 0) {
    const proxyHeaders = ["Proxy Teacher", "Date", "Day", "Start Time", "End Time", "Subject", "Class"];
    const proxyBody = proxies
      .slice()
      .sort((a, b) => a.proxy_date.localeCompare(b.proxy_date) || a.start_time.localeCompare(b.start_time))
      .map((p) => {
        const teacher = rows.find((r) => r.id === p.proxy_teacher_id);
        const d = new Date(p.proxy_date + "T00:00:00");
        return [
          teacher?.name ?? p.proxy_teacher_id,
          p.proxy_date,
          DAY_NAMES[d.getDay()],
          fmtExcelTime(p.start_time),
          fmtExcelTime(p.end_time),
          p.subject,
          p.class_name,
        ];
      });
    const ws3 = XLSX.utils.aoa_to_sheet([proxyHeaders, ...proxyBody]);
    ws3["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Proxy Duties");
  }

  XLSX.writeFile(wb, `${deptName}_Schedule_${MONTH_NAMES[month]}_${year}.xlsx`);
}

// ── PDF export ────────────────────────────────────────────────────────────────
function exportPDF(month: number, year: number, deptName: string, rows: ReturnType<typeof buildTableRows>, workingDays: Date[]) {
  const weeks = getWeeksInMonth(workingDays);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });

  doc.setFontSize(14);
  doc.text(`${deptName} — Monthly Schedule: ${MONTH_NAMES[month]} ${year}`, 14, 16);
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text("Legend: Subject = lecture taken  |  LEAVE = on leave  |  P:Sub = proxy duty  |  — = no lectures  |  Wk# = weekly lecture count", 14, 22);
  doc.setTextColor(0, 0, 0);

  const head = [["Teacher", "Role", ...workingDays.map((d) => `${d.getDate()}\n${DAY_NAMES[d.getDay()]}`), ...weeks.map((_, i) => `Wk${i + 1}`), "Total", "Leave", "Proxy"]];
  const body = rows.map((r) => [
    r.name,
    r.role === "hod" ? "HOD" : "Teacher",
    ...r.dayData.map((d) => (d.isLeave ? "L" : d.subjects.length > 0 ? d.subjects.join("\n") : "—")),
    ...r.weeklyLectureCounts,
    r.totalLectures,
    r.totalLeaveDays,
    r.totalProxyDuties,
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 26,
    styles: { fontSize: 5.5, cellPadding: 1, halign: "center", valign: "middle" },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 6, fontStyle: "bold" },
    columnStyles: { 0: { halign: "left", cellWidth: 26 }, 1: { cellWidth: 11 } },
    didParseCell: (data) => {
      const val = String(data.cell.raw ?? "");
      if (data.section === "body" && data.column.index >= 2) {
        if (val === "L") {
          data.cell.styles.fillColor = [254, 202, 202];
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
        } else if (val.includes("P:")) {
          data.cell.styles.fillColor = [254, 249, 195];
          data.cell.styles.textColor = [133, 77, 14];
        }
      }
    },
  });

  doc.save(`${deptName}_Schedule_${MONTH_NAMES[month]}_${year}.pdf`);
}

// ── Main page ─────────────────────────────────────────────────────────────────
function ReportsPage() {
  const { profile, role } = useAuth();
  const year = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);

  const isHod = role === "hod";
  const deptName = profile?.department_name ?? "Department";

  const { data } = useQuery({
    queryKey: ["reports", role, profile?.department_id, year],
    enabled: !!profile,
    queryFn: async () => {
      let q = supabase.from("leave_requests").select("*").in("status", ["approved", "hod_approved"]).gte("from_date", `${year}-01-01`).lte("from_date", `${year}-12-31`);
      if (isHod) q = q.eq("department_id", profile!.department_id ?? "");
      const { data: leaves, error } = await q;
      if (error) throw error;
      const people = await fetchPeople((leaves ?? []).map((l) => l.teacher_id));
      return { leaves: leaves ?? [], people };
    },
  });

  const { data: monthlyData, isLoading: monthLoading } = useQuery({
    queryKey: ["monthly-schedule", profile?.department_id, year, selectedMonth],
    enabled: !!profile && isHod && !!profile.department_id,
    queryFn: () => fetchMonthlySchedule(profile!.department_id!, year, selectedMonth),
  });

  const workingDays = getWorkingDaysInMonth(year, selectedMonth);
  const weeks = getWeeksInMonth(workingDays);
  const tableRows = monthlyData ? buildTableRows(monthlyData.teachers, workingDays, monthlyData.fixedLectures, monthlyData.datedLectures, monthlyData.proxies, monthlyData.leaves) : [];

  const handleDownloadExcel = useCallback(() => {
    setDownloading("excel");
    try { exportExcel(selectedMonth, year, deptName, tableRows, workingDays, monthlyData?.fixedLectures ?? [], monthlyData?.datedLectures ?? [], monthlyData?.proxies ?? []); }
    finally { setDownloading(null); }
  }, [selectedMonth, year, deptName, tableRows, workingDays, monthlyData]);

  const handleDownloadPDF = useCallback(() => {
    setDownloading("pdf");
    try { exportPDF(selectedMonth, year, deptName, tableRows, workingDays); }
    finally { setDownloading(null); }
  }, [selectedMonth, year, deptName, tableRows, workingDays]);

  const leaves = data?.leaves ?? [];
  const totalDays = leaves.reduce((s, l) => s + Number(l.total_days), 0);
  const unpaidDays = leaves.reduce((s, l) => s + Number(l.unpaid_days), 0);
  const byType = LEAVE_TYPES.map((t) => ({ ...t, days: leaves.filter((l) => l.leave_type === t.value).reduce((s, l) => s + Number(l.total_days), 0) }));
  const maxType = Math.max(1, ...byType.map((t) => t.days));

  return (
    <AppShell title="Leave Reports" subtitle={`Approved leaves in ${year}`}>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Approved requests" value={leaves.length} />
          <StatCard label="Total leave days" value={totalDays} tone="warning" />
          <StatCard label="Pay-cut days" value={unpaidDays} tone="destructive" />
        </div>

        <SectionCard title="Leave type breakdown">
          <ul className="space-y-3">
            {byType.map((t) => (
              <li key={t.value}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t.label}</span>
                  <span className="font-semibold">{t.days} day(s)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(t.days / maxType) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Detailed log">
          {leaves.length === 0 ? (
            <Empty>No approved leaves this year.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Teacher</th>
                    <th className="pb-2 font-semibold">Type</th>
                    <th className="pb-2 font-semibold">Dates</th>
                    <th className="pb-2 font-semibold">Days</th>
                    <th className="pb-2 font-semibold">Paid</th>
                    <th className="pb-2 font-semibold">Pay cut</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-3 font-medium">{data?.people[l.teacher_id]?.full_name ?? "—"}</td>
                      <td className="py-3">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                      <td className="py-3">{fmtDate(l.from_date)} – {fmtDate(l.to_date)}</td>
                      <td className="py-3">{Number(l.total_days)}</td>
                      <td className="py-3">{Number(l.paid_days)}</td>
                      <td className="py-3 font-semibold text-destructive">{Number(l.unpaid_days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* HOD monthly schedule */}
        {isHod && (
          <SectionCard title="Monthly Schedule" subtitle="Full department schedule with lecture names, weekly counts, leaves and proxy duties">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => <SelectItem key={i} value={String(i)}>{m} {year}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadExcel} disabled={!!downloading || monthLoading || tableRows.length === 0}>
                  <FileSpreadsheet className="size-4 text-green-600" />
                  {downloading === "excel" ? "Preparing…" : "Download Excel"}
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadPDF} disabled={!!downloading || monthLoading || tableRows.length === 0}>
                  <FileText className="size-4 text-red-600" />
                  {downloading === "pdf" ? "Preparing…" : "Download PDF"}
                </Button>
              </div>

              {monthLoading ? (
                <p className="text-sm text-muted-foreground">Loading schedule…</p>
              ) : tableRows.length === 0 ? (
                <Empty>No teachers found in this department.</Empty>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted text-left">
                        <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-semibold min-w-[150px]">Teacher</th>
                        {workingDays.map((d, i) => {
                          // Show week header before first day of each week
                          const isWeekStart = i === 0 || getISOWeek(d) !== getISOWeek(workingDays[i - 1]);
                          return (
                            <th key={d.toISOString()} className={`px-1 py-2 text-center font-semibold min-w-[52px] ${isWeekStart ? "border-l-2 border-primary/30" : ""}`}>
                              <div>{d.getDate()}</div>
                              <div className="text-[10px] font-normal text-muted-foreground">{DAY_NAMES[d.getDay()]}</div>
                            </th>
                          );
                        })}
                        {weeks.map((_, i) => (
                          <th key={`wk${i}`} className="px-2 py-2 text-center font-semibold min-w-[44px] border-l border-primary/20 bg-primary/5">
                            <div>Wk{i + 1}</div>
                            <div className="text-[10px] font-normal text-muted-foreground">count</div>
                          </th>
                        ))}
                        <th className="px-3 py-2 text-center font-semibold min-w-[56px] border-l border-border">Total</th>
                        <th className="px-3 py-2 text-center font-semibold min-w-[48px]">Leave</th>
                        <th className="px-3 py-2 text-center font-semibold min-w-[48px]">Proxy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r) => (
                        <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
                            {r.name}
                            {r.role === "hod" && <span className="ml-1 text-[10px] text-muted-foreground">(HOD)</span>}
                          </td>
                          {r.dayData.map((d, i) => {
                            const day = workingDays[i];
                            const isWeekStart = i === 0 || getISOWeek(day) !== getISOWeek(workingDays[i - 1]);
                            return (
                              <td
                                key={i}
                                title={d.isLeave ? "On Leave" : d.subjects.join(", ")}
                                className={`px-0.5 py-1 text-center text-[10px] ${isWeekStart ? "border-l-2 border-primary/20" : ""} ${
                                  d.isLeave
                                    ? "bg-red-100 dark:bg-red-950 font-bold text-red-700 dark:text-red-300"
                                    : d.subjects.some((s) => s.startsWith("P:"))
                                    ? "bg-yellow-100 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-300"
                                    : d.subjects.length > 0
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {d.isLeave ? "L" : d.subjects.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {d.subjects.map((s, j) => (
                                      <div key={j} className="leading-tight truncate max-w-[50px]" title={s}>
                                        {s.startsWith("P:") ? s.slice(2) : s}
                                      </div>
                                    ))}
                                  </div>
                                ) : "—"}
                              </td>
                            );
                          })}
                          {r.weeklyLectureCounts.map((wc, i) => (
                            <td key={`wc${i}`} className="px-2 py-2 text-center font-bold border-l border-primary/20 bg-primary/5">
                              {wc}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center font-bold border-l border-border">{r.totalLectures}</td>
                          <td className={`px-3 py-2 text-center ${r.totalLeaveDays > 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{r.totalLeaveDays || "—"}</td>
                          <td className={`px-3 py-2 text-center ${r.totalProxyDuties > 0 ? "text-yellow-700 font-semibold" : "text-muted-foreground"}`}>{r.totalProxyDuties || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    <span><span className="font-bold text-foreground">DSA</span> = lecture subject</span>
                    <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-700 dark:bg-red-950 dark:text-red-300">L</span><span>= on leave</span>
                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">P:Sub</span><span>= proxy duty</span>
                    <span><span className="font-bold text-foreground">Wk#</span> = weekly lecture count</span>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}
