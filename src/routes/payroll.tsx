import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, StatusBadge, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate, leaveTypeLabel, money, perDaySalary, LEAVE_TYPES, type LeaveStatus, type LeaveType } from "@/lib/leave";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll — CSC Leave Management" },
      {
        name: "description",
        content: "Monthly salary, unpaid leave deductions and net pay for the logged in teacher.",
      },
      { property: "og:title", content: "Payroll — CSC Leave Management" },
      { property: "og:description", content: "Salary with automatic unpaid-leave deductions." },
    ],
  }),
  component: () => (
    <Guarded>
      <PayrollPage />
    </Guarded>
  ),
});

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));

function PayrollPage() {
  const { profile } = useAuth();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [filterYear, setFilterYear] = useState(String(CURRENT_YEAR));
  const [filterType, setFilterType] = useState("all");

  const fromISO = iso(new Date(Number(filterYear), month.getMonth(), 1));
  const toISO   = iso(new Date(Number(filterYear), month.getMonth() + 1, 0));

  // Sync month year with filterYear
  const effectiveMonth = new Date(Number(filterYear), month.getMonth(), 1);

  const { data: allLeaves = [] } = useQuery({
    queryKey: ["payroll-leaves", profile?.id, fromISO],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, leave_type, from_date, to_date, status, total_days, paid_days, unpaid_days, payment_decision, principal_acted_at, hod_acted_at, doc_status")
        .eq("teacher_id", profile!.id)
        .in("status", ["approved", "hod_approved"])
        .lte("from_date", toISO)
        .gte("to_date", fromISO)
        .order("from_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const leaves = useMemo(() =>
    filterType === "all" ? allLeaves : allLeaves.filter((l) => l.leave_type === filterType),
    [allLeaves, filterType],
  );

  const salary = Number(profile?.monthly_salary ?? 0);
  const dayRate = perDaySalary(salary);

  const totals = useMemo(() => {
    // Only deduct for leaves that have BOTH HOD and Principal approval

    const fullyApproved = leaves.filter((l) => {

      const isHodFinal = l.leave_type === "medical" || l.leave_type === "duty";
      // Medical/duty: deduction applies once principal has verified the document and set payment_decision
      if (isHodFinal) return !!(l as any).payment_decision;
      return !!(l as any).hod_acted_at && !!(l as any).principal_acted_at;
    });
    const unpaid = fullyApproved.reduce((s, l) => s + Number(l.unpaid_days), 0);
    const paid = fullyApproved.reduce((s, l) => s + Number(l.paid_days), 0);
    const deduction = Math.round(unpaid * dayRate);
    return { unpaid, paid, deduction, net: Math.max(salary - deduction, 0), fullyApproved };
  }, [leaves, dayRate, salary]);

  return (
    <AppShell title="Payroll" subtitle="Salary and leave deductions">
      <div className="space-y-6">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Year */}
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Month nav */}
          <div className="flex items-center gap-1 rounded-lg border border-border px-1">
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setMonth(new Date(effectiveMonth.getFullYear(), effectiveMonth.getMonth() - 1, 1))}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="text-sm font-medium w-24 text-center">
              {effectiveMonth.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setMonth(new Date(effectiveMonth.getFullYear(), effectiveMonth.getMonth() + 1, 1))}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>

          {/* Leave type */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All leave types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All leave types</SelectItem>
              {LEAVE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Monthly Salary" value={money(salary)} hint={`${money(dayRate)} per day`} />
          <StatCard label="Paid Leave Days" value={totals.paid} tone="success" hint="no deduction" />
          <StatCard label="Unpaid Leave Days" value={totals.unpaid} tone="destructive" hint="salary is cut" />
          <StatCard
            label="Net Pay"
            value={money(totals.net)}
            tone={totals.deduction > 0 ? "warning" : "success"}
            hint={totals.deduction > 0 ? `− ${money(totals.deduction)} deducted` : "full salary"}
          />
        </div>

        <SectionCard
          title="Salary breakdown"
          subtitle={effectiveMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        >
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">Gross salary</span>
              <span className="font-semibold">{money(salary)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">
                Unpaid leave ({totals.unpaid} × {money(dayRate)})
              </span>
              <span className="font-semibold text-destructive">− {money(totals.deduction)}</span>
            </li>
            <li className="flex justify-between border-t border-border pt-2 text-base">
              <span className="font-bold">Net payable</span>
              <span className="font-extrabold">{money(totals.net)}</span>
            </li>
          </ul>
        </SectionCard>

        <SectionCard
          title="Leaves this month"
          subtitle={`${filterType === "all" ? "All types" : leaveTypeLabel(filterType as LeaveType)} · Deductions apply only after both HOD and Principal approval`}
        >
          {leaves.length === 0 ? (
            <Empty>No leaves this month — full salary payable.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Type</th>
                    <th className="pb-2 font-semibold">Dates</th>
                    <th className="pb-2 font-semibold">Days</th>
                    <th className="pb-2 font-semibold">Paid / Unpaid</th>
                    <th className="pb-2 font-semibold">Deduction</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-3 font-medium">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                      <td className="py-3">
                        {fmtDate(l.from_date)} – {fmtDate(l.to_date)}
                      </td>
                      <td className="py-3">{Number(l.total_days)}</td>
                      <td className="py-3">
                        {l.payment_decision === null && l.leave_type !== "casual" ? (
                          <span className="text-muted-foreground">
                            {l.leave_type === "medical" || l.leave_type === "duty"
                              ? "Awaiting principal document verification"
                              : "Awaiting principal approval"}
                          </span>
                        ) : (
                          <>
                            <span className="text-success">{Number(l.paid_days)} paid</span> ·{" "}
                            <span className="text-destructive">{Number(l.unpaid_days)} unpaid</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 font-semibold text-destructive">
                        {Number(l.unpaid_days) > 0 ? `− ${money(Number(l.unpaid_days) * dayRate)}` : "—"}
                      </td>
                      <td className="py-3">
                        <StatusBadge status={l.status as LeaveStatus} />
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
