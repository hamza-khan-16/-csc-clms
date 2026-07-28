import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtTime } from "@/lib/leave";

export const Route = createFileRoute("/proxies")({
  head: () => ({
    meta: [
      { title: "Proxy Duties — CSC Leave Management" },
      {
        name: "description",
        content: "Accept or decline proxy lectures assigned to you by your head of department.",
      },
      { property: "og:title", content: "Proxy Duties — CSC Leave Management" },
      { property: "og:description", content: "Your assigned proxy lectures and their status." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <ProxiesPage />
    </Guarded>
  ),
});

function ProxiesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data: rows = [] } = useQuery({
    queryKey: ["my-proxies", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("*")
        .eq("proxy_teacher_id", profile!.id)
        .order("proxy_date");
      if (error) throw error;
      const rows = data ?? [];
      const { data: reqs } = await supabase
        .from("leave_requests")
        .select("id, teacher_id")
        .in("id", rows.length ? rows.map((r) => r.leave_request_id) : ["00000000-0000-0000-0000-000000000000"]);
      const teacherByReq = new Map((reqs ?? []).map((r) => [r.id, r.teacher_id]));
      const people = await fetchPeople((reqs ?? []).map((r) => r.teacher_id));
      return rows.map((r) => ({
        ...r,
        absentee: people[teacherByReq.get(r.leave_request_id) ?? ""],
      }));
    },
  });

  async function respond(id: string, status: "accepted" | "rejected") {
    const { error } = await supabase.from("proxy_assignments").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "accepted" ? "Proxy accepted" : "Proxy declined");
    qc.invalidateQueries();
  }


  const pending = rows.filter((r) => r.status === "pending");
  const handled = rows.filter((r) => r.status !== "pending");

  return (
    <AppShell title="Proxy Duties" subtitle="Lectures your HOD has asked you to cover">
      <div className="space-y-6">
        <SectionCard title="Awaiting your response">
          {pending.length === 0 ? (
            <Empty>No proxy requests waiting on you.</Empty>
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
                >
                  <div>
                    <p className="font-semibold">
                      {r.subject} · {r.class_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {fmtDate(r.proxy_date)} · {fmtTime(r.start_time)} – {fmtTime(r.end_time)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Covering for {r.absentee?.full_name ?? "a colleague"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => respond(r.id, "accepted")}>
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => respond(r.id, "rejected")}
                    >

                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="History">
          {handled.length === 0 ? (
            <Empty>Nothing here yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {handled.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <span>
                    {fmtDate(r.proxy_date)} · {fmtTime(r.start_time)} · {r.subject} ({r.class_name})
                  </span>
                  <Badge variant={r.status === "accepted" ? "default" : "secondary"}>
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
