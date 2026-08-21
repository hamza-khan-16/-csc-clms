import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatusBadge, Empty, ListSkeleton } from "@/components/ui-bits";
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
import { AlertCircle, LockKeyhole, Lightbulb, FileText, CheckCircle2, Clock, ChevronRight } from "lucide-react";
import { validateMeaningfulText, liveTextHint } from "@/lib/validateText";
import { GuardedTextarea } from "@/components/GuardedField";
import { useServerFn } from "@tanstack/react-start";
import { sendPushNotification } from "@/lib/push.functions";
import { unlockAccount } from "@/lib/admin.functions";

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
      // Exclude principal and admin — they are not teaching staff
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("department_id", deptId)
        .eq("approved", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []).filter((p) => !excludedIds.has(p.id));
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
    queryKey: ["dept-all-for-proxy", deptId, teacherId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      const { data } = await supabase.from("profiles").select("id, full_name")
        .eq("department_id", deptId).eq("approved", true).order("full_name");
      return (data ?? []).filter((p) => p.id !== teacherId && !excludedIds.has(p.id));
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
    if (reason.trim()) {
      const check = validateMeaningfulText(reason, "Reason");
      if (!check.valid) return toast.error(check.error!);
    }

    const missingProxy = allProxySlots.filter((s) => !choices[s.key]);
    if (missingProxy.length > 0) return toast.error("Assign a proxy for every lecture before submitting");
    const incompleteManual = manualSlots.some((s) => !s.subject.trim() || !s.class_name.trim());
    if (incompleteManual) return toast.error("Fill subject and class for every manual proxy slot");

    setBusy(true);

    // 1. Count working days
    const { data: holidays = [] } = await supabase.from("holidays").select("holiday_date");
    const holidaySet = new Set((holidays ?? []).map((h: any) => h.holiday_date));
    const { total: totalDays, workingDates, purelyNonWorking } = countWorkingDays(fromDate, toDate, session, holidaySet);

    if (purelyNonWorking) { setBusy(false); return toast.error("Cannot mark leave for a date that is only a Sunday or public holiday. Please select at least one working day."); }

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
          status: (choices[s.key] === profile?.id ? "accepted" : "pending") as "accepted" | "pending",
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
          <Input className="h-9 text-sm" placeholder="Reason for leave…" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
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
                  <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-5">
                    <Input type="date" value={s.date} min={fromDate} max={toDate} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, date: e.target.value } : x))} className="h-8 text-xs" />
                    <Input type="time" value={s.start_time} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, start_time: e.target.value } : x))} className="h-8 text-xs" />
                    <Input type="time" value={s.end_time} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, end_time: e.target.value } : x))} className="h-8 text-xs" />
                    <Input placeholder="Subject" value={s.subject} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, subject: e.target.value } : x))} className="h-8 text-xs" />
                    <Input placeholder="Class" value={s.class_name} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, class_name: e.target.value } : x))} className="h-8 text-xs" />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs">{s.subject} · {s.class_name}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                  </div>
                )}
                <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                  <SelectTrigger className="w-full sm:w-52 h-8 text-xs"><SelectValue placeholder="Select proxy…" /></SelectTrigger>
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

// ── Locked Accounts Panel ─────────────────────────────────────────────────────
// Principal: sees locked teachers AND locked HODs (not principals)
// Admin: sees everyone — handled in admin.tsx
// HOD: does NOT get a locked accounts panel (their locks go to Principal/Admin)
function LockedAccountsPanel({ role, deptId }: { role: "hod" | "principal"; deptId: string | null }) {
  const qc = useQueryClient();
  const unlockFn = useServerFn(unlockAccount);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // All hooks must run before any conditional return (React rules of hooks)
  const { data: locked = [], isLoading } = useQuery({
    queryKey: ["locked-accounts", role, deptId],
    enabled: role === "principal", // HODs never manage locked accounts
    queryFn: async () => {
      const targetRoles = ["teacher", "hod"] as const; // principal can unlock teachers & HODs
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id, department_id, role")
        .in("role", targetRoles);
      if (!roleRows || roleRows.length === 0) return [];

      const userIds = roleRows.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, user_id, designation, department_id, failed_login_attempts, account_locked")
        .in("id", userIds)
        .eq("account_locked", true);

      const deptIds = [...new Set((profiles ?? []).map((p: any) => p.department_id).filter(Boolean))];
      let deptMap: Record<string, string> = {};
      if (deptIds.length > 0) {
        const { data: depts } = await supabase.from("departments").select("id, name").in("id", deptIds);
        deptMap = Object.fromEntries((depts ?? []).map((d) => [d.id, d.name]));
      }
      const roleByUser = Object.fromEntries(roleRows.map((r) => [r.user_id, r.role]));
      return (profiles ?? []).map((p: any) => ({
        ...p,
        department_name: deptMap[p.department_id] ?? null,
        role: roleByUser[p.id] ?? "teacher",
      }));
    },
  });

  // HODs do not manage locked accounts — only Principal/Admin do
  if (role === "hod") return null;

  async function handleUnlock(userId: string) {
    const newPw = resetPasswords[userId] ?? "";
    if (newPw && newPw.length < 12) return toast.error("New password must be at least 12 characters");
    setBusyId(userId);
    try {
      await unlockFn({ data: { targetUserId: userId, newPassword: newPw || undefined } });
      toast.success(newPw ? "Account unlocked and password reset" : "Account unlocked");
      setResetPasswords((p) => { const next = { ...p }; delete next[userId]; return next; });
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) return null;
  if (locked.length === 0) return null;

  return (
    <SectionCard
      title="Locked Accounts"
      subtitle={`${locked.length} account${locked.length !== 1 ? "s" : ""} locked due to failed login attempts`}
    >
      <div className="space-y-3">
        {locked.map((person: any) => (
          <div key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-destructive/15">
                <LockKeyhole className="size-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">{person.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {person.user_id} · {person.department_name ?? "—"} · <span className="capitalize font-medium">{person.role}</span> · {person.failed_login_attempts} failed attempt{person.failed_login_attempts !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">New password (optional)</label>
                <Input
                  type="password"
                  placeholder="Leave blank to just unlock…"
                  className="h-8 text-sm w-56"
                  value={resetPasswords[person.id] ?? ""}
                  onChange={(e) => setResetPasswords((p) => ({ ...p, [person.id]: e.target.value }))}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === person.id}
                onClick={() => handleUnlock(person.id)}
              >
                {busyId === person.id ? "Unlocking…" : "Unlock"}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        You can unlock without setting a new password — the staff member will need to contact you to reset their password separately. Or set a temporary password here.
      </p>
    </SectionCard>
  );
}

// ── Requests page ─────────────────────────────────────────────────────────────
function RequestsPage() {
  const sendPush = useServerFn(sendPushNotification);
  const { profile, role } = useAuth();
  const isHod = role === "hod";
  const qc = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["review-requests", role, profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id, role")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((adminRoles ?? []).map((r) => r.user_id));
      let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
      if (isHod) {
        q = q.eq("department_id", profile!.department_id ?? "");
      } else {
        // Principal sees leaves that:
        // 1. Are in the principal's workflow (recommended/pending/hod_approved/approved)
        // 2. Were rejected BUT by the principal themselves (principal_acted_at is set)
        // HOD-rejected leaves (rejected + hod_acted_at set + principal_acted_at null) stay with HOD only
        q = q.or(
          "status.in.(hod_recommended,pending_principal,hod_approved,approved)," +
          "and(status.eq.rejected,principal_acted_at.not.is.null)"
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      const filtered = (data ?? []).filter((r) => !excludedIds.has(r.teacher_id));
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

  const [searchQ, setSearchQ] = useState("");
  const filteredRest = useMemo(() => {
    if (!searchQ.trim()) return rest;
    const q = searchQ.toLowerCase();
    return rest.filter((r) =>
      r.teacher?.full_name?.toLowerCase().includes(q) ||
      r.leave_type?.toLowerCase().includes(q) ||
      r.status?.toLowerCase().includes(q)
    );
  }, [rest, searchQ]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const newStatus = isHod ? "hod_approved" : "approved";
      const { error } = await supabase
        .from("leave_requests")
        .update({ status: newStatus })
        .in("id", Array.from(selectedIds));
      if (error) { toast.error(error.message); return; }
      toast.success(`${selectedIds.size} request(s) approved`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["review-requests", role, profile?.id] });
    } finally {
      setBulkBusy(false);
    }
  }

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

        {/* HOD: Dept leave calendar — who's on leave today */}
        {isHod && profile?.department_id && (
          <DeptLeaveToday deptId={profile.department_id} />
        )}

        {/* Locked accounts — Principal sees locked teachers + HODs; HOD sees nothing (admin/principal handles it) */}
        {(isHod || role === "principal") && (
          <LockedAccountsPanel
            role={isHod ? "hod" : "principal"}
            deptId={profile?.department_id ?? null}
          />
        )}

        <SectionCard
          title="Needs your action"
          subtitle={`${actionable.length} request(s)`}
          action={
            actionable.length > 1 ? (
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <Button size="sm" disabled={bulkBusy} onClick={bulkApprove}>
                    Approve {selectedIds.size} selected
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() =>
                  setSelectedIds(selectedIds.size === actionable.length ? new Set() : new Set(actionable.map((r) => r.id)))
                }>
                  {selectedIds.size === actionable.length ? "Deselect all" : "Select all"}
                </Button>
              </div>
            ) : undefined
          }
        >
          {isLoading ? <ListSkeleton rows={3} />
            : actionable.length === 0 ? <Empty illustration="check">Nothing waiting on you right now.</Empty>
            : <div className="space-y-4">{actionable.map((r) => (
                <div key={r.id} className="relative">
                  {actionable.length > 1 && (
                    <input
                      type="checkbox"
                      className="absolute right-3 top-3 z-10 size-4 cursor-pointer accent-primary"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                    />
                  )}
                  <RequestCard request={r} isHod={isHod} />
                </div>
              ))}</div>}
        </SectionCard>

        {!isHod && docPending.length > 0 && (
          <SectionCard title="Documents Remaining" subtitle={`${docPending.length} leave(s) awaiting document upload or verification`}>
            <div className="space-y-4">{docPending.map((r) => <DocCard key={r.id} request={r} />)}</div>
          </SectionCard>
        )}

        <SectionCard
          title="All requests"
          action={
            <div className="relative">
              <input
                className="h-8 w-48 rounded-lg border border-border bg-muted/50 pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Search by name…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              <svg className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </div>
          }
        >
          {rest.length === 0 ? <Empty illustration="check">No other requests.</Empty> : filteredRest.length === 0 ? (
            <Empty illustration="search">No requests match "{searchQ}".</Empty>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="space-y-3 sm:hidden">
                {filteredRest.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{r.teacher?.full_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{leaveTypeLabel(r.leave_type as LeaveType)}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(r.from_date)} – {fmtDate(r.to_date)} · {Number(r.total_days)} day(s)</p>
                        {Number(r.unpaid_days) > 0 && (
                          <p className="text-xs font-semibold text-destructive">Pay cut: {Number(r.unpaid_days)} day(s)</p>
                        )}
                      </div>
                      <StatusBadge status={r.status as LeaveStatus} />
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4 font-semibold">Teacher</th>
                      <th className="pb-2 pr-4 font-semibold">Type</th>
                      <th className="pb-2 pr-4 font-semibold whitespace-nowrap">Dates</th>
                      <th className="pb-2 pr-4 font-semibold">Days</th>
                      <th className="pb-2 pr-4 font-semibold whitespace-nowrap">Pay Cut</th>
                      <th className="pb-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRest.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="py-3 pr-4 font-medium whitespace-nowrap">{r.teacher?.full_name}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{leaveTypeLabel(r.leave_type as LeaveType)}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{fmtDate(r.from_date)} – {fmtDate(r.to_date)}</td>
                        <td className="py-3 pr-4">{Number(r.total_days)}</td>
                        <td className="py-3 pr-4">{Number(r.unpaid_days)}</td>
                        <td className="py-3"><StatusBadge status={r.status as LeaveStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
  const sendPush = useServerFn(sendPushNotification);
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
      // Exclude principal and admin from proxy candidates
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      let pq = supabase.from("profiles").select("id, full_name, designation").eq("approved", true);
      if (request.department_id) pq = pq.eq("department_id", request.department_id);
      const { data: people, error } = await pq.neq("id", request.teacher_id).order("full_name");
      if (error) throw error;

      const filteredPeople = (people ?? []).filter((p) => !excludedIds.has(p.id));
      const teacherIds = filteredPeople.map((p) => p.id);
      const { data: lectures } = teacherIds.length ? await supabase.from("lectures").select("teacher_id, day_of_week, start_time, end_time").in("teacher_id", teacherIds).is("lecture_date", null) : { data: [] };
      const { data: existingProxies } = teacherIds.length ? await supabase.from("proxy_assignments").select("proxy_teacher_id, proxy_date, start_time, end_time").in("proxy_teacher_id", teacherIds).in("status", ["pending", "accepted"]).gte("proxy_date", request.from_date).lte("proxy_date", request.to_date) : { data: [] };
      return { people: filteredPeople, lectures: lectures ?? [], existingProxies: existingProxies ?? [] };
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
        return { leave_request_id: request.id, lecture_id: s.lecture_id, proxy_teacher_id: choices[s.key], absentee_teacher_id: request.teacher_id, proxy_date: s.date, start_time: s.start_time, end_time: s.end_time, subject: s.subject, class_name: s.class_name, status: (isHodSelf ? "accepted" : "pending") as "accepted" | "pending" };
      }),
    );
    if (pErr) { toast.error(pErr.message); return false; }

    // Notify each unique proxy teacher (fire-and-forget)
    const uniqueProxyTeachers = [...new Set(allSlots.map((s) => choices[s.key]).filter(Boolean))];
    const absenteeName = request.teacher_name ?? "a colleague";
    for (const proxyId of uniqueProxyTeachers) {
      const slot = allSlots.find((s) => choices[s.key] === proxyId);
      if (slot) {
<<<<<<< HEAD
        sendPush({ data: { userIds: [proxyId], title: "Proxy Lecture Assigned", body: `Cover ${slot.subject} for ${absenteeName} on ${slot.date}`, targetUrl: "/proxies" } }).catch((e) => console.error("[Push] proxy:", e));
=======
        sendPush({ data: { userIds: [proxyId], title: "Proxy Lecture Assigned", body: `Cover ${slot.subject} for ${absenteeName} on ${slot.date}`, targetUrl: "/proxies" } }).catch(() => {});
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
      }
    }
    return true;
  }

  function checkNote(): boolean {
    if (!note.trim()) return true; // notes are optional — only validate if filled
    const r = validateMeaningfulText(note, "Note");
    if (!r.valid) { toast.error(r.error!); return false; }
    return true;
  }

  async function hodRecommend() {
    if (!checkNote()) return;
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase.from("leave_requests").update({ status: "pending_principal", hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Recommended to the principal");
    // Notify principal a leave is awaiting their approval
    if (profile?.department_id) {
      // Notify principal (fire-and-forget) — they need to find principal by role server-side
<<<<<<< HEAD
      sendPush({ data: { userIds: ["__principal__"], title: "Leave Awaiting Your Approval", body: `${request.teacher?.full_name ?? "A teacher"}'s ${request.leave_type} leave has been approved by HOD`, targetUrl: "/requests" } }).catch((e) => console.error("[Push] hod→principal:", e));
=======
      sendPush({ data: { userIds: ["__principal__"], title: "Leave Awaiting Your Approval", body: `${request.teacher?.full_name ?? "A teacher"}'s ${request.leave_type} leave has been approved by HOD`, targetUrl: "/requests" } }).catch(() => {});
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
    }
    qc.invalidateQueries();
  }

  async function hodDirectApprove() {
    if (!checkNote()) return;
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase.from("leave_requests").update({ status: "hod_approved", doc_status: "required", hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Leave approved — teacher must upload ${requiredDoc}`);
    // Notify teacher their leave was approved
<<<<<<< HEAD
    sendPush({ data: { userIds: [request.teacher_id], title: "Leave Approved ✓", body: `Your ${request.leave_type} leave for ${request.total_days} day(s) has been approved`, targetUrl: "/leaves" } }).catch((e) => console.error("[Push] hodDirectApprove:", e));
=======
    sendPush({ data: { userIds: [request.teacher_id], title: "Leave Approved ✓", body: `Your ${request.leave_type} leave for ${request.total_days} day(s) has been approved`, targetUrl: "/leaves" } }).catch(() => {});
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
    qc.invalidateQueries();
  }

  async function reject() {
    if (!checkNote()) return;
    setBusy(true);
    const patch = isHod
      ? {
          status: "rejected" as const,
          hod_note: note.trim() || null,
          hod_acted_at: new Date().toISOString(),
          // Ensure principal_acted_at stays null so we can distinguish HOD-rejected vs principal-rejected
          principal_acted_at: null as string | null,
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
    // Notify teacher their leave was rejected
<<<<<<< HEAD
    sendPush({ data: { userIds: [request.teacher_id], title: "Leave Rejected", body: note.trim() ? `Your ${request.leave_type} leave was rejected: ${note.trim()}` : `Your ${request.leave_type} leave request has been rejected`, targetUrl: "/leaves" } }).catch((e) => console.error("[Push] reject:", e));
=======
    sendPush({ data: { userIds: [request.teacher_id], title: "Leave Rejected", body: note.trim() ? `Your ${request.leave_type} leave was rejected: ${note.trim()}` : `Your ${request.leave_type} leave request has been rejected`, targetUrl: "/leaves" } }).catch(() => {});
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
    qc.invalidateQueries();
  }

  async function principalApprove() {
    if (!checkNote()) return;
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
    // Notify teacher their leave was approved by principal
<<<<<<< HEAD
    sendPush({ data: { userIds: [request.teacher_id], title: "Leave Approved ✓", body: `Your ${request.leave_type} leave for ${request.total_days} day(s) has been approved`, targetUrl: "/leaves" } }).catch((e) => console.error("[Push] principalApprove:", e));
=======
    sendPush({ data: { userIds: [request.teacher_id], title: "Leave Approved ✓", body: `Your ${request.leave_type} leave for ${request.total_days} day(s) has been approved`, targetUrl: "/leaves" } }).catch(() => {});
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
    qc.invalidateQueries();
  }

  const sessionLabel = SESSION_LABEL[request.session as LeaveSession] ?? request.session;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="font-bold">{request.teacher?.full_name}</p>
          <p className="text-sm text-muted-foreground">{leaveTypeLabel(request.leave_type as LeaveType)} · {sessionLabel}</p>
          <p className="text-sm text-muted-foreground">{fmtDate(request.from_date)} – {fmtDate(request.to_date)} · {Number(request.total_days)} day(s)</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">Dates: {dates.map(fmtDate).join(", ")}</p>
        </div>
        <div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:text-right sm:text-sm">
          <StatusBadge status={request.status as LeaveStatus} />
          <p className="text-xs sm:text-sm text-muted-foreground sm:mt-2">Paid {Number(request.paid_days)} · <span className="font-semibold text-destructive">Pay cut {Number(request.unpaid_days)}</span></p>
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
                    <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-5">
                      <Input type="date" value={s.date} min={request.from_date} max={request.to_date} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, date: e.target.value } : x))} />
                      <Input type="time" value={s.start_time} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, start_time: e.target.value } : x))} />
                      <Input type="time" value={s.end_time} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, end_time: e.target.value } : x))} />
                      <Input placeholder="Subject" value={s.subject} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, subject: e.target.value } : x))} />
                      <Input placeholder="Class" value={s.class_name} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, class_name: e.target.value } : x))} />
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.subject} · {s.class_name}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                    </div>
                  )}
                  <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                    <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Select proxy teacher" /></SelectTrigger>
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
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-muted p-2 flex items-center gap-1.5"><Lightbulb className="size-3 shrink-0" /> The principal will decide whether this leave is paid or unpaid.</p>
      )}
      {isHod && isHodFinal && (
        <p className="mt-3 text-xs text-muted-foreground rounded-lg bg-info/8 border border-info/30 p-2 flex items-center gap-1.5"><FileText className="size-3 shrink-0" /> Approving will require the teacher to upload a <strong>{requiredDoc}</strong>.</p>
      )}

      <GuardedTextarea fieldName="Note" className="mt-4" rows={2} maxLength={300} placeholder="Add a note (optional)" value={note} onChange={setNote} />
      <p className="text-right text-xs text-muted-foreground mt-1">{note.length}/300</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {isHod && isHodFinal && <Button onClick={hodDirectApprove} disabled={busy}>Approve Leave</Button>}
        {isHod && !isHodFinal && <Button onClick={hodRecommend} disabled={busy}>Approve &amp; send to principal</Button>}
        {!isHod && <Button onClick={principalApprove} disabled={busy}>Approve Leave</Button>}
        <Button variant="outline" onClick={reject} disabled={busy}>Reject</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isHodFinal ? (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span><ChevronRight className="size-3" />
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-success/15 text-success"}`}>HOD Approval</span>
            <ChevronRight className="size-3" /><span className="rounded bg-muted px-2 py-0.5 inline-flex items-center gap-1"><CheckCircle2 className="size-3 text-success" /> Approved</span>
            <span>+</span><span className="rounded bg-muted px-2 py-0.5">Upload {requiredDoc}</span>
          </>
        ) : (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span><ChevronRight className="size-3" />
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning-foreground" : "bg-muted"}`}>HOD</span>
            <ChevronRight className="size-3" />
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="font-bold">{request.teacher?.full_name}</p>
          <p className="text-sm text-muted-foreground">{leaveTypeLabel(request.leave_type as LeaveType)} · {SESSION_LABEL[request.session as LeaveSession]}</p>
          <p className="text-sm text-muted-foreground">{fmtDate(request.from_date)} – {fmtDate(request.to_date)} · {Number(request.total_days)} day(s)</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">Dates: {dates.map(fmtDate).join(", ")}</p>
        </div>
        <div className="flex flex-row items-center justify-between sm:flex-col sm:items-end gap-1">
          <Badge variant={docUploaded ? "default" : "secondary"} className={docUploaded ? "bg-info text-info-foreground" : ""}>{docUploaded ? "Document Uploaded" : "Awaiting Upload"}</Badge>
          <span className="text-xs text-muted-foreground">HOD approved</span>
        </div>
      </div>
      {request.reason && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{request.reason}</p>}
      {request.hod_note && <p className="mt-2 text-xs text-muted-foreground">HOD note: {request.hod_note}</p>}
      <div className={`mt-3 rounded-lg border p-3 text-sm ${docUploaded ? "border-info/30 bg-info/8" : "border-warning/30 bg-warning/10"}`}>
        <p className="font-semibold flex items-center gap-1.5">{docUploaded ? <><CheckCircle2 className="size-4 text-info" /> {requiredDoc} uploaded</> : <><Clock className="size-4 text-warning-foreground" /> Waiting for {requiredDoc} upload</>}</p>
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
      <GuardedTextarea fieldName="Note" className="mt-4" rows={2} maxLength={300} placeholder="Add a note (optional)" value={note} onChange={setNote} />
      <p className="text-right text-xs text-muted-foreground mt-1">{note.length}/300</p>
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

function DeptLeaveToday({ deptId }: { deptId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: onLeave = [] } = useQuery({
    queryKey: ["dept-on-leave-today", deptId, today],
    staleTime: 60_000,
    queryFn: async () => {
      // leave_requests.teacher_id references auth.users, not public.profiles,
      // so PostgREST cannot auto-join profiles(full_name). Fetch separately.
      const { data: leaves } = await supabase
        .from("leave_requests")
        .select("teacher_id, leave_type, from_date, to_date, status")
        .eq("department_id", deptId)
        .in("status", ["approved", "hod_approved"])
        .lte("from_date", today)
        .gte("to_date", today);

      if (!leaves || leaves.length === 0) return [];

      const teacherIds = [...new Set(leaves.map((l) => l.teacher_id))];
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", teacherIds);

      const nameMap = Object.fromEntries(
        (profileRows ?? []).map((p) => [p.id, p.full_name])
      );

      return leaves.map((l) => ({
        name: nameMap[l.teacher_id] ?? "Unknown",
        leave_type: l.leave_type,
        from_date: l.from_date,
        to_date: l.to_date,
      }));
    },
  });

  if (onLeave.length === 0) return null;

  return (
    <SectionCard
      title="On leave today"
      subtitle={`${onLeave.length} teacher(s) absent`}
    >
      <ul className="space-y-2">
        {onLeave.map((t, i) => (
          <li key={i} className="flex items-center justify-between text-sm">
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground capitalize">{t.leave_type.replace(/_/g, " ")}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
