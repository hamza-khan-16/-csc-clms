import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatusBadge, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  emergencyMsRemaining,
  fmtDate,
  fmtMs,
  fmtTime,
  leaveTypeLabel,
  SESSION_LABEL,
  type LeaveSession,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/leave";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/leaves")({
  head: () => ({
    meta: [
      { title: "My Leaves — CSC Leave Management" },
      {
        name: "description",
        content: "Track your leave history, approval progress, proxy cover and pay-cut days.",
      },
      { property: "og:title", content: "My Leaves — CSC Leave Management" },
      { property: "og:description", content: "Your leave history and approval status." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <MyLeavesPage />
    </Guarded>
  ),
});

function MyLeavesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data: leaves = [] } = useQuery({
    queryKey: ["my-leaves", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("teacher_id", profile!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: proxies = [] } = useQuery({
    queryKey: ["my-leave-proxies", profile?.id],
    enabled: leaves.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("*")
        .in(
          "leave_request_id",
          leaves.map((l) => l.id),
        );
      if (error) throw error;
      return data;
    },
  });

  async function cancel(id: string) {
    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Request withdrawn");
    qc.invalidateQueries();
  }

  return (
    <AppShell title="My Leaves" subtitle="All leave requests you have submitted">
      <div className="space-y-4">
        {leaves.length === 0 && (
          <SectionCard>
            <Empty>You have not applied for any leave yet.</Empty>
          </SectionCard>
        )}
        {leaves.map((l) => {
          const cover = proxies.filter((p) => p.leave_request_id === l.id);
          return (
            <SectionCard key={l.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold">{leaveTypeLabel(l.leave_type as LeaveType)}</p>
                  <p className="text-sm text-muted-foreground">
                    {fmtDate(l.from_date)} – {fmtDate(l.to_date)} ·{" "}
                    {SESSION_LABEL[l.session as LeaveSession]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={l.status as LeaveStatus} />
                  {(l.status === "pending_hod" || l.status === "pending_principal") && (
                    <Button variant="ghost" size="sm" onClick={() => cancel(l.id)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>

              {l.leave_type === "emergency" && l.status === "pending_principal" && (
                <EmergencyCountdown createdAt={l.created_at} />
              )}

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <Field label="Reason" value={l.reason} />
                <Field label="Days counted" value={`${Number(l.total_days)}`} />
                <Field label="Paid days" value={`${Number(l.paid_days)}`} />
                <Field
                  label="Pay cut days"
                  value={`${Number(l.unpaid_days)}`}
                  tone={Number(l.unpaid_days) > 0 ? "destructive" : undefined}
                />
              </div>

              {(l.hod_note || l.principal_note) && (
                <div className="mt-3 space-y-1 rounded-lg bg-muted p-3 text-xs">
                  {l.hod_note && <p>HOD: {l.hod_note}</p>}
                  {l.principal_note && <p>Principal: {l.principal_note}</p>}
                </div>
              )}

              {cover.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Proxy cover
                  </p>
                  <ul className="space-y-2 text-sm">
                    {cover.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                      >
                        <span>
                          {fmtDate(p.proxy_date)} · {fmtTime(p.start_time)} – {fmtTime(p.end_time)} ·{" "}
                          {p.subject} ({p.class_name})
                        </span>
                        <span className="text-xs font-semibold capitalize text-muted-foreground">
                          {p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </SectionCard>
          );
        })}
      </div>
    </AppShell>
  );
}

function EmergencyCountdown({ createdAt }: { createdAt: string }) {
  const [msLeft, setMsLeft] = useState(() => emergencyMsRemaining(createdAt));
  useEffect(() => {
    const id = setInterval(() => setMsLeft(emergencyMsRemaining(createdAt)), 1000);
    return () => clearInterval(id);
  }, [createdAt]);
  if (msLeft === 0) {
    return (
      <div className="mt-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-xs font-semibold text-success">
        ✓ Auto-approved — awaiting system update
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
      <span>⚡ Emergency leave — auto-approves (unpaid) in</span>
      <span className="font-mono font-bold">{fmtMs(msLeft)}</span>
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={tone === "destructive" ? "font-semibold text-destructive" : "font-medium"}>
        {value}
      </p>
    </div>
  );
}
