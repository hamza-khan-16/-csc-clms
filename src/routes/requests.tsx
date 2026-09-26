import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { haptic } from "@/lib/haptics";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatusBadge, Empty, ListSkeleton, Pagination } from "@/components/ui-bits";
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
  casualNeedsDecision,
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
import { AlertCircle, Check, CheckCircle2, ChevronRight, Clock, FileText, Gift, Lightbulb, LockKeyhole, Loader2, MessageCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { GuardedInput, GuardedTextarea, type GuardHandle } from "@/components/GuardedField";
import { groqModerationCheck, localBlocklistCheck } from "@/lib/textGuard";
import { useServerFn } from "@tanstack/react-start";
import { firePush } from "@/lib/push.functions";
import { directPasswordReset, fetchHodPasswordResetRequests, completeHodPasswordResetRequest } from "@/lib/admin.functions";
import { unlockAccount } from "@/lib/admin.functions";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
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
  const t = useT();
    const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const [teacherId, setTeacherId] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [session, setSession] = useState<LeaveSession>("full_day");
  const [reason, setReason] = useState("");
  const reasonGuardRef = useRef<GuardHandle>(null);
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
        .eq("hr_approved", true)
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
    queryKey: ["dept-all-for-proxy", deptId, teacherId, fromDate, toDate],
    enabled: !!deptId,
    queryFn: async () => {
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      const { data } = await supabase.from("profiles").select("id, full_name")
        .eq("department_id", deptId).eq("approved", true).eq("hr_approved", true).order("full_name");

      const candidates = (data ?? []).filter((p) => p.id !== teacherId && !excludedIds.has(p.id));
      const candidateIds = candidates.map((p) => p.id);

      // Exclude teachers who have active/pending leaves overlapping the selected dates
      const { data: activeLeaves } = candidateIds.length && fromDate && toDate ? await supabase
        .from("leave_requests")
        .select("teacher_id")
        .in("teacher_id", candidateIds)
        .not("status", "in", "(rejected,cancelled)")
        .lte("from_date", toDate)
        .gte("to_date", fromDate) : { data: [] };
      const teachersOnLeave = new Set((activeLeaves ?? []).map((l: any) => l.teacher_id));

      return candidates.filter((p) => !teachersOnLeave.has(p.id));
    },
  });

  const allProxySlots = useMemo(() => [
    ...autoSlots.map((s) => ({ ...s, isManual: false })),
    ...manualSlots.map((s) => ({ ...s, lecture_id: "", isManual: true })),
  ], [autoSlots, manualSlots]);

  function addManualSlot(_date?: string) {
    const slotDate = _date ?? fromDate;
    setManualSlots((m) => [...m, { key: `manual-${Date.now()}`, date: slotDate, start_time: "09:00", end_time: "10:00", subject: "", class_name: "" }]);
  }

  function isHolidayOrSunday(date: string, holidaySet?: Set<string>): boolean {
    if (new Date(date + "T00:00:00").getDay() === 0) return true;
    // Use holidaySet if provided (populated at submit time from the DB)
    if (holidaySet && holidaySet.has(date)) return true;
    return false;
  }

  async function submit() {
    if (!teacherId) return toast.error("Select a teacher");
    if (!fromDate || !toDate) return toast.error("Select dates");
    if (toDate < fromDate) return toast.error("To date must be after from date");
    if (overlap) return toast.error(`This teacher already has an active leave from ${fmtDate(overlap.from_date)} to ${fmtDate(overlap.to_date)}`);
    if (session !== "full_day" && fromDate !== toDate) return toast.error("Half-day leave must be a single date");
    if (reason.trim()) {
      const guardErr = await reasonGuardRef.current?.validateNow();
      if (guardErr) return; // error already shown inline
    }

    const missingProxy = allProxySlots.filter((s) => !choices[s.key]);
    // Not mandatory — unassigned slots become empty class, shown in reports
    const incompleteManual = manualSlots.some((s) => !s.subject.trim() || !s.class_name.trim());
    if (incompleteManual) return toast.error("Fill subject and class for every manual proxy slot");

    // Moderate free-text fields in manual slots
    const manualTexts = manualSlots.flatMap((s) => [s.subject.trim(), s.class_name.trim()].filter(Boolean));
    for (const text of manualTexts) {
      if (localBlocklistCheck(text)) { toast.error("Please use appropriate language in subject and class fields"); return; }
    }
    for (const text of manualTexts) {
      const abusive = await groqModerationCheck(text);
      if (abusive) { toast.error("Please use appropriate language in subject and class fields"); return; }
    }

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
    const unassigned = allProxySlots.filter((s) => !choices[s.key]).length;
    const teacherName = teachers.find((t) => t.id === teacherId)?.full_name;
    toast.success(`Leave marked for ${teacherName} — sent to principal for approval`);
    if (unassigned > 0) toast.info(`${unassigned} lecture${unassigned > 1 ? "s" : ""} left unassigned — will appear as empty class in reports`);
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
          <GuardedInput ref={reasonGuardRef} fieldName="Reason" className="h-9 text-sm" placeholder="Reason for leave…" value={reason} onChange={setReason} maxLength={200} />
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
              <li key={s.key} className="rounded-lg border border-border bg-background p-3 space-y-2 text-sm">
                {s.isManual ? (
                  <>
                    {/* Row 1: date + time range */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Input type="date" value={s.date} min={fromDate} max={toDate} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, date: e.target.value } : x))} className="h-8 text-xs col-span-2 sm:col-span-1" />
                      <Input type="time" value={s.start_time} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, start_time: e.target.value } : x))} className="h-8 text-xs" />
                      <Input type="time" value={s.end_time} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, end_time: e.target.value } : x))} className="h-8 text-xs" />
                    </div>
                    {/* Row 2: subject + class */}
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Subject" value={s.subject} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, subject: e.target.value } : x))} className="h-8 text-xs" />
                      <Input placeholder="Class" value={s.class_name} onChange={(e) => setManualSlots((m) => m.map((x) => x.key === s.key ? { ...x, class_name: e.target.value } : x))} className="h-8 text-xs" />
                    </div>
                    {/* Row 3: proxy picker + remove */}
                    <div className="flex gap-2 items-center">
                      <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select proxy…" /></SelectTrigger>
                        <SelectContent>
                          {deptPeople.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="ghost" size="sm" className="h-8 text-xs px-2 shrink-0" onClick={() => setManualSlots((m) => m.filter((x) => x.key !== s.key))}>Remove</Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-xs">{s.subject} · {s.class_name}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                    </div>
                    <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                      <SelectTrigger className="w-full sm:w-52 h-8 text-xs"><SelectValue placeholder="Select proxy…" /></SelectTrigger>
                      <SelectContent>
                        {deptPeople.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => addManualSlot()}>+ Add proxy lecture</Button>
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
// ── HOD: Password Reset Requests Panel ───────────────────────────────────────
function HodPasswordResetRequests({ deptId }: { deptId: string }) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(fetchHodPasswordResetRequests);
  const completeFn = useServerFn(completeHodPasswordResetRequest);
  const resetFn = useServerFn(directPasswordReset);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["hod-pw-reset-requests", deptId],
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: () => fetchFn(),
  });

  // Per-request state: password typed, whether reset was successfully done
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({});
  const [resetDone, setResetDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [waSending, setWaSending] = useState<string | null>(null);

  async function handleReset(req: { id: string; teacher_id: string; full_name: string }) {
    const pw = tempPasswords[req.id]?.trim();
    if (!pw || pw.length < 12) return toast.error("Temporary password must be at least 12 characters");
    setBusy(req.id);
    try {
      await resetFn({ data: { targetUserId: req.teacher_id, newPassword: pw } });
      // Mark reset as done for this request — unlocks WhatsApp button
      setResetDone((prev) => ({ ...prev, [req.id]: true }));
      toast.success(`Password reset for ${req.full_name} — now send it via WhatsApp`);
    } catch (e: any) {
      toast.error(e?.message ?? "Reset failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSendWhatsApp(req: { id: string; teacher_id: string; full_name: string }) {
    const pw = tempPasswords[req.id]?.trim();
    if (!pw) return;
    setWaSending(req.id);
    try {
      // Fetch phone
      const { data: profile } = await supabase
        .from("profiles").select("phone").eq("id", req.teacher_id).maybeSingle();
      const phone = (profile as any)?.phone ?? "";
      if (!phone) {
        toast.error("No mobile number on file for this teacher");
        setWaSending(null);
        return;
      }
      const digits = phone.replace(/\D/g, "");
      const intl = digits.startsWith("91") ? digits : `91${digits}`;
      const msg = encodeURIComponent(
        `Dear ${req.full_name},\n\nYour CSC LMS password has been reset by your HOD.\n\nTemporary password: ${pw}\n\nPlease log in and change your password immediately from your Profile page.\n\nRegards,\nChandrabhan Sharma College`
      );
      window.open(`https://wa.me/${intl}?text=${msg}`, "_blank");

      // Mark request as completed — removes from list, prevents repeat sends
      await completeFn({ data: { requestId: req.id } });
      toast.success("WhatsApp opened — request marked as completed");

      // Clean up local state
      setTempPasswords((p) => { const n = { ...p }; delete n[req.id]; return n; });
      setResetDone((p) => { const n = { ...p }; delete n[req.id]; return n; });
      qc.invalidateQueries({ queryKey: ["hod-pw-reset-requests"] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "staff" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to complete request");
    } finally {
      setWaSending(null);
    }
  }

  if (isLoading || requests.length === 0) return null;

  return (
    <SectionCard
      title="Password Reset Requests"
      subtitle={`${requests.length} pending from your department`}
    >
      <ul className="space-y-4">
        {requests.map((req: any) => {
          const pw = tempPasswords[req.id] ?? "";
          const pwOk = pw.trim().length >= 12;
          const didReset = !!resetDone[req.id];
          return (
            <li key={req.id} className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
              <div>
                <p className="font-semibold text-sm">{req.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  College ID: {req.college_id} · Requested: {new Date(req.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
              </div>

              {/* Step 1: Set + Reset */}
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Set temporary password (min 12 chars)"
                  className="flex-1 h-9 text-sm font-mono"
                  value={pw}
                  onChange={(e) => {
                    setTempPasswords((p) => ({ ...p, [req.id]: e.target.value }));
                    // If they change the password after reset, require reset again
                    if (resetDone[req.id]) setResetDone((p) => ({ ...p, [req.id]: false }));
                  }}
                  autoComplete="off"
                  disabled={didReset}
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0"
                  variant={didReset ? "outline" : "default"}
                  disabled={busy === req.id || !pwOk || didReset}
                  onClick={() => handleReset(req)}
                >
                  {busy === req.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : didReset ? "✓ Reset done" : "Reset password"
                  }
                </Button>
              </div>

              {/* Step 2: Send via WhatsApp — only enabled after reset confirmed */}
              <div className="space-y-1">
                <Button
                  size="sm"
                  className={`w-full gap-2 ${didReset ? "bg-[#25D366] hover:bg-[#20bc5a] text-white" : ""}`}
                  variant={didReset ? "default" : "outline"}
                  disabled={!didReset || waSending === req.id}
                  onClick={() => handleSendWhatsApp(req)}
                >
                  {waSending === req.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <MessageCircle className="size-4" />
                  }
                  {didReset ? "Send via WhatsApp (completes request)" : "Reset password first to unlock WhatsApp"}
                </Button>
                {!didReset && pwOk && (
                  <p className="text-xs text-muted-foreground text-center">
                    Click "Reset password" above first, then WhatsApp will be unlocked.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function RequestsPage() {
  const t = useT();
  const { profile, role } = useAuth();
  const isHod = role === "hod";
  const qc = useQueryClient();

  // Admin has no leave approval authority — only HOD and Principal do
  if (role === "admin") return (
    <AppShell title={t("nav.requests")}>
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center px-6">
        <p className="text-muted-foreground text-sm">Leave approvals are handled by the HOD and Principal. Admins do not have approval authority.</p>
      </div>
    </AppShell>
  );

  // Compensation assignments awaiting HOD approval for this dept
  const { data: pendingCompApprovals = [] } = useQuery({
    queryKey: ["hod-comp-approvals", profile?.department_id],
    enabled: isHod && !!profile?.department_id,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // Step 1: fetch dept member IDs
      const { data: deptMembers } = await supabase
        .from("profiles")
        .select("id")
        .eq("department_id", profile!.department_id!);
      const deptIds = (deptMembers ?? []).map((m: any) => m.id);
      if (deptIds.length === 0) return [];

      // Step 2: fetch all hod_pending rows — plain columns only, no FK joins
      const { data: allPending, error } = await supabase
        .from("compensation_assignments")
        .select("id, compensation_date, note, status, lecture_id, from_teacher_id, to_teacher_id")
        .eq("status", "hod_pending")
        .order("created_at", { ascending: true });

      if (error || !allPending || allPending.length === 0) return [];

      // Step 3: filter to dept
      const deptIdSet = new Set(deptIds);
      const deptRows = allPending.filter((c: any) =>
        deptIdSet.has(c.from_teacher_id) || deptIdSet.has(c.to_teacher_id)
      );
      if (deptRows.length === 0) return [];

      // Step 4: fetch teacher names
      const teacherIds = [...new Set([
        ...deptRows.map((c: any) => c.from_teacher_id),
        ...deptRows.map((c: any) => c.to_teacher_id),
      ].filter(Boolean))];
      const { data: teachers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", teacherIds);
      const teacherMap = new Map((teachers ?? []).map((t: any) => [t.id, t.full_name]));

      // Step 5: fetch lecture details
      const lectureIds = [...new Set(deptRows.map((c: any) => c.lecture_id).filter(Boolean))];
      const lectureMap = new Map<string, any>();
      if (lectureIds.length > 0) {
        const { data: lecs } = await supabase
          .from("lectures")
          .select("id, subject, class_name, start_time, end_time, room")
          .in("id", lectureIds);
        (lecs ?? []).forEach((l: any) => lectureMap.set(l.id, l));
      }

      // Step 6: stitch together
      return deptRows.map((c: any) => ({
        ...c,
        from_teacher: { id: c.from_teacher_id, full_name: teacherMap.get(c.from_teacher_id) ?? "Unknown" },
        to_teacher:   { id: c.to_teacher_id,   full_name: teacherMap.get(c.to_teacher_id)   ?? "Unknown" },
        lecture: c.lecture_id ? lectureMap.get(c.lecture_id) ?? null : null,
      }));
    },
  });

  // All rejected proxies across HOD's dept — shown regardless of leave status
  // Only show FUTURE/today rejections for reassignment. Past-date rejections are
  // auto-expired empty classes (handled by cron) and cannot be reassigned.
  const { data: allRejectedProxies = [] } = useQuery({
    queryKey: ["all-rejected-proxies", profile?.department_id],
    enabled: isHod && !!profile?.department_id,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Single query: get dept teacher IDs, then one .in() for all rejected proxies
      const { data: deptMembers } = await supabase
        .from("profiles").select("id, full_name").eq("department_id", profile!.department_id!);
      const deptIds = (deptMembers ?? []).map((m: any) => m.id);
      if (deptIds.length === 0) return [];

      // One query instead of one-per-teacher
      const { data: rows } = await supabase
        .from("proxy_assignments")
        .select("id, proxy_date, start_time, end_time, subject, class_name, lecture_id, leave_request_id, absentee_teacher_id")
        .in("absentee_teacher_id", deptIds)
        .eq("status", "rejected")
        .gte("proxy_date", today)
        .order("proxy_date", { ascending: true });

      // Deduplicate by slot
      const seen = new Set<string>();
      const uniqueRows = (rows ?? []).filter((r: any) => {
        const key = `${r.leave_request_id}|${r.proxy_date}|${r.start_time}|${r.end_time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Map absentee names from already-fetched deptMembers
      const nameMap = new Map((deptMembers ?? []).map((m: any) => [m.id, m.full_name]));
      return uniqueRows.map((r: any) => ({
        ...r,
        absenteeName: nameMap.get(r.absentee_teacher_id) ?? "Unknown",
      }));
    },
  });

  const { data: deptDataForReassign } = useQuery({
    queryKey: ["dept-for-reassign", profile?.department_id],
    enabled: isHod && !!profile?.department_id && allRejectedProxies.length > 0,
    queryFn: async () => {
      // Exclude admin and principal from proxy candidates
      const { data: excludedRoles } = await supabase
        .from("user_roles").select("user_id")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r: any) => r.user_id));
      const { data: people } = await supabase
        .from("profiles").select("id, full_name")
        .eq("department_id", profile!.department_id!)
        .eq("approved", true)
        .eq("hr_approved", true);
      return (people ?? []).filter((p: any) => !excludedIds.has(p.id));
    },
  });

  const [reassignChoices, setReassignChoices] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`requests-realtime-${profile.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "leave_requests",
      }, () => {
        qc.invalidateQueries({ queryKey: ["review-requests"] });
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "compensation_assignments",
      }, () => {
        qc.invalidateQueries({ queryKey: ["hod-comp-approvals"] });
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "proxy_assignments",
      }, () => {
        qc.invalidateQueries({ queryKey: ["all-rejected-proxies"] });
        qc.invalidateQueries({ queryKey: ["rejected-proxies"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, qc]);

  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ["review-requests", role, profile?.id],
    enabled: !!profile,
    staleTime: 5_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id, role")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((adminRoles ?? []).map((r) => r.user_id));
      let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
      if (isHod) {
        q = q.eq("department_id", profile!.department_id ?? "");
      } else {
        q = q.or(
          "status.in.(hod_recommended,pending_principal,hod_approved,approved)," +
          "and(status.eq.rejected,principal_acted_at.not.is.null)"
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      const filtered = (data ?? []).filter((r) =>
        !excludedIds.has(r.teacher_id) &&
        // HOD must not see or approve their own leave request
        !(isHod && r.teacher_id === profile?.id)
      );
      // Sort IDs before fetching so fetchPeople always receives the same key order,
      // preventing duplicate cache misses when the leave list comes back in different order
      const sortedIds = [...new Set(filtered.map((r) => r.teacher_id))].sort();
      const people = await fetchPeople(sortedIds);
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
  const [allReqPage, setAllReqPage] = useState(1);
  const ALL_REQ_PAGE_SIZE = 10;

  const filteredRest = useMemo(() => {
    if (!searchQ.trim()) return rest;
    const q = searchQ.toLowerCase();
    return rest.filter((r) =>
      r.teacher?.full_name?.toLowerCase().includes(q) ||
      r.leave_type?.toLowerCase().includes(q) ||
      r.status?.toLowerCase().includes(q)
    );
  }, [rest, searchQ]);

  // Reset to page 1 when search changes
  useEffect(() => { setAllReqPage(1); }, [searchQ]);

  const allReqTotalPages = Math.max(1, Math.ceil(filteredRest.length / ALL_REQ_PAGE_SIZE));
  const pagedRest = filteredRest.slice((allReqPage - 1) * ALL_REQ_PAGE_SIZE, allReqPage * ALL_REQ_PAGE_SIZE);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function approveComp(comp: any) {
    // Apply the lecture swap and mark as accepted
    const { data: srcLecture } = await supabase
      .from("lectures")
      .select("id, subject, class_name, start_time, end_time, room, department_id, lecture_date, day_of_week")
      .eq("id", comp.lecture?.id ?? comp.lecture_id)
      .maybeSingle();

    // Re-fetch comp to get lecture_id if needed
    const { data: fullComp } = await supabase
      .from("compensation_assignments")
      .select("lecture_id, from_teacher_id, to_teacher_id, compensation_date")
      .eq("id", comp.id)
      .maybeSingle();

    if (fullComp) {
      const { data: lec } = await supabase
        .from("lectures")
        .select("id, subject, class_name, start_time, end_time, room, department_id, lecture_date, day_of_week")
        .eq("id", fullComp.lecture_id)
        .maybeSingle();

      if (lec) {
        const compDate = fullComp.compensation_date;
        const dow = new Date(compDate + "T00:00:00").getDay();
        const dept = lec.department_id ?? profile!.department_id;

        if (lec.lecture_date) {
          await supabase.from("lectures").update({ teacher_id: fullComp.to_teacher_id }).eq("id", lec.id);
        } else {
          await supabase.from("lectures").insert({
            teacher_id: fullComp.to_teacher_id,
            department_id: dept,
            day_of_week: dow,
            lecture_date: compDate,
            start_time: lec.start_time,
            end_time: lec.end_time,
            subject: lec.subject,
            class_name: lec.class_name,
            room: lec.room,
          });
          await supabase.from("lectures").insert({
            teacher_id: fullComp.from_teacher_id,
            department_id: dept,
            day_of_week: dow,
            lecture_date: compDate,
            start_time: lec.start_time,
            end_time: lec.end_time,
            subject: `__COMP_GIVEN__${lec.subject}`,
            class_name: lec.class_name,
            room: lec.room,
          });
        }
      }
    }

    await supabase.from("compensation_assignments").update({ status: "accepted" }).eq("id", comp.id);

    // Notify both teachers
    firePush({
      userIds: [comp.from_teacher?.id, comp.to_teacher?.id].filter(Boolean),
      title: "Compensation Approved by HOD",
      body: `Your compensation lecture on ${fmtDate(comp.compensation_date)} has been approved and is now in the schedule.`,
      targetUrl: "/schedule",
    });

    toast.success("Compensation approved — lecture applied to schedule");
    qc.invalidateQueries();
  }

  async function rejectComp(comp: any) {
    await supabase.from("compensation_assignments").update({ status: "rejected" }).eq("id", comp.id);
    firePush({
      userIds: [comp.from_teacher?.id, comp.to_teacher?.id].filter(Boolean),
      title: "Compensation Rejected by HOD",
      body: `The compensation lecture on ${fmtDate(comp.compensation_date)} was not approved by your HOD.`,
      targetUrl: "/proxies",
    });
    toast.success("Compensation rejected");
    qc.invalidateQueries();
  }

  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const now = new Date().toISOString();
      const newStatus = isHod ? "hod_approved" : "approved";

      // HOD bulk approve: exclude hodFinal leave types (duty/medical) because they need
      // doc_status:"required" set individually — bulk update can't do that per-row here.
      // Those leaves must be approved one-by-one via the RequestCard.
      const eligibleIds = isHod
        ? actionable
            .filter((r) => selectedIds.has(r.id) && !isHodFinalLeave(r.leave_type as LeaveType))
            .map((r) => r.id)
        : Array.from(selectedIds);

      if (eligibleIds.length === 0) {
        toast.error("No eligible requests selected. Medical and duty leave must be approved individually.");
        return;
      }

      const patch = isHod
        ? { status: newStatus as "hod_approved", hod_acted_at: now }
        : { status: newStatus as "approved", principal_acted_at: now };

      const { error } = await supabase
        .from("leave_requests")
        .update(patch)
        .in("id", eligibleIds);
      if (error) { toast.error(error.message); return; }

      const totalSelected = selectedIds.size;
      const skipped = totalSelected - eligibleIds.length;
      toast.success(
        `${eligibleIds.length} request(s) approved${skipped > 0 ? ` · ${skipped} medical/duty skipped (approve individually)` : ""}`
      );
      haptic("success");

      // Notify each affected teacher
      const approvedRequests = actionable.filter((r) => eligibleIds.includes(r.id));
      for (const r of approvedRequests) {
        const title = isHod ? "Leave Approved by HOD" : "Leave Approved";
        const body = isHod
          ? `Your ${r.leave_type} leave has been approved by your HOD and forwarded to the principal.`
          : `Your ${r.leave_type} leave for ${r.total_days} day(s) has been approved.`;
        firePush({ userIds: [r.teacher_id], title, body, targetUrl: `/leaves?highlight=${r.id}` });
      }

      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["review-requests", role, profile?.id] });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <AppShell
      title={t("nav.requests")}
      subtitle={isHod ? "Review and approve teacher leave requests" : "Final approval for HOD-recommended requests"}
    >
      <div className="space-y-6">
        {/* HOD: Password Reset Requests from dept teachers */}
        {isHod && profile?.department_id && (
          <HodPasswordResetRequests deptId={profile.department_id} />
        )}

        {/* HOD: Rejected proxy slots needing reassignment (across all approved leaves) */}
        {isHod && allRejectedProxies.length > 0 && (
          <SectionCard
            title="Proxy Rejections — Reassignment Needed"
            subtitle={`${allRejectedProxies.length} slot${allRejectedProxies.length > 1 ? "s" : ""} rejected by teachers`}
          >
            <ul className="space-y-3">
              {(allRejectedProxies as any[]).map((rp) => {
                const key = `global-reassign-${rp.id}`;
                const people = deptDataForReassign ?? [];
                const chosen = people.find((p: any) => p.id === reassignChoices[key]);
                const dateStr = new Date(rp.proxy_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                return (
                  <li key={rp.id} className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 space-y-2">
                    <div>
                      <p className="text-sm font-semibold">{rp.subject} · {rp.class_name}</p>
                      <p className="text-xs text-muted-foreground">{dateStr} · {fmtTime(rp.start_time)} – {fmtTime(rp.end_time)} · Cover for {rp.absenteeName}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Select value={reassignChoices[key] ?? ""} onValueChange={(v) => setReassignChoices((c) => ({ ...c, [key]: v }))}>
                        <SelectTrigger className="flex-1 sm:w-64 h-8 text-xs">
                          <SelectValue placeholder="Select new proxy teacher" />
                        </SelectTrigger>
                        <SelectContent>
                          {people.filter((p: any) => p.id !== rp.absentee_teacher_id).map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" disabled={!reassignChoices[key]}
                        onClick={async () => {
                          const newId = reassignChoices[key];
                          if (!newId) return;
                          await supabase.from("proxy_assignments").delete().eq("id", rp.id);
                          const { error } = await supabase.from("proxy_assignments").insert({
                            leave_request_id: rp.leave_request_id,
                            lecture_id: rp.lecture_id ?? null,
                            proxy_teacher_id: newId,
                            absentee_teacher_id: rp.absentee_teacher_id,
                            proxy_date: rp.proxy_date,
                            start_time: rp.start_time,
                            end_time: rp.end_time,
                            subject: rp.subject,
                            class_name: rp.class_name,
                            status: "pending",
                          });
                          if (error) { toast.error(error.message); return; }
                          firePush({
                            userIds: [newId],
                            title: "Proxy Lecture Assigned",
                            body: `You have been assigned to cover ${rp.subject} (${rp.class_name}) on ${dateStr}`,
                            targetUrl: "/proxies",
                          });
                          const teacherName = people.find((p: any) => p.id === newId)?.full_name ?? "teacher";
                          toast.success(`Reassigned to ${teacherName}`);
                          setReassignChoices((c) => { const n = { ...c }; delete n[key]; return n; });
                          qc.invalidateQueries({ queryKey: ["all-rejected-proxies"] });
                        }}
                      >
                        Reassign
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}

        {/* HOD: Compensation lecture approvals */}
        {isHod && pendingCompApprovals.length > 0 && (
          <SectionCard
            title="Compensation Lectures — Approval Needed"
            subtitle={`${pendingCompApprovals.length} pending`}
          >
            <ul className="space-y-3">
              {(pendingCompApprovals as any[]).map((comp) => (
                <li key={comp.id} className="rounded-xl border border-warning/25 bg-warning/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15">
                        <Gift className="size-4 text-warning" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-sm">
                          {comp.from_teacher?.full_name ?? "—"} → {comp.to_teacher?.full_name ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Compensation on {fmtDate(comp.compensation_date)}
                        </p>
                        {comp.lecture && (
                          <p className="text-xs text-muted-foreground">
                            {comp.lecture.subject} · {comp.lecture.class_name} · {comp.lecture.start_time?.slice(0,5)}–{comp.lecture.end_time?.slice(0,5)}
                            {comp.lecture.room ? ` · ${comp.lecture.room}` : ""}
                          </p>
                        )}
                        {comp.note && <p className="text-xs italic text-muted-foreground">"{comp.note}"</p>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" className="gap-1.5 bg-success hover:bg-success/90 text-success-foreground" onClick={() => approveComp(comp)}>
                        <CheckCircle2 className="size-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => rejectComp(comp)}>
                        Reject
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

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
          {isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
              Failed to load requests. Please refresh and try again.
            </div>
          ) : isLoading ? <ListSkeleton rows={3} />
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
                id="all-req-search"
                aria-label="Search requests by name"
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
                {pagedRest.map((r) => (
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
                    {pagedRest.map((r) => (
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
              <Pagination page={allReqPage} totalPages={allReqTotalPages} onPage={setAllReqPage} totalItems={filteredRest.length} pageSize={ALL_REQ_PAGE_SIZE} className="mt-2" />
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
  const { profile, role } = useAuth();
  const [note, setNote] = useState("");
  const noteGuardRef = useRef<GuardHandle>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const isHodFinal = isHodFinalLeave(request.leave_type as LeaveType);
  const isMedical = request.leave_type === "medical";
  const isCasual = request.leave_type === "casual";
  const requiredDoc = docLabel(request.leave_type as LeaveType);
  // Principal can always decide paid/unpaid for non-casual leaves.
  // For casual leaves the toggle only appears when the teacher has taken > 2 days that month.
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

  // Casual leave: count approved casual days for this teacher in the same
  // calendar month as this request. Filter on from_date only — avoids any
  // month-end date arithmetic on to_date (which caused the Sep-31 400 error).
  const casualYearMonth = request.from_date.slice(0, 7); // "YYYY-MM"
  const casualMonthStart = casualYearMonth + "-01";
  // Next month first day — everything with from_date < this is within our month
  const [_cy, _cm] = request.from_date.split("-").map(Number);
  const casualMonthExclusiveEnd = new Date(_cy, _cm, 1).toISOString().slice(0, 10); // first day of next month
  const { data: casualDaysThisMonth = 0 } = useQuery({
    queryKey: ["casual-days-month", request.teacher_id, casualYearMonth],
    enabled: !isHod && isCasual,
    queryFn: async () => {
      const { data } = await supabase.from("leave_requests").select("total_days")
        .eq("teacher_id", request.teacher_id).eq("leave_type", "casual")
        .in("status", ["hod_approved", "approved"]).neq("id", request.id)
        .gte("from_date", casualMonthStart)
        .lt("from_date", casualMonthExclusiveEnd); // strictly less than next month's first day
      return (data ?? []).reduce((s, r) => s + Number(r.total_days), 0);
    },
  });

  const requestDays = Number(request.total_days);
  const medicalSplit = isMedical ? medicalPaidSplit(medicalDaysTaken, requestDays) : null;
  const medicalRequiresDecision = isMedical && medicalNeedsDecision(medicalDaysTaken, requestDays);
  // Whether the principal should see the paid/unpaid toggle for this casual leave
  const casualRequiresDecision = isCasual && !isHod && casualNeedsDecision(casualDaysThisMonth, requestDays);

  const dates = useMemo(() => eachDate(request.from_date, request.to_date), [request.from_date, request.to_date]);

  const { data: slots = [] } = useQuery({
    queryKey: ["leave-lectures", request.id, request.session],
    enabled: isHod,
    queryFn: async () => {
      const { data, error } = await supabase.from("lectures").select("id, teacher_id, day_of_week, lecture_date, start_time, end_time, subject, class_name, room, department_id").eq("teacher_id", request.teacher_id);
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

  // Rejected proxy slots — HOD needs to reassign these (only future/today — past ones are empty classes)
  const { data: rejectedProxies = [] } = useQuery({
    queryKey: ["rejected-proxies", request.id],
    enabled: isHod,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("proxy_assignments")
        .select("id, proxy_date, start_time, end_time, subject, class_name, lecture_id")
        .eq("leave_request_id", request.id)
        .eq("status", "rejected")
        .gte("proxy_date", today);

      // Deduplicate by slot — same start_time+end_time on same date
      const seen = new Set<string>();
      return (data ?? []).filter((r) => {
        const key = `${r.proxy_date}|${r.start_time}|${r.end_time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });

  const [manual, setManual] = useState<{ key: string; date: string; start_time: string; end_time: string; subject: string; class_name: string }[]>([]);

  const allSlots = useMemo(() => [
    ...slots.map((s) => ({ key: s.key, date: s.date, start_time: s.lecture.start_time, end_time: s.lecture.end_time, subject: s.lecture.subject, class_name: s.lecture.class_name, lecture_id: s.lecture.id as string | null, isManual: false })),
    ...manual.map((m) => ({ ...m, lecture_id: null as string | null, isManual: true })),
  ], [slots, manual]);

  const { data: dept } = useQuery({
    queryKey: ["dept-availability", request.department_id, request.from_date, request.to_date],
    enabled: isHod,
    queryFn: async () => {
      // Exclude principal and admin from proxy candidates
      const { data: excludedRoles } = await supabase.from("user_roles").select("user_id")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((excludedRoles ?? []).map((r) => r.user_id));

      let pq = supabase.from("profiles").select("id, full_name, designation")
        .eq("approved", true)
        .eq("hr_approved", true);
      if (request.department_id) pq = pq.eq("department_id", request.department_id);
      const { data: people, error } = await pq.neq("id", request.teacher_id).order("full_name");
      if (error) throw error;

      const filteredPeople = (people ?? []).filter((p) => !excludedIds.has(p.id));
      const teacherIds = filteredPeople.map((p) => p.id);

      const { data: lectures } = teacherIds.length
        ? await supabase.from("lectures").select("teacher_id, day_of_week, start_time, end_time, class_name").in("teacher_id", teacherIds).is("lecture_date", null)
        : { data: [] };

      const { data: existingProxies } = teacherIds.length
        ? await supabase.from("proxy_assignments").select("proxy_teacher_id, proxy_date, start_time, end_time").in("proxy_teacher_id", teacherIds).in("status", ["pending", "accepted"]).gte("proxy_date", request.from_date).lte("proxy_date", request.to_date)
        : { data: [] };

      // A teacher on leave cannot be a proxy
      const { data: activeLeaves } = teacherIds.length
        ? await supabase.from("leave_requests").select("teacher_id, from_date, to_date, status").in("teacher_id", teacherIds).not("status", "in", "(rejected,cancelled)").lte("from_date", request.to_date).gte("to_date", request.from_date)
        : { data: [] };

      const teachersOnLeave = new Set((activeLeaves ?? []).map((l: any) => l.teacher_id));

      // Build a map: teacher_id → Set of class_names they teach
      const teacherClasses = new Map<string, Set<string>>();
      for (const lec of lectures ?? []) {
        if (!teacherClasses.has(lec.teacher_id)) teacherClasses.set(lec.teacher_id, new Set());
        if (lec.class_name) teacherClasses.get(lec.teacher_id)!.add(lec.class_name.trim().toLowerCase());
      }

      return {
        people: filteredPeople.filter((p) => !teachersOnLeave.has(p.id)),
        lectures: lectures ?? [],
        existingProxies: existingProxies ?? [],
        teacherClasses,
      };
    },
  });

  // ── Auto-assign proxies once dept data + slots are ready ──────────────────
  // For each slot, pick the first free teacher who teaches the same class_name.
  // HOD can override via the Select dropdowns below.
  const autoAssigned = useRef(false);
  useEffect(() => {
    if (autoAssigned.current) return;           // only run once per card
    if (!dept || allSlots.length === 0) return;
    if (Object.keys(choices).length > 0) return; // HOD already made manual choices

    const nextChoices: Record<string, string> = {};
    // Track which teachers have already been auto-assigned in this pass
    // so we try to spread load across teachers
    const assigned = new Map<string, number>(); // teacherId → count

    for (const slot of allSlots) {
      const dow = new Date(slot.date + "T00:00:00").getDay();
      const slotClass = slot.class_name?.trim().toLowerCase() ?? "";

      const options = (dept.people ?? [])
        .filter((p) => p.id !== request.teacher_id) // never assign absentee to cover themselves
        .map((p) => {
        const busyFixed = (dept.lectures ?? []).some(
          (l) => l.teacher_id === p.id && l.day_of_week === dow && l.start_time < slot.end_time && l.end_time > slot.start_time,
        );
        const busyProxy = (dept.existingProxies ?? []).some(
          (px) => px.proxy_teacher_id === p.id && px.proxy_date === slot.date && px.start_time < slot.end_time && px.end_time > slot.start_time,
        );
        // Does this teacher teach the same class? (match by class_name regardless of subject)
        const teachesClass = slotClass
          ? (dept.teacherClasses?.get(p.id) ?? new Set()).has(slotClass)
          : true;
        return { ...p, free: !busyFixed && !busyProxy, teachesClass };
      });

      // Priority: free + teaches same class → free (any) → busy + teaches class → skip
      const pick =
        options.find((o) => o.free && o.teachesClass && !nextChoices[slot.key] ) ??
        options.filter((o) => o.free && o.teachesClass).sort((a, b) => (assigned.get(a.id) ?? 0) - (assigned.get(b.id) ?? 0))[0] ??
        options.filter((o) => o.free).sort((a, b) => (assigned.get(a.id) ?? 0) - (assigned.get(b.id) ?? 0))[0];

      if (pick) {
        nextChoices[slot.key] = pick.id;
        assigned.set(pick.id, (assigned.get(pick.id) ?? 0) + 1);
      }
    }

    if (Object.keys(nextChoices).length > 0) {
      setChoices(nextChoices);
      autoAssigned.current = true;
    }
  }, [dept, allSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  function candidates(date: string, start: string, end: string, slotClassName?: string) {
    const dow = new Date(date + "T00:00:00").getDay();
    const slotClass = slotClassName?.trim().toLowerCase() ?? "";
    return (dept?.people ?? [])
      .filter((p) => p.id !== request.teacher_id) // #7 — never assign absentee to cover themselves
      .map((p) => {
        const busyFixed = (dept?.lectures ?? []).some((l) => l.teacher_id === p.id && l.day_of_week === dow && l.start_time < end && l.end_time > start);
        const busyProxy = (dept?.existingProxies ?? []).some((p2) => p2.proxy_teacher_id === p.id && p2.proxy_date === date && p2.start_time < end && p2.end_time > start);
        const teachesClass = slotClass
          ? (dept?.teacherClasses?.get(p.id) ?? new Set()).has(slotClass)
          : true;
        return { ...p, free: !busyFixed && !busyProxy, teachesClass };
      }).sort((a, b) => {
        const score = (o: typeof a) => (o.free ? 2 : 0) + (o.teachesClass ? 1 : 0);
        return score(b) - score(a);
      });
  }

  async function saveProxies() {
    if (allSlots.length === 0) return true;
    const incomplete = allSlots.some((s) => s.isManual && (!s.subject.trim() || !s.class_name.trim()));
    if (incomplete) { toast.error("Add subject and class for every manual proxy lecture"); return false; }

    // Only insert slots where a real proxy was chosen — __none__ or empty = empty class (allowed)
    const assignedSlots = allSlots.filter((s) => choices[s.key] && choices[s.key] !== "__none__");

    // Moderate free-text fields in manual slots that have a proxy assigned
    const manualTexts = assignedSlots.filter((s) => s.isManual).flatMap((s) => [s.subject.trim(), s.class_name.trim()].filter(Boolean));
    for (const text of manualTexts) {
      if (localBlocklistCheck(text)) { toast.error("Please use appropriate language in subject and class fields"); return false; }
    }
    for (const text of manualTexts) {
      const abusive = await groqModerationCheck(text);
      if (abusive) { toast.error("Please use appropriate language in subject and class fields"); return false; }
    }

    if (assignedSlots.length === 0) return true; // all slots left unassigned (empty class) — that's fine

    const { error: pErr } = await supabase.from("proxy_assignments").insert(
      assignedSlots.map((s) => {
        const isHodSelf = profile?.id && choices[s.key] === profile.id;
        return { leave_request_id: request.id, lecture_id: s.lecture_id, proxy_teacher_id: choices[s.key], absentee_teacher_id: request.teacher_id, proxy_date: s.date, start_time: s.start_time, end_time: s.end_time, subject: s.subject, class_name: s.class_name, status: (isHodSelf ? "accepted" : "pending") as "accepted" | "pending" };
      }),
    );
    if (pErr) { toast.error(pErr.message); return false; }

    // Notify each unique proxy teacher (fire-and-forget)
    const uniqueProxyTeachers = [...new Set(assignedSlots.map((s) => choices[s.key]).filter(Boolean))];
    const absenteeName = request.teacher?.full_name ?? "a colleague";
    for (const proxyId of uniqueProxyTeachers) {
      const slot = assignedSlots.find((s) => choices[s.key] === proxyId);
      if (slot) {
        firePush({ userIds: [proxyId], title: "Proxy Lecture Assigned", body: `Cover ${slot.subject} for ${absenteeName} on ${slot.date}`, targetUrl: "/proxies" });
      }
    }

    const unassignedCount = allSlots.length - assignedSlots.length;
    if (unassignedCount > 0) {
      toast.info(`${unassignedCount} lecture${unassignedCount > 1 ? "s" : ""} left unassigned — will show as empty class in reports`);
    }
    return true;
  }

  async function checkNote(): Promise<boolean> {
    if (!note.trim()) return true; // notes are optional — only validate if filled
    const guardErr = await noteGuardRef.current?.validateNow();
    return !guardErr;
  }

  async function writeAudit(action: string, note?: string) {
    await supabase.from("leave_audit_log").insert({
      leave_request_id: request.id,
      action,
      actor_id: profile?.id ?? null,
      note: note?.trim() || null,
    }).then(({ error }) => { if (error) console.warn("Audit log write failed:", error.message); });
  }

  async function hodRecommend() {
    if (!checkNote()) return;
    setBusy(true);
    const ok = await saveProxies();
    if (!ok) { setBusy(false); return; }
    const { error } = await supabase.from("leave_requests").update({ status: "pending_principal", hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }).eq("id", request.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    void writeAudit("hod_recommended", note);
    haptic("success");
    toast.success("Recommended to the principal");
    // Notify teacher their leave was approved by HOD (awaiting principal)
    firePush({ userIds: [request.teacher_id], title: "Leave Approved by HOD", body: `Your ${request.leave_type} leave has been approved by your HOD and forwarded to the principal for final approval.`, targetUrl: `/leaves?highlight=${request.id}` });
    // Notify principal
    if (profile?.department_id) {
      firePush({ userIds: ["__principal__"], title: "Leave Awaiting Your Approval", body: `${request.teacher?.full_name ?? "A teacher"}'s ${request.leave_type} leave has been approved by HOD`, targetUrl: "/requests" });
    }
    qc.invalidateQueries();
  }

  async function hodDirectApprove() {
    if (!checkNote()) return;
    setBusy(true);
    // Optimistic: immediately hide this card from the actionable list
    qc.setQueryData(["review-requests", role, profile?.id], (old: any[] | undefined) =>
      old ? old.map((r) => r.id === request.id ? { ...r, status: "hod_approved" } : r) : old
    );
    const ok = await saveProxies();
    if (!ok) { setBusy(false); qc.invalidateQueries({ queryKey: ["review-requests"] }); return; }
    const { error } = await supabase.from("leave_requests").update({ status: "hod_approved", doc_status: "required", hod_note: note.trim() || null, hod_acted_at: new Date().toISOString() }).eq("id", request.id);
    setBusy(false);
    if (error) { qc.invalidateQueries({ queryKey: ["review-requests"] }); return toast.error(error.message); }
    void writeAudit("hod_approved", note);
    haptic("success");
    toast.success(`Leave approved — teacher must upload ${requiredDoc}`);
    firePush({ userIds: [request.teacher_id], title: "Leave Approved", body: `Your ${request.leave_type} leave for ${request.total_days} day(s) has been approved`, targetUrl: `/leaves?highlight=${request.id}` });
    // Notify principal — they need to verify the document once the teacher uploads it
    firePush({ userIds: ["__principal__"], title: "Document Verification Pending", body: `${request.teacher?.full_name ?? "A teacher"}'s ${request.leave_type} leave was approved by HOD — awaiting document upload`, targetUrl: "/requests" });
    qc.invalidateQueries({ queryKey: ["leave-requests"] });
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
    if (error) { setBusy(false); return toast.error(error.message); }

    // ── When PRINCIPAL rejects, cancel all proxy assignments for this leave ──
    // This restores the lectures back to the original (absentee) teacher's schedule.
    // HOD rejection doesn't need this — proxies are only assigned after HOD approval.
    if (!isHod) {
      const { data: proxies } = await supabase
        .from("proxy_assignments")
        .select("id, proxy_teacher_id, proxy_date, start_time, end_time, subject, class_name")
        .eq("leave_request_id", request.id)
        .in("status", ["accepted", "pending"]);

      if (proxies && proxies.length > 0) {
        const proxyIds = proxies.map((p: any) => p.id);

        // Cancel all accepted/pending proxy assignments
        await supabase
          .from("proxy_assignments")
          .update({ status: "cancelled" } as any)
          .eq("leave_request_id", request.id)
          .in("status", ["accepted", "pending"]);

        // Also cancel any compensation_assignments linked to these proxies
        // so the proxy teacher's compensation duty is also removed from their schedule
        const { data: comps } = await supabase
          .from("compensation_assignments")
          .select("id, from_teacher_id")
          .in("proxy_assignment_id", proxyIds)
          .in("status", ["pending", "accepted", "hod_pending"]);

        if (comps && comps.length > 0) {
          await supabase
            .from("compensation_assignments")
            .update({ status: "cancelled" } as any)
            .in("proxy_assignment_id", proxyIds)
            .in("status", ["pending", "accepted", "hod_pending"]);
        }

        // Notify each proxy teacher that their assignment is cancelled
        const proxyTeacherIds = [...new Set(proxies.map((p: any) => p.proxy_teacher_id).filter(Boolean))];
        if (proxyTeacherIds.length > 0) {
          const dateStr = new Date(request.from_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
          firePush({
            userIds: proxyTeacherIds,
            title: "Proxy Assignment Cancelled",
            body: `Your proxy duty for ${request.teacher?.full_name ?? "a colleague"}'s leave (${dateStr}) has been cancelled — the principal rejected the leave, so the original schedule is restored.`,
            targetUrl: "/proxies",
          });
        }
      }
    }

    setBusy(false);
    void writeAudit(isHod ? "hod_rejected" : "principal_rejected", note);
    haptic("warning");
    toast.success("Leave rejected");
    // Notify teacher their leave was rejected
    firePush({ userIds: [request.teacher_id], title: "Leave Rejected", body: note.trim() ? `Your ${request.leave_type} leave was rejected: ${note.trim()}` : `Your ${request.leave_type} leave request has been rejected`, targetUrl: `/leaves?highlight=${request.id}` });
    qc.invalidateQueries();
  }

  async function principalApprove() {
    if (!checkNote()) return;
    setBusy(true);
    // Optimistic: immediately reflect approval in UI
    qc.setQueryData(["review-requests", role, profile?.id], (old: any[] | undefined) =>
      old ? old.map((r) => r.id === request.id ? { ...r, status: "approved" } : r) : old
    );
    const total = Number(request.total_days);
    let paidDays: number;
    let unpaidDays: number;

    if (isMedical && medicalSplit) {
      // Medical: within-quota days always paid; over-quota follows principal decision
      const overQuotaPaid = medicalRequiresDecision ? (payment === "paid" ? medicalSplit.overQuota : 0) : 0;
      paidDays   = medicalSplit.withinQuota + overQuotaPaid;
      unpaidDays = total - paidDays;
    } else if (isCasual && !casualRequiresDecision) {
      // Casual within the 2-day monthly limit — always fully paid, never deducted
      paidDays   = total;
      unpaidDays = 0;
    } else if (needsDecision || casualRequiresDecision) {
      // All other leave types + casual over monthly quota — principal decides
      paidDays   = payment === "paid"   ? total : 0;
      unpaidDays = payment === "unpaid" ? total : 0;
    } else {
      // Fallback — preserve existing values
      paidDays   = Number(request.paid_days);
      unpaidDays = Number(request.unpaid_days);
    }

    const hasPaymentDecision = needsDecision || casualRequiresDecision;
    const { error } = await supabase.from("leave_requests").update({
      status: "approved", payment_decision: hasPaymentDecision ? payment : null,
      paid_days: paidDays, unpaid_days: unpaidDays,
      principal_note: note.trim() || null, principal_acted_at: new Date().toISOString(),
    }).eq("id", request.id);
    setBusy(false);
    if (error) { qc.invalidateQueries({ queryKey: ["review-requests"] }); return toast.error(error.message); }
    void writeAudit("principal_approved", note);
    haptic("success");
    toast.success("Leave approved");
    firePush({ userIds: [request.teacher_id], title: "Leave Approved", body: `Your ${request.leave_type} leave for ${request.total_days} day(s) has been approved`, targetUrl: `/leaves?highlight=${request.id}` });
    qc.invalidateQueries({ queryKey: ["leave-requests"] });
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

          {/* Rejected proxy slots — need reassignment */}
          {rejectedProxies.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3 mb-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 text-destructive shrink-0" />
                <p className="text-sm font-semibold text-destructive">
                  {rejectedProxies.length} proxy slot{rejectedProxies.length > 1 ? "s" : ""} rejected — reassignment needed
                </p>
              </div>
              <ul className="space-y-2">
                {(rejectedProxies as any[]).map((rp) => {
                  const key = `reassign-${rp.id}`;
                  const opts = candidates(rp.proxy_date, rp.start_time, rp.end_time, rp.class_name);
                  const chosen = opts.find((o) => o.id === choices[key]);
                  const dateStr = new Date(rp.proxy_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                  return (
                    <li key={rp.id} className="rounded-lg border border-destructive/20 bg-background p-3 space-y-2">
                      <div>
                        <p className="text-xs font-semibold">{rp.subject} · {rp.class_name}</p>
                        <p className="text-xs text-muted-foreground">{dateStr} · {fmtTime(rp.start_time)} – {fmtTime(rp.end_time)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <Select value={choices[key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [key]: v }))}>
                          <SelectTrigger className="flex-1 sm:w-56 h-8 text-xs">
                            <SelectValue placeholder="Select new proxy teacher" />
                          </SelectTrigger>
                          <SelectContent>
                            {opts.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.full_name}{o.teachesClass ? " · ✓ Same class" : ""}{o.free ? " · Free" : " · Busy"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {chosen && (
                          <div className="flex gap-1 flex-wrap">
                            {chosen.teachesClass && <Badge variant="secondary" className="text-[10px] bg-success/10 text-success border-success/20">Teaches class</Badge>}
                            <Badge variant="secondary" className={`text-[10px] ${chosen.free ? "bg-success/10 text-success border-success/20" : "bg-warning/10 text-warning border-warning/20"}`}>
                              {chosen.free ? "Free" : "Has lecture"}
                            </Badge>
                          </div>
                        )}
                        <Button size="sm" disabled={!choices[key]}
                          onClick={async () => {
                            const newTeacherId = choices[key];
                            if (!newTeacherId) return;
                            await supabase.from("proxy_assignments").delete().eq("id", rp.id);
                            const { error } = await supabase.from("proxy_assignments").insert({
                              leave_request_id: request.id,
                              lecture_id: rp.lecture_id ?? null,
                              proxy_teacher_id: newTeacherId,
                              absentee_teacher_id: request.teacher_id,
                              proxy_date: rp.proxy_date,
                              start_time: rp.start_time,
                              end_time: rp.end_time,
                              subject: rp.subject,
                              class_name: rp.class_name,
                              status: "pending",
                            });
                            if (error) { toast.error(error.message); return; }
                            firePush({
                              userIds: [newTeacherId],
                              title: "Proxy Lecture Assigned",
                              body: `You have been assigned to cover ${rp.subject} (${rp.class_name}) on ${dateStr}`,
                              targetUrl: "/proxies",
                            });
                            toast.success(`Reassigned to ${opts.find((o) => o.id === newTeacherId)?.full_name ?? "teacher"}`);
                            setChoices((c) => { const n = { ...c }; delete n[key]; return n; });
                            qc.invalidateQueries({ queryKey: ["rejected-proxies", request.id] });
                          }}
                        >
                          Reassign
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {allSlots.length === 0 && (
            <p className="text-sm text-muted-foreground">No lectures found for these dates{request.session !== "full_day" ? ` (${sessionLabel})` : ""}.</p>
          )}
          {allSlots.length > 0 && Object.keys(choices).length > 0 && (
            <p className="text-xs text-info bg-info/8 border border-info/20 rounded-lg px-3 py-2 mb-2">
              ✦ Proxies auto-assigned based on who teaches the same class and is free. You can override any slot below.
            </p>
          )}
          <ul className="space-y-2">
            {allSlots.map((s) => {
              const opts = candidates(s.date, s.start_time, s.end_time, s.class_name);
              const isManual = s.lecture_id === null;
              const chosen = opts.find((o) => o.id === choices[s.key]);
              return (
                <li key={s.key} className="rounded-lg border border-border p-3 space-y-2 text-sm">
                  {isManual ? (
                    <>
                      {/* Row 1: date + times */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <Input type="date" value={s.date} min={request.from_date} max={request.to_date} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, date: e.target.value } : x))} className="h-8 text-xs col-span-2 sm:col-span-1" />
                        <Input type="time" value={s.start_time} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, start_time: e.target.value } : x))} className="h-8 text-xs" />
                        <Input type="time" value={s.end_time} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, end_time: e.target.value } : x))} className="h-8 text-xs" />
                      </div>
                      {/* Row 2: subject + class */}
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="Subject" value={s.subject} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, subject: e.target.value } : x))} className="h-8 text-xs" />
                        <Input placeholder="Class" value={s.class_name} onChange={(e) => setManual((m) => m.map((x) => x.key === s.key ? { ...x, class_name: e.target.value } : x))} className="h-8 text-xs" />
                      </div>
                      {/* Row 3: proxy + badge + remove */}
                      <div className="flex flex-wrap gap-2 items-center">
                        <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                          <SelectTrigger className="flex-1 min-w-[160px] h-8 text-xs"><SelectValue placeholder="Select proxy teacher" /></SelectTrigger>
                          <SelectContent>
                            {opts.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.full_name}{o.teachesClass ? " · ✓ Same class" : ""}{o.free ? " · Free" : " · Busy"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {chosen && <Badge variant="secondary" className="shrink-0">{chosen.free ? "Free" : "Has lecture"}</Badge>}
                        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs px-2 shrink-0" onClick={() => setManual((m) => m.filter((x) => x.key !== s.key))}>Remove</Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-xs">{s.subject} · {s.class_name}</p>
                          {choices[s.key] && chosen && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-info/10 text-info border-info/20">
                              Auto-assigned
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
                        <Select value={choices[s.key] ?? ""} onValueChange={(v) => setChoices((c) => ({ ...c, [s.key]: v }))}>
                          <SelectTrigger className="flex-1 sm:w-64 h-8 text-xs">
                            <SelectValue placeholder="No proxy (empty class)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__" className="text-muted-foreground italic">Leave empty (no proxy)</SelectItem>
                            {opts.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.full_name}{o.teachesClass ? " · ✓ Same class" : ""}{o.free ? " · Free" : " · Busy"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {chosen && (
                          <div className="flex gap-1 flex-wrap">
                            {chosen.teachesClass && (
                              <Badge variant="secondary" className="shrink-0 bg-success/10 text-success border-success/20 text-[10px]">Teaches class</Badge>
                            )}
                            <Badge variant="secondary" className={`shrink-0 text-[10px] ${chosen.free ? "bg-success/10 text-success border-success/20" : "bg-warning/10 text-warning border-warning/20"}`}>
                              {chosen.free ? "Free" : "Has lecture"}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {/* "Add proxy lecture" only for teacher-applied leaves (not HOD-marked) */}
        </div>
      )}

      {/* Payment decision — Principal only */}
      {/* For casual leave: only shown when teacher has exceeded 2-day monthly limit */}
      {/* For all other leave types: always shown */}
      {!isHod && (needsDecision || casualRequiresDecision) && (
        <div className="mt-4 rounded-lg border border-border p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Salary decision for this {leaveTypeLabel(request.leave_type as LeaveType).toLowerCase()}</p>

          {/* Medical quota breakdown */}
          {isMedical && medicalSplit && (
            <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
              <p className="font-semibold">Medical Leave Quota — {MEDICAL_PAID_QUOTA} paid days/year</p>
              <p className="text-muted-foreground">Days already taken: <strong>{medicalDaysTaken}</strong></p>
              <p className="text-muted-foreground">
                This request: <strong>{requestDays}</strong> day(s) — <span className="text-success font-medium">{medicalSplit.withinQuota} within quota</span>
                {medicalSplit.overQuota > 0 && <span className="text-destructive font-medium"> · {medicalSplit.overQuota} over quota</span>}
              </p>
              {!medicalRequiresDecision && <p className="text-success font-medium flex items-center gap-1"><Check className="size-4"/>All days within paid quota.</p>}
            </div>
          )}

          {/* Casual over-quota notice — only shown when casualRequiresDecision is true */}
          {isCasual && casualRequiresDecision && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs space-y-1">
              <p className="font-semibold text-amber-800 dark:text-amber-300">Casual Leave — Monthly Limit Exceeded</p>
              <p className="text-muted-foreground">
                Casual days already taken this month: <strong>{casualDaysThisMonth}</strong>
                {" "}· This request: <strong>{requestDays}</strong> day(s)
                {" "}· Total: <strong className="text-destructive">{casualDaysThisMonth + requestDays} days</strong> (limit is 2)
              </p>
              <p className="text-muted-foreground">Decide whether to mark this as paid or apply a salary deduction.</p>
            </div>
          )}

          {/* Paid / Unpaid toggle */}
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

      <GuardedTextarea ref={noteGuardRef} fieldName="Note" className="mt-4" rows={2} maxLength={300} placeholder="Add a note (optional)" value={note} onChange={setNote} />
      <p className="text-right text-xs text-muted-foreground mt-1">{note.length}/300</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {isHod && isHodFinal && <Button onClick={hodDirectApprove} disabled={busy}>Approve Leave</Button>}
        {isHod && !isHodFinal && <Button onClick={hodRecommend} disabled={busy}>Approve &amp; send to principal</Button>}
        {!isHod && <Button onClick={principalApprove} disabled={busy}>Approve Leave</Button>}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={busy}>Reject</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this leave request?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The teacher will be notified that their request was rejected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={reject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, reject
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isHodFinal ? (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span><ChevronRight className="size-3" />
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning" : "bg-success/15 text-success"}`}>HOD Approval</span>
            <ChevronRight className="size-3" /><span className="rounded bg-muted px-2 py-0.5 inline-flex items-center gap-1"><CheckCircle2 className="size-3 text-success" /> Approved</span>
            <span>+</span><span className="rounded bg-muted px-2 py-0.5">Upload {requiredDoc}</span>
          </>
        ) : (
          <>
            <span className="rounded bg-muted px-2 py-0.5">Submitted</span><ChevronRight className="size-3" />
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_hod" ? "bg-warning/20 font-semibold text-warning" : "bg-muted"}`}>HOD</span>
            <ChevronRight className="size-3" />
            <span className={`rounded px-2 py-0.5 ${request.status === "pending_principal" ? "bg-warning/20 font-semibold text-warning" : "bg-muted"}`}>Principal</span>
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
  const docNoteGuardRef = useRef<GuardHandle>(null);
  const [payment, setPayment] = useState<"paid" | "unpaid">("paid");
  const [busy, setBusy] = useState(false);
  const requiredDoc = docLabel(request.leave_type as LeaveType) ?? "Document";
  const docUploaded = request.doc_status === "uploaded";
  const dates = useMemo(() => eachDate(request.from_date, request.to_date), [request.from_date, request.to_date]);

  async function verifyAndApprove() {
    if (note.trim()) {
      const guardErr = await docNoteGuardRef.current?.validateNow();
      if (guardErr) return;
    }
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
    if (note.trim()) {
      const guardErr = await docNoteGuardRef.current?.validateNow();
      if (guardErr) return;
    }
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
          <Badge variant={docUploaded ? "default" : "secondary"} className={docUploaded ? "bg-info text-info" : ""}>{docUploaded ? "Document Uploaded" : "Awaiting Upload"}</Badge>
          <span className="text-xs text-muted-foreground">HOD approved</span>
        </div>
      </div>
      {request.reason && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{request.reason}</p>}
      {request.hod_note && <p className="mt-2 text-xs text-muted-foreground">HOD note: {request.hod_note}</p>}
      <div className={`mt-3 rounded-lg border p-3 text-sm ${docUploaded ? "border-info/30 bg-info/8" : "border-warning/30 bg-warning/10"}`}>
        <p className="font-semibold flex items-center gap-1.5">{docUploaded ? <><CheckCircle2 className="size-4 text-info" /> {requiredDoc} uploaded</> : <><Clock className="size-4 text-warning" /> Waiting for {requiredDoc} upload</>}</p>
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
      <GuardedTextarea ref={docNoteGuardRef} fieldName="Note" className="mt-4" rows={2} maxLength={300} placeholder="Add a note (optional)" value={note} onChange={setNote} />
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
