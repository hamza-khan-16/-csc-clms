import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { useEffect, useState, useRef } from "react";

import { useBalances } from "@/hooks/useBalances";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, StatCardSkeleton, ListSkeleton, StatusBadge, Empty } from "@/components/ui-bits";
import { fmtDate, fmtTime, leaveTypeLabel, todayISO, SESSION_LABEL, MEDICAL_PAID_QUOTA, type LeaveStatus, type LeaveType, type LeaveSession } from "@/lib/leave";
import { Button } from "@/components/ui/button";
import { MonthCalendar, DeptMonthCalendar } from "@/components/MonthCalendar";
import { AlertTriangle, BarChart3, BookOpen, Briefcase, Building2, CalendarDays, CalendarPlus, CheckCheck, CheckCircle2, ClipboardCheck, Clock, Flame, Megaphone, PartyPopper, PlusCircle, Repeat, Settings, ShieldCheck, TrendingUp, Users, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const PW_EXPIRY_DAYS  = 90;
const PW_REMINDER_DAYS = 7;

function usePasswordExpiryDays(passwordChangedAt: string | null | undefined, role: string | null): number | null {
  if (!role || role === "admin" || !passwordChangedAt) return null;
  const changedAt = new Date(passwordChangedAt).getTime();
  const expiresAt = changedAt + PW_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
}

function PasswordExpiryBanner({ daysLeft }: { daysLeft: number }) {
  const isExpired = daysLeft <= 0;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${isExpired ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10"}`}>
      <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${isExpired ? "text-destructive" : "text-warning-foreground"}`} />
      <div className="flex-1 text-sm">
        {isExpired
          ? <><span className="font-semibold">Your password has expired.</span> Change it from your <Link to="/profile" className="underline font-medium">Profile</Link> page.</>
          : <><span className="font-semibold">Password expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}.</span> Change it from your <Link to="/profile" className="underline font-medium">Profile</Link> page.</>
        }
      </div>
    </div>
  );
}

// ── Profile completeness banner ───────────────────────────────────────────────
const BANNER_DISMISS_DAYS = 30;

function ProfileCompletenessBanner({ profile }: { profile: any }) {
  const [dismissed, setDismissed] = useState(false);

  // Load dismiss timestamp from session metadata (cached — no network)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const dismissedAt: number | undefined = data?.session?.user?.user_metadata?.profile_banner_dismissed_at;
      if (dismissedAt) {
        const daysAgo = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
        if (daysAgo < BANNER_DISMISS_DAYS) setDismissed(true);
        // else: expired — show banner again even though user dismissed before
      }
    }).catch(() => {});
  }, []);

  const fields = [
    { key: "date_of_birth", label: "Date of birth" },
    { key: "gender",        label: "Gender" },
  ];
  const missing = fields.filter((f) => !profile?.[f.key]);
  const pct = Math.round(((fields.length - missing.length) / fields.length) * 100);

  if (pct === 100 || dismissed) return null;

  async function dismiss() {
    setDismissed(true);
    // Store a timestamp so the dismiss expires after 30 days
    await supabase.auth.updateUser({ data: { profile_banner_dismissed_at: Date.now() } }).catch(() => {});
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Complete your profile ({pct}%)</p>
        <p className="text-xs text-muted-foreground mt-0.5">Missing: {missing.map(f => f.label).join(", ")}</p>
        <div className="mt-2 h-1.5 w-full max-w-[160px] rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button asChild size="sm" variant="outline">
          <Link to="/profile">Update</Link>
        </Button>
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={dismiss}
          aria-label="Dismiss for 30 days"
        ><X className="size-3.5"/></button>
      </div>
    </div>
  );
}

// ── Donut ring for leave balance stat cards ───────────────────────────────────
function DonutRing({ used, total, size = 44 }: { used: number; total: number; size?: number }) {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const pct  = total > 0 ? Math.min(used / total, 1) : 0;
  const dash  = circ * pct;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/40" />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke="currentColor" strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        className={pct >= 1 ? "text-destructive" : pct >= 0.7 ? "text-warning-foreground" : "text-success"}
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
    </svg>
  );
}

// ── Streak badge ──────────────────────────────────────────────────────────────
function StreakBadge({ leaves, holidays }: { leaves: { from_date: string; to_date: string; status: string }[]; holidays: { holiday_date: string }[] }) {
  const approved = leaves.filter(l => ["approved","hod_approved"].includes(l.status));
  const holidaySet = new Set(holidays.map(h => h.holiday_date));
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dow = d.getDay();
    if (dow === 0) continue; // skip Sundays
    const ds = d.toISOString().slice(0, 10);
    if (holidaySet.has(ds)) continue; // skip public holidays
    const onLeave = approved.some(l => l.from_date <= ds && l.to_date >= ds);
    if (onLeave) break;
    streak++;
  }
  if (streak < 3) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 border border-warning/30 px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
      <span className="inline-flex items-center gap-1"><Flame className="size-4 text-orange-500"/>{streak}-day streak</span>
    </span>
  );
}

// ── Next lecture countdown ────────────────────────────────────────────────────
function NextLectureBanner({ lectures }: { lectures: { start_time: string; end_time: string; subject: string; class_name: string; room: string | null; day_of_week: number }[] }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Only consider lectures that are scheduled for today's day of week
  const todayLectures = lectures.filter(l => l.day_of_week === now.getDay());
  const cur = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const next = todayLectures.find(l => l.start_time > cur);
  const current = todayLectures.find(l => l.start_time <= cur && l.end_time > cur);

  if (!next && !current) return null;

  const subject = current ?? next!;
  const minsUntil = current ? null : (() => {
    const [h, m] = next!.start_time.split(":").map(Number);
    return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
  })();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
      <span>{current ? <BookOpen className="size-5"/> : <Clock className="size-5"/>}</span>
      <div>
        <span className="font-semibold">{subject.subject}</span>
        <span className="text-muted-foreground"> · {subject.class_name}{subject.room ? ` · Room ${subject.room}` : ""}</span>
      </div>
      <span className="ml-auto shrink-0 text-xs font-semibold text-primary">
        {current ? "Ongoing now" : `in ${minsUntil}m`}
      </span>
    </div>
  );
}

// ── Leave trend chart (recharts) ──────────────────────────────────────────────
function LeaveTrendChart({ data }: { data: { month: string; count: number }[] }) {
  if (!data.length || !data.some(d => d.count > 0)) return (
    <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">No leave taken this year yet.</div>
  );
  const colors = data.map(d => d.count > 3 ? "var(--destructive)" : d.count > 1 ? "var(--warning)" : "var(--success)");
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid var(--border)" }}
          formatter={(v: number) => [`${v} day(s)`, "Leave"]}
        />
        <Bar dataKey="count" radius={[4,4,0,0]}>
          {data.map((_, i) => <Cell key={i} fill={colors[i]} fillOpacity={0.8} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Dashboard — CSC Leave Management" },
      { name: "description", content: "Leave balance, schedule, proxy duties and pending approvals at a glance." },
      { property: "og:title", content: "Dashboard — CSC Leave Management" },
      { property: "og:description", content: "Your leave balance, schedule and approvals." },
    ],
  }),
  component: () => (
    <Guarded>
      <DashboardPage />
    </Guarded>
  ),
});

function DashboardPage() {
  const { profile, role } = useAuth();
  const isPrincipal = role === "principal";
  const isAdmin     = role === "admin";
  const isHr        = role === "hr";
  return (
    <AppShell
      title={`Welcome, ${profile?.full_name ?? ""}`}
      subtitle={
        isPrincipal
          ? `${profile?.designation ?? "Principal"} · Chandrabhan Sharma College`
          : isAdmin || isHr
          ? `${role === "hr" ? "HR" : "Admin"} · Chandrabhan Sharma College`
          : `${profile?.designation ?? ""}${profile?.department_name ? `, ${profile.department_name}` : ""}`
      }
    >
      {isPrincipal  ? <PrincipalDashboard /> :
       isAdmin || isHr ? <AdminHrDashboard /> :
       <TeacherDashboard />}
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEACHER DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function TeacherDashboard() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const { data: balances = [], isLoading: balLoading } = useBalances(profile?.id);
  const daysLeft = usePasswordExpiryDays(profile?.password_changed_at, role);

  const { data: leaves = [], isLoading: leavesLoading } = useQuery({
    queryKey: ["my-leaves-recent", profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, leave_type, from_date, to_date, session, status, total_days, unpaid_days")
        .eq("teacher_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  // ── Single batched query for all leave data needed this year ────────────────
  // Replaces 3 separate queries: my-leaves-year, dash-payroll, medical-days-used
  const { data: yearLeaveData } = useQuery({
    queryKey: ["teacher-year-leaves", profile?.id],
    enabled: !!profile,
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const first = `${year}-${String(month).padStart(2,"0")}-01`;
      const last  = new Date(year, month, 0);
      const lastISO = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;

      const { data, error } = await supabase
        .from("leave_requests")
        .select("leave_type, from_date, to_date, total_days, paid_days, unpaid_days, status")
        .eq("teacher_id", profile!.id)
        .gte("from_date", `${year}-01-01`);
      if (error) throw error;
      const rows = data ?? [];

      // ── allLeavesYear (for streak + trend chart) ────────────────────────
      const allLeavesYear = rows;

      // ── payroll: this month's paid/unpaid split ─────────────────────────
      let paidDays = 0, unpaidDays = 0;
      for (const r of rows) {
        if (!["approved","hod_approved"].includes(r.status)) continue;
        if (r.to_date < first || r.from_date > lastISO) continue;
        const totalDays = Number(r.total_days);
        if (!totalDays) continue;
        const cf = r.from_date < first   ? first   : r.from_date;
        const ct = r.to_date   > lastISO ? lastISO : r.to_date;
        const dim = Math.round((new Date(ct+"T00:00:00").getTime() - new Date(cf+"T00:00:00").getTime()) / 86400000) + 1;
        const ratio = Math.min(dim / totalDays, 1);
        paidDays   += Number(r.paid_days)   * ratio;
        unpaidDays += Number(r.unpaid_days) * ratio;
      }
      const payroll = { paidDays: Math.round(paidDays*2)/2, unpaidDays: Math.round(unpaidDays*2)/2 };

      // ── medicalUsed: approved medical days this year ────────────────────
      const medicalUsed = rows
        .filter(r => r.leave_type === "medical" && ["hod_approved","approved"].includes(r.status))
        .reduce((s, r) => s + Number(r.total_days), 0);

      return { allLeavesYear, payroll, medicalUsed };
    },
  });

  const allLeavesYear = yearLeaveData?.allLeavesYear ?? [];
  const payroll       = yearLeaveData?.payroll       ?? { paidDays: 0, unpaidDays: 0 };
  const medicalUsed   = yearLeaveData?.medicalUsed   ?? 0;

  const { data: todayLectures = [] } = useQuery({
    queryKey: ["today-lectures", profile?.id],
    enabled: !!profile,
    staleTime: 30_000, // matches NextLectureBanner 30s clock tick
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("id, start_time, end_time, subject, class_name, room, day_of_week")
        .eq("teacher_id", profile!.id)
        .order("start_time");
      if (error) throw error;
      return data;
    },
  });

  const { data: proxies = [] } = useQuery({
    queryKey: ["dash-proxies", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("id, proxy_date, start_time, end_time, subject, class_name, status")
        .eq("proxy_teacher_id", profile!.id)
        .eq("status", "pending")
        .order("proxy_date")
        .limit(4);
      if (error) throw error;
      return data;
    },
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ["upcoming-holidays"],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("id, holiday_date, occasion, kind")
        .gte("holiday_date", todayISO())
        .order("holiday_date")
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  // ── Batch: notices preview + HOD pending count (parallel, single cache entry) ─
  const { data: sideData } = useQuery({
    queryKey: ["teacher-side-data", profile?.id, role, profile?.department_id],
    enabled: !!profile,
    staleTime: 120_000,
    queryFn: async () => {
      const [noticesRes, hodCountRes] = await Promise.all([
        supabase.from("notices").select("id, title, body, created_at")
          .order("created_at", { ascending: false }).limit(2),
        role === "hod" && profile?.department_id
          ? supabase.from("leave_requests").select("id", { count: "exact", head: true })
              .eq("status", "pending_hod").eq("department_id", profile.department_id)
          : Promise.resolve({ count: 0 }),
      ]);
      return {
        noticePreview: noticesRes.data ?? [],
        pendingForHod: ("count" in hodCountRes ? hodCountRes.count : 0) ?? 0,
      };
    },
  });
  const noticePreview = sideData?.noticePreview ?? [];
  const pendingForHod = sideData?.pendingForHod ?? 0;

  // HOD: who's absent today in dept
  const { data: deptAbsent = [] } = useQuery({
    queryKey: ["dept-absent-today", profile?.department_id],
    enabled: role === "hod" && !!profile?.department_id,
    staleTime: 60_000,
    queryFn: async () => {
      const today = todayISO();
      const { data } = await supabase
        .from("leave_requests")
        .select("id, teacher_id, leave_type, status, from_date, to_date")
        .in("status", ["approved","hod_approved","pending_hod"])
        .eq("department_id", profile!.department_id ?? "")
        .lte("from_date", today)
        .gte("to_date", today);
      if (!data?.length) return [];
      const { fetchPeople: fp } = await import("@/lib/people");
      const people = await fp(data.map(r => r.teacher_id));
      return data.map(r => ({ ...r, name: people[r.teacher_id]?.full_name ?? r.teacher_id }));
    },
  });

  // Build monthly trend data
  const monthlyTrend = (() => {
    const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const counts: number[] = Array(12).fill(0);
    for (const l of allLeavesYear) {
      if (!["approved","hod_approved"].includes(l.status)) continue;
      const m = new Date(l.from_date + "T00:00:00").getMonth();
      counts[m] += Number(l.total_days);
    }
    return counts
      .map((count, i) => ({ month: MONTH_SHORT[i], count }))
      .filter((_, i) => i <= new Date().getMonth()); // only up to current month
  })();

  const medicalPaidRemaining = Math.max(0, MEDICAL_PAID_QUOTA - medicalUsed);
  const medicalPaidExhausted = medicalUsed >= MEDICAL_PAID_QUOTA;

  // Projected salary deduction estimate
  const projectedDeduction = (() => {
    if (!profile?.monthly_salary || !payroll.unpaidDays) return null;
    // Use salary/30 to match perDaySalary() in leave.ts and payroll.tsx totals panel
    return Math.round((profile.monthly_salary / 30) * payroll.unpaidDays);
  })();

  return (
    <div className="space-y-6">
      {/* Password expiry */}
      {daysLeft !== null && daysLeft <= PW_REMINDER_DAYS && <PasswordExpiryBanner daysLeft={daysLeft} />}

      {/* Profile completeness */}
      <ProfileCompletenessBanner profile={profile} />

      {/* HOD panel */}
      {role === "hod" && (
        <div className="surface grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">HOD Panel — {profile?.department_name}</p>
            <p className="text-xs text-muted-foreground">
              {pendingForHod > 0 ? `${pendingForHod} request(s) awaiting your review.` : "No pending requests."}
            </p>
          </div>
          <Button asChild size="sm">
            <Link to="/requests">Review requests</Link>
          </Button>
        </div>
      )}

      {/* HOD: Who's absent today — proper card */}
      {role === "hod" && (
        <SectionCard
          title="Who's Absent Today"
          subtitle={deptAbsent.length === 0 ? "All teachers present" : `${deptAbsent.length} teacher(s) on leave today`}
        >
          {deptAbsent.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" /> All teachers are present today
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {deptAbsent.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {a.name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{a.leave_type?.replace(/_/g, " ")} · {a.status === "pending_hod" ? "Pending" : "Approved"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* HOD: Department leave calendar */}
      {role === "hod" && profile?.department_id && (
        <SectionCard title="Department Leave Calendar" subtitle="Who's absent each day this month">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <DeptMonthCalendar deptId={profile.department_id} />
          </div>
        </SectionCard>
      )}

      {/* Streak + next lecture banner */}
      <div className="flex flex-wrap items-center gap-3">
        <StreakBadge leaves={allLeavesYear} holidays={holidays} />
      </div>
      {todayLectures.length > 0 && <NextLectureBanner lectures={todayLectures} />}

      {/* Stat cards with donut rings */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {balLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (<>
          {balances.filter(b => b.type === "casual").map(b => {
            const remYear  = Math.max(b.yearlyCap - b.usedYear, 0);
            const remMonth = b.monthlyCap !== undefined
              ? Math.min(Math.max(b.monthlyCap - b.usedMonth, 0), remYear) : undefined;
            return (
              <div key={b.type} className="surface p-4 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow" onClick={() => navigate({ to: "/leaves", search: { filter: "all" } })}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{b.label}</p>
                    <p className={`mt-1 text-2xl font-extrabold tracking-tight ${remYear === 0 ? "text-destructive" : "text-foreground"}`}>
                      {remMonth !== undefined ? `${remMonth} / ${b.monthlyCap}` : `${remYear} / ${b.yearlyCap}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {remMonth !== undefined ? `this month · ${remYear} of ${b.yearlyCap} left this year` : `days left this year · ${b.usedYear} used`}
                    </p>
                  </div>
                  <DonutRing used={b.usedYear} total={b.yearlyCap} />
                </div>
              </div>
            );
          })}

          {/* Medical paid quota */}
          <div className="surface p-4 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow" onClick={() => navigate({ to: "/leaves", search: { filter: "all" } })}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Medical Leave (Paid)</p>
                <p className={`mt-1 text-2xl font-extrabold tracking-tight ${medicalPaidExhausted ? "text-destructive" : medicalPaidRemaining <= 3 ? "text-warning-foreground" : "text-foreground"}`}>
                  {medicalPaidRemaining} / {MEDICAL_PAID_QUOTA}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {medicalPaidExhausted ? "quota exhausted" : `paid days remaining · ${medicalUsed} used`}
                </p>
              </div>
              <DonutRing used={medicalUsed} total={MEDICAL_PAID_QUOTA} />
            </div>
          </div>

          {/* Unpaid + projected deduction */}
          <div className="surface p-4 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow" onClick={() => navigate({ to: "/payroll" })}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Unpaid Leave (This Month)</p>
                <p className={`mt-1 text-2xl font-extrabold tracking-tight ${payroll.unpaidDays > 0 ? "text-destructive" : "text-success"}`}>
                  {payroll.unpaidDays}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {payroll.unpaidDays > 0 ? "salary deduction will apply" : "no deduction this month"}
                </p>
                {projectedDeduction !== null && projectedDeduction > 0 && (
                  <p className="mt-1 text-xs font-semibold text-destructive">~₹{projectedDeduction.toLocaleString("en-IN")} projected deduction</p>
                )}
              </div>
              <DonutRing used={payroll.unpaidDays} total={5} />
            </div>
          </div>
        </>)}
      </div>

      {/* Calendar + Leave summary */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MonthCalendar teacherId={profile?.id} />
        </div>
        <div className="space-y-4">
          <SectionCard title="Leave summary" subtitle="Current month">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-muted-foreground">Paid leave days</span>
                <span className="font-semibold text-success">{payroll.paidDays}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Unpaid leave days</span>
                <span className="font-semibold text-destructive">{payroll.unpaidDays}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Medical paid remaining</span>
                <span className={medicalPaidExhausted ? "font-semibold text-destructive" : "font-semibold"}>{medicalPaidRemaining} / {MEDICAL_PAID_QUOTA}</span>
              </li>
            </ul>
            <Button asChild variant="secondary" className="mt-4 w-full">
              <Link to="/payroll">View leave history</Link>
            </Button>
          </SectionCard>

          {/* Notice preview */}
          {noticePreview.length > 0 && (
            <SectionCard
              title="Latest Notices"
              action={<Button asChild variant="ghost" size="sm"><Link to="/notices">See all</Link></Button>}
            >
              <ul className="space-y-3 text-sm">
                {noticePreview.map(n => (
                  <li key={n.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                    <p className="font-semibold leading-tight line-clamp-1">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">{fmtDate(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Leave trend chart — always shown, empty state handled inside */}
      <SectionCard title="Leave Trend" subtitle={`${new Date().getFullYear()} — days taken per month`}>
        <LeaveTrendChart data={monthlyTrend} />
      </SectionCard>

      {/* Recent requests + Quick actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Recent Leave Requests"
          className="lg:col-span-2"
          action={<Button asChild variant="ghost" size="sm"><Link to="/leaves" search={{ filter: "all" }}>View all</Link></Button>}
        >
          {leavesLoading ? <ListSkeleton rows={3} /> : leaves.length === 0 ? <Empty>No leave requests yet.</Empty> : (
            <>
              <div className="space-y-2 sm:hidden">
                {leaves.map(l => (
                  <div key={l.id} className="flex items-start justify-between gap-2 border-t border-border pt-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{leaveTypeLabel(l.leave_type as LeaveType)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(l.from_date)} – {fmtDate(l.to_date)}</p>
                      <p className="text-xs text-muted-foreground">
                        {Number(l.total_days)} day(s)
                        {Number(l.unpaid_days) > 0 && <span className="ml-1 font-semibold text-destructive">· {Number(l.unpaid_days)} unpaid</span>}
                      </p>
                    </div>
                    <StatusBadge status={l.status as LeaveStatus} />
                  </div>
                ))}
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4 font-semibold">Type</th>
                      <th className="pb-2 pr-4 font-semibold whitespace-nowrap">From</th>
                      <th className="pb-2 pr-4 font-semibold whitespace-nowrap">To</th>
                      <th className="pb-2 pr-4 font-semibold">Duration</th>
                      <th className="pb-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map(l => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-3 pr-4 font-medium whitespace-nowrap">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{fmtDate(l.from_date)}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{fmtDate(l.to_date)}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {Number(l.total_days)} day(s)
                          {Number(l.unpaid_days) > 0 && <span className="ml-1 text-xs font-semibold text-destructive">· {Number(l.unpaid_days)} unpaid</span>}
                        </td>
                        <td className="py-3"><StatusBadge status={l.status as LeaveStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Quick Actions">
          <div className="space-y-2">
            <Button asChild size="lg" className="w-full justify-start gap-2 shadow-sm shadow-primary/20">
              <Link to="/apply"><CalendarPlus className="size-4 shrink-0" />Apply for Leave</Link>
            </Button>
            <div className="grid grid-cols-1 gap-1.5 pt-0.5">
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/schedule"><CalendarDays className="size-4 shrink-0 text-muted-foreground" />My Lecture Schedule</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/proxies"><Repeat className="size-4 shrink-0 text-muted-foreground" />Proxy Assignments</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/holidays"><PartyPopper className="size-4 shrink-0 text-muted-foreground" />Holidays</Link></Button>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Schedule + Proxies + Holidays */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Today's Schedule" subtitle={fmtDate(new Date())}>
          {todayLectures.length === 0 ? <Empty>No lectures today.</Empty> : (
            <ul className="space-y-3">
              {todayLectures.map(l => {
                const now = new Date();
                const cur = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
                const isNow = l.start_time <= cur && l.end_time > cur;
                return (
                  <li key={l.id} className={`flex items-center justify-between gap-3 text-sm rounded-lg px-2 py-1 ${isNow ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}>
                    <span className="text-muted-foreground">{fmtTime(l.start_time)} – {fmtTime(l.end_time)}</span>
                    <span className="flex-1 font-medium">{l.subject}</span>
                    <span className="text-xs text-muted-foreground">{l.class_name}{l.room && ` · ${l.room}`}</span>
                    {isNow && <span className="text-[10px] font-bold text-primary uppercase">Now</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Proxy Assignments (To Me)"
          action={<Button asChild variant="ghost" size="sm"><Link to="/proxies">View all</Link></Button>}
        >
          {proxies.length === 0 ? <Empty>No pending proxy requests.</Empty> : (
            <ul className="space-y-3 text-sm">
              {proxies.map(p => (
                <li key={p.id} className="rounded-lg border border-border p-3">
                  <p className="font-semibold">{p.subject} · {p.class_name}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(p.proxy_date)} · {fmtTime(p.start_time)} – {fmtTime(p.end_time)}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Upcoming Holidays">
          {holidays.length === 0 ? <Empty>No upcoming holidays.</Empty> : (
            <ul className="space-y-3 text-sm">
              {holidays.map(h => (
                <li key={h.id} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{fmtDate(h.holiday_date)}</span>
                  <span className="font-medium">{h.occasion}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Floating apply FAB — desktop only */}
      <div className="hidden lg:block">
        <Link
          to="/apply"
          className="fixed bottom-8 right-8 z-40 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-xl hover:bg-primary/90 transition-all hover:scale-105"
        >
          <PlusCircle className="size-4" />
          Apply for Leave
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINCIPAL DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function PrincipalDashboard() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const daysLeft = usePasswordExpiryDays(profile?.password_changed_at, role);

  const { data: stats } = useQuery({
    queryKey: ["principal-stats"],
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id").in("role", ["admin","principal"]);
      const excludedIds = (excludedRoles ?? []).map(r => r.user_id);
      const [teachers, pending, approved, rejected, depts] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true)
          .not("id", "in", excludedIds.length ? `(${excludedIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)"),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).in("status", ["hod_recommended","pending_principal"]),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gte("from_date", `${year}-01-01`),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "rejected").gte("from_date", `${year}-01-01`),
        supabase.from("departments").select("id", { count: "exact", head: true }),
      ]);
      return { teachers: teachers.count ?? 0, pending: pending.count ?? 0, approved: approved.count ?? 0, rejected: rejected.count ?? 0, departments: depts.count ?? 0 };
    },
  });

  // Department leave breakdown for leaderboard
  const { data: deptLeave = [] } = useQuery({
    queryKey: ["dept-leave-leaderboard"],
    staleTime: 60_000,
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data: leaves } = await supabase
        .from("leave_requests")
        .select("department_id, total_days, status")
        .in("status", ["approved","hod_approved"])
        .gte("from_date", `${year}-01-01`);
      const { data: depts } = await supabase.from("departments").select("id, name");
      const deptMap: Record<string, string> = {};
      for (const d of depts ?? []) deptMap[d.id] = d.name;
      const totals: Record<string, number> = {};
      for (const l of leaves ?? []) {
        const name = l.department_id ? (deptMap[l.department_id] ?? "Unknown") : "Unknown";
        totals[name] = (totals[name] ?? 0) + Number(l.total_days);
      }
      return Object.entries(totals).sort((a, b) => b[1] - a[1]);
    },
  });

  // Monthly trend
  const { data: monthlyTrendRaw = [] } = useQuery({
    queryKey: ["principal-monthly-trend"],
    staleTime: 60_000,
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data } = await supabase
        .from("leave_requests")
        .select("from_date, total_days")
        .in("status", ["approved","hod_approved"])
        .gte("from_date", `${year}-01-01`);
      return data ?? [];
    },
  });

  const monthlyTrend = (() => {
    const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const counts: number[] = Array(12).fill(0);
    for (const l of monthlyTrendRaw) {
      const m = new Date(l.from_date + "T00:00:00").getMonth();
      counts[m] += Number(l.total_days);
    }
    return counts.map((count, i) => ({ month: MONTH_SHORT[i], count })).filter((_, i) => i <= new Date().getMonth());
  })();

  const { data: queue, isLoading: queueLoading } = useQuery({
    queryKey: ["principal-queue"],
    queryFn: async () => {
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id").in("role", ["admin","principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map(r => r.user_id));
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, leave_type, from_date, to_date, session, status, total_days, teacher_id")
        .in("status", ["hod_recommended","pending_principal"])
        .order("created_at")
        .limit(8);
      if (error) throw error;
      const filtered = (data ?? []).filter(r => !excludedIds.has(r.teacher_id));
      const people = await fetchPeople(filtered.map(r => r.teacher_id));
      return filtered.map(r => ({ ...r, person: people[r.teacher_id] }));
    },
  });

  const maxDept = deptLeave[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      {daysLeft !== null && daysLeft <= PW_REMINDER_DAYS && <PasswordExpiryBanner daysLeft={daysLeft} />}

      <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-center gap-4">
        <div>
          <p className="font-bold text-base">Chandrabhan Sharma College</p>
          <p className="text-sm text-muted-foreground">Arts, Commerce &amp; Science · Principal's Overview</p>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        {!stats ? Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />) : (<>
          <StatCard label="Teaching Staff"         value={stats.teachers}   />
          <StatCard label="Departments"            value={stats.departments} />
          <StatCard label="Awaiting Approval"      value={stats.pending}     tone="warning"     onClick={() => navigate({ to: "/requests" })} />
          <StatCard label="Approved (This Year)"   value={stats.approved}    tone="success"     onClick={() => navigate({ to: "/admin-reports" })} />
          <StatCard label="Rejected (This Year)"   value={stats.rejected}    tone="destructive" onClick={() => navigate({ to: "/admin-reports" })} />
        </>)}
      </div>

      {/* Trend + dept leaderboard side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="College Leave Trend" subtitle={`${new Date().getFullYear()} — approved leave days per month`}>
          <LeaveTrendChart data={monthlyTrend} />
        </SectionCard>

        <SectionCard title="Department Leave Ranking" subtitle="Most leave days taken this year">
          {deptLeave.length === 0 ? <Empty>No leave data yet.</Empty> : (
            <ul className="space-y-3">
              {deptLeave.map(([name, days], i) => (
                <li key={name} className="text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="font-medium">{i + 1}. {name}</span>
                    <span className="text-muted-foreground">{days} days</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${(days / maxDept) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Awaiting Your Approval"
        subtitle="HOD-recommended requests from all departments"
        action={<Button asChild size="sm"><Link to="/requests">Open panel</Link></Button>}
      >
        {queueLoading ? <ListSkeleton rows={3} /> : (queue ?? []).length === 0 ? <Empty>Nothing awaiting your approval.</Empty> : (<>
          <div className="space-y-2 sm:hidden">
            {(queue ?? []).map(r => (
              <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-semibold">{r.person?.full_name}</p>
                <p className="text-xs text-muted-foreground">{r.person?.department_name} · {leaveTypeLabel(r.leave_type as LeaveType)}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(r.from_date)} – {fmtDate(r.to_date)} · {Number(r.total_days)} day(s)</p>
              </div>
            ))}
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-semibold">Teacher</th>
                  <th className="pb-2 pr-4 font-semibold">Department</th>
                  <th className="pb-2 pr-4 font-semibold">Type</th>
                  <th className="pb-2 pr-4 font-semibold whitespace-nowrap">Dates</th>
                  <th className="pb-2 font-semibold">Duration</th>
                </tr>
              </thead>
              <tbody>
                {(queue ?? []).map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-3 pr-4 font-medium whitespace-nowrap">{r.person?.full_name}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{r.person?.department_name}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{leaveTypeLabel(r.leave_type as LeaveType)}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{fmtDate(r.from_date)} – {fmtDate(r.to_date)}</td>
                    <td className="py-3 whitespace-nowrap">{Number(r.total_days)} day(s) · {SESSION_LABEL[r.session as LeaveSession]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / HR DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function AdminHrDashboard() {
  const { role } = useAuth();
  const isHr = role === "hr";

  const { data: stats } = useQuery({
    queryKey: ["admin-hr-dash-stats"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id").in("role", ["admin","principal"]);
      const excludedIds = (excludedRoles ?? []).map(r => r.user_id);
      const year = new Date().getFullYear();
      const [teachers, pendingLeaves, approvedLeaves, depts, hrPending] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true)
          .not("id", "in", excludedIds.length ? `(${excludedIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)"),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).in("status", ["pending_hod","hod_recommended","pending_principal"]),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).in("status", ["approved","hod_approved"]).gte("from_date", `${year}-01-01`),
        supabase.from("departments").select("id", { count: "exact", head: true }),
        isHr ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true).is("hr_approved", null) : Promise.resolve({ count: 0 }),
      ]);
      return {
        teachers:      teachers.count ?? 0,
        pendingLeaves: pendingLeaves.count ?? 0,
        approvedLeaves: approvedLeaves.count ?? 0,
        departments:   depts.count ?? 0,
        hrPending:     (hrPending as any).count ?? 0,
      };
    },
  });

  // HR onboarding pipeline
  const { data: pipeline } = useQuery({
    queryKey: ["hr-pipeline"],
    enabled: isHr,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: all } = await supabase.from("profiles").select("id, hr_approved, approved").eq("approved", true);
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const roleMap: Record<string, string> = {};
      for (const r of roles ?? []) roleMap[r.user_id] = r.role;
      const teachers = (all ?? []).filter(p => !["admin","principal","hr"].includes(roleMap[p.id] ?? ""));
      return {
        pending:  teachers.filter(t => (t as any).hr_approved === null).length,
        approved: teachers.filter(t => (t as any).hr_approved === true).length,
        rejected: teachers.filter(t => (t as any).hr_approved === false).length,
        total:    teachers.length,
      };
    },
  });

  // Monthly trend (college-wide) for admin
  const { data: monthlyTrendRaw = [] } = useQuery({
    queryKey: ["admin-monthly-trend"],
    staleTime: 60_000,
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data } = await supabase
        .from("leave_requests")
        .select("from_date, total_days")
        .in("status", ["approved","hod_approved"])
        .gte("from_date", `${year}-01-01`);
      return data ?? [];
    },
  });

  const monthlyTrend = (() => {
    const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const counts: number[] = Array(12).fill(0);
    for (const l of monthlyTrendRaw) {
      const m = new Date(l.from_date + "T00:00:00").getMonth();
      counts[m] += Number(l.total_days);
    }
    return counts.map((count, i) => ({ month: MONTH_SHORT[i], count })).filter((_, i) => i <= new Date().getMonth());
  })();

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/8 to-primary/4 px-5 py-4 flex items-center gap-4">
        <div className="size-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <span>{isHr ? <Users className="size-5"/> : <Settings className="size-5"/>}</span>
        </div>
        <div>
          <p className="font-bold text-base">Chandrabhan Sharma College</p>
          <p className="text-sm text-muted-foreground">
            {isHr ? "HR Panel · Staff onboarding & payroll" : "Admin Panel · Full system access"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Teaching Staff"       value={stats?.teachers ?? "—"} />
        <StatCard label="Departments"          value={stats?.departments ?? "—"} />
        <StatCard label="Pending Leaves"       value={stats?.pendingLeaves ?? "—"} tone="warning" />
        <StatCard label="Approved (This Year)" value={stats?.approvedLeaves ?? "—"} tone="success" />
      </div>

      {/* HR: onboarding pipeline funnel */}
      {isHr && pipeline && (
        <SectionCard title="Onboarding Pipeline" subtitle="Teacher HR approval status">
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { label: "Pending Review", value: pipeline.pending, color: "text-warning-foreground", bg: "bg-warning/10" },
              { label: "Approved",       value: pipeline.approved, color: "text-success",           bg: "bg-success/10" },
              { label: "Rejected",       value: pipeline.rejected, color: "text-destructive",       bg: "bg-destructive/10" },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-4 ${s.bg}`}>
                <p className={`text-3xl font-extrabold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 h-2 w-full rounded-full bg-muted overflow-hidden flex">
            {pipeline.total > 0 && (<>
              <div className="h-full bg-warning/60 transition-all" style={{ width: `${(pipeline.pending / pipeline.total) * 100}%` }} />
              <div className="h-full bg-success/60 transition-all"  style={{ width: `${(pipeline.approved / pipeline.total) * 100}%` }} />
              <div className="h-full bg-destructive/60 transition-all" style={{ width: `${(pipeline.rejected / pipeline.total) * 100}%` }} />
            </>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground text-right">{pipeline.total} teachers total</p>
          <Button asChild className="mt-3 w-full" variant="outline"><Link to="/hr">Open HR Panel</Link></Button>
        </SectionCard>
      )}

      {/* College leave trend */}
    <SectionCard title="College Leave Trend" subtitle={`${new Date().getFullYear()} — approved leave days per month`}>
        <LeaveTrendChart data={monthlyTrend} />
      </SectionCard>

      <SectionCard title="Quick Actions">
        <div className="space-y-2">
          {isHr ? (<>
            <Button asChild size="lg" className="w-full justify-start gap-2 shadow-sm shadow-primary/20">
              <Link to="/hr"><Briefcase className="size-4 shrink-0" />HR Panel</Link>
            </Button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/teachers"><Users className="size-4 shrink-0 text-muted-foreground" />View Teachers</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/holidays"><PartyPopper className="size-4 shrink-0 text-muted-foreground" />Holidays</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/notices"><Megaphone className="size-4 shrink-0 text-muted-foreground" />Notices</Link></Button>
            </div>
          </>) : (<>
            <Button asChild size="lg" className="w-full justify-start gap-2 shadow-sm shadow-primary/20">
              <Link to="/requests"><ClipboardCheck className="size-4 shrink-0" />Leave Requests</Link>
            </Button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/admin"><ShieldCheck className="size-4 shrink-0 text-muted-foreground" />Admin Panel</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/admin-reports"><BarChart3 className="size-4 shrink-0 text-muted-foreground" />Reports</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/teachers"><Users className="size-4 shrink-0 text-muted-foreground" />Teachers</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/departments"><Building2 className="size-4 shrink-0 text-muted-foreground" />Departments</Link></Button>
              <Button asChild variant="outline" className="w-full justify-start gap-2 h-9 text-sm"><Link to="/holidays"><PartyPopper className="size-4 shrink-0 text-muted-foreground" />Holidays</Link></Button>
            </div>
          </>)}
        </div>
      </SectionCard>
    </div>
  );
}
