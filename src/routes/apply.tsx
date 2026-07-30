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
  isAlwaysUnpaid,
  isHodFinalLeave,
  docLabel,
  type LeaveType,
} from "@/lib/leave";

export const Route = createFileRoute("/apply")({
  head: () => ({
    meta: [
      { title: "Apply for Leave — CSC Leave Management" },
      {
        name: "description",
        content: "Apply for casual, maternity, bereavement, emergency or half-day leave.",
      },
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
  leaveType: z.enum(["casual", "maternity", "bereavement", "other", "emergency", "medical", "duty"]),
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

  const isEmergency = leaveType === "emergency";
  const isHodFinal = isHodFinalLeave(leaveType);
  const requiredDoc = docLabel(leaveType);

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("holiday_date, occasion");
      if (error) throw error;
      return data;
    },
  });

  const preview = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return null;
    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
    const dates = eachDate(fromDate, toDate);
    const working = dates.filter(
      (d) => new Date(d + "T00:00:00").getDay() !== 0 && !holidaySet.has(d),
    );
    let days = working.length;
    if (session !== "full_day") days = Math.min(days, 1) * 0.5;

    // Emergency leave: always unpaid, no balance consumed
    if (isEmergency) {
      return { total: days, skipped: dates.length - working.length, paid: 0, unpaid: days, hodDecides: false, alwaysUnpaid: true };
    }

    if (isHodFinal) {
      return { total: days, skipped: dates.length - working.length, paid: 0, unpaid: 0, hodDecides: true, alwaysUnpaid: false, hodFinal: true };
    }

    if (leaveType !== "casual") {
      return { total: days, skipped: dates.length - working.length, paid: 0, unpaid: 0, hodDecides: true, alwaysUnpaid: false, hodFinal: false };
    }

    const bal = balances.find((b) => b.type === leaveType);
    let remaining = bal ? Math.max(bal.yearlyCap - bal.usedYear, 0) : 0;
    if (bal?.monthlyCap !== undefined) {
      remaining = Math.min(remaining, Math.max(bal.monthlyCap - bal.usedMonth, 0));
    }
    const paid = Math.min(days, remaining);
    return {
      total: days,
      skipped: dates.length - working.length,
      paid,
      unpaid: days - paid,
      hodDecides: false,
      alwaysUnpaid: false,
    };
  }, [fromDate, toDate, session, holidays, balances, leaveType, isEmergency]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ leaveType, fromDate, toDate, session, reason });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (toDate < fromDate) return toast.error("To date must be after the from date");
    if (session !== "full_day" && fromDate !== toDate)
      return toast.error("Half day leave must be for a single date");
    if (preview && preview.total === 0)
      return toast.error("The selected dates are all Sundays or holidays");

    setBusy(true);
    const { error } = await supabase.from("leave_requests").insert({
      teacher_id: profile!.id,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      session: session as "full_day" | "forenoon" | "afternoon",
      reason: reason.trim(),
      // Emergency bypasses HOD — goes straight to principal queue for the 5-hour countdown
      status: isEmergency ? "pending_principal" : "pending_hod",
      ...(isEmergency && preview
        ? { paid_days: 0, unpaid_days: preview.total, total_days: preview.total }
        : {}),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
    if (isEmergency) {
      toast.success("Emergency leave submitted — auto-approves in 5 hours with pay cut");
    } else if (isHodFinal) {
      toast.success(`${leaveType === "medical" ? "Medical" : "Duty"} leave sent to HOD — you'll need to upload a ${requiredDoc} after approval`);
    } else {
      toast.success("Leave request sent to your HOD");
    }
    navigate({ to: "/leaves" });
  }

  return (
    <AppShell title="Apply Leave" subtitle="Your request goes to the HOD first, then the principal">
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-5">
            {/* Emergency leave banner */}
            {isEmergency && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/8 p-3 text-sm">
                <p className="font-semibold text-destructive">⚠ Emergency Leave</p>
                <p className="mt-1 text-muted-foreground">
                  This leave will be <strong>automatically approved after 5 hours</strong> without
                  requiring HOD or principal action. The entire duration will be{" "}
                  <strong>unpaid and deducted from your salary</strong>.
                </p>
              </div>
            )}

            {/* Medical / Duty leave banner */}
            {isHodFinal && (
              <div className="rounded-lg border border-info/40 bg-info/8 p-3 text-sm">
                <p className="font-semibold text-info">
                  {leaveType === "medical" ? "🏥 Medical Leave" : "🗂 Duty Leave"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  HOD approves this leave directly — <strong>your leave will be approved immediately</strong> once the HOD acts on it.
                  Afterwards, you must upload a <strong>{requiredDoc}</strong> for records.
                  The principal will verify the document separately.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Leave Type</Label>
                <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAVE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                        {t.value === "emergency" && " (auto-approved, unpaid)"}
                        {t.hodFinal && " (HOD approved, doc required)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Session</Label>
                <RadioGroup
                  value={session}
                  onValueChange={setSession}
                  className="flex h-9 items-center gap-5"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="full_day" id="full_day" />
                    <Label htmlFor="full_day" className="font-normal">
                      Full Day
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="forenoon" id="forenoon" />
                    <Label htmlFor="forenoon" className="font-normal">
                      Forenoon
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="afternoon" id="afternoon" />
                    <Label htmlFor="afternoon" className="font-normal">
                      Afternoon
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="from">From Date</Label>
                <Input
                  id="from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    if (toDate < e.target.value) setToDate(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">To Date</Label>
                <Input
                  id="to"
                  type="date"
                  value={toDate}
                  min={fromDate}
                  disabled={session !== "full_day"}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                rows={4}
                maxLength={500}
                placeholder={
                  isEmergency
                    ? "Describe the emergency situation..."
                    : "Enter reason for leave..."
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {isEmergency ? "Submit Emergency Leave" : "Submit Request"}
            </Button>
          </form>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="This Request">
            {preview ? (
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Dates</span>
                  <span className="font-medium">
                    {fmtDate(fromDate)} – {fmtDate(toDate)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Leave days counted</span>
                  <span className="font-medium">{preview.total}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">Sundays / holidays skipped</span>
                  <span className="font-medium">{preview.skipped}</span>
                </li>
                {preview.alwaysUnpaid ? (
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Salary impact</span>
                    <span className="font-semibold text-destructive">
                      All {preview.total} day(s) unpaid
                    </span>
                  </li>
                ) : preview.hodDecides ? (
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Salary impact</span>
                    <span className="font-semibold text-warning-foreground">
                      {(preview as any).hodFinal
                        ? "Principal decides after document"
                        : "HOD marks paid / unpaid"}
                    </span>
                  </li>
                ) : (
                  <>
                    <li className="flex justify-between">
                      <span className="text-muted-foreground">Paid</span>
                      <span className="font-semibold text-success">{preview.paid}</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-muted-foreground">Pay cut</span>
                      <span className="font-semibold text-destructive">{preview.unpaid}</span>
                    </li>
                  </>
                )}
                {isEmergency && (
                  <li className="mt-2 rounded-lg border border-destructive/30 bg-destructive/8 p-2 text-xs text-destructive">
                    Auto-approves 5 hours after submission. No action needed from HOD or principal.
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Select valid dates to see the impact.</p>
            )}
          </SectionCard>

          {!isEmergency && (
            <SectionCard title="Leave Balance">
              <ul className="space-y-3 text-sm">
                {balances
                  .filter((b) => b.type === "casual")
                  .map((b) => (
                    <li key={b.type} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="font-semibold">
                        {b.monthlyCap !== undefined
                          ? `${Math.max(b.monthlyCap - b.usedMonth, 0)} / ${b.monthlyCap} this month`
                          : `${Math.max(b.yearlyCap - b.usedYear, 0)} / ${b.yearlyCap} days`}
                      </span>
                    </li>
                  ))}
              </ul>
            </SectionCard>
          )}

          {isEmergency && (
            <SectionCard title="Emergency Leave Policy">
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li>• Auto-approved after 5 hours with no HOD / principal action needed</li>
                <li>• HOD and principal are still notified and may reject within 5 hours</li>
                <li>• All days are unpaid — salary deduction is applied automatically</li>
                <li>• Up to 6 emergency leaves per year</li>
              </ul>
            </SectionCard>
          )}
        </div>
      </div>
    </AppShell>
  );
}
