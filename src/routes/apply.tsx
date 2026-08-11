import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { validateMeaningfulText, liveTextHint } from "@/lib/validateText";
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

/** Statuses that block a new leave application on overlapping dates */
const BLOCKING_STATUSES: LeaveStatus[] = [
  "pending_hod",
  "hod_recommended",
  "pending_principal",
  "hod_approved",
  "approved",
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

// Reason is now optional — min length removed
const schema = z.object({
  leaveType: z.enum(["casual", "maternity", "bereavement", "medical", "duty"]),
  fromDate: z.string().min(1, "Select a from date"),
  toDate: z.string().min(1, "Select a to date"),
  session: z.enum(["full_day", "forenoon", "afternoon"]),
  reason: z.string().trim().max(500, "Reason is too long"),
});

function ApplyPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: balances = [] } = useBalances(profile?.id);

  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [session, setSession] = useState<LeaveSession>("full_day");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isMedical  = leaveType === "medical";
  // Duty leave is always hodFinal; medical depends on days
  const isDutyHodFinal = isHodFinalLeave(leaveType) && !isMedical;
  const requiredDoc = docLabel(leaveType);

  // Gate maternity leave — only female teachers can see/apply it.
  // profile.gender comes from the auth context (already fetched at login), so
  // there is no loading delay and no false "not female" flash.
  const isFemale = profile?.gender === "Female";
  const availableLeaveTypes = LEAVE_TYPES.filter((t) =>
    t.value !== "maternity" || isFemale
  );

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays-all"],
    staleTime: 1000 * 60 * 60, // 1 hour — holidays don't change mid-session
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

  const overlappingLeave = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return null;
    return activeLeaves.find(
      (l) => l.from_date <= toDate && l.to_date >= fromDate
    ) ?? null;
  }, [fromDate, toDate, activeLeaves]);

  // Preview: count working days using the corrected helper
  const preview = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return null;
    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
    const { total, skipped, purelyNonWorking } = countWorkingDays(fromDate, toDate, session, holidaySet);

    if (isMedical) {
      const flow = getMedicalFlow(total);
      return { total, skipped, purelyNonWorking, paid: 0, unpaid: 0, medicalFlow: flow };
    }

    if (isDutyHodFinal || leaveType !== "casual") {
      return { total, skipped, purelyNonWorking, paid: 0, unpaid: 0, hodDecides: true, hodFinal: isDutyHodFinal };
    }

    const bal = balances.find((b) => b.type === leaveType);
    let remaining = bal ? Math.max(bal.yearlyCap - bal.usedYear, 0) : 0;
    if (bal?.monthlyCap !== undefined) {
      remaining = Math.min(remaining, Math.max(bal.monthlyCap - bal.usedMonth, 0));
    }
    const paid = Math.min(total, remaining);
    return { total, skipped, purelyNonWorking, paid, unpaid: total - paid };
  }, [fromDate, toDate, session, holidays, balances, leaveType, isMedical, isDutyHodFinal]);

  /** Remaining balance label shown inline in the dropdown */
  function balanceLabel(type: LeaveType): string {
    if (type === "casual") {
      const bal = balances.find((b) => b.type === type);
      if (!bal) return "";
      const monthly = bal.monthlyCap !== undefined ? Math.max(bal.monthlyCap - bal.usedMonth, 0) : null;
      const yearly  = Math.max(bal.yearlyCap - bal.usedYear, 0);
      return monthly !== null ? `${monthly} this month · ${yearly}/yr` : `${yearly} remaining`;
    }
    if (type === "medical") {
      // Medical: 10 days per year total
      const bal = balances.find((b) => b.type === type);
      const usedYear = bal ? bal.usedYear : 0;
      const remaining = Math.max(10 - usedYear, 0);
      return `${remaining}/10 remaining this year`;
    }
    // Bereavement, maternity, duty — no balance counter shown
    return "";
  }

  // Medical flow derived from preview
  const medFlow = (preview && "medicalFlow" in preview) ? preview.medicalFlow : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ leaveType, fromDate, toDate, session, reason });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    // Medical leave can go to past or future — skip the past-date guard
    if (!isMedical && fromDate < todayISO())
      return toast.error("Leave cannot be applied for a past date");
    if (toDate < fromDate) return toast.error("To date must be after the from date");
    if (session !== "full_day" && fromDate !== toDate)
      return toast.error("Half day leave must be for a single date");
    // Validate reason contains meaningful words if provided
    if (reason.trim()) {
      const reasonCheck = validateMeaningfulText(reason, "Reason");
      if (!reasonCheck.valid) return toast.error(reasonCheck.error!);
    }
    if (preview && preview.purelyNonWorking)
      return toast.error("You cannot apply leave for a date that is only a Sunday or public holiday. Please select at least one working day.");
    if (overlappingLeave)
      return toast.error(
        `You already have an active leave from ${fmtDate(overlappingLeave.from_date)} to ${fmtDate(overlappingLeave.to_date)}. Cancel or wait for it to be resolved first.`
      );

    setBusy(true);

    const initialStatus = "pending_hod";

    // For medical >3 days, mark doc_status as "required" upfront
    const docStatus = (isMedical && medFlow?.docRequired) ? "required" : undefined;

    const { error } = await supabase.from("leave_requests").insert({
      teacher_id: profile!.id,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      session: session,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      status: initialStatus,
      ...(docStatus ? { doc_status: docStatus } : {}),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();

    if (isMedical) {
      if (medFlow?.hodFinal) {
        toast.success("Medical leave sent to HOD — upload your medical certificate after HOD approves for principal verification");
      } else {
        toast.success("Medical leave sent to HOD → then to principal for approval");
      }
    } else if (isDutyHodFinal) {
      toast.success(`Duty leave sent to HOD — upload ${requiredDoc} after approval`);
    } else {
      toast.success("Leave request sent to your HOD");
    }
    navigate({ to: "/leaves" });
  }

  const casualBal = balances.find((b) => b.type === "casual");

  return (
    <AppShell title="Apply Leave" subtitle="Your request goes to the HOD first, then the principal">
      <SectionCard className="max-w-2xl">
        <form onSubmit={submit} className="space-y-5">

          {/* Duty leave banner */}
          {isDutyHodFinal && (
            <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
              <p className="font-semibold text-info">🗂 Duty Leave</p>
              <p className="mt-1 text-muted-foreground">
                HOD approves directly. Upload <strong>Proof of Duty</strong> after approval for principal verification.
              </p>
            </div>
          )}

          {/* Medical banner — updates dynamically as dates change */}
          {isMedical && medFlow && (
            <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
              <p className="font-semibold text-info">🏥 Medical Leave — {preview?.total ?? 0} working day(s)</p>
              <p className="mt-1 text-muted-foreground">{medFlow.description}</p>
            </div>
          )}
          {isMedical && !medFlow && (
            <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
              <p className="font-semibold text-info">🏥 Medical Leave</p>
              <p className="mt-1 text-muted-foreground">
                ≤ 3 days: no doc required, needs HOD + Principal approval.
                &nbsp;· &gt; 3 days: HOD approves directly, medical certificate required for principal.
                <br />Medical leave can be applied for past or future dates.
              </p>
            </div>
          )}

          {/* Overlap warning */}
          {overlappingLeave && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/8 p-3 text-sm">
              <p className="font-semibold text-destructive">🚫 Date Conflict</p>
              <p className="mt-1 text-muted-foreground">
                You already have an active{" "}
                <strong>{LEAVE_TYPES.find((t) => t.value === overlappingLeave.leave_type)?.label ?? overlappingLeave.leave_type}</strong>{" "}
                from <strong>{fmtDate(overlappingLeave.from_date)}</strong> to{" "}
                <strong>{fmtDate(overlappingLeave.to_date)}</strong> ({overlappingLeave.status.replace(/_/g, " ")}). Choose different dates or cancel that request first.
              </p>
            </div>
          )}

          {/* Leave type — with inline balance beside each option */}
          <div className="space-y-1.5">
            <Label>Leave Type</Label>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableLeaveTypes.map((t) => {
                  const bal = balanceLabel(t.value);
                  return (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center justify-between w-full gap-4">
                        <span>{t.label}</span>
                        {bal && (
                          <span className="text-xs text-muted-foreground">{bal} remaining</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {/* Detailed balance shown under the dropdown for casual leave */}
            {leaveType === "casual" && casualBal && (
              <p className="text-xs text-muted-foreground pl-0.5">
                Balance: <span className="font-medium text-foreground">
                  {Math.max(casualBal.monthlyCap! - casualBal.usedMonth, 0)}/{casualBal.monthlyCap} this month
                </span>
                {" · "}
                <span className="font-medium text-foreground">
                  {Math.max(casualBal.yearlyCap - casualBal.usedYear, 0)}/12 this year
                </span>
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Session */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Session</Label>
              <RadioGroup value={session} onValueChange={(v) => setSession(v as LeaveSession)} className="flex h-9 items-center gap-5">
                {[["full_day","Full Day"],["forenoon","Forenoon"],["afternoon","Afternoon"]].map(([v,l]) => (
                  <div key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={v} />
                    <Label htmlFor={v} className="font-normal">{l}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* From date — medical allows any date */}
            <div className="space-y-2">
              <Label htmlFor="from">From Date</Label>
              <Input
                id="from"
                type="date"
                value={fromDate}
                min={isMedical ? undefined : todayISO()}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  if (toDate < e.target.value) setToDate(e.target.value);
                }}
              />
            </div>

            {/* To date */}
            <div className="space-y-2">
              <Label htmlFor="to">To Date</Label>
              <Input
                id="to"
                type="date"
                value={toDate}
                min={isMedical ? fromDate : fromDate < todayISO() ? fromDate : fromDate}
                disabled={session !== "full_day"}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          {/* Inline warning: purely non-working dates selected */}
          {preview?.purelyNonWorking && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3 flex items-start gap-3">
              <span className="text-destructive text-lg leading-none mt-0.5">⛔</span>
              <div>
                <p className="text-sm font-semibold text-destructive">Cannot apply leave on this date</p>
                <p className="text-xs text-destructive/80 mt-0.5">
                  The selected date{preview.skipped > 1 ? "s are" : " is"} a Sunday or public holiday.
                  Leave cannot be applied for a day that is not a working day.
                  Please select at least one working day.
                </p>
              </div>
            </div>
          )}

          {/* Preview strip */}
          {preview && !preview.purelyNonWorking && preview.total > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm space-y-1.5">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span><span className="text-muted-foreground">Leave days: </span><strong>{preview.total}</strong></span>
                {preview.skipped > 0 && (
                  <span className="text-muted-foreground">
                    + {preview.skipped} leading/trailing Sun/holiday{preview.skipped > 1 ? "s" : ""} (not counted)
                  </span>
                )}
                {"paid" in preview && !("medicalFlow" in preview) && !("hodDecides" in preview) && (
                  <>
                    {(preview.paid ?? 0) > 0 && <span className="text-success font-semibold">{preview.paid} paid</span>}
                    {(preview.unpaid ?? 0) > 0 && <span className="text-destructive font-semibold">{preview.unpaid} unpaid (pay cut)</span>}
                  </>
                )}
              </div>
              {/* Sandwich hint when non-working days are sandwiched inside */}
              {preview.skipped === 0 && preview.total > 1 && (() => {
                const holidaySet = new Set(holidays.map((h) => h.holiday_date));
                const allDates = fromDate && toDate ? (() => {
                  const ds: string[] = [];
                  let d = new Date(fromDate + "T00:00:00");
                  const end = new Date(toDate + "T00:00:00");
                  while (d <= end) { ds.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
                  return ds;
                })() : [];
                const sandwichedCount = allDates.filter(d =>
                  new Date(d + "T00:00:00").getDay() === 0 || holidaySet.has(d)
                ).length;
                if (sandwichedCount === 0) return null;
                return (
                  <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">
                    ⚠️ {sandwichedCount} Sunday/holiday{sandwichedCount > 1 ? "s are" : " is"} sandwiched inside your leave and counted as leave day{sandwichedCount > 1 ? "s" : ""}.
                    {" "}If this leave is unpaid, pay cut applies to all {preview.total} days.
                  </p>
                );
              })()}
            </div>
          )}

          {/* Reason — optional */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="reason"
              rows={4}
              maxLength={500}
              placeholder="Enter reason for leave (optional)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {liveTextHint(reason) && (
              <p className="text-xs text-destructive">{liveTextHint(reason)}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={busy || !!overlappingLeave || !!preview?.purelyNonWorking}>
            Submit Request
          </Button>
        </form>
      </SectionCard>
    </AppShell>
  );
}
