/**
 * LeaveBot.tsx
 *
 * A floating AI chatbot that answers any question a teacher has about
 * the CSC Leave Management System — leave types, approval flows, balances,
 * proxy assignments, payroll, schedules, notices, etc.
 *
 * Powered by Groq (llama-3.1-8b-instant, free tier).
 * Requires VITE_GROQ_API_KEY in .env
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { leaveTypeLabel, type LeaveType } from "@/lib/leave";

// ── System prompt — full app knowledge ────────────────────────────────────────
const SYSTEM_PROMPT = `You are LeaveBot, the friendly in-app assistant for the CSC Leave Management System (CLMS) used by Chandrabhan Sharma College. You help teachers, HODs, principals, and HR staff understand how to use the system.

Answer questions clearly and concisely. Use bullet points for lists. Keep answers short unless the user asks for more detail. Always be polite and professional. If you don't know something specific to this college, say so.

You have access to the user's LIVE DATA injected below — their actual schedule, current time, today's lectures, leave balances, recent requests, and if they are HR, a summary of pending teachers and payroll stats. Use this data to answer personal questions. Never make up numbers — only use what is in the live data. If something isn't there, say "please check the relevant page."

═══════════════════════════════════════
ROLES IN THE SYSTEM
═══════════════════════════════════════
• Teacher — can apply for leave, view their own leaves, see schedule, proxy assignments, payroll, profile, holidays, notices, dashboard.
• HOD (Head of Department) — everything a teacher can do PLUS: view/approve leave requests for their department teachers, view teacher directory, post notices, view department reports.
• Principal — can view/approve ALL leave requests, view all teachers, post notices, view full reports, manage departments.
• Admin — full access including managing staff accounts, salary, departments, bulk data export, holidays.
• HR Admin — manages teacher onboarding. Can see all teachers' leave records, payroll details, and uploaded documents. Cannot see admin or principal profiles.

═══════════════════════════════════════
HR ADMIN PANEL
═══════════════════════════════════════
The HR Panel (/hr) is accessible to users with the "hr" or "admin" role.

WHAT HR CAN DO:
• View all approved teaching staff (excluding admin, principal, and HR themselves).
• See each teacher's full profile: designation, department, gender, DOB, join date, monthly salary.
• Review onboarding documents uploaded by teachers.
• Approve or reject individual documents with a note.
• Approve or reject a teacher's overall onboarding (which unlocks all features for that teacher).
• Download individual documents using the download button next to each doc.
• Download all documents of a teacher as a single ZIP file using "Download All".
• Download a per-teacher HR report (payroll + leave history) as Excel.
• Download a full payroll report for all visible teachers as Excel.
• Filter teachers by HR status: All / Pending / Approved / Rejected.
• View each teacher's complete leave history with paid/unpaid breakdown.
• See payroll stats per teacher: Monthly Salary, Unpaid Leave Days, Deduction, Net Payable.

TEACHER ONBOARDING FLOW (new teacher's journey):
1. Teacher registers → Admin approves the account.
2. Teacher logs in but sees the Upload Documents screen — all features are locked.
3. Teacher uploads required documents on /onboarding page:
   - Degree Certificate (REQUIRED)
   - Marksheet (REQUIRED)
   - Previous Salary Slip (optional)
   - Experience Letter (optional)
4. HR reviews documents in the HR Panel — can approve/reject each doc individually.
5. HR clicks "Approve & Unlock" — teacher's features are fully unlocked.
6. If rejected: teacher sees the rejection reason and a "Re-upload Documents" button.

DOCUMENT MANAGEMENT:
• Accepted formats: PDF, JPG, PNG, WEBP (max 10 MB per file).
• Teachers can re-upload rejected documents.
• Once a document is approved by HR, it cannot be re-uploaded (locked).
• HR can view documents in browser (signed URL, valid 60 seconds) or download them.
• "Download All" creates a ZIP file of all documents for that teacher.

PAYROLL IN HR PANEL:
• Deduction = (Monthly Salary ÷ 30) × Unpaid Leave Days (approved leaves only for the current year).
• Net Payable = Monthly Salary − Deduction.
• "Download Report" per teacher = Excel with Payroll sheet + Leave History sheet.
• "Download Full Report" = Excel covering all visible teachers' payroll summary.

HR FILTERS:
• Filter teachers by HR status (Pending / Approved / Rejected / All) using the tabs at the top.

═══════════════════════════════════════
LEAVE TYPES & QUOTAS
═══════════════════════════════════════
1. Casual Leave
   - 12 days per year, max 2 per month
   - Always paid, no document required
   - Approved by HOD (HOD has final say, no principal needed)

2. Medical Leave
   - 15 days per year
   - First 10 days are automatically paid
   - Days 11–15: principal decides paid or unpaid
   - ≤3 days: NO document required, HOD recommends → Principal gives final approval
   - >3 days: Medical Certificate required, HOD directly approves

3. Maternity Leave
   - Up to 90 days
   - Only available to female teachers

4. Bereavement Leave
   - Up to 5 days for loss of a close family member
   - No document required

5. Duty Leave
   - Up to 30 days per year
   - For official college duties (conferences, seminars, government work, etc.)
   - Proof of Duty document required
   - HOD has final approval

═══════════════════════════════════════
APPROVAL FLOW
═══════════════════════════════════════
Standard flow: Teacher applies → HOD reviews → HOD recommends → Principal gives final approval
HOD-final flow (Casual, Duty, Medical >3 days): Teacher applies → HOD approves directly

Status meanings:
• "Pending with HOD" — HOD hasn't reviewed yet
• "HOD Recommended" — HOD approved, waiting for Principal
• "Pending with Principal" — waiting for Principal's decision
• "Approved" — fully approved
• "Rejected" — denied (reason shown)

═══════════════════════════════════════
SANDWICH RULE
═══════════════════════════════════════
If a Sunday or holiday falls between two leave days, it is counted as a leave day. Leading/trailing Sundays or holidays are trimmed and not counted.

═══════════════════════════════════════
HALF-DAY LEAVE
═══════════════════════════════════════
Forenoon (morning) or Afternoon half-day counts as 0.5 days from your balance.

═══════════════════════════════════════
PROXY ASSIGNMENTS
═══════════════════════════════════════
When your leave is approved, another teacher may be assigned to cover your classes. You can accept or decline proxy requests from the Proxy Assignments page.

═══════════════════════════════════════
PAYROLL (TEACHER VIEW)
═══════════════════════════════════════
• Payroll page shows monthly salary and unpaid leave deductions.
• Salary calculated as monthly salary ÷ 30 per day.
• Casual leave is always paid.
• Filters available: month (prev/next arrows), year, leave type.
• Deductions only apply after both HOD and Principal fully approve.

═══════════════════════════════════════
REPORTS (ADMIN/PRINCIPAL)
═══════════════════════════════════════
• Admin Reports page has multiple modules: Teacher Report, Department Report, Leave History, Attendance Report, Payroll Report, Monthly Salary.
• Filters: Year, Department, Month, Leave Type, Status.
• Export as Excel or PDF.
• Principal sees department group tabs (Commerce & Arts vs Science & Technology).

═══════════════════════════════════════
DOCUMENTS
═══════════════════════════════════════
• Leave documents: Medical Certificate for Medical Leave, Proof of Duty for Duty Leave.
• Upload after leave is approved. Principal verifies. Can re-upload if rejected.
• Onboarding documents: Degree, Marksheet (required), Salary Slip, Experience Letter (optional) — uploaded on /onboarding, reviewed by HR.

═══════════════════════════════════════
SCHEDULE
═══════════════════════════════════════
• "My Schedule" shows weekly timetable. Also shows proxy duties and compensation lectures assigned to you.

═══════════════════════════════════════
NOTICES & HOLIDAYS
═══════════════════════════════════════
• HODs, Principals, Admins can post notices. All roles can view.
• Holidays are shown on the Holidays page and excluded from leave day counts.

═══════════════════════════════════════
PROFILE
═══════════════════════════════════════
• Update designation, DOB (day+month required, year optional), gender, photo.
• Gender determines Maternity Leave visibility.

═══════════════════════════════════════
DASHBOARD
═══════════════════════════════════════
• Shows leave balances (Casual + Medical paid quota + Unpaid this month).
• Shows upcoming and recent leaves.
• Principal: department-wise overview and pending request count.

═══════════════════════════════════════
COMMON QUESTIONS
═══════════════════════════════════════
Q: How do I unlock all features as a new teacher?
A: Upload your Degree Certificate and Marksheet on the /onboarding page. HR will review and approve your account.

Q: Can I still use the app while HR reviews my documents?
A: No — all features are locked until HR approves your onboarding. You can only access the document upload page.

Q: What happens if HR rejects my documents?
A: You'll see the rejection reason on your screen. Click "Re-upload Documents" to upload the correct file.

Q: Can I cancel a leave I already applied for?
A: You can cancel a pending leave. Contact your HOD if it's already approved.

Q: Why is my leave count more than expected?
A: The sandwich rule may have counted a Sunday or holiday between your leave dates.

Q: Why can't I see Maternity Leave?
A: It's only visible if your gender is set to Female in your profile.

Be conversational, helpful, and accurate. If someone asks about something not covered above, say you don't have that specific information and suggest they contact their HOD, Admin, or HR. And if someone asks who created you or this website or this app tell them Hamza Khan and Adarsh Pandey and praise then`;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  role: "user" | "assistant";
  content: string;
}

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "llama-3.1-8b-instant";

// ── API call ──────────────────────────────────────────────────────────────────
async function askGroq(messages: Message[], userContext: string): Promise<string> {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  if (!key) return "LeaveBot is not configured yet. Please ask your admin to add the VITE_GROQ_API_KEY to the environment.";

  const systemWithContext = userContext
    ? `${SYSTEM_PROMPT}\n\n═══════════════════════════════════════\nTHIS USER'S ACTUAL LIVE DATA (use this to answer personal questions — never make up numbers)\n═══════════════════════════════════════\n${userContext}\n\nIMPORTANT: Only quote numbers from the above live data. If the user asks about their specific counts/balances and you don't see it above, say "I don't have that detail right now — please check your Dashboard or My Leaves page."`
    : SYSTEM_PROMPT;

  const res = await fetch(GROQ_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemWithContext },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Groq error:", err);
    return "Sorry, I couldn't reach the server right now. Please try again in a moment.";
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "I didn't get a response. Please try again.";
}

// ── Suggested starter questions ───────────────────────────────────────────────
const TEACHER_STARTERS = [
  "How many casual leaves do I get per month?",
  "What is the sandwich rule?",
  "How do I apply for medical leave?",
  "What happens after I submit a leave request?",
  "Where is my next lecture today?",
];

const HR_STARTERS = [
  "How many teachers are pending HR approval?",
  "How do I approve a teacher's onboarding?",
  "What documents are required from new teachers?",
  "How do I download all documents of a teacher?",
  "How is the payroll deduction calculated?",
];

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2 items-start", isUser && "flex-row-reverse")}>
      <div className={cn(
        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      )}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn(
        "rounded-2xl px-3.5 py-2.5 text-sm max-w-[80%] leading-relaxed whitespace-pre-wrap",
        isUser
          ? "bg-primary text-primary-foreground rounded-tr-sm"
          : "bg-muted text-foreground rounded-tl-sm"
      )}>
        {msg.content}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function LeaveBot() {
  const { profile, role } = useAuth();
  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm LeaveBot — I can answer any question about the Leave Management System: leave types, approval flows, balances, proxy assignments, payroll, your schedule, and more.\n\nWhat would you like to know?",
    },
  ]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [userContext, setUserContext] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Fetch real leave + schedule data once when chat opens
  useEffect(() => {
    if (!open || !profile?.id || userContext) return;

    async function fetchContext() {
      const now      = new Date();
      const year     = now.getFullYear();
      const month    = now.getMonth() + 1;
      const monthStr = String(month).padStart(2, "0");
      const monthFirst   = `${year}-${monthStr}-01`;
      const monthLast    = new Date(year, month, 0);
      const monthLastISO = `${year}-${monthStr}-${String(monthLast.getDate()).padStart(2, "0")}`;

      // Current time details (IST-aware)
      const todayISO    = `${year}-${monthStr}-${String(now.getDate()).padStart(2, "0")}`;
      const dayOfWeek   = now.getDay(); // 0 = Sunday
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const DAY_NAMES   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const todayName   = DAY_NAMES[dayOfWeek];

      const [{ data: leaves }, { data: balances }, { data: lectures }, { data: holidays }, { data: proxies }, { data: compensations }] = await Promise.all([
        supabase
          .from("leave_requests")
          .select("leave_type, from_date, to_date, total_days, paid_days, unpaid_days, status")
          .eq("teacher_id", profile!.id)
          .gte("from_date", `${year}-01-01`)
          .order("from_date", { ascending: false }),
        supabase
          .from("leave_balances")
          .select("leave_type, used_days, remaining_days")
          .eq("teacher_id", profile!.id)
          .eq("year", year),
        supabase
          .from("lectures")
          .select("day_of_week, start_time, end_time, subject, class_name, room, lecture_date")
          .eq("teacher_id", profile!.id)
          .order("day_of_week")
          .order("start_time"),
        supabase
          .from("holidays")
          .select("holiday_date, occasion")
          .eq("holiday_date", todayISO),
        // Accepted proxy duties for today
        supabase
          .from("proxy_assignments")
          .select("proxy_date, start_time, end_time, subject, class_name, status")
          .eq("proxy_teacher_id", profile!.id)
          .eq("proxy_date", todayISO)
          .eq("status", "accepted"),
        // Accepted compensation lectures for today
        supabase
          .from("lectures")
          .select("start_time, end_time, subject, class_name, room, lecture_date")
          .eq("teacher_id", profile!.id)
          .eq("lecture_date", todayISO)
          .not("subject", "like", "__COMP_GIVEN__%"),
      ]);

      const APPROVED = ["approved", "hod_approved"];
      const PENDING  = ["pending_hod", "hod_recommended", "pending_principal"];

      // ── Leave summary ──────────────────────────────────────────────────────
      const summary: Record<string, { total: number; unpaid: number; pending: number; approved: number }> = {};
      for (const l of leaves ?? []) {
        const t = l.leave_type as string;
        if (!summary[t]) summary[t] = { total: 0, unpaid: 0, pending: 0, approved: 0 };
        const days = Number(l.total_days);
        summary[t].total += days;
        if (PENDING.includes(l.status))  summary[t].pending  += days;
        if (APPROVED.includes(l.status)) {
          summary[t].approved += days;
          summary[t].unpaid   += Number(l.unpaid_days);
        }
      }

      const thisMonthCasual = (leaves ?? [])
        .filter((l) => l.leave_type === "casual" && APPROVED.includes(l.status) && l.from_date <= monthLastISO && l.to_date >= monthFirst)
        .reduce((s, l) => {
          const cf = l.from_date < monthFirst   ? monthFirst   : l.from_date;
          const ct = l.to_date   > monthLastISO ? monthLastISO : l.to_date;
          const d1 = new Date(cf + "T00:00:00"), d2 = new Date(ct + "T00:00:00");
          const dim = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
          return s + Number(l.total_days) * Math.min(dim / Math.max(Number(l.total_days), 1), 1);
        }, 0);

      const thisMonthUnpaid = (leaves ?? [])
        .filter((l) => APPROVED.includes(l.status) && Number(l.unpaid_days) > 0 && l.from_date <= monthLastISO && l.to_date >= monthFirst)
        .reduce((s, l) => {
          const cf = l.from_date < monthFirst   ? monthFirst   : l.from_date;
          const ct = l.to_date   > monthLastISO ? monthLastISO : l.to_date;
          const d1 = new Date(cf + "T00:00:00"), d2 = new Date(ct + "T00:00:00");
          const dim = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
          return s + Number(l.unpaid_days) * Math.min(dim / Math.max(Number(l.total_days), 1), 1);
        }, 0);

      // ── Schedule ───────────────────────────────────────────────────────────
      const fmt = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        const suffix = h >= 12 ? "PM" : "AM";
        return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
      };

      const allLectures = lectures ?? [];
      const recurring   = allLectures.filter((l) => !l.lecture_date);
      const todayOneOff = allLectures.filter((l) => l.lecture_date === todayISO);

      // Proxy duties accepted for today
      const proxyToday = (proxies ?? []).map((p) => ({
        start_time: p.start_time,
        end_time:   p.end_time,
        subject:    p.subject,
        class_name: p.class_name,
        room:       null as string | null,
        isProxy:    true,
      }));

      // Compensation lectures received for today (one-off lectures added to this teacher)
      const compToday = (compensations ?? []).map((c) => ({
        start_time: c.start_time,
        end_time:   c.end_time,
        subject:    c.subject,
        class_name: c.class_name,
        room:       c.room as string | null,
        isComp:     true,
      }));

      const todayAll = [
        ...recurring.filter((l) => l.day_of_week === dayOfWeek),
        ...todayOneOff,
        ...proxyToday,
        ...compToday,
      ].sort((a, b) => a.start_time.localeCompare(b.start_time));

      // Check if today is a Sunday
      const isSunday = dayOfWeek === 0;

      // Check if today is a public/college holiday
      const todayHoliday = (holidays ?? [])[0] ?? null;

      // Check if teacher is on approved leave today
      const todayLeave = (leaves ?? []).find((l) =>
        APPROVED.includes(l.status) &&
        l.from_date <= todayISO &&
        l.to_date   >= todayISO,
      );

      // Current / next lecture (only relevant if not on leave/holiday/Sunday)
      const currentLecture = todayAll.find((l) => currentTime >= l.start_time && currentTime <= l.end_time);
      const nextLecture    = todayAll.find((l) => l.start_time > currentTime);

      // ── Build context ──────────────────────────────────────────────────────
      const QUOTA: Record<string, number> = {
        casual: 12, medical: 15, duty: 30, bereavement: 5, maternity: 90,
      };

      const lines: string[] = [
        `Teacher name: ${profile!.full_name}`,
        `Role: ${role}`,
        `Department: ${profile!.department_name ?? "Not set"}`,
        "",
        `CURRENT DATE & TIME:`,
        `• Date: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${todayISO})`,
        `• Time: ${fmt(currentTime)} (${currentTime} 24h)`,
        `• Day: ${todayName}`,
        "",
        `TODAY'S STATUS:`,
      ];

      if (isSunday) {
        lines.push("• Today is SUNDAY — weekly off. No lectures.");
        lines.push("• Do NOT show any schedule details for today.");
      } else if (todayHoliday) {
        lines.push(`• Today is a HOLIDAY: "${todayHoliday.occasion}". No lectures.`);
        lines.push("• Do NOT show any schedule details for today.");
      } else if (todayLeave) {
        const leaveLabel = leaveTypeLabel(todayLeave.leave_type as LeaveType);
        const leaveStatus = todayLeave.status.replace(/_/g, " ");
        lines.push(`• Teacher is ON APPROVED LEAVE today (${leaveLabel} — ${leaveStatus}, from ${todayLeave.from_date} to ${todayLeave.to_date}).`);
        lines.push("• Do NOT show schedule details. Instead tell them they are on leave today.");
      } else {
        lines.push("• Regular working day — teacher is present.");
        lines.push("", `TODAY'S SCHEDULE (${todayName}):`);

        if (todayAll.length === 0) {
          lines.push("• No lectures scheduled today.");
        } else {
          for (const l of todayAll) {
            const room = (l as any).room ? ` · Room: ${(l as any).room}` : "";
            const tag  = (l as any).isProxy ? " [PROXY DUTY]"
                       : (l as any).isComp  ? " [COMPENSATION LECTURE]"
                       : (l as any).lecture_date ? " [one-off]"
                       : "";
            lines.push(`• ${fmt(l.start_time)}–${fmt(l.end_time)} — ${l.subject} · ${l.class_name}${room}${tag}`);
          }
        }

        if (currentLecture) {
          const curRoom = (currentLecture as any).room ? ` · Room ${(currentLecture as any).room}` : "";
          const curTag  = (currentLecture as any).isProxy ? " (proxy duty)" : (currentLecture as any).isComp ? " (compensation)" : "";
          lines.push(
            "",
            `CURRENT LECTURE RIGHT NOW:`,
            `• ${currentLecture.subject} for ${currentLecture.class_name} — ${fmt(currentLecture.start_time)} to ${fmt(currentLecture.end_time)}${curRoom}${curTag}`,
          );
        } else {
          lines.push(``, `No lecture happening right now (time: ${fmt(currentTime)}).`);
        }

        if (nextLecture) {
          const nextRoom = (nextLecture as any).room ? ` · Room ${(nextLecture as any).room}` : "";
          const nextTag  = (nextLecture as any).isProxy ? " (proxy duty)" : (nextLecture as any).isComp ? " (compensation)" : "";
          lines.push(`NEXT LECTURE TODAY: ${nextLecture.subject} · ${nextLecture.class_name} at ${fmt(nextLecture.start_time)}${nextRoom}${nextTag}`);
        } else {
          lines.push(`No more lectures today after ${fmt(currentTime)}.`);
        }
      }

      // Full weekly timetable
      lines.push("", "FULL WEEKLY TIMETABLE (recurring):");
      const byDay: Record<number, typeof recurring> = {};
      for (const l of recurring) {
        if (!byDay[l.day_of_week]) byDay[l.day_of_week] = [];
        byDay[l.day_of_week].push(l);
      }
      if (Object.keys(byDay).length === 0) {
        lines.push("• No recurring lectures set up yet.");
      } else {
        for (const dow of [1,2,3,4,5,6,0]) {
          const dayLectures = byDay[dow];
          if (!dayLectures || dayLectures.length === 0) continue;
          lines.push(`${DAY_NAMES[dow]}:`);
          for (const l of dayLectures.sort((a,b) => a.start_time.localeCompare(b.start_time))) {
            const room = l.room ? ` · Room ${l.room}` : "";
            lines.push(`  • ${fmt(l.start_time)}–${fmt(l.end_time)} — ${l.subject} · ${l.class_name}${room}`);
          }
        }
      }

      // Leave balances
      lines.push("", `LEAVE USAGE THIS YEAR (${year}):`);
      for (const [type, s] of Object.entries(summary)) {
        const label = leaveTypeLabel(type as LeaveType);
        const quota = QUOTA[type] ?? "?";
        lines.push(`• ${label}: ${s.approved} approved days, ${s.pending} pending — quota: ${quota}/year`);
        if (s.unpaid > 0) lines.push(`  - Unpaid: ${s.unpaid} days`);
      }

      if (balances && balances.length > 0) {
        lines.push("", "REMAINING BALANCES:");
        for (const b of balances) {
          lines.push(`• ${leaveTypeLabel(b.leave_type as LeaveType)}: ${b.remaining_days} remaining (${b.used_days} used)`);
        }
      } else {
        lines.push("", "ESTIMATED REMAINING:");
        for (const [type, quota] of Object.entries(QUOTA)) {
          const used = summary[type]?.approved ?? 0;
          lines.push(`• ${leaveTypeLabel(type as LeaveType)}: ${quota - used} remaining (${used} used of ${quota})`);
        }
      }

      lines.push(
        "", `THIS MONTH (${now.toLocaleString("en-GB", { month: "long" })} ${year}):`,
        `• Casual leave used: ${Math.round(thisMonthCasual * 2) / 2} of 2 days`,
        `• Unpaid days: ${Math.round(thisMonthUnpaid * 2) / 2}`,
      );

      const recent = (leaves ?? []).slice(0, 5);
      if (recent.length > 0) {
        lines.push("", "RECENT LEAVE REQUESTS:");
        for (const l of recent) {
          lines.push(`• ${leaveTypeLabel(l.leave_type as LeaveType)} ${l.from_date}→${l.to_date} — ${l.total_days}d — ${l.status.replace(/_/g, " ")}${Number(l.unpaid_days) > 0 && APPROVED.includes(l.status) ? ` (${l.unpaid_days} unpaid)` : ""}`);
        }
      } else {
        lines.push("", "No leave requests this year.");
      }

      // ── HR-specific live context ─────────────────────────────────────────
      if (role === "hr" || role === "admin") {
        const { data: hrProfiles } = await supabase
          .from("profiles")
          .select("id, full_name, hr_approved, monthly_salary, approved")
          .eq("approved", true);

        const { data: hrRoles } = await supabase.from("user_roles").select("user_id, role");
        const roleMap: Record<string, string> = {};
        for (const r of hrRoles ?? []) roleMap[r.user_id] = r.role;

        const EXCLUDED = ["admin", "principal", "hr"];
        const teacherOnly = (hrProfiles ?? []).filter(
          (p) => !EXCLUDED.includes(roleMap[p.id] ?? "") && p.id !== profile!.id,
        );

        const pendingHR   = teacherOnly.filter((t) => (t as any).hr_approved === null).length;
        const approvedHR  = teacherOnly.filter((t) => (t as any).hr_approved === true).length;
        const rejectedHR  = teacherOnly.filter((t) => (t as any).hr_approved === false).length;
        const totalPayroll = teacherOnly.reduce((s, t) => s + Number(t.monthly_salary ?? 0), 0);

        lines.push(
          "", "YOUR HR PANEL LIVE STATS:",
          `• Total teaching staff in system: ${teacherOnly.length}`,
          `• Pending HR approval: ${pendingHR}`,
          `• HR approved (features unlocked): ${approvedHR}`,
          `• HR rejected (re-upload required): ${rejectedHR}`,
          `• Total monthly payroll (all teaching staff): ₹${totalPayroll.toLocaleString("en-IN")}`,
          "",
          "Use the HR Panel (/hr) to review documents, approve/reject teachers, and download reports.",
        );
      }

      setUserContext(lines.join("\n"));
    }

    fetchContext();
  }, [open, profile?.id, userContext]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // Focus input when chat opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    const userMsg: Message = { role: "user", content: question };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const answer = await askGroq(next, userContext);
      setMessages([...next, { role: "assistant", content: answer }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* ── Chat window ── */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[350px] sm:w-[400px] flex flex-col shadow-2xl rounded-2xl border border-border bg-background overflow-hidden"
          style={{ height: "520px" }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-primary text-primary-foreground flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">LeaveBot</p>
              <p className="text-xs opacity-75">Ask me anything about this system</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="opacity-75 hover:opacity-100 transition-opacity"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.map((m, i) => <Bubble key={i} msg={m} />)}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-2 items-start">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center mt-0.5 flex-shrink-0">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Starter suggestions — only shown when no user messages yet */}
          {messages.length === 1 && !loading && (
            <div className="px-4 pb-2 flex gap-2 flex-wrap flex-shrink-0">
              {(role === "hr" || role === "admin" ? HR_STARTERS : TEACHER_STARTERS).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-center gap-2 px-3 py-3 border-t border-border flex-shrink-0">
            <input
              ref={inputRef}
              className="flex-1 bg-muted rounded-full px-4 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
              placeholder="Ask a question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors flex-shrink-0"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Floating button ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200",
          open ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:scale-105"
        )}
        aria-label="Open LeaveBot"
      >
        {open
          ? <X className="w-6 h-6" />
          : <MessageCircle className="w-6 h-6" />
        }
      </button>
    </>
  );
}
