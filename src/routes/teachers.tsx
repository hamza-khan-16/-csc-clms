import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/teachers")({
  head: () => ({
    meta: [
      { title: "Teachers — CSC Leave Management" },
      {
        name: "description",
        content: "Directory of teaching staff with department, designation and leave usage.",
      },
      { property: "og:title", content: "Teachers — CSC Leave Management" },
      { property: "og:description", content: "Staff directory for HODs and the principal." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <TeachersPage />
    </Guarded>
  ),
});

function TeachersPage() {
  const { profile, role } = useAuth();

  const { data: rows = [] } = useQuery({
    queryKey: ["staff", role, profile?.department_id],
    enabled: !!profile,
    queryFn: async () => {
      let q = supabase
        .from("profiles")
        .select("id, full_name, designation, department_id, departments(name)")
        .order("full_name");
      if (role === "hod") q = q.eq("department_id", profile!.department_id ?? "");
      const { data, error } = await q;
      if (error) throw error;

      const year = new Date().getFullYear();
      const { data: leaves } = await supabase
        .from("leave_requests")
        .select("teacher_id, total_days, unpaid_days, status, from_date")
        .in("status", ["approved", "hod_approved"])
        .gte("from_date", `${year}-01-01`);

      return (data ?? []).map((p) => {
        const mine = (leaves ?? []).filter((l) => l.teacher_id === p.id);
        return {
          ...p,
          deptName: (p.departments as { name: string } | null)?.name ?? "—",
          taken: mine.reduce((s, l) => s + Number(l.total_days), 0),
          unpaid: mine.reduce((s, l) => s + Number(l.unpaid_days), 0),
        };
      });
    },
  });

  return (
    <AppShell
      title="Teachers"
      subtitle={role === "hod" ? "Staff in your department" : "All college staff"}
    >
      <SectionCard title={`${rows.length} staff member(s)`}>
        {rows.length === 0 ? (
          <Empty>No staff found.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Name</th>
                  <th className="pb-2 font-semibold">Designation</th>
                  <th className="pb-2 font-semibold">Department</th>
                  <th className="pb-2 font-semibold">Leaves taken (yr)</th>
                  <th className="pb-2 font-semibold">Pay-cut days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-3 font-medium">{r.full_name}</td>
                    <td className="py-3 capitalize">{r.designation}</td>
                    <td className="py-3">{r.deptName}</td>
                    <td className="py-3">{r.taken}</td>
                    <td className="py-3">
                      {r.unpaid > 0 ? (
                        <Badge variant="destructive">{r.unpaid}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
