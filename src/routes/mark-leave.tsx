import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
import { LEAVE_TYPES, todayISO, type LeaveType } from "@/lib/leave";

export const Route = createFileRoute("/mark-leave")({
  head: () => ({
    meta: [
      { title: "Mark Leave for a Teacher — CSC Leave Management" },
      {
        name: "description",
        content:
          "HODs and the principal can record a leave for an absent teacher and mark it paid or unpaid.",
      },
      { property: "og:title", content: "Mark Leave for a Teacher — CSC Leave Management" },
      { property: "og:description", content: "Record absences on behalf of a teacher." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal"]}>
      <MarkLeavePage />
    </Guarded>
  ),
});

function MarkLeavePage() {
  const { profile, role } = useAuth();
  const qc = useQueryClient();
  const isPrincipal = role === "principal";

  const [teacherId, setTeacherId] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [session, setSession] = useState("full_day");
  const [payment, setPayment] = useState<"paid" | "unpaid">("unpaid");
  const [reason, setReason] = useState("Marked absent by the department");
  const [busy, setBusy] = useState(false);

  const { data: teachers = [] } = useQuery({
    queryKey: ["markable-teachers", profile?.id, role],
    enabled: !!profile,
    queryFn: async () => {
      let q = supabase.from("profiles").select("id, full_name, designation, department_id");
      if (!isPrincipal) q = q.eq("department_id", profile!.department_id ?? "");
      const { data, error } = await q.neq("id", profile!.id).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!teacherId) return toast.error("Select a teacher");
    if (toDate < fromDate) return toast.error("To date must be after the from date");
    if (session !== "full_day" && fromDate !== toDate)
      return toast.error("Half day leave must be for a single date");
    if (reason.trim().length < 5) return toast.error("Please give a reason");

    setBusy(true);
    const { error } = await supabase.from("leave_requests").insert({
      teacher_id: teacherId,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      session: session as "full_day" | "forenoon" | "afternoon",
      reason: reason.trim(),
      payment_decision: payment,
      applied_by: profile!.id,
      status: "approved",
      hod_note: `Recorded by ${profile!.full_name}`,
      hod_acted_at: new Date().toISOString(),
      principal_acted_at: isPrincipal ? new Date().toISOString() : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      payment === "unpaid"
        ? "Leave recorded — salary will be deducted for these days"
        : "Paid leave recorded — no salary deduction",
    );
    setReason("Marked absent by the department");
    qc.invalidateQueries();
  }

  return (
    <AppShell
      title="Mark Leave for a Teacher"
      subtitle="Use this when a teacher was absent without applying in the app"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <SectionCard title="Absence details">
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Teacher</Label>
                <Select value={teacherId} onValueChange={setTeacherId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a teacher" />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.full_name} · {t.designation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mfrom">From Date</Label>
                <Input
                  id="mfrom"
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    if (toDate < e.target.value) setToDate(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mto">To Date</Label>
                <Input
                  id="mto"
                  type="date"
                  min={fromDate}
                  value={toDate}
                  disabled={session !== "full_day"}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Session</Label>
              <RadioGroup value={session} onValueChange={setSession} className="flex flex-wrap gap-5">
                {[
                  ["full_day", "Full Day"],
                  ["forenoon", "Forenoon"],
                  ["afternoon", "Afternoon"],
                ].map(([v, l]) => (
                  <div key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={`ms-${v}`} />
                    <Label htmlFor={`ms-${v}`} className="font-normal">
                      {l}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Payment</Label>
              <RadioGroup
                value={payment}
                onValueChange={(v) => setPayment(v as "paid" | "unpaid")}
                className="flex flex-wrap gap-5"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="paid" id="mp-paid" />
                  <Label htmlFor="mp-paid" className="font-normal">
                    Paid — no salary cut
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="unpaid" id="mp-unpaid" />
                  <Label htmlFor="mp-unpaid" className="font-normal">
                    Unpaid — deduct salary
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mreason">Reason / remark</Label>
              <Textarea
                id="mreason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              Record leave
            </Button>
          </form>
        </SectionCard>

        <SectionCard title="How this works">
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li>The leave is saved as already approved — the teacher does not need to apply.</li>
            <li>
              Marking it <span className="font-semibold text-destructive">unpaid</span> deducts one
              day of salary for every leave day counted (Sundays and holidays are skipped).
            </li>
            <li>
              Marking it <span className="font-semibold text-success">paid</span> keeps the salary
              untouched.
            </li>
            <li>It shows on the teacher's calendar and payroll page immediately.</li>
          </ul>
        </SectionCard>
      </div>
    </AppShell>
  );
}
