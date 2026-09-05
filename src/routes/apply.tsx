import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
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
import { firePush } from "@/lib/push.functions";
import { useRef } from "react";
import { AlertTriangle, Baby, Briefcase, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock, FileText, Flower2, Info, ShieldCheck, Stethoscope, XCircle } from "lucide-react";
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
      { name: "robots", content: "noindex, nofollow" },
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
const STEPS_SHORT = ["Type", "Dates", "Review"]; // fits on very small screens

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none min-w-0">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors ${
              i < current ? "bg-primary border-primary text-primary-foreground"
              : i === current ? "border-primary text-primary bg-background"
              : "border-muted text-muted-foreground bg-background"
            }`}>
              {i < current ? <CheckCircle2 className="size-4" /> : i + 1}
            </div>
            {/* Full label on sm+, short label on xs */}
            <span className={`hidden sm:block text-[10px] font-medium text-center leading-tight whitespace-nowrap ${i === current ? "text-primary" : "text-muted-foreground"}`}>
              {label}
            </span>
            <span className={`sm:hidden text-[10px] font-medium text-center leading-tight whitespace-nowrap ${i === current ? "text-primary" : "text-muted-foreground"}`}>
              {STEPS_SHORT[i]}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px mx-2 mb-4 transition-all duration-500 ${i < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Sidebar info panel ────────────────────────────────────────────────────────
function ApplySidebar({ leaveType, balances, holidays }: {
  leaveType: LeaveType;
  balances: ReturnType<typeof useBalances>["data"];
  holidays: { holiday_date: string; occasion: string }[];
}) {
  const upcomingHolidays = holidays
    .filter(h => h.holiday_date >= todayISO())
    .slice(0, 4);

  const tips: { icon: React.ReactNode; text: string }[] = [
    {
      icon: <Clock className="size-3.5 shrink-0 text-primary" />,
      text: "Apply at least 1 day in advance for casual leave.",
    },
    {
      icon: <FileText className="size-3.5 shrink-0 text-primary" />,
      text: "Medical leave > 3 days requires a certificate after HOD approval.",
    },
    {
      icon: <CalendarDays className="size-3.5 shrink-0 text-primary" />,
      text: "Sundays and holidays between your dates are not counted as leave days.",
    },
    {
      icon: <ShieldCheck className="size-3.5 shrink-0 text-primary" />,
      text: "Your request goes to HOD first. Principal reviews after HOD recommends.",
    },
  ];

  const leaveInfo: Record<string, { icon: React.ElementType; emoji?: string; desc: string }> = {
    casual:      { icon: CalendarDays,  emoji: "", desc: "Up to 2 per month, 12 per year. Exhausted days become unpaid." },
    medical:     { icon: Stethoscope,   emoji: "", desc: "≤ 3 days: HOD + Principal. > 3 days: HOD only with certificate." },
    maternity:   { icon: Baby,          emoji: "", desc: "Available for female staff. HOD approves. Fully paid." },
    bereavement: { icon: Flower2,       emoji: "", desc: "For the loss of an immediate family member. HOD approves." },
    duty:        { icon: Briefcase,     emoji: "", desc: "For official duties outside college. HOD approves directly." },
  };

  const info = leaveInfo[leaveType];

  return (
    <div className="space-y-4">
      {/* Leave type info card */}
      {info && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-semibold flex items-center gap-2 mb-1.5">
            <info.icon className="size-4 text-primary"/>
            <span className="capitalize">{leaveType.replace(/_/g, " ")} Leave</span>
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{info.desc}</p>
        </div>
      )}

      {/* Balance card — Casual & Medical only */}
      {(balances ?? []).length > 0 && (() => {
        const casualBal  = (balances ?? []).find(b => b.type === "casual");
        const medicalBal = (balances ?? []).find(b => b.type === "medical");
        const items = [
          casualBal  ? { label: "Casual Leave",  used: casualBal.usedYear,  cap: casualBal.yearlyCap,  monthUsed: casualBal.usedMonth,  monthCap: casualBal.monthlyCap }  : null,
          medicalBal ? { label: "Medical Leave", used: medicalBal.usedYear, cap: medicalBal.yearlyCap, monthUsed: null, monthCap: null } : null,
        ].filter(Boolean) as { label: string; used: number; cap: number; monthUsed: number | null; monthCap?: number }[];
        if (!items.length) return null;
        return (
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave Balance</p>
            {items.map(b => {
              const remYear  = Math.max(b.cap - b.used, 0);
              const remMonth = b.monthCap != null ? Math.max(b.monthCap - (b.monthUsed ?? 0), 0) : null;
              const pct = b.cap > 0 ? Math.min((b.used / b.cap) * 100, 100) : 0;
              return (
                <div key={b.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{b.label}</span>
                    <span className={remYear === 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                      {remYear}/{b.cap} left this year
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {remMonth !== null && (
                    <p className="text-[11px] text-muted-foreground mt-1">{remMonth}/{b.monthCap} left this month</p>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Tips */}
      <div className="rounded-xl border border-border p-4 space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Info className="size-3.5" /> Tips
        </p>
        {tips.map((t, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
            {t.icon}
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {/* Upcoming holidays */}
      {upcomingHolidays.length > 0 && (
        <div className="rounded-xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming Holidays</p>
          {upcomingHolidays.map(h => (
            <div key={h.holiday_date} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{fmtDate(h.holiday_date)}</span>
              <span className="font-medium">{h.occasion}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProxyAvailabilityHint({ departmentId, fromDate, toDate }: {
  departmentId?: string; fromDate: string; toDate: string;
}) {
  const { data } = useQuery({
    queryKey: ["proxy-availability", departmentId, fromDate, toDate],
    enabled: !!departmentId && !!fromDate,
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("department_id", departmentId!)
        .eq("approved", true);
      // Subtract 1 for the applicant themselves
      return Math.max((count ?? 0) - 1, 0);
    },
  });
  // Only warn if there are 0 other teachers available in the dept
  if (data === undefined || data > 0) return null;
  return (
    <div className="col-span-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
      <span>Your department has limited staff. HOD may have difficulty finding a proxy for these dates.</span>
    </div>
  );
}

function ApplyPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: balances = [] } = useBalances(profile?.id);

  // Draft is loaded async from Supabase user_metadata
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [serverDraft, setServerDraft] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const d = data?.user?.user_metadata?.leave_draft;
      if (d && d._savedAt && Date.now() - d._savedAt < 24 * 60 * 60 * 1000) {
        setServerDraft(d);
      }
      setDraftLoaded(true);
    }).catch(() => setDraftLoaded(true));
  }, []);

  const [step, setStep] = useState(0);
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [session, setSession] = useState<LeaveSession>("full_day");
  const [reason, setReason] = useState("");

  // Ref to track whether we've already populated from draft — prevents
  // the populate effect from re-firing and triggering the save effect 5×
  const draftPopulated = useRef(false);

  useEffect(() => {
    if (!draftLoaded || !serverDraft || draftPopulated.current) return;
    draftPopulated.current = true;
    if (serverDraft.leaveType) setLeaveType(serverDraft.leaveType);
    if (serverDraft.fromDate)  setFromDate(serverDraft.fromDate);
    if (serverDraft.toDate)    setToDate(serverDraft.toDate);
    if (serverDraft.session)   setSession(serverDraft.session);
    if (serverDraft.reason)    setReason(serverDraft.reason);
  }, [draftLoaded, serverDraft]);
  const [busy, setBusy] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonGuardRef = useRef<GuardHandle>(null);
  const hasDraft = draftLoaded && serverDraft && (() => {
    if (!serverDraft) return false;
    const hasCustomType   = serverDraft.leaveType && serverDraft.leaveType !== "casual";
    const hasCustomDate   = serverDraft.fromDate && serverDraft.fromDate !== todayISO();
    const hasCustomReason = serverDraft.reason && serverDraft.reason.trim().length > 0;
    return !!(hasCustomType || hasCustomDate || hasCustomReason);
  })();

  // Save draft to Supabase user_metadata (debounced, only after draft was populated)
  useEffect(() => {
    if (!draftLoaded || !draftPopulated.current) return;
    const t = setTimeout(() => {
      supabase.auth.updateUser({ data: { leave_draft: {
        leaveType, fromDate, toDate, session, reason, _savedAt: Date.now(),
      }}}).catch(() => {});
    }, 3000); // 3s — avoids a Supabase write on every keystroke
    return () => clearTimeout(t);
  }, [draftLoaded, leaveType, fromDate, toDate, session, reason]);

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
    if (s === 0) return null;
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

  // ── Navigation guard — warn before leaving with unsaved wizard progress ───
  // isDirty: user has moved past step 0 OR changed any default value
  const isDirty = step > 0
    || leaveType !== "casual"
    || fromDate !== todayISO()
    || toDate !== todayISO()
    || reason.trim().length > 0;

  const { proceed, reset, status } = useBlocker({
    blockerFn: () => isDirty && !busy,
    condition: isDirty && !busy,
  });

  async function submit() {
    if (reasonError) return toast.error(reasonError);
    // Server-side guard: maternity only for female staff
    if (leaveType === "maternity" && profile?.gender !== "female") {
      return toast.error("Maternity leave is only available for female staff.");
    }
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
    // Rate limit: prevent duplicate submissions within 30 seconds
    const { data: recent } = await supabase
      .from("leave_requests")
      .select("id, created_at")
      .eq("teacher_id", profile!.id)
      .gte("created_at", new Date(Date.now() - 30_000).toISOString())
      .limit(1);
    if (recent && recent.length > 0) {
      setBusy(false);
      return toast.error("You just submitted a request. Please wait a moment before submitting again.");
    }

    // Server-side guard: re-verify gender from DB — client profile can't be trusted
    if (leaveType === "maternity") {
      const { data: dbProfile } = await supabase
        .from("profiles")
        .select("gender")
        .eq("id", profile!.id)
        .single();
      if (dbProfile?.gender !== "female") {
        setBusy(false);
        return toast.error("Maternity leave is only available for female staff.");
      }
    }

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
    qc.invalidateQueries({ queryKey: ["my-leaves", profile?.id] });
    // Send push — fire and forget via async IIFE (useServerFn result is not a native Promise)
    if (profile?.department_id) {
      firePush({
        userIds:   [`__hod_dept_${profile!.department_id}__`],
        title:     "New Leave Request",
        body:      `${profile!.full_name ?? "A teacher"} applied for ${preview?.total ?? 1} day(s) of ${leaveType} leave`,
        targetUrl: "/requests",
      });
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
    supabase.auth.updateUser({ data: { leave_draft: null } }).catch(() => {});
    navigate({ to: "/leaves", search: { filter: "all" } });
  }

  return (
    <AppShell title="Apply Leave" subtitle="Your request goes to HOD first, then the principal">
      {/* Two-column layout: wizard left, info sidebar right */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">

        {/* ── Left: wizard ─────────────────────────────────────────────── */}
        <SectionCard>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
            <StepIndicator current={step} />

            {/* Draft banner */}
            {hasDraft && step === 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-warning bg-warning px-3 py-2.5 text-xs text-warning-foreground font-medium shadow-sm">
                <span className="inline-flex items-center gap-1"><ClipboardList className="size-4"/>Draft restored — your previous selections have been loaded.</span>
                <button type="button" className="ml-auto shrink-0 underline underline-offset-2 hover:opacity-70"
                  onClick={() => { supabase.auth.updateUser({ data: { leave_draft: null } }).catch(() => {}); window.location.reload(); }}>
                  Clear draft
                </button>
              </div>
            )}

            {/* ── STEP 0: Leave type ──────────────────────────────────── */}
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
                    <p className="font-semibold text-info flex items-center gap-1"><Briefcase className="size-4"/>Duty Leave</p>
                    <p className="mt-1 text-muted-foreground">HOD approves directly. Upload <strong>Proof of Duty</strong> after approval.</p>
                  </div>
                )}
                {isMedical && (
                  <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
                    <p className="font-semibold text-info flex items-center gap-1"><Stethoscope className="size-4"/>Medical Leave</p>
                    <p className="mt-1 text-muted-foreground">≤ 3 days: no doc required, HOD + Principal approval. &nbsp;· &gt; 3 days: HOD approves directly, medical certificate required.</p>
                  </div>
                )}


              </div>
            )}

            {/* ── STEP 1: Dates & Session ─────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Session</Label>
                  <RadioGroup value={session} onValueChange={(v) => setSession(v as LeaveSession)} className="flex flex-wrap items-center gap-x-5 gap-y-2">
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

                {preview?.purelyNonWorking && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3 flex items-start gap-3">
                    <XCircle className="size-5 text-destructive shrink-0 mt-0.5"/>
                    <p className="text-sm text-destructive">Selected date is a Sunday or holiday — not a working day.</p>
                  </div>
                )}
                {overlappingLeave && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/8 p-3 text-sm">
                    <p className="font-semibold text-destructive">Date Conflict</p>
                    <p className="mt-1 text-muted-foreground">Active {overlappingLeave.leave_type} leave from <strong>{fmtDate(overlappingLeave.from_date)}</strong> to <strong>{fmtDate(overlappingLeave.to_date)}</strong>.</p>
                  </div>
                )}

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
                    {preview.total > 1 && (() => {
                      // Find non-working days WITHIN the date range that were NOT skipped
                      // (i.e. sandwiched between working days and thus counted as leave days)
                      const holidaySet = new Set(holidays.map((h) => h.holiday_date));
                      const allDates: string[] = [];
                      // eslint-disable-next-line prefer-const
                      let d = new Date(fromDate + "T00:00:00");
                      const end = new Date(toDate + "T00:00:00");
                      while (d <= end) { allDates.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
                      // Total non-working days in range
                      const totalNonWorking = allDates.filter(dt => new Date(dt+"T00:00:00").getDay()===0 || holidaySet.has(dt)).length;
                      // Sandwiched = non-working days that were counted (not skipped)
                      const sandwiched = totalNonWorking - preview.skipped;
                      if (sandwiched <= 0) return null;
                      return (
                        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1 flex items-center gap-1.5">
                          <AlertTriangle className="size-3 shrink-0" /> {sandwiched} Sunday/holiday sandwiched inside — counted as leave days.
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: Review & Submit ─────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
                  <p className="font-semibold text-base">Review your request</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm [&>span:nth-child(odd)]:min-w-0 [&>span:nth-child(even)]:min-w-0 [&>span:nth-child(even)]:break-words">
                    <span className="text-muted-foreground">Leave type</span>
                    <span className="font-medium capitalize">{leaveType.replace(/_/g," ")}</span>
                    <span className="text-muted-foreground">From</span>
                    <span className="font-medium">{fmtDate(fromDate)}</span>
                    <span className="text-muted-foreground">To</span>
                    <span className="font-medium">{fmtDate(toDate)}</span>
                    <span className="text-muted-foreground">Session</span>
                    <span className="font-medium capitalize">{session.replace(/_/g," ")}</span>
                    {/* Proxy availability hint */}
                    {preview && preview.total > 0 && profile?.department_id && (
                      <div className="col-span-2">
                        <ProxyAvailabilityHint
                          departmentId={profile.department_id}
                          fromDate={fromDate}
                          toDate={toDate}
                        />
                      </div>
                    )}
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

                {/* Approval flow visual */}
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Approval Flow</p>
                  <div className="flex items-center gap-1 min-w-0 text-xs overflow-x-auto">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className="size-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">You</div>
                    </div>
                    <div className="flex-1 min-w-[12px] h-px bg-primary/30" />
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className="size-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-[10px] font-bold">HOD</div>
                    </div>
                    {!isDutyHodFinal && !(leaveType === "medical" && medFlow?.hodFinal) && <>
                      <div className="flex-1 min-w-[12px] h-px bg-muted-foreground/30" />
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <div className="size-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-[9px] font-bold">PRIN</div>
                      </div>
                    </>}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {isDutyHodFinal ? "HOD is the final approver for this leave type." :
                     leaveType === "medical" && medFlow?.hodFinal ? "HOD is the final approver for medical leave > 3 days." :
                     "HOD reviews first, then forwards to Principal."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">Reason <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <GuardedTextarea ref={reasonGuardRef} id="reason" fieldName="Reason" rows={3} maxLength={500}
                    placeholder="Enter reason (optional)..." value={reason}
                    onChange={(v) => { setReason(v); if (!v.trim()) setReasonError(null); }}
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
                <Button type="button" className="flex-1" onClick={submit}
                  disabled={busy || !!overlappingLeave || !!preview?.purelyNonWorking || !!reasonError}>
                  {busy ? "Submitting…" : "Submit Request"}
                </Button>
              )}
            </div>
          </form>
        </SectionCard>

        {/* ── Right: info sidebar (hidden on mobile, shown on lg+) ──────── */}
        <div className="hidden lg:block">
          <ApplySidebar leaveType={leaveType} balances={balances} holidays={holidays} />
        </div>

        {/* Mobile info accordion — full sidebar content, collapsible ───── */}
        <div className="lg:hidden">
          <details className="group rounded-xl border border-border bg-muted/20 overflow-hidden">
            <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-semibold list-none">
              <span className="flex items-center gap-2">
                <Info className="size-4 text-primary" />
                Leave info &amp; balance
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 pt-1">
              <ApplySidebar leaveType={leaveType} balances={balances} holidays={holidays} />
            </div>
          </details>
        </div>

      </div>

      {/* ── Unsaved changes dialog ──────────────────────────────────────────── */}
      {status === "blocked" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={reset} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-background border border-border shadow-2xl p-6 animate-in fade-in-0 zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-warning/15">
                <AlertTriangle className="size-5 text-warning-foreground" />
              </div>
              <div>
                <p className="font-semibold text-sm">Leave this page?</p>
                <p className="text-xs text-muted-foreground">Your draft is saved and will be restored when you return.</p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={reset}>Stay</Button>
              <Button variant="destructive" className="flex-1" onClick={proceed}>Leave anyway</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
