import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { savePDF, saveXLSX } from "../lib/download";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate, leaveTypeLabel, LEAVE_TYPES, type LeaveType } from "@/lib/leave";
import {
  FileSpreadsheet,
  FileText,
  ChevronDown,
  ChevronUp,
  Calendar,
  BookOpen,
  UserCheck,
  TrendingDown,
  Clock,
  ArrowLeftRight,
  Gift,
} from "lucide-react";

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

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_FULL    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// ── Date helpers ──────────────────────────────────────────────────────────────
function dateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getWorkingDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() !== 0) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getWorkingDaysInRange(from: string, to: string): Date[] {
  const days: Date[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    if (cur.getDay() !== 0) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function getISOWeek(d: Date): number {
  const date = new Date(d);
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() + 3 - ((date.getDay()+6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime()-week1.getTime())/86400000 - 3 + ((week1.getDay()+6)%7))/7);
}

function getWeeksInMonth(workingDays: Date[]): Date[][] {
  if (!workingDays.length) return [];
  const weeks: Date[][] = [];
  let week: Date[] = [];
  let curWeek = getISOWeek(workingDays[0]);
  for (const d of workingDays) {
    const w = getISOWeek(d);
    if (w !== curWeek && week.length) { weeks.push(week); week = []; curWeek = w; }
    week.push(d);
  }
  if (week.length) weeks.push(week);
  return weeks;
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`;
}

// ── Period filter ─────────────────────────────────────────────────────────────
type PeriodFilter = "day" | "week" | "month";

function getDateRangeForPeriod(period: PeriodFilter, month: number, year: number): { from: string; to: string; label: string } {
  const pad = (n: number) => String(n).padStart(2,"0");
  if (period === "month") {
    const lastDay = new Date(year, month+1, 0).getDate();
    return { from: `${year}-${pad(month+1)}-01`, to: `${year}-${pad(month+1)}-${pad(lastDay)}`, label: `${MONTH_NAMES[month]} ${year}` };
  }
  if (period === "week") {
    const now = new Date();
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - dow + 1);
    const sat = new Date(mon); sat.setDate(mon.getDate() + 5);
    return { from: dateISO(mon), to: dateISO(sat), label: `Week of ${mon.getDate()} ${MONTH_NAMES[mon.getMonth()]}` };
  }
  const now = new Date();
  const today = dateISO(now);
  return { from: today, to: today, label: `Today, ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}` };
}

// ── Data fetch ────────────────────────────────────────────────────────────────
async function fetchMonthlySchedule(deptId: string, year: number, month: number) {
  const from = `${year}-${String(month+1).padStart(2,"0")}-01`;
  const lastDay = new Date(year, month+1, 0).getDate();
  const to   = `${year}-${String(month+1).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;

  const { data: profiles } = await supabase
    .from("profiles").select("id, full_name")
    .eq("department_id", deptId).eq("approved", true).order("full_name");

  const teacherIds = (profiles ?? []).map((p) => p.id);
  const ids = teacherIds.length ? teacherIds : ["00000000-0000-0000-0000-000000000000"];

  const { data: userRoles } = await supabase.from("user_roles").select("user_id, role").in("user_id", ids);
  const roleMap: Record<string, string> = {};
  for (const r of userRoles ?? []) roleMap[r.user_id] = r.role;

  // Exclude principal and admin — they are not teaching staff
  const teachers = (profiles ?? [])
    .map((p) => ({ ...p, role: roleMap[p.id] ?? "teacher" }))
    .filter((p) => p.role !== "principal" && p.role !== "admin");

  const [{ data: fixedLectures }, { data: datedLectures }, { data: leaves }] = await Promise.all([
    supabase.from("lectures").select("id,teacher_id,day_of_week,start_time,end_time,subject,class_name").in("teacher_id", ids).is("lecture_date", null),
    supabase.from("lectures").select("id,teacher_id,day_of_week,start_time,end_time,subject,class_name,lecture_date").in("teacher_id", ids).gte("lecture_date", from).lte("lecture_date", to),
    supabase.from("leave_requests").select("id,teacher_id,from_date,to_date,leave_type,total_days,session").in("teacher_id", ids).in("status", ["approved","hod_approved"]).lte("from_date", to).gte("to_date", from),
  ]);

  const leaveIds = (leaves ?? []).map((l) => l.id);
  const { data: proxies } = leaveIds.length
    ? await supabase.from("proxy_assignments").select("id,leave_request_id,proxy_teacher_id,absentee_teacher_id,proxy_date,subject,class_name,start_time,end_time,status").in("leave_request_id", leaveIds).in("status", ["accepted","pending"]).gte("proxy_date", from).lte("proxy_date", to)
    : { data: [] };

  const proxyIds = (proxies ?? []).map((p) => p.id);
  const { data: compensations } = proxyIds.length
    ? await supabase.from("compensation_assignments").select("id,proxy_assignment_id,from_teacher_id,to_teacher_id,lecture_id,compensation_date,status,note").in("proxy_assignment_id", proxyIds).gte("compensation_date", from).lte("compensation_date", to)
    : { data: [] };

  return { teachers, fixedLectures: fixedLectures??[], datedLectures: datedLectures??[], leaves: leaves??[], proxies: proxies??[], compensations: compensations??[] };
}

// ── Per-teacher computed row ──────────────────────────────────────────────────
interface DayInfo {
  dateStr: string;
  isLeave: boolean;
  ownLectures: { subject: string; class_name: string; start_time: string; end_time: string }[];
  proxyLectures: { subject: string; class_name: string; start_time: string; end_time: string }[];
}

function computeTeacherRow(
  teacherId: string,
  workingDays: Date[],
  fixedLectures: any[],
  datedLectures: any[],
  proxies: any[],
  leaves: any[],
): DayInfo[] {
  return workingDays.map((day) => {
    const dateStr = dateISO(day);
    const dow = day.getDay();
    const isLeave = leaves.some((l) => l.teacher_id === teacherId && l.from_date <= dateStr && l.to_date >= dateStr);

    // Tombstone dated lectures (subject starts with __COMP_GIVEN__) mark that
    // this teacher gave away their fixed lecture on this date — suppress that
    // fixed lecture from showing and don't count the tombstone itself.
    const tombstonedSlots = datedLectures
      .filter((l) => l.teacher_id === teacherId && l.lecture_date === dateStr && l.subject.startsWith("__COMP_GIVEN__"))
      .map((l) => `${l.start_time}|${l.end_time}`);

    const ownLectures = isLeave ? [] : [
      // Fixed lectures, excluding any that have a tombstone for this date
      ...fixedLectures.filter((l) =>
        l.teacher_id === teacherId &&
        l.day_of_week === dow &&
        !tombstonedSlots.includes(`${l.start_time}|${l.end_time}`)
      ),
      // Dated lectures, excluding tombstones
      ...datedLectures.filter((l) =>
        l.teacher_id === teacherId &&
        l.lecture_date === dateStr &&
        !l.subject.startsWith("__COMP_GIVEN__")
      ),
    ].map((l) => ({ subject: l.subject, class_name: l.class_name, start_time: l.start_time, end_time: l.end_time }));

    const proxyLectures = proxies
      .filter((p) => p.proxy_teacher_id === teacherId && p.proxy_date === dateStr)
      .map((p) => ({ subject: p.subject, class_name: p.class_name, start_time: p.start_time, end_time: p.end_time }));

    return { dateStr, isLeave, ownLectures, proxyLectures };
  });
}

function buildTeacherSummary(teacherId: string, teacherName: string, teacherRole: string, days: DayInfo[], workingDays: Date[], leaves: any[], proxies: any[], compensations: any[]) {
  const weeks = getWeeksInMonth(workingDays);
  const totalOwn    = days.reduce((s, d) => s + d.ownLectures.length, 0);
  const totalProxy  = days.reduce((s, d) => s + d.proxyLectures.length, 0);
  const totalLeave  = days.filter((d) => d.isLeave).length;
  const weeklyOwn   = weeks.map((wk) => {
    const wkDates = new Set(wk.map((d) => dateISO(d)));
    return days.filter((d) => wkDates.has(d.dateStr) && !d.isLeave).reduce((s, d) => s + d.ownLectures.length, 0);
  });
  const myLeaves    = leaves.filter((l) => l.teacher_id === teacherId);
  const myProxies   = proxies.filter((p) => p.proxy_teacher_id === teacherId);
  // Compensations offered by this teacher (they covered someone, offered their lecture back)
  const myCompGiven    = compensations.filter((c) => c.from_teacher_id === teacherId);
  // Compensations received by this teacher (someone gifted them a lecture)
  const myCompReceived = compensations.filter((c) => c.to_teacher_id === teacherId);
  const totalCompGiven    = myCompGiven.length;
  const totalCompReceived = myCompReceived.filter((c) => c.status === "accepted").length;
  return { id: teacherId, name: teacherName, role: teacherRole, days, weeklyOwn, totalOwn, totalProxy, totalLeave, myLeaves, myProxies, myCompGiven, myCompReceived, totalCompGiven, totalCompReceived };
}

// ── Excel export ──────────────────────────────────────────────────────────────
// ── Format a date as "10 August 2026 — Monday" ───────────────────────────────
function fmtDateFull(d: Date): string {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()} — ${DAY_FULL[d.getDay()]}`;
}

// ── Apply header row styles in XLSX ──────────────────────────────────────────

async function exportExcel(month: number, year: number, label: string, summaries: ReturnType<typeof buildTeacherSummary>[], workingDays: Date[], fixedLectures: any[], datedLectures: any[], proxies: any[], compensations: any[]) {
  const wb = XLSX.utils.book_new();
  const weeks = getWeeksInMonth(workingDays);

  // Sheet 1: Schedule grid — full date + day in headers
  const dayHeaders = workingDays.map((d) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${year}\n${DAY_FULL[d.getDay()]}`);
  const weekHeaders = weeks.map((_, i) => `Week ${i+1}\nLectures`);
  const headers = ["Teacher Name", "Role", ...dayHeaders, ...weekHeaders, "Total\nLectures", "Leave\nDays", "Proxy\nDuties"];

  const body = summaries.map((s) => [
    s.name,
    s.role === "hod" ? "HOD" : "Teacher",
    ...s.days.map((d) => {
      if (d.isLeave) return "ON LEAVE";
      const own = d.ownLectures.map((l) => `${l.subject} (${fmtTime(l.start_time)}-${fmtTime(l.end_time)}) [${l.class_name}]`);
      const prx = d.proxyLectures.map((l) => `PROXY: ${l.subject} (${fmtTime(l.start_time)}-${fmtTime(l.end_time)}) [${l.class_name}]`);
      return [...own, ...prx].join("\n") || "—";
    }),
    ...s.weeklyOwn,
    s.totalOwn,
    s.totalLeave,
    s.totalProxy,
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws1["!cols"] = [{ wch: 30 }, { wch: 10 }, ...workingDays.map(() => ({ wch: 32 })), ...weeks.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 10 }, { wch: 10 }];
  // Enable wrap for all data cells
  const ws1Range = XLSX.utils.decode_range(ws1["!ref"] ?? "A1");
  for (let r = 0; r <= ws1Range.e.r; r++) {
    for (let c = 0; c <= ws1Range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws1[addr]) ws1[addr].s = { alignment: { wrapText: true, vertical: "top" } };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws1, `${MONTH_NAMES[month].slice(0,8)} ${year}`);

  // Sheet 2: Weekly timetable (fixed lectures)
  const timingHeaders = ["Teacher Name", "Role", "Day", "Subject", "Class / Section", "Start Time", "End Time"];
  const timingBody: any[][] = [];
  for (const s of summaries) {
    const fixed = fixedLectures.filter((l) => l.teacher_id === s.id).sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
    for (const l of fixed) timingBody.push([s.name, s.role === "hod" ? "HOD" : "Teacher", DAY_FULL[l.day_of_week], l.subject, l.class_name, fmtTime(l.start_time), fmtTime(l.end_time)]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet([timingHeaders, ...timingBody]);
  ws2["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Timetable");

  // Sheet 3: Proxy duties
  if (proxies.length) {
    const ph = ["Proxy Teacher", "Full Date", "Day", "Subject", "Class / Section", "Start Time", "End Time", "Status"];
    const pb = proxies.sort((a, b) => a.proxy_date.localeCompare(b.proxy_date)).map((p) => {
      const t = summaries.find((s) => s.id === p.proxy_teacher_id);
      const d = new Date(p.proxy_date + "T00:00:00");
      return [t?.name ?? p.proxy_teacher_id, fmtDateFull(d), DAY_FULL[d.getDay()], p.subject, p.class_name, fmtTime(p.start_time), fmtTime(p.end_time), p.status];
    });
    const ws3 = XLSX.utils.aoa_to_sheet([ph, ...pb]);
    ws3["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Proxy Duties");
  }

  // Sheet 4: Leave log
  const lh = ["Teacher Name", "Leave Type", "From Date", "To Date", "Days", "Session"];
  const lb: any[][] = [];
  for (const s of summaries) {
    for (const l of s.myLeaves) {
      const fromD = new Date(l.from_date + "T00:00:00");
      const toD   = new Date(l.to_date   + "T00:00:00");
      lb.push([s.name, leaveTypeLabel(l.leave_type as LeaveType), fmtDateFull(fromD), fmtDateFull(toD), l.total_days, l.session ?? "Full Day"]);
    }
  }
  const ws4 = XLSX.utils.aoa_to_sheet([lh, ...lb]);
  ws4["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 32 }, { wch: 32 }, { wch: 8 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Leave Log");

  // Sheet 5: Compensation assignments
  if (compensations.length) {
    const ch = ["From Teacher (Proxy)", "To Teacher (Absentee)", "Compensation Date", "Day", "Status", "Note"];
    const cb = compensations.map((c) => {
      const from = summaries.find((s) => s.id === c.from_teacher_id);
      const to   = summaries.find((s) => s.id === c.to_teacher_id);
      const d    = new Date(c.compensation_date + "T00:00:00");
      return [
        from?.name ?? c.from_teacher_id,
        to?.name   ?? c.to_teacher_id,
        fmtDateFull(d),
        DAY_FULL[d.getDay()],
        c.status,
        c.note ?? "",
      ];
    });
    const ws5 = XLSX.utils.aoa_to_sheet([ch, ...cb]);
    ws5["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, ws5, "Compensations");
  }

  await saveXLSX(XLSX, wb, `${label.replace(/[^a-zA-Z0-9 _-]/g,"_")}_${MONTH_NAMES[month]}_${year}.xlsx`);
}

// ── Principal Excel export (leave-based, not schedule-based) ─────────────────
async function exportPrincipalExcel(
  year: number,
  deptTabLabel: string,
  leaves: any[],
  people: Record<string, any>,
) {
  const wb = XLSX.utils.book_new();
  const generatedOn = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  // ── Sheet 1: Full leave log ────────────────────────────────────────────────
  const headers = [
    "Teacher Name", "Department", "Leave Type",
    "From Date", "From Day", "To Date", "To Day",
    "Session", "Total Days", "Paid Days", "Pay-Cut Days", "Status",
  ];
  const body = leaves.map((l) => {
    const person  = people[l.teacher_id] ?? {};
    const fromD   = new Date(l.from_date + "T00:00:00");
    const toD     = new Date(l.to_date   + "T00:00:00");
    return [
      person.full_name   ?? "Unknown",
      person.department_name ?? "—",
      leaveTypeLabel(l.leave_type as LeaveType),
      `${fromD.getDate()} ${MONTH_NAMES[fromD.getMonth()]} ${fromD.getFullYear()}`,
      DAY_FULL[fromD.getDay()],
      `${toD.getDate()} ${MONTH_NAMES[toD.getMonth()]} ${toD.getFullYear()}`,
      DAY_FULL[toD.getDay()],
      l.session === "half_day" ? "Half Day" : "Full Day",
      l.total_days  ?? 0,
      l.paid_days   ?? 0,
      l.unpaid_days ?? 0,
      l.status,
    ];
  });

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws1["!cols"] = [
    { wch: 30 }, { wch: 24 }, { wch: 20 },
    { wch: 24 }, { wch: 14 }, { wch: 24 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
  ];
  ws1["!rows"] = [{ hpt: 36 }];
  // Enable wrap on all cells
  const range1 = XLSX.utils.decode_range(ws1["!ref"] ?? "A1");
  for (let r = 0; r <= range1.e.r; r++) {
    for (let c = 0; c <= range1.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws1[addr]) ws1[addr].s = { alignment: { wrapText: true, vertical: "top" } };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws1, "Leave Log");

  // ── Sheet 2: Summary by teacher ───────────────────────────────────────────
  const byTeacher: Record<string, { name: string; dept: string; counts: Record<string, number>; total: number; unpaid: number }> = {};
  for (const l of leaves) {
    const person = people[l.teacher_id] ?? {};
    if (!byTeacher[l.teacher_id]) byTeacher[l.teacher_id] = { name: person.full_name ?? "Unknown", dept: person.department_name ?? "—", counts: {}, total: 0, unpaid: 0 };
    const entry = byTeacher[l.teacher_id];
    entry.counts[l.leave_type] = (entry.counts[l.leave_type] ?? 0) + Number(l.total_days);
    entry.total  += Number(l.total_days);
    entry.unpaid += Number(l.unpaid_days ?? 0);
  }
  const summHeaders = ["Teacher Name", "Department", ...LEAVE_TYPES.map((t) => t.label), "Total Days", "Pay-Cut Days"];
  const summBody    = Object.values(byTeacher)
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name))
    .map((e) => [e.name, e.dept, ...LEAVE_TYPES.map((t) => e.counts[t.value] ?? 0), e.total, e.unpaid]);
  const ws2 = XLSX.utils.aoa_to_sheet([summHeaders, ...summBody]);
  ws2["!cols"] = [{ wch: 30 }, { wch: 24 }, ...LEAVE_TYPES.map(() => ({ wch: 16 })), { wch: 14 }, { wch: 14 }];
  ws2["!rows"] = [{ hpt: 36 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Teacher Summary");

  // ── Sheet 3: Summary by department ────────────────────────────────────────
  const byDept: Record<string, { counts: Record<string, number>; total: number; unpaid: number }> = {};
  for (const l of leaves) {
    const dept = (people[l.teacher_id] ?? {}).department_name ?? "Unknown";
    if (!byDept[dept]) byDept[dept] = { counts: {}, total: 0, unpaid: 0 };
    byDept[dept].counts[l.leave_type] = (byDept[dept].counts[l.leave_type] ?? 0) + Number(l.total_days);
    byDept[dept].total  += Number(l.total_days);
    byDept[dept].unpaid += Number(l.unpaid_days ?? 0);
  }
  const deptHeaders = ["Department", ...LEAVE_TYPES.map((t) => t.label), "Total Days", "Pay-Cut Days"];
  const deptBody    = Object.entries(byDept)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dept, e]) => [dept, ...LEAVE_TYPES.map((t) => e.counts[t.value] ?? 0), e.total, e.unpaid]);
  const ws3 = XLSX.utils.aoa_to_sheet([deptHeaders, ...deptBody]);
  ws3["!cols"] = [{ wch: 28 }, ...LEAVE_TYPES.map(() => ({ wch: 16 })), { wch: 14 }, { wch: 14 }];
  ws3["!rows"] = [{ hpt: 36 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Dept Summary");

  // ── Sheet 4: Meta info ────────────────────────────────────────────────────
  const ws4 = XLSX.utils.aoa_to_sheet([
    ["CSC Leave Management System — Principal Report"],
    [`Department Group: ${deptTabLabel}`],
    [`Year: ${year}`],
    [`Generated: ${generatedOn}`],
    [`Total Records: ${leaves.length}`],
  ]);
  ws4["!cols"] = [{ wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Report Info");

  await saveXLSX(XLSX, wb, `Principal_Leave_Report_${deptTabLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${year}.xlsx`);
}

// ── Principal PDF export ──────────────────────────────────────────────────────
async function exportPrincipalPDF(
  year: number,
  deptTabLabel: string,
  leaves: any[],
  people: Record<string, any>,
) {
  const doc    = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pageW  = doc.internal.pageSize.getWidth();
  const generatedOn = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  // Header bar
  doc.setFillColor(55, 48, 163);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
  doc.text("Principal Leave Report", 14, 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`${deptTabLabel}  ·  Year ${year}  ·  ${leaves.length} records`, 14, 18);
  doc.setFontSize(7.5);
  doc.text(`Generated: ${generatedOn}`, 14, 24);
  doc.setTextColor(0, 0, 0);

  // Table
  const headers = [
    "Teacher Name", "Department", "Leave Type",
    "From Date", "To Date", "Days", "Pay-Cut",
  ];
  const body = leaves.map((l) => {
    const person = people[l.teacher_id] ?? {};
    const fromD  = new Date(l.from_date + "T00:00:00");
    const toD    = new Date(l.to_date   + "T00:00:00");
    return [
      person.full_name      ?? "Unknown",
      person.department_name ?? "—",
      leaveTypeLabel(l.leave_type as LeaveType),
      `${fromD.getDate()} ${MONTH_NAMES[fromD.getMonth()]} ${fromD.getFullYear()}\n${DAY_FULL[fromD.getDay()]}`,
      `${toD.getDate()} ${MONTH_NAMES[toD.getMonth()]} ${toD.getFullYear()}\n${DAY_FULL[toD.getDay()]}`,
      l.total_days  ?? 0,
      l.unpaid_days ?? 0,
    ];
  });

  autoTable(doc, {
    head: [headers],
    body,
    startY: 32,
    margin: { left: 14, right: 14 },
    styles: {
      fontSize: 8,
      cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
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
    columnStyles: {
      0: { cellWidth: 44, fontStyle: "bold", halign: "left" },
      1: { cellWidth: 40, halign: "left" },
      2: { cellWidth: 36, halign: "left" },
      3: { cellWidth: 44, halign: "left" },
      4: { cellWidth: 44, halign: "left" },
      5: { cellWidth: 16, halign: "center" },
      6: { cellWidth: 18, halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        const v = String(data.cell.raw ?? "");
        if (data.column.index === 6 && v !== "0" && v !== "—") {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
        }
        if (data.column.index === 2) {
          const lt = leaves[data.row.index]?.leave_type;
          if (lt === "maternity") { data.cell.styles.fillColor = [252, 231, 243]; data.cell.styles.textColor = [157, 23, 77]; }
          else if (lt === "medical") { data.cell.styles.fillColor = [254, 249, 195]; data.cell.styles.textColor = [133, 77, 14]; }
          else if (lt === "casual") { data.cell.styles.fillColor = [240, 249, 255]; data.cell.styles.textColor = [14, 116, 144]; }
        }
      }
    },
    didDrawPage: (data) => {
      const pg    = (doc as any).internal.getCurrentPageInfo().pageNumber;
      const total = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7); doc.setTextColor(150, 150, 150);
      doc.text(`Principal Leave Report  ·  ${deptTabLabel}  ·  ${year}  ·  Page ${pg} of ${total}`, 14, doc.internal.pageSize.getHeight() - 6);
      doc.setTextColor(0, 0, 0);
    },
  });

  await savePDF(doc, `Principal_Leave_Report_${deptTabLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${year}.pdf`);
}
async function exportPDF(month: number, year: number, label: string, summaries: ReturnType<typeof buildTeacherSummary>[], workingDays: Date[]) {
  const weeks   = getWeeksInMonth(workingDays);
  const doc     = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pageW   = doc.internal.pageSize.getWidth();

  // ── Cover header bar ──────────────────────────────────────────────────────
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255);
  doc.text(label, 14, 11);
  doc.setFontSize(9);  doc.setFont("helvetica", "normal");
  doc.text(`Monthly Schedule  ·  ${MONTH_NAMES[month]} ${year}`, 14, 18);
  doc.setFontSize(7.5);
  doc.text("LEAVE = On Leave   ·   P: = Proxy Duty   ·   Subject codes = lectures taken", 14, 24);
  doc.setTextColor(0, 0, 0);

  // ── Table head: full "DD Mon\nFullDay" for each working day ──────────────
  const head = [[
    "Teacher Name", "Role",
    ...workingDays.map((d) =>
      `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}\n${DAY_FULL[d.getDay()]}`
    ),
    ...weeks.map((_, i) => `Wk ${i + 1}\nLects`),
    "Total\nLects", "Leave\nDays", "Proxy\nDuties",
  ]];

  const body = summaries.map((s) => [
    s.name,
    s.role === "hod" ? "HOD" : "Teacher",
    ...s.days.map((d) => {
      if (d.isLeave) return "LEAVE";
      const n = d.ownLectures.length;
      const p = d.proxyLectures.length;
      if (!n && !p) return "\u2014";
      const parts: string[] = [];
      if (n) parts.push(d.ownLectures.map((l) => l.subject.slice(0, 6)).join("\n"));
      if (p) parts.push(d.proxyLectures.map((l) => `P:${l.subject.slice(0, 5)}`).join("\n"));
      return parts.join("\n");
    }),
    ...s.weeklyOwn,
    s.totalOwn,
    s.totalLeave || "\u2014",
    s.totalProxy || "\u2014",
  ]);

  // Compute dynamic column widths
  const tailCols  = weeks.length + 3; // week totals + Total/Leave/Proxy
  const tailWidth = tailCols * 9;
  const remaining = pageW - 28 - 34 - 12 - tailWidth;
  const dateColW  = workingDays.length > 0 ? Math.max(remaining / workingDays.length, 10) : 12;

  const colStyles: Record<number, object> = {
    0: { halign: "left", cellWidth: 34, fontStyle: "bold" },
    1: { cellWidth: 12, halign: "center" },
  };
  workingDays.forEach((_, i) => {
    colStyles[2 + i] = { cellWidth: dateColW, halign: "center" };
  });
  const tailStart = 2 + workingDays.length;
  for (let i = 0; i < tailCols; i++) colStyles[tailStart + i] = { cellWidth: 9, halign: "center" };

  autoTable(doc, {
    head, body,
    startY: 32,
    margin: { left: 14, right: 14 },
    tableWidth: "auto",
    styles: {
      fontSize: 6,
      cellPadding: { top: 1.5, right: 1, bottom: 1.5, left: 1 },
      valign: "middle",
      lineColor: [210, 210, 220],
      lineWidth: 0.18,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: [255, 255, 255],
      fontSize: 6.5,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      minCellHeight: 12,
    },
    alternateRowStyles: { fillColor: [248, 249, 255] },
    columnStyles: colStyles,
    didParseCell: (data) => {
      const v = String(data.cell.raw ?? "");
      if (data.section === "body" && data.column.index >= 2) {
        if (v === "LEAVE") {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
        } else if (v.startsWith("P:") || v.includes("\nP:")) {
          data.cell.styles.fillColor = [254, 243, 199];
          data.cell.styles.textColor = [120, 53, 15];
        } else if (v !== "\u2014" && v !== "") {
          data.cell.styles.fillColor = [240, 249, 255];
          data.cell.styles.textColor = [30, 64, 175];
        }
      }
    },
    didDrawPage: (data) => {
      const pg    = (doc as any).internal.getCurrentPageInfo().pageNumber;
      const total = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7); doc.setTextColor(140, 140, 140);
      doc.text(
        `${label}  ·  ${MONTH_NAMES[month]} ${year}  ·  Page ${pg} of ${total}`,
        14,
        doc.internal.pageSize.getHeight() - 6,
      );
      doc.setTextColor(0, 0, 0);
    },
  });

  await savePDF(doc, `${label.replace(/[^a-zA-Z0-9 _-]/g, "_")}_${MONTH_NAMES[month]}_${year}.pdf`);
}

// ── Main page ─────────────────────────────────────────────────────────────────
function ReportsPage() {
  const { profile, role } = useAuth();
  const year = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("month");
  const [selectedTeacher, setSelectedTeacher] = useState<string>("all");
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);

  const isHod       = role === "hod";
  const isPrincipal = role === "principal";
  const deptName    = profile?.department_name ?? "Department";

  // ── Principal department tab ("commerce_arts" | "science_tech") ───────────
  const [principalDeptTab, setPrincipalDeptTab] = useState<"commerce_arts" | "science_tech">("commerce_arts");

  // Department name keywords for grouping — adjust to match your actual dept names
  const COMMERCE_ARTS_KEYWORDS   = ["commerce", "arts", "economics", "history", "english", "sociology", "philosophy", "political", "geography", "hindi", "marathi"];
  const SCIENCE_TECH_KEYWORDS    = ["science", "technology", "physics", "chemistry", "biology", "maths", "mathematics", "computer", "it", "information", "botany", "zoology", "microbiology"];

  function getDeptGroup(deptName: string): "commerce_arts" | "science_tech" | "other" {
    const n = (deptName ?? "").toLowerCase();
    if (SCIENCE_TECH_KEYWORDS.some((k) => n.includes(k))) return "science_tech";
    if (COMMERCE_ARTS_KEYWORDS.some((k) => n.includes(k))) return "commerce_arts";
    return "other";
  }

  // ── Yearly leave data (all roles) ─────────────────────────────────────────
  const { data } = useQuery({
    queryKey: ["reports", role, profile?.department_id, year],
    enabled: !!profile,
    queryFn: async () => {
      let q = supabase.from("leave_requests").select("*").in("status", ["approved","hod_approved"]).gte("from_date", `${year}-01-01`).lte("from_date", `${year}-12-31`);
      if (isHod) q = q.eq("department_id", profile!.department_id ?? "");
      const { data: leaves, error } = await q;
      if (error) throw error;

      // For principal: always fetch ALL approved teaching staff so the people map
      // is complete even when there are no leaves in the selected period.
      let people: Record<string, any>;
      if (isPrincipal) {
        const { data: adminRoleRows } = await supabase
          .from("user_roles").select("user_id").in("role", ["admin", "principal"]);
        const excludedIds = new Set((adminRoleRows ?? []).map((r: any) => r.user_id));

        const { data: allProfiles } = await supabase
          .from("profiles")
          .select("id, full_name, designation, department_id, departments(name)")
          .eq("approved", true);

        people = {};
        for (const p of allProfiles ?? []) {
          if (!excludedIds.has(p.id)) {
            people[p.id] = {
              id: p.id,
              full_name: p.full_name,
              designation: p.designation,
              department_id: p.department_id,
              department_name: (p.departments as { name: string } | null)?.name ?? null,
            };
          }
        }
      } else {
        // HOD: fetch only people in the leaves (existing behaviour)
        people = await fetchPeople((leaves ?? []).map((l: any) => l.teacher_id));
      }

      return { leaves: leaves ?? [], people };
    },
  });

  // ── Monthly schedule (HOD only) ────────────────────────────────────────────
  const { data: monthlyData, isLoading: monthLoading } = useQuery({
    queryKey: ["monthly-schedule", profile?.department_id, year, selectedMonth],
    enabled: !!profile && isHod && !!profile.department_id,
    queryFn: () => fetchMonthlySchedule(profile!.department_id!, year, selectedMonth),
  });

  // ── Compute schedule rows filtered by period + teacher ────────────────────
  const downloadRange = getDateRangeForPeriod(periodFilter, selectedMonth, year);
  const viewWorkingDays   = getWorkingDaysInMonth(year, selectedMonth);
  const filterWorkingDays = getWorkingDaysInRange(downloadRange.from, downloadRange.to);

  const allSummaries = useMemo(() => {
    if (!monthlyData) return [];
    return monthlyData.teachers.map((t) => {
      const days = computeTeacherRow(t.id, viewWorkingDays, monthlyData.fixedLectures, monthlyData.datedLectures, monthlyData.proxies, monthlyData.leaves);
      return buildTeacherSummary(t.id, t.full_name, t.role, days, viewWorkingDays, monthlyData.leaves, monthlyData.proxies, monthlyData.compensations);
    });
  }, [monthlyData, viewWorkingDays]);

  const filteredSummaries = useMemo(() => {
    let rows = allSummaries;
    if (selectedTeacher !== "all") rows = rows.filter((r) => r.id === selectedTeacher);
    if (periodFilter !== "month") {
      rows = rows.map((r) => {
        const filtDays = computeTeacherRow(r.id, filterWorkingDays, monthlyData?.fixedLectures??[], monthlyData?.datedLectures??[], monthlyData?.proxies??[], monthlyData?.leaves??[]);
        return buildTeacherSummary(r.id, r.name, r.role, filtDays, filterWorkingDays, monthlyData?.leaves??[], monthlyData?.proxies??[], monthlyData?.compensations??[]);
      });
    }
    return rows;
  }, [allSummaries, selectedTeacher, periodFilter, filterWorkingDays, monthlyData]);

  const displayWorkingDays = periodFilter !== "month" ? filterWorkingDays : viewWorkingDays;
  const weeks = getWeeksInMonth(displayWorkingDays);
  const downloadLabel = `${deptName} — ${downloadRange.label}${selectedTeacher !== "all" ? ` (${monthlyData?.teachers.find((t: any) => t.id === selectedTeacher)?.full_name ?? ""})` : ""}`;

  // ── Leave stats (filtered) ────────────────────────────────────────────────
  const allLeaves = data?.leaves ?? [];
  const filteredLeaves = useMemo(() => {
    let rows = allLeaves;
    // HOD: filter by period + teacher
    if (isHod) {
      rows = rows.filter((l) => {
        const inPeriod  = l.from_date <= downloadRange.to && l.to_date >= downloadRange.from;
        const byTeacher = selectedTeacher !== "all" ? l.teacher_id === selectedTeacher : true;
        return inPeriod && byTeacher;
      });
    }
    // Principal: filter by selected department tab
    if (isPrincipal) {
      rows = rows.filter((l) => {
        const personDept = (data?.people[l.teacher_id] as any)?.department_name ?? "";
        const grp = getDeptGroup(personDept);
        return grp === principalDeptTab || grp === "other";
      });
    }
    return rows;
  }, [allLeaves, isHod, isPrincipal, downloadRange, selectedTeacher, principalDeptTab, data?.people]);

  const leaves = (isHod || isPrincipal) ? filteredLeaves : allLeaves;
  const totalDays  = leaves.reduce((s, l) => s + Number(l.total_days), 0);
  const unpaidDays = leaves.reduce((s, l) => s + Number(l.unpaid_days), 0);
  const byType     = LEAVE_TYPES.map((t) => ({ ...t, days: leaves.filter((l) => l.leave_type === t.value).reduce((s, l) => s + Number(l.total_days), 0) }));
  const maxType    = Math.max(1, ...byType.map((t) => t.days));

  // ── Download handlers ─────────────────────────────────────────────────────
  const handleDownloadExcel = useCallback(() => {
    if (!monthlyData && !isPrincipal) return toast.error("Report data not loaded yet");
    setDownloading("excel");
    setTimeout(() => {
      try {
        if (isPrincipal) {
          const deptTabLabel = principalDeptTab === "commerce_arts" ? "Commerce & Arts" : "Science & Technology";
          exportPrincipalExcel(year, deptTabLabel, filteredLeaves, data?.people ?? {});
        } else {
          exportExcel(selectedMonth, year, downloadLabel, filteredSummaries, displayWorkingDays, monthlyData?.fixedLectures??[], monthlyData?.datedLectures??[], monthlyData?.proxies??[], monthlyData?.compensations??[]);
        }
      } catch (e) {
        toast.error("Export failed — please try again");
        console.error(e);
      } finally { setDownloading(null); }
    }, 50);
  }, [selectedMonth, year, downloadLabel, filteredSummaries, displayWorkingDays, monthlyData, isPrincipal, principalDeptTab, filteredLeaves, data?.people]);

  const handleDownloadPDF = useCallback(() => {
    if (!monthlyData && !isPrincipal) return toast.error("Report data not loaded yet");
    if (!isPrincipal && filteredSummaries.length === 0) return toast.error("No data to export");
    setDownloading("pdf");
    setTimeout(() => {
      try {
        if (isPrincipal) {
          const deptTabLabel = principalDeptTab === "commerce_arts" ? "Commerce & Arts" : "Science & Technology";
          exportPrincipalPDF(year, deptTabLabel, filteredLeaves, data?.people ?? {});
        } else {
          exportPDF(selectedMonth, year, downloadLabel, filteredSummaries, displayWorkingDays);
        }
      } catch (e) {
        toast.error("PDF generation failed — please try again");
        console.error(e);
      } finally { setDownloading(null); }
    }, 50);
  }, [selectedMonth, year, downloadLabel, filteredSummaries, displayWorkingDays, isPrincipal, principalDeptTab, filteredLeaves, data?.people]);

  return (
    <AppShell
      title="Leave Reports"
      subtitle={isHod ? `${MONTH_NAMES[selectedMonth]} ${year} · ${deptName}` : `Approved leaves in ${year}`}
    >
      <div className="space-y-6">

        {/* ── HOD filter bar (top, before stats) ─────────────────────────── */}
        {isHod && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
            {/* Row 1: selectors */}
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
              {/* Month */}
              <div className="space-y-1 col-span-1">
                <p className="text-xs text-muted-foreground font-medium">Month</p>
                <Select value={String(selectedMonth)} onValueChange={(v) => { setSelectedMonth(Number(v)); setPeriodFilter("month"); }}>
                  <SelectTrigger className="h-9 text-sm w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => <SelectItem key={i} value={String(i)}>{m} {year}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Period */}
              <div className="space-y-1 col-span-1">
                <p className="text-xs text-muted-foreground font-medium">Period</p>
                <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as PeriodFilter)}>
                  <SelectTrigger className="h-9 text-sm w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Full month</SelectItem>
                    <SelectItem value="week">This week</SelectItem>
                    <SelectItem value="day">Today</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Staff */}
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <p className="text-xs text-muted-foreground font-medium">Staff</p>
                <Select value={selectedTeacher} onValueChange={setSelectedTeacher}>
                  <SelectTrigger className="h-9 text-sm w-full sm:w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All staff</SelectItem>
                    {(monthlyData?.teachers ?? []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.full_name}{t.role === "hod" ? " (HOD)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: active label + download buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/50">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Showing</p>
                <p className="text-sm font-semibold truncate">
                  {downloadRange.label}{selectedTeacher !== "all"
                    ? ` · ${monthlyData?.teachers.find((t: any) => t.id === selectedTeacher)?.full_name ?? ""}`
                    : " · All staff"}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleDownloadExcel} disabled={!!downloading || monthLoading || (!isPrincipal && !filteredSummaries.length)}>
                  <FileSpreadsheet className="size-4 text-emerald-600" />
                  <span className="hidden xs:inline">{downloading === "excel" ? "…" : "Excel"}</span>
                </Button>
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleDownloadPDF} disabled={!!downloading || monthLoading || (!isPrincipal && !filteredSummaries.length)}>
                  <FileText className="size-4 text-red-600 dark:text-red-400" />
                  <span className="hidden xs:inline">{downloading === "pdf" ? "…" : "PDF"}</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Principal: Department tabs ────────────────────────────────────── */}
        {isPrincipal && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex">
              {([
                { id: "commerce_arts",  label: "Commerce & Arts",      icon: BookOpen },
                { id: "science_tech",   label: "Science & Technology",  icon: TrendingDown },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setPrincipalDeptTab(id)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                    principalDeptTab === id
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            <div className="px-4 py-2 bg-muted/20 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Showing leave data for <strong className="text-foreground">
                  {principalDeptTab === "commerce_arts" ? "Commerce & Arts" : "Science & Technology"}
                </strong> departments
              </p>
            </div>
          </div>
        )}

        {/* ── Stat cards ────────────────────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Approved requests" value={leaves.length} />
          <StatCard label="Total leave days"   value={totalDays}   tone="warning" />
          <StatCard label="Pay-cut days"        value={unpaidDays}  tone="destructive" />
        </div>

        {/* ── Leave type breakdown ──────────────────────────────────────────── */}
        <SectionCard title="Leave type breakdown">
          <ul className="space-y-3">
            {byType.map((t) => (
              <li key={t.value}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t.label}</span>
                  <span className="font-semibold">{t.days} day(s)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(t.days/maxType)*100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* ── Detailed leave log ────────────────────────────────────────────── */}
        <SectionCard title="Leave log" subtitle={`${leaves.length} record(s)`}>
          {leaves.length === 0 ? (
            <Empty>No approved leaves for this period.</Empty>
          ) : (
            <>
              {/* Mobile: card list */}
              <ul className="sm:hidden space-y-2">
                {leaves.map((l, i) => (
                  <li key={l.id} className={`rounded-lg border border-border p-3 text-sm space-y-1 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                    <p className="font-semibold">{data?.people[l.teacher_id]?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{leaveTypeLabel(l.leave_type as LeaveType)} · {fmtDate(l.from_date)} – {fmtDate(l.to_date)}</p>
                    <div className="flex gap-3 text-xs pt-0.5">
                      <span>{Number(l.total_days)} days</span>
                      <span className="text-success">Paid: {Number(l.paid_days)}</span>
                      {Number(l.unpaid_days) > 0 && <span className="text-destructive font-semibold">Cut: {Number(l.unpaid_days)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-semibold">Teacher</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                      <th className="px-4 py-2.5 text-left font-semibold">From</th>
                      <th className="px-4 py-2.5 text-left font-semibold">To</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Days</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Paid</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Pay cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map((l, i) => (
                      <tr key={l.id} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="px-4 py-3 font-medium">{data?.people[l.teacher_id]?.full_name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                        <td className="px-4 py-3">{fmtDate(l.from_date)}</td>
                        <td className="px-4 py-3">{fmtDate(l.to_date)}</td>
                        <td className="px-4 py-3 text-center font-medium">{Number(l.total_days)}</td>
                        <td className="px-4 py-3 text-center text-success">{Number(l.paid_days)}</td>
                        <td className="px-4 py-3 text-center">
                          {Number(l.unpaid_days) > 0
                            ? <span className="font-semibold text-destructive">{Number(l.unpaid_days)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>

        {/* ── HOD: Monthly Schedule ─────────────────────────────────────────── */}
        {isHod && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Department Schedule</h2>
                <p className="text-sm text-muted-foreground">{downloadRange.label} · {displayWorkingDays.length} working day(s)</p>
              </div>
            </div>

            {monthLoading ? (
              <div className="rounded-xl border border-border bg-muted/30 p-10 text-center">
                <p className="text-sm text-muted-foreground animate-pulse">Loading schedule…</p>
              </div>
            ) : filteredSummaries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <Empty>No teachers found for this filter.</Empty>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSummaries.map((s) => (
                  <TeacherScheduleCard
                    key={s.id}
                    summary={s}
                    workingDays={displayWorkingDays}
                    weeks={weeks}
                    expanded={expandedTeacher === s.id}
                    onToggle={() => setExpandedTeacher(expandedTeacher === s.id ? null : s.id)}
                  />
                ))}
              </div>
            )}

            {/* Department totals row */}
            {!monthLoading && filteredSummaries.length > 1 && (
              <DeptTotalsCard summaries={filteredSummaries} weeks={weeks} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Teacher Schedule Card ─────────────────────────────────────────────────────
function TeacherScheduleCard({
  summary,
  workingDays,
  weeks,
  expanded,
  onToggle,
}: {
  summary: ReturnType<typeof buildTeacherSummary>;
  workingDays: Date[];
  weeks: Date[][];
  expanded: boolean;
  onToggle: () => void;
}) {
  const leaveDays   = summary.days.filter((d) => d.isLeave);
  const activeDays  = summary.days.filter((d) => !d.isLeave && (d.ownLectures.length + d.proxyLectures.length) > 0);
  const freeDays    = summary.days.filter((d) => !d.isLeave && d.ownLectures.length === 0 && d.proxyLectures.length === 0);
  const attendancePct = workingDays.length ? Math.round(((workingDays.length - leaveDays.length) / workingDays.length) * 100) : 100;

  return (
    <div className={`rounded-xl border transition-all ${expanded ? "border-primary/40 shadow-sm" : "border-border hover:border-border/80"}`}>
      {/* Header — always visible */}
      <button onClick={onToggle} className="w-full text-left px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className={`flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${summary.role === "hod" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {summary.name.charAt(0)}
          </div>
          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate text-sm">
              {summary.name}
              {summary.role === "hod" && <span className="ml-2 text-xs font-normal text-primary bg-primary/10 rounded px-1.5 py-0.5">HOD</span>}
            </p>
            <p className="text-xs text-muted-foreground">{workingDays.length} working days · {attendancePct}% attendance</p>
          </div>
          {/* Chevron */}
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        </div>

        {/* Chips — below name, always wrap */}
        <div className="mt-2 flex flex-wrap gap-1.5 ml-12 sm:ml-13">
          <Chip icon={BookOpen} value={summary.totalOwn} label="Lectures" color="blue" />
          {summary.totalProxy > 0 && <Chip icon={UserCheck} value={summary.totalProxy} label="Proxies" color="amber" />}
          {summary.totalCompGiven > 0 && <Chip icon={ArrowLeftRight} value={summary.totalCompGiven} label="Comp. given" color="violet" />}
          {summary.totalCompReceived > 0 && <Chip icon={Gift} value={summary.totalCompReceived} label="Comp. recv." color="green" />}
          {summary.totalLeave > 0 && <Chip icon={TrendingDown} value={summary.totalLeave} label="Leave" color="red" />}
          {summary.weeklyOwn.map((wc, i) => (
            <span key={i} className="text-xs rounded-md bg-muted px-2 py-1 font-medium">Wk{i + 1}: <strong>{wc}</strong></span>
          ))}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-5">

          {/* Week-by-week grid */}
          {weeks.map((weekDays, wi) => {
            const weekDates = new Set(weekDays.map((d) => dateISO(d)));
            const weekSummaryDays = summary.days.filter((d) => weekDates.has(d.dateStr));
            const weekOwn   = weekSummaryDays.reduce((s, d) => s + d.ownLectures.length, 0);
            const weekProxy = weekSummaryDays.reduce((s, d) => s + d.proxyLectures.length, 0);
            const weekLeave = weekSummaryDays.filter((d) => d.isLeave).length;
            const cols      = weekDays.length; // 1–6

            return (
              <div key={wi}>
                {/* Week header */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary shrink-0">Wk {wi + 1}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {fmtDate(weekDays[0])} – {fmtDate(weekDays[weekDays.length - 1])}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    {weekOwn > 0   && <span className="text-blue-600 dark:text-blue-400 font-medium">{weekOwn} lec</span>}
                    {weekProxy > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{weekProxy} proxy</span>}
                    {weekLeave > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{weekLeave} leave</span>}
                  </div>
                </div>

                {/* Day cards — responsive grid: 3 cols on mobile, up to 6 on desktop */}
                <div className={`grid gap-1.5 ${
                  cols <= 3 ? "grid-cols-3" :
                  cols <= 4 ? "grid-cols-4" :
                  cols <= 5 ? "grid-cols-3 sm:grid-cols-5" :
                  "grid-cols-3 sm:grid-cols-6"
                }`}>
                  {weekDays.map((day) => {
                    const dateStr = dateISO(day);
                    const info = summary.days.find((d) => d.dateStr === dateStr);
                    if (!info) return null;
                    return <DayCard key={dateStr} day={day} info={info} />;
                  })}
                </div>
              </div>
            );
          })}

          {/* Leave list */}
          {summary.myLeaves.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Approved leaves this period</p>
              <div className="space-y-1.5">
                {summary.myLeaves.map((l: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs">
                    <span className="font-medium text-destructive">{leaveTypeLabel(l.leave_type as LeaveType)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{fmtDate(l.from_date)} – {fmtDate(l.to_date)}</span>
                    <span className="ml-auto font-semibold">{Number(l.total_days)} day(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compensation given (this teacher did proxy and offered their lecture back) */}
          {summary.myCompGiven.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Compensation offered by this teacher</p>
              <div className="space-y-1.5">
                {summary.myCompGiven.map((c: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30 px-3 py-2 text-xs">
                    <ArrowLeftRight className="size-3 text-violet-600 shrink-0" />
                    <span className="font-medium text-violet-800 dark:text-violet-200">To colleague</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{fmtDate(c.compensation_date)}</span>
                    {c.note && <span className="text-muted-foreground italic">"{c.note}"</span>}
                    <Badge variant="secondary" className={`ml-auto text-[10px] capitalize ${c.status === "accepted" ? "bg-success/15 text-success" : c.status === "rejected" ? "bg-destructive/15 text-destructive" : ""}`}>{c.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compensation received (someone gifted this teacher a lecture) */}
          {summary.myCompReceived.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Compensation received</p>
              <div className="space-y-1.5">
                {summary.myCompReceived.map((c: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-3 py-2 text-xs">
                    <Gift className="size-3 text-green-600 shrink-0" />
                    <span className="font-medium text-green-800 dark:text-green-200">From colleague</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{fmtDate(c.compensation_date)}</span>
                    {c.note && <span className="text-muted-foreground italic">"{c.note}"</span>}
                    <Badge variant="secondary" className={`ml-auto text-[10px] capitalize ${c.status === "accepted" ? "bg-success/15 text-success" : c.status === "rejected" ? "bg-destructive/15 text-destructive" : ""}`}>{c.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Proxy duties list */}
          {summary.myProxies.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Proxy duties this period</p>
              <div className="space-y-1.5">
                {summary.myProxies.map((p: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-xs">
                    <Clock className="size-3 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="font-medium">{p.subject} · {p.class_name}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{fmtDate(p.proxy_date)}</span>
                    <span className="text-muted-foreground">{fmtTime(p.start_time)}–{fmtTime(p.end_time)}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px] capitalize">{p.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Day Card (inside expanded teacher row) ────────────────────────────────────
function DayCard({ day, info }: { day: Date; info: DayInfo }) {
  const dow     = day.getDay();
  const date    = day.getDate();
  const isToday = dateISO(day) === dateISO(new Date());

  return (
    <div className={`rounded-lg border p-1.5 sm:p-2 text-xs min-h-[72px] sm:min-h-[80px] flex flex-col ${
      info.isLeave
        ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
        : info.ownLectures.length + info.proxyLectures.length > 0
        ? "border-blue-100 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20"
        : "border-border bg-muted/20"
    } ${isToday ? "ring-2 ring-primary ring-offset-1" : ""}`}>
      {/* Date header */}
      <div className="flex items-center justify-between mb-1">
        <span className={`font-bold text-xs sm:text-sm ${isToday ? "text-primary" : "text-foreground"}`}>{date}</span>
        <span className="text-muted-foreground text-[9px] sm:text-[10px]">{DAY_NAMES[dow]}</span>
      </div>

      {info.isLeave ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="font-bold text-red-600 dark:text-red-400 text-[9px] sm:text-[11px] text-center leading-tight">ON LEAVE</span>
        </div>
      ) : info.ownLectures.length === 0 && info.proxyLectures.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-muted-foreground text-[9px] sm:text-[10px]">—</span>
        </div>
      ) : (
        <div className="space-y-0.5 flex-1 overflow-hidden">
          {info.ownLectures.map((l, i) => (
            <div key={i} className="rounded bg-blue-100 dark:bg-blue-900/40 px-1 py-0.5" title={`${l.subject} · ${l.class_name} · ${fmtTime(l.start_time)}–${fmtTime(l.end_time)}`}>
              <p className="font-semibold text-blue-800 dark:text-blue-200 truncate leading-tight text-[9px] sm:text-[10px]">{l.subject}</p>
              <p className="text-blue-600 dark:text-blue-400 text-[8px] sm:text-[9px] leading-tight truncate">{l.class_name}</p>
            </div>
          ))}
          {info.proxyLectures.map((l, i) => (
            <div key={i} className="rounded bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5" title={`PROXY: ${l.subject} · ${l.class_name} · ${fmtTime(l.start_time)}–${fmtTime(l.end_time)}`}>
              <p className="font-semibold text-amber-800 dark:text-amber-200 truncate leading-tight text-[9px] sm:text-[10px]">P: {l.subject}</p>
              <p className="text-amber-600 dark:text-amber-400 text-[8px] sm:text-[9px] leading-tight truncate">{l.class_name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Department totals row ─────────────────────────────────────────────────────
function DeptTotalsCard({ summaries, weeks }: { summaries: ReturnType<typeof buildTeacherSummary>[]; weeks: Date[][] }) {
  const totalOwn       = summaries.reduce((s, r) => s + r.totalOwn, 0);
  const totalProxy     = summaries.reduce((s, r) => s + r.totalProxy, 0);
  const totalLeave     = summaries.reduce((s, r) => s + r.totalLeave, 0);
  const totalCompGiven = summaries.reduce((s, r) => s + r.totalCompGiven, 0);
  const weeklyTotals   = weeks.map((_, i) => summaries.reduce((s, r) => s + (r.weeklyOwn[i] ?? 0), 0));

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-4 sm:px-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Department totals</p>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-5 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Total lectures</p>
          <p className="font-bold text-primary text-base">{totalOwn}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Proxy duties</p>
          <p className="font-bold text-amber-600 dark:text-amber-400 text-base">{totalProxy}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Compensations</p>
          <p className="font-bold text-violet-600 text-base">{totalCompGiven}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Leave days</p>
          <p className="font-bold text-destructive text-base">{totalLeave}</p>
        </div>
        {weeklyTotals.map((wt, i) => (
          <div key={i}>
            <p className="text-xs text-muted-foreground">Week {i + 1}</p>
            <p className="font-bold text-foreground text-base">{wt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chip helper ───────────────────────────────────────────────────────────────
function Chip({ icon: Icon, value, label, color }: { icon: any; value: number; label: string; color: "blue"|"amber"|"red"|"violet"|"green" }) {
  const cls = {
    blue:   "bg-blue-50   text-blue-700   border-blue-200   dark:bg-blue-950/30   dark:text-blue-300   dark:border-blue-800",
    amber:  "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/30  dark:text-amber-300  dark:border-amber-800",
    red:    "bg-red-50    text-red-700    border-red-200    dark:bg-red-950/30    dark:text-red-300    dark:border-red-800",
    violet: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800",
    green:  "bg-green-50  text-green-700  border-green-200  dark:bg-green-950/30  dark:text-green-300  dark:border-green-800",
  }[color];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${cls}`}>
      <Icon className="size-3" />
      {value} {label}
    </span>
  );
}
