import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";

import { useBalances } from "@/hooks/useBalances";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, StatusBadge, Empty } from "@/components/ui-bits";
import { fmtDate, fmtTime, leaveTypeLabel, todayISO, SESSION_LABEL } from "@/lib/leave";
import type { LeaveStatus, LeaveType, LeaveSession } from "@/lib/leave";
import { Button } from "@/components/ui/button";
import { MonthCalendar } from "@/components/MonthCalendar";
import { money, perDaySalary } from "@/lib/leave";

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
  return (
    <AppShell
      title={`Welcome, ${profile?.full_name ?? ""}`}
      subtitle={`${profile?.designation ?? ""}${profile?.department_name ? `, ${profile.department_name}` : ""}`}
    >
      {role === "principal" ? <PrincipalDashboard /> : <TeacherDashboard />}
    </AppShell>
  );
}

function TeacherDashboard() {
  const { profile, role } = useAuth();
  const { data: balances = [] } = useBalances(profile?.id);

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
      const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const lastISO = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
      const { data, error } = await supabase
        .from("leave_requests")
        .select("paid_days, unpaid_days")
        .eq("teacher_id", profile!.id)
        .neq("status", "rejected")
        // Overlap: leave intersects the month if it starts before month end AND ends after month start
        .lte("from_date", lastISO)
        .gte("to_date", first);
      if (error) throw error;
      const salary = Number(profile!.monthly_salary ?? 0);
      const paidDays = (data ?? []).reduce((s, r) => s + Number(r.paid_days), 0);
      const unpaidDays = (data ?? []).reduce((s, r) => s + Number(r.unpaid_days), 0);
      const deduction = Math.round(unpaidDays * perDaySalary(salary));
      return { paidDays, unpaidDays, deduction, net: Math.max(salary - deduction, 0) };
    },
  });

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {balances
          .filter((b) => b.type === "casual")
          .map((b) => {
          const remainingYear = Math.max(b.yearlyCap - b.usedYear, 0);
          const remainingMonth =
            b.monthlyCap !== undefined
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
                  : `days left this year`
              }
              tone={remainingYear === 0 ? "destructive" : "default"}
            />
          );
          })}
        <StatCard
          label="Monthly Salary"
          value={money(Number(profile?.monthly_salary ?? 0))}
          hint={`${money(perDaySalary(Number(profile?.monthly_salary ?? 0)))} per working day`}
        />
        <StatCard
          label="Unpaid Leave (This Month)"
          value={payroll.unpaidDays}
          tone={payroll.unpaidDays > 0 ? "destructive" : "success"}
          hint={payroll.unpaidDays > 0 ? `− ${money(payroll.deduction)} from salary` : "no deduction"}
        />
        <StatCard
          label="Net Pay (This Month)"
          value={money(payroll.net)}
          tone={payroll.deduction > 0 ? "warning" : "success"}
          hint="after unpaid leave deductions"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MonthCalendar teacherId={profile?.id} />
        </div>
        <SectionCard title="Payroll snapshot" subtitle="Current month">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">Gross salary</span>
              <span className="font-semibold">{money(Number(profile?.monthly_salary ?? 0))}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Paid leave days</span>
              <span className="font-semibold text-success">{payroll.paidDays}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Unpaid leave days</span>
              <span className="font-semibold text-destructive">{payroll.unpaidDays}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Deduction</span>
              <span className="font-semibold text-destructive">− {money(payroll.deduction)}</span>
            </li>
            <li className="flex justify-between border-t border-border pt-2">
              <span className="font-bold">Net payable</span>
              <span className="font-extrabold">{money(payroll.net)}</span>
            </li>
          </ul>
          <Button asChild variant="secondary" className="mt-4 w-full">
            <Link to="/payroll">Open payroll</Link>
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
  const { data: stats } = useQuery({
    queryKey: ["principal-stats"],
    queryFn: async () => {
      const year = new Date().getFullYear();
      const [teachers, pending, approved, rejected] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending_hod", "hod_recommended", "pending_principal"]),
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "approved")
          .gte("from_date", `${year}-01-01`),
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "rejected")
          .gte("from_date", `${year}-01-01`),
      ]);
      return {
        teachers: teachers.count ?? 0,
        pending: pending.count ?? 0,
        approved: approved.count ?? 0,
        rejected: rejected.count ?? 0,
      };
    },
  });

  const { data: queue = [] } = useQuery({
    queryKey: ["principal-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, leave_type, from_date, to_date, session, status, total_days, teacher_id")
        .in("status", ["hod_recommended", "pending_principal"])
        .order("created_at")
        .limit(6);
      if (error) throw error;
      const people = await fetchPeople((data ?? []).map((r) => r.teacher_id));
      return (data ?? []).map((r) => ({ ...r, person: people[r.teacher_id] }));
    },
  });


  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Staff" value={stats?.teachers ?? 0} />
        <StatCard label="Pending Requests" value={stats?.pending ?? 0} tone="warning" />
        <StatCard label="Approved (This Year)" value={stats?.approved ?? 0} tone="success" />
        <StatCard label="Rejected (This Year)" value={stats?.rejected ?? 0} tone="destructive" />
      </div>

      <SectionCard
        title="Awaiting Principal Approval"
        subtitle="HOD-recommended requests"
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
