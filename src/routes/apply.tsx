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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LEAVE_TYPES,
  eachDate,
  fmtDate,
  todayISO,
  isHodFinalLeave,
  docLabel,
  getMedicalFlow,
  type LeaveType,
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
      { name: "description", content: "Apply for casual, maternity, bereavement, emergency or medical leave." },
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
  leaveType: z.enum(["casual", "maternity", "bereavement", "emergency", "medical", "duty"]),
  fromDate: z.string().min(1, "Select a from date"),
  toDate: z.string().min(1, "Select a to date"),
  session: z.enum(["full_day", "forenoon", "afternoon"]),
  reason: z.string().trim().min(5, "Please give a reason").max(500, "Reason is too long"),
});

function ApplyPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: balances = [] } = useBalances(profile?.id);

  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [session, setSession] = useState("full_day");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isMedical  = leaveType === "medical";
  const isEmergency = leaveType === "emergency";
  // Duty leave is always hodFinal; medical depends on days
  const isDutyHodFinal = isHodFinalLeave(leaveType) && !isMedical;
  const requiredDoc = docLabel(leaveType);

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("holiday_date, occasion");
      if (error) throw error;
      return data;
    },
  });

  // Fetch teacher's own active (non-rejected) leaves for overlap check
  // Medical leave is excluded from overlap blocking (can span past/future)
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

  // Preview: count working days skipping Sundays and holidays
  const preview = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return null;
    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
    const dates = eachDate(fromDate, toDate);
    const working = dates.filter(
      (d) => new Date(d + "T00:00:00").getDay() !== 0 && !holidaySet.has(d),
    );
    let days = working.length;
    if (session !== "full_day") days = Math.min(days, 1) * 0.5;

    if (isEmergency) {
      return { total: days, skipped: dates.length - working.length, paid: 0, unpaid: days, alwaysUnpaid: true };
    }

    if (isMedical) {
      const flow = getMedicalFlow(days);
      return { total: days, skipped: dates.length - working.length, paid: 0, unpaid: 0, medicalFlow: flow };
    }

    if (isDutyHodFinal || leaveType !== "casual") {
      return { total: days, skipped: dates.length - working.length, paid: 0, unpaid: 0, hodDecides: true, hodFinal: isDutyHodFinal };
    }

    const bal = balances.find((b) => b.type === leaveType);
    let remaining = bal ? Math.max(bal.yearlyCap - bal.usedYear, 0) : 0;
    if (bal?.monthlyCap !== undefined) {
      remaining = Math.min(remaining, Math.max(bal.monthlyCap - bal.usedMonth, 0));
    }
    const paid = Math.min(days, remaining);
    return { total: days, skipped: dates.length - working.length, paid, unpaid: days - paid };
  }, [fromDate, toDate, session, holidays, balances, leaveType, isEmergency, isMedical, isDutyHodFinal]);

  // Inline balance label shown next to leave type in the dropdown
  function balanceHint(type: LeaveType): string {
    if (type === "casual") {
      const bal = balances.find((b) => b.type === "casual");
      if (!bal) return "";
      const monthly = bal.monthlyCap !== undefined ? Math.max(bal.monthlyCap - bal.usedMonth, 0) : null;
      const yearly  = Math.max(bal.yearlyCap - bal.usedYear, 0);
      return monthly !== null
        ? `${monthly}/${bal.monthlyCap} this month · ${yearly}/12 this year`
        : `${yearly} remaining`;
    }
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
    if (preview && preview.total === 0)
      return toast.error("The selected dates are all Sundays or holidays");
    if (overlappingLeave)
      return toast.error(
        `You already have an active leave from ${fmtDate(overlappingLeave.from_date)} to ${fmtDate(overlappingLeave.to_date)}. Cancel or wait for it to be resolved first.`
      );

    setBusy(true);

    // Determine status for medical:
    //   ≤3 days → pending_hod (needs HOD recommend → principal approve)
    //   >3 days → pending_hod (HOD can hod_approved directly; doc upload gates principal)
    const initialStatus = isEmergency ? "pending_principal" : "pending_hod";

    // For medical >3 days, mark doc_status as "required" upfront
    const docStatus = (isMedical && medFlow?.docRequired) ? "required" : undefined;

    const { error } = await supabase.from("leave_requests").insert({
      teacher_id: profile!.id,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      session: session as "full_day" | "forenoon" | "afternoon",
      reason: reason.trim(),
      status: initialStatus,
      ...(docStatus ? { doc_status: docStatus } : {}),
      ...(isEmergency && preview
        ? { paid_days: 0, unpaid_days: preview.total, total_days: preview.total }
        : {}),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();

    if (isEmergency) {
      toast.success("Emergency leave submitted — auto-approves in 5 hours with pay cut");
    } else if (isMedical) {
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

          {/* Emergency banner */}
          {isEmergency && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/8 p-3 text-sm">
              <p className="font-semibold text-destructive">⚠ Emergency Leave</p>
              <p className="mt-1 text-muted-foreground">
                Auto-approved after <strong>5 hours</strong> without HOD or principal action.
                All days are <strong>unpaid</strong>.
              </p>
            </div>
          )}

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

          {/* Leave type — with inline balance hint below */}
          <div className="space-y-1.5">
            <Label>Leave Type</Label>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex items-center justify-between w-full gap-4">
                      <span>{t.label}</span>
                      {t.info && (
                        <span className="text-xs text-muted-foreground">{t.info}</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Inline balance shown directly under the dropdown */}
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
              <RadioGroup value={session} onValueChange={setSession} className="flex h-9 items-center gap-5">
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

          {/* Preview strip — inline below the dates */}
          {preview && preview.total > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
              <span><span className="text-muted-foreground">Working days: </span><strong>{preview.total}</strong></span>
              {preview.skipped > 0 && (
                <span><span className="text-muted-foreground">Skipped (Sun/holiday): </span><strong>{preview.skipped}</strong></span>
              )}
              {"alwaysUnpaid" in preview && preview.alwaysUnpaid && (
                <span className="text-destructive font-semibold">All {preview.total} day(s) unpaid</span>
              )}
              {"paid" in preview && !("alwaysUnpaid" in preview) && !("medicalFlow" in preview) && !("hodDecides" in preview) && (
                <>
                  {(preview.paid ?? 0) > 0 && <span className="text-success font-semibold">{preview.paid} paid</span>}
                  {(preview.unpaid ?? 0) > 0 && <span className="text-destructive font-semibold">{preview.unpaid} unpaid</span>}
                </>
              )}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={4}
              maxLength={500}
              placeholder={isEmergency ? "Describe the emergency situation..." : "Enter reason for leave..."}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy || !!overlappingLeave}>
            {isEmergency ? "Submit Emergency Leave" : "Submit Request"}
          </Button>
        </form>
      </SectionCard>
    </AppShell>
  );
}
