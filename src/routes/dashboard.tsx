import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";

import { useBalances } from "@/hooks/useBalances";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, StatusBadge, Empty } from "@/components/ui-bits";
import { fmtDate, fmtTime, leaveTypeLabel, todayISO, SESSION_LABEL, MEDICAL_PAID_QUOTA, type LeaveStatus, type LeaveType, type LeaveSession } from "@/lib/leave";
import { Button } from "@/components/ui/button";
import { MonthCalendar } from "@/components/MonthCalendar";
import { AlertTriangle } from "lucide-react";

/** Password expiry constants */
const PW_EXPIRY_DAYS = 90;
const PW_REMINDER_DAYS = 7;

/** Returns days until password expires, or null if not applicable (admin). */
function usePasswordExpiryDays(passwordChangedAt: string | null | undefined, role: string | null): number | null {
  if (!role || role === "admin" || !passwordChangedAt) return null;
  const changedAt = new Date(passwordChangedAt).getTime();
  const expiresAt = changedAt + PW_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
}

function PasswordExpiryBanner({ daysLeft }: { daysLeft: number }) {
  const isExpired = daysLeft <= 0;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${isExpired ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning-foreground"}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex-1 text-sm">
        {isExpired
          ? <><span className="font-semibold">Your password has expired.</span> Please change it immediately from your <Link to="/profile" className="underline font-medium">Profile</Link> page.</>
          : <><span className="font-semibold">Password expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}.</span> Please change it soon from your <Link to="/profile" className="underline font-medium">Profile</Link> page.</>
        }
      </div>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — CSC Leave Management" },
      {
        name: "description",
        content: "Leave balance, schedule, proxy duties and pending approvals at a glance.",
      },
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
  return (
    <AppShell
      title={`Welcome, ${profile?.full_name ?? ""}`}
      subtitle={
        isPrincipal
          ? `${profile?.designation ?? "Principal"} · Chandrabhan Sharma College`
          : `${profile?.designation ?? ""}${profile?.department_name ? `, ${profile.department_name}` : ""}`
      }
    >
      {role === "principal" ? <PrincipalDashboard /> : <TeacherDashboard />}
    </AppShell>
  );
}

function TeacherDashboard() {
  const { profile, role } = useAuth();
  const { data: balances = [] } = useBalances(profile?.id);
  const daysLeft = usePasswordExpiryDays(profile?.password_changed_at, role);

  const { data: leaves = [] } = useQuery({
    queryKey: ["my-leaves-recent", profile?.id],
    enabled: !!profile,
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

  const { data: todayLectures = [] } = useQuery({
    queryKey: ["today-lectures", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("id, start_time, end_time, subject, class_name, room")
        .eq("teacher_id", profile!.id)
        .eq("day_of_week", new Date().getDay())
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

  const { data: payroll = { paidDays: 0, unpaidDays: 0, deduction: 0, net: 0 } } = useQuery({
    queryKey: ["dash-payroll", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const first = `${year}-${String(month).padStart(2, "0")}-01`;
      const last  = new Date(year, month, 0);
      const lastISO = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;

      const { data, error } = await supabase
        .from("leave_requests")
        .select("from_date, to_date, paid_days, unpaid_days, total_days")
        .eq("teacher_id", profile!.id)
        // Only fully approved leaves affect payroll
        .in("status", ["approved", "hod_approved"])
        // Overlap: leave intersects the month
        .lte("from_date", lastISO)
        .gte("to_date", first);
      if (error) throw error;

      // Prorate days that actually fall within this month
      let paidDays = 0;
      let unpaidDays = 0;
      for (const r of data ?? []) {
        const totalDays = Number(r.total_days);
        if (totalDays === 0) continue;
        // Clamp leave range to the current month
        const clampedFrom = r.from_date < first   ? first   : r.from_date;
        const clampedTo   = r.to_date   > lastISO ? lastISO : r.to_date;
        // Count days in the clamped range
        const fromD = new Date(clampedFrom + "T00:00:00");
        const toD   = new Date(clampedTo   + "T00:00:00");
        const daysInMonth = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
        // Prorate paid/unpaid proportionally to how many days fall in this month
        const ratio = Math.min(daysInMonth / totalDays, 1);
        paidDays   += Number(r.paid_days)   * ratio;
        unpaidDays += Number(r.unpaid_days) * ratio;
      }

      return {
        paidDays:   Math.round(paidDays * 2) / 2, // round to nearest 0.5
        unpaidDays: Math.round(unpaidDays * 2) / 2,
        deduction: 0,
        net: 0,
      };
    },
  });

  // Medical leave: how many paid days used this year vs the 10-day quota
  const { data: medicalUsed = 0 } = useQuery({
    queryKey: ["medical-days-used", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data } = await supabase
        .from("leave_requests")
        .select("total_days")
        .eq("teacher_id", profile!.id)
        .eq("leave_type", "medical")
        .in("status", ["hod_approved", "approved"])
        .gte("from_date", `${year}-01-01`);
      return (data ?? []).reduce((s, r) => s + Number(r.total_days), 0);
    },
  });
  const medicalPaidRemaining = Math.max(0, MEDICAL_PAID_QUOTA - medicalUsed);
  const medicalPaidExhausted = medicalUsed >= MEDICAL_PAID_QUOTA;

  const { data: pendingForHod = 0 } = useQuery({
    queryKey: ["hod-pending-count", profile?.department_id],
    enabled: role === "hod",
    queryFn: async () => {
      const { count } = await supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_hod")
        .eq("department_id", profile!.department_id ?? "");
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-6">
      {/* Password expiry reminder — shown 7 days before expiry, every day, non-admin only */}
      {daysLeft !== null && daysLeft <= PW_REMINDER_DAYS && (
        <PasswordExpiryBanner daysLeft={daysLeft} />
      )}

      {role === "hod" && (
        <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">HOD Panel</p>
            <p className="text-xs text-muted-foreground">
              {pendingForHod} request(s) from {profile?.department_name} awaiting your review.
            </p>
          </div>
          <Button asChild size="sm">
            <Link to="/requests">Review requests</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {balances
          .filter((b) => b.type === "casual")
          .map((b) => {
            const remainingYear  = Math.max(b.yearlyCap - b.usedYear, 0);
            const remainingMonth = b.monthlyCap !== undefined
              ? Math.min(Math.max(b.monthlyCap - b.usedMonth, 0), remainingYear)
              : undefined;
            return (
              <StatCard
                key={b.type}
                label={b.label}
                value={
                  remainingMonth !== undefined
                    ? `${remainingMonth} / ${b.monthlyCap}`
                    : `${remainingYear} / ${b.yearlyCap}`
                }
                hint={
                  remainingMonth !== undefined
                    ? `this month · ${remainingYear} of ${b.yearlyCap} left this year`
                    : `days left this year · ${b.usedYear} used`
                }
                tone={remainingYear === 0 ? "destructive" : "default"}
              />
            );
          })}

        {/* Medical leave paid quota card */}
        <StatCard
          label="Medical Leave (Paid)"
          value={`${medicalPaidRemaining} / ${MEDICAL_PAID_QUOTA}`}
          hint={
            medicalPaidExhausted
              ? `${medicalUsed} days used — quota exhausted, further leave needs principal approval`
              : `paid days remaining this year · ${medicalUsed} used`
          }
          tone={
            medicalPaidExhausted
              ? "destructive"
              : medicalPaidRemaining <= 3
              ? "warning"
              : "default"
          }
        />

        <StatCard
          label="Unpaid Leave (This Month)"
          value={payroll.unpaidDays}
          tone={payroll.unpaidDays > 0 ? "destructive" : "success"}
          hint={payroll.unpaidDays > 0 ? "salary deduction will apply" : "no deduction this month"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MonthCalendar teacherId={profile?.id} />
        </div>
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
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Recent Leave Requests"
          className="lg:col-span-2"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/leaves">View all</Link>
            </Button>
          }
        >
          {leaves.length === 0 ? (
            <Empty>No leave requests yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Type</th>
                    <th className="pb-2 font-semibold">From</th>
                    <th className="pb-2 font-semibold">To</th>
                    <th className="pb-2 font-semibold">Duration</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-3 font-medium">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                      <td className="py-3">{fmtDate(l.from_date)}</td>
                      <td className="py-3">{fmtDate(l.to_date)}</td>
                      <td className="py-3">
                        {Number(l.total_days)} day(s)
                        {Number(l.unpaid_days) > 0 && (
                          <span className="ml-1 text-xs font-semibold text-destructive">
                            · {Number(l.unpaid_days)} unpaid
                          </span>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusBadge status={l.status as LeaveStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Quick Actions">
          <div className="space-y-2">
            <Button asChild className="w-full justify-start">
              <Link to="/apply">Apply for leave</Link>
            </Button>
            <Button asChild variant="secondary" className="w-full justify-start">
              <Link to="/schedule">My lecture schedule</Link>
            </Button>
            <Button asChild variant="secondary" className="w-full justify-start">
              <Link to="/proxies">Proxy assignments</Link>
            </Button>
            <Button asChild variant="secondary" className="w-full justify-start">
              <Link to="/holidays">Holidays</Link>
            </Button>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Today's Schedule" subtitle={fmtDate(new Date())}>
          {todayLectures.length === 0 ? (
            <Empty>No lectures today.</Empty>
          ) : (
            <ul className="space-y-3">
              {todayLectures.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {fmtTime(l.start_time)} – {fmtTime(l.end_time)}
                  </span>
                  <span className="flex-1 font-medium">{l.subject}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.class_name} {l.room && `· ${l.room}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Proxy Assignments (To Me)"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/proxies">View all</Link>
            </Button>
          }
        >
          {proxies.length === 0 ? (
            <Empty>No pending proxy requests.</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {proxies.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-3">
                  <p className="font-semibold">
                    {p.subject} · {p.class_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(p.proxy_date)} · {fmtTime(p.start_time)} – {fmtTime(p.end_time)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Upcoming Holidays">
          {holidays.length === 0 ? (
            <Empty>No upcoming holidays.</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {holidays.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{fmtDate(h.holiday_date)}</span>
                  <span className="font-medium">{h.occasion}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function PrincipalDashboard() {
  const { profile, role } = useAuth();
  const daysLeft = usePasswordExpiryDays(profile?.password_changed_at, role);

  const { data: stats } = useQuery({
    queryKey: ["principal-stats"],
    queryFn: async () => {
      const year = new Date().getFullYear();

      // Exclude principal and admin from staff count — only count teaching staff
      const { data: excludedRoles } = await supabase
        .from("user_roles").select("user_id").in("role", ["admin", "principal"]);
      const excludedIds = (excludedRoles ?? []).map((r) => r.user_id);

      const [teachers, pending, approved, rejected, depts] = await Promise.all([
        // Total teaching staff (excludes admin + principal)
        supabase.from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("approved", true)
          .not("id", "in", excludedIds.length ? `(${excludedIds.join(",")})` : `('00000000-0000-0000-0000-000000000000')`),
        // Pending across ALL departments
        supabase.from("leave_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["hod_recommended", "pending_principal"]),
        // Approved this year across ALL departments
        supabase.from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "approved")
          .gte("from_date", `${year}-01-01`),
        // Rejected this year across ALL departments
        supabase.from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "rejected")
          .gte("from_date", `${year}-01-01`),
        // Number of departments
        supabase.from("departments").select("id", { count: "exact", head: true }),
      ]);

      return {
        teachers: teachers.count ?? 0,
        pending:  pending.count ?? 0,
        approved: approved.count ?? 0,
        rejected: rejected.count ?? 0,
        departments: depts.count ?? 0,
      };
    },
  });

  const { data: queue = [] } = useQuery({
    queryKey: ["principal-queue"],
    queryFn: async () => {
      // Exclude admin and principal from the leave queue
      const { data: excludedRoles } = await supabase
        .from("user_roles").select("user_id").in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, leave_type, from_date, to_date, session, status, total_days, teacher_id")
        .in("status", ["hod_recommended", "pending_principal"])
        .order("created_at")
        .limit(8);
      if (error) throw error;
      const filtered = (data ?? []).filter((r) => !excludedIds.has(r.teacher_id));
      const people = await fetchPeople(filtered.map((r) => r.teacher_id));
      return filtered.map((r) => ({ ...r, person: people[r.teacher_id] }));
    },
  });

  return (
    <div className="space-y-6">
      {/* Password expiry reminder — shown 7 days before expiry, every day, principal only */}
      {daysLeft !== null && daysLeft <= PW_REMINDER_DAYS && (
        <PasswordExpiryBanner daysLeft={daysLeft} />
      )}

      {/* College identity banner */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-center gap-4">
        <div>
          <p className="font-bold text-base">Chandrabhan Sharma College</p>
          <p className="text-sm text-muted-foreground">Arts, Commerce &amp; Science · Principal's Overview</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Teaching Staff (College)" value={stats?.teachers ?? 0} />
        <StatCard label="Departments" value={stats?.departments ?? 0} />
        <StatCard label="Awaiting Your Approval" value={stats?.pending ?? 0} tone="warning" />
        <StatCard label="Approved (This Year)" value={stats?.approved ?? 0} tone="success" />
      </div>

      <SectionCard
        title="Awaiting Your Approval"
        subtitle="HOD-recommended requests from all departments"
        action={
          <Button asChild size="sm">
            <Link to="/requests">Open panel</Link>
          </Button>
        }
      >
        {queue.length === 0 ? (
          <Empty>Nothing awaiting your approval.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Teacher</th>
                  <th className="pb-2 font-semibold">Department</th>
                  <th className="pb-2 font-semibold">Type</th>
                  <th className="pb-2 font-semibold">Dates</th>
                  <th className="pb-2 font-semibold">Duration</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-3 font-medium">{r.person?.full_name}</td>
                    <td className="py-3">{r.person?.department_name}</td>

                    <td className="py-3">{leaveTypeLabel(r.leave_type as LeaveType)}</td>
                    <td className="py-3">
                      {fmtDate(r.from_date)} – {fmtDate(r.to_date)}
                    </td>
                    <td className="py-3">
                      {Number(r.total_days)} day(s) · {SESSION_LABEL[r.session as LeaveSession]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
