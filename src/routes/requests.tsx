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
  isHodFinalLeave,
  docLabel,
  medicalPaidSplit,
  medicalNeedsDecision,
  MEDICAL_PAID_QUOTA,
  SESSION_LABEL,
  type LeaveSession,
  type LeaveStatus,
  type LeaveType,
  type DocStatus,
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
      // Fetch admin IDs to exclude from results
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const adminIds = new Set((adminRoles ?? []).map((r) => r.user_id));

      let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
      if (isHod) {
        q = q.eq("department_id", profile!.department_id ?? "");
      } else {
        // Principal sees normal flow + hod_approved (documents section)
        q = q.in("status", [
          "hod_recommended",
          "pending_principal",
          "hod_approved",
          "approved",
          "rejected",
        ]);
      }
      const { data, error } = await q;
      if (error) throw error;
      const filtered = (data ?? []).filter((r) => !adminIds.has(r.teacher_id));
      const people = await fetchPeople(filtered.map((r) => r.teacher_id));
      return filtered.map((r) => ({ ...r, teacher: people[r.teacher_id] }));
    },
  });

  // HOD actionable: pending_hod (all types) + emergency pending_principal
  // Principal actionable: hod_recommended + pending_principal (normal flow)
  // Principal docs section: hod_approved with doc uploaded (doc_status = 'uploaded')
  const actionable = requests.filter((r) => {
    if (isHod) return r.status === "pending_hod" || (r.leave_type === "emergency" && r.status === "pending_principal");
    return r.status === "hod_recommended" || r.status === "pending_principal";
  });
  // Principal: medical/duty leaves that are hod_approved but document not yet verified
  const docPending = isHod ? [] : requests.filter(
    (r) => r.status === "hod_approved" && r.doc_status !== "verified"
  );
  const rest = requests.filter((r) => !actionable.includes(r) && !docPending.includes(r));

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

        {/* Principal: documents remaining section */}
        {!isHod && docPending.length > 0 && (
          <SectionCard
            title="Documents Remaining"
            subtitle={`${docPending.length} leave(s) awaiting document upload or verification`}
          >
            <div className="space-y-4">
              {docPending.map((r) => (
                <DocCard key={r.id} request={r} />
              ))}
            </div>
          </SectionCard>
        )}

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
  doc_status: DocStatus | null;
  doc_url: string | null;
  doc_note: string | null;
  created_at: string;
  teacher?: { full_name: string; department_name: string | null };
}

function RequestCard({ request, isHod }: { request: RequestRow; isHod: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const isEmergency = request.leave_type === "emergency";
  const isHodFinal = isHodFinalLeave(request.leave_type as LeaveType);
  const isMedical = request.leave_type === "medical";
  const requiredDoc = docLabel(request.leave_type as LeaveType);
  const needsDecision = needsPaymentDecision(request.leave_type as LeaveType) && !isHodFinal;
  const [payment, setPayment] = useState<"paid" | "unpaid">(
    (request.payment_decision as "paid" | "unpaid" | null) ?? "paid",
  );

  // Fetch how many medical days this teacher has already taken this year
  // to determine whether they're still within the 10-day paid quota
  const { data: medicalDaysTaken = 0 } = useQuery({
    queryKey: ["medical-days-taken", request.teacher_id, new Date().getFullYear()],
    enabled: !isHod && isMedical,
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data } = await supabase
        .from("leave_requests")
        .select("total_days")
        .eq("teacher_id", request.teacher_id)
        .eq("leave_type", "medical")
        .in("status", ["hod_approved", "approved"])
        .neq("id", request.id) // exclude current request
        .gte("from_date", `${year}-01-01`);
      return (data ?? []).reduce((s, r) => s + Number(r.total_days), 0);
    },
  });

  const requestDays = Number(request.total_days);
  const medicalSplit = isMedical ? medicalPaidSplit(medicalDaysTaken, requestDays) : null;
  // Principal needs to decide only if there are over-quota days
  const medicalRequiresDecision = isMedical && medicalNeedsDecision(medicalDaysTaken, requestDays);

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
    queryKey: ["dept-availability", request.department_id, request.from_date, request.to_date],
    enabled: isHod,
    queryFn: async () => {
      // Get all teachers in dept (excluding the absent teacher)
      let pq = supabase.from("profiles").select("id, full_name, designation").eq("approved", true);
      if (request.department_id) pq = pq.eq("department_id", request.department_id);
      const { data: people, error } = await pq.neq("id", request.teacher_id).order("full_name");
      if (error) throw error;

      // Fixed lectures for conflict checking
      const teacherIds = (people ?? []).map((p) => p.id);
      const { data: lectures } = teacherIds.length
        ? await supabase
            .from("lectures")
            .select("teacher_id, day_of_week, start_time, end_time")
            .in("teacher_id", teacherIds)
            .is("lecture_date", null)
        : { data: [] };

      // Also fetch accepted proxy assignments during leave period (so we know who's already busy)
      const { data: existingProxies } = teacherIds.length
        ? await supabase
            .from("proxy_assignments")
            .select("proxy_teacher_id, proxy_date, start_time, end_time")
            .in("proxy_teacher_id", teacherIds)
            .in("status", ["pending", "accepted"])
            .gte("proxy_date", request.from_date)
            .lte("proxy_date", request.to_date)
        : { data: [] };

      return { people: people ?? [], lectures: lectures ?? [], existingProxies: existingProxies ?? [] };
    },
  });

  function candidates(date: string, start: string, end: string) {
    const dow = new Date(date + "T00:00:00").getDay();
    return (dept?.people ?? []).map((p) => {
      // Busy if they have a fixed lecture at this time
      const busyFixed = (dept?.lectures ?? []).some(
        (l) =>
          l.teacher_id === p.id &&
          l.day_of_week === dow &&
          l.start_time < end &&
          l.end_time > start,
      );
      // Busy if they already have a proxy assignment at this time on this date
      const busyProxy = (dept?.existingProxies ?? []).some(
        (p2) =>
          p2.proxy_teacher_id === p.id &&
          p2.proxy_date === date &&
          p2.start_time < end &&
          p2.end_time > start,
      );
      return { ...p, free: !busyFixed && !busyProxy };
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
        absentee_teacher_id: request.teacher_id,   // store directly — avoids RLS join issues
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

  // HOD recommends normal leaves → moves to pending_principal
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

  // HOD directly approves medical/duty leave → status = hod_approved, doc_status = required
  async function hodDirectApprove() {
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: "hod_approved",
        doc_status: "required",
        hod_note: note.trim() || null,
        hod_acted_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Leave approved — teacher must upload ${requiredDoc}`);
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
    // Compute paid/unpaid days:
    // - Medical: first 10 days/yr are auto-paid; over-quota days per principal's decision
    // - Emergency: always unpaid
    // - Others: per principal's decision
    const total = Number(request.total_days);
    let paidDays: number;
    let unpaidDays: number;
    if (isMedical && medicalSplit) {
      const overQuotaPaid = medicalRequiresDecision ? (payment === "paid" ? medicalSplit.overQuota : 0) : 0;
      paidDays = medicalSplit.withinQuota + overQuotaPaid;
      unpaidDays = total - paidDays;
    } else if (needsDecision && !isEmergency) {
      paidDays = payment === "paid" ? total : 0;
      unpaidDays = payment === "unpaid" ? total : 0;
    } else {
      paidDays = Number(request.paid_days);
      unpaidDays = Number(request.unpaid_days);
    }
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
        <div className="mt-4 rounded-lg border border-border p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Salary decision for this {leaveTypeLabel(request.leave_type as LeaveType).toLowerCase()}
          </p>

          {/* Medical quota info banner */}
          {isMedical && medicalSplit && (
            <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
              <p className="font-semibold text-foreground">
                Medical Leave Quota — {MEDICAL_PAID_QUOTA} paid days/year
              </p>
              <p className="text-muted-foreground">
                Days already taken this year: <strong>{medicalDaysTaken}</strong>
              </p>
              <p className="text-muted-foreground">
                This request: <strong>{requestDays}</strong> day(s) —{" "}
                <span className="text-success font-medium">{medicalSplit.withinQuota} within paid quota</span>
                {medicalSplit.overQuota > 0 && (
                  <span className="text-destructive font-medium">
                    {" "}· {medicalSplit.overQuota} over quota (your decision below)
                  </span>
                )}
              </p>
              {!medicalRequiresDecision && (
                <p className="text-success font-medium">
                  ✓ All days are within the paid quota — no deduction needed.
                </p>
              )}
            </div>
          )}

          {/* Only show paid/unpaid toggle if over-quota days exist */}
          {(!isMedical || medicalRequiresDecision) && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={payment === "paid" ? "default" : "outline"}
                onClick={() => setPayment("paid")}
              >
                {isMedical && medicalSplit?.overQuota
                  ? `Paid — no deduction for ${medicalSplit.overQuota} over-quota day(s)`
                  : "Paid — no deduction"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={payment === "unpaid" ? "destructive" : "outline"}
                onClick={() => setPayment("unpaid")}
              >
                {isMedical && medicalSplit?.overQuota
                  ? `Unpaid — deduct ${medicalSplit.overQuota} over-quota day(s)`
                  : "Unpaid — deduct salary"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* HOD sees a note that principal will decide pay */}
      {isHod && needsDecision && !isEmergency && !isHodFinal && (
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-muted p-2">
          💡 The principal will decide whether this leave is paid or unpaid upon final approval.
        </p>
      )}

      {/* HOD: medical/duty doc notice */}
      {isHod && isHodFinal && (
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-info/8 border border-info/30 p-2">
          📄 Approving this leave will require the teacher to upload a <strong>{requiredDoc}</strong>. The principal will verify the document and finalise salary.
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
        {isHod && !isEmergency && isHodFinal && (
          <Button onClick={hodDirectApprove} disabled={busy}>
            Approve Leave
          </Button>
        )}
        {isHod && !isEmergency && !isHodFinal && (
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
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isEmergency ? (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span>
            <span>→</span>
            <span className="rounded bg-muted px-2 py-0.5">HOD &amp; Principal notified</span>
            <span>→</span>
            <span className="rounded bg-muted px-2 py-0.5">Auto-approves in 5h (unpaid)</span>
          </>
        ) : isHodFinal ? (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span>
            <span>→</span>
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-success/15 text-success"}`}>
              HOD Approval
            </span>
            <span>→</span>
            <span className="rounded bg-muted px-2 py-0.5">✅ Leave Approved</span>
            <span>+</span>
            <span className="rounded bg-muted px-2 py-0.5">Teacher uploads {requiredDoc} (for records)</span>
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

// ─── DocCard ──────────────────────────────────────────────────────────────────
// Shown to the principal for hod_approved leaves pending document verification.

function DocCard({ request }: { request: RequestRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"paid" | "unpaid">("paid");
  const [busy, setBusy] = useState(false);
  const requiredDoc = docLabel(request.leave_type as LeaveType) ?? "Document";

  const docUploaded = request.doc_status === "uploaded";

  async function verifyAndApprove() {
    setBusy(true);
    const total = Number(request.total_days);
    const paidDays = payment === "paid" ? total : 0;
    const unpaidDays = payment === "unpaid" ? total : 0;
    const { error } = await supabase
      .from("leave_requests")
      .update({
        // Leave status stays hod_approved — the leave itself is already approved
        doc_status: "verified",
        doc_note: note.trim() || null,
        doc_acted_at: new Date().toISOString(),
        payment_decision: payment,
        paid_days: paidDays,
        unpaid_days: unpaidDays,
        principal_note: note.trim() || null,
        principal_acted_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Document verified — salary decision saved");
    qc.invalidateQueries();
  }

  async function rejectDoc() {
    setBusy(true);
    const { error } = await supabase
      .from("leave_requests")
      .update({
        // Leave stays hod_approved — we only flag the document as needing re-upload
        doc_status: "required",
        doc_note: note.trim() || null,
        doc_url: null,
        doc_acted_at: new Date().toISOString(),
        principal_note: note.trim() || null,
        principal_acted_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Document rejected — teacher will need to re-upload");
    qc.invalidateQueries();
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">{request.teacher?.full_name}</p>
          <p className="text-sm text-muted-foreground">
            {leaveTypeLabel(request.leave_type as LeaveType)} ·{" "}
            {SESSION_LABEL[request.session as LeaveSession]}
          </p>
          <p className="text-sm text-muted-foreground">
            {fmtDate(request.from_date)} – {fmtDate(request.to_date)} ·{" "}
            {Number(request.total_days)} day(s)
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge
            variant={docUploaded ? "default" : "secondary"}
            className={docUploaded ? "bg-info text-info-foreground" : ""}
          >
            {docUploaded ? "Document Uploaded" : "Awaiting Document Upload"}
          </Badge>
          <span className="text-xs text-muted-foreground">Leave already approved by HOD</span>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{request.reason}</p>
      {request.hod_note && (
        <p className="mt-2 text-xs text-muted-foreground">HOD note: {request.hod_note}</p>
      )}

      {/* Document status */}
      <div className={`mt-3 rounded-lg border p-3 text-sm ${docUploaded ? "border-info/30 bg-info/8" : "border-warning/30 bg-warning/10"}`}>
        <p className="font-semibold">
          {docUploaded ? `✅ ${requiredDoc} uploaded` : `⏳ Waiting for teacher to upload ${requiredDoc}`}
        </p>
        {docUploaded && request.doc_url && (
          <ViewDocButton path={request.doc_url} />
        )}
        {!docUploaded && (
          <p className="mt-1 text-xs text-muted-foreground">
            The leave is already approved. This section is for document verification only. Once the teacher uploads the document, you can verify it and set the salary decision.
          </p>
        )}
      </div>

      {/* Salary decision — only when document is uploaded */}
      {docUploaded && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Salary decision
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

      <Textarea
        className="mt-4"
        rows={2}
        maxLength={300}
        placeholder="Add a note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {docUploaded && (
          <Button onClick={verifyAndApprove} disabled={busy}>
            Verify Document
          </Button>
        )}
        <Button variant="outline" onClick={rejectDoc} disabled={busy || !docUploaded}>
          Reject Document
        </Button>
      </div>
      {docUploaded && (
        <p className="mt-2 text-xs text-muted-foreground">
          Rejecting sends it back to the teacher to re-upload. The leave itself remains approved.
        </p>
      )}
    </div>
  );
}

function ViewDocButton({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    // doc_url may be a full Supabase public URL from an old upload — extract just the storage path
    const storagePath = path.includes("/object/public/leave-docs/")
      ? path.split("/object/public/leave-docs/")[1]
      : path.includes("/object/sign/leave-docs/")
      ? path.split("/object/sign/leave-docs/")[1]
      : path;

    setLoading(true);
    const { data, error } = await supabase.storage
      .from("leave-docs")
      .createSignedUrl(decodeURIComponent(storagePath), 60);
    setLoading(false);
    if (error || !data?.signedUrl) return toast.error("Could not open document");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      onClick={open}
      disabled={loading}
      className="mt-1 inline-block text-xs underline text-info disabled:opacity-50"
    >
      {loading ? "Opening…" : "View document ↗"}
    </button>
  );
}
