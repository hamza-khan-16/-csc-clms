import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, Empty } from "@/components/ui-bits";
import { fmtDate, leaveTypeLabel, LEAVE_TYPES, type LeaveType } from "@/lib/leave";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Leave Reports — CSC Leave Management" },
      {
        name: "description",
        content: "Yearly leave usage, pay-cut days and leave-type breakdown across staff.",
      },
      { property: "og:title", content: "Leave Reports — CSC Leave Management" },
      { property: "og:description", content: "Leave analytics for HODs and the principal." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <ReportsPage />
    </Guarded>
  ),
});

function ReportsPage() {
  const { profile, role } = useAuth();
  const year = new Date().getFullYear();

  const { data } = useQuery({
    queryKey: ["reports", role, profile?.department_id, year],
    enabled: !!profile,
    queryFn: async () => {
      let q = supabase
        .from("leave_requests")
        .select("*")
        .eq("status", "approved")
        .gte("from_date", `${year}-01-01`)
        .lte("from_date", `${year}-12-31`);
      if (role === "hod") q = q.eq("department_id", profile!.department_id ?? "");
      const { data: leaves, error } = await q;
      if (error) throw error;
      const people = await fetchPeople((leaves ?? []).map((l) => l.teacher_id));
      return { leaves: leaves ?? [], people };
    },
  });

  const leaves = data?.leaves ?? [];
  const totalDays = leaves.reduce((s, l) => s + Number(l.total_days), 0);
  const unpaidDays = leaves.reduce((s, l) => s + Number(l.unpaid_days), 0);

  const byType = LEAVE_TYPES.map((t) => ({
    ...t,
    days: leaves
      .filter((l) => l.leave_type === t.value)
      .reduce((s, l) => s + Number(l.total_days), 0),
  }));
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
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(t.days / maxType) * 100}%` }}
                  />
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
                      <td className="py-3 font-medium">
                        {data?.people[l.teacher_id]?.full_name ?? "—"}
                      </td>
                      <td className="py-3">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                      <td className="py-3">
                        {fmtDate(l.from_date)} – {fmtDate(l.to_date)}
                      </td>
                      <td className="py-3">{Number(l.total_days)}</td>
                      <td className="py-3">{Number(l.paid_days)}</td>
                      <td className="py-3 font-semibold text-destructive">
                        {Number(l.unpaid_days)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
