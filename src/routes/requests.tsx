import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  fmtDate,
  fmtTime,
  leaveTypeLabel,
  needsPaymentDecision,
  isHodFinalLeave,
  docLabel,
  medicalPaidSplit,
  medicalNeedsDecision,
  MEDICAL_PAID_QUOTA,
  SESSION_LABEL,
  countWorkingDays,
  todayISO,
  LEAVE_TYPES,
  type LeaveSession,
  type LeaveStatus,
  type LeaveType,
  type DocStatus,
} from "@/lib/leave";
import { AlertCircle } from "lucide-react";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Leave Requests — CSC Leave Management" },
      { name: "description", content: "Review staff leave requests, assign proxy teachers and approve or reject." },
      { property: "og:title", content: "Leave Requests — CSC Leave Management" },
      { property: "og:description", content: "HOD and principal dual-approval panel with proxy assignment." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <RequestsPage />
    </Guarded>
  ),
});

// ── HOD Mark-Leave form ───────────────────────────────────────────────────────
// HOD can mark leave on behalf of a teacher who has NOT already applied
function HodMarkLeavePanel({ deptId }: { deptId: string }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const [teacherId, setTeacherId] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [session, setSession] = useState<LeaveSession>("full_day");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Manual proxy slots the HOD adds for this marked leave
  const [manualSlots, setManualSlots] = useState<
    { key: string; date: string; start_time: string; end_time: string; subject: string; class_name: string }[]
  >([]);
  const [choices, setChoices] = useState<Record<string, string>>({});

  const { data: teachers = [] } = useQuery({
    queryKey: ["dept-teachers", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("department_id", deptId)
        .eq("approved", true)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Check if this teacher already has an active leave overlapping the chosen dates
  const { data: overlap = null } = useQuery({
    queryKey: ["hod-overlap-check", teacherId, fromDate, toDate],
    enabled: !!teacherId && !!fromDate && !!toDate && toDate >= fromDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, from_date, to_date, status, leave_type")
        .eq("teacher_id", teacherId)
        .in("status", ["pending_hod", "hod_recommended", "pending_principal", "hod_approved", "approved"])
        .lte("from_date", toDate)
        .gte("to_date", fromDate)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Auto-load timetable slots for the chosen teacher + date range
  const { data: autoSlots = [] } = useQuery({
    queryKey: ["hod-mark-slots", teacherId, fromDate, toDate, session],
    enabled: !!teacherId && !!fromDate && !!toDate && toDate >= fromDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("*")
        .eq("teacher_id", teacherId);
      if (error) throw error;
      const dates = eachDate(fromDate, toDate);
      const out: { key: string; date: string; start_time: string; end_time: string; subject: string; class_name: string; lecture_id: string }[] = [];
      for (const date of dates) {
        const dow = new Date(date + "T00:00:00").getDay();
        if (dow === 0) continue;
        for (const lec of data ?? []) {
          if (lec.day_of_week !== dow) continue;
          if (session === "forenoon" && lec.start_time >= "13:00:00") continue;
          if (session === "afternoon" && lec.start_time < "13:00:00") continue;
          out.push({ key: `auto-${date}-${lec.id}`, date, start_time: lec.start_time, end_time: lec.end_time, subject: lec.subject, class_name: lec.class_name, lecture_id: lec.id });
        }
      }
      return out;
    },
  });

  const { data: deptPeople = [] } = useQuery({
    queryKey: ["dept-all-for-proxy", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").eq("department_id", deptId).eq("approved", true).order("full_name");
      return (data ?? []).filter((p) => p.id !== teacherId);
    },
  });

  const allProxySlots = useMemo(() => [
    ...autoSlots.map((s) => ({ ...s, isManual: false })),
    ...manualSlots.map((s) => ({ ...s, lecture_id: "", isManual: true })),
  ], [autoSlots, manualSlots]);

  function addManualSlot() {
    setManualSlots((m) => [...m, { key: `manual-${Date.now()}`, date: fromDate, start_time: "09:00", end_time: "10:00", subject: "", class_name: "" }]);
  }

  async function submit() {
    if (!teacherId) return toast.error("Select a teacher");
    if (!fromDate || !toDate) return toast.error("Select dates");
    if (toDate < fromDate) return toast.error("To date must be after from date");
    if (overlap) return toast.error(`This teacher already has an active leave from ${fmtDate(overlap.from_date)} to ${fmtDate(overlap.to_date)}`);
    if (session !== "full_day" && fromDate !== toDate) return toast.error("Half-day leave must be a single date");

    const missingProxy = allProxySlots.filter((s) => !choices[s.key]);
    if (missingProxy.length > 0) return toast.error("Assign a proxy for every lecture before submitting");
    const incompleteManual = manualSlots.some((s) => !s.subject.trim() || !s.class_name.trim());
    if (incompleteManual) return toast.error("Fill subject and class for every manual proxy slot");

    setBusy(true);

    // 1. Count working days
    const { data: holidays = [] } = await supabase.from("holidays").select("holiday_date");
    const holidaySet = new Set((holidays ?? []).map((h: any) => h.holiday_date));
    const { total: totalDays, workingDates } = countWorkingDays(fromDate, toDate, session, holidaySet);

    if (totalDays === 0) { setBusy(false); return toast.error("No working days in selected range"); }

    // 2. Insert the leave request on behalf of the teacher
    const { data: lr, error: lrErr } = await supabase
      .from("leave_requests")
      .insert({
        teacher_id: teacherId,
        department_id: deptId,
        leave_type: leaveType,
        from_date: fromDate,
        to_date: toDate,
        session,
        reason: reason.trim() || `Marked by HOD on ${fmtDate(today)}`,
        status: "pending_principal",   // skip HOD step — goes straight to principal
        total_days: totalDays,
        paid_days: 0,
        unpaid_days: 0,
        hod_note: `Leave marked by HOD on behalf of teacher.`,
        hod_acted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (lrErr || !lr) { setBusy(false); return toast.error(lrErr?.message ?? "Failed to create leave"); }

    // 3. Save proxy assignments
    if (allProxySlots.length > 0) {
      const proxyRows = allProxySlots
        .filter((s) => choices[s.key])
        .map((s) => ({
          leave_request_id: lr.id,
          lecture_id: s.isManual ? null : s.lecture_id || null,
          proxy_teacher_id: choices[s.key],
          absentee_teacher_id: teacherId,
          proxy_date: s.date,
          start_time: s.start_time,
          end_time: s.end_time,
          subject: s.subject,
          class_name: s.class_name,
          status: choices[s.key] === profile?.id ? "accepted" : "pending",
        }));
      if (proxyRows.length > 0) {
        const { error: pErr } = await supabase.from("proxy_assignments").insert(proxyRows);
        if (pErr) { setBusy(false); return toast.error(pErr.message); }
      }
    }

    setBusy(false);
    toast.success(`Leave marked for ${teachers.find((t) => t.id === teacherId)?.full_name} — sent to principal for approval`);
    setTeacherId("");
    setFromDate(today);
    setToDate(today);
    setReason("");
    setManualSlots([]);
    setChoices({});
    setOpen(false);
    qc.invalidateQueries();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="mb-4">
        + Mark leave on behalf of teacher
      </Button>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-primary/30 bg-primary/4 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Mark leave on behalf of teacher</p>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Teacher</label>
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select teacher…" /></SelectTrigger>
            <SelectContent>
              {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Leave type</label>
          <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEAVE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From date</label>
          <Input type="date" className="h-9 text-sm" value={fromDate} onChange={(e) => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To date</label>
          <Input type="date" className="h-9 text-sm" value={toDate} min={fromDate} disabled={session !== "full_day"} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Session</label>
          <div className="flex gap-3">
            {["full_day", "forenoon", "afternoon"].map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="hod-session" value={s} checked={session === s} onChange={() => { setSession(s as LeaveSession); if (s !== "full_day") setToDate(fromDate); }} className="accent-primary" />
                {s === "full_day" ? "Full Day" : s === "forenoon" ? "Forenoon" : "Afternoon"}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <Input className="h-9 text-sm" placeholder="Reason for leave…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>

      {/* Overlap warning */}
      {overlap && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/8 p-3 text-sm">
          <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-destructive">
            <strong>{teachers.find((t) => t.id === teacherId)?.full_name}</strong> already has an active {leaveTypeLabel(overlap.leave_type as LeaveType)} leave from <strong>{fmtDate(overlap.from_date)}</strong> to <strong>{fmtDate(overlap.to_date)}</strong>. Cannot mark another leave for overlapping dates.
          </p>
        </div>
      )}

      {/* Auto-detected + manual proxy slots */}
      {teacherId && !overlap && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proxy assignment {session !== "full_day" ? `(${SESSION_LABEL[session]} only)` : ""}
          </p>
          {autoSlots.length === 0 && manualSlots.length === 0 && (
            <p className="text-xs text-muted-foreground">No scheduled lectures found for this range. Add manually if needed.</p>
          )}
          <ul className="space-y-2">
            {allProxySlots.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3 text-sm">
                {s.isManual ? (
                  <div className="grid w-full gap-2 sm:grid-cols-5">
                    <Input type="date" value={s.date} min={fromDate} max={toDate} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, date: e.target.value } : x))} className="h-8 text-xs" />
                    <Input type="time" value={s.start_time} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, start_time: e.target.value } : x))} className="h-8 text-xs" />
                    <Input type="time" value={s.end_time} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, end_time: e.target.value } : x))} className="h-8 text-xs" />
                    <Input placeholder="Subject" value={s.subject} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, subject: e.target.value } : x))} className="h-8 text-xs" />
                    <Input placeholder="Class" value={s.class_name} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, class_name: e.target.value } : x))} className="h-8 text-xs" />
                  </div>
                ) : (
                  <div className="min-w-40">
                    <p className="font-semibold text-xs">{s.subject} · {s.class_name}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                  </div>
                )}
                <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                  <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Select proxy…" /></SelectTrigger>
                  <SelectContent>
                    {deptPeople.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {s.isManual && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => setManualSlots((m) => m.filter((x) => x.key !== s.key))}>Remove</Button>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={addManualSlot}>+ Add proxy lecture</Button>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={submit} disabled={busy || !!overlap || !teacherId}>
          {busy ? "Submitting…" : "Mark leave & send to principal"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Leave will skip HOD step and go directly to the principal for approval (paid/unpaid decision).</p>
    </div>
  );
}

// ── Requests page ─────────────────────────────────────────────────────────────
function RequestsPage() {
  const { profile, role } = useAuth();
  const isHod = role === "hod";

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["review-requests", role, profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      const adminIds = new Set((adminRoles ?? []).map((r) => r.user_id));
      let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
      if (isHod) {
        q = q.eq("department_id", profile!.department_id ?? "");
      } else {
        q = q.in("status", ["hod_recommended", "pending_principal", "hod_approved", "approved", "rejected"]);
      }
      const { data, error } = await q;
      if (error) throw error;
      const filtered = (data ?? []).filter((r) => !adminIds.has(r.teacher_id));
      const people = await fetchPeople(filtered.map((r) => r.teacher_id));
      return filtered.map((r) => ({ ...r, teacher: people[r.teacher_id] }));
    },
  });

  const actionable = requests.filter((r) => {
    if (isHod) return r.status === "pending_hod";
    return r.status === "hod_recommended" || r.status === "pending_principal";
  });
  const docPending = isHod ? [] : requests.filter((r) => r.status === "hod_approved" && r.doc_status !== "verified");
  const rest = requests.filter((r) => !actionable.includes(r) && !docPending.includes(r));

  return (
    <AppShell
      title="Leave Requests"
      subtitle={isHod ? "Review and approve teacher leave requests" : "Final approval for HOD-recommended requests"}
    >
      <div className="space-y-6">
        {/* HOD: Mark leave on behalf of teacher */}
        {isHod && profile?.department_id && (
          <SectionCard title="Mark Leave" subtitle="Mark leave for a teacher on their behalf">
            <HodMarkLeavePanel deptId={profile.department_id} />
          </SectionCard>
        )}

        <SectionCard title="Needs your action" subtitle={`${actionable.length} request(s)`}>
          {isLoading ? <Empty>Loading…</Empty>
            : actionable.length === 0 ? <Empty>Nothing waiting on you right now.</Empty>
            : <div className="space-y-4">{actionable.map((r) => <RequestCard key={r.id} request={r} isHod={isHod} />)}</div>}
        </SectionCard>

        {!isHod && docPending.length > 0 && (
          <SectionCard title="Documents Remaining" subtitle={`${docPending.length} leave(s) awaiting document upload or verification`}>
            <div className="space-y-4">{docPending.map((r) => <DocCard key={r.id} request={r} />)}</div>
          </SectionCard>
        )}

        <SectionCard title="All requests">
          {rest.length === 0 ? <Empty>No other requests.</Empty> : (
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
                      <td className="py-3">{fmtDate(r.from_date)} – {fmtDate(r.to_date)}</td>
                      <td className="py-3">{Number(r.total_days)}</td>
                      <td className="py-3">{Number(r.unpaid_days)}</td>
                      <td className="py-3"><StatusBadge status={r.status as LeaveStatus} /></td>
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

// ── RequestCard ───────────────────────────────────────────────────────────────
interface RequestRow {
  id: string; teacher_id: string; department_id: string | null; leave_type: string;
  session: string; from_date: string; to_date: string; reason: string | null;
  total_days: number; paid_days: number; unpaid_days: number; status: string;
  hod_note: string | null; payment_decision: string | null; doc_status: DocStatus | null;
  doc_url: string | null; doc_note: string | null; created_at: string;
  teacher?: { full_name: string; department_name: string | null };
}

function RequestCard({ request, isHod }: { request: RequestRow; isHod: boolean }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const isHodFinal = isHodFinalLeave(request.leave_type as LeaveType);
  const isMedical = request.leave_type === "medical";
  const requiredDoc = docLabel(request.leave_type as LeaveType);
  const needsDecision = needsPaymentDecision(request.leave_type as LeaveType) && !isHodFinal;
  const [payment, setPayment] = useState<"paid" | "unpaid">((request.payment_decision as "paid" | "unpaid" | null) ?? "paid");

  const { data: medicalDaysTaken = 0 } = useQuery({
    queryKey: ["medical-days-taken", request.teacher_id, new Date().getFullYear()],
    enabled: !isHod && isMedical,
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data } = await supabase.from("leave_requests").select("total_days")
        .eq("teacher_id", request.teacher_id).eq("leave_type", "medical")
        .in("status", ["hod_approved", "approved"]).neq("id", request.id)
        .gte("from_date", `${year}-01-01`);
      return (data ?? []).reduce((s, r) => s + Number(r.total_days), 0);
    },
  });

  const requestDays = Number(request.total_days);
  const medicalSplit = isMedical ? medicalPaidSplit(medicalDaysTaken, requestDays) : null;
  const medicalRequiresDecision = isMedical && medicalNeedsDecision(medicalDaysTaken, requestDays);

  const dates = useMemo(() => eachDate(request.from_date, request.to_date), [request.from_date, request.to_date]);

  const { data: slots = [] } = useQuery({
    queryKey: ["leave-lectures", request.id, request.session],
    enabled: isHod,
    queryFn: async () => {
      const { data, error } = await supabase.from("lectures").select("*").eq("teacher_id", request.teacher_id);
      if (error) throw error;
      const out: { key: string; date: string; lecture: (typeof data)[number] }[] = [];
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

  const [manual, setManual] = useState<{ key: string; date: string; start_time: string; end_time: string; subject: string; class_name: string }[]>([]);

  const allSlots = useMemo(() => [
    ...slots.map((s) => ({ key: s.key, date: s.date, start_time: s.lecture.start_time, end_time: s.lecture.end_time, subject: s.lecture.subject, class_name: s.lecture.class_name, lecture_id: s.lecture.id as string | null })),
    ...manual.map((m) => ({ ...m, lecture_id: null as string | null })),
  ], [slots, manual]);

  const { data: dept } = useQuery({
    queryKey: ["dept-availability", request.department_id, request.from_date, request.to_date],
    enabled: isHod,
    queryFn: async () => {
      let pq = supabase.from("profiles").select("id, full_name, designation").eq("approved", true);
      if (request.department_id) pq = pq.eq("department_id", request.department_id);
      const { data: people, error } = await pq.neq("id", request.teacher_id).order("full_name");
      if (error) throw error;
      const teacherIds = (people ?? []).map((p) => p.id);
      const { data: lectures } = teacherIds.length ? await supabase.from("lectures").select("teacher_id, day_of_week, start_time, end_time").in("teacher_id", teacherIds).is("lecture_date", null) : { data: [] };
      const { data: existingProxies } = teacherIds.length ? await supabase.from("proxy_assignments").select("proxy_teacher_id, proxy_date, start_time, end_time").in("proxy_teacher_id", teacherIds).in("status", ["pending", "accepted"]).gte("proxy_date", request.from_date).lte("proxy_date", request.to_date) : { data: [] };
      return { people: people ?? [], lectures: lectures ?? [], existingProxies: existingProxies ?? [] };
    },
  });

  function candidates(date: string, start: string, end: string) {
    const dow = new Date(date + "T00:00:00").getDay();
    return (dept?.people ?? []).map((p) => {
      const busyFixed = (dept?.lectures ?? []).some((l) => l.teacher_id === p.id && l.day_of_week === dow && l.start_time < end && l.end_time > start);
      const busyProxy = (dept?.existingProxies ?? []).some((p2) => p2.proxy_teacher_id === p.id && p2.proxy_date === date && p2.start_time < end && p2.end_time > start);
      return { ...p, free: !busyFixed && !busyProxy };
    });
  }

  async function saveProxies() {
    if (allSlots.length === 0) return true;
    const missing = allSlots.filter((s) => !choices[s.key]);
    if (missing.length > 0) { toast.error("Assign a proxy teacher for every lecture"); return false; }
    const incomplete = allSlots.some((s) => !s.subject.trim() || !s.class_name.trim());
    if (incomplete) { toast.error("Add subject and class for every proxy lecture"); return false; }
    const { error: pErr } = await supabase.from("proxy_assignments").insert(
      allSlots.map((s) => {
        const isHodSelf = profile?.id && choices[s.key] === profile.id;
        return { leave_request_id: request.id, lecture_id: s.lecture_id, proxy_teacher_id: choices[s.key], absentee_teacher_id: request.teacher_id, proxy_date: s.date, start_time: s.start_time, end_time: s.end_time, subject: s.subject, class_name: s.class_name, status: isHodSelf ? "accepted" : "pending" };
      }),
    );
    if (pErr) { toast.error(pErr.message); return false; }
    return true;
  }

  async function hodRecommend() {
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase.from("leave_requests").update({ status: "pending_principal", hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Recommended to the principal");
    qc.invalidateQueries();
  }

  async function hodDirectApprove() {
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase.from("leave_requests").update({ status: "hod_approved", doc_status: "required", hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Leave approved — teacher must upload ${requiredDoc}`);
    qc.invalidateQueries();
  }

  async function reject() {
    setBusy(true);
    const patch = isHod
      ? { status: "rejected" as const, hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }
      : { status: "rejected" as const, principal_note: note.trim() || null, principal_acted_at: new Date().toISOString() };
    const { error } = await supabase.from("leave_requests").update(patch).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Leave rejected");
    qc.invalidateQueries();
  }

  async function principalApprove() {
    setBusy(true);
    const total = Number(request.total_days);
    let paidDays: number;
    let unpaidDays: number;
    if (isMedical && medicalSplit) {
      const overQuotaPaid = medicalRequiresDecision ? (payment === "paid" ? medicalSplit.overQuota : 0) : 0;
      paidDays = medicalSplit.withinQuota + overQuotaPaid;
      unpaidDays = total - paidDays;
    } else if (needsDecision) {
      paidDays = payment === "paid" ? total : 0;
      unpaidDays = payment === "unpaid" ? total : 0;
    } else {
      paidDays = Number(request.paid_days);
      unpaidDays = Number(request.unpaid_days);
    }
    const { error } = await supabase.from("leave_requests").update({
      status: "approved", payment_decision: needsDecision ? payment : null,
      paid_days: paidDays, unpaid_days: unpaidDays,
      principal_note: note.trim() || null, principal_acted_at: new Date().toISOString(),
    }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Leave approved");
    qc.invalidateQueries();
  }

  const sessionLabel = SESSION_LABEL[request.session as LeaveSession] ?? request.session;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">{request.teacher?.full_name}</p>
          <p className="text-sm text-muted-foreground">{leaveTypeLabel(request.leave_type as LeaveType)} · {sessionLabel}</p>
          <p className="text-sm text-muted-foreground">{fmtDate(request.from_date)} – {fmtDate(request.to_date)} · {Number(request.total_days)} day(s)</p>
          <p className="text-xs text-muted-foreground mt-0.5">Dates: {dates.map(fmtDate).join(", ")}</p>
        </div>
        <div className="text-right text-sm">
          <StatusBadge status={request.status as LeaveStatus} />
          <p className="mt-2 text-muted-foreground">Paid {Number(request.paid_days)} · <span className="font-semibold text-destructive">Pay cut {Number(request.unpaid_days)}</span></p>
        </div>
      </div>

      {request.reason && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{request.reason}</p>}
      {request.hod_note && !isHod && <p className="mt-2 text-xs text-muted-foreground">HOD note: {request.hod_note}</p>}

      {/* Proxy assignment — HOD only */}
      {isHod && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proxy assignment
            {request.session !== "full_day" && <span className="ml-2 text-info normal-case">({sessionLabel} only)</span>}
          </p>
          {allSlots.length === 0 && (
            <p className="text-sm text-muted-foreground">No lectures found for these dates{request.session !== "full_day" ? ` (${sessionLabel})` : ""}.</p>
          )}
          <ul className="space-y-2">
            {allSlots.map((s) => {
              const options = candidates(s.date, s.start_time, s.end_time);
              const isManual = s.lecture_id === null;
              return (
                <li key={s.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
                  {isManual ? (
                    <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-5">
                      <Input type="date" value={s.date} min={request.from_date} max={request.to_date} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, date: e.target.value } : x))} />
                      <Input type="time" value={s.start_time} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, start_time: e.target.value } : x))} />
                      <Input type="time" value={s.end_time} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, end_time: e.target.value } : x))} />
                      <Input placeholder="Subject" value={s.subject} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, subject: e.target.value } : x))} />
                      <Input placeholder="Class" value={s.class_name} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, class_name: e.target.value } : x))} />
                    </div>
                  ) : (
                    <div className="min-w-52">
                      <p className="font-semibold">{s.subject} · {s.class_name}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                    </div>
                  )}
                  <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                    <SelectTrigger className="w-64"><SelectValue placeholder="Select proxy teacher" /></SelectTrigger>
                    <SelectContent>
                      {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name} {o.free ? "· Free" : "· Busy"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {choices[s.key] && (
                    <Badge variant="secondary">{options.find((o) => o.id === choices[s.key])?.free ? "Available" : "Has a lecture"}</Badge>
                  )}
                  {isManual && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setManual((m) => m.filter((x) => x.key !== s.key))}>Remove</Button>
                  )}
                </li>
              );
            })}
          </ul>
          {/* "Add proxy lecture" only for teacher-applied leaves (not HOD-marked) */}
        </div>
      )}

      {/* Payment decision — Principal only */}
      {!isHod && needsDecision && (
        <div className="mt-4 rounded-lg border border-border p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Salary decision for this {leaveTypeLabel(request.leave_type as LeaveType).toLowerCase()}</p>
          {isMedical && medicalSplit && (
            <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
              <p className="font-semibold">Medical Leave Quota — {MEDICAL_PAID_QUOTA} paid days/year</p>
              <p className="text-muted-foreground">Days already taken: <strong>{medicalDaysTaken}</strong></p>
              <p className="text-muted-foreground">
                This request: <strong>{requestDays}</strong> day(s) — <span className="text-success font-medium">{medicalSplit.withinQuota} within quota</span>
                {medicalSplit.overQuota > 0 && <span className="text-destructive font-medium"> · {medicalSplit.overQuota} over quota</span>}
              </p>
              {!medicalRequiresDecision && <p className="text-success font-medium">✓ All days within paid quota.</p>}
            </div>
          )}
          {(!isMedical || medicalRequiresDecision) && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={payment === "paid" ? "default" : "outline"} onClick={() => setPayment("paid")}>
                {isMedical && medicalSplit?.overQuota ? `Paid — no deduction for ${medicalSplit.overQuota} over-quota day(s)` : "Paid — no deduction"}
              </Button>
              <Button type="button" size="sm" variant={payment === "unpaid" ? "destructive" : "outline"} onClick={() => setPayment("unpaid")}>
                {isMedical && medicalSplit?.overQuota ? `Unpaid — deduct ${medicalSplit.overQuota} over-quota day(s)` : "Unpaid — deduct salary"}
              </Button>
            </div>
          )}
        </div>
      )}

      {isHod && needsDecision && !isHodFinal && (
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-muted p-2">💡 The principal will decide whether this leave is paid or unpaid.</p>
      )}
      {isHod && isHodFinal && (
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-info/8 border border-info/30 p-2">📄 Approving will require the teacher to upload a <strong>{requiredDoc}</strong>.</p>
      )}

      <Textarea className="mt-4" rows={2} maxLength={300} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="mt-3 flex flex-wrap gap-2">
        {isHod && isHodFinal && <Button onClick={hodDirectApprove} disabled={busy}>Approve Leave</Button>}
        {isHod && !isHodFinal && <Button onClick={hodRecommend} disabled={busy}>Approve &amp; send to principal</Button>}
        {!isHod && <Button onClick={principalApprove} disabled={busy}>Approve Leave</Button>}
        <Button variant="outline" onClick={reject} disabled={busy}>Reject</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isHodFinal ? (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span><span>→</span>
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-success/15 text-success"}`}>HOD Approval</span>
            <span>→</span><span className="rounded bg-muted px-2 py-0.5">✅ Approved</span>
            <span>+</span><span className="rounded bg-muted px-2 py-0.5">Upload {requiredDoc}</span>
          </>
        ) : (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span><span>→</span>
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-muted"}`}>HOD</span>
            <span>→</span>
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_principal" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-muted"}`}>Principal</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── DocCard ───────────────────────────────────────────────────────────────────
function DocCard({ request }: { request: RequestRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"paid" | "unpaid">("paid");
  const [busy, setBusy] = useState(false);
  const requiredDoc = docLabel(request.leave_type as LeaveType) ?? "Document";
  const docUploaded = request.doc_status === "uploaded";
  const dates = useMemo(() => eachDate(request.from_date, request.to_date), [request.from_date, request.to_date]);

  async function verifyAndApprove() {
    setBusy(true);
    const total = Number(request.total_days);
    const { error } = await supabase.from("leave_requests").update({
      doc_status: "verified", doc_note: note.trim() || null, doc_acted_at: new Date().toISOString(),
      payment_decision: payment, paid_days: payment === "paid" ? total : 0, unpaid_days: payment === "unpaid" ? total : 0,
      principal_note: note.trim() || null, principal_acted_at: new Date().toISOString(),
    }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Document verified — salary decision saved");
    qc.invalidateQueries();
  }

  async function rejectDoc() {
    setBusy(true);
    const { error } = await supabase.from("leave_requests").update({
      doc_status: "required", doc_note: note.trim() || null, doc_url: null,
      doc_acted_at: new Date().toISOString(), principal_note: note.trim() || null, principal_acted_at: new Date().toISOString(),
    }).eq("id", request.id);
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
          <p className="text-sm text-muted-foreground">{leaveTypeLabel(request.leave_type as LeaveType)} · {SESSION_LABEL[request.session as LeaveSession]}</p>
          <p className="text-sm text-muted-foreground">{fmtDate(request.from_date)} – {fmtDate(request.to_date)} · {Number(request.total_days)} day(s)</p>
          <p className="text-xs text-muted-foreground mt-0.5">Dates: {dates.map(fmtDate).join(", ")}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={docUploaded ? "default" : "secondary"} className={docUploaded ? "bg-info text-info-foreground" : ""}>{docUploaded ? "Document Uploaded" : "Awaiting Upload"}</Badge>
          <span className="text-xs text-muted-foreground">HOD approved</span>
        </div>
      </div>
      {request.reason && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{request.reason}</p>}
      {request.hod_note && <p className="mt-2 text-xs text-muted-foreground">HOD note: {request.hod_note}</p>}
      <div className={`mt-3 rounded-lg border p-3 text-sm ${docUploaded ? "border-info/30 bg-info/8" : "border-warning/30 bg-warning/10"}`}>
        <p className="font-semibold">{docUploaded ? `✅ ${requiredDoc} uploaded` : `⏳ Waiting for ${requiredDoc} upload`}</p>
        {docUploaded && request.doc_url && <ViewDocButton path={request.doc_url} />}
        {!docUploaded && <p className="mt-1 text-xs text-muted-foreground">Leave is approved. This section is for document verification only.</p>}
      </div>
      {docUploaded && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Salary decision</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={payment === "paid" ? "default" : "outline"} onClick={() => setPayment("paid")}>Paid — no deduction</Button>
            <Button type="button" size="sm" variant={payment === "unpaid" ? "destructive" : "outline"} onClick={() => setPayment("unpaid")}>Unpaid — deduct salary</Button>
          </div>
        </div>
      )}
      <Textarea className="mt-4" rows={2} maxLength={300} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        {docUploaded && <Button onClick={verifyAndApprove} disabled={busy}>Verify Document</Button>}
        <Button variant="outline" onClick={rejectDoc} disabled={busy || !docUploaded}>Reject Document</Button>
      </div>
      {docUploaded && <p className="mt-2 text-xs text-muted-foreground">Rejecting sends it back to the teacher to re-upload. The leave itself remains approved.</p>}
    </div>
  );
}

function ViewDocButton({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    const storagePath = path.includes("/object/public/leave-docs/") ? path.split("/object/public/leave-docs/")[1] : path.includes("/object/sign/leave-docs/") ? path.split("/object/sign/leave-docs/")[1] : path;
    setLoading(true);
    const { data, error } = await supabase.storage.from("leave-docs").createSignedUrl(decodeURIComponent(storagePath), 60);
    setLoading(false);
    if (error || !data?.signedUrl) return toast.error("Could not open document");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  return <button onClick={open} disabled={loading} className="mt-1 inline-block text-xs underline text-info disabled:opacity-50">{loading ? "Opening…" : "View document ↗"}</button>;
}
