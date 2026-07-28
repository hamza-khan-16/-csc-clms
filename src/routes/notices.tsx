import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate } from "@/lib/leave";

export const Route = createFileRoute("/notices")({
  head: () => ({
    meta: [
      { title: "Notices — CSC Leave Management" },
      {
        name: "description",
        content:
          "Post notices to teachers. A HOD reaches their own department, the principal reaches every department.",
      },
      { property: "og:title", content: "Notices — CSC Leave Management" },
      { property: "og:description", content: "Notice board for HODs and the principal." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <NoticesPage />
    </Guarded>
  ),
});

function NoticesPage() {
  const { profile, role } = useAuth();
  const qc = useQueryClient();
  const isPrincipal = role === "principal";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [busy, setBusy] = useState(false);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-list"],
    enabled: isPrincipal,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: notices = [] } = useQuery({
    queryKey: ["notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("id, title, body, department_id, created_by, created_at, departments(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return toast.error("Give the notice a title");
    const departmentId = isPrincipal
      ? scope === "all"
        ? null
        : scope
      : (profile!.department_id ?? null);
    if (!isPrincipal && !departmentId) return toast.error("You are not linked to a department");

    setBusy(true);
    const { error } = await supabase.from("notices").insert({
      title: title.trim(),
      body: body.trim(),
      department_id: departmentId,
      created_by: profile!.id,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setTitle("");
    setBody("");
    toast.success("Notice published");
    qc.invalidateQueries({ queryKey: ["notices"] });
    qc.invalidateQueries({ queryKey: ["navbar-notices"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("notices").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["notices"] });
    qc.invalidateQueries({ queryKey: ["navbar-notices"] });
  }

  return (
    <AppShell
      title="Notices"
      subtitle={
        isPrincipal
          ? "Publish to all departments or a single department"
          : `Published to ${profile?.department_name ?? "your department"} teachers`
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <SectionCard title="Published notices">
          {notices.length === 0 ? (
            <Empty>No notices published yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {notices.map((n) => (
                <li key={n.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{n.title}</p>
                      {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {fmtDate(new Date(n.created_at))} ·{" "}
                        {(n.departments as { name: string } | null)?.name ?? "All departments"}
                      </p>
                    </div>
                    {n.created_by === profile?.id && (
                      <Button variant="ghost" size="icon" onClick={() => remove(n.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="New notice">
          <form onSubmit={post} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="notice-title">Title</Label>
              <Input
                id="notice-title"
                maxLength={120}
                placeholder="Staff meeting on Friday"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notice-body">Details</Label>
              <Textarea
                id="notice-body"
                rows={4}
                maxLength={600}
                placeholder="Add the details teachers should see..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            {isPrincipal && (
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              Publish notice
            </Button>
          </form>
        </SectionCard>
      </div>
    </AppShell>
  );
}
