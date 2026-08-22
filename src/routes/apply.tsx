import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBalances } from "@/hooks/useBalances";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { validateMeaningfulText } from "@/lib/validateText";
import { GuardedTextarea, type GuardHandle } from "@/components/GuardedField";
import { sendPushNotification } from "@/lib/push.functions";
import { useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  countWorkingDays,
  fmtDate,
  todayISO,
  isHodFinalLeave,
  docLabel,
  getMedicalFlow,
  LEAVE_TYPES,
  type LeaveType,
  type LeaveSession,
  type LeaveStatus,
} from "@/lib/leave";

const BLOCKING_STATUSES: LeaveStatus[] = [
  "pending_hod", "hod_recommended", "pending_principal", "hod_approved", "approved",
];

export const Route = createFileRoute("/apply")({
  head: () => ({
    meta: [
      { title: "Apply for Leave — CSC Leave Management" },
      { name: "description", content: "Apply for casual, maternity, bereavement or medical leave." },
      { property: "og:title", content: "Apply for Leave — CSC Leave Management" },
      { property: "og:description", content: "Submit a leave request to your HOD and principal." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <ApplyPage />
    </Guarded>
  ),
});

const schema = z.object({
  leaveType: z.enum(["casual", "maternity", "bereavement", "medical", "duty"]),
  fromDate: z.string().min(1, "Select a from date"),
  toDate: z.string().min(1, "Select a to date"),
  session: z.enum(["full_day", "forenoon", "afternoon"]),
  reason: z.string().trim().max(500, "Reason is too long"),
});

const STEPS = ["Leave Type", "Dates & Session", "Review & Submit"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div className={`flex size-7 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors ${
              i < current ? "bg-primary border-primary text-primary-foreground"
              : i === current ? "border-primary text-primary bg-background"
              : "border-muted text-muted-foreground bg-background"
            }`}>
              {i < current ? <CheckCircle2 className="size-4" /> : i + 1}
            </div>
            <span className={`text-[10px] font-medium text-center max-w-[60px] leading-tight ${i === current ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px mx-2 mb-4 transition-all duration-500 ${i < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ApplyPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: balances = [] } = useBalances(profile?.id);

  const DRAFT_KEY = `leave_draft_${profile?.id ?? "anon"}`;
  const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const draft = (() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Discard drafts older than 24 hours
      if (parsed._savedAt && Date.now() - parsed._savedAt > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return parsed;
    } catch { return null; }
  })();

  const [step, setStep] = useState(0);
  const [leaveType, setLeaveType] = useState<LeaveType>(draft?.leaveType ?? "casual");
  const [fromDate, setFromDate] = useState(draft?.fromDate ?? todayISO());
  const [toDate, setToDate] = useState(draft?.toDate ?? todayISO());
  const [session, setSession] = useState<LeaveSession>(draft?.session ?? "full_day");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonGuardRef = useRef<GuardHandle>(null);
  const sendPush = useServerFn(sendPushNotification);
  const [hasDraft] = useState(() => {
    if (!draft) return false;
    // Only show the banner if the draft has non-default content
    const hasCustomType   = draft.leaveType && draft.leaveType !== "casual";
    const hasCustomDate   = draft.fromDate && draft.fromDate !== todayISO();
    const hasCustomReason = draft.reason && draft.reason.trim().length > 0;
    return !!(hasCustomType || hasCustomDate || hasCustomReason);
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        leaveType, fromDate, toDate, session, reason, _savedAt: Date.now(),
      }));
    } catch {}
  }, [DRAFT_KEY, leaveType, fromDate, toDate, session, reason]);

  const isMedical = leaveType === "medical";
  const isDutyHodFinal = isHodFinalLeave(leaveType) && !isMedical;
  const requiredDoc = docLabel(leaveType);
  const isFemale = profile?.gender === "female";
  const availableLeaveTypes = LEAVE_TYPES.filter((t) => t.value !== "maternity" || isFemale);

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays-all"],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("holiday_date, occasion");
      if (error) throw error;
      return data;
    },
  });

  const { data: activeLeaves = [] } = useQuery({
    queryKey: ["my-active-leaves", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, from_date, to_date, status, leave_type")
        .eq("teacher_id", profile!.id)
        .in("status", BLOCKING_STATUSES);
      if (error) throw error;
      return data as { id: string; from_date: string; to_date: string; status: LeaveStatus; leave_type: LeaveType }[];
    },
  });

  const overlappingLeave = useMemo(() =>
    (!fromDate || !toDate || toDate < fromDate) ? null :
    activeLeaves.find((l) => l.from_date <= toDate && l.to_date >= fromDate) ?? null
  , [fromDate, toDate, activeLeaves]);

  const preview = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return null;
    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
    const { total, skipped, purelyNonWorking } = countWorkingDays(fromDate, toDate, session, holidaySet);
    if (isMedical) {
      return { total, skipped, purelyNonWorking, paid: 0, unpaid: 0, medicalFlow: getMedicalFlow(total) };
    }
    if (isDutyHodFinal || leaveType !== "casual") {
      return { total, skipped, purelyNonWorking, paid: 0, unpaid: 0, hodDecides: true, hodFinal: isDutyHodFinal };
    }
    const bal = balances.find((b) => b.type === leaveType);
    let remaining = bal ? Math.max(bal.yearlyCap - bal.usedYear, 0) : 0;
    if (bal?.monthlyCap !== undefined) remaining = Math.min(remaining, Math.max(bal.monthlyCap - bal.usedMonth, 0));
    const paid = Math.min(total, remaining);
    return { total, skipped, purelyNonWorking, paid, unpaid: total - paid };
  }, [fromDate, toDate, session, holidays, balances, leaveType, isMedical, isDutyHodFinal]);

  const medFlow = (preview && "medicalFlow" in preview) ? preview.medicalFlow : null;
  const casualBal = balances.find((b) => b.type === "casual");

  function validateStep(s: number): string | null {
    if (s === 0) return null; // leave type always valid
    if (s === 1) {
      if (toDate < fromDate) return "To date must be after from date";
      if (!isMedical && fromDate < todayISO()) return "Leave cannot be applied for a past date";
      if (session !== "full_day" && fromDate !== toDate) return "Half day leave must be single date";
      if (preview?.purelyNonWorking) return "Selected date is a Sunday or holiday";
      if (overlappingLeave) return `You have an overlapping leave from ${fmtDate(overlappingLeave.from_date)}`;
      return null;
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) return toast.error(err);
    setStep((s) => s + 1);
  }

  async function submit() {
    if (reasonError) return toast.error(reasonError);
    // Pre-submit guard: re-run all layers (including awaiting any in-flight LLM)
    if (reason.trim() && reasonGuardRef.current) {
      const guardErr = await reasonGuardRef.current.validateNow();
      if (guardErr) return toast.error(guardErr);
    }
    const parsed = schema.safeParse({ leaveType, fromDate, toDate, session, reason });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    const err = validateStep(1);
    if (err) return toast.error(err);
    setBusy(true);
    const docStatus = (isMedical && medFlow?.docRequired) ? "required" : undefined;
    const { error } = await supabase.from("leave_requests").insert({
      teacher_id: profile!.id,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      session,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      status: "pending_hod",
      ...(docStatus ? { doc_status: docStatus } : {}),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
    // Notify HOD — use __hod__ sentinel so server resolves the right HOD by department
    if (profile?.department_id) {
      sendPush({ data: {
        userIds:   [`__hod_dept_${profile.department_id}__`],
        title:     "New Leave Request",
        body:      `${profile.full_name ?? "A teacher"} applied for ${preview?.total ?? 1} day(s) of ${leaveType} leave`,
        targetUrl: "/requests",
      }}).catch(() => {});
    }
    if (isMedical) {
      toast.success(medFlow?.hodFinal
        ? "Medical leave sent to HOD — upload certificate after HOD approves"
        : "Medical leave sent to HOD → then to principal");
    } else if (isDutyHodFinal) {
      toast.success(`Duty leave sent to HOD — upload ${requiredDoc} after approval`);
    } else {
      toast.success("Leave request sent to your HOD");
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    navigate({ to: "/leaves" });
  }

  return (
    <AppShell title="Apply Leave" subtitle="Your request goes to HOD first, then the principal">
      <SectionCard className="max-w-2xl">
        <form onSubmit={(e) => e.preventDefault()} className="space-y-5">

          <StepIndicator current={step} />

          {/* Draft banner */}
          {hasDraft && step === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-xs text-orange-800 font-medium shadow-sm">
              <span>📝 Draft restored — your previous selections have been loaded.</span>
              <button type="button" className="ml-auto shrink-0 underline underline-offset-2 hover:text-orange-600" onClick={() => { try { localStorage.removeItem(DRAFT_KEY); } catch {} window.location.reload(); }}>Clear draft</button>
            </div>
          )}

          {/* ── STEP 0: Leave type ─────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Leave Type</Label>
                <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableLeaveTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {leaveType === "casual" && casualBal && (
                  <p className="text-xs text-muted-foreground pl-0.5">
                    Balance: <span className="font-medium text-foreground">{Math.max(casualBal.monthlyCap! - casualBal.usedMonth, 0)}/{casualBal.monthlyCap} this month</span>
                    {" · "}<span className="font-medium text-foreground">{Math.max(casualBal.yearlyCap - casualBal.usedYear, 0)}/{casualBal.yearlyCap} this year</span>
                  </p>
                )}
              </div>

              {isDutyHodFinal && (
                <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
                  <p className="font-semibold text-info">🗂 Duty Leave</p>
                  <p className="mt-1 text-muted-foreground">HOD approves directly. Upload <strong>Proof of Duty</strong> after approval.</p>
                </div>
              )}
              {isMedical && (
                <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
                  <p className="font-semibold text-info">🏥 Medical Leave</p>
                  <p className="mt-1 text-muted-foreground">≤ 3 days: no doc required, HOD + Principal approval. &nbsp;· &gt; 3 days: HOD approves directly, medical certificate required.</p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1: Dates & Session ────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Session</Label>
                <RadioGroup value={session} onValueChange={(v) => setSession(v as LeaveSession)} className="flex items-center gap-5">
                  {[["full_day","Full Day"],["forenoon","Forenoon"],["afternoon","Afternoon"]].map(([v,l]) => (
                    <div key={v} className="flex items-center gap-2">
                      <RadioGroupItem value={v} id={v} />
                      <Label htmlFor={v} className="font-normal">{l}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="from">From Date</Label>
                  <Input id="from" type="date" value={fromDate} min={isMedical ? undefined : todayISO()}
                    onChange={(e) => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to">To Date</Label>
                  <Input id="to" type="date" value={toDate} min={isMedical ? fromDate : todayISO()}
                    disabled={session !== "full_day"} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </div>

              {/* Overlap / non-working warnings */}
              {preview?.purelyNonWorking && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3 flex items-start gap-3">
                  <span className="text-destructive text-lg leading-none mt-0.5">⛔</span>
                  <p className="text-sm text-destructive">Selected date is a Sunday or holiday — not a working day.</p>
                </div>
              )}
              {overlappingLeave && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/8 p-3 text-sm">
                  <p className="font-semibold text-destructive">🚫 Date Conflict</p>
                  <p className="mt-1 text-muted-foreground">Active {overlappingLeave.leave_type} leave from <strong>{fmtDate(overlappingLeave.from_date)}</strong> to <strong>{fmtDate(overlappingLeave.to_date)}</strong>.</p>
                </div>
              )}

              {/* Preview strip */}
              {preview && !preview.purelyNonWorking && preview.total > 0 && (
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm space-y-1.5">
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <span><span className="text-muted-foreground">Leave days: </span><strong>{preview.total}</strong></span>
                    {preview.skipped > 0 && <span className="text-muted-foreground">+ {preview.skipped} Sun/holiday not counted</span>}
                    {"paid" in preview && !("medicalFlow" in preview) && !("hodDecides" in preview) && (
                      <>
                        {(preview.paid ?? 0) > 0 && <span className="text-success font-semibold">{preview.paid} paid</span>}
                        {(preview.unpaid ?? 0) > 0 && <span className="text-destructive font-semibold">{preview.unpaid} unpaid</span>}
                      </>
                    )}
                  </div>
                  {isMedical && medFlow && <p className="text-xs text-muted-foreground">{medFlow.description}</p>}
                  {preview.skipped === 0 && preview.total > 1 && (() => {
                    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
                    const allDates: string[] = [];
                    let d = new Date(fromDate + "T00:00:00");
                    const end = new Date(toDate + "T00:00:00");
                    while (d <= end) { allDates.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
                    const sw = allDates.filter(dt => new Date(dt+"T00:00:00").getDay()===0 || holidaySet.has(dt)).length;
                    if (!sw) return null;
                    return (
                      <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1 flex items-center gap-1.5">
                        <AlertTriangle className="size-3 shrink-0" /> {sw} Sunday/holiday sandwiched inside — counted as leave days.
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Review & Submit ────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Summary card — shown first so user reads it before submitting */}
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
                <p className="font-semibold text-base">Review your request</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-muted-foreground">Leave type</span>
                  <span className="font-medium capitalize">{leaveType.replace(/_/g," ")}</span>
                  <span className="text-muted-foreground">From</span>
                  <span className="font-medium">{fmtDate(fromDate)}</span>
                  <span className="text-muted-foreground">To</span>
                  <span className="font-medium">{fmtDate(toDate)}</span>
                  <span className="text-muted-foreground">Session</span>
                  <span className="font-medium capitalize">{session.replace(/_/g," ")}</span>
                  {preview && preview.total > 0 && <>
                    <span className="text-muted-foreground">Working days</span>
                    <span className="font-medium">{preview.total}</span>
                  </>}
                  {"unpaid" in (preview ?? {}) && (preview?.unpaid ?? 0) > 0 && <>
                    <span className="text-muted-foreground">Unpaid days</span>
                    <span className="font-medium text-destructive">{preview!.unpaid}</span>
                  </>}
                  {reason.trim() && <>
                    <span className="text-muted-foreground">Reason</span>
                    <span className="font-medium">{reason.trim()}</span>
                  </>}
                </div>
              </div>

              {/* Reason input — below review so it's clearly an optional addition */}
              <div className="space-y-2">
                <Label htmlFor="reason">Reason <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <GuardedTextarea ref={reasonGuardRef} id="reason" fieldName="Reason" rows={3} maxLength={500}
                  placeholder="Enter reason (optional)..." value={reason} onChange={setReason}
                  onGuardError={setReasonError} />
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex gap-3 pt-1">
            {step > 0 && (
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStep((s) => s - 1)}>
                <ChevronLeft className="size-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" className="flex-1" onClick={next}>
                Next <ChevronRight className="size-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" className="flex-1" onClick={submit} disabled={busy || !!overlappingLeave || !!preview?.purelyNonWorking || !!reasonError}>
                {busy ? "Submitting…" : "Submit Request"}
              </Button>
            )}
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}