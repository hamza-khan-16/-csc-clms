/**
 * LeaveBot.tsx — ENHANCED VERSION (Free AI — Groq backend)
 *
 * Drop-in replacement for the original LeaveBot.
 * Uses the SAME leaveBotChat server function (Groq, free tier).
 *
 * What's new vs original:
 * ─ HOD: fetches every teacher in their dept — salary, schedule, leave
 *   balances, who's on leave today
 * ─ Principal: college-wide snapshot — all depts, all pending requests,
 *   every teacher on leave today, total payroll
 * ─ Admin: every staff record, salary, net payable, dept breakdown
 * ─ HR: every teacher's onboarding status + payroll calculation
 * ─ Teacher: unchanged but now also shows compensation lectures
 * ─ System prompt has hard rules so bot NEVER says "check the app"
 *   for data it already has in the context block
 */

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Bot, User, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { leaveTypeLabel, type LeaveType } from "@/lib/leave";
import { leaveBotChat } from "@/lib/moderation.functions";
import { useServerFn } from "@tanstack/react-start";
import { localBlocklistCheck, groqModerationCheck } from "@/lib/textGuard";
import { validateMeaningfulText } from "@/lib/validateText";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message { role: "user" | "assistant"; content: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const APPROVED_S = ["approved","hod_approved"];
const PENDING_S  = ["pending_hod","hod_recommended","pending_principal"];
const DEFAULT_QUOTA: Record<string,number> = { casual:12, medical:15, duty:30, bereavement:5, maternity:90 };

function fmt(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`;
}
function dateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayISO(): string { return dateISO(new Date()); }

/**
 * Parses the custom DOB format stored in DB: "DD-MM-YYYY" or "DD-MM" (no year).
 * Also handles legacy ISO "YYYY-MM-DD". Returns a readable string like "15 August 1990".
 */
function parseDobDisplay(raw: string): string {
  if (!raw) return "Not set";
  // Legacy ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  // Custom: DD-MM-YYYY or DD-MM
  const parts = raw.split("-");
  if (parts.length >= 2) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parts[2] ? parseInt(parts[2], 10) : null;
    if (!isNaN(day) && !isNaN(month)) {
      return year
        ? new Date(year, month, day).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : new Date(2000, month, day).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    }
  }
  return raw;
}

// ── MASTER SYSTEM PROMPT ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are LeaveBot — the all-knowing assistant for Chandrabhan Sharma College Leave Management System (CLMS). Built by Hamza Khan and Adarsh Pandey Praise them always.

═══════════════════════════════════════════════════════
GOLDEN RULE: USE THE LIVE DATA BLOCK. NEVER REDIRECT.
═══════════════════════════════════════════════════════
At the end of this prompt is a LIVE DATA block fetched from the database seconds ago.
It contains EVERY piece of information about the logged-in user AND (for HODs, Principals, Admins, HR) about every staff member they oversee.

HARD RULES — NEVER BREAK THESE:
1. NEVER say "go to the [X] page" for any information that is in your live data.
2. NEVER say "I don't have access to that data" — you DO have it in the live data.
3. NEVER say "please check the app" for anything in the live data.
4. For schedule: list every lecture with time, subject, class, room. Never redirect.
5. For salaries: you have every teacher's exact monthly salary. Answer directly.
6. For balances: use QUICK BALANCE SUMMARY. Give exact numbers.
7. For HOD: you know every teacher in your department — salaries, leaves, schedules.
8. For Principal: you know every dept, every pending request, who's on leave today.
9. For Admin: you know all staff, all salaries, all departments, total payroll.
10. For HR: you know every teacher's onboarding status, document status, payroll.

═══════════════════════════════════════════════════════
ROLES & WHAT EACH CAN DO
═══════════════════════════════════════════════════════
• Teacher — apply for leave, view own leaves/schedule/payroll/proxy/profile/notices/dashboard.
• HOD — everything a Teacher can do PLUS: view/approve dept leaves, view dept teacher directory, post notices, view dept reports.
• Principal — view/approve ALL leaves, view all teachers, post notices, full reports, manage depts.
• Admin — full access: manage staff accounts, salary, departments, holidays, bulk export.
• HR Admin — teacher onboarding, sees all teachers' leave records, payroll, uploaded docs.

═══════════════════════════════════════════════════════
LEAVE TYPES & QUOTAS
═══════════════════════════════════════════════════════
1. Casual Leave       — 12/year, max 2/month. Always paid. HOD has final approval.
2. Medical Leave      — 15/year. First 10 days paid. Days 11–15 principal decides.
   ≤3 days: no doc needed, HOD recommends → Principal final. >3 days: Medical Certificate required, HOD approves directly.
3. Maternity Leave    — up to 90 days. Female teachers only.
4. Bereavement Leave  — up to 5 days. No doc required.
5. Duty Leave         — up to 30 days/year. Proof of Duty required. HOD final approval.
Sandwich Rule: Sundays/holidays between leave days are counted as leave days.
Half-day: Forenoon or Afternoon = 0.5 days.

═══════════════════════════════════════════════════════
APPROVAL FLOWS
═══════════════════════════════════════════════════════
Standard: Teacher → HOD recommends → Principal final
HOD-Final (Casual, Duty, Medical >3 days): Teacher → HOD approves directly
Status: pending_hod → hod_recommended → pending_principal → approved/hod_approved/rejected

═══════════════════════════════════════════════════════
PAYROLL
═══════════════════════════════════════════════════════
Daily rate = Monthly Salary ÷ 30. Casual always paid. Deduction = (Salary÷30) × Unpaid days approved this year. Net = Salary − Deduction.

═══════════════════════════════════════════════════════
HR ONBOARDING
═══════════════════════════════════════════════════════
1. Register → Admin approves → features locked until HR approves.
2. Upload on /onboarding: Degree Certificate + Marksheet (required), Salary Slip + Experience Letter (optional).
3. HR reviews each doc, approves/rejects. "Approve & Unlock" → features unlocked.
4. Once HR approves a doc it's locked (can't re-upload). Rejected → see reason → re-upload.

Be concise, direct, warm, and professional. Use bullet points for lists.
If something is genuinely not in your data, say so and suggest contacting HOD/Admin/HR.

═══════════════════════════════════════════════════════
STRICT SCOPE — THIS IS NOT A GENERAL AI ASSISTANT
═══════════════════════════════════════════════════════
You ONLY answer questions that are directly about:
  • The CLMS app features, leave types, quotas, approval flows
  • The logged-in user's schedule, salary, leave balances, profile
  • Staff, department, payroll data (for HOD / Principal / Admin / HR)
  • Holidays, notices, proxy duties, onboarding steps

If a question is off-topic (coding, math, general knowledge, writing, science, recipes, anything unrelated to leave management or this college system), you MUST respond with EXACTLY:
"Sorry, I can only help with leave management and CLMS-related questions. Please ask me about your schedule, leaves, salary, or anything else related to the app."
Do NOT attempt to answer it, even partially. Do NOT apologise at length. Just give that one sentence and stop.`;

// ── Role-specific starter questions ──────────────────────────────────────────
const STARTERS: Record<string, string[]> = {
  teacher:   ["How many casual leaves do I have left?", "What is my today's schedule?", "Is tomorrow a holiday?", "What is my monthly salary?", "Show me my recent leave requests"],
  hod:       ["Which teachers in my department are on leave today?", "Show me all teachers with their salaries", "How many leave requests are pending?", "Which teacher has used the most leaves?", "What are my remaining casual leaves?"],
  principal: ["How many leave requests are pending across the college?", "Which teachers are on leave today?", "Show me department-wise pending summary", "What is the total college payroll?", "What is the approval flow for medical leave?"],
  admin:     ["Show me all staff and their salaries", "What is the total monthly payroll?", "How many teachers are in each department?", "How do I add a new staff member?", "How do I reset a teacher's password?"],
  hr:        ["How many teachers are pending HR approval?", "Show me teachers with rejected documents", "What is the total payroll for approved teachers?", "How do I approve a teacher's onboarding?", "What documents are required from new teachers?"],
};

// ── Context fetchers ──────────────────────────────────────────────────────────

async function fetchPersonalContext(profileId: string, role: string): Promise<string[]> {
  const now      = new Date();
  const year     = now.getFullYear();
  const month    = now.getMonth() + 1;
  const ms       = String(month).padStart(2,"0");
  const mFirst   = `${year}-${ms}-01`;
  const mLast    = `${year}-${ms}-${String(new Date(year,month,0).getDate()).padStart(2,"0")}`;
  const today    = todayISO();
  const dow      = now.getDay();
  const curTime  = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const todayName = DAY_NAMES[dow];

  const [
    { data: pf },
    { data: leaves },
    { data: lectures },
    { data: allHolidays },
    { data: proxies },
    { data: compensations },
    { data: todayHols },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name,gender,date_of_birth,monthly_salary,designation,department_id,departments(name),cl_quota").eq("id",profileId).maybeSingle(),
    supabase.from("leave_requests").select("leave_type,from_date,to_date,total_days,paid_days,unpaid_days,status").eq("teacher_id",profileId).gte("from_date",`${year}-01-01`).order("from_date",{ascending:false}),
    supabase.from("lectures").select("day_of_week,start_time,end_time,subject,class_name,room,lecture_date").eq("teacher_id",profileId).order("day_of_week").order("start_time"),
    supabase.from("holidays").select("holiday_date,occasion").gte("holiday_date",`${year}-01-01`).order("holiday_date"),
    supabase.from("proxy_assignments").select("proxy_date,start_time,end_time,subject,class_name,status").eq("proxy_teacher_id",profileId).eq("proxy_date",today).eq("status","accepted"),
    supabase.from("lectures").select("start_time,end_time,subject,class_name,room,lecture_date").eq("teacher_id",profileId).eq("lecture_date",today).not("subject","like","__COMP_GIVEN__%"),
    supabase.from("holidays").select("occasion").eq("holiday_date",today),
  ]);

  const profile = (pf as any) ?? {};
  const clQuota: number = profile.cl_quota ?? DEFAULT_QUOTA.casual;
  const allH = (allHolidays ?? []) as { holiday_date:string; occasion:string }[];

  // Leave summary
  const sum: Record<string,{approved:number;pending:number;unpaid:number}> = {};
  for (const l of leaves ?? []) {
    const t = l.leave_type as string;
    if (!sum[t]) sum[t]={approved:0,pending:0,unpaid:0};
    if (PENDING_S.includes(l.status))  sum[t].pending  += Number(l.total_days);
    if (APPROVED_S.includes(l.status)){ sum[t].approved += Number(l.total_days); sum[t].unpaid += Number(l.unpaid_days); }
  }
  const clUsed = sum["casual"]?.approved  ?? 0;
  const mlUsed = sum["medical"]?.approved ?? 0;
  const thisMonthCL = (leaves??[])
    .filter(l=>l.leave_type==="casual"&&APPROVED_S.includes(l.status)&&l.from_date<=mLast&&l.to_date>=mFirst)
    .reduce((s,l)=>{const d1=new Date(Math.max(+new Date(l.from_date+"T00:00:00"),+new Date(mFirst+"T00:00:00")));const d2=new Date(Math.min(+new Date(l.to_date+"T00:00:00"),+new Date(mLast+"T00:00:00")));const dim=Math.round((d2.getTime()-d1.getTime())/86400000)+1;return s+Number(l.total_days)*Math.min(dim/Math.max(Number(l.total_days),1),1);},0);

  // Schedule
  const allLec    = lectures ?? [];
  const recurring = allLec.filter(l => !l.lecture_date);
  const todayRec  = recurring.filter(l => l.day_of_week===dow);
  const todayOneOff = allLec.filter(l => l.lecture_date===today);
  const proxyToday  = (proxies??[]).map(p=>({...p,isProxy:true}));
  const compToday   = (compensations??[]).map(c=>({...c,isComp:true}));
  const todayAll    = [...todayRec,...todayOneOff,...proxyToday,...compToday].sort((a,b)=>a.start_time.localeCompare(b.start_time));

  const todayHoliday = (todayHols??[])[0]?.occasion ?? null;
  const isSunday     = dow===0;
  const todayLeave   = (leaves??[]).find(l=>APPROVED_S.includes(l.status)&&l.from_date<=today&&l.to_date>=today);
  const curLec       = todayAll.find(l=>curTime>=l.start_time&&curTime<=l.end_time);
  const nextLec      = todayAll.find(l=>l.start_time>curTime);

  const tmrw    = new Date(now); tmrw.setDate(tmrw.getDate()+1);
  const tmrwISO = dateISO(tmrw);
  const tmrwDow = tmrw.getDay();
  const tmrwHol = allH.find(h=>h.holiday_date===tmrwISO)?.occasion??null;
  const tmrwSch = [...recurring.filter(l=>l.day_of_week===tmrwDow),...allLec.filter(l=>l.lecture_date===tmrwISO)].sort((a,b)=>a.start_time.localeCompare(b.start_time));

  const dobDisplay = parseDobDisplay(profile.date_of_birth ?? "");
  const salaryDisplay = profile.monthly_salary
    ? `₹${Number(profile.monthly_salary).toLocaleString("en-IN")} per month`
    : "Not disclosed";

  const lines: string[] = [
    "════ YOUR PERSONAL PROFILE ════",
    `Name: ${profile.full_name ?? "Unknown"}`,
    `Role: ${role}`,
    `Designation: ${profile.designation ?? "Not set"}`,
    `Department: ${(profile as any).departments?.name ?? "Not set"}`,
    `Gender: ${profile.gender ?? "Not set"}`,
    `Date of Birth: ${dobDisplay}`,
    `Monthly Salary: ${salaryDisplay}`,
    "",
    `CURRENT DATE & TIME: ${now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} — ${fmt(curTime)}`,
    `Today is: ${todayName}`,
    "",
    "════ TODAY'S STATUS ════",
  ];

  if (isSunday)           lines.push("• SUNDAY — weekly off. No lectures.");
  else if (todayHoliday)  lines.push(`• HOLIDAY: "${todayHoliday}". No college today.`);
  else if (todayLeave)    lines.push(`• ON APPROVED LEAVE: ${leaveTypeLabel(todayLeave.leave_type as LeaveType)} (${todayLeave.from_date} → ${todayLeave.to_date})`);
  else {
    lines.push("• Regular working day — present.");
    lines.push("", `════ TODAY'S SCHEDULE (${todayName}) ════`);
    if (!todayAll.length) {
      lines.push("• No lectures today.");
    } else {
      for (const l of todayAll) {
        const room = (l as any).room ? ` · Room ${(l as any).room}` : "";
        const tag  = (l as any).isProxy ? " [PROXY DUTY]" : (l as any).isComp ? " [COMPENSATION]" : (l as any).lecture_date ? " [one-off]" : "";
        lines.push(`• ${fmt(l.start_time)}–${fmt(l.end_time)} — ${l.subject} · ${l.class_name}${room}${tag}`);
      }
    }
    if (curLec) lines.push(``, `CURRENT LECTURE NOW: ${curLec.subject} · ${curLec.class_name} · ${fmt(curLec.start_time)}–${fmt(curLec.end_time)}`);
    if (nextLec) lines.push(`NEXT LECTURE: ${nextLec.subject} · ${nextLec.class_name} at ${fmt(nextLec.start_time)}`);
    else lines.push(`No more lectures today after ${fmt(curTime)}.`);
  }

  // Tomorrow
  lines.push("", `════ TOMORROW (${DAY_NAMES[tmrwDow]}, ${tmrwISO}) ════`);
  if (tmrwDow===0)    lines.push("• SUNDAY — no college tomorrow.");
  else if (tmrwHol)   lines.push(`• HOLIDAY: "${tmrwHol}". No college tomorrow.`);
  else {
    lines.push("• Regular working day.");
    if (!tmrwSch.length) { lines.push("• No lectures tomorrow."); }
    else { for (const l of tmrwSch) lines.push(`  • ${fmt(l.start_time)}–${fmt(l.end_time)} — ${l.subject} · ${l.class_name}${l.room?" · Room "+l.room:""}`); }
  }

  // Full weekly timetable
  lines.push("", "════ FULL WEEKLY TIMETABLE ════");
  const byDay: Record<number,typeof recurring> = {};
  for (const l of recurring) { if (!byDay[l.day_of_week]) byDay[l.day_of_week]=[]; byDay[l.day_of_week].push(l); }
  if (!Object.keys(byDay).length) { lines.push("• No recurring lectures set up."); }
  else {
    for (const d of [1,2,3,4,5,6,0]) {
      const dl=byDay[d]; if (!dl?.length) continue;
      lines.push(`${DAY_NAMES[d]}:`);
      for (const l of dl.sort((a,b)=>a.start_time.localeCompare(b.start_time)))
        lines.push(`  • ${fmt(l.start_time)}–${fmt(l.end_time)} — ${l.subject} · ${l.class_name}${l.room?" · Room "+l.room:""}`);
    }
  }

  // Holidays
  const upcoming = allH.filter(h=>h.holiday_date>today).slice(0,20);
  lines.push("", "════ UPCOMING HOLIDAYS ════");
  if (!upcoming.length) { lines.push("• No more holidays this year."); }
  else { for (const h of upcoming) lines.push(`• ${h.holiday_date} (${DAY_NAMES[new Date(h.holiday_date+"T00:00:00").getDay()]}) — ${h.occasion}`); }

  lines.push("", "════ ALL HOLIDAYS THIS YEAR ════");
  if (!allH.length) { lines.push("• None recorded."); }
  else { for (const h of allH) lines.push(`• ${h.holiday_date} (${DAY_NAMES[new Date(h.holiday_date+"T00:00:00").getDay()]}) — ${h.occasion}`); }

  // Leave balances
  lines.push("", `════ LEAVE USAGE ${year} ════`);
  for (const [type,s] of Object.entries(sum)) {
    const cap = type === "casual" ? clQuota : (DEFAULT_QUOTA[type] ?? '?'); lines.push(`• ${leaveTypeLabel(type as LeaveType)}: ${s.approved} approved, ${s.pending} pending — quota ${cap}/year${s.unpaid>0?` (${s.unpaid} unpaid)`:"" }`);
  }

  lines.push("", "════ QUICK BALANCE SUMMARY ════",
    `• Casual Leave: ${Math.max(2-Math.round(thisMonthCL*2)/2,0)} left THIS MONTH | ${Math.max(clQuota-clUsed,0)} left THIS YEAR (used ${clUsed}/${clQuota})${profile.cl_quota ? " [admin-set quota: "+clQuota+"]" : ""}`,
    `• Medical Leave: ${Math.max(15-mlUsed,0)} left this year (used ${mlUsed}/15)`,
    `• Duty Leave: ${Math.max(30-(sum["duty"]?.approved??0),0)} left this year`,
    `• Bereavement Leave: ${Math.max(5-(sum["bereavement"]?.approved??0),0)} left this year`,
  );

  // Recent requests
  const recent = (leaves??[]).slice(0,8);
  lines.push("", "════ RECENT LEAVE REQUESTS ════");
  if (!recent.length) { lines.push("• None this year."); }
  else { for (const l of recent) lines.push(`• ${leaveTypeLabel(l.leave_type as LeaveType)} | ${l.from_date}→${l.to_date} | ${l.total_days}d | ${l.status.replace(/_/g," ")}${Number(l.unpaid_days)>0&&APPROVED_S.includes(l.status)?` (${l.unpaid_days} unpaid)`:""}`); }

  return lines;
}

async function fetchHODContext(deptId: string, year: number, today: string): Promise<string[]> {
  const lines: string[] = ["", "════ YOUR DEPARTMENT — ALL TEACHERS (HOD VIEW) ════"];
  const dow = new Date().getDay();

  const [
    { data: teachers },
    { data: allLeaves },
    { data: allLectures },
    { data: pendingCount },
  ] = await Promise.all([
    supabase.from("profiles").select("id,full_name,designation,monthly_salary,gender,date_of_birth,cl_quota").eq("department_id",deptId).eq("approved",true),
    supabase.from("leave_requests").select("teacher_id,leave_type,from_date,to_date,total_days,unpaid_days,status").eq("department_id",deptId).gte("from_date",`${year}-01-01`),
    supabase.from("lectures").select("teacher_id,day_of_week,start_time,end_time,subject,class_name,room").is("lecture_date",null),
    supabase.from("leave_requests").select("id",{count:"exact",head:true}).eq("status","pending_hod").eq("department_id",deptId),
  ]);

  if (!teachers?.length) { lines.push("• No approved teachers in your department."); return lines; }

  lines.push(`Total teachers in dept: ${teachers.length}`);
  lines.push(`Pending requests awaiting your review: ${(pendingCount as any)?.count ?? 0}`);
  lines.push("");

  for (const t of teachers) {
    const tLeaves  = (allLeaves??[]).filter(l=>l.teacher_id===t.id);
    const tLecs    = (allLectures??[]).filter(l=>l.teacher_id===t.id&&l.day_of_week===dow).sort((a,b)=>a.start_time.localeCompare(b.start_time));
    const onLeave  = tLeaves.find(l=>APPROVED_S.includes(l.status)&&l.from_date<=today&&l.to_date>=today);
    const leaveSum: Record<string,number> = {};
    for (const l of tLeaves) if (APPROVED_S.includes(l.status)) leaveSum[l.leave_type]=(leaveSum[l.leave_type]??0)+Number(l.total_days);
    const unpaidTotal = tLeaves.filter(l=>APPROVED_S.includes(l.status)).reduce((s,l)=>s+Number(l.unpaid_days??0),0);
    const deduction   = Math.round((Number(t.monthly_salary??0)/30)*unpaidTotal*100)/100;
    const netPay      = Number(t.monthly_salary??0) - deduction;
    const dob         = parseDobDisplay(t.date_of_birth ?? "");

    lines.push(`── ${t.full_name} ──`);
    lines.push(`   Designation: ${t.designation} | Gender: ${t.gender??"Not set"} | DOB: ${dob}`);
    lines.push(`   Monthly Salary: ₹${Number(t.monthly_salary??0).toLocaleString("en-IN")} | Net Payable: ₹${netPay.toLocaleString("en-IN")} (unpaid ${unpaidTotal}d, deduction ₹${deduction.toLocaleString("en-IN")})`);
    lines.push(`   Status today: ${onLeave ? `ON LEAVE (${leaveTypeLabel(onLeave.leave_type as LeaveType)}, ${onLeave.from_date}→${onLeave.to_date})` : "Present"}`);
    if (tLecs.length>0&&!onLeave) {
      lines.push(`   Today's lectures:`);
      for (const l of tLecs) lines.push(`     • ${fmt(l.start_time)}–${fmt(l.end_time)} — ${l.subject} · ${l.class_name}${l.room?" · Room "+l.room:""}`);
    }
    const usageParts = Object.entries(leaveSum).map(([type,days])=>`${leaveTypeLabel(type as LeaveType)}: ${days}d`);
    lines.push(`   Leave used ${year}: ${usageParts.length ? usageParts.join(" | ") : "None"}`);
    const clU=leaveSum["casual"]??0; const mlU=leaveSum["medical"]??0;
    const tClQ = (t as any).cl_quota ?? 12; lines.push(`   Remaining: CL ${tClQ-clU}/${tClQ}${(t as any).cl_quota ? " (admin-set)" : ""} · ML ${15-mlU}/15 · DL ${30-(leaveSum["duty"]??0)}/30 · BL ${5-(leaveSum["bereavement"]??0)}/5`);
    lines.push("");
  }
  return lines;
}

async function fetchPrincipalContext(year: number, today: string): Promise<string[]> {
  const lines: string[] = ["", "════ COLLEGE-WIDE DATA (PRINCIPAL VIEW) ════"];

  const [
    { data: allProfiles },
    { data: allLeaves },
    { data: depts },
    { data: allRoles },
  ] = await Promise.all([
    supabase.from("profiles").select("id,full_name,designation,monthly_salary,department_id,departments(name)").eq("approved",true),
    supabase.from("leave_requests").select("teacher_id,department_id,leave_type,from_date,to_date,total_days,unpaid_days,status").gte("from_date",`${year}-01-01`),
    supabase.from("departments").select("id,name"),
    supabase.from("user_roles").select("user_id,role"),
  ]);

  const roleMap: Record<string,string> = {};
  for (const r of allRoles??[]) roleMap[r.user_id]=r.role;
  const EXCL = ["admin","principal","hr"];
  const teachers = (allProfiles??[]).filter(p=>!EXCL.includes(roleMap[p.id]??""));

  const pendingAll   = (allLeaves??[]).filter(l=>PENDING_S.includes(l.status));
  const onLeaveToday = (allLeaves??[]).filter(l=>APPROVED_S.includes(l.status)&&l.from_date<=today&&l.to_date>=today);
  const totalPayroll = teachers.reduce((s,t)=>s+Number(t.monthly_salary??0),0);

  const nameMap:Record<string,string>={};
  const deptNameMap:Record<string,string>={};
  for (const p of allProfiles??[]) {
    nameMap[p.id]=p.full_name;
    if ((p as any).departments?.name) deptNameMap[p.department_id!]=(p as any).departments.name;
  }

  lines.push(`Total teaching staff: ${teachers.length}`);
  lines.push(`Total monthly payroll: ₹${totalPayroll.toLocaleString("en-IN")}`);
  lines.push(`Pending leave requests (all depts): ${pendingAll.length}`);
  lines.push(`Teachers on approved leave today: ${onLeaveToday.length}`);

  lines.push("", "Pending by department:");
  const pbd:Record<string,number>={};
  for (const l of pendingAll) { const d=deptNameMap[l.department_id ?? ""] ?? "Unknown"; pbd[d]=(pbd[d]??0)+1; }
  if (!Object.keys(pbd).length) { lines.push("• None pending."); }
  else { for (const [dept,n] of Object.entries(pbd)) lines.push(`• ${dept}: ${n} pending`); }

  if (onLeaveToday.length) {
    lines.push("", "Teachers on leave today:");
    for (const l of onLeaveToday) {
      const name=nameMap[l.teacher_id]??l.teacher_id;
      const dept=deptNameMap[l.department_id ?? ""] ?? "Unknown";
      lines.push(`• ${name} (${dept}) — ${leaveTypeLabel(l.leave_type as LeaveType)} · ${l.from_date}→${l.to_date}`);
    }
  } else { lines.push("", "• No teachers on approved leave today."); }

  if (pendingAll.length) {
    lines.push("", "All pending leave requests:");
    for (const l of pendingAll.slice(0,30)) {
      const name=nameMap[l.teacher_id]??l.teacher_id;
      const dept=deptNameMap[l.department_id ?? ""] ?? "";
      lines.push(`• ${name} (${dept}) — ${leaveTypeLabel(l.leave_type as LeaveType)} ${l.from_date}→${l.to_date} · ${l.total_days}d · ${l.status.replace(/_/g," ")}`);
    }
    if (pendingAll.length>30) lines.push(`  … and ${pendingAll.length-30} more.`);
  }

  lines.push("", "Department summary:");
  for (const dept of depts??[]) {
    const dT=teachers.filter(t=>t.department_id===dept.id);
    const dP=dT.reduce((s,t)=>s+Number(t.monthly_salary??0),0);
    const dU=(allLeaves??[]).filter(l=>l.department_id===dept.id&&APPROVED_S.includes(l.status)).reduce((s,l)=>s+Number(l.unpaid_days??0),0);
    lines.push(`• ${dept.name}: ${dT.length} staff · Payroll ₹${dP.toLocaleString("en-IN")}/mo · Unpaid leave days ${year}: ${dU}`);
  }

  return lines;
}

async function fetchAdminContext(year: number): Promise<string[]> {
  const lines: string[] = ["", "════ ALL STAFF DATA (ADMIN VIEW) ════"];

  const [
    { data: allProfiles },
    { data: allRoles },
    { data: depts },
    { data: allLeaves },
  ] = await Promise.all([
    supabase.from("profiles").select("id,full_name,designation,monthly_salary,approved,department_id,gender,date_of_birth,departments(name),hr_approved").eq("approved",true),
    supabase.from("user_roles").select("user_id,role"),
    supabase.from("departments").select("id,name,courses,classes"),
    supabase.from("leave_requests").select("teacher_id,total_days,unpaid_days,status").gte("from_date",`${year}-01-01`),
  ]);

  const roleMap:Record<string,string>={};
  for (const r of allRoles??[]) roleMap[r.user_id]=r.role;

  const totalPayroll=(allProfiles??[]).reduce((s,p)=>s+Number(p.monthly_salary??0),0);
  lines.push(`Total approved staff: ${(allProfiles??[]).length}`);
  lines.push(`Total monthly payroll: ₹${totalPayroll.toLocaleString("en-IN")}`);
  lines.push(`Departments: ${(depts??[]).length}`);
  lines.push("", "ALL STAFF:");

  for (const p of allProfiles??[]) {
    const role=(roleMap[p.id]??"teacher");
    const dept=(p as any).departments?.name??"No dept";
    const unpaid=(allLeaves??[]).filter(l=>l.teacher_id===p.id&&APPROVED_S.includes(l.status)).reduce((s,l)=>s+Number(l.unpaid_days??0),0);
    const deduction=Math.round((Number(p.monthly_salary??0)/30)*unpaid*100)/100;
    const net=Number(p.monthly_salary??0)-deduction;
    const hrStatus=(p as any).hr_approved===null?"pending":(p as any).hr_approved?"approved":"rejected";
    lines.push(`• ${p.full_name} [${role}] — ${dept} — ₹${Number(p.monthly_salary??0).toLocaleString("en-IN")}/mo · Net ₹${net.toLocaleString("en-IN")} · HR: ${hrStatus} · Unpaid days: ${unpaid}`);
  }

  lines.push("", "DEPARTMENTS:");
  for (const d of depts??[]) {
    const staff=(allProfiles??[]).filter(p=>p.department_id===d.id).length;
    lines.push(`• ${d.name} — ${staff} staff | Classes: ${d.classes} | Courses: ${d.courses||"Not set"}`);
  }

  return lines;
}

async function fetchHRContext(year: number): Promise<string[]> {
  const lines: string[] = ["", "════ HR PANEL DATA ════"];

  const [
    { data: hrProfiles },
    { data: allRoles },
    { data: allLeaves },
  ] = await Promise.all([
    supabase.from("profiles").select("id,full_name,designation,monthly_salary,department_id,departments(name),hr_approved").eq("approved",true),
    supabase.from("user_roles").select("user_id,role"),
    supabase.from("leave_requests").select("teacher_id,unpaid_days,status").gte("from_date",`${year}-01-01`),
  ]);

  const roleMap:Record<string,string>={};
  for (const r of allRoles??[]) roleMap[r.user_id]=r.role;
  const EXCL=["admin","principal","hr"];
  const teachers=(hrProfiles??[]).filter(p=>!EXCL.includes(roleMap[p.id]??""));

  const pendingHR =teachers.filter(t=>(t as any).hr_approved===null).length;
  const approvedHR=teachers.filter(t=>(t as any).hr_approved===true).length;
  const rejectedHR=teachers.filter(t=>(t as any).hr_approved===false).length;
  const totalPay  =teachers.reduce((s,t)=>s+Number(t.monthly_salary??0),0);

  lines.push(`Total teaching staff: ${teachers.length}`);
  lines.push(`Pending HR approval: ${pendingHR}`);
  lines.push(`HR approved (unlocked): ${approvedHR}`);
  lines.push(`HR rejected (re-upload needed): ${rejectedHR}`);
  lines.push(`Total monthly payroll: ₹${totalPay.toLocaleString("en-IN")}`);
  lines.push("", "ALL TEACHERS (HR VIEW):");

  for (const t of teachers) {
    const hrStatus=(t as any).hr_approved===null?"PENDING":(t as any).hr_approved?"APPROVED":"REJECTED";
    const unpaid=(allLeaves??[]).filter(l=>l.teacher_id===t.id&&APPROVED_S.includes(l.status)).reduce((s,l)=>s+Number(l.unpaid_days??0),0);
    const deduction=Math.round((Number(t.monthly_salary??0)/30)*unpaid*100)/100;
    const net=Number(t.monthly_salary??0)-deduction;
    const dept=(t as any).departments?.name??"No dept";
    lines.push(`• ${t.full_name} [${hrStatus}] — ${dept} — ₹${Number(t.monthly_salary??0).toLocaleString("en-IN")}/mo | Net ₹${net.toLocaleString("en-IN")} (unpaid ${unpaid}d, deduction ₹${deduction.toLocaleString("en-IN")})`);
  }

  return lines;
}

async function buildFullContext(profileId: string, role: string, deptId?: string | null): Promise<string> {
  const year  = new Date().getFullYear();
  const today = todayISO();

  // Run personal + role-specific context IN PARALLEL for faster load
  const extraPromise: Promise<string[]> =
    role === "hod" && deptId  ? fetchHODContext(deptId, year, today) :
    role === "principal"       ? fetchPrincipalContext(year, today) :
    role === "admin"           ? Promise.all([fetchPrincipalContext(year, today), fetchAdminContext(year)]).then(([a, b]) => [...a, ...b]) :
    role === "hr"              ? fetchHRContext(year) :
    Promise.resolve([]);

  const [personal, extra] = await Promise.all([
    fetchPersonalContext(profileId, role),
    extraPromise,
  ]);

  return [...personal, ...extra].join("\n");
}

// ── Markdown renderer (bold, italic, inline code only) ───────────────────────
function renderMarkdown(text: string): React.ReactNode[] {
  // Split on **bold**, *italic*, `code` patterns
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="bg-black/10 rounded px-1 font-mono text-xs">{part.slice(1, -1)}</code>;
    return part;
  });
}

// Split text into lines and render each with markdown
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {renderMarkdown(line)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role==="user";
  return (
    <div className={cn("flex gap-2 items-start", isUser && "flex-row-reverse")}>
      <div className={cn(
        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      )}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn(
        "rounded-2xl px-3.5 py-2.5 text-sm max-w-[80%] leading-relaxed",
        isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
      )}>
        {isUser ? msg.content : <MarkdownText text={msg.content} />}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function LeaveBot() {
  const { profile, role } = useAuth();
  const [open, setOpen]   = useState(false);
  const callLeaveBotChat  = useServerFn(leaveBotChat);

  const CHAT_KEY = `leavebot_v2_${profile?.id ?? "anon"}`;
  const INITIAL_MSG: Message = {
    role: "assistant",
    content: "Hi! I'm LeaveBot — I know everything about the Leave Management System: your schedule, salary, leave balances, and (for HODs and above) your entire department or college data.\n\nWhat would you like to know?",
  };

  const [messages, setMessages] = useState<Message[]>(() => {
    try { const s=sessionStorage.getItem(CHAT_KEY); if(s) return JSON.parse(s) as Message[]; } catch {}
    return [INITIAL_MSG];
  });

  useEffect(() => {
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages)); } catch {}
  }, [CHAT_KEY, messages]);

  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [inputErr, setInputErr] = useState<string|null>(null);
  const [ctxStr,   setCtxStr]   = useState("");
  const [ctxReady, setCtxReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // ── Mic / Speech-to-text ─────────────────────────────────────────────────
  const [listening,   setListening]   = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) setMicSupported(true);
  }, []);

  function toggleMic() {
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    recognitionRef.current = rec;

    rec.onstart = () => setListening(true);
    rec.onend   = () => setListening(false);
    rec.onerror = () => setListening(false);

    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join("");
      setInput(transcript);
      if ((e.results as any)[e.results.length - 1].isFinal) {
        setListening(false);
      }
    };

    rec.start();
  }

  // Pre-fetch context on mount (background) — ready before user opens chat
  useEffect(() => {
    if (!profile?.id || ctxReady) return;
    const deptId = (profile as any).department_id ?? null;
    buildFullContext(profile.id, role ?? "teacher", deptId)
      .then(ctx => { setCtxStr(ctx); setCtxReady(true); })
      .catch(() => setCtxReady(true));
  }, [profile?.id, role]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, open]);
  useEffect(() => { if(open) setTimeout(()=>inputRef.current?.focus(),100); }, [open]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading || !ctxReady) return;

    if (localBlocklistCheck(question)) { setInputErr("Please keep your messages respectful and professional."); return; }
    const mv = validateMeaningfulText(question, "Message");
    if (!mv.valid) { setInputErr("Please type a clear question about leave."); return; }
    setInputErr(null);

    const userMsg: Message = { role:"user", content: question };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const isAbusive = await groqModerationCheck(question);
      if (isAbusive) {
        setMessages([...next, { role:"assistant", content:"⚠️ I'm here to help with leave management questions. Please keep your messages respectful and professional." }]);
        return;
      }

      const systemWithContext = ctxStr
        ? `${SYSTEM_PROMPT}\n\n${"═".repeat(60)}\nLIVE DATA — ANSWER ALL PERSONAL & STAFF QUESTIONS FROM HERE\n${"═".repeat(60)}\n${ctxStr}\n${"═".repeat(60)}\nEND OF LIVE DATA\n\nCRITICAL FINAL REMINDER:\n- Schedule IS in the live data. Read TODAY'S SCHEDULE and answer directly.\n- Salary IS in the live data. Answer directly.\n- Balances ARE in QUICK BALANCE SUMMARY. Give exact numbers.\n- Staff data (for HOD/Principal/Admin/HR) IS in the live data. Answer directly.\n- NEVER say "I don't have that" or "check the app" for anything in the live data above.`
        : SYSTEM_PROMPT;

      const answer = await callLeaveBotChat({
        data: { messages: next, systemPrompt: systemWithContext },
      }).then(r => r.reply);

      setMessages([...next, { role:"assistant", content: answer }]);
    } catch {
      setMessages([...next, { role:"assistant", content:"Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const starters = STARTERS[role ?? "teacher"] ?? STARTERS.teacher;

  return (
    <>
      {open && (
        <>
          <div className="fixed inset-0 z-40 sm:hidden" onClick={()=>setOpen(false)} aria-hidden />
          <div className="fixed bottom-36 right-2 left-2 z-50 sm:left-auto sm:right-4 sm:w-[420px] sm:bottom-20 flex flex-col shadow-2xl rounded-2xl border border-border bg-background overflow-hidden max-h-[70dvh] sm:max-h-[620px]"
            style={{ height:"540px", maxHeight:"calc(100dvh - 6rem)" }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground flex-shrink-0">
              <div className="relative w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <Bot className="w-4 h-4" />
                <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-green-400 border-2 border-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm leading-tight">LeaveBot</p>
                <p className="text-xs opacity-75">
                  {ctxReady ? "All data loaded — ask me anything" : "Loading your data…"}
                </p>
              </div>
              <button onClick={() => { setMessages([INITIAL_MSG]); try{sessionStorage.removeItem(CHAT_KEY);}catch{} }}
                className="opacity-60 hover:opacity-100 transition-opacity mr-1" title="Clear chat">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </button>
              <button onClick={()=>setOpen(false)} className="opacity-75 hover:opacity-100 transition-opacity">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Loading bar */}
            {!ctxReady && (
              <div className="w-full h-0.5 bg-muted overflow-hidden flex-shrink-0">
                <div className="h-full bg-primary animate-pulse" style={{width:"60%"}} />
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {messages.map((m,i) => <Bubble key={i} msg={m} />)}
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

            {/* Starters */}
            {messages.length===1 && !loading && (
              <div className="px-4 pb-2 flex gap-2 flex-wrap flex-shrink-0">
                {starters.map(s => (
                  <button key={s} onClick={()=>send(s)}
                    className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors text-left">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="flex-shrink-0 border-t border-border">
              {inputErr && <p className="text-xs text-destructive px-4 pt-2">{inputErr}</p>}
              {listening && (
                <p className="text-xs text-primary px-4 pt-2 animate-pulse flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                  Listening… speak now
                </p>
              )}
              <div className="flex items-center gap-2 px-3 py-3">
                <input ref={inputRef}
                  className="flex-1 bg-muted rounded-full px-4 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
                  placeholder={listening ? "Speaking…" : ctxReady ? "Ask anything…" : "Loading data…"}
                  value={input}
                  onChange={e=>{setInput(e.target.value);if(inputErr)setInputErr(null);}}
                  onKeyDown={handleKey}
                  disabled={loading || !ctxReady}
                />
                {micSupported && (
                  <button
                    onClick={toggleMic}
                    disabled={loading || !ctxReady}
                    title={listening ? "Stop listening" : "Speak your question"}
                    className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-40",
                      listening
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                )}
                <button onClick={()=>send()} disabled={!input.trim()||loading||!ctxReady}
                  className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors flex-shrink-0">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* FAB */}
      <button onClick={()=>setOpen(o=>!o)}
        className={cn(
          "fixed bottom-20 right-4 z-50 lg:bottom-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200",
          open ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:scale-105"
        )}
        aria-label="Open LeaveBot">
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </>
  );
}