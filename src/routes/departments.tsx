import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/departments")({
  head: () => ({
    meta: [
      { title: "Departments — CSC Leave Management" },
      {
        name: "description",
        content: "College departments, their courses and FY/SY/TY classes with staff counts.",
      },
      { property: "og:title", content: "Departments — CSC Leave Management" },
      { property: "og:description", content: "Departments, courses and classes overview." },
    ],
  }),
  component: () => (
    <Guarded roles={["principal", "admin"]}>
      <DepartmentsPage />
    </Guarded>
  ),
});

function DepartmentsPage() {
  const { data: rows = [] } = useQuery({
    queryKey: ["departments-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      const { data: staff } = await supabase.from("profiles").select("id, department_id");
      return (data ?? []).map((d) => ({
        ...d,
        staff: (staff ?? []).filter((s) => s.department_id === d.id).length,
      }));
    },
  });

  return (
    <AppShell title="Departments" subtitle="Courses and classes across the college">
      {rows.length === 0 ? (
        <SectionCard>
          <Empty>No departments configured.</Empty>
        </SectionCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <SectionCard key={d.id} title={d.name} subtitle={`${d.staff} staff member(s)`}>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Courses
                  </p>
                  <p className="mt-1">{d.courses || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Classes
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(d.classes || "FY,SY,TY").split(",").map((c) => (
                      <Badge key={c} variant="secondary">
                        {c.trim()}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </AppShell>
  );
}
