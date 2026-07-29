import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatusBadge, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  eachDate,
  emergencyMsRemaining,
  fmtDate,
  fmtMs,
  fmtTime,
  leaveTypeLabel,
  needsPaymentDecision,
  SESSION_LABEL,
  type LeaveSession,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/leave";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Leave Requests — CSC Leave Management" },
      {
        name: "description",
        content:
          "Review staff leave requests, assign proxy teachers and approve or reject.",
      },
      { property: "og:title", content: "Leave Requests — CSC Leave Management" },
      {
        property: "og:description",
        content: "HOD and principal dual-approval panel with proxy assignment.",
      },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <RequestsPage />
    </Guarded>
  ),
});

function RequestsPage() {
  const { profile, role } = useAuth();
  const isHod = role === "hod";

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["review-requests", role, profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
      if (isHod) {
        // HOD sees requests from their department that are pending_hod OR emergency
        q = q.eq("department_id", profile!.department_id ?? "");
      } else {
        // Principal sees: hod_recommended, pending_principal, approved, rejected
        q = q.in("status", ["hod_recommended", "pending_principal", "approved", "rejected"]);
      }
      const { data, error } = await q;
      if (error) throw error;
      const people = await fetchPeople((data ?? []).map((r) => r.teacher_id));
      return (data ?? []).map((r) => ({ ...r, teacher: people[r.teacher_id] }));
    },
  });

  // HOD: pending_hod requests + emergency leaves they haven't acted on
  // Principal: hod_recommended + pending_principal (emergency) requests
  const actionable = requests.filter((r) => {
    if (isHod) return r.status === "pending_hod" || (r.leave_type === "emergency" && r.status === "pending_principal");
    return r.status === "hod_recommended" || r.status === "pending_principal";
  });
  const rest = requests.filter((r) => !actionable.includes(r));

  return (
    <AppShell
      title="Leave Requests"
      subtitle={
        isHod
          ? "Assign proxy teachers, then recommend to the principal"
          : "Final approval for HOD-recommended and emergency requests"
      }
    >
      <div className="space-y-6">
        <SectionCard title="Needs your action" subtitle={`${actionable.length} request(s)`}>
          {isLoading ? (
            <Empty>Loading…</Empty>
          ) : actionable.length === 0 ? (
            <Empty>Nothing waiting on you right now.</Empty>
          ) : (
            <div className="space-y-4">
              {actionable.map((r) => (
                <RequestCard key={r.id} request={r} isHod={isHod} />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="All requests">
          {rest.length === 0 ? (
            <Empty>No other requests.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Teacher</th>
                    <th className="pb-2 font-semibold">Type</th>
                    <th className="pb-2 font-semibold">Dates</th>
                    <th className="pb-2 font-semibold">Days</th>
                    <th className="pb-2 font-semibold">Pay cut</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-3 font-medium">{r.teacher?.full_name}</td>
                      <td className="py-3">{leaveTypeLabel(r.leave_type as LeaveType)}</td>
                      <td className="py-3">
                        {fmtDate(r.from_date)} – {fmtDate(r.to_date)}
                      </td>
                      <td className="py-3">{Number(r.total_days)}</td>
                      <td className="py-3">{Number(r.unpaid_days)}</td>
                      <td className="py-3">
                        <StatusBadge status={r.status as LeaveStatus} />
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

interface RequestRow {
  id: string;
  teacher_id: string;
  department_id: string | null;
  leave_type: string;
  session: string;
  from_date: string;
  to_date: string;
  reason: string;
  total_days: number;
  paid_days: number;
  unpaid_days: number;
  status: string;
  hod_note: string | null;
  payment_decision: string | null;
  created_at: string;
  teacher?: { full_name: string; department_name: string | null };
}

function RequestCard({ request, isHod }: { request: RequestRow; isHod: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const isEmergency = request.leave_type === "emergency";
  const needsDecision = needsPaymentDecision(request.leave_type as LeaveType);
  const [payment, setPayment] = useState<"paid" | "unpaid">(
    (request.payment_decision as "paid" | "unpaid" | null) ?? "paid",
  );

  // Live countdown timer for emergency leaves
  const [msLeft, setMsLeft] = useState(() =>
    isEmergency ? emergencyMsRemaining(request.created_at) : 0,
  );

  useEffect(() => {
    if (!isEmergency) return;
    const id = setInterval(() => {
      const remaining = emergencyMsRemaining(request.created_at);
      setMsLeft(remaining);
      if (remaining === 0) {
        // Auto-approve on the client when timer hits zero
        supabase
          .from("leave_requests")
          .update({
            status: "approved",
            auto_approved_at: new Date().toISOString(),
            paid_days: 0,
            unpaid_days: Number(request.total_days),
          })
          .eq("id", request.id)
          .eq("status", "pending_principal") // only if not already acted on
          .then(() => qc.invalidateQueries());
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isEmergency, request.created_at, request.id, request.total_days, qc]);

  const dates = useMemo(
    () => eachDate(request.from_date, request.to_date),
    [request.from_date, request.to_date],
  );

  // Lectures of the absent teacher falling on the leave dates
  const { data: slots = [] } = useQuery({
    queryKey: ["leave-lectures", request.id],
    enabled: isHod,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("*")
        .eq("teacher_id", request.teacher_id);
      if (error) throw error;
      const out: {
        key: string;
        date: string;
        lecture: (typeof data)[number];
      }[] = [];
      for (const date of dates) {
        const dow = new Date(date + "T00:00:00").getDay();
        if (dow === 0) continue;
        for (const lec of data ?? []) {
          if (lec.day_of_week !== dow) continue;
          if (request.session === "forenoon" && lec.start_time >= "13:00:00") continue;
          if (request.session === "afternoon" && lec.start_time < "13:00:00") continue;
          out.push({ key: `${date}-${lec.id}`, date, lecture: lec });
        }
      }
      return out;
    },
  });

  const [manual, setManual] = useState<
    {
      key: string;
      date: string;
      start_time: string;
      end_time: string;
      subject: string;
      class_name: string;
    }[]
  >([]);

  const allSlots = useMemo(
    () => [
      ...slots.map((s) => ({
        key: s.key,
        date: s.date,
        start_time: s.lecture.start_time,
        end_time: s.lecture.end_time,
        subject: s.lecture.subject,
        class_name: s.lecture.class_name,
        lecture_id: s.lecture.id as string | null,
      })),
      ...manual.map((m) => ({ ...m, lecture_id: null as string | null })),
    ],
    [slots, manual],
  );

  const { data: dept } = useQuery({
    queryKey: ["dept-availability", request.department_id],
    enabled: isHod,
    queryFn: async () => {
      let pq = supabase.from("profiles").select("id, full_name, designation");
      if (request.department_id) pq = pq.eq("department_id", request.department_id);
      const { data: people, error } = await pq.neq("id", request.teacher_id).order("full_name");
      if (error) throw error;
      const { data: lectures } = await supabase
        .from("lectures")
        .select("teacher_id, day_of_week, start_time, end_time");
      return { people: people ?? [], lectures: lectures ?? [] };
    },
  });

  function candidates(date: string, start: string, end: string) {
    const dow = new Date(date + "T00:00:00").getDay();
    return (dept?.people ?? []).map((p) => {
      const busySlot = (dept?.lectures ?? []).some(
        (l) =>
          l.teacher_id === p.id &&
          l.day_of_week === dow &&
          l.start_time < end &&
          l.end_time > start,
      );
      return { ...p, free: !busySlot };
    });
  }

  function addManualSlot() {
    setManual((m) => [
      ...m,
      {
        key: `manual-${Date.now()}-${m.length}`,
        date: request.from_date,
        start_time: "09:00",
        end_time: "10:00",
        subject: "",
        class_name: "",
      },
    ]);
  }

  async function saveProxies() {
    if (allSlots.length === 0) return true;
    const missing = allSlots.filter((s) => !choices[s.key]);
    if (missing.length > 0) { toast.error("Assign a proxy teacher for every lecture"); return false; }
    const incomplete = allSlots.some((s) => !s.subject.trim() || !s.class_name.trim());
    if (incomplete) { toast.error("Add subject and class for every proxy lecture"); return false; }
    const { error: pErr } = await supabase.from("proxy_assignments").insert(
      allSlots.map((s) => ({
        leave_request_id: request.id,
        lecture_id: s.lecture_id,
        proxy_teacher_id: choices[s.key],
        proxy_date: s.date,
        start_time: s.start_time,
        end_time: s.end_time,
        subject: s.subject,
        class_name: s.class_name,
      })),
    );
    if (pErr) { toast.error(pErr.message); return false; }
    return true;
  }

  // HOD recommends → moves to pending_principal
  async function hodRecommend() {
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: "pending_principal",
        hod_note: note.trim() || null,
        hod_acted_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Recommended to the principal");
    qc.invalidateQueries();
  }

  // HOD or principal rejects
  async function reject() {
    setBusy(true);
    const patch = isHod
      ? {
          status: "rejected" as const,
          hod_note: note.trim() || null,
          hod_acted_at: new Date().toISOString(),
        }
      : {
          status: "rejected" as const,
          principal_note: note.trim() || null,
          principal_acted_at: new Date().toISOString(),
        };
    const { error } = await supabase.from("leave_requests").update(patch).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Leave rejected");
    qc.invalidateQueries();
  }

  // Principal gives final approval (also decides paid/unpaid here)
  async function principalApprove() {
    setBusy(true);
    // Compute paid/unpaid days based on principal's decision
    const total = Number(request.total_days);
    const paidDays = needsDecision && !isEmergency ? (payment === "paid" ? total : 0) : Number(request.paid_days);
    const unpaidDays = needsDecision && !isEmergency ? (payment === "unpaid" ? total : 0) : Number(request.unpaid_days);
    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: "approved",
        payment_decision: needsDecision && !isEmergency ? payment : null,
        paid_days: paidDays,
        unpaid_days: unpaidDays,
        principal_note: note.trim() || null,
        principal_acted_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Leave approved");
    qc.invalidateQueries();
  }

  const isEmergencyPendingPrincipal = isEmergency && request.status === "pending_principal";

  return (
    <div className="rounded-xl border border-border p-4">
      {/* Emergency countdown banner */}
      {isEmergencyPendingPrincipal && msLeft > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm">
          <span className="font-semibold text-destructive">⚡ Emergency Leave</span>
          <span className="text-muted-foreground">
            Auto-approves in <span className="font-mono font-bold text-destructive">{fmtMs(msLeft)}</span>
          </span>
        </div>
      )}
      {isEmergencyPendingPrincipal && msLeft === 0 && (
        <div className="mb-3 rounded-lg border border-success/40 bg-success/8 px-3 py-2 text-sm font-semibold text-success">
          ✓ Auto-approved (5-hour window elapsed)
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">{request.teacher?.full_name}</p>
          <p className="text-sm text-muted-foreground">
            {leaveTypeLabel(request.leave_type as LeaveType)} ·{" "}
            {SESSION_LABEL[request.session as LeaveSession]}
          </p>
          <p className="text-sm text-muted-foreground">
            {fmtDate(request.from_date)} – {fmtDate(request.to_date)} · {Number(request.total_days)}{" "}
            day(s)
          </p>
        </div>
        <div className="text-right text-sm">
          <StatusBadge status={request.status as LeaveStatus} />
          <p className="mt-2 text-muted-foreground">
            Paid {Number(request.paid_days)} ·{" "}
            <span className="font-semibold text-destructive">
              Pay cut {Number(request.unpaid_days)}
            </span>
          </p>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{request.reason}</p>
      {request.hod_note && !isHod && (
        <p className="mt-2 text-xs text-muted-foreground">HOD note: {request.hod_note}</p>
      )}

      {/* Proxy assignment — HOD only, not for emergency */}
      {isHod && !isEmergency && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proxy assignment
          </p>
          {allSlots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No lectures on the timetable for these dates — add a proxy lecture manually if needed.
            </p>
          )}
          <ul className="space-y-2">
            {allSlots.map((s) => {
              const options = candidates(s.date, s.start_time, s.end_time);
              const isManual = s.lecture_id === null;
              return (
                <li
                  key={s.key}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  {isManual ? (
                    <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-5">
                      <Input
                        type="date"
                        value={s.date}
                        min={request.from_date}
                        max={request.to_date}
                        onChange={(e) =>
                          setManual((m) =>
                            m.map((x) => (x.key === s.key ? { ...x, date: e.target.value } : x)),
                          )
                        }
                      />
                      <Input
                        type="time"
                        value={s.start_time}
                        onChange={(e) =>
                          setManual((m) =>
                            m.map((x) =>
                              x.key === s.key ? { ...x, start_time: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <Input
                        type="time"
                        value={s.end_time}
                        onChange={(e) =>
                          setManual((m) =>
                            m.map((x) => (x.key === s.key ? { ...x, end_time: e.target.value } : x)),
                          )
                        }
                      />
                      <Input
                        placeholder="Subject"
                        value={s.subject}
                        onChange={(e) =>
                          setManual((m) =>
                            m.map((x) => (x.key === s.key ? { ...x, subject: e.target.value } : x)),
                          )
                        }
                      />
                      <Input
                        placeholder="Class"
                        value={s.class_name}
                        onChange={(e) =>
                          setManual((m) =>
                            m.map((x) =>
                              x.key === s.key ? { ...x, class_name: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  ) : (
                    <div className="min-w-52">
                      <p className="font-semibold">
                        {s.subject} · {s.class_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                      </p>
                    </div>
                  )}
                  <Select
                    value={choices[s.key] ?? ""}
                    onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select proxy teacher" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.full_name} {o.free ? "· Free" : "· Busy"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {choices[s.key] && (
                    <Badge variant="secondary">
                      {options.find((o) => o.id === choices[s.key])?.free
                        ? "Available"
                        : "Has a lecture"}
                    </Badge>
                  )}
                  {isManual && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setManual((m) => m.filter((x) => x.key !== s.key))}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addManualSlot}>
            Add proxy lecture
          </Button>
        </div>
      )}

      {/* Payment decision — Principal only, non-emergency */}
      {!isHod && needsDecision && !isEmergency && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Salary decision for this {leaveTypeLabel(request.leave_type as LeaveType).toLowerCase()}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={payment === "paid" ? "default" : "outline"}
              onClick={() => setPayment("paid")}
            >
              Paid — no deduction
            </Button>
            <Button
              type="button"
              size="sm"
              variant={payment === "unpaid" ? "destructive" : "outline"}
              onClick={() => setPayment("unpaid")}
            >
              Unpaid — deduct salary
            </Button>
          </div>
        </div>
      )}

      {/* HOD sees a note that principal will decide pay */}
      {isHod && needsDecision && !isEmergency && (
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-muted p-2">
          💡 The principal will decide whether this leave is paid or unpaid upon final approval.
        </p>
      )}

      {/* Emergency leave: always unpaid notice */}
      {isEmergency && (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 p-2 text-xs text-destructive">
          Emergency leave — salary deduction is automatic for all {Number(request.total_days)} day(s).
        </p>
      )}

      <Textarea
        className="mt-4"
        rows={2}
        maxLength={300}
        placeholder="Add a note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {isHod && !isEmergency && (
          <Button onClick={hodRecommend} disabled={busy}>
            Approve &amp; send to principal
          </Button>
        )}
        {!isHod && (
          <Button onClick={principalApprove} disabled={busy}>
            {isEmergency ? "Approve Early" : "Approve Leave"}
          </Button>
        )}
        <Button variant="outline" onClick={reject} disabled={busy}>
          Reject
        </Button>
      </div>

      {/* Approval flow indicator */}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        {isEmergency ? (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span>
            <span>→</span>
            <span className="rounded bg-muted px-2 py-0.5">HOD &amp; Principal notified</span>
            <span>→</span>
            <span className="rounded bg-muted px-2 py-0.5">Auto-approves in 5h (unpaid)</span>
          </>
        ) : (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span>
            <span>→</span>
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-muted"}`}>
              HOD Approval
            </span>
            <span>→</span>
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_principal" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-muted"}`}>
              Principal Approval
            </span>
          </>
        )}
      </div>
    </div>
  );
}
